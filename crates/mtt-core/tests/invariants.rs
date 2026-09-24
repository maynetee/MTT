//! Property tests: random command sequences, valid or not, never break the model.

mod common;

use std::collections::{BTreeMap, BTreeSet};

use common::*;
use mtt_core::clock::{Clock, effective, schedule};
use mtt_core::config::{PayoutAmounts, PlacesPaid};
use mtt_core::payouts;
use mtt_core::seating::balance_plan;
use mtt_core::{
    Aggregate, BustInput, Chips, Command, Config, Ctx, Deadline, Event, Level, Money, MoneyConfig,
    MoveReason, PayoutConfig, Phase, PlayerId, Price, Purchase, PurchaseWindow, SeatNo, SeatRef,
    State, TableNo,
};
use proptest::prelude::*;

const SEATS: u8 = 4;
const TABLES: u16 = 3;

fn table() -> impl Strategy<Value = TableNo> {
    (1u16..=TABLES + 1).prop_map(TableNo)
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone)]
enum Op {
    Cmd(Command),
    Advance(i64),
}

fn player() -> impl Strategy<Value = PlayerId> {
    (1u32..=13).prop_map(PlayerId)
}

fn seat() -> impl Strategy<Value = SeatRef> {
    (1u16..=TABLES + 1, 1u8..=SEATS + 1).prop_map(|(t, s)| SeatRef::new(t, s))
}

fn name() -> impl Strategy<Value = String> {
    (0u8..16).prop_map(|i| format!("N{i}"))
}

fn structure() -> impl Strategy<Value = Vec<Level>> {
    prop::collection::vec((1i64..=30, any::<bool>()), 1..=6).prop_map(|levels| {
        let mut bb = 50;
        let mut out: Vec<Level> = levels
            .into_iter()
            .map(|(minutes, is_break)| {
                if is_break {
                    pause(minutes)
                } else {
                    bb += 50;
                    play(bb / 2, bb, minutes)
                }
            })
            .collect();
        out.push(play(1000, 2000, 20));
        out
    })
}

fn command() -> impl Strategy<Value = Command> {
    prop_oneof![
        4 => name().prop_map(|name| Command::Register { name, seat: None }),
        2 => (name(), seat()).prop_map(|(name, seat)| Command::Register { name, seat: Some(seat) }),
        1 => player().prop_map(|player| Command::Unregister { player }),
        6 => prop::collection::vec((player(), prop::option::of(0i64..4)), 0..=3).prop_map(|busts| {
            Command::BustPlayers {
                busts: busts
                    .into_iter()
                    .map(|(player, stack)| BustInput { player, start_stack: stack.map(|s| Chips(s * 1000)) })
                    .collect(),
            }
        }),
        2 => (player(), seat()).prop_map(|(player, seat)| Command::RevivePlayer { player, seat }),
        4 => (player(), prop::option::of(seat())).prop_map(|(player, seat)| Command::ReEnter { player, seat }),
        2 => player().prop_map(|player| Command::Rebuy { player }),
        1 => player().prop_map(|player| Command::AddOn { player }),
        2 => (player(), seat()).prop_map(|(player, to)| Command::MovePlayer { player, to, reason: None }),
        1 => Just(Command::LockPayouts {}),
        // Turned into an ICM deal between the players still in by `run_ops`.
        1 => (0i64..=2_000).prop_map(|play_for| Command::RecordDeal { amounts: Vec::new(), play_for: Some(Money(play_for)) }),
        1 => Just(Command::UnlockPayouts {}),
        1 => Just(Command::CloseRegistration {}),
        1 => Just(Command::ReopenRegistration {}),
        1 => Just(Command::FinishTournament {}),
        2 => Just(Command::StartClock {}),
        1 => Just(Command::PauseClock {}),
        1 => Just(Command::NextLevel {}),
        1 => Just(Command::PrevLevel {}),
        1 => (0u16..8).prop_map(|level| Command::JumpTo { level }),
        1 => Just(Command::JumpToNextBreak {}),
        1 => (-30 * MIN..=30 * MIN).prop_map(|delta_ms| Command::AdjustTime { delta_ms }),
        1 => (-MIN..=30 * MIN).prop_map(|ms| Command::SetRemaining { ms }),
        2 => (table(), 1u8..=SEATS + 1).prop_map(|(table, seat)| Command::SetButton { table, seat: SeatNo(seat) }),
        1 => table().prop_map(|table| Command::OpenTable { table }),
        2 => table().prop_map(|table| Command::BreakTable { table }),
        1 => table().prop_map(|table| Command::FormFinalTable { table }),
        3 => Just(Command::Undo {}),
        1 => Just(Command::Redo {}),
        1 => (1u16..=5, 2u16..=TABLES + 1, 3u8..=SEATS + 1, prop::bool::weighted(0.75)).prop_map(|(paid, tables, seats, payouts)| {
            Command::UpdateConfig {
                config: Config { places_paid: paid, payouts, ..Config::new("Prop", seats, tables, 10_000) },
            }
        }),
        1 => structure().prop_map(|levels| Command::UpdateStructure { levels }),
    ]
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        8 => command().prop_map(Op::Cmd),
        2 => (0i64..=40 * MIN).prop_map(Op::Advance),
    ]
}

fn deadline() -> impl Strategy<Value = Deadline> {
    prop_oneof![
        Just(Deadline::Manual),
        (1u16..=4, any::<bool>())
            .prop_map(|(n, through_break)| Deadline::EndOfPlayLevel { n, through_break }),
        (1i64..=90).prop_map(|minutes| Deadline::Elapsed { ms: minutes * MIN }),
    ]
}

/// The clock only moves forward with time and its schedule is strictly increasing.
fn check_clock(state: &State, now: i64) {
    let levels = &state.structure;
    let mut previous = effective(&state.clock, levels, now);
    for step in [1, MIN, 7 * MIN, 45 * MIN, 400 * MIN] {
        let next = effective(&state.clock, levels, now + step);
        assert!(next.level >= previous.level, "clock went back in time");
        previous = next;
    }
    let starts: Vec<i64> = schedule(&state.clock, levels, now)
        .boundaries
        .iter()
        .map(|b| b.starts_in_ms)
        .collect();
    assert!(
        starts.windows(2).all(|w| w[0] < w[1]),
        "schedule not increasing: {starts:?}"
    );
}

/// Once every button is known, playing the whole balance plan leaves the open tables
/// within `balance_trigger - 1` players of each other, moving nobody twice.
fn check_balance_plan(agg: &Aggregate, now: i64) {
    if matches!(agg.state().phase, Phase::Finished { .. }) {
        return;
    }
    let mut agg = agg.clone();
    let ctx = Ctx::new(now, 0);
    let unknown: Vec<TableNo> = agg
        .state()
        .open_tables()
        .filter(|t| t.button.is_none())
        .map(|t| t.no)
        .collect();
    for table in unknown {
        let cmd = Command::SetButton {
            table,
            seat: SeatNo(1),
        };
        agg.dispatch(cmd, &ctx).expect("button on an open table");
    }
    let plan = balance_plan(agg.state());
    let mut moved = BTreeSet::new();
    for step in &plan {
        let (Some(player), Some(seat)) = (step.player, step.to_seat) else {
            panic!("incomplete step with every button known: {step:?}");
        };
        assert!(moved.insert(player), "{player:?} moved twice: {plan:?}");
        let to = SeatRef {
            table: step.to_table,
            seat,
        };
        let cmd = Command::MovePlayer {
            player,
            to,
            reason: Some(MoveReason::Balance),
        };
        agg.dispatch(cmd, &ctx).expect("balance step applies");
    }
    let counts: Vec<usize> = agg.state().open_tables().map(|t| t.count()).collect();
    if let (Some(max), Some(min)) = (counts.iter().max(), counts.iter().min()) {
        let trigger = usize::from(agg.state().config.balance_trigger);
        assert!(
            max - min < trigger,
            "still unbalanced after {plan:?}: {counts:?}"
        );
    }
}

fn money() -> impl Strategy<Value = Option<MoneyConfig>> {
    let unit = prop_oneof![Just(1i64), Just(100), Just(500)];
    let settings = (
        0i64..=5_000,
        0i64..=500,
        prop::option::of(0i64..=80_000),
        unit,
        prop::option::of(0i64..=3_000),
    );
    prop::option::of(settings).prop_map(|m| {
        m.map(|(prize, fee, guarantee, unit, min_cash)| MoneyConfig {
            guarantee: guarantee.map(Money),
            rounding_unit: Money(unit),
            min_cash: min_cash.map(Money),
            ..MoneyConfig::new("EUR", 2, prize, fee)
        })
    })
}

fn amounts() -> impl Strategy<Value = PayoutAmounts> {
    prop_oneof![
        prop::option::of(1u16..=10_000)
            .prop_map(|first_share_bps| PayoutAmounts::Curve { first_share_bps }),
        Just(PayoutAmounts::CustomBps {
            bps: vec![5_000, 3_000, 2_000],
        }),
        Just(PayoutAmounts::CustomBps {
            bps: vec![2_500; 4],
        }),
        Just(PayoutAmounts::CustomAmounts {
            amounts: vec![Money(3_000), Money(2_000), Money(2_000)],
        }),
    ]
}

fn payout() -> impl Strategy<Value = PayoutConfig> {
    let places = prop_oneof![
        (1u16..=10_000).prop_map(|bps| PlacesPaid::Percent { bps }),
        (1u16..=8).prop_map(|n| PlacesPaid::Fixed { n }),
    ];
    (prop::option::of(places), prop::option::of(amounts())).prop_map(|(places_paid, amounts)| {
        PayoutConfig {
            places_paid,
            amounts,
        }
    })
}

/// Payouts in force are non-increasing and, unless locked or custom amounts, add up to
/// the effective pool; once finished, the prizes add up to the payouts. Without payouts
/// nothing is paid, locked or dealt, and nobody is in the money.
fn check_payouts(agg: &Aggregate, now: i64) {
    let view = agg.view(now);
    let state = agg.state();
    if !state.config.payouts {
        assert!(state.payouts_locked.is_none() && state.deal.is_none());
        assert_eq!(view.places_paid, 0);
        assert_eq!(view.itm, mtt_core::view::Itm::NoPayouts);
        assert!(
            view.ranking
                .iter()
                .all(|r| !r.in_money && r.prize.is_none())
        );
        if let Some(money) = &view.money {
            assert!(money.payouts.is_empty() && !money.locked && money.deal.is_none());
        }
        return;
    }
    assert_ne!(view.itm, mtt_core::view::Itm::NoPayouts);
    let Some(money) = &view.money else {
        return;
    };
    let payouts = &money.payouts;
    assert!(payouts.windows(2).all(|w| w[0] >= w[1]), "{payouts:?}");
    let total: i64 = payouts.iter().map(|m| m.0).sum();
    let custom = matches!(
        agg.state().config.payout.amounts,
        Some(PayoutAmounts::CustomAmounts { .. })
    );
    if !money.locked {
        assert_eq!(payouts.len() as u32, view.places_paid);
        // Without players there is nobody to pay, guarantee or not.
        if !custom && view.counts.unique > 0 {
            assert_eq!(total, money.effective_pool.0, "payouts {payouts:?}");
        }
    }
    assert!(view.places_paid <= view.counts.unique);
    if view.winner.is_some() {
        let paid = payouts.len().min(view.counts.unique as usize);
        let expected: i64 = payouts[..paid].iter().map(|m| m.0).sum();
        let won: i64 = view
            .ranking
            .iter()
            .filter_map(|r| r.prize)
            .map(|m| m.0)
            .sum();
        assert_eq!(won, expected, "prizes do not add up");
    }
}

/// Chips in play and the pool are the sums of what the active events recorded, whatever
/// the configuration says now; the guarantee only tops the pool up.
fn check_money(agg: &Aggregate, now: i64) {
    let view = agg.view(now);
    // Per player: chips, prize, fee (an unregistration removes the player).
    let mut bought: BTreeMap<PlayerId, (i64, i64, i64)> = BTreeMap::new();
    let mut add = |player: PlayerId, stack: Chips, price: &Option<Price>| {
        let entry = bought.entry(player).or_default();
        entry.0 += stack.0;
        if let Some(price) = price {
            entry.1 += price.prize.0;
            entry.2 += price.fee.0;
        }
    };
    let mut removed = BTreeSet::new();
    for env in &agg.events()[..agg.head()] {
        match &env.event {
            Event::PlayerRegistered {
                player,
                stack,
                price,
                ..
            }
            | Event::PlayerReEntered {
                player,
                stack,
                price,
                ..
            }
            | Event::RebuyRecorded {
                player,
                stack,
                price,
            }
            | Event::AddOnRecorded {
                player,
                stack,
                price,
            } => add(*player, *stack, price),
            Event::PlayerUnregistered { player, .. } => {
                removed.insert(*player);
            }
            _ => {}
        }
    }
    let kept = bought.iter().filter(|(p, _)| !removed.contains(p));
    let (chips, prize, fees) = kept.fold((0, 0, 0), |acc, (_, b)| {
        (acc.0 + b.0, acc.1 + b.1, acc.2 + b.2)
    });
    assert_eq!(view.chips.in_play.0, chips, "chips in play");
    let Some(money) = view.money else {
        assert!(agg.state().config.money.is_none());
        return;
    };
    assert_eq!((money.pool.0, money.fees.0), (prize, fees));
    let guarantee = money.guarantee.map_or(0, |g| g.0);
    assert_eq!(money.effective_pool.0, prize.max(guarantee));
    assert_eq!(money.overlay.0, money.effective_pool.0 - prize);
}

/// A deal between the players still in, as the UI would propose it: ICM on the chips
/// they bought, over the locked payouts of the remaining places.
fn icm_deal(state: &State, play_for: Option<Money>) -> Command {
    let alive: Vec<&mtt_core::state::Player> =
        state.players.values().filter(|p| p.is_alive()).collect();
    let empty = Command::RecordDeal {
        amounts: Vec::new(),
        play_for,
    };
    let Some(locked) = &state.payouts_locked else {
        return empty;
    };
    let prizes: Vec<Money> = (1..=alive.len() as u32)
        .map(|place| payouts::amount_at(&locked.amounts, place))
        .collect();
    let first = prizes.first().copied().unwrap_or(Money::ZERO);
    let request = mtt_core::DealRequest {
        stacks: alive.iter().map(|p| p.chips_bought).collect(),
        prizes,
        play_for: play_for.map(|p| p.min(first)),
    };
    match mtt_core::icm::quote(&request) {
        Ok(quote) => Command::RecordDeal {
            amounts: alive
                .iter()
                .zip(quote.icm)
                .map(|(p, amount)| mtt_core::DealShare {
                    player: p.id,
                    amount,
                })
                .collect(),
            play_for: Some(quote.play_for),
        },
        Err(_) => empty,
    }
}

#[allow(clippy::too_many_arguments)]
fn run_ops(
    late_reg: Deadline,
    trigger: u8,
    money: Option<MoneyConfig>,
    payouts: bool,
    payout: PayoutConfig,
    players: u32,
    start: bool,
    ops: Vec<Op>,
) {
    // Purchases are free without money tracking.
    let price = |prize: i64, fee: i64| {
        if money.is_some() {
            (prize, fee)
        } else {
            (0, 0)
        }
    };
    let ((p1, f1), (p2, f2), (p3, f3)) = (price(1_000, 100), price(1_000, 0), price(500, 50));
    let config = Config {
        places_paid: 2,
        late_reg,
        balance_trigger: trigger,
        money,
        payouts,
        payout,
        reentry: Some(Purchase {
            max: Some(2),
            ..Purchase::new(p1, f1, 10_000)
        }),
        rebuy: Some(Purchase {
            window: Some(PurchaseWindow::Until {
                deadline: Deadline::Elapsed { ms: 60 * MIN },
            }),
            ..Purchase::new(p2, f2, 10_000)
        }),
        addon: Some(Purchase {
            max: Some(1),
            window: Some(PurchaseWindow::Until {
                deadline: Deadline::EndOfPlayLevel {
                    n: 1,
                    through_break: true,
                },
            }),
            ..Purchase::new(p3, f3, 15_000)
        }),
        ..Config::new("Prop", SEATS, TABLES, 10_000)
    };
    let mut h = Harness::new(config, levels());
    for i in 0..players {
        h.register(&format!("S{i}"));
    }
    if start {
        h.start();
    }
    for op in ops {
        let cmd = match op {
            Op::Advance(ms) => {
                h.advance(ms);
                continue;
            }
            Op::Cmd(cmd) => cmd,
        };
        // Keep the money and purchase settings: switching money tracking is rejected once
        // someone paid.
        let cmd = match cmd {
            Command::UpdateConfig { config } => {
                let current = &h.agg.state().config;
                Command::UpdateConfig {
                    config: Config {
                        money: current.money.clone(),
                        reentry: current.reentry,
                        rebuy: current.rebuy,
                        addon: current.addon,
                        ..config
                    },
                }
            }
            Command::RecordDeal { play_for, .. } => icm_deal(h.agg.state(), play_for),
            // Half the re-entries target a busted player, the rest stay random.
            Command::ReEnter { player, seat } if player.0 % 2 == 0 => {
                let busted: Vec<PlayerId> = h
                    .agg
                    .state()
                    .players
                    .values()
                    .filter(|p| !p.is_alive())
                    .map(|p| p.id)
                    .collect();
                let player = busted
                    .get(player.0 as usize % busted.len().max(1))
                    .copied()
                    .unwrap_or(player);
                Command::ReEnter { player, seat }
            }
            other => other,
        };
        let before = h.agg.clone();
        let result = h.run(cmd.clone());
        match result {
            Err(_) => assert_eq!(h.agg, before, "rejected {cmd:?} changed the aggregate"),
            Ok(_) if matches!(cmd, Command::Undo {} | Command::Redo {}) => {}
            Ok(_) => {
                let mut probe = h.agg.clone();
                probe.undo().expect("undo after a command");
                assert_eq!(
                    probe.state(),
                    before.state(),
                    "undo is not the inverse of {cmd:?}"
                );
                probe.redo().expect("redo after undo");
                assert_eq!(
                    probe.state(),
                    h.agg.state(),
                    "redo is not the inverse of undo"
                );
            }
        }
        check_invariants(h.agg.state(), &h.view());
        check_clock(h.agg.state(), h.now);
        check_balance_plan(&h.agg, h.now);
        check_money(&h.agg, h.now);
        check_payouts(&h.agg, h.now);
    }
    let json = h.agg.to_json().expect("serializable log");
    let reloaded = Aggregate::from_json(&json).expect("replayable log");
    assert_eq!(reloaded, h.agg, "replay after a JSON round trip differs");
}

// 256 cases by default; set PROPTEST_CASES for longer runs.
proptest! {
    #[test]
    fn random_sequences_keep_invariants(
        late_reg in deadline(),
        trigger in 2u8..=SEATS,
        money in money(),
        payouts in prop::bool::weighted(0.8),
        payout in payout(),
        players in 2u32..=12,
        start in any::<bool>(),
        ops in prop::collection::vec(op(), 1..80),
    ) {
        run_ops(late_reg, trigger, money, payouts, payout, players, start, ops);
    }

    #[test]
    fn deals_share_the_remaining_payouts(
        players in 3u32..=12,
        early_busts in 0usize..=8,
        payout in payout(),
        guarantee in prop::option::of(0i64..=200_000),
        play_for in 0i64..=3_000,
        seed in any::<u64>(),
    ) {
        let money = MoneyConfig {
            guarantee: guarantee.map(Money),
            rounding_unit: Money(100),
            ..MoneyConfig::new("EUR", 2, 10_000, 1_000)
        };
        let config = Config {
            money: Some(money),
            payout,
            ..Config::new("Deal", 6, 3, 10_000)
        };
        let mut h = Harness::new(config, levels());
        h.seed = seed;
        let ids = h.register_many(players);
        h.start();
        let busted = early_busts.min(players as usize - 2);
        for &id in &ids[..busted] {
            h.bust(&[id]);
        }
        h.ok(Command::CloseRegistration {});
        h.ok(Command::LockPayouts {});
        let deal = icm_deal(h.agg.state(), Some(Money(play_for)));
        h.ok(deal);
        check_invariants(h.agg.state(), &h.view());
        // Play on to the end.
        for &id in &ids[busted..ids.len() - 1] {
            h.bust(&[id]);
        }
        let view = h.view();
        prop_assert!(view.winner.is_some());
        let money = view.money.as_ref().unwrap();
        let paid = money.payouts.len().min(players as usize);
        let expected: i64 = money.payouts[..paid].iter().map(|m| m.0).sum();
        let won: i64 = view.ranking.iter().filter_map(|r| r.prize).map(|m| m.0).sum();
        prop_assert_eq!(won, expected);
        check_invariants(h.agg.state(), &view);
        let reloaded = Aggregate::from_json(&h.agg.to_json().unwrap()).unwrap();
        prop_assert_eq!(reloaded, h.agg);
    }

    #[test]
    fn icm_sums_exactly_for_any_input(
        stacks in prop::collection::vec(prop_oneof![Just(0i64), 1i64..=1_000_000_000], 0..=10),
        prizes in prop::collection::vec(0i64..=1_000_000_000_000, 0..=10),
        play_for in 0i64..=1_000,
    ) {
        let prizes: Vec<Money> = prizes.into_iter().take(stacks.len()).map(Money).collect();
        let total: i64 = prizes.iter().map(|m| m.0).sum();
        let top = prizes.iter().map(|m| m.0).max().unwrap_or(0);
        let stacks: Vec<Chips> = stacks.into_iter().map(Chips).collect();
        let out = mtt_core::icm(&stacks, &prizes).unwrap();
        prop_assert_eq!(out.iter().map(|m| m.0).sum::<i64>(), total);
        prop_assert!(out.iter().all(|m| m.0 >= 0 && m.0 <= top + 1), "{:?}", out);
        let first = prizes.first().map_or(0, |m| m.0);
        let request = mtt_core::DealRequest { stacks, prizes, play_for: Some(Money(play_for.min(first))) };
        let quote = mtt_core::icm::quote(&request).unwrap();
        let left = total - quote.play_for.0;
        prop_assert_eq!(quote.icm.iter().map(|m| m.0).sum::<i64>(), left);
        prop_assert_eq!(quote.chip_chop.iter().map(|m| m.0).sum::<i64>(), left);
    }

    #[test]
    fn payouts_split_the_pool_exactly(
        pool in 0i64..=(1i64 << 53) - 1,
        places in 1u32..=300,
        amounts in prop::option::of(amounts()),
        unit in prop_oneof![Just(1i64), Just(100), Just(5_000)],
        min_cash in prop::option::of(0i64..=1_000_000),
    ) {
        let table = payouts::compute(Money(pool), places, amounts.as_ref(), Money(unit), min_cash.map(Money));
        let a = &table.amounts;
        // A custom table pays at most its length.
        let wanted = match &amounts {
            Some(PayoutAmounts::CustomBps { bps }) => places.min(bps.len() as u32),
            Some(PayoutAmounts::CustomAmounts { amounts }) => places.min(amounts.len() as u32),
            _ => places,
        };
        prop_assert!(!a.is_empty() && a.len() <= wanted as usize);
        prop_assert!(a.windows(2).all(|w| w[0] >= w[1]), "not decreasing: {:?}", a);
        if !matches!(amounts, Some(PayoutAmounts::CustomAmounts { .. })) {
            prop_assert_eq!(a.iter().map(|m| m.0).sum::<i64>(), pool);
            prop_assert!(a[1..].iter().all(|m| m.0 % unit == 0));
            let threshold = min_cash.unwrap_or(0).max(1);
            if pool > 0 && a.len() > 1 {
                prop_assert!(a[a.len() - 1].0 >= threshold);
            }
            prop_assert_eq!(table.reduced_from.is_some(), a.len() < wanted as usize);
        }
    }

    #[test]
    fn pause_then_resume_keeps_the_remaining_time(
        levels in structure(),
        level in 0u16..8,
        ends_in in 1i64..=30 * MIN,
        pause_after in 0i64..=200 * MIN,
        resume_after in 0i64..=200 * MIN,
    ) {
        let now = T0;
        let level = level.min(levels.len() as u16 - 1);
        let running = Clock::Running { level, ends_at_ms: now + ends_in };
        let paused_at = now + pause_after;
        let before = effective(&running, &levels, paused_at);
        let paused = Clock::Paused { level: before.level as u16, remaining_ms: before.remaining_ms };
        let resumed_at = paused_at + resume_after;
        let resumed = Clock::Running {
            level: before.level as u16,
            ends_at_ms: resumed_at + before.remaining_ms,
        };
        let after = effective(&resumed, &levels, resumed_at);
        prop_assert_eq!(effective(&paused, &levels, resumed_at).remaining_ms, before.remaining_ms);
        if before.remaining_ms > 0 {
            prop_assert_eq!((after.level, after.remaining_ms), (before.level, before.remaining_ms));
        }
    }
}
