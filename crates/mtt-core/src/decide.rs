//! Command validation: `decide(&State, &Command, &Ctx) -> Event`.

use crate::command::{Command, Ctx, NewTournament};
use crate::error::DomainError;
use crate::event::Event;
use crate::rng::Rng;
use crate::state::{Phase, State};
use crate::{clock, config, players, registration, seating, structure};

/// Longest accepted tournament id.
pub const MAX_TOURNAMENT_ID: usize = 64;

/// Validates a new tournament.
pub fn decide_create(new: &NewTournament) -> Result<Event, DomainError> {
    let id_len = new.id.0.len();
    if id_len == 0 || id_len > MAX_TOURNAMENT_ID || new.id.0.trim() != new.id.0 {
        return Err(DomainError::InvalidTournamentId {
            max: MAX_TOURNAMENT_ID as u16,
        });
    }
    structure::validate(&new.structure)?;
    config::validate(&new.config, &new.structure)?;
    Ok(Event::TournamentCreated {
        id: new.id.clone(),
        config: new.config.clone(),
        structure: new.structure.clone(),
    })
}

/// Turns a command into the event to record, or rejects it. Pure: time and randomness
/// come from `ctx`. `Undo`/`Redo` are handled by the engine, not here.
pub fn decide(state: &State, cmd: &Command, ctx: &Ctx) -> Result<Event, DomainError> {
    if matches!(state.phase, Phase::Finished { .. }) {
        return Err(DomainError::TournamentFinished);
    }
    let now = ctx.now_ms;
    let mut rng = Rng::from_seed(ctx.seed);
    match cmd {
        Command::UpdateConfig { config } => config::decide_update(state, config),
        Command::UpdateStructure { levels } => structure::decide_update(state, levels, now),
        Command::Register { name, seat } => {
            registration::decide_register(state, name, *seat, now, &mut rng)
        }
        Command::Unregister { player } => registration::decide_unregister(state, *player),
        Command::BustPlayers { busts } => players::decide_bust(state, busts, now),
        Command::RevivePlayer { player, seat } => players::decide_revive(state, *player, *seat),
        Command::MovePlayer { player, to, reason } => {
            seating::decide_move(state, *player, *to, reason.unwrap_or_default())
        }
        Command::CloseRegistration {} => registration::decide_close(state, now),
        Command::ReopenRegistration {} => registration::decide_reopen(state),
        Command::FinishTournament {} => players::decide_finish(state, now),
        Command::StartClock {}
        | Command::PauseClock {}
        | Command::NextLevel {}
        | Command::PrevLevel {}
        | Command::JumpTo { .. }
        | Command::JumpToNextBreak {}
        | Command::AdjustTime { .. }
        | Command::SetRemaining { .. } => clock::decide(state, cmd, now),
        Command::Undo {} | Command::Redo {} => Err(DomainError::Internal {
            reason: "undo and redo are handled by the engine".to_owned(),
        }),
    }
}
