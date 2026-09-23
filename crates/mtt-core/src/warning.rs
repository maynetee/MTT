//! Non-blocking warnings surfaced in the view. Same wire shape as errors.

use serde::{Deserialize, Serialize};

/// Something the tournament director should look at; never blocks a command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", content = "params", rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Warning {
    /// The ante of a play level is larger than its big blind.
    AnteAboveBigBlind { index: u16 },
    /// A play level has a smaller big blind than the previous play level.
    BlindsDecrease { index: u16 },
    /// One player is left but registration is still open: close it to finish.
    FinishPending,
}
