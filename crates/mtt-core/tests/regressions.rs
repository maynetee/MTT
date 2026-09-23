//! Named regressions for bugs of the prototype, exercised through the public API.

mod common;

use common::*;
use mtt_core::state::TableStatus;
use mtt_core::view::Itm;
use mtt_core::{Clock, Command, Ctx, DomainError, Phase, SeatRef, TableNo, decide};

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

#[test]
fn update_structure_while_running() {
    let mut h = Harness::standard(9, 1);
    h.register_many(2);
    h.start();
    h.advance(5 * MIN);
    let mut levels = levels();
    // The current level is editable: +10 minutes keeps the 5 elapsed minutes.
    levels[0] = play(25, 50, 30);
    levels.push(play(150, 300, 20));
    h.ok(Command::UpdateStructure {
        levels: levels.clone(),
    });
    assert_eq!(h.view().clock.remaining_ms, 25 * MIN);
    assert_eq!(h.view().clock.duration_ms, 30 * MIN);
    // Shortening below the elapsed time ends the level now.
    levels[0] = play(25, 50, 2);
    h.ok(Command::UpdateStructure {
        levels: levels.clone(),
    });
    assert_eq!(h.view().clock.remaining_ms, 0);
    assert_eq!(
        h.err(Command::UpdateStructure {
            levels: levels.clone()
        }),
        DomainError::NoChange
    );
    // Levels already played are frozen.
    let mut state = h.agg.state().clone();
    state.clock = Clock::Running {
        level: 1,
        ends_at_ms: h.now + 10 * MIN,
    };
    let mut edited = levels.clone();
    edited[0] = play(25, 50, 25);
    let ctx = Ctx::new(h.now, 1);
    assert_eq!(
        decide(&state, &Command::UpdateStructure { levels: edited }, &ctx),
        Err(DomainError::PastLevelModified { index: 0 })
    );
    assert_eq!(
        decide(
            &state,
            &Command::UpdateStructure {
                levels: levels[..1].to_vec()
            },
            &ctx
        ),
        Err(DomainError::CurrentLevelRemoved { index: 1 })
    );
}
