//! Aggregate state and the pure `apply` fold. `apply` never sees time or randomness.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::clock::Clock;
use crate::config::Config;
use crate::event::{Event, Finish};
use crate::ids::{BustGroup, PlayerId, SeatNo, SeatRef, TableNo, TournamentId};
use crate::money::Chips;
use crate::name;
use crate::structure::Level;

/// Tournament lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Phase {
    /// Registration and seating before the first clock start.
    #[serde(rename = "setup")]
    Setup,
    #[serde(rename = "running")]
    Running,
    /// Frozen: only undo/redo are accepted.
    #[serde(rename = "finished")]
    Finished { winner: PlayerId },
}

/// Table lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum TableStatus {
    /// Never opened yet.
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "open")]
    Open,
    /// Broken; stays empty.
    #[serde(rename = "closed")]
    Closed,
}

/// A physical table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    pub no: TableNo,
    pub seats: u8,
    pub status: TableStatus,
    pub occupants: BTreeMap<SeatNo, PlayerId>,
    /// Button position for the next hand, when known (may be an empty seat).
    pub button: Option<SeatNo>,
}

impl Table {
    fn new(no: TableNo, seats: u8) -> Self {
        Self {
            no,
            seats,
            status: TableStatus::Idle,
            occupants: BTreeMap::new(),
            button: None,
        }
    }

    /// Number of seated players.
    pub fn count(&self) -> usize {
        self.occupants.len()
    }

    /// True when a player can be seated at `seat`.
    pub fn is_free(&self, seat: SeatNo) -> bool {
        (1..=self.seats).contains(&seat.0) && !self.occupants.contains_key(&seat)
    }

    /// Empty seats, ascending.
    pub fn free_seats(&self) -> Vec<SeatNo> {
        (1..=self.seats)
            .map(SeatNo)
            .filter(|s| !self.occupants.contains_key(s))
            .collect()
    }
}

/// Where a player is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PlayerStatus {
    #[serde(rename = "seated")]
    Seated { seat: SeatRef },
    /// Eliminated in bust group `group`; `start_stack` is the stack at the start of the hand.
    #[serde(rename = "busted")]
    Busted {
        group: BustGroup,
        start_stack: Option<Chips>,
        last_seat: SeatRef,
    },
}

/// A registered player (one per person; re-entries will add entries, not players).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Player {
    pub id: PlayerId,
    pub name: String,
    pub name_key: String,
    pub status: PlayerStatus,
    pub entries: u8,
    /// Chips received from all entries.
    pub chips_bought: Chips,
}

impl Player {
    /// Current seat, if still in.
    pub fn seat(&self) -> Option<SeatRef> {
        match self.status {
            PlayerStatus::Seated { seat } => Some(seat),
            PlayerStatus::Busted { .. } => None,
        }
    }

    /// True while seated.
    pub fn is_alive(&self) -> bool {
        self.seat().is_some()
    }
}

/// Full tournament state, rebuilt by folding events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub id: TournamentId,
    pub phase: Phase,
    pub config: Config,
    pub structure: Vec<Level>,
    pub clock: Clock,
    /// Director override of the late registration deadline.
    pub reg_override: Option<bool>,
    pub players: BTreeMap<PlayerId, Player>,
    pub tables: BTreeMap<TableNo, Table>,
    pub next_player_id: u32,
    pub next_bust_group: u32,
    pub final_table_formed: bool,
}

/// An event that does not fit the state it is applied to (corrupted or foreign log).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyError(pub &'static str);

impl State {
    /// State right after `TournamentCreated`.
    pub fn genesis(id: TournamentId, config: Config, structure: Vec<Level>) -> Self {
        let mut state = Self {
            id,
            phase: Phase::Setup,
            clock: Clock::initial(&structure),
            config,
            structure,
            reg_override: None,
            players: BTreeMap::new(),
            tables: BTreeMap::new(),
            next_player_id: 1,
            next_bust_group: 1,
            final_table_formed: false,
        };
        state.sync_tables();
        state
    }

    /// Players still in.
    pub fn alive_count(&self) -> usize {
        self.players.values().filter(|p| p.is_alive()).count()
    }

    /// Looks up a player.
    pub fn player(&self, id: PlayerId) -> Option<&Player> {
        self.players.get(&id)
    }

    /// The only remaining player, if exactly one is left.
    pub fn sole_survivor(&self) -> Option<PlayerId> {
        let mut alive = self.players.values().filter(|p| p.is_alive());
        match (alive.next(), alive.next()) {
            (Some(p), None) => Some(p.id),
            _ => None,
        }
    }

    /// Tables currently open.
    pub fn open_tables(&self) -> impl Iterator<Item = &Table> {
        self.tables
            .values()
            .filter(|t| t.status == TableStatus::Open)
    }

    /// Creates idle tables up to `max_tables`, drops unused ones above it and applies
    /// the configured seat count.
    fn sync_tables(&mut self) {
        let max = self.config.max_tables;
        let seats = self.config.seats_per_table;
        self.tables.retain(|no, _| no.0 <= max);
        for no in 1..=max {
            let table = self
                .tables
                .entry(TableNo(no))
                .or_insert_with(|| Table::new(TableNo(no), seats));
            table.seats = seats;
            if table.button.is_some_and(|b| b.0 > seats) {
                table.button = None;
            }
        }
    }

    fn seat_player(&mut self, player: PlayerId, seat: SeatRef) -> Result<(), ApplyError> {
        let table = self
            .tables
            .get_mut(&seat.table)
            .ok_or(ApplyError("unknown table"))?;
        if table.status == TableStatus::Closed || !table.is_free(seat.seat) {
            return Err(ApplyError("seat not available"));
        }
        table.status = TableStatus::Open;
        table.occupants.insert(seat.seat, player);
        Ok(())
    }

    fn unseat_player(&mut self, player: PlayerId, seat: SeatRef) -> Result<(), ApplyError> {
        let table = self
            .tables
            .get_mut(&seat.table)
            .ok_or(ApplyError("unknown table"))?;
        match table.occupants.remove(&seat.seat) {
            Some(p) if p == player => Ok(()),
            _ => Err(ApplyError("player not at seat")),
        }
    }

    fn player_mut(&mut self, id: PlayerId) -> Result<&mut Player, ApplyError> {
        self.players
            .get_mut(&id)
            .ok_or(ApplyError("unknown player"))
    }

    fn move_player(
        &mut self,
        player: PlayerId,
        from: SeatRef,
        to: SeatRef,
    ) -> Result<(), ApplyError> {
        if self.player(player).and_then(Player::seat) != Some(from) {
            return Err(ApplyError("player not at seat"));
        }
        self.unseat_player(player, from)?;
        self.seat_player(player, to)?;
        self.player_mut(player)?.status = PlayerStatus::Seated { seat: to };
        Ok(())
    }

    fn finish(&mut self, finish: &Finish) {
        self.phase = Phase::Finished {
            winner: finish.winner,
        };
        self.clock = finish.clock;
    }
}

/// Applies one event. Pure and deterministic.
pub fn apply(state: &mut State, event: &Event) -> Result<(), ApplyError> {
    match event {
        Event::TournamentCreated { .. } => return Err(ApplyError("tournament already created")),
        Event::ConfigUpdated { config } => {
            state.config = config.clone();
            state.sync_tables();
        }
        Event::StructureUpdated { levels, clock } => {
            state.structure = levels.clone();
            state.clock = *clock;
        }
        Event::PlayerRegistered {
            player,
            name,
            seat,
            stack,
            ..
        } => {
            if state.players.contains_key(player) {
                return Err(ApplyError("player id already used"));
            }
            state.seat_player(*player, *seat)?;
            state.players.insert(
                *player,
                Player {
                    id: *player,
                    name: name.clone(),
                    name_key: name::key(name),
                    status: PlayerStatus::Seated { seat: *seat },
                    entries: 1,
                    chips_bought: *stack,
                },
            );
            state.next_player_id = state.next_player_id.max(player.0.saturating_add(1));
        }
        Event::PlayerUnregistered { player } => {
            let seat = state
                .player(*player)
                .and_then(Player::seat)
                .ok_or(ApplyError("player not seated"))?;
            state.unseat_player(*player, seat)?;
            state.players.remove(player);
        }
        Event::PlayersBusted {
            group,
            busts,
            finish,
        } => {
            for bust in busts {
                if state.player(bust.player).and_then(Player::seat) != Some(bust.seat) {
                    return Err(ApplyError("busted player not at seat"));
                }
                state.unseat_player(bust.player, bust.seat)?;
                state.player_mut(bust.player)?.status = PlayerStatus::Busted {
                    group: *group,
                    start_stack: bust.start_stack,
                    last_seat: bust.seat,
                };
            }
            state.next_bust_group = state.next_bust_group.max(group.0.saturating_add(1));
            if let Some(finish) = finish {
                state.finish(finish);
            }
        }
        Event::PlayerRevived { player, seat } => {
            if state.player(*player).is_none_or(Player::is_alive) {
                return Err(ApplyError("player not busted"));
            }
            state.seat_player(*player, *seat)?;
            state.player_mut(*player)?.status = PlayerStatus::Seated { seat: *seat };
        }
        Event::PlayerMoved {
            player, from, to, ..
        } => state.move_player(*player, *from, *to)?,
        Event::RegistrationOverridden { open, finish } => {
            state.reg_override = Some(*open);
            if let Some(finish) = finish {
                state.finish(finish);
            }
        }
        Event::TournamentFinished { finish } => state.finish(finish),
        Event::ClockChanged {
            clock,
            starts_tournament,
            ..
        } => {
            state.clock = *clock;
            if *starts_tournament {
                state.phase = Phase::Running;
            }
        }
    }
    Ok(())
}
