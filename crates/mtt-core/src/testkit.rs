//! Test helpers for in-crate unit tests.

use crate::command::{BustInput, Command, Ctx, NewTournament};
use crate::config::Config;
use crate::engine::{Aggregate, Outcome};
use crate::error::DomainError;
use crate::ids::{PlayerId, SeatRef, TournamentId};
use crate::rng::mix_seed;
use crate::structure::tests::{pause, play};

pub const T0: i64 = 1_700_000_000_000;

pub struct Kit {
    pub agg: Aggregate,
    pub now: i64,
    seed: u64,
}

impl Kit {
    pub fn new(seats: u8, tables: u16) -> Self {
        let config = Config {
            places_paid: 3,
            ..Config::new("Unit", seats, tables, 10_000)
        };
        Self::with_config(config)
    }

    pub fn with_config(config: Config) -> Self {
        let new = NewTournament {
            id: TournamentId("unit".into()),
            config,
            structure: vec![
                play(25, 50, 20),
                play(50, 100, 20),
                pause(10),
                play(75, 150, 20),
            ],
        };
        let agg = Aggregate::create(new, &Ctx::new(T0, 0)).unwrap();
        Self {
            agg,
            now: T0,
            seed: 9,
        }
    }

    pub fn run(&mut self, cmd: Command) -> Result<Outcome, DomainError> {
        self.seed = mix_seed(self.seed);
        let ctx = Ctx::new(self.now, self.seed);
        self.agg.dispatch(cmd, &ctx)
    }

    #[track_caller]
    pub fn ok(&mut self, cmd: Command) {
        if let Err(e) = self.run(cmd.clone()) {
            panic!("{cmd:?} rejected: {e}");
        }
    }

    #[track_caller]
    pub fn err(&mut self, cmd: Command) -> DomainError {
        let before = self.agg.clone();
        let err = self.run(cmd).expect_err("command should be rejected");
        assert_eq!(self.agg, before);
        err
    }

    pub fn register(&mut self, name: &str) -> PlayerId {
        self.ok(Command::Register {
            name: name.into(),
            seat: None,
        });
        PlayerId(self.agg.state().next_player_id - 1)
    }

    pub fn register_at(&mut self, name: &str, table: u16, seat: u8) -> PlayerId {
        self.ok(Command::Register {
            name: name.into(),
            seat: Some(SeatRef::new(table, seat)),
        });
        PlayerId(self.agg.state().next_player_id - 1)
    }

    pub fn seat_of(&self, player: PlayerId) -> Option<SeatRef> {
        self.agg.state().player(player).and_then(|p| p.seat())
    }

    pub fn table_counts(&self) -> Vec<usize> {
        self.agg.state().open_tables().map(|t| t.count()).collect()
    }
}

pub fn bust(players: &[PlayerId]) -> Command {
    Command::BustPlayers {
        busts: players
            .iter()
            .map(|&player| BustInput {
                player,
                start_stack: None,
            })
            .collect(),
    }
}
