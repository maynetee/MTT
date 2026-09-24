//! Commands: intentions sent by the host. Validated by `decide`.

use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::ids::{PlayerId, SeatRef, TournamentId};
use crate::money::Chips;
use crate::structure::Level;

/// Host-supplied context. The core never reads a clock or an entropy source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ctx {
    /// Wall-clock time in Unix milliseconds.
    pub now_ms: i64,
    /// Fresh random seed for this command (seat draws, shuffles).
    pub seed: u64,
}

impl Ctx {
    /// Convenience constructor.
    pub const fn new(now_ms: i64, seed: u64) -> Self {
        Self { now_ms, seed }
    }
}

/// Parameters of a new tournament.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct NewTournament {
    pub id: TournamentId,
    pub config: Config,
    pub structure: Vec<Level>,
}

/// One elimination inside a `BustPlayers` command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct BustInput {
    pub player: PlayerId,
    /// Stack at the start of the hand; required for every player of a multi-bust
    /// unless all are omitted (full tie).
    #[serde(default)]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub start_stack: Option<Chips>,
}

/// Why a player changed seats.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum MoveReason {
    #[default]
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "balance")]
    Balance,
}

/// Everything the director can do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Command {
    #[serde(rename = "update_config")]
    UpdateConfig { config: Config },
    #[serde(rename = "update_structure")]
    UpdateStructure { levels: Vec<Level> },
    /// Registers and seats a player immediately (at `seat` when forced).
    #[serde(rename = "register")]
    Register {
        name: String,
        #[serde(default)]
        #[cfg_attr(any(test, feature = "ts"), ts(optional))]
        seat: Option<SeatRef>,
    },
    /// Removes a registration before the start.
    #[serde(rename = "unregister")]
    Unregister { player: PlayerId },
    /// Eliminates one or more players in the same hand.
    #[serde(rename = "bust_players")]
    BustPlayers { busts: Vec<BustInput> },
    /// Corrects a mistaken bust that can no longer be undone.
    #[serde(rename = "revive_player")]
    RevivePlayer { player: PlayerId, seat: SeatRef },
    #[serde(rename = "move_player")]
    MovePlayer {
        player: PlayerId,
        to: SeatRef,
        #[serde(default)]
        #[cfg_attr(any(test, feature = "ts"), ts(optional))]
        reason: Option<MoveReason>,
    },
    #[serde(rename = "close_registration")]
    CloseRegistration {},
    #[serde(rename = "reopen_registration")]
    ReopenRegistration {},
    /// Declares the winner when one player is left and registration is closed.
    #[serde(rename = "finish_tournament")]
    FinishTournament {},
    /// Starts or resumes the clock; the first start begins the tournament.
    #[serde(rename = "start_clock")]
    StartClock {},
    #[serde(rename = "pause_clock")]
    PauseClock {},
    /// Next level, with its full duration.
    #[serde(rename = "next_level")]
    NextLevel {},
    /// Previous level, with its full duration.
    #[serde(rename = "prev_level")]
    PrevLevel {},
    /// Level `level` (0-based index), with its full duration.
    #[serde(rename = "jump_to")]
    JumpTo { level: u16 },
    #[serde(rename = "jump_to_next_break")]
    JumpToNextBreak {},
    /// Adds (or removes, if negative) time to the current level.
    #[serde(rename = "adjust_time")]
    AdjustTime { delta_ms: i64 },
    #[serde(rename = "set_remaining")]
    SetRemaining { ms: i64 },
    #[serde(rename = "undo")]
    Undo {},
    #[serde(rename = "redo")]
    Redo {},
}
