//! Read model: everything the UI shows, derived from state and the current time.

use serde::{Deserialize, Serialize};

use crate::clock;
use crate::config::{Config, Deadline};
use crate::ids::{PlayerId, SeatNo, SeatRef, Seq, TableNo, TournamentId};
use crate::money::Chips;
use crate::ranking;
use crate::registration;
use crate::state::{Phase, State, TableStatus};
use crate::structure::{self, Ante, Level};
use crate::warning::Warning;

/// Tournament lifecycle as shown to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum PhaseName {
    #[serde(rename = "setup")]
    Setup,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "finished")]
    Finished,
}

/// An undoable or redoable action, for "Undo: bust Alice" style labels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct ActionLabel {
    pub seq: Seq,
    pub at_ms: i64,
    /// Event type, e.g. `players_busted`.
    pub kind: String,
    /// Names of the players involved.
    pub names: Vec<String>,
}

/// Undo/redo cursor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct History {
    /// Number of active events.
    pub head: Seq,
    pub undo: Option<ActionLabel>,
    pub redo: Option<ActionLabel>,
}

/// A level with its display number.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct LevelRow {
    pub index: u16,
    /// 1-based play-level number; `None` for breaks.
    pub play_level: Option<u16>,
    pub level: Level,
}

/// Clock at the time of the view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct ClockView {
    pub level_index: u16,
    pub play_level: Option<u16>,
    pub is_break: bool,
    pub running: bool,
    pub sb: Option<Chips>,
    pub bb: Option<Chips>,
    pub ante: Ante,
    pub duration_ms: i64,
    pub remaining_ms: i64,
    /// Wall-clock end of the current level while running.
    pub ends_at_ms: Option<i64>,
}

/// Registration status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct RegistrationView {
    pub open: bool,
    /// Director override (`CloseRegistration` / `ReopenRegistration`), if any.
    pub override_open: Option<bool>,
    pub deadline: Deadline,
}

/// Player counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Counts {
    /// Distinct players.
    pub unique: u32,
    pub entries: u32,
    pub alive: u32,
    pub busted: u32,
}

/// Chip statistics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct ChipsView {
    pub starting_stack: Chips,
    pub in_play: Chips,
    pub avg_stack: Option<Chips>,
    /// Average stack in big blinds, times 100 (break: next level's big blind).
    pub avg_stack_bb_x100: Option<i64>,
}

/// In-the-money status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Itm {
    /// `to_money` more players must bust before the bubble bursts.
    #[serde(rename = "not_yet")]
    NotYet { to_money: u32 },
    /// One more bust and everyone left is paid.
    #[serde(rename = "bubble")]
    Bubble,
    #[serde(rename = "in_money")]
    InMoney,
}

/// One line of the ranking. Alive players come first, without a place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct RankingRow {
    pub player: PlayerId,
    pub name: String,
    pub alive: bool,
    pub seat: Option<SeatRef>,
    pub place: Option<u32>,
    /// Last place of a tie (`place..=place_to`).
    pub place_to: Option<u32>,
    /// The place may still change (late registration open).
    pub provisional: bool,
    pub in_money: bool,
    pub entries: u8,
}

/// One seat of a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct SeatView {
    pub seat: SeatNo,
    pub player: Option<PlayerId>,
    pub name: Option<String>,
}

/// One table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct TableView {
    pub table: TableNo,
    pub status: TableStatus,
    pub players: u8,
    pub button: Option<SeatNo>,
    pub seats: Vec<SeatView>,
}

/// Everything the UI renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct View {
    pub generated_at_ms: i64,
    pub id: TournamentId,
    pub phase: PhaseName,
    pub winner: Option<PlayerId>,
    pub history: History,
    pub config: Config,
    pub levels: Vec<LevelRow>,
    pub clock: ClockView,
    pub registration: RegistrationView,
    pub counts: Counts,
    pub chips: ChipsView,
    /// Places paid, capped by the number of players.
    pub places_paid: u32,
    pub itm: Itm,
    pub ranking: Vec<RankingRow>,
    pub tables: Vec<TableView>,
    pub warnings: Vec<Warning>,
}

/// Builds the view of `state` at `now_ms`. History is left empty; see `Aggregate::view`.
pub fn view(state: &State, now_ms: i64) -> View {
    let registration_open = registration::is_open(state, now_ms);
    let counts = counts(state);
    let places_paid = u32::from(state.config.places_paid).min(counts.unique);
    let clock = clock_view(state, now_ms);
    View {
        generated_at_ms: now_ms,
        id: state.id.clone(),
        phase: match state.phase {
            Phase::Setup => PhaseName::Setup,
            Phase::Running => PhaseName::Running,
            Phase::Finished { .. } => PhaseName::Finished,
        },
        winner: match state.phase {
            Phase::Finished { winner } => Some(winner),
            _ => None,
        },
        history: History::default(),
        config: state.config.clone(),
        levels: state
            .structure
            .iter()
            .enumerate()
            .map(|(i, level)| LevelRow {
                index: i as u16,
                play_level: structure::play_number(&state.structure, i),
                level: level.clone(),
            })
            .collect(),
        chips: chips(state, &counts, usize::from(clock.level_index)),
        clock,
        registration: RegistrationView {
            open: registration_open,
            override_open: state.reg_override,
            deadline: state.config.late_reg,
        },
        places_paid,
        itm: itm(state.phase, counts.alive, places_paid),
        ranking: ranking_rows(state, registration_open, places_paid),
        tables: tables(state),
        warnings: warnings(state, registration_open),
        counts,
    }
}

fn clock_view(state: &State, now_ms: i64) -> ClockView {
    let (index, remaining_ms) = clock::position(&state.clock, now_ms);
    let level = state.structure.get(index);
    let (sb, bb, ante) = match level {
        Some(Level::Play { sb, bb, ante, .. }) => (Some(*sb), Some(*bb), *ante),
        _ => (None, None, Ante::None),
    };
    let running = state.clock.is_running();
    ClockView {
        level_index: index as u16,
        play_level: structure::play_number(&state.structure, index),
        is_break: level.is_some_and(Level::is_break),
        running,
        sb,
        bb,
        ante,
        duration_ms: structure::duration_at(&state.structure, index),
        remaining_ms,
        ends_at_ms: running.then(|| now_ms.saturating_add(remaining_ms)),
    }
}

fn counts(state: &State) -> Counts {
    let unique = state.players.len() as u32;
    let alive = state.alive_count() as u32;
    Counts {
        unique,
        entries: state.players.values().map(|p| u32::from(p.entries)).sum(),
        alive,
        busted: unique - alive,
    }
}

fn chips(state: &State, counts: &Counts, level_index: usize) -> ChipsView {
    let in_play = state
        .players
        .values()
        .fold(Chips::ZERO, |sum, p| sum.saturating_add(p.chips_bought));
    let avg_stack = (counts.alive > 0).then(|| Chips(in_play.0 / i64::from(counts.alive)));
    let bb = structure::reference_big_blind(&state.structure, level_index);
    let avg_stack_bb_x100 = match (avg_stack, bb) {
        (Some(avg), Some(bb)) if bb.0 > 0 => {
            Some((i128::from(avg.0) * 100 / i128::from(bb.0)) as i64)
        }
        _ => None,
    };
    ChipsView {
        starting_stack: state.config.starting_stack,
        in_play,
        avg_stack,
        avg_stack_bb_x100,
    }
}

/// Bubble when exactly one more bust puts everyone left in the money.
pub fn itm(phase: Phase, alive: u32, places_paid: u32) -> Itm {
    if phase == Phase::Setup || alive > places_paid + 1 {
        Itm::NotYet {
            to_money: alive.saturating_sub(places_paid),
        }
    } else if alive == places_paid + 1 {
        Itm::Bubble
    } else {
        Itm::InMoney
    }
}

fn ranking_rows(state: &State, registration_open: bool, places_paid: u32) -> Vec<RankingRow> {
    let alive_in_money = itm(state.phase, state.alive_count() as u32, places_paid) == Itm::InMoney;
    let places = ranking::placements(state);
    let provisional = registration_open && state.phase == Phase::Running;
    let mut rows: Vec<RankingRow> = state
        .players
        .values()
        .map(|p| {
            let placement = places.get(&p.id);
            RankingRow {
                player: p.id,
                name: p.name.clone(),
                alive: p.is_alive(),
                seat: p.seat(),
                place: placement.map(|pl| pl.place),
                place_to: placement
                    .filter(|pl| pl.place_to > pl.place)
                    .map(|pl| pl.place_to),
                provisional: provisional && placement.is_some(),
                in_money: match placement {
                    Some(pl) => pl.place <= places_paid,
                    None => alive_in_money,
                },
                entries: p.entries,
            }
        })
        .collect();
    rows.sort_by_key(|r| (r.place.is_some(), r.place, r.seat, r.player));
    rows
}

fn tables(state: &State) -> Vec<TableView> {
    state
        .tables
        .values()
        .map(|t| TableView {
            table: t.no,
            status: t.status,
            players: t.count() as u8,
            button: t.button,
            seats: (1..=t.seats)
                .map(SeatNo)
                .map(|seat| {
                    let player = t.occupants.get(&seat).copied();
                    SeatView {
                        seat,
                        player,
                        name: player
                            .and_then(|id| state.player(id))
                            .map(|p| p.name.clone()),
                    }
                })
                .collect(),
        })
        .collect()
}

fn warnings(state: &State, registration_open: bool) -> Vec<Warning> {
    let mut out = structure::validate(&state.structure).unwrap_or_default();
    if state.phase == Phase::Running && registration_open && state.alive_count() == 1 {
        out.push(Warning::FinishPending);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn itm_thresholds() {
        let running = Phase::Running;
        assert_eq!(itm(running, 6, 3), Itm::NotYet { to_money: 3 });
        assert_eq!(itm(running, 5, 3), Itm::NotYet { to_money: 2 });
        assert_eq!(itm(running, 4, 3), Itm::Bubble);
        assert_eq!(itm(running, 3, 3), Itm::InMoney);
        assert_eq!(itm(running, 1, 3), Itm::InMoney);
        assert_eq!(itm(Phase::Setup, 3, 3), Itm::NotYet { to_money: 0 });
    }
}
