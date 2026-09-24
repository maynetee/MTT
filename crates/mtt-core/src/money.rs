//! Integer amounts. Values stay within the JavaScript safe integer range.

use serde::{Deserialize, Serialize};

/// Largest integer exactly representable by a JavaScript number (2^53 - 1).
pub const MAX_SAFE_INT: i64 = (1 << 53) - 1;

macro_rules! amount {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export, type = "number"))]
        pub struct $name(pub i64);

        impl $name {
            /// Zero.
            pub const ZERO: Self = Self(0);
            /// Largest accepted amount.
            pub const MAX: Self = Self(MAX_SAFE_INT);

            /// True when `0 <= self <= MAX`.
            pub const fn is_valid(self) -> bool {
                self.0 >= 0 && self.0 <= MAX_SAFE_INT
            }

            /// True when `0 < self <= MAX`.
            pub const fn is_positive(self) -> bool {
                self.0 > 0 && self.0 <= MAX_SAFE_INT
            }

            /// Addition that fails when the result leaves `[0, MAX]`.
            pub fn checked_add(self, other: Self) -> Option<Self> {
                let sum = Self(self.0.checked_add(other.0)?);
                sum.is_valid().then_some(sum)
            }

            /// Subtraction that fails when the result leaves `[0, MAX]`.
            pub fn checked_sub(self, other: Self) -> Option<Self> {
                let diff = Self(self.0.checked_sub(other.0)?);
                diff.is_valid().then_some(diff)
            }

            /// Multiplication by a count that fails when the result leaves `[0, MAX]`.
            pub fn checked_mul(self, n: i64) -> Option<Self> {
                let product = Self(self.0.checked_mul(n)?);
                product.is_valid().then_some(product)
            }

            /// Addition clamped to `MAX`.
            pub fn saturating_add(self, other: Self) -> Self {
                Self(self.0.saturating_add(other.0).min(MAX_SAFE_INT))
            }
        }
    };
}

amount!(
    /// A chip count.
    Chips
);
amount!(
    /// A money amount in minor currency units (cents for EUR, yen for JPY).
    Money
);

/// What an entry or a purchase costs, split between the prize pool and the house.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Price {
    /// Part added to the prize pool.
    pub prize: Money,
    /// Part kept by the house (not in the prize pool).
    pub fee: Money,
}

impl Price {
    /// True when both parts are valid amounts and their sum is too.
    pub fn is_valid(self) -> bool {
        self.prize.is_valid() && self.fee.is_valid() && self.prize.checked_add(self.fee).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_arithmetic_stays_in_range() {
        assert_eq!(Chips(2).checked_add(Chips(3)), Some(Chips(5)));
        assert_eq!(Chips::MAX.checked_add(Chips(1)), None);
        assert_eq!(Chips(1).checked_sub(Chips(2)), None);
        assert_eq!(Chips(1 << 40).checked_mul(1 << 20), None);
        assert_eq!(Chips::MAX.saturating_add(Chips::MAX), Chips::MAX);
        assert!(!Chips(-1).is_valid());
        assert!(!Chips(0).is_positive());
        assert!(Money(0).is_valid());
    }

    #[test]
    fn price_parts_must_fit_together() {
        let price = |prize, fee| Price {
            prize: Money(prize),
            fee: Money(fee),
        };
        assert!(price(1_000, 100).is_valid());
        assert!(price(0, 0).is_valid());
        assert!(!price(-1, 0).is_valid());
        assert!(!price(MAX_SAFE_INT, 1).is_valid());
    }
}
