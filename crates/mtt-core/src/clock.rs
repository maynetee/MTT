//! Tournament clock.

use serde::{Deserialize, Serialize};

use crate::error::DomainError;
use crate::event::Event;
use crate::state::{Phase, State};
use crate::structure::{self, Level, MAX_LEVEL_MS};

/// Clock state as stored in events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Clock {
    #[serde(rename = "paused")]
    Paused { level: u16, remaining_ms: i64 },
    #[serde(rename = "running")]
    Running { level: u16, ends_at_ms: i64 },
}

impl Clock {
    /// Paused at the start of the first level.
    pub fn initial(levels: &[Level]) -> Self {
        Clock::Paused {
            level: 0,
            remaining_ms: structure::duration_at(levels, 0),
        }
    }

    /// Stored level index.
    pub fn level(&self) -> u16 {
        match self {
            Clock::Paused { level, .. } | Clock::Running { level, .. } => *level,
        }
    }

    /// True when running.
    pub fn is_running(&self) -> bool {
        matches!(self, Clock::Running { .. })
    }
}

/// Why the clock changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum ClockReason {
    #[serde(rename = "start")]
    Start,
    #[serde(rename = "pause")]
    Pause,
}

/// Current level index and remaining time at `now_ms`.
pub(crate) fn position(clock: &Clock, now_ms: i64) -> (usize, i64) {
    match *clock {
        Clock::Paused {
            level,
            remaining_ms,
        } => (usize::from(level), remaining_ms),
        Clock::Running { level, ends_at_ms } => {
            (usize::from(level), ends_at_ms.saturating_sub(now_ms).max(0))
        }
    }
}

/// Current level index at `now_ms`.
pub(crate) fn current_level(clock: &Clock, _levels: &[Level], now_ms: i64) -> usize {
    position(clock, now_ms).0
}

/// The clock paused at `now_ms`.
pub(crate) fn paused_at(clock: &Clock, now_ms: i64) -> Clock {
    let (level, remaining_ms) = position(clock, now_ms);
    Clock::Paused {
        level: level as u16,
        remaining_ms,
    }
}

/// Clock after replacing the structure: the current level keeps its elapsed time.
pub(crate) fn rebase(clock: &Clock, old: &[Level], new: &[Level], now_ms: i64) -> Clock {
    let (level, _) = position(clock, now_ms);
    if level >= new.len() {
        let last = new.len().saturating_sub(1);
        return Clock::Paused {
            level: last as u16,
            remaining_ms: structure::duration_at(new, last),
        };
    }
    let delta = structure::duration_at(new, level) - structure::duration_at(old, level);
    match *clock {
        Clock::Paused { remaining_ms, .. } => Clock::Paused {
            level: level as u16,
            remaining_ms: (remaining_ms + delta).clamp(0, MAX_LEVEL_MS),
        },
        Clock::Running { ends_at_ms, .. } => Clock::Running {
            level: level as u16,
            ends_at_ms: ends_at_ms.saturating_add(delta).max(now_ms),
        },
    }
}

/// `StartClock`. The first start moves the tournament from setup to running.
pub(crate) fn decide_start(state: &State, now_ms: i64) -> Result<Event, DomainError> {
    let Clock::Paused {
        level,
        remaining_ms,
    } = state.clock
    else {
        return Err(DomainError::ClockAlreadyRunning);
    };
    let starts_tournament = state.phase == Phase::Setup;
    if starts_tournament {
        let have = state.alive_count() as u32;
        if have < 2 {
            return Err(DomainError::NotEnoughPlayers { min: 2, have });
        }
    }
    Ok(Event::ClockChanged {
        reason: ClockReason::Start,
        clock: Clock::Running {
            level,
            ends_at_ms: now_ms.saturating_add(remaining_ms),
        },
        starts_tournament,
    })
}

/// `PauseClock`.
pub(crate) fn decide_pause(state: &State, now_ms: i64) -> Result<Event, DomainError> {
    if !state.clock.is_running() {
        return Err(DomainError::ClockAlreadyPaused);
    }
    Ok(Event::ClockChanged {
        reason: ClockReason::Pause,
        clock: paused_at(&state.clock, now_ms),
        starts_tournament: false,
    })
}
