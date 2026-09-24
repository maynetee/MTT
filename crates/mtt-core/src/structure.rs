//! Blind structure: levels, antes, validation and play-level numbering.

use serde::{Deserialize, Serialize};

use crate::clock;
use crate::config;
use crate::error::DomainError;
use crate::event::Event;
use crate::money::Chips;
use crate::state::{Phase, State};
use crate::warning::Warning;

/// Maximum number of levels in a structure.
pub const MAX_LEVELS: usize = 200;
/// Maximum duration of a single level (24 h).
pub const MAX_LEVEL_MS: i64 = 24 * 60 * 60 * 1000;

/// Ante format of a play level.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Ante {
    #[default]
    #[serde(rename = "none")]
    None,
    /// Every player posts `amount`.
    #[serde(rename = "classic")]
    Classic { amount: Chips },
    /// The big blind posts `amount` for the table.
    #[serde(rename = "big_blind")]
    BigBlind { amount: Chips },
}

impl Ante {
    /// Ante amount, zero when there is none.
    pub fn amount(self) -> Chips {
        match self {
            Ante::None => Chips::ZERO,
            Ante::Classic { amount } | Ante::BigBlind { amount } => amount,
        }
    }
}

/// One level of the structure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Level {
    #[serde(rename = "play")]
    Play {
        sb: Chips,
        bb: Chips,
        #[serde(default)]
        ante: Ante,
        duration_ms: i64,
    },
    #[serde(rename = "break")]
    Break {
        duration_ms: i64,
        /// Smallest chip kept after a color-up during this break, if any.
        #[serde(default)]
        color_up: Option<Chips>,
    },
}

impl Level {
    /// Level length in milliseconds.
    pub fn duration_ms(&self) -> i64 {
        match self {
            Level::Play { duration_ms, .. } | Level::Break { duration_ms, .. } => *duration_ms,
        }
    }

    /// True for breaks.
    pub fn is_break(&self) -> bool {
        matches!(self, Level::Break { .. })
    }

    /// Big blind of a play level.
    pub fn big_blind(&self) -> Option<Chips> {
        match self {
            Level::Play { bb, .. } => Some(*bb),
            Level::Break { .. } => None,
        }
    }
}

/// Validates a structure. Returns the non-blocking warnings on success.
pub fn validate(levels: &[Level]) -> Result<Vec<Warning>, DomainError> {
    if levels.is_empty() {
        return Err(DomainError::StructureEmpty);
    }
    if levels.len() > MAX_LEVELS {
        return Err(DomainError::StructureTooLong {
            max: MAX_LEVELS as u16,
        });
    }
    if !levels.iter().any(|l| !l.is_break()) {
        return Err(DomainError::StructureNoPlayLevel);
    }
    let mut warnings = Vec::new();
    let mut previous_bb: Option<Chips> = None;
    for (i, level) in levels.iter().enumerate() {
        let index = i as u16;
        let duration = level.duration_ms();
        if duration <= 0 || duration > MAX_LEVEL_MS {
            return Err(DomainError::InvalidDuration { index });
        }
        match level {
            Level::Play { sb, bb, ante, .. } => {
                if !sb.is_positive() || !bb.is_positive() || bb < sb {
                    return Err(DomainError::InvalidBlinds { index });
                }
                if !ante.amount().is_valid() {
                    return Err(DomainError::InvalidAnte { index });
                }
                if ante.amount() > *bb {
                    warnings.push(Warning::AnteAboveBigBlind { index });
                }
                if previous_bb.is_some_and(|prev| *bb < prev) {
                    warnings.push(Warning::BlindsDecrease { index });
                }
                previous_bb = Some(*bb);
            }
            Level::Break { color_up, .. } => {
                if color_up.is_some_and(|c| !c.is_positive()) {
                    return Err(DomainError::InvalidColorUp { index });
                }
            }
        }
    }
    Ok(warnings)
}

/// 1-based play-level number of `index`, skipping breaks; `None` for a break.
pub fn play_number(levels: &[Level], index: usize) -> Option<u16> {
    let level = levels.get(index)?;
    if level.is_break() {
        return None;
    }
    let n = levels[..=index].iter().filter(|l| !l.is_break()).count();
    Some(n as u16)
}

/// Index of the `n`-th (1-based) play level.
pub fn play_level_index(levels: &[Level], n: u16) -> Option<usize> {
    if n == 0 {
        return None;
    }
    levels
        .iter()
        .enumerate()
        .filter(|(_, l)| !l.is_break())
        .nth(usize::from(n) - 1)
        .map(|(i, _)| i)
}

/// Number of play levels.
pub fn play_level_count(levels: &[Level]) -> u16 {
    levels.iter().filter(|l| !l.is_break()).count() as u16
}

/// Duration of level `index`, 0 when out of range.
pub fn duration_at(levels: &[Level], index: usize) -> i64 {
    levels.get(index).map_or(0, Level::duration_ms)
}

/// Total duration of `levels`.
pub fn total_ms(levels: &[Level]) -> i64 {
    levels
        .iter()
        .fold(0i64, |sum, l| sum.saturating_add(l.duration_ms()))
}

/// Big blind in force at `index`: the level itself, or the next play level during a break.
pub fn reference_big_blind(levels: &[Level], index: usize) -> Option<Chips> {
    levels.iter().skip(index).find_map(Level::big_blind)
}

/// `UpdateStructure`: once started, levels before the current one are frozen and the
/// current level keeps its elapsed time.
pub(crate) fn decide_update(
    state: &State,
    levels: &[Level],
    now_ms: i64,
) -> Result<Event, DomainError> {
    validate(levels)?;
    config::validate_late_reg(&state.config, levels)?;
    if levels == state.structure.as_slice() {
        return Err(DomainError::NoChange);
    }
    let current = clock::current_level(&state.clock, &state.structure, now_ms);
    if state.phase != Phase::Setup {
        if let Some(i) = (0..current).find(|&i| levels.get(i) != state.structure.get(i)) {
            return Err(DomainError::PastLevelModified { index: i as u16 });
        }
        if levels.len() <= current {
            return Err(DomainError::CurrentLevelRemoved {
                index: current as u16,
            });
        }
    }
    let clock = clock::rebase(&state.clock, &state.structure, levels, now_ms);
    Ok(Event::StructureUpdated {
        levels: levels.to_vec(),
        clock,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn play(sb: i64, bb: i64, minutes: i64) -> Level {
        Level::Play {
            sb: Chips(sb),
            bb: Chips(bb),
            ante: Ante::None,
            duration_ms: minutes * 60_000,
        }
    }

    pub fn pause(minutes: i64) -> Level {
        Level::Break {
            duration_ms: minutes * 60_000,
            color_up: None,
        }
    }

    #[test]
    fn rejects_invalid_levels() {
        assert_eq!(validate(&[]), Err(DomainError::StructureEmpty));
        assert_eq!(
            validate(&[pause(10)]),
            Err(DomainError::StructureNoPlayLevel)
        );
        assert_eq!(
            validate(&[play(0, 100, 20)]),
            Err(DomainError::InvalidBlinds { index: 0 })
        );
        assert_eq!(
            validate(&[play(100, 50, 20)]),
            Err(DomainError::InvalidBlinds { index: 0 })
        );
        assert_eq!(
            validate(&[play(50, 100, 20), play(100, 200, 0)]),
            Err(DomainError::InvalidDuration { index: 1 })
        );
        let negative_ante = Level::Play {
            sb: Chips(50),
            bb: Chips(100),
            ante: Ante::Classic { amount: Chips(-1) },
            duration_ms: 60_000,
        };
        assert_eq!(
            validate(&[negative_ante]),
            Err(DomainError::InvalidAnte { index: 0 })
        );
        let too_long = vec![play(50, 100, 20); MAX_LEVELS + 1];
        assert!(matches!(
            validate(&too_long),
            Err(DomainError::StructureTooLong { .. })
        ));
    }

    #[test]
    fn warns_about_suspicious_levels() {
        let bba = Level::Play {
            sb: Chips(100),
            bb: Chips(200),
            ante: Ante::BigBlind { amount: Chips(400) },
            duration_ms: 60_000,
        };
        let warnings = validate(&[play(100, 200, 20), bba, play(50, 100, 20)]).unwrap();
        assert_eq!(
            warnings,
            vec![
                Warning::AnteAboveBigBlind { index: 1 },
                Warning::BlindsDecrease { index: 2 }
            ]
        );
    }

    #[test]
    fn play_level_numbers_skip_breaks() {
        let levels = [
            play(25, 50, 20),
            play(50, 100, 20),
            pause(10),
            play(75, 150, 20),
        ];
        assert_eq!(play_number(&levels, 0), Some(1));
        assert_eq!(play_number(&levels, 1), Some(2));
        assert_eq!(play_number(&levels, 2), None);
        assert_eq!(play_number(&levels, 3), Some(3));
        assert_eq!(play_number(&levels, 4), None);
        assert_eq!(play_level_index(&levels, 3), Some(3));
        assert_eq!(play_level_index(&levels, 0), None);
        assert_eq!(play_level_index(&levels, 4), None);
        assert_eq!(play_level_count(&levels), 3);
        assert_eq!(reference_big_blind(&levels, 2), Some(Chips(150)));
    }

    #[test]
    fn level_json_shape() {
        let json = serde_json::to_value(play(25, 50, 1)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"type": "play", "sb": 25, "bb": 50, "ante": {"type": "none"}, "duration_ms": 60000})
        );
    }
}
