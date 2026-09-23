//! Property tests: random command sequences, valid or not, never break the model.

mod common;

use common::*;
use mtt_core::{Aggregate, BustInput, Chips, Command, Config, Deadline, Level, PlayerId, SeatRef};
use proptest::prelude::*;

const SEATS: u8 = 4;
const TABLES: u16 = 3;

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
        2 => (player(), seat()).prop_map(|(player, to)| Command::MovePlayer { player, to, reason: None }),
        1 => Just(Command::CloseRegistration {}),
        1 => Just(Command::ReopenRegistration {}),
        1 => Just(Command::FinishTournament {}),
        2 => Just(Command::StartClock {}),
        1 => Just(Command::PauseClock {}),
        3 => Just(Command::Undo {}),
        1 => Just(Command::Redo {}),
        1 => (1u16..=5, 2u16..=TABLES + 1, 3u8..=SEATS + 1).prop_map(|(paid, tables, seats)| {
            Command::UpdateConfig {
                config: Config { places_paid: paid, ..Config::new("Prop", seats, tables, 10_000) },
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

fn harness() -> Harness {
    let config = Config {
        places_paid: 2,
        late_reg: Deadline::Manual,
        ..Config::new("Prop", SEATS, TABLES, 10_000)
    };
    Harness::new(config, levels())
}

fn run_ops(players: u32, start: bool, ops: Vec<Op>) {
    let mut h = harness();
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
    }
    let json = h.agg.to_json().expect("serializable log");
    let reloaded = Aggregate::from_json(&json).expect("replayable log");
    assert_eq!(reloaded, h.agg, "replay after a JSON round trip differs");
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]

    #[test]
    fn random_sequences_keep_invariants(
        players in 2u32..=12,
        start in any::<bool>(),
        ops in prop::collection::vec(op(), 1..80),
    ) {
        run_ops(players, start, ops);
    }
}
