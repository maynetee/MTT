//! Finishing places, derived from the order of bust groups in the log.
//!
//! With `N` registered players, the earliest bust group takes the lowest places. Inside a
//! group (one hand) the player who started the hand with more chips finishes higher and
//! equal stacks tie. A player's latest bust counts, so re-entries only need to move the
//! player out of the busted set.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::ids::{BustGroup, PlayerId};
use crate::money::Chips;
use crate::state::{Phase, PlayerStatus, State};

/// A finishing place. `place_to > place` for ties (e.g. 3..4 shared).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub place: u32,
    pub place_to: u32,
}

/// Places of busted players and, once finished, the winner.
pub fn placements(state: &State) -> BTreeMap<PlayerId, Placement> {
    let total = state.players.len() as u32;
    let mut groups: BTreeMap<BustGroup, Vec<(PlayerId, Option<Chips>)>> = BTreeMap::new();
    for player in state.players.values() {
        if let PlayerStatus::Busted {
            group, start_stack, ..
        } = player.status
        {
            groups
                .entry(group)
                .or_default()
                .push((player.id, start_stack));
        }
    }
    let mut out = BTreeMap::new();
    let mut before = 0u32;
    for members in groups.values() {
        let size = members.len() as u32;
        let top = total.saturating_sub(before).saturating_sub(size) + 1;
        for &(id, stack) in members {
            let better = members.iter().filter(|(_, s)| *s > stack).count() as u32;
            let equal = members.iter().filter(|(_, s)| *s == stack).count() as u32;
            let place = top + better;
            out.insert(
                id,
                Placement {
                    place,
                    place_to: place + equal - 1,
                },
            );
        }
        before += size;
    }
    if let Phase::Finished { winner } = state.phase {
        out.insert(
            winner,
            Placement {
                place: 1,
                place_to: 1,
            },
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{BustInput, Command};
    use crate::testkit::{Kit, bust};

    fn place(state: &State, player: PlayerId) -> (u32, u32) {
        let p = placements(state)[&player];
        (p.place, p.place_to)
    }

    fn started(n: usize) -> (Kit, Vec<PlayerId>) {
        let mut kit = Kit::new(9, 2);
        let ids = (0..n).map(|i| kit.register(&format!("P{i}"))).collect();
        kit.ok(Command::StartClock {});
        (kit, ids)
    }

    #[test]
    fn earlier_busts_take_lower_places() {
        let (mut kit, ids) = started(6);
        kit.ok(bust(&[ids[0]]));
        kit.ok(bust(&[ids[1]]));
        let state = kit.agg.state();
        assert_eq!(place(state, ids[0]), (6, 6));
        assert_eq!(place(state, ids[1]), (5, 5));
        assert_eq!(placements(state).len(), 2);
    }

    #[test]
    fn same_hand_ties_without_stacks() {
        let (mut kit, ids) = started(6);
        kit.ok(bust(&[ids[0], ids[1], ids[2]]));
        let state = kit.agg.state();
        for id in &ids[..3] {
            assert_eq!(place(state, *id), (4, 6));
        }
    }

    #[test]
    fn same_hand_equal_stacks_tie_and_larger_stacks_finish_higher() {
        let (mut kit, ids) = started(6);
        let stacks = [(ids[0], 500), (ids[1], 900), (ids[2], 500)];
        kit.ok(Command::BustPlayers {
            busts: stacks
                .iter()
                .map(|&(player, s)| BustInput {
                    player,
                    start_stack: Some(Chips(s)),
                })
                .collect(),
        });
        let state = kit.agg.state();
        assert_eq!(place(state, ids[1]), (4, 4));
        assert_eq!(place(state, ids[0]), (5, 6));
        assert_eq!(place(state, ids[2]), (5, 6));
    }

    #[test]
    fn late_registrations_push_earlier_busts_down() {
        let (mut kit, ids) = started(3);
        kit.ok(bust(&[ids[0]]));
        assert_eq!(place(kit.agg.state(), ids[0]), (3, 3));
        kit.register("Late");
        assert_eq!(place(kit.agg.state(), ids[0]), (4, 4));
    }

    #[test]
    fn revived_players_leave_the_ranking() {
        let (mut kit, ids) = started(4);
        let seat = kit.seat_of(ids[0]).unwrap();
        kit.ok(bust(&[ids[0]]));
        kit.ok(bust(&[ids[1]]));
        kit.ok(Command::RevivePlayer {
            player: ids[0],
            seat,
        });
        let state = kit.agg.state();
        assert_eq!(placements(state).len(), 1);
        assert_eq!(place(state, ids[1]), (4, 4));
    }
}
