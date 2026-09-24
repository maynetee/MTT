//! Eliminations, corrections and the end of the tournament.

use std::collections::BTreeSet;

use crate::clock;
use crate::command::BustInput;
use crate::error::DomainError;
use crate::event::{Bust, Event, Finish};
use crate::ids::{BustGroup, PlayerId, SeatRef};
use crate::state::{Phase, State};
use crate::{purchase, registration};

fn require_running(state: &State) -> Result<(), DomainError> {
    match state.phase {
        Phase::Setup => Err(DomainError::NotStarted),
        Phase::Running => Ok(()),
        Phase::Finished { .. } => Err(DomainError::TournamentFinished),
    }
}

/// `BustPlayers`: one hand, one bust group. Finishes the tournament when a single
/// player remains and no entry can arrive any more (registration and re-entry closed).
pub(crate) fn decide_bust(
    state: &State,
    inputs: &[BustInput],
    now_ms: i64,
) -> Result<Event, DomainError> {
    require_running(state)?;
    if inputs.is_empty() {
        return Err(DomainError::EmptyBust);
    }
    let mut seen = BTreeSet::new();
    let mut busts = Vec::with_capacity(inputs.len());
    for input in inputs {
        let player = input.player;
        if !seen.insert(player) {
            return Err(DomainError::DuplicatePlayer { player });
        }
        let seat = state
            .player(player)
            .ok_or(DomainError::PlayerNotFound { player })?
            .seat()
            .ok_or(DomainError::PlayerNotActive { player })?;
        if input.start_stack.is_some_and(|s| !s.is_positive()) {
            return Err(DomainError::InvalidStack { player });
        }
        busts.push(Bust {
            player,
            start_stack: input.start_stack,
            seat,
        });
    }
    let with_stack = busts.iter().filter(|b| b.start_stack.is_some()).count();
    if busts.len() > 1 && with_stack != 0 && with_stack != busts.len() {
        return Err(DomainError::BustStackRequired);
    }
    let alive = state.alive_count();
    if busts.len() >= alive {
        return Err(DomainError::LastPlayerStanding);
    }
    let finish = if alive - busts.len() == 1 && !purchase::entries_open(state, now_ms) {
        state
            .players
            .values()
            .find(|p| p.is_alive() && !seen.contains(&p.id))
            .map(|p| Finish {
                winner: p.id,
                clock: clock::paused_at(&state.clock, &state.structure, now_ms),
            })
    } else {
        None
    };
    Ok(Event::PlayersBusted {
        group: BustGroup(state.next_bust_group),
        busts,
        finish,
    })
}

/// `RevivePlayer`: puts a busted player back at `seat`. Not a re-entry.
pub(crate) fn decide_revive(
    state: &State,
    player: PlayerId,
    seat: SeatRef,
) -> Result<Event, DomainError> {
    require_running(state)?;
    let found = state
        .player(player)
        .ok_or(DomainError::PlayerNotFound { player })?;
    if found.is_alive() {
        return Err(DomainError::PlayerNotBusted { player });
    }
    registration::check_free_seat(state, seat)?;
    Ok(Event::PlayerRevived { player, seat })
}

/// `FinishTournament`: needed when the last bust happened while registration was open.
pub(crate) fn decide_finish(state: &State, now_ms: i64) -> Result<Event, DomainError> {
    require_running(state)?;
    let Some(winner) = state.sole_survivor() else {
        return Err(DomainError::AliveNotOne {
            alive: state.alive_count() as u32,
        });
    };
    if purchase::entries_open(state, now_ms) {
        return Err(DomainError::LateRegOpen);
    }
    Ok(Event::TournamentFinished {
        finish: Finish {
            winner,
            clock: clock::paused_at(&state.clock, &state.structure, now_ms),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{BustInput, Command};
    use crate::money::Chips;
    use crate::testkit::{Kit, bust};
    use crate::warning::Warning;

    fn started(n: usize) -> (Kit, Vec<PlayerId>) {
        let mut kit = Kit::new(9, 2);
        let ids = (0..n).map(|i| kit.register(&format!("P{i}"))).collect();
        kit.ok(Command::StartClock {});
        (kit, ids)
    }

    fn with_stacks(busts: &[(PlayerId, Option<i64>)]) -> Command {
        Command::BustPlayers {
            busts: busts
                .iter()
                .map(|&(player, stack)| BustInput {
                    player,
                    start_stack: stack.map(Chips),
                })
                .collect(),
        }
    }

    #[test]
    fn bust_requires_a_started_tournament() {
        let mut kit = Kit::new(9, 1);
        let a = kit.register("A");
        kit.register("B");
        assert_eq!(kit.err(bust(&[a])), DomainError::NotStarted);
    }

    #[test]
    fn bust_validates_its_players() {
        let (mut kit, ids) = started(4);
        assert_eq!(kit.err(bust(&[])), DomainError::EmptyBust);
        assert_eq!(
            kit.err(bust(&[ids[0], ids[0]])),
            DomainError::DuplicatePlayer { player: ids[0] }
        );
        assert_eq!(
            kit.err(bust(&[PlayerId(99)])),
            DomainError::PlayerNotFound {
                player: PlayerId(99)
            }
        );
        assert_eq!(
            kit.err(with_stacks(&[(ids[0], Some(100)), (ids[1], None)])),
            DomainError::BustStackRequired
        );
        assert_eq!(
            kit.err(with_stacks(&[(ids[0], Some(0))])),
            DomainError::InvalidStack { player: ids[0] }
        );
        kit.ok(bust(&[ids[0]]));
        assert_eq!(
            kit.err(bust(&[ids[0]])),
            DomainError::PlayerNotActive { player: ids[0] }
        );
    }

    #[test]
    fn last_bust_finishes_only_when_registration_is_closed() {
        let (mut kit, ids) = started(3);
        kit.ok(bust(&[ids[0]]));
        kit.ok(bust(&[ids[1]]));
        assert_eq!(kit.agg.state().phase, Phase::Running);
        assert!(
            kit.agg
                .view(kit.now)
                .warnings
                .contains(&Warning::FinishPending)
        );
        assert_eq!(
            kit.err(Command::FinishTournament {}),
            DomainError::LateRegOpen
        );
        kit.ok(Command::CloseRegistration {});
        assert_eq!(kit.agg.state().phase, Phase::Finished { winner: ids[2] });
    }

    #[test]
    fn finish_command_needs_a_single_survivor() {
        let (mut kit, ids) = started(3);
        kit.ok(Command::CloseRegistration {});
        assert_eq!(
            kit.err(Command::FinishTournament {}),
            DomainError::AliveNotOne { alive: 3 }
        );
        kit.ok(bust(&[ids[0], ids[1]]));
        assert_eq!(kit.agg.state().phase, Phase::Finished { winner: ids[2] });
    }

    #[test]
    fn revive_puts_a_busted_player_back() {
        let (mut kit, ids) = started(3);
        let seat = kit.seat_of(ids[0]).unwrap();
        assert_eq!(
            kit.err(Command::RevivePlayer {
                player: ids[0],
                seat
            }),
            DomainError::PlayerNotBusted { player: ids[0] }
        );
        kit.ok(bust(&[ids[0]]));
        let taken = kit.seat_of(ids[1]).unwrap();
        assert_eq!(
            kit.err(Command::RevivePlayer {
                player: ids[0],
                seat: taken
            }),
            DomainError::SeatOccupied {
                table: taken.table,
                seat: taken.seat
            }
        );
        kit.ok(Command::RevivePlayer {
            player: ids[0],
            seat,
        });
        assert_eq!(kit.seat_of(ids[0]), Some(seat));
        assert_eq!(kit.agg.state().alive_count(), 3);
    }
}
