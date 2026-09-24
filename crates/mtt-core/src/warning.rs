//! Non-blocking warnings surfaced in the view. Same wire shape as errors.

use serde::{Deserialize, Serialize};

use crate::money::Money;

/// Something the tournament director should look at; never blocks a command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "code",
    content = "params",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Warning {
    /// The ante of a play level is larger than its big blind.
    AnteAboveBigBlind { index: u16 },
    /// A play level has a smaller big blind than the previous play level.
    BlindsDecrease { index: u16 },
    /// One player is left but registration is still open: close it to finish.
    FinishPending,
    /// The last level is over; blinds stay there until the director adds levels.
    StructureExhausted,
    /// Only `levels_left` levels remain after the current one.
    StructureEnding { levels_left: u16 },
    /// The minimum cash (or the rounding) cut the places paid from `from` to `to`.
    PlacesReduced { from: u32, to: u32 },
    /// Payouts were locked for `locked_pool`; the pool is now `pool` (lock them again to
    /// follow it).
    PayoutsStale { locked_pool: Money, pool: Money },
    /// Custom amounts add up to `total`, not to the effective pool `pool`.
    PayoutsMismatch { pool: Money, total: Money },
}
