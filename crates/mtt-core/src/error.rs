//! Domain rejections with stable codes.
//!
//! Serialized as `{"code": "SEAT_OCCUPIED", "params": {"table": 3, "seat": 5}}`; the UI maps
//! `code` to an i18n key. Codes are part of the public contract: never rename a variant.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::ids::{PlayerId, SeatNo, TableNo};

/// Why a command was rejected. A rejected command never changes state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", content = "params", rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum DomainError {
    // Configuration.
    InvalidTournamentId {
        max: u16,
    },
    InvalidTournamentName {
        max: u16,
    },
    InvalidSeatsPerTable {
        min: u8,
        max: u8,
    },
    InvalidMaxTables {
        min: u16,
        max: u16,
    },
    InvalidFinalTableSize {
        min: u8,
        max: u8,
    },
    InvalidBalanceTrigger {
        min: u8,
        max: u8,
    },
    InvalidBreakOrder {
        table: TableNo,
    },
    InvalidStartingStack,
    InvalidPlacesPaid {
        min: u16,
    },
    InvalidLateRegLevel {
        n: u16,
        max: u16,
    },
    InvalidLateRegElapsed {
        max_ms: i64,
    },
    ConfigLocked {
        field: String,
    },
    TableInUse {
        table: TableNo,
    },
    SeatInUse {
        table: TableNo,
        seat: SeatNo,
    },
    NoChange,

    // Structure.
    StructureEmpty,
    StructureTooLong {
        max: u16,
    },
    StructureNoPlayLevel,
    InvalidBlinds {
        index: u16,
    },
    InvalidAnte {
        index: u16,
    },
    InvalidDuration {
        index: u16,
    },
    InvalidColorUp {
        index: u16,
    },
    PastLevelModified {
        index: u16,
    },
    CurrentLevelRemoved {
        index: u16,
    },

    // Lifecycle.
    TournamentFinished,
    NotStarted,
    AlreadyStarted,
    NotEnoughPlayers {
        min: u32,
        have: u32,
    },
    AliveNotOne {
        alive: u32,
    },
    LateRegOpen,

    // Registration.
    NameRequired,
    NameTooLong {
        max: u16,
    },
    NameTaken {
        player: PlayerId,
    },
    LateRegClosed,
    TournamentFull,
    RegistrationAlreadyClosed,
    RegistrationAlreadyOpen,

    // Seats and tables.
    TableNotFound {
        table: TableNo,
    },
    TableClosed {
        table: TableNo,
    },
    SeatNotFound {
        table: TableNo,
        seat: SeatNo,
    },
    SeatOccupied {
        table: TableNo,
        seat: SeatNo,
    },
    SameSeat,

    // Players.
    PlayerNotFound {
        player: PlayerId,
    },
    PlayerNotActive {
        player: PlayerId,
    },
    PlayerNotBusted {
        player: PlayerId,
    },
    EmptyBust,
    DuplicatePlayer {
        player: PlayerId,
    },
    LastPlayerStanding,
    BustStackRequired,
    InvalidStack {
        player: PlayerId,
    },

    // Clock.
    ClockAlreadyRunning,
    ClockAlreadyPaused,

    // History.
    NothingToUndo,
    NothingToRedo,

    /// A bug: an event produced by `decide` could not be applied.
    Internal {
        reason: String,
    },
}

impl DomainError {
    /// The stable code, e.g. `"SEAT_OCCUPIED"`.
    pub fn code(&self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(str::to_owned))
            .unwrap_or_default()
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match serde_json::to_string(self) {
            Ok(json) => f.write_str(&json),
            Err(_) => write!(f, "{self:?}"),
        }
    }
}

impl std::error::Error for DomainError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_params() {
        let err = DomainError::SeatOccupied {
            table: TableNo(3),
            seat: SeatNo(5),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"code": "SEAT_OCCUPIED", "params": {"table": 3, "seat": 5}})
        );
        assert_eq!(err.code(), "SEAT_OCCUPIED");
        assert_eq!(
            DomainError::LastPlayerStanding.code(),
            "LAST_PLAYER_STANDING"
        );
        let back: DomainError = serde_json::from_value(json).unwrap();
        assert_eq!(back, err);
    }
}
