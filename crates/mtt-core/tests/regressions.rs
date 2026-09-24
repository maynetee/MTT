//! Named regressions for bugs of the prototype, exercised through the public API.

mod common;

use common::*;
use mtt_core::state::TableStatus;
use mtt_core::view::Itm;
use mtt_core::{
    Clock, Command, Config, Ctx, Deadline, DomainError, Phase, SeatRef, TableNo, Warning, decide,
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
    assert_eq!(view.itm, Itm::InMoney);
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
    let mut state = h.agg.state().clone();
    let table = state.tables.get_mut(&TableNo(2)).unwrap();
    table.occupants.clear();
    table.status = TableStatus::Closed;
    let cmd = Command::Register {
        name: "C".into(),
        seat: Some(SeatRef::new(2, 3)),
    };
    assert_eq!(
        decide(&state, &cmd, &Ctx::new(h.now, 1)),
        Err(DomainError::TableClosed { table: TableNo(2) })
    );
    // A never-opened table is fine: the forced seat opens it.
    let idle = Command::Register {
        name: "C".into(),
        seat: Some(SeatRef::new(3, 3)),
    };
    assert!(decide(&state, &idle, &Ctx::new(h.now, 1)).is_ok());
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
