//! Named regressions for bugs of the prototype, exercised through the public API.

mod common;

use common::*;
use mtt_core::config::{PayoutAmounts, PlacesPaid};
use mtt_core::seating::BalanceStep;
use mtt_core::state::TableStatus;
use mtt_core::view::Itm;
use mtt_core::{
    Aggregate, Chips, Clock, Command, Config, Deadline, DomainError, Money, MoveReason,
    PayoutConfig, Phase, PlayerId, Purchase, SeatNo, SeatRef, TableNo, Warning,
};

#[test]
fn ranking_not_inverted_mid_tournament() {
    let mut h = Harness::standard(9, 2);
    let ids = h.register_many(6);
    h.start();
    h.bust(&[ids[0]]);
    h.advance(MIN);
    h.bust(&[ids[1]]);
    h.advance(MIN);
    h.bust(&[ids[2]]);
    let view = h.view();
    assert_eq!(place_of(&view, ids[0]), Some((6, None)));
    assert_eq!(place_of(&view, ids[1]), Some((5, None)));
    assert_eq!(place_of(&view, ids[2]), Some((4, None)));
    // Alive players first, then the best finishers.
    let order: Vec<_> = view.ranking.iter().map(|r| (r.alive, r.place)).collect();
    assert_eq!(
        order,
        vec![
            (true, None),
            (true, None),
            (true, None),
            (false, Some(4)),
            (false, Some(5)),
            (false, Some(6))
        ]
    );
}

#[test]
fn bubble_is_paid_plus_one() {
    let mut h = Harness::standard(9, 1);
    let ids = h.register_many(6);
    h.start();
    assert_eq!(h.view().places_paid, 3);
    assert_eq!(h.view().itm, Itm::NotYet { to_money: 3 });
    h.bust(&[ids[0]]);
    assert_eq!(h.view().itm, Itm::NotYet { to_money: 2 });
    h.bust(&[ids[1]]);
    assert_eq!(h.view().itm, Itm::Bubble);
    h.bust(&[ids[2]]);
    let view = h.view();
    assert_eq!(view.itm, Itm::InMoney { next_payout: None });
    assert!(view.ranking.iter().all(|r| r.in_money == r.alive));
}

#[test]
fn play_level_numbers_skip_breaks() {
    let h = Harness::standard(9, 1);
    let view = h.view();
    let numbers: Vec<_> = view.levels.iter().map(|l| l.play_level).collect();
    assert_eq!(numbers, vec![Some(1), Some(2), None, Some(3), Some(4)]);
    assert_eq!(view.clock.play_level, Some(1));
}

#[test]
fn forced_seat_rejects_closed_table() {
    let mut h = Harness::standard(6, 3);
    h.register_at("A", 1, 1);
    h.register_at("B", 2, 1);
    h.ok(Command::BreakTable { table: TableNo(2) });
    assert_eq!(
        h.err(Command::Register {
            name: "C".into(),
            seat: Some(SeatRef::new(2, 3)),
        }),
        DomainError::TableClosed { table: TableNo(2) }
    );
    // A never-opened table is fine: the forced seat opens it.
    h.register_at("C", 3, 3);
    // A broken table must be reopened explicitly.
    h.ok(Command::OpenTable { table: TableNo(2) });
    h.register_at("D", 2, 3);
}

#[test]
fn forced_seat_rejects_after_late_reg() {
    let mut h = Harness::standard(9, 2);
    h.register_many(4);
    h.start();
    h.ok(Command::CloseRegistration {});
    let err = h.err(Command::Register {
        name: "Late".into(),
        seat: Some(SeatRef::new(2, 5)),
    });
    assert_eq!(err, DomainError::LateRegClosed);
    h.ok(Command::ReopenRegistration {});
    h.register_at("Late", 2, 5);
}

#[test]
fn cannot_bust_last_player() {
    let mut h = Harness::standard(9, 1);
    let ids = h.register_many(3);
    h.start();
    assert_eq!(h.err(bust_cmd(&ids)), DomainError::LastPlayerStanding);
    h.bust(&[ids[0]]);
    assert_eq!(h.err(bust_cmd(&ids[1..])), DomainError::LastPlayerStanding);
    h.bust(&[ids[1]]);
    // Registration still open: one player left, not finished yet.
    assert_eq!(h.err(bust_cmd(&ids[2..])), DomainError::LastPlayerStanding);
    assert_eq!(h.agg.state().phase, Phase::Running);
}

#[test]
fn finished_stays_finished() {
    let mut h = Harness::standard(9, 1);
    let ids = h.register_many(3);
    h.start();
    h.ok(Command::CloseRegistration {});
    h.bust(&[ids[0]]);
    h.bust(&[ids[1]]);
    assert_eq!(h.agg.state().phase, Phase::Finished { winner: ids[2] });
    assert!(matches!(h.agg.state().clock, Clock::Paused { .. }));
    let seat = h.view().ranking[1].seat;
    assert_eq!(seat, None);
    let attempts = vec![
        Command::Register {
            name: "Late".into(),
            seat: None,
        },
        Command::RevivePlayer {
            player: ids[1],
            seat: SeatRef::new(1, 9),
        },
        Command::StartClock {},
        Command::ReopenRegistration {},
        Command::FinishTournament {},
        bust_cmd(&ids[2..]),
    ];
    for cmd in attempts {
        assert_eq!(h.err(cmd), DomainError::TournamentFinished);
    }
    let view = h.view();
    assert_eq!(view.winner, Some(ids[2]));
    assert_eq!(place_of(&view, ids[2]), Some((1, None)));
    // Undo is the way back.
    h.ok(Command::Undo {});
    assert_eq!(h.agg.state().phase, Phase::Running);
    h.ok(Command::Redo {});
    assert_eq!(h.agg.state().phase, Phase::Finished { winner: ids[2] });
}

#[test]
fn simultaneous_busts_rank_by_starting_stack() {
    let mut h = Harness::standard(9, 1);
    let ids = h.register_many(6);
    h.start();
    h.ok(bust_with_stacks(&[
        (ids[0], 1_000),
        (ids[1], 3_000),
        (ids[2], 2_000),
    ]));
    let view = h.view();
    assert_eq!(place_of(&view, ids[1]), Some((4, None)));
    assert_eq!(place_of(&view, ids[2]), Some((5, None)));
    assert_eq!(place_of(&view, ids[0]), Some((6, None)));
    // Equal stacks share the span.
    h.ok(bust_with_stacks(&[(ids[3], 800), (ids[4], 800)]));
    let view = h.view();
    assert_eq!(place_of(&view, ids[3]), Some((2, Some(3))));
    assert_eq!(place_of(&view, ids[4]), Some((2, Some(3))));
}

fn level_and_remaining(h: &Harness) -> (u16, i64) {
    let clock = h.view().clock;
    (clock.level_index, clock.remaining_ms)
}

#[test]
fn update_structure_while_running() {
    let mut h = Harness::standard(9, 1);
    h.register_many(2);
    h.start();
    h.advance(5 * MIN);
    let mut levels = levels();
    // The current level is editable: +10 minutes keeps the 5 elapsed minutes.
    levels[0] = play(25, 50, 30);
    h.ok(Command::UpdateStructure {
        levels: levels.clone(),
    });
    assert_eq!(level_and_remaining(&h), (0, 25 * MIN));
    assert_eq!(h.view().clock.duration_ms, 30 * MIN);
    // Shortening it below the elapsed time ends it now.
    levels[0] = play(25, 50, 2);
    h.ok(Command::UpdateStructure {
        levels: levels.clone(),
    });
    assert_eq!(level_and_remaining(&h), (1, 20 * MIN));
    assert_eq!(
        h.err(Command::UpdateStructure {
            levels: levels.clone()
        }),
        DomainError::NoChange
    );
    // Levels already played are frozen and the current one cannot be removed.
    let mut edited = levels.clone();
    edited[0] = play(25, 50, 25);
    assert_eq!(
        h.err(Command::UpdateStructure { levels: edited }),
        DomainError::PastLevelModified { index: 0 }
    );
    assert_eq!(
        h.err(Command::UpdateStructure {
            levels: levels[..1].to_vec()
        }),
        DomainError::CurrentLevelRemoved { index: 1 }
    );
    // Future levels are free.
    levels[3] = play(80, 160, 20);
    h.ok(Command::UpdateStructure {
        levels: levels.clone(),
    });
    // In overtime, appended levels start now.
    h.advance(3 * 60 * MIN);
    assert!(h.view().warnings.contains(&Warning::StructureExhausted));
    levels.push(play(150, 300, 20));
    h.ok(Command::UpdateStructure { levels });
    let clock = h.view().clock;
    assert_eq!(
        (clock.level_index, clock.remaining_ms, clock.overtime_ms),
        (5, 20 * MIN, 0)
    );
}

#[test]
fn undo_across_auto_boundary() {
    let mut h = Harness::standard(9, 1);
    h.register_many(2);
    h.start();
    h.advance(25 * MIN);
    // Level 1 started on its own five minutes ago, without writing anything.
    assert_eq!(h.agg.events().len(), 4);
    assert_eq!(level_and_remaining(&h), (1, 15 * MIN));
    h.ok(Command::PauseClock {});
    assert_eq!(
        h.agg.state().clock,
        Clock::Paused {
            level: 1,
            remaining_ms: 15 * MIN
        }
    );
    h.advance(5 * MIN);
    // Undoing the pause restores the running clock, not the level it started on.
    h.ok(Command::Undo {});
    assert!(h.view().clock.running);
    assert_eq!(level_and_remaining(&h), (1, 10 * MIN));
    // A mistaken "next level" is undone the same way.
    h.ok(Command::NextLevel {});
    assert_eq!(level_and_remaining(&h), (2, 10 * MIN));
    h.advance(MIN);
    h.ok(Command::Undo {});
    assert_eq!(level_and_remaining(&h), (1, 9 * MIN));
}

#[test]
fn late_reg_level_is_1_based_play_level() {
    let with = |through_break| {
        let config = Config {
            late_reg: Deadline::EndOfPlayLevel {
                n: 2,
                through_break,
            },
            ..config(9, 2)
        };
        let mut h = Harness::new(config, levels());
        h.register_many(2);
        h.start();
        h
    };
    // Levels: play 1, play 2, break, play 3, play 4 (20' each, break 10').
    let mut h = with(false);
    h.advance(39 * MIN);
    assert_eq!(h.view().clock.play_level, Some(2));
    assert!(h.view().registration.open);
    h.register("Late");
    h.advance(MIN);
    assert!(h.view().clock.is_break);
    assert!(!h.view().registration.open);
    assert_eq!(
        h.err(Command::Register {
            name: "Too late".into(),
            seat: Some(SeatRef::new(2, 1)),
        }),
        DomainError::LateRegClosed
    );
    // Through the break: open until play level 3 starts.
    let mut h = with(true);
    h.advance(49 * MIN);
    assert!(h.view().registration.open);
    h.advance(MIN);
    assert_eq!(h.view().clock.play_level, Some(3));
    assert!(!h.view().registration.open);
    // n counts play levels only: there are 4.
    let mut config = h.agg.state().config.clone();
    config.late_reg = Deadline::EndOfPlayLevel {
        n: 5,
        through_break: false,
    };
    assert_eq!(
        h.err(Command::UpdateConfig { config }),
        DomainError::InvalidLateRegLevel { n: 5, max: 4 }
    );
}

#[test]
fn clock_never_writes_on_tick() {
    let mut h = Harness::standard(9, 1);
    h.register_many(2);
    h.start();
    let before = h.agg.clone();
    let mut previous = 0;
    for minute in 0..=200 {
        let at = h.now + minute * MIN;
        let view = h.agg.view(at);
        assert!(view.clock.level_index >= previous);
        previous = view.clock.level_index;
        assert_eq!(view, h.agg.view(at), "the view is a pure function of time");
    }
    assert_eq!(previous, 4);
    assert_eq!(h.agg, before, "reading the clock changed the aggregate");
}

#[test]
fn pause_resume_keeps_remaining() {
    let mut h = Harness::standard(9, 1);
    h.register_many(2);
    h.start();
    h.advance(7 * MIN + 13_000);
    h.ok(Command::PauseClock {});
    let remaining = 20 * MIN - 7 * MIN - 13_000;
    assert_eq!(level_and_remaining(&h), (0, remaining));
    h.advance(60 * MIN);
    assert_eq!(level_and_remaining(&h), (0, remaining));
    h.ok(Command::StartClock {});
    assert_eq!(level_and_remaining(&h), (0, remaining));
    assert_eq!(h.view().clock.ends_at_ms, Some(h.now + remaining));
    // Pausing after an automatic level change keeps the new level's time.
    h.advance(remaining + 3 * MIN);
    h.ok(Command::PauseClock {});
    assert_eq!(level_and_remaining(&h), (1, 17 * MIN));
}

#[test]
fn adjust_below_zero_advances() {
    let mut h = Harness::standard(9, 1);
    h.register_many(2);
    h.start();
    h.advance(8 * MIN);
    h.ok(Command::AdjustTime {
        delta_ms: -15 * MIN,
    });
    assert_eq!(level_and_remaining(&h), (1, 20 * MIN));
    // Paused at zero, the level changes as soon as the clock starts.
    h.ok(Command::PauseClock {});
    h.ok(Command::SetRemaining { ms: 0 });
    assert_eq!(level_and_remaining(&h), (1, 0));
    h.ok(Command::StartClock {});
    assert_eq!(level_and_remaining(&h), (2, 10 * MIN));
}

fn set_button(h: &mut Harness, table: u16, seat: u8) {
    h.ok(Command::SetButton {
        table: TableNo(table),
        seat: SeatNo(seat),
    });
}

fn counts(h: &Harness) -> Vec<(u16, u8)> {
    h.view()
        .tables
        .iter()
        .filter(|t| t.status == TableStatus::Open)
        .map(|t| (t.table.0, t.players))
        .collect()
}

#[test]
fn balance_moves_bb_due_player() {
    let mut h = Harness::standard(9, 2);
    for seat in 1..=9 {
        h.register_at(&format!("A{seat}"), 1, seat);
    }
    for seat in [1, 2, 4, 6, 7] {
        h.register_at(&format!("B{seat}"), 2, seat);
    }
    h.start();
    set_button(&mut h, 1, 3);
    set_button(&mut h, 2, 1);
    let table = &h.view().tables[0];
    assert_eq!(
        (table.next_sb, table.next_bb),
        (Some(SeatNo(4)), Some(SeatNo(5)))
    );
    // Table 1's next big blind goes to seat 3 of table 2, between its blinds (2 and 4):
    // the worst position, big blind on the very next hand.
    let step = |player: u32, from_seat: u8, to_seat: u8| BalanceStep {
        from_table: TableNo(1),
        to_table: TableNo(2),
        player: Some(PlayerId(player)),
        from_seat: Some(SeatNo(from_seat)),
        to_seat: Some(SeatNo(to_seat)),
        waits_for_bb: false,
        needs_button: Vec::new(),
    };
    assert_eq!(
        h.view().suggestions.balance,
        vec![step(5, 5, 3), step(6, 6, 5)]
    );
    h.ok(Command::MovePlayer {
        player: PlayerId(5),
        to: SeatRef::new(2, 3),
        reason: Some(MoveReason::Balance),
    });
    // The plan is recomputed after each move.
    assert_eq!(h.view().suggestions.balance, vec![step(6, 6, 5)]);
    h.ok(Command::MovePlayer {
        player: PlayerId(6),
        to: SeatRef::new(2, 5),
        reason: Some(MoveReason::Balance),
    });
    assert!(h.view().suggestions.balance.is_empty());
    assert_eq!(counts(&h), vec![(1, 7), (2, 7)]);
}

#[test]
fn break_table_balances() {
    let mut h = Harness::standard(9, 3);
    for (table, players) in [(1, 6), (2, 5), (3, 3)] {
        for seat in 1..=players {
            h.register_at(&format!("T{table}S{seat}"), table, seat);
        }
    }
    h.start();
    set_button(&mut h, 3, 2);
    // 14 players fit on two tables of 9: break the highest-numbered table.
    assert_eq!(h.view().suggestions.break_table, Some(TableNo(3)));
    h.ok(Command::BreakTable { table: TableNo(3) });
    // Dealt to the tables with the fewest players: 6 + 1 and 5 + 2.
    assert_eq!(counts(&h), vec![(1, 7), (2, 7)]);
    let broken = &h.view().tables[2];
    assert_eq!(
        (broken.status, broken.players, broken.button),
        (TableStatus::Closed, 0, None)
    );
    assert_eq!(h.view().suggestions, Default::default());
    assert_eq!(
        h.err(Command::BreakTable { table: TableNo(3) }),
        DomainError::TableNotOpen { table: TableNo(3) }
    );
    check_invariants(h.agg.state(), &h.view());
}

#[test]
fn final_table_redraw_closes_other_tables() {
    let mut h = Harness::standard(6, 3);
    let ids = h.register_many(14);
    h.start();
    set_button(&mut h, 2, 1);
    for id in &ids[..7] {
        h.bust(&[*id]);
    }
    assert_eq!(h.view().suggestions.break_table, Some(TableNo(3)));
    assert_eq!(
        h.err(Command::FormFinalTable { table: TableNo(2) }),
        DomainError::TooManyForFinalTable { alive: 7, seats: 6 }
    );
    h.bust(&[ids[7]]);
    // Six left: the table that would be broken last hosts the final table.
    assert_eq!(h.view().suggestions.final_table, Some(TableNo(1)));
    h.ok(Command::FormFinalTable { table: TableNo(2) });
    let view = h.view();
    let statuses: Vec<_> = view
        .tables
        .iter()
        .map(|t| (t.status, t.players, t.button))
        .collect();
    assert_eq!(
        statuses,
        vec![
            (TableStatus::Closed, 0, None),
            (TableStatus::Open, 6, None),
            (TableStatus::Closed, 0, None)
        ]
    );
    let alive_tables: Vec<_> = view
        .ranking
        .iter()
        .filter(|r| r.alive)
        .map(|r| r.seat.map(|s| s.table))
        .collect();
    assert_eq!(alive_tables, vec![Some(TableNo(2)); 6]);
    assert_eq!(view.suggestions, Default::default());
    assert!(h.agg.state().final_table_formed);
    h.ok(Command::Undo {});
    assert!(!h.agg.state().final_table_formed);
    assert_eq!(h.view().suggestions.final_table, Some(TableNo(1)));
}

// Money.

#[test]
fn guarantee_overlay() {
    let config = Config {
        money: Some(mtt_core::MoneyConfig {
            guarantee: Some(Money(100_000)),
            ..money()
        }),
        ..config(9, 2)
    };
    let mut h = Harness::new(config, levels());
    let ids = h.register_many(6);
    let money = h.view().money.expect("money is tracked");
    assert_eq!(
        (money.pool, money.fees, money.overlay, money.effective_pool),
        (Money(60_000), Money(6_000), Money(40_000), Money(100_000))
    );
    // Unregistering before the start refunds the entry.
    h.ok(Command::Unregister { player: ids[0] });
    let money = h.view().money.unwrap();
    assert_eq!((money.pool, money.overlay), (Money(50_000), Money(50_000)));
    // Beyond the guarantee there is no overlay.
    h.register_many_from(7, 12);
    let money = h.view().money.unwrap();
    assert_eq!(
        (money.pool, money.overlay, money.effective_pool),
        (Money(110_000), Money(0), Money(110_000))
    );
    assert_eq!(money.guarantee, Some(Money(100_000)));
}

/// A log written before money tracking existed replays unchanged: no prices, no money
/// section, the same view as before.
#[test]
fn v1_log_without_money_replays() {
    let json = include_str!("golden/v1_log.json");
    let agg = Aggregate::from_json(json).expect("old log replays");
    assert_eq!(agg.head(), 12);
    assert_eq!(agg.events().len(), 13);
    let view = agg.view(T0 + 60 * MIN);
    assert_eq!(view.money, None);
    assert_eq!(view.places_paid, 3);
    assert_eq!(
        (view.counts.unique, view.counts.entries, view.counts.alive),
        (4, 4, 2)
    );
    assert_eq!(h_names(&view), vec!["Eve", "Bob", "Dave", "Alice"]);
    // Rewriting the log changes nothing either.
    let again = Aggregate::from_json(&agg.to_json().unwrap()).unwrap();
    assert_eq!(again, agg);
    let original: serde_json::Value = serde_json::from_str(json).unwrap();
    let rewritten: serde_json::Value = serde_json::from_str(&agg.to_json().unwrap()).unwrap();
    assert_eq!(rewritten, original);
}

fn h_names(view: &mtt_core::View) -> Vec<&str> {
    view.ranking.iter().map(|r| r.name.as_str()).collect()
}

// Re-entries, rebuys, add-ons.

fn reentry_harness(players: u32) -> (Harness, Vec<PlayerId>) {
    let config = Config {
        reentry: Some(Purchase::new(10_000, 1_000, 10_000)),
        ..money_config(9, 2)
    };
    let mut h = Harness::new(config, levels());
    let ids = h.register_many(players);
    h.start();
    (h, ids)
}

fn row(view: &mtt_core::View, player: PlayerId) -> &mtt_core::view::RankingRow {
    view.ranking.iter().find(|r| r.player == player).unwrap()
}

#[test]
fn reentry_does_not_add_a_player() {
    let (mut h, ids) = reentry_harness(4);
    h.bust(&[ids[0]]);
    h.ok(Command::ReEnter {
        player: ids[0],
        seat: None,
    });
    let view = h.view();
    let c = &view.counts;
    assert_eq!(
        (c.unique, c.entries, c.alive, c.busted, c.reentries),
        (4, 5, 4, 0, Some(1))
    );
    // Chips in play count every stack bought; the average uses them.
    assert_eq!(view.chips.in_play, Chips(50_000));
    assert_eq!(view.chips.avg_stack, Some(Chips(12_500)));
    assert_eq!(view.money.as_ref().unwrap().pool, Money(50_000));
    assert_eq!(view.ranking.len(), 4);
    let back = row(&view, ids[0]);
    assert!(back.alive && back.place.is_none());
    assert_eq!(back.entries, 2);
}

#[test]
fn only_final_bust_gets_a_place() {
    let (mut h, ids) = reentry_harness(5);
    h.bust(&[ids[0]]);
    let view = h.view();
    assert_eq!(place_of(&view, ids[0]), Some((5, None)));
    assert!(row(&view, ids[0]).provisional);
    h.ok(Command::ReEnter {
        player: ids[0],
        seat: None,
    });
    h.bust(&[ids[1]]);
    h.bust(&[ids[0]]);
    h.ok(Command::CloseRegistration {});
    let view = h.view();
    // One row per player: the first bust of ids[0] no longer counts.
    assert_eq!(view.ranking.len(), 5);
    assert_eq!(place_of(&view, ids[1]), Some((5, None)));
    assert_eq!(place_of(&view, ids[0]), Some((4, None)));
    assert!(view.ranking.iter().all(|r| !r.provisional));
    check_invariants(h.agg.state(), &view);
}

#[test]
fn finish_waits_while_entries_can_arrive() {
    let (mut h, ids) = reentry_harness(3);
    h.bust(&[ids[0]]);
    h.bust(&[ids[1]]);
    // Registration and re-entry are open: no winner yet.
    assert_eq!(h.agg.state().phase, Phase::Running);
    assert!(h.view().warnings.contains(&Warning::FinishPending));
    h.ok(Command::ReEnter {
        player: ids[1],
        seat: None,
    });
    assert!(!h.view().warnings.contains(&Warning::FinishPending));
    h.ok(Command::CloseRegistration {});
    assert_eq!(
        h.err(Command::ReEnter {
            player: ids[0],
            seat: None
        }),
        DomainError::ReentryClosed
    );
    h.bust(&[ids[1]]);
    assert_eq!(h.agg.state().phase, Phase::Finished { winner: ids[2] });
    let view = h.view();
    assert_eq!(place_of(&view, ids[1]), Some((2, None)));
    assert_eq!(view.counts.entries, 4);
}

#[test]
fn rebuys_and_addons_raise_chips_and_pool() {
    let config = Config {
        rebuy: Some(Purchase::new(10_000, 0, 10_000)),
        addon: Some(Purchase {
            max: Some(1),
            ..Purchase::new(5_000, 500, 20_000)
        }),
        ..money_config(9, 1)
    };
    let mut h = Harness::new(config, levels());
    let ids = h.register_many(3);
    h.start();
    h.ok(Command::Rebuy { player: ids[0] });
    h.ok(Command::AddOn { player: ids[0] });
    h.ok(Command::AddOn { player: ids[1] });
    let view = h.view();
    assert_eq!(view.chips.in_play, Chips(30_000 + 10_000 + 40_000));
    assert_eq!(
        (view.counts.entries, view.counts.rebuys, view.counts.addons),
        (3, Some(1), Some(2))
    );
    let money = view.money.as_ref().unwrap();
    assert_eq!((money.pool, money.fees), (Money(50_000), Money(4_000)));
    let first = row(&view, ids[0]);
    assert_eq!((first.rebuys, first.addons), (Some(1), Some(1)));
    assert_eq!(
        (view.registration.rebuy_open, view.registration.reentry_open),
        (Some(true), None)
    );
}

// Payouts.

fn total(amounts: &[Money]) -> i64 {
    amounts.iter().map(|m| m.0).sum()
}

fn percent_config(guarantee: Option<i64>, min_cash: Option<i64>) -> Config {
    Config {
        payout: PayoutConfig {
            places_paid: Some(PlacesPaid::Percent { bps: 1_500 }),
            amounts: None,
        },
        money: Some(mtt_core::MoneyConfig {
            guarantee: guarantee.map(Money),
            min_cash: min_cash.map(Money),
            ..money()
        }),
        reentry: Some(Purchase::new(10_000, 1_000, 10_000)),
        addon: Some(Purchase::new(5_000, 0, 10_000)),
        ..config(10, 10)
    }
}

#[test]
fn payouts_sum_to_effective_pool() {
    let mut h = Harness::new(percent_config(Some(500_000), None), levels());
    let ids = h.register_many(40);
    let check = |h: &Harness| {
        let view = h.view();
        let money = view.money.as_ref().unwrap();
        assert_eq!(total(&money.payouts), money.effective_pool.0);
        assert_eq!(money.payouts.len() as u32, view.places_paid);
        money.effective_pool
    };
    // The guarantee is split while the pool is below it.
    assert_eq!(check(&h), Money(500_000));
    h.start();
    for &id in &ids[..5] {
        h.bust(&[id]);
        h.ok(Command::ReEnter {
            player: id,
            seat: None,
        });
    }
    h.ok(Command::AddOn { player: ids[7] });
    h.register_many_from(41, 80);
    // 85 entries at 100 + one add-on at 50: 8550 EUR, above the guarantee.
    assert_eq!(check(&h), Money(855_000));
    assert_eq!(h.view().places_paid, 13);
    h.ok(Command::CloseRegistration {});
    let alive: Vec<PlayerId> = h
        .view()
        .ranking
        .iter()
        .filter(|r| r.alive)
        .map(|r| r.player)
        .collect();
    for &id in &alive[1..] {
        h.bust(&[id]);
    }
    let view = h.view();
    assert_eq!(view.phase, mtt_core::view::PhaseName::Finished);
    // Every place is assigned: the prizes add up to the pool.
    let won: i64 = view
        .ranking
        .iter()
        .filter_map(|r| r.prize)
        .map(|m| m.0)
        .sum();
    assert_eq!(won, 855_000);
    assert_eq!(view.ranking[0].prize, Some(view.money.unwrap().payouts[0]));
}

#[test]
fn payouts_non_increasing() {
    let mut h = Harness::new(percent_config(None, Some(30_000)), levels());
    for i in 1..=90 {
        h.register(&format!("P{i}"));
        let view = h.view();
        let payouts = &view.money.as_ref().unwrap().payouts;
        assert!(
            payouts.windows(2).all(|w| w[0] >= w[1]),
            "{i} entries: {payouts:?}"
        );
        assert!(payouts[1..].iter().all(|a| a.0 % 100 == 0 && a.0 >= 30_000));
        assert_eq!(total(payouts), i64::from(i) * 10_000);
    }
    // 90 entries want 14 places; with a 300 EUR minimum cash, 12 are paid (13 would pay
    // 292 EUR last, 12 pay 334 EUR: values checked by an independent computation).
    let view = h.view();
    assert_eq!(view.places_paid, 12);
    let payouts = &view.money.as_ref().unwrap().payouts;
    assert_eq!((payouts[0], payouts[11]), (Money(225_700), Money(33_400)));
    assert!(
        view.warnings
            .contains(&Warning::PlacesReduced { from: 14, to: 12 })
    );
}

#[test]
fn tie_split_across_paid_boundary() {
    let config = Config {
        payout: PayoutConfig {
            places_paid: Some(PlacesPaid::Fixed { n: 3 }),
            amounts: Some(PayoutAmounts::CustomBps {
                bps: vec![5_000, 3_000, 2_000],
            }),
        },
        money: Some(mtt_core::MoneyConfig {
            rounding_unit: Money(1),
            ..money()
        }),
        ..config(9, 1)
    };
    let mut h = Harness::new(config, levels());
    // Pool 50001: payouts 25001, 15000, 10000.
    let ids = h.register_many(5);
    h.ok(Command::UpdateConfig {
        config: Config {
            money: Some(mtt_core::MoneyConfig {
                buy_in: mtt_core::Price {
                    prize: Money(10_001),
                    fee: Money(1_000),
                },
                rounding_unit: Money(1),
                ..money()
            }),
            ..h.agg.state().config.clone()
        },
    });
    h.ok(Command::Unregister { player: ids[4] });
    let last = h.register("P5b");
    h.start();
    h.bust(&[last]);
    assert_eq!(h.view().itm, Itm::Bubble);
    // Places 3 and 4 tie: 10000 + 0 split in two.
    h.bust(&[ids[3], ids[2]]);
    let view = h.view();
    assert_eq!(
        view.money.as_ref().unwrap().payouts,
        vec![Money(25_001), Money(15_000), Money(10_000)]
    );
    for id in [ids[2], ids[3]] {
        let r = row(&view, id);
        assert_eq!((r.place, r.place_to, r.in_money), (Some(3), Some(4), true));
        assert_eq!(r.prize, Some(Money(5_000)));
    }
    assert_eq!(row(&view, last).prize, None);
    assert_eq!(
        view.itm,
        Itm::InMoney {
            next_payout: Some(Money(15_000))
        }
    );
    // An odd amount: the leftover minor unit goes to the lower player id.
    h.ok(Command::Undo {});
    let mut config = h.agg.state().config.clone();
    config.payout.amounts = Some(PayoutAmounts::CustomAmounts {
        amounts: vec![Money(25_000), Money(15_000), Money(10_001)],
    });
    h.ok(Command::UpdateConfig { config });
    h.bust(&[ids[3], ids[2]]);
    let view = h.view();
    assert_eq!(row(&view, ids[2]).prize, Some(Money(5_001)));
    assert_eq!(row(&view, ids[3]).prize, Some(Money(5_000)));
    // These custom amounts add up to the pool: no mismatch.
    assert!(
        !view
            .warnings
            .iter()
            .any(|w| matches!(w, Warning::PayoutsMismatch { .. }))
    );
}

/// A director who picked the wrong currency could not fix it once someone had paid (#87).
/// The code now changes at any time, amounts keeping their value; the exponent stays the
/// one the recorded amounts use.
#[test]
fn currency_relabel_after_the_first_entry() {
    let mut h = Harness::new(money_config(9, 1), levels());
    h.register_many(5);
    h.start();
    h.ok(Command::LockPayouts {});
    let before = h.view().money.unwrap();
    let with_currency = |h: &Harness, code: &str, exponent: u8| {
        let mut config = h.agg.state().config.clone();
        if let Some(money) = config.money.as_mut() {
            money.currency = mtt_core::config::Currency {
                code: code.to_owned(),
                exponent,
            };
        }
        Command::UpdateConfig { config }
    };
    assert_eq!(
        h.err(with_currency(&h, "JPY", 0)),
        DomainError::ConfigLocked {
            field: "money.currency.exponent".into()
        }
    );
    // Even with the payouts locked: the currency does not shape them.
    h.ok(with_currency(&h, "GBP", 2));
    h.ok(with_currency(&h, "JPY", 2));
    let after = h.view().money.unwrap();
    assert_eq!(
        (after.currency.code.as_str(), after.currency.exponent),
        ("JPY", 2)
    );
    assert_eq!(
        (after.pool, after.fees, &after.payouts, after.locked),
        (before.pool, before.fees, &before.payouts, true)
    );
    let replayed = Aggregate::from_json(&h.agg.to_json().unwrap()).unwrap();
    assert_eq!(replayed, h.agg);
}

// Tournaments without payouts (#86).

/// A freeroll for points pays nobody: no bubble, no money line, no prize, even with the
/// buy-ins tracked, and turning payouts back on restores the places paid.
#[test]
fn no_payouts_has_no_bubble() {
    let config = Config {
        payouts: false,
        ..money_config(9, 1)
    };
    let mut h = Harness::new(config, levels());
    let ids = h.register_many(6);
    h.start();
    for (i, &id) in ids[..5].iter().enumerate() {
        let view = h.view();
        assert_eq!(view.itm, Itm::NoPayouts, "after {i} busts");
        assert_eq!(view.places_paid, 0);
        if i == 2 {
            // Four left: the bubble with 3 places paid.
            let mut config = h.agg.state().config.clone();
            config.payouts = true;
            h.ok(Command::UpdateConfig { config });
            assert_eq!(h.view().itm, Itm::Bubble);
            assert_eq!(h.view().places_paid, 3);
            h.ok(Command::Undo {});
            assert_eq!(h.view().itm, Itm::NoPayouts);
        }
        if i == 4 {
            h.ok(Command::CloseRegistration {});
        }
        h.bust(&[id]);
    }
    let view = h.view();
    assert_eq!(view.winner, Some(ids[5]));
    assert!(
        view.ranking
            .iter()
            .all(|r| !r.in_money && r.prize.is_none())
    );
    let money = view.money.expect("the pool is still tracked");
    assert_eq!((money.pool, money.payouts.len()), (Money(60_000), 0));
    assert!(!money.locked && money.deal.is_none());
}

/// Locking payouts or recording a deal makes no sense without payouts; turning payouts
/// off is refused while they are locked, hence while a deal stands.
#[test]
fn no_payouts_rejects_lock_and_deal() {
    let mut h = Harness::new(money_config(9, 1), levels());
    let ids = h.register_many(4);
    h.start();
    h.bust(&[ids[0]]);
    h.ok(Command::CloseRegistration {});
    h.ok(Command::LockPayouts {});
    let mut off = h.agg.state().config.clone();
    off.payouts = false;
    assert_eq!(
        h.err(Command::UpdateConfig {
            config: off.clone()
        }),
        DomainError::PayoutsLocked
    );
    h.ok(Command::UnlockPayouts {});
    h.ok(Command::UpdateConfig { config: off });
    for cmd in [
        Command::LockPayouts {},
        Command::UnlockPayouts {},
        Command::RecordDeal {
            amounts: Vec::new(),
            play_for: None,
        },
    ] {
        assert_eq!(h.err(cmd), DomainError::PayoutsDisabled);
    }
    assert_eq!(
        serde_json::to_value(DomainError::PayoutsDisabled).unwrap(),
        serde_json::json!({"code": "PAYOUTS_DISABLED"})
    );
}

// ICM.

/// Brute force Malmuth-Harville: every finishing order, each with its probability.
fn icm_bruteforce(stacks: &[i64], prizes: &[i64]) -> Vec<f64> {
    fn walk(stacks: &[i64], prizes: &[i64], left: &mut Vec<usize>, p: f64, eq: &mut [f64]) {
        let rest: i64 = left.iter().map(|&i| stacks[i]).sum();
        let place = stacks.len() - left.len();
        for k in 0..left.len() {
            let i = left[k];
            let q = p * stacks[i] as f64 / rest as f64;
            eq[i] += q * prizes.get(place).copied().unwrap_or(0) as f64;
            let taken = left.remove(k);
            if !left.is_empty() {
                walk(stacks, prizes, left, q, eq);
            }
            left.insert(k, taken);
        }
    }
    let mut eq = vec![0.0; stacks.len()];
    walk(
        stacks,
        prizes,
        &mut (0..stacks.len()).collect(),
        1.0,
        &mut eq,
    );
    eq
}

fn icm_of(stacks: &[i64], prizes: &[i64]) -> Vec<i64> {
    let stacks: Vec<Chips> = stacks.iter().copied().map(Chips).collect();
    let prizes: Vec<Money> = prizes.iter().copied().map(Money).collect();
    mtt_core::icm(&stacks, &prizes)
        .unwrap()
        .iter()
        .map(|m| m.0)
        .collect()
}

#[test]
fn icm_two_players_closed_form() {
    // E1 = p2 + (p1 - p2) * s1 / S.
    for (s1, s2, p1, p2) in [
        (3_000, 1_000, 700, 300),
        (1, 1, 10_001, 0),
        (12_345, 67_890, 1_000_000, 400_000),
        (1, 999_999, 5_000_000, 1),
    ] {
        let out = icm_of(&[s1, s2], &[p1, p2]);
        let exact = p2 as f64 + (p1 - p2) as f64 * s1 as f64 / (s1 + s2) as f64;
        assert!((out[0] as f64 - exact).abs() < 1.0, "{out:?} vs {exact}");
        assert_eq!(out[0] + out[1], p1 + p2);
    }
}

#[test]
fn icm_matches_bruteforce_permutations() {
    let mut rng = mtt_core::rng::Rng::from_seed(56);
    for n in 2..=6usize {
        for _ in 0..40 {
            let stacks: Vec<i64> = (0..n).map(|_| 1 + i64::from(rng.below(100_000))).collect();
            let mut prizes: Vec<i64> = (0..1 + rng.index(n))
                .map(|_| i64::from(rng.below(1_000_000)))
                .collect();
            prizes.sort_unstable_by(|a, b| b.cmp(a));
            let expected = icm_bruteforce(&stacks, &prizes);
            let out = icm_of(&stacks, &prizes);
            for (got, want) in out.iter().zip(&expected) {
                assert!(
                    (*got as f64 - want).abs() < 1.0 + 1e-9,
                    "stacks {stacks:?} prizes {prizes:?}: {out:?} vs {expected:?}"
                );
            }
            assert_eq!(out.iter().sum::<i64>(), prizes.iter().sum::<i64>());
        }
    }
}

#[test]
fn icm_sums_exactly() {
    let mut rng = mtt_core::rng::Rng::from_seed(20);
    for _ in 0..300 {
        let n = 1 + rng.index(12);
        // Some players without chips, and amounts up to the JavaScript limit.
        let stacks: Vec<i64> = (0..n)
            .map(|_| match rng.below(4) {
                0 => 0,
                _ => i64::from(rng.next_u32()) << rng.below(21),
            })
            .collect();
        let prizes: Vec<i64> = (0..rng.index(n + 1))
            .map(|_| (i64::from(rng.next_u32()) << 16) / 64)
            .collect();
        let out = icm_of(&stacks, &prizes);
        assert_eq!(out.iter().sum::<i64>(), prizes.iter().sum::<i64>());
        assert!(out.iter().all(|&e| e >= 0));
        let quote = mtt_core::icm::quote(&mtt_core::DealRequest {
            stacks: stacks.iter().copied().map(Chips).collect(),
            prizes: prizes.iter().copied().map(Money).collect(),
            play_for: None,
        })
        .unwrap();
        let chop: i64 = quote.chip_chop.iter().map(|m| m.0).sum();
        assert_eq!(chop, prizes.iter().sum::<i64>());
    }
}
