//! Seats and tables: manual moves.

use crate::command::MoveReason;
use crate::error::DomainError;
use crate::event::Event;
use crate::ids::{PlayerId, SeatRef};
use crate::registration::check_free_seat;
use crate::state::State;

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
}
