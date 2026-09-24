//! Errors returned by every command, in the same `{"code", "params"}` shape as the core's.

use std::fmt;

use mtt_core::{DomainError, LogError};
use serde::Serialize;

/// Why a command failed: a rejection by the core, passed through unchanged, or a failure of
/// the host itself. The front end maps `code` to a message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum EngineError {
    Domain(DomainError),
    Host(HostFailure),
}

/// Failures that do not come from the core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "code",
    content = "params",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum HostFailure {
    /// Storage, window or file system failure.
    HostError { message: String },
    /// No tournament with this id.
    NotFound { id: String },
}

impl EngineError {
    /// A `HOST_ERROR` carrying `message`.
    pub fn host(message: impl fmt::Display) -> Self {
        Self::Host(HostFailure::HostError {
            message: message.to_string(),
        })
    }

    /// A `NOT_FOUND` for tournament `id`.
    pub fn not_found(id: &str) -> Self {
        Self::Host(HostFailure::NotFound { id: id.to_owned() })
    }
}

impl From<DomainError> for EngineError {
    fn from(err: DomainError) -> Self {
        Self::Domain(err)
    }
}

impl From<LogError> for EngineError {
    fn from(err: LogError) -> Self {
        Self::host(format!("cannot load the event log: {err}"))
    }
}

impl From<rusqlite::Error> for EngineError {
    fn from(err: rusqlite::Error) -> Self {
        Self::host(format!("database error: {err}"))
    }
}

impl From<tauri::Error> for EngineError {
    fn from(err: tauri::Error) -> Self {
        Self::host(err)
    }
}

impl From<std::io::Error> for EngineError {
    fn from(err: std::io::Error) -> Self {
        Self::host(err)
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match serde_json::to_string(self) {
            Ok(json) => f.write_str(&json),
            Err(_) => write!(f, "{self:?}"),
        }
    }
}

impl std::error::Error for EngineError {}

#[cfg(test)]
mod tests {
    use super::*;
    use mtt_core::{SeatNo, TableNo};
    use serde_json::json;

    #[test]
    fn serializes_like_a_domain_error() {
        let domain = EngineError::from(DomainError::SeatOccupied {
            table: TableNo(3),
            seat: SeatNo(5),
        });
        assert_eq!(
            serde_json::to_value(domain).unwrap(),
            json!({"code": "SEAT_OCCUPIED", "params": {"table": 3, "seat": 5}})
        );
        assert_eq!(
            serde_json::to_value(EngineError::from(DomainError::NothingToUndo)).unwrap(),
            json!({"code": "NOTHING_TO_UNDO"})
        );
        assert_eq!(
            serde_json::to_value(EngineError::host("disk full")).unwrap(),
            json!({"code": "HOST_ERROR", "params": {"message": "disk full"}})
        );
        assert_eq!(
            serde_json::to_value(EngineError::not_found("abc")).unwrap(),
            json!({"code": "NOT_FOUND", "params": {"id": "abc"}})
        );
    }
}
