#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rand::seq::SliceRandom;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[derive(Clone)]
struct AppState {
    db_path: PathBuf,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Tournament {
    id: i64,
    name: String,
    tables_count: i64,
    seats_per_table: i64,
    itm_count: i64,
    late_reg_enabled: bool,
    late_reg_end_level: Option<i64>,
    late_reg_end_time_seconds: Option<i64>,
    status: String,
    current_level_index: i64,
    clock_state: String,
    clock_remaining_seconds: i64,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Player {
    id: i64,
    tournament_id: i64,
    name: String,
    status: String,
    registered_at: i64,
    eliminated_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Table {
    id: i64,
    tournament_id: i64,
    table_no: i64,
    is_closed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Seat {
    id: i64,
    table_id: i64,
    seat_no: i64,
    player_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Level {
    id: i64,
    tournament_id: i64,
    index: i64,
    duration_seconds: i64,
    small_blind: i64,
    big_blind: i64,
    ante: i64,
    is_break: bool,
    label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct StateSnapshot {
    tournament: Option<Tournament>,
    players: Vec<Player>,
    tables: Vec<Table>,
    seats: Vec<Seat>,
    levels: Vec<Level>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct TournamentConfig {
    name: String,
    tables_count: i64,
    seats_per_table: i64,
    itm_count: i64,
    late_reg_enabled: bool,
    late_reg_end_level: Option<i64>,
    late_reg_end_time_seconds: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct LevelDraft {
    index: i64,
    duration_seconds: i64,
    small_blind: i64,
    big_blind: i64,
    ante: i64,
    is_break: bool,
    label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct MoveSuggestion {
    player_id: i64,
    from_seat_id: i64,
    to_seat_id: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct JoinPlayerPayload {
    player_id: i64,
    seat_id: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct EliminatePlayerPayload {
    player_id: i64,
    seat_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct MovePlayerPayload {
    player_id: i64,
    from_seat_id: i64,
    to_seat_id: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ClockPayload {
    from_level_index: i64,
    to_level_index: i64,
    from_remaining_seconds: i64,
    to_remaining_seconds: i64,
    from_state: String,
    to_state: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct UpdateItmPayload {
    previous_itm_count: i64,
    new_itm_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct CloseTablePayload {
    table_id: i64,
    moves: Vec<CloseMove>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct CloseMove {
    player_id: i64,
    from_seat_id: i64,
    to_seat_id: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct UndoPayload {
    event_id: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct RevivePlayerPayload {
    player_id: i64,
    seat_id: i64,
    previous_eliminated_at: Option<i64>,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn open_connection(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    conn.execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|err| err.to_string())?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)",
        [],
    )
    .map_err(|err| err.to_string())?;

    let version: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;

    if version.unwrap_or(0) < 1 {
        conn.execute_batch(
            "
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
        ",
        )
        .map_err(|err| err.to_string())?;

        conn.execute("INSERT INTO schema_migrations (version) VALUES (1)", [])
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

fn fetch_tournament(conn: &Connection) -> Result<Option<Tournament>, String> {
    conn.query_row(
        "SELECT * FROM tournaments ORDER BY id DESC LIMIT 1",
        [],
        |row| {
            Ok(Tournament {
                id: row.get("id")?,
                name: row.get("name")?,
                tables_count: row.get("tables_count")?,
                seats_per_table: row.get("seats_per_table")?,
                itm_count: row.get("itm_count")?,
                late_reg_enabled: row.get::<_, i64>("late_reg_enabled")? == 1,
                late_reg_end_level: row.get("late_reg_end_level")?,
                late_reg_end_time_seconds: row.get("late_reg_end_time_seconds")?,
                status: row.get("status")?,
                current_level_index: row.get("current_level_index")?,
                clock_state: row.get("clock_state")?,
                clock_remaining_seconds: row.get("clock_remaining_seconds")?,
                created_at: row.get("created_at")?,
            })
        },
    )
    .optional()
    .map_err(|err| err.to_string())
}

fn fetch_players(conn: &Connection, tournament_id: i64) -> Result<Vec<Player>, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM players WHERE tournament_id = ? ORDER BY name ASC")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([tournament_id], |row| {
            Ok(Player {
                id: row.get("id")?,
                tournament_id: row.get("tournament_id")?,
                name: row.get("name")?,
                status: row.get("status")?,
                registered_at: row.get("registered_at")?,
                eliminated_at: row.get("eliminated_at")?,
            })
        })
        .map_err(|err| err.to_string())?;

    let mut players = Vec::new();
    for row in rows {
        players.push(row.map_err(|err| err.to_string())?);
    }
    Ok(players)
}

fn fetch_tables(conn: &Connection, tournament_id: i64) -> Result<Vec<Table>, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM tables WHERE tournament_id = ? ORDER BY table_no ASC")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([tournament_id], |row| {
            Ok(Table {
                id: row.get("id")?,
                tournament_id: row.get("tournament_id")?,
                table_no: row.get("table_no")?,
                is_closed: row.get::<_, i64>("is_closed")? == 1,
            })
        })
        .map_err(|err| err.to_string())?;

    let mut tables = Vec::new();
    for row in rows {
        tables.push(row.map_err(|err| err.to_string())?);
    }
    Ok(tables)
}

fn fetch_seats(conn: &Connection, tournament_id: i64) -> Result<Vec<Seat>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT seats.id, seats.table_id, seats.seat_no, seats.player_id
             FROM seats
             JOIN tables ON seats.table_id = tables.id
             WHERE tables.tournament_id = ?",
        )
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map([tournament_id], |row| {
            Ok(Seat {
                id: row.get("id")?,
                table_id: row.get("table_id")?,
                seat_no: row.get("seat_no")?,
                player_id: row.get("player_id")?,
            })
        })
        .map_err(|err| err.to_string())?;

    let mut seats = Vec::new();
    for row in rows {
        seats.push(row.map_err(|err| err.to_string())?);
    }
    Ok(seats)
}

fn fetch_levels(conn: &Connection, tournament_id: i64) -> Result<Vec<Level>, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM levels WHERE tournament_id = ? ORDER BY idx ASC")
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map([tournament_id], |row| {
            Ok(Level {
                id: row.get("id")?,
                tournament_id: row.get("tournament_id")?,
                index: row.get("idx")?,
                duration_seconds: row.get("duration_seconds")?,
                small_blind: row.get("small_blind")?,
                big_blind: row.get("big_blind")?,
                ante: row.get("ante")?,
                is_break: row.get::<_, i64>("is_break")? == 1,
                label: row.get("label")?,
            })
        })
        .map_err(|err| err.to_string())?;

    let mut levels = Vec::new();
    for row in rows {
        levels.push(row.map_err(|err| err.to_string())?);
    }
    Ok(levels)
}

fn fetch_state(conn: &Connection) -> Result<StateSnapshot, String> {
    let tournament = fetch_tournament(conn)?;
    if let Some(tournament) = tournament.clone() {
        Ok(StateSnapshot {
            players: fetch_players(conn, tournament.id)?,
            tables: fetch_tables(conn, tournament.id)?,
            seats: fetch_seats(conn, tournament.id)?,
            levels: fetch_levels(conn, tournament.id)?,
            tournament: Some(tournament),
        })
    } else {
        Ok(StateSnapshot {
            tournament: None,
            players: Vec::new(),
            tables: Vec::new(),
            seats: Vec::new(),
            levels: Vec::new(),
        })
    }
}

fn insert_event_tx(
    tx: &rusqlite::Transaction,
    tournament_id: i64,
    event_type: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO events (tournament_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)",
        params![tournament_id, event_type, payload.to_string(), now_ts()],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit_all("state_updated", ());
}

fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit_all("app_error", message.to_string());
}

fn late_registration_open(conn: &Connection, tournament: &Tournament) -> Result<bool, String> {
    if tournament.status == "setup" {
        return Ok(true);
    }
    if !tournament.late_reg_enabled {
        return Ok(false);
    }
    if let Some(end_level) = tournament.late_reg_end_level {
        if tournament.current_level_index > end_level {
            return Ok(false);
        }
    }
    if let Some(end_time) = tournament.late_reg_end_time_seconds {
        let elapsed = elapsed_seconds(conn, tournament)?;
        if elapsed > end_time {
            return Ok(false);
        }
    }
    Ok(true)
}

fn elapsed_seconds(conn: &Connection, tournament: &Tournament) -> Result<i64, String> {
    let levels = fetch_levels(conn, tournament.id)?;
    let past = levels
        .iter()
        .filter(|level| level.index < tournament.current_level_index)
        .map(|level| level.duration_seconds)
        .sum::<i64>();
    let current_duration = levels
        .iter()
        .find(|level| level.index == tournament.current_level_index)
        .map(|level| level.duration_seconds)
        .unwrap_or(0);
    let elapsed_current = (current_duration - tournament.clock_remaining_seconds).max(0);
    Ok(past + elapsed_current)
}

fn choose_seat(
    conn: &Connection,
    tournament: &Tournament,
    strategy: &str,
) -> Result<Option<Seat>, String> {
    let tables = fetch_tables(conn, tournament.id)?;
    let seats = fetch_seats(conn, tournament.id)?;
    let open_table_ids: Vec<i64> = tables
        .iter()
        .filter(|t| !t.is_closed)
        .map(|t| t.id)
        .collect();
    if open_table_ids.is_empty() {
        return Ok(None);
    }

    let available: Vec<Seat> = seats
        .iter()
        .filter(|seat| seat.player_id.is_none() && open_table_ids.contains(&seat.table_id))
        .cloned()
        .collect();

    if available.is_empty() {
        return Ok(None);
    }

    if strategy == "balanced" {
        let mut counts = std::collections::HashMap::<i64, i64>::new();
        for table_id in &open_table_ids {
            let count = seats
                .iter()
                .filter(|seat| seat.table_id == *table_id && seat.player_id.is_some())
                .count() as i64;
            counts.insert(*table_id, count);
        }
        let min_count = counts.values().min().cloned().unwrap_or(0);
        let candidate_tables: Vec<i64> = counts
            .iter()
            .filter(|(_, count)| **count == min_count)
            .map(|(id, _)| *id)
            .collect();

        let candidates: Vec<Seat> = available
            .iter()
            .filter(|seat| candidate_tables.contains(&seat.table_id))
            .cloned()
            .collect();

        let mut rng = rand::thread_rng();
        return Ok(candidates
            .choose(&mut rng)
            .cloned()
            .or_else(|| available.choose(&mut rng).cloned()));
    }

    let mut rng = rand::thread_rng();
    Ok(available.choose(&mut rng).cloned())
}

fn update_status_after_elimination(conn: &Connection, tournament_id: i64) -> Result<(), String> {
    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM players WHERE tournament_id = ? AND status = 'active'",
            [tournament_id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;

    if remaining <= 1 {
        conn.execute(
            "UPDATE tournaments SET status = 'finished' WHERE id = ?",
            [tournament_id],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn recalculate_status(conn: &Connection, tournament_id: i64) -> Result<(), String> {
    let status: String = conn
        .query_row(
            "SELECT status FROM tournaments WHERE id = ?",
            [tournament_id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;

    if status == "setup" {
        return Ok(());
    }

    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM players WHERE tournament_id = ? AND status = 'active'",
            [tournament_id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;

    if active_count <= 1 {
        conn.execute(
            "UPDATE tournaments SET status = 'finished' WHERE id = ?",
            [tournament_id],
        )
        .map_err(|err| err.to_string())?;
    } else if status == "finished" {
        conn.execute(
            "UPDATE tournaments SET status = 'running' WHERE id = ?",
            [tournament_id],
        )
        .map_err(|err| err.to_string())?;
    }

    Ok(())
}

fn apply_clock_change(
    conn: &mut Connection,
    tournament: &Tournament,
    event_type: &str,
    new_state: &str,
    new_level_index: i64,
    new_remaining: i64,
) -> Result<(), String> {
    let payload = ClockPayload {
        from_level_index: tournament.current_level_index,
        to_level_index: new_level_index,
        from_remaining_seconds: tournament.clock_remaining_seconds,
        to_remaining_seconds: new_remaining,
        from_state: tournament.clock_state.clone(),
        to_state: new_state.to_string(),
    };

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "UPDATE tournaments SET current_level_index = ?, clock_state = ?, clock_remaining_seconds = ?, status = 'running' WHERE id = ?",
        params![new_level_index, new_state, new_remaining, tournament.id],
    )
    .map_err(|err| err.to_string())?;

    insert_event_tx(
        &tx,
        tournament.id,
        event_type,
        serde_json::to_value(payload).unwrap(),
    )?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_state(state: State<AppState>) -> Result<StateSnapshot, String> {
    let conn = open_connection(&state.db_path)?;
    fetch_state(&conn)
}

#[tauri::command]
fn create_tournament(
    state: State<AppState>,
    app: AppHandle,
    config: TournamentConfig,
    levels: Vec<LevelDraft>,
) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let mut levels_sorted = levels.clone();
    levels_sorted.sort_by_key(|level| level.index);
    let start_index = levels_sorted.first().map(|level| level.index).unwrap_or(0);
    let start_duration = levels_sorted
        .first()
        .map(|level| level.duration_seconds)
        .unwrap_or(0);

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "INSERT INTO tournaments (name, tables_count, seats_per_table, itm_count, late_reg_enabled, late_reg_end_level, late_reg_end_time_seconds, status, current_level_index, clock_state, clock_remaining_seconds, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'setup', ?, 'paused', ?, ?)",
        params![
            config.name.trim(),
            config.tables_count,
            config.seats_per_table,
            config.itm_count,
            if config.late_reg_enabled { 1 } else { 0 },
            config.late_reg_end_level,
            config.late_reg_end_time_seconds,
            start_index,
            start_duration,
            now_ts()
        ],
    )
    .map_err(|err| err.to_string())?;

    let tournament_id = tx.last_insert_rowid();

    for table_no in 1..=config.tables_count {
        tx.execute(
            "INSERT INTO tables (tournament_id, table_no, is_closed) VALUES (?, ?, 0)",
            params![tournament_id, table_no],
        )
        .map_err(|err| err.to_string())?;
        let table_id = tx.last_insert_rowid();
        for seat_no in 1..=config.seats_per_table {
            tx.execute(
                "INSERT INTO seats (table_id, seat_no, player_id) VALUES (?, ?, NULL)",
                params![table_id, seat_no],
            )
            .map_err(|err| err.to_string())?;
        }
    }

    for level in levels_sorted {
        tx.execute(
            "INSERT INTO levels (tournament_id, idx, duration_seconds, small_blind, big_blind, ante, is_break, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                tournament_id,
                level.index,
                level.duration_seconds,
                level.small_blind,
                level.big_blind,
                level.ante,
                if level.is_break { 1 } else { 0 },
                level.label
            ],
        )
        .map_err(|err| err.to_string())?;
    }

    tx.commit().map_err(|err| err.to_string())?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn reset_tournament(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    // Deleting the tournament will cascade delete players, tables, seats, levels, and events
    // due to foreign key constraints with ON DELETE CASCADE in the schema.
    tx.execute(
        "DELETE FROM tournaments WHERE id = ?",
        params![tournament.id],
    )
    .map_err(|err| err.to_string())?;

    tx.commit().map_err(|err| err.to_string())?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn register_player(
    state: State<AppState>,
    app: AppHandle,
    name: String,
    strategy: String,
) -> Result<Seat, String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        emit_error(&app, "Player name is required");
        return Err("Player name is required".into());
    }

    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM players WHERE tournament_id = ? AND name = ? COLLATE NOCASE LIMIT 1",
            params![tournament.id, trimmed],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if existing.is_some() {
        emit_error(&app, "This player name already exists");
        return Err("This player name already exists".into());
    }

    if !late_registration_open(&conn, &tournament)? {
        emit_error(&app, "Late registration is closed");
        return Err("Late registration is closed".into());
    }

    let mut seat = choose_seat(&conn, &tournament, &strategy)?.ok_or("Tournament is full")?;

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "INSERT INTO players (tournament_id, name, status, registered_at, eliminated_at) VALUES (?, ?, 'active', ?, NULL)",
        params![tournament.id, trimmed, now_ts()],
    )
    .map_err(|err| err.to_string())?;
    let player_id = tx.last_insert_rowid();

    tx.execute(
        "UPDATE seats SET player_id = ? WHERE id = ?",
        params![player_id, seat.id],
    )
    .map_err(|err| err.to_string())?;

    let payload = JoinPlayerPayload {
        player_id,
        seat_id: seat.id,
    };
    insert_event_tx(
        &tx,
        tournament.id,
        "JOIN_PLAYER",
        serde_json::to_value(payload).unwrap(),
    )?;
    tx.commit().map_err(|err| err.to_string())?;

    seat.player_id = Some(player_id);
    emit_state(&app);
    Ok(seat)
}

#[tauri::command]
fn register_player_at_seat(
    state: State<AppState>,
    app: AppHandle,
    name: String,
    table_no: i64,
    seat_no: i64,
) -> Result<Seat, String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        emit_error(&app, "Player name is required");
        return Err("Player name is required".into());
    }

    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM players WHERE tournament_id = ? AND name = ? COLLATE NOCASE LIMIT 1",
            params![tournament.id, trimmed],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if existing.is_some() {
        emit_error(&app, "This player name already exists");
        return Err("This player name already exists".into());
    }

    let seat_id: Option<i64> = conn
        .query_row(
            "SELECT seats.id FROM seats JOIN tables ON seats.table_id = tables.id WHERE tables.tournament_id = ? AND tables.table_no = ? AND seats.seat_no = ?",
            params![tournament.id, table_no, seat_no],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;

    let seat_id = match seat_id {
        Some(id) => id,
        None => {
            emit_error(&app, "Seat not found");
            return Err("Seat not found".into());
        }
    };

    let seat_available: Option<i64> = conn
        .query_row(
            "SELECT id FROM seats WHERE id = ? AND player_id IS NULL",
            params![seat_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if seat_available.is_none() {
        emit_error(&app, "Seat is not available");
        return Err("Seat is not available".into());
    }

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "INSERT INTO players (tournament_id, name, status, registered_at, eliminated_at) VALUES (?, ?, 'active', ?, NULL)",
        params![tournament.id, trimmed, now_ts()],
    )
    .map_err(|err| err.to_string())?;
    let player_id = tx.last_insert_rowid();

    tx.execute(
        "UPDATE seats SET player_id = ? WHERE id = ?",
        params![player_id, seat_id],
    )
    .map_err(|err| err.to_string())?;

    let payload = JoinPlayerPayload { player_id, seat_id };
    insert_event_tx(
        &tx,
        tournament.id,
        "JOIN_PLAYER",
        serde_json::to_value(payload).unwrap(),
    )?;
    tx.commit().map_err(|err| err.to_string())?;

    let mut seat = fetch_seats(&conn, tournament.id)?
        .into_iter()
        .find(|s| s.id == seat_id)
        .ok_or("Seat not found")?;
    seat.player_id = Some(player_id);
    emit_state(&app);
    Ok(seat)
}

#[tauri::command]
fn eliminate_player(state: State<AppState>, app: AppHandle, player_id: i64) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;

    let seat_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM seats WHERE player_id = ?",
            [player_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "UPDATE players SET status = 'eliminated', eliminated_at = ? WHERE id = ?",
        params![now_ts(), player_id],
    )
    .map_err(|err| err.to_string())?;

    if let Some(seat_id) = seat_id {
        tx.execute(
            "UPDATE seats SET player_id = NULL WHERE id = ?",
            params![seat_id],
        )
        .map_err(|err| err.to_string())?;
    }

    let payload = EliminatePlayerPayload { player_id, seat_id };
    insert_event_tx(
        &tx,
        tournament.id,
        "ELIMINATE_PLAYER",
        serde_json::to_value(payload).unwrap(),
    )?;
    update_status_after_elimination(&tx, tournament.id)?;
    tx.commit().map_err(|err| err.to_string())?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn revive_player_at_seat(
    state: State<AppState>,
    app: AppHandle,
    player_id: i64,
    table_no: i64,
    seat_no: i64,
) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;

    let (status, eliminated_at): (String, Option<i64>) = conn
        .query_row(
            "SELECT status, eliminated_at FROM players WHERE id = ? AND tournament_id = ?",
            params![player_id, tournament.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|err| err.to_string())?;

    if status != "eliminated" {
        emit_error(&app, "Player is not eliminated");
        return Err("Player is not eliminated".into());
    }

    let seat_id: Option<i64> = conn
        .query_row(
            "SELECT seats.id FROM seats JOIN tables ON seats.table_id = tables.id WHERE tables.tournament_id = ? AND tables.table_no = ? AND seats.seat_no = ?",
            params![tournament.id, table_no, seat_no],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;

    let seat_id = match seat_id {
        Some(id) => id,
        None => {
            emit_error(&app, "Seat not found");
            return Err("Seat not found".into());
        }
    };

    let seat_available: Option<i64> = conn
        .query_row(
            "SELECT id FROM seats WHERE id = ? AND player_id IS NULL",
            params![seat_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if seat_available.is_none() {
        emit_error(&app, "Seat is not available");
        return Err("Seat is not available".into());
    }

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "UPDATE players SET status = 'active', eliminated_at = NULL WHERE id = ?",
        params![player_id],
    )
    .map_err(|err| err.to_string())?;
    tx.execute(
        "UPDATE seats SET player_id = ? WHERE id = ?",
        params![player_id, seat_id],
    )
    .map_err(|err| err.to_string())?;

    let payload = RevivePlayerPayload {
        player_id,
        seat_id,
        previous_eliminated_at: eliminated_at,
    };
    insert_event_tx(
        &tx,
        tournament.id,
        "REVIVE_PLAYER",
        serde_json::to_value(payload).unwrap(),
    )?;
    tx.commit().map_err(|err| err.to_string())?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn move_player(
    state: State<AppState>,
    app: AppHandle,
    player_id: i64,
    to_seat_id: i64,
) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;

    let from_seat_id: i64 = conn
        .query_row(
            "SELECT id FROM seats WHERE player_id = ?",
            [player_id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;

    let target_free: Option<i64> = conn
        .query_row(
            "SELECT id FROM seats WHERE id = ? AND player_id IS NULL",
            [to_seat_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;

    if target_free.is_none() {
        emit_error(&app, "Seat is not available");
        return Err("Seat is not available".into());
    }

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "UPDATE seats SET player_id = NULL WHERE id = ?",
        params![from_seat_id],
    )
    .map_err(|err| err.to_string())?;
    tx.execute(
        "UPDATE seats SET player_id = ? WHERE id = ?",
        params![player_id, to_seat_id],
    )
    .map_err(|err| err.to_string())?;

    let payload = MovePlayerPayload {
        player_id,
        from_seat_id,
        to_seat_id,
    };
    insert_event_tx(
        &tx,
        tournament.id,
        "MOVE_PLAYER",
        serde_json::to_value(payload).unwrap(),
    )?;
    tx.commit().map_err(|err| err.to_string())?;
    emit_state(&app);
    Ok(())
}

fn compute_balance_suggestions(conn: &Connection) -> Result<Vec<MoveSuggestion>, String> {
    let tournament = fetch_tournament(conn)?.ok_or("Tournament not found")?;
    let tables = fetch_tables(conn, tournament.id)?;
    let seats = fetch_seats(conn, tournament.id)?;

    let open_tables: Vec<Table> = tables.into_iter().filter(|t| !t.is_closed).collect();
    if open_tables.len() < 2 {
        return Ok(vec![]);
    }

    let mut counts = std::collections::HashMap::<i64, i64>::new();
    for table in &open_tables {
        let count = seats
            .iter()
            .filter(|seat| seat.table_id == table.id && seat.player_id.is_some())
            .count() as i64;
        counts.insert(table.id, count);
    }

    let mut empty_seats: std::collections::HashMap<i64, Vec<Seat>> =
        std::collections::HashMap::new();
    for table in &open_tables {
        let list = seats
            .iter()
            .filter(|seat| seat.table_id == table.id && seat.player_id.is_none())
            .cloned()
            .collect::<Vec<Seat>>();
        empty_seats.insert(table.id, list);
    }

    let mut suggestions = Vec::new();
    let mut used_from = std::collections::HashSet::<i64>::new();

    loop {
        let mut sorted = counts.iter().collect::<Vec<_>>();
        sorted.sort_by_key(|(_, count)| -(*count));
        let max = sorted.first().cloned();
        let min = sorted.last().cloned();
        if max.is_none() || min.is_none() {
            break;
        }
        let (max_id, max_count) = (*max.unwrap().0, *max.unwrap().1);
        let (min_id, min_count) = (*min.unwrap().0, *min.unwrap().1);
        if max_count - min_count < 2 {
            break;
        }

        let from_seat = seats.iter().find(|seat| {
            seat.table_id == max_id && seat.player_id.is_some() && !used_from.contains(&seat.id)
        });
        let to_seat = empty_seats.get(&min_id).and_then(|list| list.first());
        if from_seat.is_none() || to_seat.is_none() {
            break;
        }
        let from_seat = from_seat.unwrap();
        let to_seat = to_seat.unwrap();

        suggestions.push(MoveSuggestion {
            player_id: from_seat.player_id.unwrap(),
            from_seat_id: from_seat.id,
            to_seat_id: to_seat.id,
        });
        used_from.insert(from_seat.id);

        counts.insert(max_id, max_count - 1);
        counts.insert(min_id, min_count + 1);
        if let Some(list) = empty_seats.get_mut(&min_id) {
            list.remove(0);
        }
    }

    Ok(suggestions)
}

#[tauri::command]
fn balance_suggestions(state: State<AppState>) -> Result<Vec<MoveSuggestion>, String> {
    let conn = open_connection(&state.db_path)?;
    compute_balance_suggestions(&conn)
}

#[tauri::command]
fn close_table(state: State<AppState>, app: AppHandle, table_id: i64) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    let tables = fetch_tables(&conn, tournament.id)?;
    let seats = fetch_seats(&conn, tournament.id)?;
    let target_table = tables
        .iter()
        .find(|table| table.id == table_id)
        .ok_or("Table not found")?;
    if target_table.is_closed {
        return Ok(());
    }

    let seats_in_table: Vec<Seat> = seats
        .iter()
        .filter(|seat| seat.table_id == table_id)
        .cloned()
        .collect();
    let players_to_move: Vec<i64> = seats_in_table
        .iter()
        .filter_map(|seat| seat.player_id)
        .collect();

    let mut available: Vec<Seat> = seats
        .iter()
        .filter(|seat| seat.player_id.is_none() && seat.table_id != table_id)
        .filter(|seat| {
            !tables
                .iter()
                .find(|t| t.id == seat.table_id)
                .map(|t| t.is_closed)
                .unwrap_or(true)
        })
        .cloned()
        .collect();

    if available.len() < players_to_move.len() {
        emit_error(&app, "Not enough seats to close table");
        return Err("Not enough seats to close table".into());
    }

    let mut rng = rand::thread_rng();
    available.shuffle(&mut rng);

    let mut moves = Vec::new();
    for seat in seats_in_table
        .iter()
        .filter(|seat| seat.player_id.is_some())
    {
        let target = available.pop().unwrap();
        moves.push(CloseMove {
            player_id: seat.player_id.unwrap(),
            from_seat_id: seat.id,
            to_seat_id: target.id,
        });
    }

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    for mv in &moves {
        tx.execute(
            "UPDATE seats SET player_id = NULL WHERE id = ?",
            params![mv.from_seat_id],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE seats SET player_id = ? WHERE id = ?",
            params![mv.player_id, mv.to_seat_id],
        )
        .map_err(|err| err.to_string())?;
    }
    tx.execute(
        "UPDATE tables SET is_closed = 1 WHERE id = ?",
        params![table_id],
    )
    .map_err(|err| err.to_string())?;

    let payload = CloseTablePayload { table_id, moves };
    insert_event_tx(
        &tx,
        tournament.id,
        "CLOSE_TABLE",
        serde_json::to_value(payload).unwrap(),
    )?;
    tx.commit().map_err(|err| err.to_string())?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn clock_start(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    if tournament.clock_state == "running" {
        return Ok(());
    }
    apply_clock_change(
        &mut conn,
        &tournament,
        "CLOCK_START",
        "running",
        tournament.current_level_index,
        tournament.clock_remaining_seconds,
    )?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn clock_pause(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    if tournament.clock_state == "paused" {
        return Ok(());
    }
    apply_clock_change(
        &mut conn,
        &tournament,
        "CLOCK_PAUSE",
        "paused",
        tournament.current_level_index,
        tournament.clock_remaining_seconds,
    )?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn clock_next(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    let levels = fetch_levels(&conn, tournament.id)?;
    let max_index = levels.iter().map(|level| level.index).max().unwrap_or(0);
    if tournament.current_level_index >= max_index {
        return Ok(());
    }
    let new_index = tournament.current_level_index + 1;
    let new_remaining = levels
        .iter()
        .find(|level| level.index == new_index)
        .map(|level| level.duration_seconds)
        .unwrap_or(tournament.clock_remaining_seconds);
    apply_clock_change(
        &mut conn,
        &tournament,
        "CLOCK_NEXT",
        tournament.clock_state.as_str(),
        new_index,
        new_remaining,
    )?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn clock_prev(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    if tournament.current_level_index <= 0 {
        return Ok(());
    }
    let levels = fetch_levels(&conn, tournament.id)?;
    let new_index = tournament.current_level_index - 1;
    let new_remaining = levels
        .iter()
        .find(|level| level.index == new_index)
        .map(|level| level.duration_seconds)
        .unwrap_or(tournament.clock_remaining_seconds);
    apply_clock_change(
        &mut conn,
        &tournament,
        "CLOCK_PREV",
        tournament.clock_state.as_str(),
        new_index,
        new_remaining,
    )?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn clock_adjust(state: State<AppState>, app: AppHandle, seconds: i64) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    let new_remaining = (tournament.clock_remaining_seconds + seconds).max(0);
    apply_clock_change(
        &mut conn,
        &tournament,
        "CLOCK_ADJUST",
        tournament.clock_state.as_str(),
        tournament.current_level_index,
        new_remaining,
    )?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn clock_trigger_break(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    let levels = fetch_levels(&conn, tournament.id)?;
    let next_break = levels
        .iter()
        .filter(|level| level.is_break && level.index > tournament.current_level_index)
        .min_by_key(|level| level.index);
    if let Some(next_break) = next_break {
        apply_clock_change(
            &mut conn,
            &tournament,
            "CLOCK_NEXT",
            tournament.clock_state.as_str(),
            next_break.index,
            next_break.duration_seconds,
        )?;
        emit_state(&app);
    }
    Ok(())
}

#[tauri::command]
fn update_itm(state: State<AppState>, app: AppHandle, new_count: i64) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "UPDATE tournaments SET itm_count = ? WHERE id = ?",
        params![new_count, tournament.id],
    )
    .map_err(|err| err.to_string())?;
    let payload = UpdateItmPayload {
        previous_itm_count: tournament.itm_count,
        new_itm_count: new_count,
    };
    insert_event_tx(
        &tx,
        tournament.id,
        "UPDATE_ITM",
        serde_json::to_value(payload).unwrap(),
    )?;
    tx.commit().map_err(|err| err.to_string())?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn undo_last_event(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut conn = open_connection(&state.db_path)?;
    let tournament = fetch_tournament(&conn)?.ok_or("Tournament not found")?;

    let mut stmt = conn
        .prepare(
            "SELECT id, type, payload_json FROM events WHERE tournament_id = ? ORDER BY id DESC",
        )
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map([tournament.id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|err| err.to_string())?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|err| err.to_string())?);
    }
    drop(stmt);

    let mut undone = std::collections::HashSet::<i64>::new();
    for (_event_id, event_type, payload) in &events {
        if event_type == "UNDO_EVENT" {
            if let Ok(payload) = serde_json::from_str::<UndoPayload>(payload) {
                undone.insert(payload.event_id);
            }
        }
    }

    let target = events
        .into_iter()
        .find(|(event_id, event_type, _)| event_type != "UNDO_EVENT" && !undone.contains(event_id));
    if target.is_none() {
        return Ok(());
    }

    let (event_id, event_type, payload_json) = target.unwrap();

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    match event_type.as_str() {
        "JOIN_PLAYER" => {
            let payload: JoinPlayerPayload =
                serde_json::from_str(&payload_json).map_err(|err| err.to_string())?;
            tx.execute(
                "DELETE FROM players WHERE id = ?",
                params![payload.player_id],
            )
            .map_err(|err| err.to_string())?;
            tx.execute(
                "UPDATE seats SET player_id = NULL WHERE id = ?",
                params![payload.seat_id],
            )
            .map_err(|err| err.to_string())?;
        }
        "ELIMINATE_PLAYER" => {
            let payload: EliminatePlayerPayload =
                serde_json::from_str(&payload_json).map_err(|err| err.to_string())?;
            tx.execute(
                "UPDATE players SET status = 'active', eliminated_at = NULL WHERE id = ?",
                params![payload.player_id],
            )
            .map_err(|err| err.to_string())?;
            if let Some(seat_id) = payload.seat_id {
                tx.execute(
                    "UPDATE seats SET player_id = ? WHERE id = ?",
                    params![payload.player_id, seat_id],
                )
                .map_err(|err| err.to_string())?;
            }
        }
        "MOVE_PLAYER" => {
            let payload: MovePlayerPayload =
                serde_json::from_str(&payload_json).map_err(|err| err.to_string())?;
            tx.execute(
                "UPDATE seats SET player_id = NULL WHERE id = ?",
                params![payload.to_seat_id],
            )
            .map_err(|err| err.to_string())?;
            tx.execute(
                "UPDATE seats SET player_id = ? WHERE id = ?",
                params![payload.player_id, payload.from_seat_id],
            )
            .map_err(|err| err.to_string())?;
        }
        "CLOCK_START" | "CLOCK_PAUSE" | "CLOCK_NEXT" | "CLOCK_PREV" | "CLOCK_ADJUST" => {
            let payload: ClockPayload =
                serde_json::from_str(&payload_json).map_err(|err| err.to_string())?;
            tx.execute(
                "UPDATE tournaments SET current_level_index = ?, clock_state = ?, clock_remaining_seconds = ? WHERE id = ?",
                params![payload.from_level_index, payload.from_state, payload.from_remaining_seconds, tournament.id],
            )
            .map_err(|err| err.to_string())?;
        }
        "UPDATE_ITM" => {
            let payload: UpdateItmPayload =
                serde_json::from_str(&payload_json).map_err(|err| err.to_string())?;
            tx.execute(
                "UPDATE tournaments SET itm_count = ? WHERE id = ?",
                params![payload.previous_itm_count, tournament.id],
            )
            .map_err(|err| err.to_string())?;
        }
        "CLOSE_TABLE" => {
            let payload: CloseTablePayload =
                serde_json::from_str(&payload_json).map_err(|err| err.to_string())?;
            for mv in payload.moves {
                tx.execute(
                    "UPDATE seats SET player_id = NULL WHERE id = ?",
                    params![mv.to_seat_id],
                )
                .map_err(|err| err.to_string())?;
                tx.execute(
                    "UPDATE seats SET player_id = ? WHERE id = ?",
                    params![mv.player_id, mv.from_seat_id],
                )
                .map_err(|err| err.to_string())?;
            }
            tx.execute(
                "UPDATE tables SET is_closed = 0 WHERE id = ?",
                params![payload.table_id],
            )
            .map_err(|err| err.to_string())?;
        }
        "REVIVE_PLAYER" => {
            let payload: RevivePlayerPayload =
                serde_json::from_str(&payload_json).map_err(|err| err.to_string())?;
            tx.execute(
                "UPDATE players SET status = 'eliminated', eliminated_at = ? WHERE id = ?",
                params![payload.previous_eliminated_at, payload.player_id],
            )
            .map_err(|err| err.to_string())?;
            tx.execute(
                "UPDATE seats SET player_id = NULL WHERE id = ?",
                params![payload.seat_id],
            )
            .map_err(|err| err.to_string())?;
        }
        _ => {}
    }

    recalculate_status(&tx, tournament.id)?;
    let undo_payload = UndoPayload { event_id };
    insert_event_tx(
        &tx,
        tournament.id,
        "UNDO_EVENT",
        serde_json::to_value(undo_payload).unwrap(),
    )?;
    tx.commit().map_err(|err| err.to_string())?;
    emit_state(&app);
    Ok(())
}

#[tauri::command]
fn open_display_window(app: AppHandle) -> Result<(), String> {
    if app.get_window("display").is_some() {
        return Ok(());
    }
    tauri::WindowBuilder::new(
        &app,
        "display",
        tauri::WindowUrl::App("index.html#/display".into()),
    )
    .title("MTT Display")
    .fullscreen(true)
    .build()
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn start_clock_thread(app: AppHandle, db_path: PathBuf) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        if let Ok(mut conn) = open_connection(&db_path) {
            if let Ok(Some(tournament)) = fetch_tournament(&conn) {
                if tournament.clock_state == "running" {
                    let levels = fetch_levels(&conn, tournament.id).unwrap_or_default();
                    let mut new_remaining = (tournament.clock_remaining_seconds - 1).max(0);
                    let mut new_index = tournament.current_level_index;
                    let mut needs_event = false;

                    if new_remaining == 0 {
                        let max_index = levels.iter().map(|level| level.index).max().unwrap_or(0);
                        if tournament.current_level_index < max_index {
                            new_index = tournament.current_level_index + 1;
                            new_remaining = levels
                                .iter()
                                .find(|level| level.index == new_index)
                                .map(|level| level.duration_seconds)
                                .unwrap_or(0);
                            needs_event = true;
                        }
                    }

                    let tx = match conn.transaction() {
                        Ok(tx) => tx,
                        Err(_) => continue,
                    };

                    if needs_event {
                        let payload = ClockPayload {
                            from_level_index: tournament.current_level_index,
                            to_level_index: new_index,
                            from_remaining_seconds: tournament.clock_remaining_seconds,
                            to_remaining_seconds: new_remaining,
                            from_state: tournament.clock_state.clone(),
                            to_state: tournament.clock_state.clone(),
                        };
                        let _ = insert_event_tx(
                            &tx,
                            tournament.id,
                            "CLOCK_NEXT",
                            serde_json::to_value(payload).unwrap(),
                        );
                    }

                    let _ = tx.execute(
                            "UPDATE tournaments SET current_level_index = ?, clock_remaining_seconds = ? WHERE id = ?",
                            params![new_index, new_remaining, tournament.id],
                        );
                    let _ = tx.commit();
                    emit_state(&app);
                }
            }
        }
    });
}

fn ensure_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Unable to resolve app data directory")?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join("mtt.sqlite"))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let db_path = ensure_db_path(&app.handle())?;
            let conn = open_connection(&db_path)?;
            migrate(&conn)?;
            app.manage(AppState {
                db_path: db_path.clone(),
            });
            start_clock_thread(app.handle(), db_path);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            create_tournament,
            reset_tournament,
            register_player,
            register_player_at_seat,
            eliminate_player,
            revive_player_at_seat,
            move_player,
            balance_suggestions,
            close_table,
            clock_start,
            clock_pause,
            clock_next,
            clock_prev,
            clock_adjust,
            clock_trigger_break,
            update_itm,
            undo_last_event,
            open_display_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON;", []).unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn create_dummy_tournament(conn: &mut Connection) -> Result<Tournament, String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO tournaments (name, tables_count, seats_per_table, itm_count, late_reg_enabled, status, current_level_index, clock_state, clock_remaining_seconds, created_at)
             VALUES ('Test', 2, 9, 3, 1, 'setup', 0, 'paused', 600, ?)",
            params![now_ts()],
        ).map_err(|e| e.to_string())?;
        let id = tx.last_insert_rowid();

        for t in 1..=2 {
            tx.execute(
                "INSERT INTO tables (tournament_id, table_no, is_closed) VALUES (?, ?, 0)",
                params![id, t],
            )
            .unwrap();
            let tid = tx.last_insert_rowid();
            for s in 1..=9 {
                tx.execute(
                    "INSERT INTO seats (table_id, seat_no, player_id) VALUES (?, ?, NULL)",
                    params![tid, s],
                )
                .unwrap();
            }
        }
        tx.execute("INSERT INTO levels (tournament_id, idx, duration_seconds, small_blind, big_blind, ante, is_break, label) VALUES (?, 0, 600, 100, 200, 0, 0, 'L1')", params![id]).unwrap();
        tx.commit().unwrap();
        fetch_tournament(conn).map(|res| res.unwrap())
    }

    #[test]
    fn test_seating_randomness() {
        let mut conn = setup_db();
        let tournament = create_dummy_tournament(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();

        for i in 1..=15 {
            let name = format!("Player {}", i);
            let seat_opt = choose_seat(&tx, &tournament, "random").unwrap();
            if let Some(seat) = seat_opt {
                tx.execute("INSERT INTO players (tournament_id, name, status, registered_at) VALUES (?, ?, 'active', ?)", params![tournament.id, name, now_ts()]).unwrap();
                let pid = tx.last_insert_rowid();
                tx.execute(
                    "UPDATE seats SET player_id = ? WHERE id = ?",
                    params![pid, seat.id],
                )
                .unwrap();
            }
        }
        tx.commit().unwrap();

        let seats = fetch_seats(&conn, tournament.id).unwrap();
        let occupied = seats.iter().filter(|s| s.player_id.is_some()).count();
        assert_eq!(occupied, 15);
    }

    #[test]
    fn test_balance_logic() {
        let mut conn = setup_db();
        let tournament = create_dummy_tournament(&mut conn).unwrap();
        let tables = fetch_tables(&conn, tournament.id).unwrap();
        let t1 = tables[0].id; // Table 1
        let t2 = tables[1].id; // Table 2

        let tx = conn.transaction().unwrap();
        // 9 players on T1
        for i in 1..=9 {
            tx.execute("INSERT INTO players (tournament_id, name, status, registered_at) VALUES (?, ?, 'active', 0)", params![tournament.id, format!("P1-{}", i)]).unwrap();
            let pid = tx.last_insert_rowid();
            tx.execute(
                "UPDATE seats SET player_id = ? WHERE table_id = ? AND seat_no = ?",
                params![pid, t1, i],
            )
            .unwrap();
        }
        // 3 players on T2 (Diff = 6)
        for i in 1..=3 {
            tx.execute("INSERT INTO players (tournament_id, name, status, registered_at) VALUES (?, ?, 'active', 0)", params![tournament.id, format!("P2-{}", i)]).unwrap();
            let pid = tx.last_insert_rowid();
            tx.execute(
                "UPDATE seats SET player_id = ? WHERE table_id = ? AND seat_no = ?",
                params![pid, t2, i],
            )
            .unwrap();
        }
        tx.commit().unwrap();

        let suggestions = compute_balance_suggestions(&conn).unwrap();
        assert!(
            !suggestions.is_empty(),
            "Should suggest moves when diff is 6"
        );
        // Should move enough to balance. (9+3)/2 = 6. T1 has 9 -> needs -3. T2 has 3 -> needs +3.
        // Suggestions should be around 3 moves.
        assert!(suggestions.len() >= 2);
    }
}
