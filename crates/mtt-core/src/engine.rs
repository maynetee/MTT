//! Event-sourced aggregate: dispatch, undo/redo by cursor, rebuild by replay.
//!
//! The log holds the active events followed by the undone suffix. A new command drops
//! that suffix (hosts: delete `seq > head`, then insert); undo/redo only move `head`.

use serde::{Deserialize, Serialize};

use crate::command::{Command, Ctx, NewTournament};
use crate::decide::{decide, decide_create};
use crate::error::DomainError;
use crate::event::{EVENT_VERSION, Envelope, Event, upcast};
use crate::ids::Seq;
use crate::state::{State, apply};
use crate::view::{self, ActionLabel, History, View};

/// Version of the [`SavedLog`] document format.
pub const LOG_FORMAT: u16 = 1;

/// A tournament: its event log, undo cursor and current state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aggregate {
    events: Vec<Envelope>,
    head: usize,
    state: State,
}

/// What a successful dispatch changed, for the host to persist.
// Returned once per command: boxing the envelope would only complicate host code.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Outcome {
    /// A new event was appended after dropping `discarded` undone events.
    #[serde(rename = "recorded")]
    Recorded { envelope: Envelope, discarded: u32 },
    /// Event `seq` is now undone.
    #[serde(rename = "undone")]
    Undone { seq: Seq },
    /// Event `seq` is active again.
    #[serde(rename = "redone")]
    Redone { seq: Seq },
}

/// Serializable log: all events plus the undo cursor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct SavedLog {
    pub format: u16,
    /// Number of active events; the rest are undone and can be redone.
    pub head: u32,
    pub events: Vec<Envelope>,
}

/// Why a stored log cannot be loaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "code",
    content = "params",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum LogError {
    Malformed {
        message: String,
    },
    UnsupportedFormat {
        format: u16,
        max: u16,
    },
    /// Written by a newer version: open read-only or upgrade the app.
    UnsupportedVersion {
        v: u16,
        max: u16,
    },
    EmptyLog,
    MissingCreation,
    UnexpectedSeq {
        expected: u64,
        found: u64,
    },
    InvalidHead {
        head: u32,
        len: u32,
    },
    Inconsistent {
        seq: u64,
        reason: String,
    },
}

impl std::fmt::Display for LogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(json) => f.write_str(&json),
            Err(_) => write!(f, "{self:?}"),
        }
    }
}

impl std::error::Error for LogError {}

impl Aggregate {
    /// Creates a tournament; its log starts with `TournamentCreated`.
    pub fn create(new: NewTournament, ctx: &Ctx) -> Result<Self, DomainError> {
        let event = decide_create(&new)?;
        let state = State::genesis(new.id, new.config, new.structure);
        Ok(Self {
            events: vec![Envelope {
                seq: Seq(1),
                v: EVENT_VERSION,
                at_ms: ctx.now_ms,
                event,
            }],
            head: 1,
            state,
        })
    }

    /// Rebuilds a tournament by replaying its log. `head` is the number of active events.
    pub fn from_log(events: Vec<Envelope>, head: usize) -> Result<Self, LogError> {
        let len = events.len();
        let Some(first) = events.first() else {
            return Err(LogError::EmptyLog);
        };
        if head == 0 || head > len {
            return Err(LogError::InvalidHead {
                head: head as u32,
                len: len as u32,
            });
        }
        for (i, env) in events.iter().enumerate() {
            let expected = i as u64 + 1;
            if env.seq.0 != expected {
                return Err(LogError::UnexpectedSeq {
                    expected,
                    found: env.seq.0,
                });
            }
            if env.v != EVENT_VERSION {
                return Err(LogError::UnsupportedVersion {
                    v: env.v,
                    max: EVENT_VERSION,
                });
            }
        }
        let Event::TournamentCreated {
            id,
            config,
            structure,
        } = &first.event
        else {
            return Err(LogError::MissingCreation);
        };
        let new = NewTournament {
            id: id.clone(),
            config: config.clone(),
            structure: structure.clone(),
        };
        decide_create(&new).map_err(|e| LogError::Inconsistent {
            seq: 1,
            reason: e.to_string(),
        })?;
        let mut state = State::genesis(new.id, new.config, new.structure);
        let mut at_head = None;
        for (i, env) in events.iter().enumerate().skip(1) {
            if i == head {
                at_head = Some(state.clone());
            }
            apply(&mut state, &env.event).map_err(|e| LogError::Inconsistent {
                seq: env.seq.0,
                reason: e.0.to_owned(),
            })?;
        }
        Ok(Self {
            events,
            head,
            state: at_head.unwrap_or(state),
        })
    }

    /// Loads a [`SavedLog`].
    pub fn from_saved(saved: SavedLog) -> Result<Self, LogError> {
        if saved.format != LOG_FORMAT {
            return Err(LogError::UnsupportedFormat {
                format: saved.format,
                max: LOG_FORMAT,
            });
        }
        Self::from_log(saved.events, saved.head as usize)
    }

    /// Loads a JSON [`SavedLog`], upcasting events written by older versions.
    pub fn from_json(json: &str) -> Result<Self, LogError> {
        let malformed = |e: serde_json::Error| LogError::Malformed {
            message: e.to_string(),
        };
        let mut raw: serde_json::Value = serde_json::from_str(json).map_err(malformed)?;
        if let Some(events) = raw.get_mut("events").and_then(|e| e.as_array_mut()) {
            for env in events.iter_mut() {
                let v = env
                    .get("v")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                let v = u16::try_from(v).unwrap_or(u16::MAX);
                if v > EVENT_VERSION {
                    return Err(LogError::UnsupportedVersion {
                        v,
                        max: EVENT_VERSION,
                    });
                }
                *env = upcast(env.take(), v);
            }
        }
        Self::from_saved(serde_json::from_value(raw).map_err(malformed)?)
    }

    /// The whole log with its cursor.
    pub fn to_saved(&self) -> SavedLog {
        SavedLog {
            format: LOG_FORMAT,
            head: self.head as u32,
            events: self.events.clone(),
        }
    }

    /// JSON form of [`Aggregate::to_saved`].
    pub fn to_json(&self) -> Result<String, LogError> {
        serde_json::to_string(&self.to_saved()).map_err(|e| LogError::Malformed {
            message: e.to_string(),
        })
    }

    /// Runs a command. On error nothing changes.
    pub fn dispatch(&mut self, cmd: Command, ctx: &Ctx) -> Result<Outcome, DomainError> {
        match cmd {
            Command::Undo {} => return self.undo(),
            Command::Redo {} => return self.redo(),
            _ => {}
        }
        let event = decide(&self.state, &cmd, ctx)?;
        let mut next = self.state.clone();
        apply(&mut next, &event).map_err(|e| DomainError::Internal {
            reason: e.0.to_owned(),
        })?;
        let discarded = (self.events.len() - self.head) as u32;
        self.events.truncate(self.head);
        let envelope = Envelope {
            seq: Seq(self.head as u64 + 1),
            v: EVENT_VERSION,
            at_ms: ctx.now_ms,
            event,
        };
        self.events.push(envelope.clone());
        self.head += 1;
        self.state = next;
        Ok(Outcome::Recorded {
            envelope,
            discarded,
        })
    }

    /// Undoes the last active event (never the creation). Allowed even when finished.
    pub fn undo(&mut self) -> Result<Outcome, DomainError> {
        if self.head <= 1 {
            return Err(DomainError::NothingToUndo);
        }
        let state = replay(&self.events[..self.head - 1]).map_err(|e| DomainError::Internal {
            reason: e.to_string(),
        })?;
        self.head -= 1;
        self.state = state;
        Ok(Outcome::Undone {
            seq: Seq(self.head as u64 + 1),
        })
    }

    /// Re-applies the first undone event.
    pub fn redo(&mut self) -> Result<Outcome, DomainError> {
        let Some(envelope) = self.events.get(self.head) else {
            return Err(DomainError::NothingToRedo);
        };
        let mut next = self.state.clone();
        apply(&mut next, &envelope.event).map_err(|e| DomainError::Internal {
            reason: e.0.to_owned(),
        })?;
        self.head += 1;
        self.state = next;
        Ok(Outcome::Redone {
            seq: Seq(self.head as u64),
        })
    }

    /// Current state.
    pub fn state(&self) -> &State {
        &self.state
    }

    /// All events, including the undone suffix after [`Aggregate::head`].
    pub fn events(&self) -> &[Envelope] {
        &self.events
    }

    /// Number of active events.
    pub fn head(&self) -> usize {
        self.head
    }

    /// View at `now_ms`, with undo/redo labels.
    pub fn view(&self, now_ms: i64) -> View {
        let mut view = view::view(&self.state, now_ms);
        view.history = History {
            head: Seq(self.head as u64),
            undo: (self.head > 1)
                .then(|| self.events.get(self.head - 1))
                .flatten()
                .map(|env| self.label(env)),
            redo: self.events.get(self.head).map(|env| self.label(env)),
        };
        view
    }

    fn label(&self, env: &Envelope) -> ActionLabel {
        let registered_name = match &env.event {
            Event::PlayerRegistered { name, .. } => Some(name.clone()),
            _ => None,
        };
        let names = match registered_name {
            Some(name) => vec![name],
            None => env
                .event
                .players()
                .iter()
                .filter_map(|id| self.state.player(*id))
                .map(|p| p.name.clone())
                .collect(),
        };
        ActionLabel {
            seq: env.seq,
            at_ms: env.at_ms,
            kind: env.event.kind().to_owned(),
            names,
            table: env.event.table(),
        }
    }
}

fn replay(events: &[Envelope]) -> Result<State, LogError> {
    let head = events.len();
    Aggregate::from_log(events.to_vec(), head).map(|agg| agg.state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{Kit, bust};

    fn register(name: &str) -> Command {
        Command::Register {
            name: name.into(),
            seat: None,
        }
    }

    #[test]
    fn undo_and_redo_move_the_cursor() {
        let mut kit = Kit::new(9, 1);
        assert_eq!(kit.err(Command::Undo {}), DomainError::NothingToUndo);
        kit.register("A");
        let after_a = kit.agg.state().clone();
        kit.register("B");
        let after_b = kit.agg.state().clone();
        assert_eq!(
            kit.run(Command::Undo {}),
            Ok(Outcome::Undone { seq: Seq(3) })
        );
        assert_eq!(kit.agg.state(), &after_a);
        assert_eq!(kit.agg.events().len(), 3);
        assert_eq!(
            kit.run(Command::Redo {}),
            Ok(Outcome::Redone { seq: Seq(3) })
        );
        assert_eq!(kit.agg.state(), &after_b);
        assert_eq!(kit.err(Command::Redo {}), DomainError::NothingToRedo);
    }

    #[test]
    fn a_new_command_discards_the_undone_suffix() {
        let mut kit = Kit::new(9, 1);
        kit.register("A");
        kit.register("B");
        kit.ok(Command::Undo {});
        let outcome = kit.run(register("C")).unwrap();
        let Outcome::Recorded {
            envelope,
            discarded,
        } = outcome
        else {
            panic!("expected a recorded event");
        };
        assert_eq!((envelope.seq, discarded), (Seq(3), 1));
        assert_eq!(kit.agg.events().len(), 3);
        assert_eq!(kit.err(Command::Redo {}), DomainError::NothingToRedo);
    }

    #[test]
    fn view_labels_undo_and_redo() {
        let mut kit = Kit::new(9, 1);
        let a = kit.register("Alice");
        kit.register("Bob");
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[a]));
        kit.ok(Command::Undo {});
        let history = kit.agg.view(kit.now).history;
        assert_eq!(history.head, Seq(4));
        let undo = history.undo.unwrap();
        assert_eq!((undo.kind.as_str(), undo.names.len()), ("clock_changed", 0));
        let redo = history.redo.unwrap();
        assert_eq!(redo.kind, "players_busted");
        assert_eq!(redo.names, vec!["Alice".to_owned()]);
    }

    #[test]
    fn json_round_trip_rebuilds_the_same_aggregate() {
        let mut kit = Kit::new(9, 2);
        let a = kit.register("A");
        kit.register("B");
        kit.register("C");
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[a]));
        kit.ok(Command::Undo {});
        let json = kit.agg.to_json().unwrap();
        let loaded = Aggregate::from_json(&json).unwrap();
        assert_eq!(loaded, kit.agg);
    }

    #[test]
    fn rejects_broken_logs() {
        let mut kit = Kit::new(9, 1);
        kit.register("A");
        let events = kit.agg.events().to_vec();
        assert_eq!(Aggregate::from_log(Vec::new(), 0), Err(LogError::EmptyLog));
        assert!(matches!(
            Aggregate::from_log(events.clone(), 3),
            Err(LogError::InvalidHead { head: 3, len: 2 })
        ));
        assert!(matches!(
            Aggregate::from_log(events[1..].to_vec(), 1),
            Err(LogError::UnexpectedSeq {
                expected: 1,
                found: 2
            })
        ));
        let mut newer = events.clone();
        newer[1].v = EVENT_VERSION + 1;
        assert!(matches!(
            Aggregate::from_log(newer, 2),
            Err(LogError::UnsupportedVersion { .. })
        ));
        let mut duplicate = events.clone();
        duplicate.push(Envelope {
            seq: Seq(3),
            ..events[1].clone()
        });
        assert!(matches!(
            Aggregate::from_log(duplicate, 3),
            Err(LogError::Inconsistent { seq: 3, .. })
        ));
        let mut headless = events.clone();
        headless.remove(0);
        headless[0].seq = Seq(1);
        assert_eq!(
            Aggregate::from_log(headless, 1),
            Err(LogError::MissingCreation)
        );
        let json = kit.agg.to_json().unwrap().replace("\"v\":1", "\"v\":9");
        assert!(matches!(
            Aggregate::from_json(&json),
            Err(LogError::UnsupportedVersion { v: 9, .. })
        ));
        assert!(matches!(
            Aggregate::from_json("{"),
            Err(LogError::Malformed { .. })
        ));
    }

    #[test]
    fn event_kind_matches_the_serialized_tag() {
        use crate::clock::{Clock, ClockReason};
        use crate::command::MoveReason;
        use crate::event::{Finish, SeatMove};
        use crate::ids::{PlayerId, SeatNo, SeatRef, TableNo};

        let kit = Kit::new(9, 1);
        let Event::TournamentCreated { config, .. } = kit.agg.events()[0].event.clone() else {
            panic!("first event is the creation");
        };
        let (p, table, seat) = (PlayerId(1), TableNo(1), SeatRef::new(1, 1));
        let clock = Clock::Paused {
            level: 0,
            remaining_ms: 1,
        };
        let finish = Finish { winner: p, clock };
        let moves = vec![SeatMove {
            player: p,
            from: seat,
            to: SeatRef::new(2, 1),
        }];
        let mut events = vec![
            kit.agg.events()[0].event.clone(),
            Event::ConfigUpdated { config },
            Event::StructureUpdated {
                levels: Vec::new(),
                clock,
            },
            Event::PlayerRegistered {
                player: p,
                name: "A".into(),
                seat,
                stack: crate::money::Chips(1),
                opened_table: None,
                price: None,
            },
            Event::PlayerUnregistered {
                player: p,
                refund: None,
            },
            Event::PlayerReEntered {
                player: p,
                entry: 2,
                seat,
                stack: crate::money::Chips(1),
                opened_table: None,
                price: None,
            },
            Event::RebuyRecorded {
                player: p,
                stack: crate::money::Chips(1),
                price: None,
            },
            Event::AddOnRecorded {
                player: p,
                stack: crate::money::Chips(1),
                price: None,
            },
            Event::PlayersBusted {
                group: crate::ids::BustGroup(1),
                busts: Vec::new(),
                finish: None,
            },
            Event::PlayerRevived { player: p, seat },
            Event::PlayerMoved {
                player: p,
                from: seat,
                to: seat,
                reason: MoveReason::Balance,
            },
            Event::RegistrationOverridden {
                open: false,
                finish: None,
            },
            Event::TournamentFinished { finish },
            Event::ClockChanged {
                reason: ClockReason::Start,
                clock,
                starts_tournament: true,
            },
            Event::ButtonSet {
                table,
                seat: SeatNo(1),
            },
            Event::TableOpened { table },
            Event::TableBroken {
                table,
                moves: moves.clone(),
            },
        ];
        events.push(Event::FinalTableFormed {
            table,
            moves,
            closed: vec![TableNo(2)],
        });
        for event in events {
            let json = serde_json::to_value(&event).unwrap();
            assert_eq!(json["type"], event.kind());
            assert_eq!(serde_json::from_value::<Event>(json).unwrap(), event);
        }
    }
}
