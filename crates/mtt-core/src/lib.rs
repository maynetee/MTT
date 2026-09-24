//! Pure, deterministic domain core of MTT Tournament Director.
//!
//! A host (Tauri shell, WASM build) creates an [`Aggregate`], feeds it [`Command`]s with a
//! [`Ctx`] carrying the wall-clock time and a random seed, persists the resulting
//! [`Envelope`]s and renders [`View`]s. No I/O, no system clock, no OS randomness. Floats
//! only appear inside two pure computations, the payout curve weights and the ICM deal
//! calculator ([`icm()`], [`icm::quote`]), with portable operations so every target gives the
//! same bits; they never reach the state, the events or the view.

#![forbid(unsafe_code)]

pub mod clock;
pub mod command;
pub mod config;
pub mod deal;
pub mod decide;
pub mod engine;
pub mod error;
pub mod event;
pub mod icm;
pub mod ids;
pub mod money;
pub mod name;
pub mod payouts;
pub mod players;
pub mod purchase;
pub mod ranking;
pub mod registration;
pub mod rng;
pub mod seating;
pub mod state;
pub mod structure;
#[cfg(test)]
mod testkit;
pub mod view;
pub mod warning;

pub use clock::{Clock, ClockReason};
pub use command::{BustInput, Command, Ctx, MoveReason, NewTournament};
pub use config::{
    Config, Currency, Deadline, MoneyConfig, PayoutAmounts, PayoutConfig, PlacesPaid, Purchase,
    PurchaseKind, PurchaseWindow,
};
pub use deal::{Deal, DealShare};
pub use decide::{decide, decide_create};
pub use engine::{Aggregate, LogError, Outcome, SavedLog};
pub use error::DomainError;
pub use event::{EVENT_VERSION, Envelope, Event};
pub use icm::{DealQuote, DealRequest, chip_chop, icm};
pub use ids::{BustGroup, PlayerId, SeatNo, SeatRef, Seq, TableNo, TournamentId};
pub use money::{Chips, Money, Price};
pub use state::{Phase, State, apply};
pub use structure::{Ante, Level};
pub use view::{View, view};
pub use warning::Warning;
