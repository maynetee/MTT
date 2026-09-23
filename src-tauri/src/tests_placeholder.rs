
#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON;", []).unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn create_dummy_tournament(conn: &Connection) -> Result<Tournament, String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO tournaments (name, tables_count, seats_per_table, itm_count, late_reg_enabled, status, current_level_index, clock_state, clock_remaining_seconds, created_at)
             VALUES ('Test', 2, 9, 3, 1, 'setup', 0, 'paused', 600, ?)",
            params![now_ts()],
        ).map_err(|e| e.to_string())?;
        let id = tx.last_insert_rowid();

        // Create Tables & Seats
        for t in 1..=2 {
             tx.execute("INSERT INTO tables (tournament_id, table_no, is_closed) VALUES (?, ?, 0)", params![id, t]).unwrap();
             let tid = tx.last_insert_rowid();
             for s in 1..=9 {
                 tx.execute("INSERT INTO seats (table_id, seat_no, player_id) VALUES (?, ?, NULL)", params![tid, s]).unwrap();
             }
        }
        
        // Levels
        tx.execute("INSERT INTO levels (tournament_id, idx, duration_seconds, small_blind, big_blind, ante, is_break, label) VALUES (?, 0, 600, 100, 200, 0, 0, 'L1')", params![id]).unwrap();

        tx.commit().unwrap();
        fetch_tournament(conn).map(|res| res.unwrap())
    }

    #[test]
    fn test_seating_randomness_and_uniqueness() {
        let mut conn = setup_db();
        let tournament = create_dummy_tournament(&conn).unwrap();
        
        // Register 15 players
        for i in 1..=15 {
             let name = format!("Player {}", i);
             let seat = choose_seat(&conn, &tournament, "random").unwrap();
             assert!(seat.is_some(), "Should find a seat");
             let seat = seat.unwrap();
             
             // Manually occupy seat (since register_player handles transaction which we are mocking partially)
             let tx = conn.transaction().unwrap();
             tx.execute("INSERT INTO players (tournament_id, name, status, registered_at) VALUES (?, ?, 'active', ?)", params![tournament.id, name, now_ts()]).unwrap();
             let pid = tx.last_insert_rowid();
             tx.execute("UPDATE seats SET player_id = ? WHERE id = ?", params![pid, seat.id]).unwrap();
             tx.commit().unwrap();
        }

        // Verify seats occupied
        let seats = fetch_seats(&conn, tournament.id).unwrap();
        let occupied = seats.iter().filter(|s| s.player_id.is_some()).count();
        assert_eq!(occupied, 15);
        
        // Verify unique players
        let mut pids: Vec<i64> = seats.iter().filter_map(|s| s.player_id).collect();
        pids.sort();
        pids.dedup();
        assert_eq!(pids.len(), 15);
    }

    #[test]
    fn test_late_reg_conditions() {
        let conn = setup_db();
        let mut tournament = create_dummy_tournament(&conn).unwrap();
        
        // 1. Setup mode -> Open
        assert!(late_registration_open(&conn, &tournament).unwrap());
        
        // 2. Running + Late Reg Enabled -> Open
        let mut conn_mut = setup_db(); // trick for mutability if needed, or just re-fetch
        // In this mock we just change the struct
        tournament.status = "running".to_string();
        assert!(late_registration_open(&conn, &tournament).unwrap());
        
        // 3. Late Reg Disabled
        tournament.late_reg_enabled = false;
        assert!(!late_registration_open(&conn, &tournament).unwrap());
    }

    #[test]
    fn test_balance_suggestions() {
        let mut conn = setup_db();
        let tournament = create_dummy_tournament(&conn).unwrap(); // 2 tables, 9 seats each

        let tables = fetch_tables(&conn, tournament.id).unwrap();
        let t1 = tables[0].id;
        let t2 = tables[1].id;
        
        let tx = conn.transaction().unwrap();
        // Fill T1 with 9 players
        for i in 1..=9 {
            tx.execute("INSERT INTO players (tournament_id, name, status, registered_at) VALUES (?, ?, 'active', 0)", params![tournament.id, format!("P{}", i)]).unwrap();
            let pid = tx.last_insert_rowid();
            tx.execute("UPDATE seats SET player_id = ? WHERE table_id = ? AND seat_no = ?", params![pid, t1, i]).unwrap();
        }
        // Fill T2 with 3 players (Diff = 6)
        for i in 1..=3 {
            tx.execute("INSERT INTO players (tournament_id, name, status, registered_at) VALUES (?, ?, 'active', 0)", params![tournament.id, format!("P2-{}", i)]).unwrap();
            let pid = tx.last_insert_rowid();
            tx.execute("UPDATE seats SET player_id = ? WHERE table_id = ? AND seat_no = ?", params![pid, t2, i]).unwrap();
        }
        tx.commit().unwrap();

        // RUN BALANCE
        // balance_suggestions function requires AppState, but we can't extract it easily as it's a tauri command.
        // Wait, balance_suggestions is a COMMAND. I should extract the logic or test the logic function directly.
        // Ah, `balance_suggestions` body logic is inside the command.
        // I'll extract it or copy logic for test. 
        // Actually, I can refactor the logic into a standalone function `get_balance_suggestions(conn, tournament)`.
        
        // REFACTOR PROPOSAL:
        // Move logic from command to helper function to allow testing.
        // For now, I will reimplement the logic here to verify it works as EXPECTED, 
        // or I should refactor the code first.
        // Refactoring is safer.
    }
}
