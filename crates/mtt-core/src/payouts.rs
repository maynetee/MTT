//! Prize pool and payouts.
//!
//! Pool: every amount comes from the events (the price recorded with each entry), never
//! from the current configuration, so editing the buy-in never rewrites what was paid.
//!
//! Payouts: the places paid come from the rule (`PlacesPaid`, or `Config.places_paid`),
//! capped by the number of players; the effective pool is split by a curve or a custom
//! table, floored to the rounding unit, the remainder going to first place. When the last
//! payout falls below the minimum cash (or to zero), fewer places are paid.
//!
//! Floats: the curve weights are the only float computation here (`libm`, so native and
//! WASM give the same bits); they become integer weights at once and never reach the
//! state, the events or the view.

use std::collections::BTreeMap;

use crate::config::{BPS, Config, PayoutAmounts, PlacesPaid};
use crate::error::DomainError;
use crate::event::Event;
use crate::ids::PlayerId;
use crate::money::Money;
use crate::ranking::{self, Placement};
use crate::state::{Phase, State};

/// Prize pool totals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pool {
    /// Sum of the prize parts paid.
    pub prize: Money,
    /// Sum of the fees paid (not in the prize pool).
    pub fees: Money,
    pub guarantee: Option<Money>,
    /// Paid by the house: guarantee minus prize pool, when positive.
    pub overlay: Money,
    /// What the payouts distribute: the larger of the prize pool and the guarantee.
    pub effective: Money,
}

/// Prize pool of the current state.
pub fn pool(state: &State) -> Pool {
    let (prize, fees) =
        state
            .players
            .values()
            .fold((Money::ZERO, Money::ZERO), |(prize, fees), p| {
                (
                    prize.saturating_add(p.prize_paid),
                    fees.saturating_add(p.fees_paid),
                )
            });
    let guarantee = state.config.money.as_ref().and_then(|m| m.guarantee);
    let effective = guarantee.map_or(prize, |g| g.max(prize));
    Pool {
        prize,
        fees,
        guarantee,
        overlay: Money(effective.0 - prize.0),
        effective,
    }
}

/// Entries so far (first entries plus re-entries).
pub fn entries(state: &State) -> u32 {
    state.players.values().map(|p| u32::from(p.entries)).sum()
}

/// Places the configuration pays for `entries` entries and `players` unique players,
/// before any minimum-cash reduction: at least 1, at most `players`.
pub fn rule_places(config: &Config, entries: u32, players: u32) -> u32 {
    let wanted = match &config.payout.amounts {
        Some(PayoutAmounts::CustomBps { bps }) => bps.len() as u32,
        Some(PayoutAmounts::CustomAmounts { amounts }) => amounts.len() as u32,
        _ => match config.payout.places_paid {
            None => u32::from(config.places_paid),
            Some(PlacesPaid::Fixed { n }) => u32::from(n),
            Some(PlacesPaid::Percent { bps }) => {
                let scaled = u64::from(entries) * u64::from(bps);
                scaled.div_ceil(u64::from(BPS)) as u32
            }
        },
    };
    wanted.max(1).min(players)
}

/// Default first-place share in basis points for `places` places paid.
pub fn default_first_share_bps(places: u32) -> u16 {
    match places {
        0 | 1 => 10_000,
        2 => 6_500,
        3 => 5_000,
        4..=5 => 4_000,
        6..=9 => 3_000,
        10..=27 => 2_500,
        _ => 2_000,
    }
}

/// Places-paid ranges sharing a default first-place share, ascending.
const DEFAULT_SHARE_BRACKETS: [(u32, u32); 7] = [
    (1, 1),
    (2, 2),
    (3, 3),
    (4, 5),
    (6, 9),
    (10, 27),
    (28, u32::MAX),
];

/// Resolution of the curve weights (2^40).
const CURVE_SCALE: f64 = (1u64 << 40) as f64;
/// Largest curve exponent.
const MAX_ALPHA: f64 = 20.0;

/// Integer curve weights for `places` places giving first place `first_share_bps`:
/// `w_i = i^-a` with `a` in `[0, 20]` found by 64 bisection steps so that
/// `w_1 / sum(w) = share` (flat when `share <= 1 / places`). Non-increasing, sum at most
/// 2^40. Floats never leave this function.
pub fn curve_weights(places: usize, first_share_bps: u16) -> Vec<u64> {
    if places == 0 {
        return Vec::new();
    }
    if u64::from(first_share_bps) * places as u64 <= u64::from(BPS) {
        return vec![1; places];
    }
    let share = f64::from(first_share_bps) / f64::from(BPS);
    // i^-a = exp(-a ln i), with the logarithms computed once.
    let logs: Vec<f64> = (1..=places).map(|i| libm::log(i as f64)).collect();
    let weights = |alpha: f64| logs.iter().map(move |&ln| libm::exp(-alpha * ln));
    let (mut lo, mut hi) = (0.0, MAX_ALPHA);
    for _ in 0..64 {
        let mid = 0.5 * (lo + hi);
        let first = 1.0 / weights(mid).sum::<f64>();
        if first < share {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let alpha = 0.5 * (lo + hi);
    let total: f64 = weights(alpha).sum();
    let mut previous = u64::MAX;
    weights(alpha)
        .map(|w| {
            // `as` saturates (NaN gives 0): always a valid integer.
            let part = libm::floor(w / total * CURVE_SCALE) as u64;
            previous = previous.min(part);
            previous
        })
        .collect()
}

/// Splits `pool` by `weights`: each share floored to a multiple of `unit`, the remainder
/// to first place. Sums exactly to `pool`; non-increasing when the weights are.
pub fn split(pool: Money, weights: &[u64], unit: Money) -> Vec<Money> {
    if weights.is_empty() {
        return Vec::new();
    }
    let total: u128 = weights.iter().map(|&w| u128::from(w)).sum();
    let (amount, unit) = (pool.0.max(0) as u128, unit.0.max(1) as u128);
    let mut out: Vec<Money> = weights
        .iter()
        .map(|&w| {
            let raw = if total == 0 {
                0
            } else {
                amount * u128::from(w) / total
            };
            Money((raw / unit * unit) as i64)
        })
        .collect();
    let rest = pool.0 - out.iter().map(|m| m.0).sum::<i64>();
    out[0] = Money(out[0].0 + rest);
    out
}

/// Payouts derived from a pool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayoutTable {
    /// Amount per place, first place first.
    pub amounts: Vec<Money>,
    /// Places the rule wanted, when the minimum cash made the table shorter.
    pub reduced_from: Option<u32>,
}

/// Largest `m <= places` satisfying `pays`, which must hold at `lo` and be monotone
/// inside each bracket (with a fixed first share, the last payout shrinks as places grow).
fn largest_paying(places: u32, brackets: &[(u32, u32)], pays: impl Fn(u32) -> bool) -> u32 {
    for &(lo, hi) in brackets.iter().rev() {
        if lo > places || !pays(lo) {
            continue;
        }
        let (mut good, mut bad) = (lo, hi.min(places) + 1);
        while bad - good > 1 {
            let mid = good + (bad - good) / 2;
            if pays(mid) {
                good = mid;
            } else {
                bad = mid;
            }
        }
        return good;
    }
    1
}

/// Payouts of `pool` over `places` places. Curves and custom shares pay fewer places
/// while the last payout is below `min_cash` (or zero); custom amounts are paid as
/// configured.
pub fn compute(
    pool: Money,
    places: u32,
    amounts: Option<&PayoutAmounts>,
    unit: Money,
    min_cash: Option<Money>,
) -> PayoutTable {
    let places = match amounts {
        Some(PayoutAmounts::CustomAmounts { amounts }) => {
            return PayoutTable {
                amounts: amounts.iter().take(places as usize).copied().collect(),
                reduced_from: None,
            };
        }
        // A custom table pays at most its length.
        Some(PayoutAmounts::CustomBps { bps }) => places.min(bps.len() as u32),
        _ => places,
    };
    let weights = |m: u32| -> Vec<u64> {
        match amounts {
            Some(PayoutAmounts::CustomBps { bps }) => {
                bps.iter().take(m as usize).map(|&b| u64::from(b)).collect()
            }
            Some(PayoutAmounts::Curve {
                first_share_bps: Some(share),
            }) => curve_weights(m as usize, *share),
            _ => curve_weights(m as usize, default_first_share_bps(m)),
        }
    };
    let table = |m: u32| split(pool, &weights(m), unit);
    let threshold = min_cash.unwrap_or(Money::ZERO).max(Money(1));
    let pays = |m: u32| table(m).last().is_some_and(|&last| last >= threshold);
    if places <= 1 || pool.0 <= 0 || pays(places) {
        return PayoutTable {
            amounts: table(places),
            reduced_from: None,
        };
    }
    let default_curve = matches!(
        amounts,
        None | Some(PayoutAmounts::Curve {
            first_share_bps: None
        })
    );
    let brackets: &[(u32, u32)] = if default_curve {
        &DEFAULT_SHARE_BRACKETS
    } else {
        &[(1, u32::MAX)]
    };
    let paid = largest_paying(places, brackets, pays);
    PayoutTable {
        amounts: table(paid),
        reduced_from: Some(places),
    }
}

/// Payouts derived from the current pool and configuration (ignoring any lock), when
/// money is tracked.
pub fn derived(state: &State) -> Option<PayoutTable> {
    let money = state.config.money.as_ref()?;
    let places = rule_places(&state.config, entries(state), state.players.len() as u32);
    Some(compute(
        pool(state).effective,
        places,
        state.config.payout.amounts.as_ref(),
        money.rounding_unit,
        money.min_cash,
    ))
}

/// Payouts in force: the locked table, else the derived one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InForce {
    /// Amount per place (empty without money tracking).
    pub amounts: Vec<Money>,
    /// Places paid (also without money tracking), capped by the number of players.
    pub places_paid: u32,
    pub locked: bool,
    /// Table derived from the current pool, when money is tracked.
    pub derived: Option<PayoutTable>,
}

/// Payouts in force in `state`.
pub fn in_force(state: &State) -> InForce {
    let players = state.players.len() as u32;
    let derived = derived(state);
    match (&state.payouts_locked, &derived) {
        (Some(locked), _) => InForce {
            amounts: locked.amounts.clone(),
            places_paid: (locked.amounts.len() as u32).min(players),
            locked: true,
            derived,
        },
        (None, Some(table)) => InForce {
            amounts: table.amounts.clone(),
            places_paid: table.amounts.len() as u32,
            locked: false,
            derived,
        },
        (None, None) => InForce {
            amounts: Vec::new(),
            places_paid: rule_places(&state.config, entries(state), players),
            locked: false,
            derived,
        },
    }
}

/// Amount of `place` (1-based) in `amounts`, zero beyond the places paid.
pub fn amount_at(amounts: &[Money], place: u32) -> Money {
    (place as usize)
        .checked_sub(1)
        .and_then(|i| amounts.get(i))
        .copied()
        .unwrap_or(Money::ZERO)
}

/// Prize of every placed player. Players tied over `[p, p + c - 1]` share the amounts of
/// those places (zero beyond the places paid): each gets the floor of the share and the
/// leftover minor units go one each by ascending player id. A deal sets the prize of its
/// players (placed or not), the winner adding what was left to play for.
pub fn prizes(state: &State, amounts: &[Money]) -> BTreeMap<PlayerId, Money> {
    let mut clusters: BTreeMap<Placement, Vec<PlayerId>> = BTreeMap::new();
    // Placements iterate by ascending player id, so each cluster is sorted.
    for (player, placement) in ranking::placements(state) {
        clusters.entry(placement).or_default().push(player);
    }
    let mut out = BTreeMap::new();
    for (placement, members) in clusters {
        let total: i64 = (placement.place..=placement.place_to)
            .map(|place| amount_at(amounts, place).0)
            .sum();
        let count = members.len() as i64;
        let (each, leftover) = (total / count, total % count);
        for (i, player) in members.into_iter().enumerate() {
            let extra = i64::from((i as i64) < leftover);
            out.insert(player, Money(each + extra));
        }
    }
    if let Some(deal) = &state.deal {
        let winner = match state.phase {
            Phase::Finished { winner } => Some(winner),
            _ => None,
        };
        for share in &deal.amounts {
            let bonus = if winner == Some(share.player) {
                deal.play_for
            } else {
                Money::ZERO
            };
            out.insert(share.player, share.amount.saturating_add(bonus));
        }
    }
    out
}

/// `LockPayouts`: freezes the payouts derived now; later entries leave them unchanged
/// (the view warns `PAYOUTS_STALE`).
pub(crate) fn decide_lock(state: &State) -> Result<Event, DomainError> {
    let Some(table) = derived(state) else {
        return Err(DomainError::MoneyNotConfigured);
    };
    if state.players.is_empty() {
        return Err(DomainError::NoEntries);
    }
    if state
        .payouts_locked
        .as_ref()
        .is_some_and(|locked| locked.amounts == table.amounts)
    {
        return Err(DomainError::NoChange);
    }
    Ok(Event::PayoutsLocked {
        amounts: table.amounts,
        pool: pool(state).effective,
    })
}

/// `UnlockPayouts`: payouts follow the pool again.
pub(crate) fn decide_unlock(state: &State) -> Result<Event, DomainError> {
    if state.payouts_locked.is_none() {
        return Err(DomainError::PayoutsNotLocked);
    }
    Ok(Event::PayoutsUnlocked {})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::Command;
    use crate::config::{Config, MoneyConfig, PayoutConfig};
    use crate::testkit::{Kit, bust};
    use crate::warning::Warning;

    fn money_kit(guarantee: Option<i64>) -> Kit {
        let mut money = MoneyConfig::new("EUR", 2, 10_000, 1_000);
        money.guarantee = guarantee.map(Money);
        Kit::with_config(Config {
            money: Some(money),
            ..Config::new("Unit", 9, 2, 10_000)
        })
    }

    fn sum(amounts: &[Money]) -> i64 {
        amounts.iter().map(|m| m.0).sum()
    }

    fn non_increasing(amounts: &[Money]) -> bool {
        amounts.windows(2).all(|w| w[0] >= w[1])
    }

    fn money(values: &[i64]) -> Vec<Money> {
        values.iter().copied().map(Money).collect()
    }

    #[test]
    fn pool_sums_the_recorded_prices() {
        let mut kit = money_kit(None);
        kit.register("A");
        kit.register("B");
        let p = pool(kit.agg.state());
        assert_eq!((p.prize, p.fees), (Money(20_000), Money(2_000)));
        assert_eq!((p.overlay, p.effective), (Money(0), Money(20_000)));
        // A new buy-in only applies to later entries.
        let mut config = kit.agg.state().config.clone();
        if let Some(m) = config.money.as_mut() {
            m.buy_in.prize = Money(5_000);
        }
        kit.ok(Command::UpdateConfig { config });
        kit.register("C");
        assert_eq!(pool(kit.agg.state()).prize, Money(25_000));
    }

    #[test]
    fn guarantee_covers_a_small_pool() {
        let mut kit = money_kit(Some(50_000));
        let a = kit.register("A");
        kit.register("B");
        let p = pool(kit.agg.state());
        assert_eq!((p.overlay, p.effective), (Money(30_000), Money(50_000)));
        kit.ok(Command::Unregister { player: a });
        let p = pool(kit.agg.state());
        assert_eq!(
            (p.prize, p.fees, p.overlay),
            (Money(10_000), Money(1_000), Money(40_000))
        );
        for name in ["C", "D", "E", "F", "G"] {
            kit.register(name);
        }
        let p = pool(kit.agg.state());
        assert_eq!((p.overlay, p.effective), (Money(0), Money(60_000)));
    }

    #[test]
    fn unregister_refunds_what_was_paid() {
        let mut kit = money_kit(None);
        let a = kit.register("A");
        kit.ok(Command::Unregister { player: a });
        let refund = match &kit.agg.events().last().unwrap().event {
            crate::event::Event::PlayerUnregistered { refund, .. } => *refund,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(
            refund,
            Some(crate::money::Price {
                prize: Money(10_000),
                fee: Money(1_000)
            })
        );
    }

    #[test]
    fn places_paid_rules() {
        let with = |places_paid, amounts| Config {
            places_paid: 3,
            payout: PayoutConfig {
                places_paid,
                amounts,
            },
            ..Config::new("Unit", 9, 2, 10_000)
        };
        let legacy = with(None, None);
        assert_eq!(rule_places(&legacy, 10, 10), 3);
        assert_eq!(rule_places(&legacy, 10, 2), 2);
        assert_eq!(rule_places(&legacy, 0, 0), 0);
        let percent = with(Some(PlacesPaid::Percent { bps: 1_500 }), None);
        assert_eq!(rule_places(&percent, 100, 90), 15);
        // Rounded up, never below one place.
        assert_eq!(rule_places(&percent, 101, 90), 16);
        assert_eq!(rule_places(&percent, 1, 5), 1);
        let fixed = with(Some(PlacesPaid::Fixed { n: 9 }), None);
        assert_eq!(rule_places(&fixed, 100, 90), 9);
        // A custom table sets the places paid.
        let custom = with(
            Some(PlacesPaid::Fixed { n: 9 }),
            Some(PayoutAmounts::CustomBps {
                bps: vec![6_000, 4_000],
            }),
        );
        assert_eq!(rule_places(&custom, 100, 90), 2);
    }

    #[test]
    fn default_shares_by_places_paid() {
        let shares: Vec<u16> = [1, 2, 3, 4, 5, 6, 9, 10, 27, 28, 500]
            .iter()
            .map(|&m| default_first_share_bps(m))
            .collect();
        assert_eq!(
            shares,
            vec![
                10_000, 6_500, 5_000, 4_000, 4_000, 3_000, 3_000, 2_500, 2_500, 2_000, 2_000
            ]
        );
    }

    #[test]
    fn curve_gives_first_place_its_share() {
        for (places, share) in [(2, 6_500), (10, 2_500), (45, 2_000), (1_000, 1_500)] {
            let w = curve_weights(places, share);
            assert_eq!(w.len(), places);
            assert!(w.windows(2).all(|p| p[0] >= p[1]), "not decreasing");
            let total: u64 = w.iter().sum();
            assert!(total <= 1 << 40);
            let first = w[0] as f64 / total as f64;
            let target = f64::from(share) / 10_000.0;
            assert!(
                (first - target).abs() < 1e-6,
                "{places}: {first} vs {target}"
            );
        }
        // At or below 1/m the curve is flat.
        assert_eq!(curve_weights(4, 2_500), vec![1; 4]);
        assert_eq!(curve_weights(5, 1_000), vec![1; 5]);
        assert_eq!(curve_weights(1, 10_000), vec![1]);
    }

    #[test]
    fn curve_weights_are_frozen() {
        // Guards the portable float path: these bits must match on every target (checked
        // against an independent computation: alpha = 0.8562...).
        assert_eq!(
            curve_weights(5, 4_000),
            vec![
                439_804_651_110,
                242_948_442_988,
                171_689_032_049,
                134_204_915_299,
                110_864_586_328
            ]
        );
    }

    #[test]
    fn split_rounds_and_sums_exactly() {
        let pool = Money(100_050);
        let amounts = split(pool, &curve_weights(10, 2_500), Money(100));
        assert_eq!(sum(&amounts), pool.0);
        assert!(non_increasing(&amounts));
        assert!(amounts[1..].iter().all(|a| a.0 % 100 == 0));
        assert_eq!(
            split(Money(0), &curve_weights(3, 5_000), Money(100)),
            money(&[0, 0, 0])
        );
        assert_eq!(split(Money(10), &[1, 1, 1], Money(1)), money(&[4, 3, 3]));
    }

    #[test]
    fn custom_tables() {
        let bps = PayoutAmounts::CustomBps {
            bps: vec![5_000, 3_000, 2_000],
        };
        let t = compute(Money(1_001), 3, Some(&bps), Money(1), None);
        assert_eq!(t.amounts, money(&[501, 300, 200]));
        // Fewer players than places: the first shares are renormalized.
        let t = compute(Money(1_001), 2, Some(&bps), Money(1), None);
        assert_eq!(t.amounts, money(&[626, 375]));
        let fixed = PayoutAmounts::CustomAmounts {
            amounts: money(&[500, 300, 200]),
        };
        let t = compute(Money(5_000), 2, Some(&fixed), Money(100), Some(Money(400)));
        assert_eq!(
            t,
            PayoutTable {
                amounts: money(&[500, 300]),
                reduced_from: None
            }
        );
    }

    #[test]
    fn min_cash_pays_fewer_places() {
        let pool = Money(100_000);
        let t = compute(pool, 20, None, Money(100), Some(Money(3_000)));
        let paid = t.amounts.len();
        assert_eq!(t.reduced_from, Some(20));
        assert!(paid < 20 && t.amounts[paid - 1] >= Money(3_000));
        assert_eq!(sum(&t.amounts), pool.0);
        // One more place would pay less than the minimum.
        let next = compute(pool, paid as u32 + 1, None, Money(100), None);
        assert!(*next.amounts.last().unwrap() < Money(3_000));
        // Without a minimum, zero payouts are dropped.
        let t = compute(Money(1_000), 20, None, Money(100), None);
        assert!(t.amounts.iter().all(|&a| a >= Money(100)));
        assert_eq!(sum(&t.amounts), 1_000);
        // A pool below the minimum still pays one place.
        let t = compute(Money(500), 5, None, Money(100), Some(Money(1_000)));
        assert_eq!(t.amounts, money(&[500]));
    }

    #[test]
    fn ties_share_their_places() {
        let mut kit = money_kit(None);
        let ids: Vec<PlayerId> = (0..5).map(|i| kit.register(&format!("P{i}"))).collect();
        kit.ok(Command::StartClock {});
        // Places 4..5 tie, then places 2..3.
        kit.ok(bust(&[ids[4], ids[3]]));
        kit.ok(bust(&[ids[2], ids[1]]));
        let amounts = money(&[500, 300, 201]);
        let won = prizes(kit.agg.state(), &amounts);
        assert_eq!(won.get(&ids[1]), Some(&Money(251)));
        assert_eq!(won.get(&ids[2]), Some(&Money(250)));
        assert_eq!(won.get(&ids[3]), Some(&Money(0)));
        assert_eq!(won.get(&ids[0]), None);
    }

    #[test]
    fn lock_and_unlock() {
        let mut kit = Kit::new(9, 2);
        kit.register("A");
        assert_eq!(
            kit.err(Command::LockPayouts {}),
            DomainError::MoneyNotConfigured
        );
        let mut kit = money_kit(None);
        assert_eq!(kit.err(Command::LockPayouts {}), DomainError::NoEntries);
        assert_eq!(
            kit.err(Command::UnlockPayouts {}),
            DomainError::PayoutsNotLocked
        );
        kit.register("A");
        kit.register("B");
        kit.ok(Command::LockPayouts {});
        assert_eq!(kit.err(Command::LockPayouts {}), DomainError::NoChange);
        let locked = kit.agg.view(kit.now).money.unwrap();
        assert!(locked.locked);
        assert_eq!(locked.payouts, money(&[20_000]));
        kit.register("C");
        let view = kit.agg.view(kit.now);
        assert_eq!(view.money.as_ref().unwrap().payouts, money(&[20_000]));
        assert!(view.warnings.contains(&Warning::PayoutsStale {
            locked_pool: Money(20_000),
            pool: Money(30_000)
        }));
        let mut config = kit.agg.state().config.clone();
        config.places_paid = 2;
        assert_eq!(
            kit.err(Command::UpdateConfig {
                config: config.clone()
            }),
            DomainError::PayoutsLocked
        );
        // Locking again refreshes the table.
        kit.ok(Command::LockPayouts {});
        kit.ok(Command::UnlockPayouts {});
        kit.ok(Command::UpdateConfig { config });
        assert_eq!(kit.agg.view(kit.now).places_paid, 2);
    }
}
