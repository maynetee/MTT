//! Shared helpers for integration tests.
#![allow(dead_code)]

use std::collections::BTreeSet;

use mtt_core::rng::mix_seed;
use mtt_core::state::TableStatus;
use mtt_core::{
    Aggregate, Ante, BustInput, Chips, Command, Config, Ctx, DomainError, Level, Money,
    MoneyConfig, NewTournament, Outcome, Phase, PlayerId, SeatRef, State, TournamentId, View,
};

pub const T0: i64 = 1_700_000_000_000;
pub const MIN: i64 = 60_000;

pub fn play(sb: i64, bb: i64, minutes: i64) -> Level {
    Level::Play {
        sb: Chips(sb),
        bb: Chips(bb),
        ante: Ante::None,
        duration_ms: minutes * MIN,
    }
}

pub fn pause(minutes: i64) -> Level {
    Level::Break {
        duration_ms: minutes * MIN,
        color_up: None,
    }
}

/// 20-minute levels: 25/50, 50/100, break 10, 75/150, 100/200.
pub fn levels() -> Vec<Level> {
    vec![
        play(25, 50, 20),
        play(50, 100, 20),
        pause(10),
        play(75, 150, 20),
        play(100, 200, 20),
    ]
}

pub fn config(seats: u8, tables: u16) -> Config {
    Config {
        places_paid: 3,
        ..Config::new("Test event", seats, tables, 10_000)
    }
}

/// EUR 100 + 10 buy-ins, payouts rounded to whole euros.
pub fn money() -> MoneyConfig {
    MoneyConfig {
        rounding_unit: Money(100),
        ..MoneyConfig::new("EUR", 2, 10_000, 1_000)
    }
}

/// `config(seats, tables)` with money tracked.
pub fn money_config(seats: u8, tables: u16) -> Config {
    Config {
        money: Some(money()),
        ..config(seats, tables)
    }
}

/// An aggregate plus a fake wall clock and a seed stream.
pub struct Harness {
    pub agg: Aggregate,
    pub now: i64,
    pub seed: u64,
}

impl Harness {
    pub fn new(config: Config, structure: Vec<Level>) -> Self {
        let new = NewTournament {
            id: TournamentId("t-1".into()),
            config,
            structure,
        };
        let agg = Aggregate::create(new, &Ctx::new(T0, 0)).expect("valid tournament");
        Self {
            agg,
            now: T0,
            seed: 1,
        }
    }

    pub fn standard(seats: u8, tables: u16) -> Self {
        Self::new(config(seats, tables), levels())
    }

    pub fn ctx(&mut self) -> Ctx {
        self.seed = mix_seed(self.seed);
        Ctx::new(self.now, self.seed)
    }

    pub fn run(&mut self, cmd: Command) -> Result<Outcome, DomainError> {
        let ctx = self.ctx();
        self.agg.dispatch(cmd, &ctx)
    }

    #[track_caller]
    pub fn ok(&mut self, cmd: Command) -> Outcome {
        match self.run(cmd.clone()) {
            Ok(outcome) => outcome,
            Err(err) => panic!("{cmd:?} rejected: {err}"),
        }
    }

    #[track_caller]
    pub fn err(&mut self, cmd: Command) -> DomainError {
        let before = self.agg.clone();
        match self.run(cmd.clone()) {
            Ok(outcome) => panic!("{cmd:?} accepted: {outcome:?}"),
            Err(err) => {
                assert_eq!(self.agg, before, "rejected command changed the aggregate");
                err
            }
        }
    }

    pub fn advance(&mut self, ms: i64) {
        self.now += ms;
    }

    pub fn view(&self) -> View {
        self.agg.view(self.now)
    }

    #[track_caller]
    pub fn register(&mut self, name: &str) -> PlayerId {
        self.ok(Command::Register {
            name: name.into(),
            seat: None,
        });
        PlayerId(self.agg.state().next_player_id - 1)
    }

    #[track_caller]
    pub fn register_at(&mut self, name: &str, table: u16, seat: u8) -> PlayerId {
        self.ok(Command::Register {
            name: name.into(),
            seat: Some(SeatRef::new(table, seat)),
        });
        PlayerId(self.agg.state().next_player_id - 1)
    }

    /// Registers `n` players named P1..Pn.
    pub fn register_many(&mut self, n: u32) -> Vec<PlayerId> {
        self.register_many_from(1, n)
    }

    /// Registers players named P`from`..P`to`.
    pub fn register_many_from(&mut self, from: u32, to: u32) -> Vec<PlayerId> {
        (from..=to)
            .map(|i| self.register(&format!("P{i}")))
            .collect()
    }

    #[track_caller]
    pub fn start(&mut self) {
        self.ok(Command::StartClock {});
    }

    #[track_caller]
    pub fn bust(&mut self, players: &[PlayerId]) {
        self.ok(bust_cmd(players));
    }
}

pub fn bust_cmd(players: &[PlayerId]) -> Command {
    Command::BustPlayers {
        busts: players
            .iter()
            .map(|&player| BustInput {
                player,
                start_stack: None,
            })
            .collect(),
    }
}

pub fn bust_with_stacks(busts: &[(PlayerId, i64)]) -> Command {
    Command::BustPlayers {
        busts: busts
            .iter()
            .map(|&(player, stack)| BustInput {
                player,
                start_stack: Some(Chips(stack)),
            })
            .collect(),
    }
}

/// Structural invariants that must hold after every command.
#[track_caller]
pub fn check_invariants(state: &State, view: &View) {
    let mut seen = BTreeSet::new();
    for table in state.tables.values() {
        if table.status != TableStatus::Open {
            assert!(
                table.occupants.is_empty(),
                "table {:?} is not open but has players",
                table.no
            );
        }
        assert!(
            table.count() <= usize::from(table.seats),
            "table {:?} overfull",
            table.no
        );
        for (&seat, &player) in &table.occupants {
            assert!(
                (1..=table.seats).contains(&seat.0),
                "seat {seat:?} out of range"
            );
            assert!(seen.insert(player), "player {player:?} seated twice");
            let at = SeatRef {
                table: table.no,
                seat,
            };
            assert_eq!(
                state.player(player).and_then(|p| p.seat()),
                Some(at),
                "seat map out of sync"
            );
        }
    }
    let alive = state.alive_count();
    assert_eq!(seen.len(), alive, "alive players missing from tables");
    let unique = state.players.len() as u32;
    assert_eq!(view.counts.alive + view.counts.busted, unique);
    assert!(view.counts.entries >= unique, "fewer entries than players");
    if state.phase != Phase::Setup {
        assert!(alive >= 1, "nobody left");
    }
    // Busted places cover exactly [alive + 1, N], ties spanning their width.
    let mut busted: Vec<(u32, u32)> = view
        .ranking
        .iter()
        .filter(|r| !r.alive)
        .map(|r| {
            (
                r.place.expect("busted players have a place"),
                r.place_to.or(r.place).unwrap(),
            )
        })
        .collect();
    busted.sort_unstable();
    let mut expected = alive as u32 + 1;
    let mut i = 0;
    while i < busted.len() {
        let (place, place_to) = busted[i];
        assert_eq!(place, expected, "places have a gap or overlap: {busted:?}");
        let width = (place_to - place + 1) as usize;
        assert!(
            busted[i..].len() >= width
                && busted[i..i + width].iter().all(|b| *b == (place, place_to))
        );
        expected = place_to + 1;
        i += width;
    }
    assert_eq!(expected, unique + 1, "places do not reach N: {busted:?}");
    if let Phase::Finished { winner } = state.phase {
        let row = view.ranking.iter().find(|r| r.player == winner).unwrap();
        assert_eq!(row.place, Some(1));
    }
}

/// `(place, place_to)` of a player in the view's ranking.
pub fn place_of(view: &View, player: PlayerId) -> Option<(u32, Option<u32>)> {
    view.ranking
        .iter()
        .find(|r| r.player == player)
        .and_then(|r| r.place.map(|p| (p, r.place_to)))
}
