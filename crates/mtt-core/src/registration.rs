//! Registration: late registration window, name rules and immediate seating.

use crate::clock;
use crate::config::Deadline;
use crate::error::DomainError;
use crate::event::{Event, Finish};
use crate::ids::{PlayerId, SeatRef, TableNo};
use crate::money::Price;
use crate::name::{self, MAX_NAME_CHARS};
use crate::rng::Rng;
use crate::state::{Phase, State, TableStatus};
use crate::structure::{self, Level};

/// Clock time left before the deadline closes registration (`<= 0`: closed), or `None`
/// for a manual deadline. Ignores the phase and the director's override.
pub fn deadline_in_ms(state: &State, now_ms: i64) -> Option<i64> {
    time_left_ms(state, state.config.late_reg, now_ms)
}

/// Clock time left before `deadline` passes (`<= 0`: passed), or `None` when manual.
pub fn time_left_ms(state: &State, deadline: Deadline, now_ms: i64) -> Option<i64> {
    let levels = &state.structure;
    match deadline {
        Deadline::Manual => None,
        Deadline::Elapsed { ms } => {
            Some(ms.saturating_sub(clock::elapsed_ms(&state.clock, levels, now_ms)))
        }
        Deadline::EndOfPlayLevel { n, through_break } => {
            let mut close = structure::play_level_index(levels, n)? + 1;
            if through_break && levels.get(close).is_some_and(Level::is_break) {
                close += 1;
            }
            let eff = clock::effective(&state.clock, levels, now_ms);
            if eff.level >= close {
                return Some(0);
            }
            let between = structure::total_ms(&levels[eff.level + 1..close]);
            Some(eff.remaining_ms.saturating_add(between))
        }
    }
}

/// True when new players may register at `now_ms`: always during setup, then the
/// director's override if any, else the configured deadline.
pub fn is_open(state: &State, now_ms: i64) -> bool {
    match state.phase {
        Phase::Setup => true,
        Phase::Finished { .. } => false,
        Phase::Running => state
            .reg_override
            .unwrap_or_else(|| deadline_in_ms(state, now_ms).is_none_or(|left| left > 0)),
    }
}

/// Checks that `seat` can receive a player: the table exists and is not closed (an idle
/// table gets opened), the seat exists and is empty.
pub(crate) fn check_free_seat(state: &State, seat: SeatRef) -> Result<(), DomainError> {
    let table = state
        .tables
        .get(&seat.table)
        .ok_or(DomainError::TableNotFound { table: seat.table })?;
    if table.status == TableStatus::Closed {
        return Err(DomainError::TableClosed { table: seat.table });
    }
    if !(1..=table.seats).contains(&seat.seat.0) {
        return Err(DomainError::SeatNotFound {
            table: seat.table,
            seat: seat.seat,
        });
    }
    if table.occupants.contains_key(&seat.seat) {
        return Err(DomainError::SeatOccupied {
            table: seat.table,
            seat: seat.seat,
        });
    }
    Ok(())
}

/// Picks a seat for a new player: the open table with the fewest players (ties drawn at
/// random), then a uniformly random empty seat. The next idle table is opened only when
/// every open table is full.
pub(crate) fn auto_seat(
    state: &State,
    rng: &mut Rng,
) -> Result<(SeatRef, Option<TableNo>), DomainError> {
    let with_room: Vec<_> = state
        .open_tables()
        .filter(|t| t.count() < usize::from(t.seats))
        .collect();
    let (table, opened) = match with_room.iter().map(|t| t.count()).min() {
        Some(fewest) => {
            let candidates: Vec<_> = with_room
                .into_iter()
                .filter(|t| t.count() == fewest)
                .collect();
            let table = *rng.pick(&candidates).ok_or(DomainError::TournamentFull)?;
            (table, None)
        }
        None => {
            let table = state
                .tables
                .values()
                .find(|t| t.status == TableStatus::Idle)
                .ok_or(DomainError::TournamentFull)?;
            (table, Some(table.no))
        }
    };
    let seat = *rng
        .pick(&table.free_seats())
        .ok_or(DomainError::TournamentFull)?;
    Ok((
        SeatRef {
            table: table.no,
            seat,
        },
        opened,
    ))
}

/// Seat for a new entry (registration or re-entry): `forced` if free, else
/// [`auto_seat`]. Also returns the idle table this opens, if any.
pub(crate) fn seat_new_entry(
    state: &State,
    forced: Option<SeatRef>,
    rng: &mut Rng,
) -> Result<(SeatRef, Option<TableNo>), DomainError> {
    match forced {
        Some(seat) => {
            check_free_seat(state, seat)?;
            let idle = state
                .tables
                .get(&seat.table)
                .is_some_and(|t| t.status == TableStatus::Idle);
            Ok((seat, idle.then_some(seat.table)))
        }
        None => auto_seat(state, rng),
    }
}

/// `Register`.
pub(crate) fn decide_register(
    state: &State,
    raw_name: &str,
    forced: Option<SeatRef>,
    now_ms: i64,
    rng: &mut Rng,
) -> Result<Event, DomainError> {
    let name = name::clean(raw_name);
    if name.is_empty() {
        return Err(DomainError::NameRequired);
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(DomainError::NameTooLong {
            max: MAX_NAME_CHARS as u16,
        });
    }
    let key = name::key(&name);
    if let Some(existing) = state.players.values().find(|p| p.name_key == key) {
        return Err(DomainError::NameTaken {
            player: existing.id,
        });
    }
    if !is_open(state, now_ms) {
        return Err(DomainError::LateRegClosed);
    }
    if state.next_player_id == u32::MAX {
        return Err(DomainError::TournamentFull);
    }
    let (seat, opened_table) = seat_new_entry(state, forced, rng)?;
    Ok(Event::PlayerRegistered {
        player: PlayerId(state.next_player_id),
        name,
        seat,
        stack: state.config.starting_stack,
        opened_table,
        price: state.config.money.as_ref().map(|m| m.buy_in),
    })
}

/// `Unregister`: only before the start; what the player paid is refunded.
pub(crate) fn decide_unregister(state: &State, player: PlayerId) -> Result<Event, DomainError> {
    if state.phase != Phase::Setup {
        return Err(DomainError::AlreadyStarted);
    }
    let found = state
        .player(player)
        .ok_or(DomainError::PlayerNotFound { player })?;
    let refund = state.config.money.as_ref().map(|_| Price {
        prize: found.prize_paid,
        fee: found.fees_paid,
    });
    Ok(Event::PlayerUnregistered { player, refund })
}

/// `CloseRegistration`: finishes the tournament when a single player is left.
pub(crate) fn decide_close(state: &State, now_ms: i64) -> Result<Event, DomainError> {
    if state.phase == Phase::Setup {
        return Err(DomainError::NotStarted);
    }
    if !is_open(state, now_ms) {
        return Err(DomainError::RegistrationAlreadyClosed);
    }
    let finish = state.sole_survivor().map(|winner| Finish {
        winner,
        clock: clock::paused_at(&state.clock, &state.structure, now_ms),
    });
    Ok(Event::RegistrationOverridden {
        open: false,
        finish,
    })
}

/// `ReopenRegistration`: keeps registration open regardless of the deadline.
pub(crate) fn decide_reopen(state: &State) -> Result<Event, DomainError> {
    if state.phase == Phase::Setup {
        return Err(DomainError::NotStarted);
    }
    if state.reg_override == Some(true) {
        return Err(DomainError::RegistrationAlreadyOpen);
    }
    Ok(Event::RegistrationOverridden {
        open: true,
        finish: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::Command;
    use crate::config::Config;
    use crate::ids::SeatNo;
    use crate::testkit::Kit;

    fn register(name: &str) -> Command {
        Command::Register {
            name: name.into(),
            seat: None,
        }
    }

    fn register_at(table: u16, seat: u8) -> Command {
        Command::Register {
            name: "Forced".into(),
            seat: Some(SeatRef::new(table, seat)),
        }
    }

    #[test]
    fn fills_open_tables_before_opening_the_next() {
        let mut kit = Kit::new(3, 3);
        for i in 0..3 {
            kit.register(&format!("P{i}"));
        }
        assert_eq!(kit.table_counts(), vec![3]);
        let fourth = kit.register("P3");
        assert_eq!(kit.seat_of(fourth).unwrap().table, TableNo(2));
        assert_eq!(kit.table_counts(), vec![3, 1]);
    }

    #[test]
    fn seats_at_the_open_table_with_fewest_players() {
        let mut kit = Kit::new(4, 3);
        kit.register_at("A", 1, 1);
        kit.register_at("B", 1, 2);
        kit.register_at("C", 2, 1);
        let d = kit.register("D");
        assert_eq!(kit.seat_of(d).unwrap().table, TableNo(2));
    }

    #[test]
    fn full_tournament_is_rejected() {
        let mut kit = Kit::new(2, 1);
        kit.register("A");
        kit.register("B");
        assert_eq!(kit.err(register("C")), DomainError::TournamentFull);
    }

    #[test]
    fn names_are_unique_after_normalization() {
        let mut kit = Kit::new(9, 2);
        let jean = kit.register("Jean  Dupont");
        assert_eq!(
            kit.err(register("  jean DUPONT ")),
            DomainError::NameTaken { player: jean }
        );
        assert_eq!(kit.err(register(" \t ")), DomainError::NameRequired);
        assert_eq!(
            kit.err(register(&"x".repeat(65))),
            DomainError::NameTooLong { max: 64 }
        );
        assert_eq!(kit.agg.state().player(jean).unwrap().name, "Jean Dupont");
    }

    #[test]
    fn forced_seat_checks_the_seat() {
        let mut kit = Kit::new(6, 2);
        kit.register_at("A", 1, 1);
        assert_eq!(
            kit.err(register_at(3, 1)),
            DomainError::TableNotFound { table: TableNo(3) }
        );
        assert_eq!(
            kit.err(register_at(1, 7)),
            DomainError::SeatNotFound {
                table: TableNo(1),
                seat: SeatNo(7)
            }
        );
        assert_eq!(
            kit.err(register_at(1, 1)),
            DomainError::SeatOccupied {
                table: TableNo(1),
                seat: SeatNo(1)
            }
        );
        // An idle table is opened by a forced seat.
        kit.register_at("B", 2, 4);
        assert_eq!(kit.table_counts(), vec![1, 1]);
    }

    #[test]
    fn unregister_only_before_the_start() {
        let mut kit = Kit::new(6, 1);
        let a = kit.register("A");
        kit.register("B");
        let c = kit.register("C");
        kit.ok(Command::Unregister { player: c });
        assert!(kit.agg.state().player(c).is_none());
        assert_eq!(kit.table_counts(), vec![2]);
        kit.ok(Command::StartClock {});
        assert_eq!(
            kit.err(Command::Unregister { player: a }),
            DomainError::AlreadyStarted
        );
    }

    #[test]
    fn close_and_reopen_registration() {
        let mut kit = Kit::with_config(Config::new("Unit", 6, 1, 1000));
        kit.register("A");
        kit.register("B");
        assert_eq!(
            kit.err(Command::CloseRegistration {}),
            DomainError::NotStarted
        );
        kit.ok(Command::StartClock {});
        kit.ok(Command::CloseRegistration {});
        assert!(!is_open(kit.agg.state(), kit.now));
        assert_eq!(
            kit.err(Command::CloseRegistration {}),
            DomainError::RegistrationAlreadyClosed
        );
        kit.ok(Command::ReopenRegistration {});
        assert!(is_open(kit.agg.state(), kit.now));
        assert_eq!(
            kit.err(Command::ReopenRegistration {}),
            DomainError::RegistrationAlreadyOpen
        );
    }

    const MIN: i64 = 60_000;

    /// Structure `[P1 20', P2 20', break 10', P3 20']`, started at `T0`.
    fn started_with(late_reg: Deadline) -> Kit {
        let mut kit = Kit::with_config(Config {
            late_reg,
            ..Config::new("Unit", 9, 2, 1000)
        });
        kit.register("A");
        kit.register("B");
        kit.ok(Command::StartClock {});
        kit
    }

    fn open_after(kit: &mut Kit, minutes: i64) -> bool {
        kit.now = crate::testkit::T0 + minutes * MIN;
        is_open(kit.agg.state(), kit.now)
    }

    #[test]
    fn end_of_play_level_closes_when_the_next_level_starts() {
        let mut kit = started_with(Deadline::EndOfPlayLevel {
            n: 2,
            through_break: false,
        });
        assert!(open_after(&mut kit, 39));
        let view = kit.agg.view(kit.now);
        assert_eq!(view.registration.closes_in_ms, Some(MIN));
        assert_eq!(view.registration.closes_at_ms, Some(kit.now + MIN));
        assert!(!open_after(&mut kit, 40));
        let mut kit = started_with(Deadline::EndOfPlayLevel {
            n: 2,
            through_break: true,
        });
        assert!(open_after(&mut kit, 49));
        assert!(!open_after(&mut kit, 50));
    }

    #[test]
    fn last_play_level_closes_at_the_end_of_the_structure() {
        let mut kit = started_with(Deadline::EndOfPlayLevel {
            n: 3,
            through_break: true,
        });
        assert!(open_after(&mut kit, 69));
        assert!(!open_after(&mut kit, 70));
        assert!(!open_after(&mut kit, 500));
    }

    #[test]
    fn elapsed_deadline_ignores_pauses() {
        let mut kit = started_with(Deadline::Elapsed { ms: 30 * MIN });
        kit.now += 10 * MIN;
        kit.ok(Command::PauseClock {});
        kit.now += 60 * MIN;
        let view = kit.agg.view(kit.now);
        assert!(view.registration.open);
        assert_eq!(view.registration.closes_in_ms, Some(20 * MIN));
        assert_eq!(view.registration.closes_at_ms, None);
        kit.ok(Command::StartClock {});
        kit.now += 20 * MIN - 1;
        assert!(is_open(kit.agg.state(), kit.now));
        kit.now += 1;
        assert!(!is_open(kit.agg.state(), kit.now));
    }

    #[test]
    fn override_beats_the_deadline() {
        let mut kit = started_with(Deadline::EndOfPlayLevel {
            n: 1,
            through_break: false,
        });
        assert!(!open_after(&mut kit, 25));
        kit.ok(Command::ReopenRegistration {});
        assert!(is_open(kit.agg.state(), kit.now));
        assert_eq!(kit.agg.view(kit.now).registration.closes_in_ms, None);
        kit.ok(Command::CloseRegistration {});
        assert!(!is_open(kit.agg.state(), kit.now));
    }
}
