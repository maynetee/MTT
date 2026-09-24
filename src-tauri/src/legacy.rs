//! Import of the tournament kept by the previous version of the app (identifier
//! `com.mtt.app`, relational schema version 1). Its database is only ever opened
//! read-only; the tournament is rebuilt through core commands, so the result is an ordinary
//! event log that passed every rule of the core.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use mtt_core::config::{MAX_LATE_REG_MS, MAX_TOURNAMENT_NAME, SEATS_RANGE, TABLES_RANGE};
use mtt_core::name::{self, MAX_NAME_CHARS};
use mtt_core::state::TableStatus;
use mtt_core::structure::{MAX_LEVEL_MS, MAX_LEVELS};
use mtt_core::{
    Aggregate, Ante, BustInput, Chips, Command, Config, Ctx, Deadline, DomainError, Envelope,
    Event, Level, NewTournament, Outcome, PlayerId, SeatRef, TableNo, TournamentId,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::EngineError;

/// Bundle identifier of the previous version: its data directory sits next to ours.
pub const LEGACY_IDENTIFIER: &str = "com.mtt.app";

/// Environment variable that overrides the path of the previous version's database.
pub const LEGACY_DB_ENV: &str = "MTT_LEGACY_DB";

/// Starting stack of an imported tournament: the previous version did not track chips.
pub const LEGACY_STARTING_STACK: i64 = 10_000;

/// Where the previous version's database is expected, when known.
#[derive(Debug, Clone, Default)]
pub struct LegacySource {
    pub path: Option<PathBuf>,
}

/// Result of `legacy_import_status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyStatus {
    pub available: bool,
}

/// A tournament as stored by schema version 1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct V1Tournament {
    pub name: String,
    pub tables_count: i64,
    pub seats_per_table: i64,
    pub itm_count: i64,
    pub late_reg_enabled: bool,
    /// Index (breaks included) of the last level open to late registration.
    pub late_reg_end_level: Option<i64>,
    pub late_reg_end_time_seconds: Option<i64>,
    /// `setup`, `running` or `finished`.
    pub status: String,
    pub current_level_index: i64,
    pub clock_remaining_seconds: i64,
    /// Ordered by index.
    pub levels: Vec<V1Level>,
    /// Ordered by registration.
    pub players: Vec<V1Player>,
    pub closed_tables: BTreeSet<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct V1Level {
    pub idx: i64,
    pub duration_seconds: i64,
    pub small_blind: i64,
    pub big_blind: i64,
    pub ante: i64,
    pub is_break: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct V1Player {
    pub id: i64,
    pub name: String,
    pub eliminated: bool,
    pub eliminated_at: Option<i64>,
    /// `(table_no, seat_no)` of a player still in.
    pub seat: Option<(i64, i64)>,
}

fn open_read_only(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

/// True when the database at `path` exists and holds a tournament.
pub fn available(path: &Path) -> bool {
    path.is_file()
        && open_read_only(path)
            .and_then(|conn| {
                conn.query_row("SELECT EXISTS (SELECT 1 FROM tournaments)", [], |row| {
                    row.get(0)
                })
            })
            .unwrap_or(false)
}

/// Reads the latest tournament of the database at `path`, `None` when there is none.
pub fn read(path: &Path) -> Result<Option<V1Tournament>, EngineError> {
    if !path.is_file() {
        return Ok(None);
    }
    let conn = open_read_only(path)?;
    let found = conn
        .query_row(
            "SELECT id, name, tables_count, seats_per_table, itm_count, late_reg_enabled,
                    late_reg_end_level, late_reg_end_time_seconds, status,
                    current_level_index, clock_remaining_seconds
             FROM tournaments ORDER BY id DESC LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    V1Tournament {
                        name: row.get(1)?,
                        tables_count: row.get(2)?,
                        seats_per_table: row.get(3)?,
                        itm_count: row.get(4)?,
                        late_reg_enabled: row.get(5)?,
                        late_reg_end_level: row.get(6)?,
                        late_reg_end_time_seconds: row.get(7)?,
                        status: row.get(8)?,
                        current_level_index: row.get(9)?,
                        clock_remaining_seconds: row.get(10)?,
                        levels: Vec::new(),
                        players: Vec::new(),
                        closed_tables: BTreeSet::new(),
                    },
                ))
            },
        )
        .optional()?;
    let Some((id, mut tournament)) = found else {
        return Ok(None);
    };

    let mut stmt = conn.prepare(
        "SELECT idx, duration_seconds, small_blind, big_blind, ante, is_break
         FROM levels WHERE tournament_id = ?1 ORDER BY idx, id",
    )?;
    tournament.levels = stmt
        .query_map([id], |row| {
            Ok(V1Level {
                idx: row.get(0)?,
                duration_seconds: row.get(1)?,
                small_blind: row.get(2)?,
                big_blind: row.get(3)?,
                ante: row.get(4)?,
                is_break: row.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.status, p.eliminated_at, t.table_no, s.seat_no
         FROM players p
         LEFT JOIN seats s ON s.player_id = p.id
         LEFT JOIN tables t ON t.id = s.table_id AND t.tournament_id = p.tournament_id
         WHERE p.tournament_id = ?1
         ORDER BY p.registered_at, p.id",
    )?;
    tournament.players = stmt
        .query_map([id], |row| {
            let table: Option<i64> = row.get(4)?;
            let seat: Option<i64> = row.get(5)?;
            Ok(V1Player {
                id: row.get(0)?,
                name: row.get(1)?,
                eliminated: row.get::<_, String>(2)? == "eliminated",
                eliminated_at: row.get(3)?,
                seat: table.zip(seat),
            })
        })?
        .collect::<Result<_, _>>()?;

    let mut stmt =
        conn.prepare("SELECT table_no FROM tables WHERE tournament_id = ?1 AND is_closed = 1")?;
    tournament.closed_tables = stmt
        .query_map([id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(Some(tournament))
}

/// Runs the commands of the import on an aggregate.
struct Builder<F> {
    agg: Aggregate,
    ctx: F,
}

impl<F: FnMut() -> Result<Ctx, EngineError>> Builder<F> {
    /// Runs a command: a host failure aborts the import, a rejection is left to the caller.
    fn run(&mut self, cmd: Command) -> Result<Result<Outcome, DomainError>, EngineError> {
        let ctx = (self.ctx)()?;
        Ok(self.agg.dispatch(cmd, &ctx))
    }

    /// Runs a command that must be accepted.
    fn must(&mut self, cmd: Command) -> Result<Outcome, EngineError> {
        Ok(self.run(cmd)??)
    }

    /// Runs a command whose rejection only means there is nothing to do.
    fn attempt(&mut self, cmd: Command) -> Result<(), EngineError> {
        self.run(cmd).map(drop)
    }

    /// Registers a player at `seat`, renaming them if the core sees a duplicate name.
    fn register(&mut self, player: &V1Player, seat: SeatRef) -> Result<PlayerId, EngineError> {
        let base = player_name(player);
        for attempt in 1..=100 {
            let name = if attempt == 1 {
                base.clone()
            } else {
                let suffix = format!(" ({attempt})");
                let keep = MAX_NAME_CHARS - suffix.chars().count();
                format!("{}{suffix}", base.chars().take(keep).collect::<String>())
            };
            let cmd = Command::Register {
                name,
                seat: Some(seat),
            };
            match self.run(cmd)?.map(registered) {
                Ok(Some(id)) => return Ok(id),
                Ok(None) => break,
                Err(DomainError::NameTaken { .. }) => continue,
                Err(err) => return Err(err.into()),
            }
        }
        Err(EngineError::host(format!(
            "cannot register {} from the previous version",
            player.name
        )))
    }

    /// Eliminates a player alone in their hand. The last player standing stays in.
    fn bust(&mut self, player: PlayerId) -> Result<(), EngineError> {
        let cmd = Command::BustPlayers {
            busts: vec![BustInput {
                player,
                start_stack: None,
            }],
        };
        match self.run(cmd)? {
            Ok(_) | Err(DomainError::LastPlayerStanding) => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    /// A free seat that no player still in will claim: open tables first, then idle ones,
    /// then the tables the previous version had closed.
    fn free_seat(
        &self,
        reserved: &BTreeSet<SeatRef>,
        closed: &BTreeSet<i64>,
    ) -> Result<SeatRef, EngineError> {
        let mut tables: Vec<_> = self
            .agg
            .state()
            .tables
            .values()
            .filter(|t| t.status != TableStatus::Closed)
            .collect();
        tables.sort_by_key(|t| {
            (
                closed.contains(&i64::from(t.no.0)),
                t.status != TableStatus::Open,
                t.no,
            )
        });
        tables
            .iter()
            .flat_map(|t| {
                t.free_seats()
                    .into_iter()
                    .map(|seat| SeatRef { table: t.no, seat })
            })
            .find(|seat| !reserved.contains(seat))
            .ok_or_else(|| EngineError::host("no free seat left for the imported players"))
    }
}

/// The player a registration created.
fn registered(outcome: Outcome) -> Option<PlayerId> {
    match outcome {
        Outcome::Recorded {
            envelope:
                Envelope {
                    event: Event::PlayerRegistered { player, .. },
                    ..
                },
            ..
        } => Some(player),
        _ => None,
    }
}

/// Rebuilds a version 1 tournament under `id`. `ctx` supplies the context of each command.
///
/// Players still in keep their seat; eliminated players are registered, then busted one
/// per hand in elimination order, so that the core computes the same places. The clock
/// ends up paused on the level and remaining time the previous version showed.
pub fn rebuild(
    v1: &V1Tournament,
    id: TournamentId,
    mut ctx: impl FnMut() -> Result<Ctx, EngineError>,
) -> Result<Aggregate, EngineError> {
    let levels = &v1.levels[..v1.levels.len().min(MAX_LEVELS)];
    let structure = structure(levels);
    let config = config(v1, levels);
    let (max_tables, seats) = (config.max_tables, config.seats_per_table);
    let new = NewTournament {
        id,
        config,
        structure: structure.clone(),
    };
    let agg = Aggregate::create(new, &ctx()?)?;
    let mut b = Builder { agg, ctx };

    // Seats of the players still in, as long as they fit the configuration.
    let fits = |table: i64, seat: i64| {
        (1..=i64::from(max_tables)).contains(&table) && (1..=i64::from(seats)).contains(&seat)
    };
    let mut seat_of = BTreeMap::new();
    let mut reserved = BTreeSet::new();
    for player in v1.players.iter().filter(|p| !p.eliminated) {
        if let Some((table, seat)) = player.seat.filter(|&(t, s)| fits(t, s)) {
            let seat = SeatRef::new(table as u16, seat as u8);
            if reserved.insert(seat) {
                seat_of.insert(player.id, seat);
            }
        }
    }

    // Eliminated players in elimination order. Those that do not fit next to the players
    // still in are registered after the earlier ones have been busted.
    let mut busted: Vec<&V1Player> = v1.players.iter().filter(|p| p.eliminated).collect();
    busted.sort_by_key(|p| (p.eliminated_at.unwrap_or(i64::MIN), p.id));
    let alive = v1.players.len() - busted.len();
    let room = (usize::from(max_tables) * usize::from(seats)).saturating_sub(alive);
    let (early, late) = busted.split_at(room.min(busted.len()));
    let early_ids: BTreeSet<i64> = early.iter().map(|p| p.id).collect();

    let mut ids = BTreeMap::new();
    for player in &v1.players {
        let seat = match seat_of.get(&player.id) {
            Some(seat) => *seat,
            None if !player.eliminated || early_ids.contains(&player.id) => {
                b.free_seat(&reserved, &v1.closed_tables)?
            }
            None => continue,
        };
        ids.insert(player.id, b.register(player, seat)?);
    }

    let started = v1.status != "setup" || !busted.is_empty();
    let running = started
        && match b.run(Command::StartClock {})? {
            Ok(_) => {
                b.must(Command::PauseClock {})?;
                true
            }
            // Fewer than two players: nothing to bust, the tournament stays in setup.
            Err(DomainError::NotEnoughPlayers { .. }) => false,
            Err(err) => return Err(err.into()),
        };
    if running {
        for player in early {
            b.bust(ids[&player.id])?;
        }
        for player in late {
            let seat = b.free_seat(&reserved, &v1.closed_tables)?;
            let id = b.register(player, seat)?;
            b.bust(id)?;
        }
        for &table in &v1.closed_tables {
            let Ok(no) = u16::try_from(table) else {
                continue;
            };
            let emptied = b
                .agg
                .state()
                .tables
                .get(&TableNo(no))
                .is_some_and(|t| t.status == TableStatus::Open && t.occupants.is_empty());
            if emptied {
                b.attempt(Command::BreakTable { table: TableNo(no) })?;
            }
        }
    }

    // The clock, paused where the previous version was.
    let position = current_position(levels, v1.current_level_index);
    if position > 0 {
        b.must(Command::JumpTo {
            level: position as u16,
        })?;
    }
    let remaining = v1
        .clock_remaining_seconds
        .saturating_mul(1000)
        .clamp(0, MAX_LEVEL_MS);
    if remaining != structure[position].duration_ms() {
        b.must(Command::SetRemaining { ms: remaining })?;
    }

    if running && !v1.late_reg_enabled {
        b.attempt(Command::CloseRegistration {})?;
    }
    if running && v1.status == "finished" {
        // Closing registration declares the last player the winner.
        b.attempt(Command::CloseRegistration {})?;
        b.attempt(Command::FinishTournament {})?;
    }
    Ok(b.agg)
}

/// Index of the current level in the imported structure.
fn current_position(levels: &[V1Level], current: i64) -> usize {
    levels
        .iter()
        .position(|l| l.idx == current)
        .or_else(|| levels.iter().rposition(|l| l.idx < current))
        .unwrap_or(0)
}

fn structure(levels: &[V1Level]) -> Vec<Level> {
    levels
        .iter()
        .map(|level| {
            let duration_ms = level
                .duration_seconds
                .saturating_mul(1000)
                .clamp(1000, MAX_LEVEL_MS);
            if level.is_break {
                return Level::Break {
                    duration_ms,
                    color_up: None,
                };
            }
            let bb = level.big_blind.max(1);
            let ante = if level.ante > 0 {
                Ante::Classic {
                    amount: Chips(level.ante),
                }
            } else {
                Ante::None
            };
            Level::Play {
                sb: Chips(level.small_blind.clamp(1, bb)),
                bb: Chips(bb),
                ante,
                duration_ms,
            }
        })
        .collect()
}

fn config(v1: &V1Tournament, levels: &[V1Level]) -> Config {
    let (min_seats, max_seats) = SEATS_RANGE;
    let (min_tables, max_tables) = TABLES_RANGE;
    let seats = v1
        .seats_per_table
        .clamp(i64::from(min_seats), i64::from(max_seats)) as u8;
    let highest_table = v1
        .players
        .iter()
        .filter_map(|p| p.seat.map(|(table, _)| table))
        .max()
        .unwrap_or(0);
    let tables = v1
        .tables_count
        .max(highest_table)
        .clamp(i64::from(min_tables), i64::from(max_tables)) as u16;
    let mut name: String = name::clean(&v1.name)
        .chars()
        .take(MAX_TOURNAMENT_NAME)
        .collect();
    if name.is_empty() {
        name = "Imported tournament".to_owned();
    }
    let mut config = Config::new(&name, seats, tables, LEGACY_STARTING_STACK);
    config.places_paid = v1.itm_count.clamp(1, i64::from(u16::MAX)) as u16;
    config.late_reg = late_reg(v1, levels);
    config
}

/// The late registration deadline. The previous version closed registration once the
/// clock was past the level at `late_reg_end_level` (an index counting breaks); a
/// disabled late registration becomes manual and is closed after the import.
fn late_reg(v1: &V1Tournament, levels: &[V1Level]) -> Deadline {
    if !v1.late_reg_enabled {
        return Deadline::Manual;
    }
    if let Some(end) = v1.late_reg_end_level {
        let open: Vec<&V1Level> = levels.iter().filter(|l| l.idx <= end).collect();
        let plays = open.iter().filter(|l| !l.is_break).count();
        let total = levels.iter().filter(|l| !l.is_break).count();
        return Deadline::EndOfPlayLevel {
            n: plays.clamp(1, total.max(1)) as u16,
            through_break: plays > 0 && open.last().is_some_and(|l| l.is_break),
        };
    }
    if let Some(seconds) = v1.late_reg_end_time_seconds {
        return Deadline::Elapsed {
            ms: seconds.saturating_mul(1000).clamp(1, MAX_LATE_REG_MS),
        };
    }
    Deadline::Manual
}

fn player_name(player: &V1Player) -> String {
    let name: String = name::clean(&player.name)
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    if name.is_empty() {
        format!("Player {}", player.id)
    } else {
        name
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::store::tests::V1_SCHEMA;
    use mtt_core::Phase;
    use mtt_core::view::{PhaseName, View};

    /// A version 1 database: an old tournament, then the one to import. Levels: 25/50,
    /// 50/100, break, 100/200 ante 25, 150/300 ante 25, 200/400 ante 50. Three tables of
    /// six, table 3 closed; late registration through level index 3; the clock on level
    /// index 4 with 250 s left. Dave, Bob and Grace were eliminated in that order.
    pub(crate) fn write_fixture(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(V1_SCHEMA).unwrap();
        conn.execute_batch(
            "
            INSERT INTO tournaments (id, name, tables_count, seats_per_table, itm_count,
                late_reg_enabled, late_reg_end_level, late_reg_end_time_seconds, status,
                current_level_index, clock_state, clock_remaining_seconds, created_at)
            VALUES
                (1, 'Old', 1, 9, 1, 0, NULL, NULL, 'setup', 0, 'paused', 600, 1600000000),
                (2, '  Friday   Freezeout ', 3, 6, 3, 1, 3, NULL, 'running', 4, 'running',
                 250, 1700000000);

            INSERT INTO levels (tournament_id, idx, duration_seconds, small_blind, big_blind,
                ante, is_break, label)
            VALUES
                (1, 0, 600, 10, 20, 0, 0, 'L1'),
                (2, 0, 600, 25, 50, 0, 0, 'L1'),
                (2, 1, 600, 50, 100, 0, 0, 'L2'),
                (2, 2, 300, 0, 0, 0, 1, 'Break'),
                (2, 3, 600, 100, 200, 25, 0, 'L3'),
                (2, 4, 600, 150, 300, 25, 0, 'L4'),
                (2, 5, 600, 200, 400, 50, 0, 'L5');

            INSERT INTO tables (id, tournament_id, table_no, is_closed)
            VALUES (1, 1, 1, 0), (2, 2, 1, 0), (3, 2, 2, 0), (4, 2, 3, 1);

            INSERT INTO players (id, tournament_id, name, status, registered_at, eliminated_at)
            VALUES
                (1, 1, 'Zed', 'active', 1600000001, NULL),
                (2, 2, 'Alice', 'active', 1700000001, NULL),
                (3, 2, 'Bob', 'eliminated', 1700000002, 1700001000),
                (4, 2, 'Carol', 'active', 1700000003, NULL),
                (5, 2, 'Dave', 'eliminated', 1700000004, 1700000500),
                (6, 2, 'Eve', 'active', 1700000005, NULL),
                (7, 2, 'Frank', 'active', 1700000006, NULL),
                (8, 2, 'Grace', 'eliminated', 1700000007, 1700002000),
                (9, 2, 'Heidi', 'active', 1700000008, NULL);

            INSERT INTO seats (table_id, seat_no, player_id)
            VALUES
                (1, 1, 1),
                (2, 1, NULL), (2, 2, 2), (2, 3, NULL), (2, 4, NULL), (2, 5, 4), (2, 6, NULL),
                (3, 1, 6), (3, 2, NULL), (3, 3, NULL), (3, 4, 7), (3, 5, NULL), (3, 6, 9),
                (4, 1, NULL), (4, 2, NULL), (4, 3, NULL), (4, 4, NULL), (4, 5, NULL),
                (4, 6, NULL);
            ",
        )
        .unwrap();
    }

    fn counter() -> impl FnMut() -> Result<Ctx, EngineError> {
        let mut seed = 0;
        move || {
            seed += 1;
            Ok(Ctx::new(1_800_000_000_000, seed))
        }
    }

    fn import(path: &Path) -> Aggregate {
        let v1 = read(path).unwrap().expect("a tournament to import");
        rebuild(&v1, TournamentId("imported".into()), counter()).unwrap()
    }

    fn row<'a>(view: &'a View, name: &str) -> &'a mtt_core::view::RankingRow {
        view.ranking.iter().find(|r| r.name == name).unwrap()
    }

    #[test]
    fn the_latest_tournament_is_rebuilt_with_its_seats_busts_and_clock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mtt.sqlite");
        write_fixture(&path);
        assert!(available(&path));

        let agg = import(&path);
        let view = agg.view(1_800_000_000_000);

        assert_eq!(view.phase, PhaseName::Running);
        assert_eq!(view.config.name, "Friday Freezeout");
        assert_eq!(
            (view.config.seats_per_table, view.config.max_tables),
            (6, 3)
        );
        assert_eq!(view.config.places_paid, 3);
        assert_eq!(view.places_paid, 3);
        assert_eq!(
            view.config.late_reg,
            Deadline::EndOfPlayLevel {
                n: 3,
                through_break: false
            }
        );
        assert_eq!(view.levels.len(), 6);
        assert_eq!(
            view.levels[3].level,
            Level::Play {
                sb: Chips(100),
                bb: Chips(200),
                ante: Ante::Classic { amount: Chips(25) },
                duration_ms: 600_000,
            }
        );
        assert!(view.levels[2].level.is_break());

        assert_eq!(view.clock.level_index, 4);
        assert_eq!(view.clock.remaining_ms, 250_000);
        assert!(!view.clock.running);
        assert!(!view.registration.open, "closed after level index 3");

        assert_eq!((view.counts.unique, view.counts.alive), (8, 5));
        for (name, table, seat) in [
            ("Alice", 1, 2),
            ("Carol", 1, 5),
            ("Eve", 2, 1),
            ("Frank", 2, 4),
            ("Heidi", 2, 6),
        ] {
            let player = row(&view, name);
            assert!(player.alive, "{name}");
            assert_eq!(player.seat, Some(SeatRef::new(table, seat)), "{name}");
        }
        for (name, place) in [("Dave", 8), ("Bob", 7), ("Grace", 6)] {
            let player = row(&view, name);
            assert!(!player.alive, "{name}");
            assert_eq!(player.place, Some(place), "{name}");
        }
        assert!(view.ranking.iter().all(|r| r.name != "Zed"));
        let table3 = view.tables.iter().find(|t| t.table == TableNo(3)).unwrap();
        assert_eq!(table3.status, TableStatus::Idle);

        // Nothing is left to redo or out of place: the log replays to the same tournament.
        let replayed = Aggregate::from_log(agg.events().to_vec(), agg.head()).unwrap();
        assert_eq!(replayed, agg);
    }

    /// Two tables of two, table 2 closed, one player left: the eliminated players do not
    /// all fit at once, and late registration was disabled.
    #[test]
    fn a_crowded_finished_tournament_is_rebuilt_in_elimination_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mtt.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(V1_SCHEMA).unwrap();
        conn.execute_batch(
            "
            INSERT INTO tournaments (id, name, tables_count, seats_per_table, itm_count,
                late_reg_enabled, status, current_level_index, clock_state,
                clock_remaining_seconds, created_at)
            VALUES (1, 'Heads-up', 2, 2, 2, 0, 'finished', 0, 'paused', 100, 0);
            INSERT INTO levels (tournament_id, idx, duration_seconds, small_blind, big_blind,
                ante, is_break, label)
            VALUES (1, 0, 600, 25, 50, 0, 0, 'L1'), (1, 1, 600, 50, 100, 0, 0, 'L2');
            INSERT INTO tables (id, tournament_id, table_no, is_closed)
            VALUES (1, 1, 1, 0), (2, 1, 2, 1);
            INSERT INTO players (id, tournament_id, name, status, registered_at, eliminated_at)
            VALUES
                (1, 1, 'Ann', 'active', 1, NULL),
                (2, 1, 'Ben', 'eliminated', 2, 300),
                (3, 1, 'Cid', 'eliminated', 3, 100),
                (4, 1, 'ann ', 'eliminated', 4, 200),
                (5, 1, 'Eli', 'eliminated', 5, 400);
            INSERT INTO seats (table_id, seat_no, player_id)
            VALUES (1, 1, NULL), (1, 2, 1), (2, 1, NULL), (2, 2, NULL);
            ",
        )
        .unwrap();
        drop(conn);

        let agg = import(&path);
        let view = agg.view(1_800_000_000_000);

        assert_eq!(view.phase, PhaseName::Finished);
        let ann = row(&view, "Ann");
        assert_eq!(view.winner, Some(ann.player));
        assert_eq!(ann.seat, Some(SeatRef::new(1, 2)));
        // The duplicate name is kept apart.
        for (name, place) in [("Cid", 5), ("ann (2)", 4), ("Ben", 3), ("Eli", 2)] {
            assert_eq!(row(&view, name).place, Some(place), "{name}");
        }
        let table2 = view.tables.iter().find(|t| t.table == TableNo(2)).unwrap();
        assert_eq!(table2.status, TableStatus::Closed);
        assert_eq!(view.clock.remaining_ms, 100_000);
        assert!(matches!(agg.state().phase, Phase::Finished { .. }));
    }

    #[test]
    fn late_registration_maps_level_indexes_to_play_levels() {
        let level = |idx, is_break| V1Level {
            idx,
            duration_seconds: 600,
            small_blind: 25,
            big_blind: 50,
            ante: 0,
            is_break,
        };
        let levels = [
            level(0, false),
            level(1, false),
            level(2, true),
            level(3, false),
        ];
        let v1 = |end: Option<i64>, seconds: Option<i64>, enabled: bool| V1Tournament {
            name: "T".into(),
            tables_count: 1,
            seats_per_table: 9,
            itm_count: 1,
            late_reg_enabled: enabled,
            late_reg_end_level: end,
            late_reg_end_time_seconds: seconds,
            status: "setup".into(),
            current_level_index: 0,
            clock_remaining_seconds: 600,
            levels: levels.to_vec(),
            players: Vec::new(),
            closed_tables: BTreeSet::new(),
        };
        let play = |n, through_break| Deadline::EndOfPlayLevel { n, through_break };
        assert_eq!(late_reg(&v1(Some(1), None, true), &levels), play(2, false));
        assert_eq!(late_reg(&v1(Some(2), None, true), &levels), play(2, true));
        assert_eq!(late_reg(&v1(Some(9), None, true), &levels), play(3, false));
        assert_eq!(late_reg(&v1(Some(-1), None, true), &levels), play(1, false));
        assert_eq!(
            late_reg(&v1(None, Some(3600), true), &levels),
            Deadline::Elapsed { ms: 3_600_000 }
        );
        assert_eq!(late_reg(&v1(None, None, true), &levels), Deadline::Manual);
        assert_eq!(
            late_reg(&v1(Some(1), None, false), &levels),
            Deadline::Manual
        );
    }

    #[test]
    fn a_missing_or_empty_database_has_nothing_to_import() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing.sqlite");
        assert!(!available(&missing));
        assert_eq!(read(&missing).unwrap(), None);
        assert!(!missing.exists(), "a read-only open never creates the file");

        let empty = dir.path().join("empty.sqlite");
        Connection::open(&empty)
            .unwrap()
            .execute_batch(V1_SCHEMA)
            .unwrap();
        assert!(!available(&empty));
        assert_eq!(read(&empty).unwrap(), None);

        let foreign = dir.path().join("foreign.sqlite");
        Connection::open(&foreign)
            .unwrap()
            .execute_batch("CREATE TABLE other (x INTEGER)")
            .unwrap();
        assert!(!available(&foreign));
        assert!(read(&foreign).is_err());
    }
}
