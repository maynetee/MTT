//! Deals: the remaining players agree on how to share what the remaining places pay.
//!
//! A deal needs the entries closed and the payouts locked, so what it shares can no longer
//! move. It fixes the prize of every player in it; the tournament goes on (busts still
//! give places, for the title and `play_for`, which the winner adds to their share) and
//! finishes as usual.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::error::DomainError;
use crate::event::Event;
use crate::ids::PlayerId;
use crate::money::Money;
use crate::payouts;
use crate::purchase;
use crate::state::{Phase, State};

/// What one player takes in a deal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct DealShare {
    pub player: PlayerId,
    pub amount: Money,
}

/// A recorded deal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Deal {
    /// One share per player still in when the deal was made.
    pub amounts: Vec<DealShare>,
    /// Left for the winner, on top of their share.
    pub play_for: Money,
}

/// `RecordDeal`: every remaining player gets an amount; the amounts plus `play_for` must
/// add up to what the remaining places pay.
pub(crate) fn decide_deal(
    state: &State,
    amounts: &[DealShare],
    play_for: Option<Money>,
    now_ms: i64,
) -> Result<Event, DomainError> {
    if !state.config.payouts {
        return Err(DomainError::PayoutsDisabled);
    }
    match state.phase {
        Phase::Setup => return Err(DomainError::NotStarted),
        Phase::Finished { .. } => return Err(DomainError::TournamentFinished),
        Phase::Running => {}
    }
    if state.config.money.is_none() {
        return Err(DomainError::MoneyNotConfigured);
    }
    if state.deal.is_some() {
        return Err(DomainError::DealAlreadyRecorded);
    }
    if purchase::entries_open(state, now_ms) {
        return Err(DomainError::LateRegOpen);
    }
    let Some(locked) = &state.payouts_locked else {
        return Err(DomainError::PayoutsNotLocked);
    };
    let play_for = play_for.unwrap_or(Money::ZERO);
    let mut seen = BTreeSet::new();
    let mut actual = play_for;
    for share in amounts {
        let player = share.player;
        if !seen.insert(player) {
            return Err(DomainError::DuplicatePlayer { player });
        }
        let found = state
            .player(player)
            .ok_or(DomainError::PlayerNotFound { player })?;
        if !found.is_alive() {
            return Err(DomainError::PlayerNotActive { player });
        }
        actual = actual
            .checked_add(share.amount)
            .filter(|_| share.amount.is_valid() && play_for.is_valid())
            .ok_or(DomainError::InvalidDealAmount)?;
    }
    if let Some(missing) = state
        .players
        .values()
        .find(|p| p.is_alive() && !seen.contains(&p.id))
    {
        return Err(DomainError::DealPlayerMissing { player: missing.id });
    }
    let expected = (1..=seen.len() as u32)
        .map(|place| payouts::amount_at(&locked.amounts, place))
        .fold(Money::ZERO, Money::saturating_add);
    if actual != expected {
        return Err(DomainError::DealSumMismatch { expected, actual });
    }
    Ok(Event::DealRecorded {
        amounts: amounts.to_vec(),
        play_for,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::Command;
    use crate::config::{Config, MoneyConfig};
    use crate::testkit::{Kit, bust};

    /// Five players at EUR 100, 3 places paid: 25000, 15000, 10000 (custom shares).
    fn kit() -> (Kit, Vec<PlayerId>) {
        let mut kit = Kit::with_config(Config {
            places_paid: 3,
            payout: crate::config::PayoutConfig {
                places_paid: None,
                amounts: Some(crate::config::PayoutAmounts::CustomBps {
                    bps: vec![5_000, 3_000, 2_000],
                }),
            },
            money: Some(MoneyConfig::new("EUR", 2, 10_000, 1_000)),
            ..Config::new("Unit", 9, 1, 10_000)
        });
        let ids = (0..5).map(|i| kit.register(&format!("P{i}"))).collect();
        (kit, ids)
    }

    fn deal(shares: &[(PlayerId, i64)], play_for: Option<i64>) -> Command {
        Command::RecordDeal {
            amounts: shares
                .iter()
                .map(|&(player, amount)| DealShare {
                    player,
                    amount: Money(amount),
                })
                .collect(),
            play_for: play_for.map(Money),
        }
    }

    #[test]
    fn a_deal_needs_closed_entries_and_locked_payouts() {
        let (mut kit, ids) = kit();
        let three = |a, b, c| deal(&[(ids[0], a), (ids[1], b), (ids[2], c)], None);
        assert_eq!(kit.err(three(1, 1, 1)), DomainError::NotStarted);
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[ids[4]]));
        kit.ok(bust(&[ids[3]]));
        assert_eq!(kit.err(three(1, 1, 1)), DomainError::LateRegOpen);
        kit.ok(Command::CloseRegistration {});
        assert_eq!(kit.err(three(1, 1, 1)), DomainError::PayoutsNotLocked);
        kit.ok(Command::LockPayouts {});
        assert_eq!(
            kit.err(deal(&[(ids[0], 1), (ids[0], 1)], None)),
            DomainError::DuplicatePlayer { player: ids[0] }
        );
        assert_eq!(
            kit.err(deal(&[(ids[3], 1)], None)),
            DomainError::PlayerNotActive { player: ids[3] }
        );
        assert_eq!(
            kit.err(deal(&[(ids[0], 1), (ids[1], 1)], None)),
            DomainError::DealPlayerMissing { player: ids[2] }
        );
        assert_eq!(kit.err(three(-1, 1, 1)), DomainError::InvalidDealAmount);
        assert_eq!(
            kit.err(three(20_000, 15_000, 10_000)),
            DomainError::DealSumMismatch {
                expected: Money(50_000),
                actual: Money(45_000)
            }
        );
        kit.ok(three(20_000, 17_000, 13_000));
        assert_eq!(
            kit.err(three(20_000, 17_000, 13_000)),
            DomainError::DealAlreadyRecorded
        );
    }

    #[test]
    fn deal_fixes_prizes_and_the_winner_takes_what_is_left() {
        let (mut kit, ids) = kit();
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[ids[4]]));
        kit.ok(bust(&[ids[3]]));
        kit.ok(Command::CloseRegistration {});
        kit.ok(Command::LockPayouts {});
        let shares = [(ids[0], 16_000), (ids[1], 16_000), (ids[2], 16_000)];
        kit.ok(deal(&shares, Some(2_000)));
        let prize = |kit: &Kit, id| {
            let view = kit.agg.view(kit.now);
            view.ranking.iter().find(|r| r.player == id).unwrap().prize
        };
        // Still playing, but the share is theirs.
        assert_eq!(prize(&kit, ids[0]), Some(Money(16_000)));
        let view = kit.agg.view(kit.now);
        assert_eq!(view.itm, crate::view::Itm::InMoney { next_payout: None });
        let recorded = view.money.unwrap().deal.unwrap();
        assert_eq!(
            (recorded.amounts.len(), recorded.play_for),
            (3, Money(2_000))
        );
        // Busts still give places; the prizes follow the deal.
        kit.ok(bust(&[ids[2]]));
        assert_eq!(prize(&kit, ids[2]), Some(Money(16_000)));
        kit.ok(bust(&[ids[0]]));
        assert_eq!(kit.agg.state().phase, Phase::Finished { winner: ids[1] });
        assert_eq!(prize(&kit, ids[1]), Some(Money(18_000)));
        assert_eq!(prize(&kit, ids[0]), Some(Money(16_000)));
    }

    #[test]
    fn a_deal_freezes_what_it_shares() {
        let (mut kit, ids) = kit();
        let seat = kit.seat_of(ids[4]).unwrap();
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[ids[4]]));
        kit.ok(bust(&[ids[3]]));
        kit.ok(Command::CloseRegistration {});
        kit.ok(Command::LockPayouts {});
        kit.ok(deal(
            &[(ids[0], 25_000), (ids[1], 15_000), (ids[2], 10_000)],
            None,
        ));
        for cmd in [
            Command::UnlockPayouts {},
            Command::LockPayouts {},
            Command::ReopenRegistration {},
            Command::RevivePlayer {
                player: ids[4],
                seat,
            },
        ] {
            assert_eq!(kit.err(cmd), DomainError::DealAlreadyRecorded);
        }
        kit.ok(Command::Undo {});
        kit.ok(Command::UnlockPayouts {});
    }

    #[test]
    fn no_deal_without_payouts() {
        let (mut kit, ids) = kit();
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[ids[4]]));
        kit.ok(bust(&[ids[3]]));
        kit.ok(Command::CloseRegistration {});
        let mut config = kit.agg.state().config.clone();
        config.payouts = false;
        kit.ok(Command::UpdateConfig { config });
        assert_eq!(
            kit.err(deal(
                &[(ids[0], 25_000), (ids[1], 15_000), (ids[2], 10_000)],
                None
            )),
            DomainError::PayoutsDisabled
        );
    }

    #[test]
    fn a_deal_keeps_the_payouts_on() {
        let (mut kit, ids) = kit();
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[ids[4]]));
        kit.ok(bust(&[ids[3]]));
        kit.ok(Command::CloseRegistration {});
        kit.ok(Command::LockPayouts {});
        kit.ok(deal(
            &[(ids[0], 25_000), (ids[1], 15_000), (ids[2], 10_000)],
            None,
        ));
        let mut config = kit.agg.state().config.clone();
        config.payouts = false;
        assert_eq!(
            kit.err(Command::UpdateConfig { config }),
            DomainError::PayoutsLocked
        );
    }
}
