//! Deal calculator: ICM (Malmuth-Harville) and chip chop. Pure queries for the hosts.
//!
//! Floats: with the payout curve weights, the ICM probabilities are the only float
//! computation in the core (IEEE 754 arithmetic and `libm::floor`, identical natively and
//! in WASM). They never reach the state, the events or the view: the results are converted
//! to [`Money`] by largest remainder so they add up exactly to the prizes.

use serde::{Deserialize, Serialize};

use crate::error::DomainError;
use crate::money::{Chips, MAX_SAFE_INT, Money};

/// Most players ICM handles (the computation is exponential in the players).
pub const ICM_MAX_PLAYERS: usize = 20;

fn check_input(stacks: &[Chips], prizes: &[Money]) -> Result<i64, DomainError> {
    let valid = stacks.iter().all(|s| s.is_valid())
        && prizes.iter().all(|p| p.is_valid())
        && prizes.len() <= stacks.len();
    let total = prizes
        .iter()
        .try_fold(Money::ZERO, |sum, &p| sum.checked_add(p));
    match total {
        Some(total) if valid => Ok(total.0),
        _ => Err(DomainError::InvalidIcmInput),
    }
}

/// `count` equal parts of `total` (floored), the leftover one each to the first ones.
fn equal_parts(total: i64, count: usize) -> Vec<i64> {
    let n = count.max(1) as i64;
    (0..count)
        .map(|i| total / n + i64::from((i as i64) < total % n))
        .collect()
}

/// Rounds `values` (adding up to about `total`) to integers adding up to exactly `total`:
/// floors, then one unit each by largest fractional part. Fractions are compared at 2^-32
/// precision so float noise between equal values never decides: ties go to the lowest
/// index.
fn largest_remainder(values: &[f64], total: i64) -> Vec<i64> {
    let n = values.len();
    if n == 0 {
        return Vec::new();
    }
    let mut out: Vec<i64> = values
        .iter()
        .map(|&v| (libm::floor(v) as i64).clamp(0, total))
        .collect();
    let fraction =
        |i: usize| libm::floor((values[i] - libm::floor(values[i])) * 4_294_967_296.0) as u64;
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| fraction(b).cmp(&fraction(a)).then(a.cmp(&b)));
    let diff = total - out.iter().sum::<i64>();
    if diff > 0 {
        let (each, extra) = (diff / n as i64, (diff % n as i64) as usize);
        for (rank, &i) in order.iter().enumerate() {
            out[i] += each + i64::from(rank < extra);
        }
    } else {
        // Float error only: take units back from the smallest fractions.
        let mut excess = -diff;
        while excess > 0 {
            for &i in order.iter().rev() {
                if excess > 0 && out[i] > 0 {
                    out[i] -= 1;
                    excess -= 1;
                }
            }
        }
    }
    out
}

/// ICM equity of each player, in minor units, adding up exactly to the prizes.
///
/// `prizes[j]` is the prize of place `j + 1` (fewer prizes than players: the other places
/// pay nothing). Players with chips share the top places by Malmuth-Harville: the chance to
/// finish next is proportional to the stack among the players not placed yet, computed
/// over the sets of players holding the top places (`O(n * sum_{k<m} C(n, k))`). Players
/// without chips finish last and share the lowest prizes equally.
///
/// Errors: `ICM_TOO_MANY_PLAYERS` beyond 20 players, `INVALID_ICM_INPUT` for a negative
/// amount, more prizes than players or a total out of range.
pub fn icm(stacks: &[Chips], prizes: &[Money]) -> Result<Vec<Money>, DomainError> {
    if stacks.len() > ICM_MAX_PLAYERS {
        return Err(DomainError::IcmTooManyPlayers {
            max: ICM_MAX_PLAYERS as u8,
        });
    }
    check_input(stacks, prizes)?;
    let prize = |place: usize| prizes.get(place).map_or(0, |p| p.0);
    let alive: Vec<usize> = (0..stacks.len()).filter(|&i| stacks[i].0 > 0).collect();
    let k = alive.len();
    let mut out = vec![0i64; stacks.len()];
    // Players without chips take places k+1..n and split them.
    let busted: Vec<usize> = (0..stacks.len()).filter(|&i| stacks[i].0 == 0).collect();
    let lowest: i64 = (k..stacks.len()).map(prize).sum();
    for (&i, part) in busted.iter().zip(equal_parts(lowest, busted.len())) {
        out[i] = part;
    }
    // The others share the top k places.
    let top_total: i64 = (0..k).map(prize).sum();
    let paid = prizes.len().min(k);
    let chips: Vec<u64> = alive.iter().map(|&i| stacks[i].0 as u64).collect();
    let total_chips: u64 = chips.iter().sum();
    let mut equity = vec![0.0f64; k];
    let mut reach = vec![0.0f64; 1 << k];
    reach[0] = 1.0;
    for mask in 0..reach.len() {
        let placed = mask.count_ones() as usize;
        let p = reach[mask];
        if placed >= paid || p == 0.0 {
            continue;
        }
        let taken: u64 = (0..k)
            .filter(|j| mask & (1 << j) != 0)
            .map(|j| chips[j])
            .sum();
        let rest = (total_chips - taken) as f64;
        let value = prize(placed) as f64;
        for j in (0..k).filter(|j| mask & (1 << j) == 0) {
            let q = p * chips[j] as f64 / rest;
            equity[j] += q * value;
            reach[mask | (1 << j)] += q;
        }
    }
    for (&i, amount) in alive.iter().zip(largest_remainder(&equity, top_total)) {
        out[i] = amount;
    }
    Ok(out.into_iter().map(Money).collect())
}

/// Chip chop: everyone gets the lowest remaining prize (zero with fewer prizes than
/// players), the rest is shared in proportion to the stacks (equally when no one has
/// chips), leftover minor units by largest remainder. Integer arithmetic only.
pub fn chip_chop(stacks: &[Chips], prizes: &[Money]) -> Result<Vec<Money>, DomainError> {
    let total = check_input(stacks, prizes)?;
    let n = stacks.len();
    if n == 0 {
        return Ok(Vec::new());
    }
    let floor = if prizes.len() < n {
        0
    } else {
        prizes.iter().map(|p| p.0).min().unwrap_or(0)
    };
    let rest = total - floor * n as i64;
    let chips: i128 = stacks.iter().map(|s| i128::from(s.0)).sum();
    let shares = if chips == 0 {
        equal_parts(rest, n)
    } else {
        let exact: Vec<(i64, i128)> = stacks
            .iter()
            .map(|s| {
                let scaled = i128::from(rest) * i128::from(s.0);
                ((scaled / chips) as i64, scaled % chips)
            })
            .collect();
        let mut shares: Vec<i64> = exact.iter().map(|&(q, _)| q).collect();
        let mut order: Vec<usize> = (0..n).collect();
        order.sort_by(|&a, &b| exact[b].1.cmp(&exact[a].1).then(a.cmp(&b)));
        let left = rest - shares.iter().sum::<i64>();
        for &i in order.iter().take(left as usize) {
            shares[i] += 1;
        }
        shares
    };
    Ok(shares.into_iter().map(|s| Money(floor + s)).collect())
}

/// A deal to evaluate: the stacks of the remaining players and the prizes they play for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct DealRequest {
    pub stacks: Vec<Chips>,
    /// Prize of each remaining place, first place first.
    pub prizes: Vec<Money>,
    /// Kept aside from the first prize for the players to play for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub play_for: Option<Money>,
}

/// Deal proposals, one amount per player in the order of the request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct DealQuote {
    pub icm: Vec<Money>,
    pub chip_chop: Vec<Money>,
    /// Left to play for; `icm` and `chip_chop` add up to the prizes minus this.
    pub play_for: Money,
}

/// ICM and chip chop for a deal, `play_for` taken from the first prize first
/// (`INVALID_ICM_INPUT` when larger than it).
pub fn quote(request: &DealRequest) -> Result<DealQuote, DomainError> {
    let play_for = request.play_for.unwrap_or(Money::ZERO);
    let first = request.prizes.first().copied().unwrap_or(Money::ZERO);
    if !play_for.is_valid() || play_for > first {
        return Err(DomainError::InvalidIcmInput);
    }
    let mut prizes = request.prizes.clone();
    if let Some(first) = prizes.first_mut() {
        *first = Money(first.0 - play_for.0);
    }
    Ok(DealQuote {
        icm: icm(&request.stacks, &prizes)?,
        chip_chop: chip_chop(&request.stacks, &prizes)?,
        play_for,
    })
}

// Keep sums of chip stacks in range: 20 stacks of at most 2^53 fit in a u64.
const _: () = assert!((ICM_MAX_PLAYERS as u64) * (MAX_SAFE_INT as u64) < u64::MAX);

#[cfg(test)]
mod tests {
    use super::*;

    fn chips(values: &[i64]) -> Vec<Chips> {
        values.iter().copied().map(Chips).collect()
    }

    fn money(values: &[i64]) -> Vec<Money> {
        values.iter().copied().map(Money).collect()
    }

    #[test]
    fn heads_up_is_proportional() {
        let out = icm(&chips(&[3_000, 1_000]), &money(&[700, 300])).unwrap();
        assert_eq!(out, money(&[600, 400]));
    }

    #[test]
    fn equal_stacks_split_equally() {
        let out = icm(&chips(&[5, 5, 5]), &money(&[500, 300, 200])).unwrap();
        assert_eq!(out, money(&[334, 333, 333]));
        let out = icm(&chips(&[7; 4]), &money(&[1_000])).unwrap();
        assert_eq!(out, money(&[250; 4]));
    }

    #[test]
    fn zero_stacks_take_the_lowest_prizes() {
        let out = icm(&chips(&[0, 4_000, 0, 4_000]), &money(&[500, 300, 150, 51])).unwrap();
        assert_eq!(out, money(&[101, 400, 100, 400]));
        // Nobody with chips: everyone ties.
        let out = icm(&chips(&[0, 0]), &money(&[9, 2])).unwrap();
        assert_eq!(out, money(&[6, 5]));
    }

    #[test]
    fn rejects_bad_input() {
        assert_eq!(
            icm(&[Chips(1); 21], &[]),
            Err(DomainError::IcmTooManyPlayers { max: 20 })
        );
        assert_eq!(
            icm(&chips(&[1]), &money(&[2, 1])),
            Err(DomainError::InvalidIcmInput)
        );
        assert_eq!(
            icm(&chips(&[-1, 5]), &money(&[2])),
            Err(DomainError::InvalidIcmInput)
        );
        assert_eq!(
            icm(&chips(&[1, 1]), &[Money::MAX, Money(1)]),
            Err(DomainError::InvalidIcmInput)
        );
        assert_eq!(icm(&[], &[]), Ok(Vec::new()));
    }

    #[test]
    fn twenty_players_are_fine() {
        let stacks: Vec<Chips> = (1..=20).map(|i| Chips(i * 1_000)).collect();
        let prizes = money(&[5_000, 3_000, 2_000, 1_000, 500]);
        let out = icm(&stacks, &prizes).unwrap();
        assert_eq!(out.iter().map(|m| m.0).sum::<i64>(), 11_500);
        assert!(out.windows(2).all(|w| w[0] <= w[1]), "{out:?}");
    }

    #[test]
    fn chip_chop_guarantees_the_lowest_prize() {
        let out = chip_chop(&chips(&[6_000, 3_000, 1_000]), &money(&[500, 300, 200])).unwrap();
        // 200 each, then 400 by chips: 240 + 120 + 40.
        assert_eq!(out, money(&[440, 320, 240]));
        let out = chip_chop(&chips(&[1, 1, 1]), &money(&[100])).unwrap();
        assert_eq!(out, money(&[34, 33, 33]));
        let out = chip_chop(&chips(&[0, 0]), &money(&[5, 2])).unwrap();
        assert_eq!(out, money(&[4, 3]));
        // Prizes in any order: the lowest one is guaranteed.
        let out = chip_chop(&chips(&[1, 3]), &money(&[100, 300])).unwrap();
        assert_eq!(out, money(&[150, 250]));
    }

    #[test]
    fn quote_keeps_money_to_play_for() {
        let request = DealRequest {
            stacks: chips(&[3_000, 1_000]),
            prizes: money(&[700, 300]),
            play_for: Some(Money(100)),
        };
        let quote = quote(&request).unwrap();
        assert_eq!(quote.icm, money(&[525, 375]));
        assert_eq!(quote.chip_chop, money(&[525, 375]));
        assert_eq!(quote.play_for, Money(100));
        let too_much = DealRequest {
            play_for: Some(Money(701)),
            ..request
        };
        assert_eq!(super::quote(&too_much), Err(DomainError::InvalidIcmInput));
        let json = serde_json::json!({"stacks": [3000, 1000], "prizes": [700, 300]});
        let parsed: DealRequest = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.play_for, None);
    }
}
