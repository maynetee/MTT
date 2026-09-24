//! Read model: everything the UI shows, derived from state and the current time.

use serde::{Deserialize, Serialize};

use crate::clock::{self, Boundary};
use crate::config::{Config, Currency, Deadline, PURCHASE_KINDS, PurchaseKind};
use crate::deal::Deal;
use crate::ids::{PlayerId, SeatNo, SeatRef, Seq, TableNo, TournamentId};
use crate::money::{Chips, Money};
use crate::payouts;
use crate::purchase;
use crate::ranking;
use crate::registration;
use crate::seating::{self, Suggestions};
use crate::state::{Phase, Player, State, TableStatus};
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
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct ActionLabel {
    pub seq: Seq,
    pub at_ms: i64,
    /// Event type, e.g. `players_busted`.
    pub kind: String,
    /// Names of the players involved.
    pub names: Vec<String>,
    /// Table involved, for table operations and moves.
    pub table: Option<TableNo>,
}

/// Undo/redo cursor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct History {
    /// Number of active events.
    pub head: Seq,
    pub undo: Option<ActionLabel>,
    pub redo: Option<ActionLabel>,
}

/// A level with its display number.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct LevelRow {
    pub index: u16,
    /// 1-based play-level number; `None` for breaks.
    pub play_level: Option<u16>,
    pub level: Level,
}

/// Clock at the time of the view. While running, the UI counts down to `ends_at_ms` on
/// its own and asks for a fresh view at `recompute_at_ms`; nothing is written per tick.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// Time spent past the end of the last level.
    pub overtime_ms: i64,
    pub next: Option<LevelRow>,
    /// Clock time until the next break starts.
    pub next_break_in_ms: Option<i64>,
    /// Upcoming level starts.
    pub schedule: Vec<Boundary>,
    /// Clock time until the last level ends.
    pub structure_ends_in_ms: i64,
    /// When this view goes stale while running (level change or registration close).
    pub recompute_at_ms: Option<i64>,
}

/// Registration status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct RegistrationView {
    pub open: bool,
    /// Director override (`CloseRegistration` / `ReopenRegistration`), if any.
    pub override_open: Option<bool>,
    pub deadline: Deadline,
    /// Clock time until the deadline closes registration.
    pub closes_in_ms: Option<i64>,
    /// Wall-clock close while the clock runs.
    pub closes_at_ms: Option<i64>,
    /// Whether a busted player can re-enter now; absent when re-entries are not offered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub reentry_open: Option<bool>,
    /// Whether rebuys are open; absent when not offered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub rebuy_open: Option<bool>,
    /// Whether add-ons are open; absent when not offered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub addon_open: Option<bool>,
}

/// Player counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Counts {
    /// Distinct players.
    pub unique: u32,
    /// First entries plus re-entries.
    pub entries: u32,
    pub alive: u32,
    pub busted: u32,
    /// Re-entries; present when offered or bought.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub reentries: Option<u32>,
    /// Rebuys; present when offered or bought.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub rebuys: Option<u32>,
    /// Add-ons; present when offered or bought.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub addons: Option<u32>,
}

/// Chip statistics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct ChipsView {
    pub starting_stack: Chips,
    pub in_play: Chips,
    pub avg_stack: Option<Chips>,
    /// Average stack in big blinds, times 100 (break: next level's big blind).
    pub avg_stack_bb_x100: Option<i64>,
}

/// Prize pool, present when money is tracked. Amounts are in minor units of `currency`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct MoneyView {
    pub currency: Currency,
    /// Sum of the prize parts paid by every entry and purchase.
    pub pool: Money,
    /// Fees collected (kept by the house, not in the pool).
    pub fees: Money,
    pub guarantee: Option<Money>,
    /// Paid by the house when the pool is below the guarantee.
    pub overlay: Money,
    /// Distributed to the players: the larger of `pool` and `guarantee`.
    pub effective_pool: Money,
    /// Payouts in force, first place first (`payouts[0]` is 1st place).
    pub payouts: Vec<Money>,
    /// The payouts are frozen by `LockPayouts`.
    pub locked: bool,
    /// Deal between the remaining players, once recorded.
    pub deal: Option<Deal>,
}

/// In-the-money status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all_fields = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Itm {
    /// `to_money` more players must bust before the bubble bursts.
    #[serde(rename = "not_yet")]
    NotYet { to_money: u32 },
    /// One more bust and everyone left is paid.
    #[serde(rename = "bubble")]
    Bubble,
    #[serde(rename = "in_money")]
    InMoney {
        /// Prize of the next player out, when money is tracked.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(any(test, feature = "ts"), ts(optional))]
        next_payout: Option<Money>,
    },
}

/// One line of the ranking. Alive players come first, without a place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct RankingRow {
    pub player: PlayerId,
    pub name: String,
    pub alive: bool,
    pub seat: Option<SeatRef>,
    pub place: Option<u32>,
    /// Last place of a tie (`place..=place_to`).
    pub place_to: Option<u32>,
    /// The place may still change (late registration open, or the player may re-enter).
    pub provisional: bool,
    pub in_money: bool,
    pub entries: u8,
    /// Rebuys bought; present when any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub rebuys: Option<u8>,
    /// Add-ons bought; present when any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub addons: Option<u8>,
    /// Prize won (provisional like the place); present for placed players when money is
    /// tracked and the prize is not zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub prize: Option<Money>,
}

/// One seat of a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct SeatView {
    pub seat: SeatNo,
    pub player: Option<PlayerId>,
    pub name: Option<String>,
}

/// One table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct TableView {
    pub table: TableNo,
    pub status: TableStatus,
    pub players: u8,
    pub button: Option<SeatNo>,
    /// Blinds of the next hand, when the button is known.
    pub next_sb: Option<SeatNo>,
    pub next_bb: Option<SeatNo>,
    pub seats: Vec<SeatView>,
}

/// Everything the UI renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// Places paid, capped by the number of players (after the minimum-cash reduction, or
    /// as locked).
    pub places_paid: u32,
    pub itm: Itm,
    pub ranking: Vec<RankingRow>,
    pub tables: Vec<TableView>,
    pub suggestions: Suggestions,
    pub warnings: Vec<Warning>,
    /// Prize pool; absent when money is not tracked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub money: Option<MoneyView>,
}

/// Builds the view of `state` at `now_ms`. History is left empty; see `Aggregate::view`.
pub fn view(state: &State, now_ms: i64) -> View {
    let registration_open = registration::is_open(state, now_ms);
    let counts = counts(state);
    let payouts = payouts::in_force(state);
    let places_paid = payouts.places_paid;
    let mut clock = clock_view(state, now_ms);
    let registration = registration_view(state, now_ms, registration_open, clock.running);
    let purchase_closes = PURCHASE_KINDS
        .iter()
        .filter_map(|&kind| purchase::closes_in_ms(state, kind, now_ms))
        .map(|left| now_ms.saturating_add(left))
        .filter(|_| clock.running);
    for close in registration.closes_at_ms.into_iter().chain(purchase_closes) {
        clock.recompute_at_ms = Some(clock.recompute_at_ms.map_or(close, |at| at.min(close)));
    }
    let entries_open = purchase::entries_open(state, now_ms);
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
        levels: (0..state.structure.len())
            .filter_map(|i| level_row(&state.structure, i))
            .collect(),
        chips: chips(state, &counts, usize::from(clock.level_index)),
        warnings: warnings(state, entries_open, &clock, &payouts),
        clock,
        registration,
        places_paid,
        itm: itm_with_payout(state, counts.alive, &payouts),
        ranking: ranking_rows(state, now_ms, registration_open, &payouts),
        tables: tables(state),
        suggestions: seating::suggestions(state),
        counts,
        money: money_view(state, payouts),
    }
}

fn money_view(state: &State, payouts: payouts::InForce) -> Option<MoneyView> {
    let money = state.config.money.as_ref()?;
    let pool = payouts::pool(state);
    Some(MoneyView {
        currency: money.currency.clone(),
        pool: pool.prize,
        fees: pool.fees,
        guarantee: pool.guarantee,
        overlay: pool.overlay,
        effective_pool: pool.effective,
        payouts: payouts.amounts,
        locked: payouts.locked,
        deal: state.deal.clone(),
    })
}

/// [`itm`] with the prize of the next player out while running.
fn itm_with_payout(state: &State, alive: u32, payouts: &payouts::InForce) -> Itm {
    match itm(state.phase, alive, payouts.places_paid) {
        Itm::InMoney { .. } => Itm::InMoney {
            next_payout: Some(payouts::amount_at(&payouts.amounts, alive)).filter(|amount| {
                amount.0 > 0 && state.phase == Phase::Running && state.deal.is_none()
            }),
        },
        other => other,
    }
}

fn level_row(levels: &[Level], index: usize) -> Option<LevelRow> {
    levels.get(index).map(|level| LevelRow {
        index: index as u16,
        play_level: structure::play_number(levels, index),
        level: level.clone(),
    })
}

fn clock_view(state: &State, now_ms: i64) -> ClockView {
    let levels = &state.structure;
    let eff = clock::effective(&state.clock, levels, now_ms);
    let index = eff.level;
    let level = levels.get(index);
    let (sb, bb, ante) = match level {
        Some(Level::Play { sb, bb, ante, .. }) => (Some(*sb), Some(*bb), *ante),
        _ => (None, None, Ante::None),
    };
    let schedule = clock::schedule(&state.clock, levels, now_ms);
    let next_break_in_ms = schedule
        .boundaries
        .iter()
        .find(|b| levels[usize::from(b.level_index)].is_break())
        .map(|b| b.starts_in_ms);
    let exhausted = eff.exhausted(levels);
    ClockView {
        level_index: index as u16,
        play_level: structure::play_number(levels, index),
        is_break: level.is_some_and(Level::is_break),
        running: eff.running,
        sb,
        bb,
        ante,
        duration_ms: structure::duration_at(levels, index),
        remaining_ms: eff.remaining_ms,
        ends_at_ms: eff.ends_at_ms,
        overtime_ms: eff.overtime_ms,
        next: level_row(levels, index + 1),
        next_break_in_ms,
        structure_ends_in_ms: schedule.ends_in_ms,
        schedule: schedule.boundaries,
        recompute_at_ms: eff.ends_at_ms.filter(|_| !exhausted),
    }
}

fn registration_view(state: &State, now_ms: i64, open: bool, running: bool) -> RegistrationView {
    let closes_in_ms = match (state.phase, state.reg_override) {
        (Phase::Finished { .. }, _) | (_, Some(_)) => None,
        _ => registration::deadline_in_ms(state, now_ms).filter(|&left| left > 0 && open),
    };
    let window = |kind| {
        state
            .config
            .purchase(kind)
            .map(|_| purchase::is_open(state, kind, now_ms))
    };
    RegistrationView {
        open,
        override_open: state.reg_override,
        deadline: state.config.late_reg,
        closes_in_ms,
        closes_at_ms: closes_in_ms
            .filter(|_| running && state.phase == Phase::Running)
            .map(|left| now_ms.saturating_add(left)),
        reentry_open: window(PurchaseKind::Reentry),
        rebuy_open: window(PurchaseKind::Rebuy),
        addon_open: window(PurchaseKind::Addon),
    }
}

fn counts(state: &State) -> Counts {
    let unique = state.players.len() as u32;
    let alive = state.alive_count() as u32;
    let total = |count: fn(&Player) -> u8| -> u32 {
        state.players.values().map(|p| u32::from(count(p))).sum()
    };
    let entries = total(|p| p.entries);
    let shown = |kind, n: u32| (state.config.purchase(kind).is_some() || n > 0).then_some(n);
    Counts {
        unique,
        entries,
        alive,
        busted: unique - alive,
        reentries: shown(PurchaseKind::Reentry, entries - unique),
        rebuys: shown(PurchaseKind::Rebuy, total(|p| p.rebuys)),
        addons: shown(PurchaseKind::Addon, total(|p| p.addons)),
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
        Itm::InMoney { next_payout: None }
    }
}

fn ranking_rows(
    state: &State,
    now_ms: i64,
    registration_open: bool,
    payouts: &payouts::InForce,
) -> Vec<RankingRow> {
    let places_paid = payouts.places_paid;
    let alive_in_money = matches!(
        itm(state.phase, state.alive_count() as u32, places_paid),
        Itm::InMoney { .. }
    );
    let prizes = match state.config.money {
        Some(_) => payouts::prizes(state, &payouts.amounts),
        None => Default::default(),
    };
    let places = ranking::placements(state);
    let running = state.phase == Phase::Running;
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
                provisional: running
                    && placement.is_some()
                    && (registration_open || purchase::can_reenter(state, p, now_ms)),
                in_money: match placement {
                    Some(pl) => pl.place <= places_paid,
                    None => alive_in_money,
                },
                entries: p.entries,
                rebuys: (p.rebuys > 0).then_some(p.rebuys),
                addons: (p.addons > 0).then_some(p.addons),
                prize: prizes.get(&p.id).copied().filter(|prize| prize.0 > 0),
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
            next_sb: seating::blinds(t).map(|b| b.small),
            next_bb: seating::blinds(t).map(|b| b.big),
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

/// Levels after the current one below which `STRUCTURE_ENDING` is raised.
const ENDING_LEVELS: usize = 2;

fn payout_warnings(state: &State, payouts: &payouts::InForce) -> Vec<Warning> {
    let Some(derived) = &payouts.derived else {
        return Vec::new();
    };
    let pool = payouts::pool(state).effective;
    match &state.payouts_locked {
        Some(locked) if locked.amounts != derived.amounts => vec![Warning::PayoutsStale {
            locked_pool: locked.pool,
            pool,
        }],
        Some(_) => Vec::new(),
        None => {
            let mut out = Vec::new();
            if let Some(from) = derived.reduced_from {
                out.push(Warning::PlacesReduced {
                    from,
                    to: derived.amounts.len() as u32,
                });
            }
            let total = derived
                .amounts
                .iter()
                .fold(Money::ZERO, |sum, &a| sum.saturating_add(a));
            if !derived.amounts.is_empty() && total != pool {
                out.push(Warning::PayoutsMismatch { pool, total });
            }
            out
        }
    }
}

fn warnings(
    state: &State,
    entries_open: bool,
    clock: &ClockView,
    payouts: &payouts::InForce,
) -> Vec<Warning> {
    let mut out = structure::validate(&state.structure).unwrap_or_default();
    out.extend(payout_warnings(state, payouts));
    if state.phase != Phase::Running {
        return out;
    }
    if entries_open && state.alive_count() == 1 {
        out.push(Warning::FinishPending);
    }
    let levels_left = state
        .structure
        .len()
        .saturating_sub(1 + usize::from(clock.level_index));
    if levels_left == 0 && clock.remaining_ms == 0 {
        out.push(Warning::StructureExhausted);
    } else if levels_left <= ENDING_LEVELS {
        out.push(Warning::StructureEnding {
            levels_left: levels_left as u16,
        });
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
        let in_money = Itm::InMoney { next_payout: None };
        assert_eq!(itm(running, 3, 3), in_money);
        assert_eq!(itm(running, 1, 3), in_money);
        assert_eq!(itm(Phase::Setup, 3, 3), Itm::NotYet { to_money: 0 });
    }
}
