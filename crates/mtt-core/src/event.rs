//! Events: facts recorded in the log. Variants and fields are renamed explicitly so
//! Rust refactors never change the stored format; new fields must use `serde(default)`.

use serde::{Deserialize, Serialize};

use crate::clock::{Clock, ClockReason};
use crate::command::MoveReason;
use crate::config::Config;
use crate::ids::{BustGroup, PlayerId, SeatNo, SeatRef, Seq, TableNo, TournamentId};
use crate::money::Chips;
use crate::structure::Level;

/// Current event schema version, stored in every envelope.
pub const EVENT_VERSION: u16 = 1;

/// A logged event with its position and wall-clock time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Envelope {
    pub seq: Seq,
    pub v: u16,
    pub at_ms: i64,
    pub event: Event,
}

/// End of the tournament, recorded with the event that caused it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Finish {
    pub winner: PlayerId,
    /// The clock, paused at the moment of the finish.
    pub clock: Clock,
}

/// One elimination as recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Bust {
    pub player: PlayerId,
    pub start_stack: Option<Chips>,
    pub seat: SeatRef,
}

/// A player's seat change inside a table break or final table draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct SeatMove {
    pub player: PlayerId,
    pub from: SeatRef,
    pub to: SeatRef,
}

/// Domain events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Event {
    #[serde(rename = "tournament_created")]
    TournamentCreated {
        id: TournamentId,
        config: Config,
        structure: Vec<Level>,
    },
    #[serde(rename = "config_updated")]
    ConfigUpdated { config: Config },
    #[serde(rename = "structure_updated")]
    StructureUpdated { levels: Vec<Level>, clock: Clock },
    #[serde(rename = "player_registered")]
    PlayerRegistered {
        player: PlayerId,
        name: String,
        seat: SeatRef,
        stack: Chips,
        /// Table opened to seat this player, if any.
        #[serde(default)]
        opened_table: Option<TableNo>,
    },
    #[serde(rename = "player_unregistered")]
    PlayerUnregistered { player: PlayerId },
    #[serde(rename = "players_busted")]
    PlayersBusted {
        group: BustGroup,
        busts: Vec<Bust>,
        #[serde(default)]
        finish: Option<Finish>,
    },
    #[serde(rename = "player_revived")]
    PlayerRevived { player: PlayerId, seat: SeatRef },
    #[serde(rename = "player_moved")]
    PlayerMoved {
        player: PlayerId,
        from: SeatRef,
        to: SeatRef,
        reason: MoveReason,
    },
    #[serde(rename = "registration_overridden")]
    RegistrationOverridden {
        open: bool,
        #[serde(default)]
        finish: Option<Finish>,
    },
    #[serde(rename = "tournament_finished")]
    TournamentFinished { finish: Finish },
    #[serde(rename = "clock_changed")]
    ClockChanged {
        reason: ClockReason,
        clock: Clock,
        /// True for the first start, which moves the tournament out of setup.
        #[serde(default)]
        starts_tournament: bool,
    },
    #[serde(rename = "button_set")]
    ButtonSet { table: TableNo, seat: SeatNo },
    #[serde(rename = "table_opened")]
    TableOpened { table: TableNo },
    /// The table closes after its players are dealt to the other tables.
    #[serde(rename = "table_broken")]
    TableBroken {
        table: TableNo,
        moves: Vec<SeatMove>,
    },
    /// Everyone redrawn at `table`; the `closed` tables close.
    #[serde(rename = "final_table_formed")]
    FinalTableFormed {
        table: TableNo,
        moves: Vec<SeatMove>,
        closed: Vec<TableNo>,
    },
}

impl Event {
    /// The serialized `type` tag, e.g. `"players_busted"`.
    pub fn kind(&self) -> &'static str {
        match self {
            Event::TournamentCreated { .. } => "tournament_created",
            Event::ConfigUpdated { .. } => "config_updated",
            Event::StructureUpdated { .. } => "structure_updated",
            Event::PlayerRegistered { .. } => "player_registered",
            Event::PlayerUnregistered { .. } => "player_unregistered",
            Event::PlayersBusted { .. } => "players_busted",
            Event::PlayerRevived { .. } => "player_revived",
            Event::PlayerMoved { .. } => "player_moved",
            Event::RegistrationOverridden { .. } => "registration_overridden",
            Event::TournamentFinished { .. } => "tournament_finished",
            Event::ClockChanged { .. } => "clock_changed",
            Event::ButtonSet { .. } => "button_set",
            Event::TableOpened { .. } => "table_opened",
            Event::TableBroken { .. } => "table_broken",
            Event::FinalTableFormed { .. } => "final_table_formed",
        }
    }

    /// Table this event is about, for table operations and moves.
    pub fn table(&self) -> Option<TableNo> {
        match self {
            Event::ButtonSet { table, .. }
            | Event::TableOpened { table }
            | Event::TableBroken { table, .. }
            | Event::FinalTableFormed { table, .. } => Some(*table),
            Event::PlayerMoved { to, .. } => Some(to.table),
            _ => None,
        }
    }

    /// Players this event is about, in order.
    pub fn players(&self) -> Vec<PlayerId> {
        match self {
            Event::PlayerRegistered { player, .. }
            | Event::PlayerUnregistered { player }
            | Event::PlayerRevived { player, .. }
            | Event::PlayerMoved { player, .. } => vec![*player],
            Event::PlayersBusted { busts, .. } => busts.iter().map(|b| b.player).collect(),
            Event::TournamentFinished { finish } => vec![finish.winner],
            _ => Vec::new(),
        }
    }
}

/// Upgrades a raw envelope written at `from_version` to [`EVENT_VERSION`].
/// Version 1 is the first version, so there is nothing to migrate yet.
pub fn upcast(mut envelope: serde_json::Value, from_version: u16) -> serde_json::Value {
    if from_version < EVENT_VERSION {
        envelope["v"] = serde_json::Value::from(EVENT_VERSION);
    }
    envelope
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Frozen v1 wire format: camelCase fields, snake_case `type` tags.
    #[test]
    fn envelope_json_is_camel_case() {
        let envelope = Envelope {
            seq: Seq(2),
            v: EVENT_VERSION,
            at_ms: 1_000,
            event: Event::PlayerRegistered {
                player: PlayerId(1),
                name: "Alice".into(),
                seat: SeatRef::new(1, 3),
                stack: Chips(20_000),
                opened_table: Some(TableNo(1)),
            },
        };
        let golden = json!({
            "seq": 2, "v": 1, "atMs": 1000,
            "event": {
                "type": "player_registered", "player": 1, "name": "Alice",
                "seat": {"table": 1, "seat": 3}, "stack": 20000, "openedTable": 1
            }
        });
        assert_eq!(serde_json::to_value(&envelope).unwrap(), golden);
        assert_eq!(
            serde_json::from_value::<Envelope>(golden).unwrap(),
            envelope
        );
        let clock = Event::ClockChanged {
            reason: ClockReason::Start,
            clock: Clock::Running {
                level: 0,
                ends_at_ms: 5,
            },
            starts_tournament: true,
        };
        assert_eq!(
            serde_json::to_value(&clock).unwrap(),
            json!({
                "type": "clock_changed", "reason": "start",
                "clock": {"type": "running", "level": 0, "endsAtMs": 5},
                "startsTournament": true
            })
        );
    }

    #[test]
    fn upcast_brings_old_envelopes_to_the_current_version() {
        let old =
            json!({"seq": 1, "v": 0, "atMs": 0, "event": {"type": "table_opened", "table": 2}});
        let up = upcast(old, 0);
        assert_eq!(up["v"], EVENT_VERSION);
        let env: Envelope = serde_json::from_value(up).unwrap();
        assert_eq!(env.event, Event::TableOpened { table: TableNo(2) });
    }
}
