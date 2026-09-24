//! Seats and tables: moves, buttons, TDA balancing, table breaks and the final table.
//!
//! `Table.button` is the button seat for the next hand (possibly an empty seat: dead
//! button). Counting occupied seats clockwise after it, the next small blind is the first
//! and the next big blind the second; heads-up the button posts the small blind and the
//! other player the big blind.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::command::MoveReason;
use crate::error::DomainError;
use crate::event::{Event, SeatMove};
use crate::ids::{PlayerId, SeatNo, SeatRef, TableNo};
use crate::registration::check_free_seat;
use crate::rng::Rng;
use crate::state::{Phase, State, Table, TableStatus};

/// Seats clockwise after `from`, ending with `from` itself.
fn clockwise(seats: u8, from: SeatNo) -> impl Iterator<Item = SeatNo> {
    (1..=seats).map(move |k| SeatNo((from.0.saturating_sub(1) + k) % seats + 1))
}

/// Occupied seats clockwise after `button`, the button seat itself last.
fn after_button(seats: u8, occupied: impl Fn(SeatNo) -> bool, button: SeatNo) -> Vec<SeatNo> {
    clockwise(seats, button).filter(|&s| occupied(s)).collect()
}

/// Blind seats of the next hand.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Blinds {
    pub small: SeatNo,
    pub big: SeatNo,
}

fn blinds_for(seats: u8, occupied: impl Fn(SeatNo) -> bool, button: SeatNo) -> Option<Blinds> {
    let button_taken = occupied(button);
    let order = after_button(seats, occupied, button);
    match order.as_slice() {
        [] | [_] => None,
        [other, _] if button_taken => Some(Blinds {
            small: button,
            big: *other,
        }),
        [first, second, ..] => Some(Blinds {
            small: *first,
            big: *second,
        }),
    }
}

/// Blinds of the next hand at `table`, when its button is known and two players sit.
pub fn blinds(table: &Table) -> Option<Blinds> {
    blinds_for(
        table.seats,
        |s| table.occupants.contains_key(&s),
        table.button?,
    )
}

/// Worst position for a player joining a table: walking clockwise from the first occupied
/// seat after the button, the first empty seat takes the big blind soonest (between the
/// small and big blind: immediately). Seats reached from the button on sit between the
/// button and the small blind: last resort, the player waits for the big blind.
/// Returns `(seat, waits_for_bb)`.
fn worst_seat(
    seats: u8,
    occupied: impl Fn(SeatNo) -> bool,
    button: SeatNo,
) -> Option<(SeatNo, bool)> {
    let Some(&start) = after_button(seats, &occupied, button).first() else {
        return clockwise(seats, button)
            .find(|&s| !occupied(s))
            .map(|s| (s, false));
    };
    let mut past_button = false;
    for seat in clockwise(seats, start) {
        past_button |= seat == button;
        if !occupied(seat) {
            return Some((seat, past_button));
        }
    }
    None
}

/// One move of a balancing plan: the donor's next big blind to the receiver's worst seat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct BalanceStep {
    pub from_table: TableNo,
    pub to_table: TableNo,
    /// `None` until the donor's button is known.
    pub player: Option<PlayerId>,
    pub from_seat: Option<SeatNo>,
    /// `None` until the receiver's button is known.
    pub to_seat: Option<SeatNo>,
    /// The seat is between the button and the small blind: wait for the big blind.
    pub waits_for_bb: bool,
    /// Tables whose button must be set to complete this step.
    pub needs_button: Vec<TableNo>,
}

#[derive(Clone)]
struct SimTable {
    seats: u8,
    button: Option<SeatNo>,
    occupants: BTreeMap<SeatNo, Option<PlayerId>>,
    count: usize,
    /// False once an unknown move made the seat map unreliable.
    known: bool,
}

impl SimTable {
    fn occupied(&self) -> impl Fn(SeatNo) -> bool + '_ {
        |s| self.occupants.contains_key(&s)
    }
}

/// Moves that bring the open tables within `balance_trigger - 1` players of each other.
/// Recomputed after every move; before the start buttons are ignored.
pub fn balance_plan(state: &State) -> Vec<BalanceStep> {
    let ignore_buttons = state.phase == Phase::Setup;
    let trigger = usize::from(state.config.balance_trigger);
    let mut sim: BTreeMap<TableNo, SimTable> = state
        .open_tables()
        .map(|t| {
            let sim = SimTable {
                seats: t.seats,
                button: t.button,
                occupants: t.occupants.iter().map(|(&s, &p)| (s, Some(p))).collect(),
                count: t.count(),
                known: true,
            };
            (t.no, sim)
        })
        .collect();
    let mut steps = Vec::new();
    loop {
        let most = sim
            .iter()
            .max_by(|a, b| a.1.count.cmp(&b.1.count).then(b.0.cmp(a.0)));
        let fewest = sim
            .iter()
            .min_by(|a, b| a.1.count.cmp(&b.1.count).then(a.0.cmp(b.0)));
        let (Some((&from_table, donor)), Some((&to_table, receiver))) = (most, fewest) else {
            break;
        };
        if donor.count < receiver.count + trigger || steps.len() > state.players.len() {
            break;
        }
        let needs_button: Vec<TableNo> = [(from_table, donor), (to_table, receiver)]
            .into_iter()
            .filter(|(_, t)| !ignore_buttons && t.button.is_none())
            .map(|(no, _)| no)
            .collect();
        let from_seat = match (ignore_buttons, donor.button) {
            _ if !donor.known => None,
            (true, _) => donor.occupants.keys().next_back().copied(),
            (false, Some(button)) => {
                blinds_for(donor.seats, donor.occupied(), button).map(|b| b.big)
            }
            (false, None) => None,
        };
        let target = match (ignore_buttons, receiver.button) {
            _ if !receiver.known => None,
            (true, _) => (1..=receiver.seats)
                .map(SeatNo)
                .find(|s| !receiver.occupants.contains_key(s))
                .map(|s| (s, false)),
            (false, Some(button)) => worst_seat(receiver.seats, receiver.occupied(), button),
            (false, None) => None,
        };
        let player = from_seat.and_then(|s| donor.occupants.get(&s).copied().flatten());
        let to_seat = target.map(|(s, _)| s);
        steps.push(BalanceStep {
            from_table,
            to_table,
            player,
            from_seat,
            to_seat,
            waits_for_bb: target.is_some_and(|(_, waits)| waits),
            needs_button,
        });
        if let Some(donor) = sim.get_mut(&from_table) {
            donor.count -= 1;
            match from_seat {
                Some(seat) => {
                    donor.occupants.remove(&seat);
                }
                None => donor.known = false,
            }
        }
        if let Some(receiver) = sim.get_mut(&to_table) {
            receiver.count += 1;
            match to_seat {
                Some(seat) => {
                    receiver.occupants.insert(seat, player);
                }
                None => receiver.known = false,
            }
        }
    }
    steps
}

/// Open tables in the order they should be broken: the configured `break_order` first,
/// then the others from the highest number down.
pub fn break_sequence(state: &State) -> Vec<TableNo> {
    let is_open = |no: &TableNo| {
        state
            .tables
            .get(no)
            .is_some_and(|t| t.status == TableStatus::Open)
    };
    let mut order: Vec<TableNo> = state
        .config
        .break_order
        .iter()
        .copied()
        .filter(is_open)
        .collect();
    let rest: Vec<TableNo> = state
        .open_tables()
        .rev()
        .map(|t| t.no)
        .filter(|no| !order.contains(no))
        .collect();
    order.extend(rest);
    order
}

/// What the director should do next, highest priority first; at most one kind is set.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Suggestions {
    /// Redraw everyone at this table for the final table.
    pub final_table: Option<TableNo>,
    /// Break this table: the others can seat everybody.
    pub break_table: Option<TableNo>,
    /// Balancing moves, in order.
    pub balance: Vec<BalanceStep>,
}

/// Final table, then table break, then balancing.
pub fn suggestions(state: &State) -> Suggestions {
    if matches!(state.phase, Phase::Finished { .. }) {
        return Suggestions::default();
    }
    let sequence = break_sequence(state);
    let alive = state.alive_count();
    let final_size = usize::from(state.config.final_table_size());
    let field_was_bigger = sequence.len() > 1 || state.players.len() > final_size;
    if state.phase == Phase::Running
        && !state.final_table_formed
        && (2..=final_size).contains(&alive)
        && field_was_bigger
    {
        return Suggestions {
            final_table: sequence.last().copied(),
            ..Suggestions::default()
        };
    }
    let seats = usize::from(state.config.seats_per_table);
    if sequence.len() >= 2 && alive <= (sequence.len() - 1) * seats {
        return Suggestions {
            break_table: sequence.first().copied(),
            ..Suggestions::default()
        };
    }
    Suggestions {
        balance: balance_plan(state),
        ..Suggestions::default()
    }
}

/// `MovePlayer`: to any empty seat of a table that is not closed.
pub(crate) fn decide_move(
    state: &State,
    player: PlayerId,
    to: SeatRef,
    reason: MoveReason,
) -> Result<Event, DomainError> {
    let from = state
        .player(player)
        .ok_or(DomainError::PlayerNotFound { player })?
        .seat()
        .ok_or(DomainError::PlayerNotActive { player })?;
    if from == to {
        return Err(DomainError::SameSeat);
    }
    check_free_seat(state, to)?;
    Ok(Event::PlayerMoved {
        player,
        from,
        to,
        reason,
    })
}

fn open_table(state: &State, no: TableNo) -> Result<&Table, DomainError> {
    let table = state
        .tables
        .get(&no)
        .ok_or(DomainError::TableNotFound { table: no })?;
    if table.status != TableStatus::Open {
        return Err(DomainError::TableNotOpen { table: no });
    }
    Ok(table)
}

/// `SetButton`: the button may sit on an empty seat (dead button).
pub(crate) fn decide_set_button(
    state: &State,
    table: TableNo,
    seat: SeatNo,
) -> Result<Event, DomainError> {
    let found = open_table(state, table)?;
    if !(1..=found.seats).contains(&seat.0) {
        return Err(DomainError::SeatNotFound { table, seat });
    }
    if found.button == Some(seat) {
        return Err(DomainError::NoChange);
    }
    Ok(Event::ButtonSet { table, seat })
}

/// `OpenTable`: an idle or broken table becomes available.
pub(crate) fn decide_open_table(state: &State, table: TableNo) -> Result<Event, DomainError> {
    let found = state
        .tables
        .get(&table)
        .ok_or(DomainError::TableNotFound { table })?;
    if found.status == TableStatus::Open {
        return Err(DomainError::TableAlreadyOpen { table });
    }
    Ok(Event::TableOpened { table })
}

/// `BreakTable`: players are shuffled, then each goes to the remaining table with the
/// fewest players (ties drawn) at a random empty seat, blinds or button included.
pub(crate) fn decide_break(
    state: &State,
    table: TableNo,
    rng: &mut Rng,
) -> Result<Event, DomainError> {
    let broken = open_table(state, table)?;
    let mut others: BTreeMap<TableNo, (u8, Vec<SeatNo>)> = state
        .open_tables()
        .filter(|t| t.no != table)
        .map(|t| (t.no, (t.count() as u8, t.free_seats())))
        .collect();
    if others.is_empty() {
        return Err(DomainError::LastTable);
    }
    let needed = broken.count() as u32;
    let available: u32 = others.values().map(|(_, free)| free.len() as u32).sum();
    if needed > available {
        return Err(DomainError::NotEnoughSeats { needed, available });
    }
    let mut players: Vec<(SeatNo, PlayerId)> =
        broken.occupants.iter().map(|(&s, &p)| (s, p)).collect();
    rng.shuffle(&mut players);
    let mut moves = Vec::with_capacity(players.len());
    for (from_seat, player) in players {
        let with_room = others.iter().filter(|(_, (_, free))| !free.is_empty());
        let fewest = with_room.clone().map(|(_, (count, _))| *count).min();
        let candidates: Vec<TableNo> = with_room
            .filter(|(_, (count, _))| Some(*count) == fewest)
            .map(|(no, _)| *no)
            .collect();
        let target = *rng
            .pick(&candidates)
            .ok_or(DomainError::NotEnoughSeats { needed, available })?;
        let Some((count, free)) = others.get_mut(&target) else {
            return Err(DomainError::NotEnoughSeats { needed, available });
        };
        let seat = free.remove(rng.index(free.len()));
        *count += 1;
        moves.push(SeatMove {
            player,
            from: SeatRef {
                table,
                seat: from_seat,
            },
            to: SeatRef {
                table: target,
                seat,
            },
        });
    }
    Ok(Event::TableBroken { table, moves })
}

/// `FormFinalTable`: every remaining player is redrawn to a random seat among the first
/// `final_table_size` seats of `table`; the other tables close and the button is left for
/// the director to set.
pub(crate) fn decide_final_table(
    state: &State,
    table: TableNo,
    rng: &mut Rng,
) -> Result<Event, DomainError> {
    let target = state
        .tables
        .get(&table)
        .ok_or(DomainError::TableNotFound { table })?;
    if target.status == TableStatus::Closed {
        return Err(DomainError::TableClosed { table });
    }
    let alive: Vec<(PlayerId, SeatRef)> = state
        .players
        .values()
        .filter_map(|p| p.seat().map(|seat| (p.id, seat)))
        .collect();
    if alive.len() > usize::from(target.seats) {
        return Err(DomainError::TooManyForFinalTable {
            alive: alive.len() as u32,
            seats: target.seats,
        });
    }
    // The draw uses the final table's seats (every player gets one if more are left): on
    // larger tables the extra seats stay empty rather than leaving gaps among the players.
    let used = usize::from(state.config.final_table_size())
        .max(alive.len())
        .min(usize::from(target.seats));
    let mut seats: Vec<SeatNo> = (1..=used as u8).map(SeatNo).collect();
    rng.shuffle(&mut seats);
    let moves = alive
        .into_iter()
        .zip(seats)
        .map(|((player, from), seat)| SeatMove {
            player,
            from,
            to: SeatRef { table, seat },
        })
        .collect();
    let closed = state
        .open_tables()
        .map(|t| t.no)
        .filter(|&no| no != table)
        .collect();
    Ok(Event::FinalTableFormed {
        table,
        moves,
        closed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::Command;
    use crate::testkit::Kit;

    fn move_to(player: PlayerId, table: u16, seat: u8) -> Command {
        Command::MovePlayer {
            player,
            to: SeatRef::new(table, seat),
            reason: None,
        }
    }

    fn seats_of(occupied: &[u8]) -> impl Fn(SeatNo) -> bool + '_ {
        move |s| occupied.contains(&s.0)
    }

    #[test]
    fn moves_to_an_empty_seat() {
        let mut kit = Kit::new(6, 2);
        let a = kit.register_at("A", 1, 1);
        kit.register_at("B", 1, 2);
        assert_eq!(kit.err(move_to(a, 1, 1)), DomainError::SameSeat);
        assert!(matches!(
            kit.err(move_to(a, 1, 2)),
            DomainError::SeatOccupied { .. }
        ));
        kit.ok(move_to(a, 2, 3));
        assert_eq!(kit.seat_of(a), Some(SeatRef::new(2, 3)));
        assert_eq!(kit.table_counts(), vec![1, 1]);
    }

    #[test]
    fn busted_players_cannot_move() {
        let mut kit = Kit::new(6, 1);
        let a = kit.register("A");
        kit.register("B");
        kit.register("C");
        kit.ok(Command::StartClock {});
        kit.ok(crate::testkit::bust(&[a]));
        assert_eq!(
            kit.err(move_to(a, 1, 6)),
            DomainError::PlayerNotActive { player: a }
        );
    }

    #[test]
    fn blinds_follow_the_button() {
        let occupied = [1, 3, 4, 7, 9];
        assert_eq!(
            blinds_for(9, seats_of(&occupied), SeatNo(3)),
            Some(Blinds {
                small: SeatNo(4),
                big: SeatNo(7)
            })
        );
        // Wrapping around the table.
        assert_eq!(
            blinds_for(9, seats_of(&occupied), SeatNo(7)),
            Some(Blinds {
                small: SeatNo(9),
                big: SeatNo(1)
            })
        );
        assert_eq!(blinds_for(9, seats_of(&[4]), SeatNo(4)), None);
    }

    #[test]
    fn heads_up_button_math() {
        // The button posts the small blind, the other player the big blind.
        let occupied = [2, 7];
        assert_eq!(
            blinds_for(9, seats_of(&occupied), SeatNo(2)),
            Some(Blinds {
                small: SeatNo(2),
                big: SeatNo(7)
            })
        );
        assert_eq!(
            blinds_for(9, seats_of(&occupied), SeatNo(7)),
            Some(Blinds {
                small: SeatNo(7),
                big: SeatNo(2)
            })
        );
        // A newcomer between the big blind and the button takes the big blind next hand;
        // between the button and the other player he would be small blind: last resort.
        assert_eq!(
            worst_seat(9, seats_of(&occupied), SeatNo(2)),
            Some((SeatNo(8), false))
        );
        assert_eq!(
            worst_seat(9, seats_of(&[1, 2, 7, 8, 9]), SeatNo(2)),
            Some((SeatNo(3), true))
        );
    }

    #[test]
    fn dead_button() {
        // Button on the empty seat 5: small blind 7, big blind 8.
        let occupied = [1, 3, 7, 8];
        assert_eq!(
            blinds_for(9, seats_of(&occupied), SeatNo(5)),
            Some(Blinds {
                small: SeatNo(7),
                big: SeatNo(8)
            })
        );
        // Receiver with a dead button on 3: blinds 4 and 6, seat 5 takes the big blind.
        assert_eq!(
            worst_seat(9, seats_of(&[2, 4, 6]), SeatNo(3)),
            Some((SeatNo(5), false))
        );
        // Only the dead button seat and seats up to the small blind are left.
        assert_eq!(
            worst_seat(9, seats_of(&[1, 2, 4, 5, 6, 7, 8, 9]), SeatNo(3)),
            Some((SeatNo(3), true))
        );
    }

    #[test]
    fn worst_seat_prefers_the_big_blind_position() {
        // Button 1, small blind 2, big blind 4: seat 3 is the big blind next hand.
        assert_eq!(
            worst_seat(9, seats_of(&[1, 2, 4, 6, 7]), SeatNo(1)),
            Some((SeatNo(3), false))
        );
        // Nothing between the blinds: the next free seat gets the big blind one hand later.
        assert_eq!(
            worst_seat(9, seats_of(&[1, 2, 3, 6, 7]), SeatNo(1)),
            Some((SeatNo(4), false))
        );
        // Empty table: any seat.
        assert_eq!(
            worst_seat(9, seats_of(&[]), SeatNo(4)),
            Some((SeatNo(5), false))
        );
        assert_eq!(worst_seat(2, seats_of(&[1, 2]), SeatNo(1)), None);
    }

    #[test]
    fn button_and_table_commands() {
        let mut kit = Kit::new(6, 3);
        kit.register_at("A", 1, 1);
        kit.register_at("B", 1, 2);
        kit.ok(Command::SetButton {
            table: TableNo(1),
            seat: SeatNo(4),
        });
        assert_eq!(
            kit.err(Command::SetButton {
                table: TableNo(1),
                seat: SeatNo(4)
            }),
            DomainError::NoChange
        );
        assert_eq!(
            kit.err(Command::SetButton {
                table: TableNo(1),
                seat: SeatNo(7)
            }),
            DomainError::SeatNotFound {
                table: TableNo(1),
                seat: SeatNo(7)
            }
        );
        assert_eq!(
            kit.err(Command::SetButton {
                table: TableNo(2),
                seat: SeatNo(1)
            }),
            DomainError::TableNotOpen { table: TableNo(2) }
        );
        kit.ok(Command::OpenTable { table: TableNo(2) });
        assert_eq!(
            kit.err(Command::OpenTable { table: TableNo(2) }),
            DomainError::TableAlreadyOpen { table: TableNo(2) }
        );
        assert_eq!(kit.table_counts(), vec![2, 0]);
        kit.ok(Command::BreakTable { table: TableNo(2) });
        assert_eq!(
            kit.err(Command::BreakTable { table: TableNo(1) }),
            DomainError::LastTable
        );
        assert_eq!(
            kit.err(Command::OpenTable { table: TableNo(9) }),
            DomainError::TableNotFound { table: TableNo(9) }
        );
    }

    #[test]
    fn break_needs_enough_seats() {
        let mut kit = Kit::new(2, 3);
        for (i, table) in [1u16, 1, 2, 3].into_iter().enumerate() {
            let seat = if i == 1 { 2 } else { 1 };
            kit.register_at(&format!("P{i}"), table, seat);
        }
        // Tables 2 and 3 have one free seat each; table 1 has two players.
        assert!(kit.run(Command::BreakTable { table: TableNo(3) }).is_ok());
        assert_eq!(
            kit.err(Command::BreakTable { table: TableNo(1) }),
            DomainError::NotEnoughSeats {
                needed: 2,
                available: 0
            }
        );
    }

    #[test]
    fn break_sequence_honours_the_configured_order() {
        let mut config = crate::config::Config::new("Unit", 6, 4, 1000);
        config.break_order = vec![TableNo(2)];
        let mut kit = Kit::with_config(config);
        for table in 1..=4 {
            kit.register_at(&format!("P{table}"), table, 1);
        }
        assert_eq!(
            break_sequence(kit.agg.state()),
            vec![TableNo(2), TableNo(4), TableNo(3), TableNo(1)]
        );
    }

    #[test]
    fn final_table_draw_uses_the_final_table_seats() {
        // Nine-seat tables, an eight-handed final table.
        let mut config = crate::config::Config::new("Unit", 9, 2, 1000);
        config.final_table_size = Some(8);
        let mut kit = Kit::with_config(config);
        let players: Vec<PlayerId> = (0..12)
            .map(|i| kit.register_at(&format!("P{i}"), 1 + (i % 2) as u16, 1 + (i / 2) as u8))
            .collect();
        kit.ok(Command::StartClock {});
        for &player in &players[..4] {
            kit.ok(crate::testkit::bust(&[player]));
        }
        assert_eq!(suggestions(kit.agg.state()).final_table, Some(TableNo(1)));
        // Whatever the draw, the eight players take seats 1 to 8: no gap at the table.
        for seed in 0..64 {
            let Event::FinalTableFormed { moves, .. } =
                decide_final_table(kit.agg.state(), TableNo(1), &mut Rng::from_seed(seed)).unwrap()
            else {
                panic!("not a final table draw");
            };
            let mut seats: Vec<u8> = moves.iter().map(|m| m.to.seat.0).collect();
            seats.sort_unstable();
            assert_eq!(seats, (1..=8).collect::<Vec<u8>>(), "seed {seed}");
        }
        // Fewer players than the final table seats: they are drawn among its seats only.
        kit.ok(crate::testkit::bust(&[players[4]]));
        for seed in 0..64 {
            let Event::FinalTableFormed { moves, .. } =
                decide_final_table(kit.agg.state(), TableNo(1), &mut Rng::from_seed(seed)).unwrap()
            else {
                panic!("not a final table draw");
            };
            assert_eq!(moves.len(), 7);
            assert!(moves.iter().all(|m| m.to.seat.0 <= 8), "seed {seed}");
        }
    }

    #[test]
    fn plan_waits_for_buttons_once_started() {
        let mut kit = Kit::new(6, 2);
        for seat in 1..=5 {
            kit.register_at(&format!("A{seat}"), 1, seat);
        }
        kit.register_at("B1", 2, 1);
        // Before the start any player can move to any seat.
        let plan = balance_plan(kit.agg.state());
        assert_eq!(plan.len(), 2);
        assert_eq!(
            (plan[0].from_seat, plan[0].to_seat),
            (Some(SeatNo(5)), Some(SeatNo(2)))
        );
        kit.ok(Command::StartClock {});
        let plan = balance_plan(kit.agg.state());
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].needs_button, vec![TableNo(1), TableNo(2)]);
        assert_eq!((plan[0].player, plan[0].to_seat), (None, None));
        assert_eq!(plan[1].needs_button, vec![TableNo(1), TableNo(2)]);
        assert_eq!((plan[1].player, plan[1].to_seat), (None, None));
        // With the donor's button only, the player is known but not the seat.
        kit.ok(Command::SetButton {
            table: TableNo(1),
            seat: SeatNo(1),
        });
        let plan = balance_plan(kit.agg.state());
        assert_eq!(plan[0].needs_button, vec![TableNo(2)]);
        assert_eq!(
            (plan[0].from_seat, plan[0].to_seat),
            (Some(SeatNo(3)), None)
        );
        assert_eq!(plan[1].from_seat, Some(SeatNo(4)));
    }
}
