//! SQLite persistence: one row per tournament and its event log, one row per event.
//!
//! The database only stores what the core decided: envelopes as JSON and the undo cursor as
//! an `undone` flag on the undone suffix. Every write runs in a single transaction.

use std::path::Path;

use mtt_core::event::upcast;
use mtt_core::{Aggregate, EVENT_VERSION, Envelope, LogError, Outcome, Seq, TournamentId};
use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::error::EngineError;

/// A migration brings the schema from the previous version to its own.
type Migration = fn(&Transaction) -> rusqlite::Result<()>;

/// Schema versions, in order. Version 1 is the relational schema of the first releases:
/// it is never created any more, only moved out of the way by version 2.
const MIGRATIONS: &[(i64, Migration)] = &[(2, event_logs)];

/// Tables of schema version 1, children first.
const V1_TABLES: [&str; 6] = [
    "seats",
    "players",
    "tables",
    "levels",
    "events",
    "tournaments",
];

const EVENT_LOG_SCHEMA: &str = "
    CREATE TABLE tournaments (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE events (
        tournament_id TEXT NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        envelope TEXT NOT NULL,
        undone INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tournament_id, seq)
    );
";

/// Version 2: event logs. The tables of version 1, left by a build of the previous backend
/// in the same data directory, are kept under a `v1_` prefix since two of their names are
/// reused.
fn event_logs(tx: &Transaction) -> rusqlite::Result<()> {
    for table in V1_TABLES {
        if table_exists(tx, table)? {
            tx.execute_batch(&format!("ALTER TABLE {table} RENAME TO v1_{table}"))?;
        }
    }
    tx.execute_batch(EVENT_LOG_SCHEMA)
}

fn table_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [name],
        |row| row.get(0),
    )
}

/// A stored tournament, without its log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TournamentRow {
    pub id: TournamentId,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// The database of the data directory.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Opens (or creates) the database at `path` and brings its schema up to date.
    pub fn open(path: &Path) -> Result<Self, EngineError> {
        Self::init(Connection::open(path)?)
    }

    fn init(conn: Connection) -> Result<Self, EngineError> {
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let mut store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<(), EngineError> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)",
        )?;
        let current = self.schema_version()?;
        let latest = MIGRATIONS.last().map_or(0, |(version, _)| *version);
        if current > latest {
            return Err(EngineError::host(format!(
                "the database was written by a newer version of the app (schema {current}, \
                 this version reads up to {latest})"
            )));
        }
        for (version, migrate) in MIGRATIONS.iter().filter(|(v, _)| *v > current) {
            let tx = self.conn.transaction()?;
            migrate(&tx)?;
            tx.execute(
                "INSERT INTO schema_migrations (version) VALUES (?1)",
                [version],
            )?;
            tx.commit()?;
        }
        Ok(())
    }

    /// Latest applied schema version, 0 for a new database.
    pub fn schema_version(&self) -> Result<i64, EngineError> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?)
    }

    /// Every tournament, most recently updated first.
    pub fn tournaments(&self) -> Result<Vec<TournamentRow>, EngineError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, created_at_ms, updated_at_ms FROM tournaments
             ORDER BY updated_at_ms DESC, created_at_ms DESC, id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TournamentRow {
                id: TournamentId(row.get(0)?),
                created_at_ms: row.get(1)?,
                updated_at_ms: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// True when tournament `id` is stored.
    pub fn contains(&self, id: &str) -> Result<bool, EngineError> {
        Ok(self
            .conn
            .query_row("SELECT 1 FROM tournaments WHERE id = ?1", [id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    /// Rebuilds tournament `id` from its log, `None` when it is not stored.
    pub fn load(&self, id: &str) -> Result<Option<Aggregate>, EngineError> {
        if !self.contains(id)? {
            return Ok(None);
        }
        let mut stmt = self.conn.prepare(
            "SELECT seq, envelope, undone FROM events WHERE tournament_id = ?1 ORDER BY seq",
        )?;
        let rows = stmt.query_map([id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
            ))
        })?;
        let mut events = Vec::new();
        let mut head = 0;
        for row in rows {
            let (seq, json, undone) = row?;
            if !undone {
                if head != events.len() {
                    return Err(LogError::Inconsistent {
                        seq: seq as u64,
                        reason: "active event after an undone one".to_owned(),
                    }
                    .into());
                }
                head += 1;
            }
            events.push(parse_envelope(&json)?);
        }
        Ok(Some(Aggregate::from_log(events, head)?))
    }

    /// Stores a new tournament with its whole log.
    pub fn insert(&mut self, agg: &Aggregate, now_ms: i64) -> Result<(), EngineError> {
        let id = &agg.state().id;
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO tournaments (id, name, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?3)",
            params![id.0, agg.state().config.name, now_ms],
        )?;
        for (i, envelope) in agg.events().iter().enumerate() {
            insert_event(&tx, id, envelope, i >= agg.head())?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Persists what a dispatch on tournament `agg` (the aggregate after the dispatch)
    /// changed.
    pub fn record(
        &mut self,
        agg: &Aggregate,
        outcome: &Outcome,
        now_ms: i64,
    ) -> Result<(), EngineError> {
        let id = &agg.state().id;
        let tx = self.conn.transaction()?;
        match outcome {
            Outcome::Recorded { envelope, .. } => {
                // Drops the undone suffix that the new event replaces.
                tx.execute(
                    "DELETE FROM events WHERE tournament_id = ?1 AND seq >= ?2",
                    params![id.0, seq_value(envelope.seq)?],
                )?;
                insert_event(&tx, id, envelope, false)?;
            }
            Outcome::Undone { seq } => set_undone(&tx, id, *seq, true)?,
            Outcome::Redone { seq } => set_undone(&tx, id, *seq, false)?,
        }
        let updated = tx.execute(
            "UPDATE tournaments SET name = ?2, updated_at_ms = ?3 WHERE id = ?1",
            params![id.0, agg.state().config.name, now_ms],
        )?;
        if updated != 1 {
            return Err(EngineError::not_found(&id.0));
        }
        tx.commit()?;
        Ok(())
    }

    /// Deletes a tournament and its log. False when it was not stored.
    pub fn delete(&mut self, id: &str) -> Result<bool, EngineError> {
        Ok(self
            .conn
            .execute("DELETE FROM tournaments WHERE id = ?1", [id])?
            == 1)
    }

    #[cfg(test)]
    pub(crate) fn connection(&self) -> &Connection {
        &self.conn
    }
}

fn seq_value(seq: Seq) -> Result<i64, EngineError> {
    i64::try_from(seq.0)
        .map_err(|_| EngineError::host(format!("event number {} is too large", seq.0)))
}

fn insert_event(
    tx: &Transaction,
    id: &TournamentId,
    envelope: &Envelope,
    undone: bool,
) -> Result<(), EngineError> {
    let json = serde_json::to_string(envelope).map_err(EngineError::host)?;
    tx.execute(
        "INSERT INTO events (tournament_id, seq, envelope, undone) VALUES (?1, ?2, ?3, ?4)",
        params![id.0, seq_value(envelope.seq)?, json, undone],
    )?;
    Ok(())
}

fn set_undone(
    tx: &Transaction,
    id: &TournamentId,
    seq: Seq,
    undone: bool,
) -> Result<(), EngineError> {
    let changed = tx.execute(
        "UPDATE events SET undone = ?3 WHERE tournament_id = ?1 AND seq = ?2 AND undone = ?4",
        params![id.0, seq_value(seq)?, undone, !undone],
    )?;
    if changed != 1 {
        return Err(EngineError::host(format!(
            "the stored log of {} is out of sync at event {}",
            id.0, seq.0
        )));
    }
    Ok(())
}

/// Reads a stored envelope, upcasting one written by an older version of the core.
fn parse_envelope(json: &str) -> Result<Envelope, LogError> {
    let malformed = |err: serde_json::Error| LogError::Malformed {
        message: err.to_string(),
    };
    let raw: serde_json::Value = serde_json::from_str(json).map_err(malformed)?;
    let v = raw
        .get("v")
        .and_then(serde_json::Value::as_u64)
        .map_or(0, |v| u16::try_from(v).unwrap_or(u16::MAX));
    if v > EVENT_VERSION {
        return Err(LogError::UnsupportedVersion {
            v,
            max: EVENT_VERSION,
        });
    }
    serde_json::from_value(upcast(raw, v)).map_err(malformed)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use mtt_core::{Command, Config, Ctx, Level, NewTournament};

    /// Schema version 1, as created by the first releases (commit 6b16e96).
    pub(crate) const V1_SCHEMA: &str = "
        CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);

        CREATE TABLE IF NOT EXISTS tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            tables_count INTEGER NOT NULL,
            seats_per_table INTEGER NOT NULL,
            itm_count INTEGER NOT NULL,
            late_reg_enabled INTEGER NOT NULL,
            late_reg_end_level INTEGER,
            late_reg_end_time_seconds INTEGER,
            status TEXT NOT NULL,
            current_level_index INTEGER NOT NULL,
            clock_state TEXT NOT NULL,
            clock_remaining_seconds INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            name TEXT NOT NULL COLLATE NOCASE,
            status TEXT NOT NULL,
            registered_at INTEGER NOT NULL,
            eliminated_at INTEGER,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            table_no INTEGER NOT NULL,
            is_closed INTEGER NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS seats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id INTEGER NOT NULL,
            seat_no INTEGER NOT NULL,
            player_id INTEGER,
            FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            idx INTEGER NOT NULL,
            duration_seconds INTEGER NOT NULL,
            small_blind INTEGER NOT NULL,
            big_blind INTEGER NOT NULL,
            ante INTEGER NOT NULL,
            is_break INTEGER NOT NULL,
            label TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_players_unique_name ON players (tournament_id, name);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_unique_table_no ON tables (tournament_id, table_no);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_seats_unique ON seats (table_id, seat_no);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_seat_player_unique ON seats (player_id) WHERE player_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_players_status ON players (tournament_id, status);
        CREATE INDEX IF NOT EXISTS idx_events_tournament ON events (tournament_id, created_at);

        INSERT INTO schema_migrations (version) VALUES (1);
    ";

    fn new_tournament(id: &str) -> Aggregate {
        let new = NewTournament {
            id: TournamentId(id.into()),
            config: Config::new("Store test", 9, 2, 10_000),
            structure: vec![Level::Play {
                sb: mtt_core::Chips(25),
                bb: mtt_core::Chips(50),
                ante: mtt_core::Ante::None,
                duration_ms: 600_000,
            }],
        };
        Aggregate::create(new, &Ctx::new(1_000, 1)).unwrap()
    }

    fn register(agg: &mut Aggregate, name: &str) -> Outcome {
        let cmd = Command::Register {
            name: name.into(),
            seat: None,
        };
        agg.dispatch(cmd, &Ctx::new(2_000, 7)).unwrap()
    }

    fn table_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn a_new_database_gets_the_event_log_schema() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("mtt.sqlite")).unwrap();
        assert_eq!(store.schema_version().unwrap(), 2);
        assert_eq!(
            table_names(store.connection()),
            ["events", "schema_migrations", "tournaments"]
        );
    }

    #[test]
    fn a_version_1_database_keeps_its_tables_under_a_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mtt.sqlite");
        let v1 = Connection::open(&path).unwrap();
        v1.execute_batch(V1_SCHEMA).unwrap();
        v1.execute_batch(
            "INSERT INTO tournaments (name, tables_count, seats_per_table, itm_count,
                 late_reg_enabled, status, current_level_index, clock_state,
                 clock_remaining_seconds, created_at)
             VALUES ('Old', 1, 9, 1, 0, 'setup', 0, 'paused', 600, 0);
             INSERT INTO players (tournament_id, name, status, registered_at)
             VALUES (1, 'Alice', 'active', 0);",
        )
        .unwrap();
        drop(v1);

        let mut store = Store::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), 2);
        let names = table_names(store.connection());
        for table in V1_TABLES {
            assert!(names.contains(&format!("v1_{table}")), "{names:?}");
        }
        let kept: String = store
            .connection()
            .query_row(
                "SELECT p.name FROM v1_players p JOIN v1_tournaments t ON t.id = p.tournament_id",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(kept, "Alice");
        assert!(store.tournaments().unwrap().is_empty());

        store.insert(&new_tournament("t1"), 5).unwrap();
        drop(store);
        let store = Store::open(&path).unwrap();
        assert_eq!(store.tournaments().unwrap().len(), 1);
    }

    #[test]
    fn a_database_from_a_newer_version_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mtt.sqlite");
        drop(Store::open(&path).unwrap());
        Connection::open(&path)
            .unwrap()
            .execute("INSERT INTO schema_migrations (version) VALUES (99)", [])
            .unwrap();
        let err = Store::open(&path).err().unwrap();
        assert!(err.to_string().contains("HOST_ERROR"), "{err}");
    }

    #[test]
    fn the_log_and_its_cursor_survive_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mtt.sqlite");
        let mut store = Store::open(&path).unwrap();
        let mut agg = new_tournament("t1");
        store.insert(&agg, 10).unwrap();
        for name in ["A", "B", "C"] {
            let outcome = register(&mut agg, name);
            store.record(&agg, &outcome, 20).unwrap();
        }
        for _ in 0..2 {
            let outcome = agg.dispatch(Command::Undo {}, &Ctx::new(3_000, 0)).unwrap();
            store.record(&agg, &outcome, 30).unwrap();
        }
        let outcome = agg.dispatch(Command::Redo {}, &Ctx::new(3_000, 0)).unwrap();
        store.record(&agg, &outcome, 40).unwrap();
        assert_eq!(store.load("t1").unwrap().as_ref(), Some(&agg));

        // A new command drops the undone event.
        let outcome = register(&mut agg, "D");
        store.record(&agg, &outcome, 50).unwrap();
        drop(store);
        let store = Store::open(&path).unwrap();
        assert_eq!(store.load("t1").unwrap().as_ref(), Some(&agg));
        assert_eq!(store.load("missing").unwrap(), None);
        let rows = store.tournaments().unwrap();
        assert_eq!(
            rows,
            [TournamentRow {
                id: TournamentId("t1".into()),
                created_at_ms: 10,
                updated_at_ms: 50,
            }]
        );
    }

    #[test]
    fn deleting_a_tournament_deletes_its_log() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("mtt.sqlite")).unwrap();
        store.insert(&new_tournament("t1"), 1).unwrap();
        store.insert(&new_tournament("t2"), 2).unwrap();
        assert!(store.delete("t1").unwrap());
        assert!(!store.delete("t1").unwrap());
        let count: i64 = store
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM events WHERE tournament_id = 't1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        assert!(store.load("t2").unwrap().is_some());
    }

    #[test]
    fn a_log_written_by_a_newer_core_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("mtt.sqlite")).unwrap();
        store.insert(&new_tournament("t1"), 1).unwrap();
        store
            .connection()
            .execute(
                "UPDATE events SET envelope = json_set(envelope, '$.v', 99)",
                [],
            )
            .unwrap();
        let err = store.load("t1").unwrap_err();
        assert!(err.to_string().contains("UNSUPPORTED_VERSION"), "{err}");
    }
}
