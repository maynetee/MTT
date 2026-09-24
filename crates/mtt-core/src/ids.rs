//! Identifiers used across commands, events and views.

use serde::{Deserialize, Serialize};

/// Tournament identifier chosen by the host (ULID or UUID string).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct TournamentId(pub String);

/// Player identifier, allocated sequentially from 1 and never reused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct PlayerId(pub u32);

/// Table number, 1-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct TableNo(pub u16);

/// Seat number within a table, 1-based and clockwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct SeatNo(pub u8);

/// A seat at a given table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct SeatRef {
    pub table: TableNo,
    pub seat: SeatNo,
}

impl SeatRef {
    /// Builds a seat reference from raw numbers.
    pub const fn new(table: u16, seat: u8) -> Self {
        Self {
            table: TableNo(table),
            seat: SeatNo(seat),
        }
    }
}

/// One elimination event (one hand). Groups are numbered in log order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct BustGroup(pub u32);

/// Position of an event in the log, 1-based.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[cfg_attr(
    any(test, feature = "ts"),
    derive(ts_rs::TS),
    ts(export, type = "number")
)]
pub struct Seq(pub u64);
