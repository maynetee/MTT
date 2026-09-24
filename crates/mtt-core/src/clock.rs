//! Tournament clock, modelled as an end timestamp.
//!
//! A running clock stores the level it was on and when that level ends; levels advance by
//! themselves as time passes, without any event. [`effective`] reads the clock at any
//! instant, so ticks never write to the log and undo is never stuck behind an automatic
//! level change. Commands normalize the clock at `now` first and record absolute results.

use serde::{Deserialize, Serialize};

use crate::command::Command;
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
    /// `level` ends at `ends_at_ms`; later levels follow back to back.
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

    /// Stored level index (see [`effective`] for the level at a given time).
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
    #[serde(rename = "next_level")]
    NextLevel,
    #[serde(rename = "prev_level")]
    PrevLevel,
    #[serde(rename = "jump_to")]
    JumpTo,
    #[serde(rename = "next_break")]
    NextBreak,
    #[serde(rename = "adjust")]
    Adjust,
    #[serde(rename = "set_remaining")]
    SetRemaining,
}

/// The clock read at a given instant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Effective {
    pub level: usize,
    pub remaining_ms: i64,
    /// Wall-clock end of the current level while running.
    pub ends_at_ms: Option<i64>,
    /// Time spent past the end of the last level.
    pub overtime_ms: i64,
    pub running: bool,
}

impl Effective {
    /// True on the last level with no time left.
    pub fn exhausted(&self, levels: &[Level]) -> bool {
        self.level + 1 >= levels.len() && self.remaining_ms == 0
    }
}

/// Reads the clock at `now_ms`. Pure: a running clock walks forward through the levels
/// whose end has passed and stops on the last one, counting overtime.
pub fn effective(clock: &Clock, levels: &[Level], now_ms: i64) -> Effective {
    let last = levels.len().saturating_sub(1);
    match *clock {
        Clock::Paused {
            level,
            remaining_ms,
        } => Effective {
            level: usize::from(level).min(last),
            remaining_ms,
            ends_at_ms: None,
            overtime_ms: 0,
            running: false,
        },
        Clock::Running { level, ends_at_ms } => {
            let mut j = usize::from(level).min(last);
            let mut end = ends_at_ms;
            while now_ms >= end && j < last {
                j += 1;
                end = end.saturating_add(structure::duration_at(levels, j));
            }
            Effective {
                level: j,
                remaining_ms: end.saturating_sub(now_ms).max(0),
                ends_at_ms: Some(end),
                overtime_ms: now_ms.saturating_sub(end).max(0),
                running: true,
            }
        }
    }
}

/// The same clock re-expressed from its effective level at `now_ms`.
pub fn normalize(clock: &Clock, levels: &[Level], now_ms: i64) -> Clock {
    let eff = effective(clock, levels, now_ms);
    match eff.ends_at_ms {
        Some(ends_at_ms) => Clock::Running {
            level: eff.level as u16,
            ends_at_ms,
        },
        None => Clock::Paused {
            level: eff.level as u16,
            remaining_ms: eff.remaining_ms,
        },
    }
}

/// Start of an upcoming level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Boundary {
    pub level_index: u16,
    /// Clock time until this level starts.
    pub starts_in_ms: i64,
    /// Wall-clock start while running.
    pub starts_at_ms: Option<i64>,
}

/// Upcoming level starts, and when the structure runs out (in clock time).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    pub boundaries: Vec<Boundary>,
    pub ends_in_ms: i64,
}

/// Every upcoming level start after the effective level at `now_ms`.
pub fn schedule(clock: &Clock, levels: &[Level], now_ms: i64) -> Schedule {
    let eff = effective(clock, levels, now_ms);
    let mut offset = eff.remaining_ms;
    let mut boundaries = Vec::new();
    for (i, level) in levels.iter().enumerate().skip(eff.level + 1) {
        boundaries.push(Boundary {
            level_index: i as u16,
            starts_in_ms: offset,
            starts_at_ms: eff.running.then(|| now_ms.saturating_add(offset)),
        });
        offset = offset.saturating_add(level.duration_ms());
    }
    Schedule {
        boundaries,
        ends_in_ms: offset,
    }
}

/// Structure time elapsed: finished levels plus the elapsed part of the current one plus
/// overtime. Pauses do not count; time adjustments do.
pub fn elapsed_ms(clock: &Clock, levels: &[Level], now_ms: i64) -> i64 {
    let eff = effective(clock, levels, now_ms);
    structure::total_ms(&levels[..eff.level])
        .saturating_add(structure::duration_at(levels, eff.level))
        .saturating_sub(eff.remaining_ms)
        .saturating_add(eff.overtime_ms)
}

/// Current level index at `now_ms`.
pub(crate) fn current_level(clock: &Clock, levels: &[Level], now_ms: i64) -> usize {
    effective(clock, levels, now_ms).level
}

/// The clock paused at `now_ms`.
pub(crate) fn paused_at(clock: &Clock, levels: &[Level], now_ms: i64) -> Clock {
    let eff = effective(clock, levels, now_ms);
    Clock::Paused {
        level: eff.level as u16,
        remaining_ms: eff.remaining_ms.min(MAX_LEVEL_MS),
    }
}

/// Clock after replacing the structure: the current level keeps its elapsed time; in
/// overtime, newly appended levels start now.
pub(crate) fn rebase(clock: &Clock, old: &[Level], new: &[Level], now_ms: i64) -> Clock {
    let eff = effective(clock, old, now_ms);
    let level = eff.level;
    if level >= new.len() {
        let last = new.len().saturating_sub(1);
        return Clock::Paused {
            level: last as u16,
            remaining_ms: structure::duration_at(new, last),
        };
    }
    let delta =
        structure::duration_at(new, level).saturating_sub(structure::duration_at(old, level));
    match eff.ends_at_ms {
        Some(_) if eff.overtime_ms > 0 && new.len() > old.len() => Clock::Running {
            level: level as u16,
            ends_at_ms: now_ms,
        },
        Some(ends_at_ms) => Clock::Running {
            level: level as u16,
            ends_at_ms: ends_at_ms.saturating_add(delta).max(now_ms),
        },
        None => Clock::Paused {
            level: level as u16,
            remaining_ms: eff
                .remaining_ms
                .saturating_add(delta)
                .clamp(0, MAX_LEVEL_MS),
        },
    }
}

fn changed(reason: ClockReason, clock: Clock) -> Event {
    Event::ClockChanged {
        reason,
        clock,
        starts_tournament: false,
    }
}

/// Target level with its full duration, keeping the running/paused mode.
fn go_to(eff: &Effective, levels: &[Level], target: usize, now_ms: i64) -> Clock {
    let duration = structure::duration_at(levels, target);
    if eff.running {
        Clock::Running {
            level: target as u16,
            ends_at_ms: now_ms.saturating_add(duration),
        }
    } else {
        Clock::Paused {
            level: target as u16,
            remaining_ms: duration,
        }
    }
}

/// Clock commands. The first `StartClock` moves the tournament from setup to running.
pub(crate) fn decide(state: &State, cmd: &Command, now_ms: i64) -> Result<Event, DomainError> {
    let levels = &state.structure;
    let eff = effective(&state.clock, levels, now_ms);
    let last = levels.len().saturating_sub(1);
    match cmd {
        Command::StartClock {} => {
            if eff.running {
                return Err(DomainError::ClockAlreadyRunning);
            }
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
                    level: eff.level as u16,
                    ends_at_ms: now_ms.saturating_add(eff.remaining_ms),
                },
                starts_tournament,
            })
        }
        Command::PauseClock {} => {
            if !eff.running {
                return Err(DomainError::ClockAlreadyPaused);
            }
            Ok(changed(
                ClockReason::Pause,
                paused_at(&state.clock, levels, now_ms),
            ))
        }
        Command::NextLevel {} => {
            if eff.level >= last {
                return Err(DomainError::NoNextLevel);
            }
            Ok(changed(
                ClockReason::NextLevel,
                go_to(&eff, levels, eff.level + 1, now_ms),
            ))
        }
        Command::PrevLevel {} => {
            if eff.level == 0 {
                return Err(DomainError::NoPrevLevel);
            }
            Ok(changed(
                ClockReason::PrevLevel,
                go_to(&eff, levels, eff.level - 1, now_ms),
            ))
        }
        Command::JumpTo { level } => {
            let target = usize::from(*level);
            if target > last {
                return Err(DomainError::LevelOutOfRange {
                    level: *level,
                    max: last as u16,
                });
            }
            Ok(changed(
                ClockReason::JumpTo,
                go_to(&eff, levels, target, now_ms),
            ))
        }
        Command::JumpToNextBreak {} => {
            let target = (eff.level + 1..levels.len())
                .find(|&i| levels[i].is_break())
                .ok_or(DomainError::NoNextBreak)?;
            Ok(changed(
                ClockReason::NextBreak,
                go_to(&eff, levels, target, now_ms),
            ))
        }
        Command::AdjustTime { delta_ms } => {
            let delta = *delta_ms;
            if delta == 0 || !(-MAX_LEVEL_MS..=MAX_LEVEL_MS).contains(&delta) {
                return Err(DomainError::InvalidTimeAdjustment {
                    max_ms: MAX_LEVEL_MS,
                });
            }
            let level = eff.level as u16;
            let clock = match eff.ends_at_ms {
                Some(end) => Clock::Running {
                    level,
                    ends_at_ms: end
                        .saturating_add(delta)
                        .clamp(now_ms, now_ms.saturating_add(MAX_LEVEL_MS)),
                },
                None => Clock::Paused {
                    level,
                    remaining_ms: eff
                        .remaining_ms
                        .saturating_add(delta)
                        .clamp(0, MAX_LEVEL_MS),
                },
            };
            if clock == normalize(&state.clock, levels, now_ms) {
                return Err(DomainError::NoChange);
            }
            Ok(changed(ClockReason::Adjust, clock))
        }
        Command::SetRemaining { ms } => {
            if !(0..=MAX_LEVEL_MS).contains(ms) {
                return Err(DomainError::InvalidRemaining {
                    max_ms: MAX_LEVEL_MS,
                });
            }
            let level = eff.level as u16;
            let clock = if eff.running {
                Clock::Running {
                    level,
                    ends_at_ms: now_ms.saturating_add(*ms),
                }
            } else {
                Clock::Paused {
                    level,
                    remaining_ms: *ms,
                }
            };
            Ok(changed(ClockReason::SetRemaining, clock))
        }
        _ => Err(DomainError::Internal {
            reason: "not a clock command".to_owned(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structure::tests::{pause, play};

    const MIN: i64 = 60_000;

    fn levels() -> Vec<Level> {
        vec![
            play(25, 50, 20),
            play(50, 100, 20),
            pause(10),
            play(75, 150, 20),
        ]
    }

    #[test]
    fn running_clock_walks_through_levels() {
        let levels = levels();
        let clock = Clock::Running {
            level: 0,
            ends_at_ms: 20 * MIN,
        };
        let at = |t| effective(&clock, &levels, t);
        assert_eq!((at(0).level, at(0).remaining_ms), (0, 20 * MIN));
        assert_eq!(
            (at(20 * MIN).level, at(20 * MIN).remaining_ms),
            (1, 20 * MIN)
        );
        assert_eq!(
            (at(45 * MIN).level, at(45 * MIN).remaining_ms),
            (2, 5 * MIN)
        );
        assert_eq!(at(45 * MIN).ends_at_ms, Some(50 * MIN));
        let over = at(75 * MIN);
        assert_eq!(
            (over.level, over.remaining_ms, over.overtime_ms),
            (3, 0, 5 * MIN)
        );
        assert!(over.exhausted(&levels));
        assert_eq!(
            normalize(&clock, &levels, 45 * MIN),
            Clock::Running {
                level: 2,
                ends_at_ms: 50 * MIN
            }
        );
        assert_eq!(elapsed_ms(&clock, &levels, 45 * MIN), 45 * MIN);
        assert_eq!(elapsed_ms(&clock, &levels, 75 * MIN), 75 * MIN);
    }

    #[test]
    fn paused_clock_does_not_move() {
        let levels = levels();
        let clock = Clock::Paused {
            level: 1,
            remaining_ms: 7 * MIN,
        };
        for t in [0, 10 * MIN, 1_000 * MIN] {
            let eff = effective(&clock, &levels, t);
            assert_eq!(
                (eff.level, eff.remaining_ms, eff.running),
                (1, 7 * MIN, false)
            );
        }
        assert_eq!(elapsed_ms(&clock, &levels, 0), 33 * MIN);
    }

    #[test]
    fn schedule_lists_upcoming_levels() {
        let levels = levels();
        let running = Clock::Running {
            level: 0,
            ends_at_ms: 20 * MIN,
        };
        let s = schedule(&running, &levels, 5 * MIN);
        let starts: Vec<_> = s
            .boundaries
            .iter()
            .map(|b| (b.level_index, b.starts_in_ms))
            .collect();
        assert_eq!(starts, vec![(1, 15 * MIN), (2, 35 * MIN), (3, 45 * MIN)]);
        assert_eq!(s.boundaries[0].starts_at_ms, Some(20 * MIN));
        assert_eq!(s.ends_in_ms, 65 * MIN);
        let paused = Clock::Paused {
            level: 2,
            remaining_ms: MIN,
        };
        let s = schedule(&paused, &levels, 0);
        assert_eq!(s.boundaries.len(), 1);
        assert_eq!(s.boundaries[0].starts_at_ms, None);
    }

    #[test]
    fn rebase_keeps_elapsed_time_and_restarts_overtime() {
        let old = levels();
        let mut new = old.clone();
        new[1] = play(50, 100, 30);
        let running = Clock::Running {
            level: 1,
            ends_at_ms: 40 * MIN,
        };
        assert_eq!(
            rebase(&running, &old, &new, 30 * MIN),
            Clock::Running {
                level: 1,
                ends_at_ms: 50 * MIN
            }
        );
        new.push(play(100, 200, 20));
        let rebased = rebase(&running, &old, &new, 80 * MIN);
        assert_eq!(
            rebased,
            Clock::Running {
                level: 3,
                ends_at_ms: 80 * MIN
            }
        );
        assert_eq!(effective(&rebased, &new, 80 * MIN).level, 4);
    }

    mod commands {
        use super::MIN;
        use crate::clock::{Clock, effective};
        use crate::command::Command;
        use crate::error::DomainError;
        use crate::state::Phase;
        use crate::structure::MAX_LEVEL_MS;
        use crate::testkit::{Kit, T0};
        use crate::warning::Warning;

        fn started() -> Kit {
            let mut kit = Kit::new(9, 1);
            kit.register("A");
            kit.register("B");
            kit.ok(Command::StartClock {});
            kit
        }

        fn at(kit: &Kit) -> (usize, i64, bool) {
            let state = kit.agg.state();
            let eff = effective(&state.clock, &state.structure, kit.now);
            (eff.level, eff.remaining_ms, eff.running)
        }

        #[test]
        fn start_needs_two_players_and_starts_the_tournament() {
            let mut kit = Kit::new(9, 1);
            kit.register("A");
            assert_eq!(
                kit.err(Command::StartClock {}),
                DomainError::NotEnoughPlayers { min: 2, have: 1 }
            );
            assert_eq!(
                kit.err(Command::PauseClock {}),
                DomainError::ClockAlreadyPaused
            );
            kit.register("B");
            kit.ok(Command::StartClock {});
            assert_eq!(kit.agg.state().phase, Phase::Running);
            assert_eq!(
                kit.agg.state().clock,
                Clock::Running {
                    level: 0,
                    ends_at_ms: T0 + 20 * MIN
                }
            );
            assert_eq!(
                kit.err(Command::StartClock {}),
                DomainError::ClockAlreadyRunning
            );
        }

        #[test]
        fn navigation_gives_full_levels_and_keeps_the_mode() {
            let mut kit = started();
            kit.now += 5 * MIN;
            kit.ok(Command::NextLevel {});
            assert_eq!(at(&kit), (1, 20 * MIN, true));
            kit.ok(Command::PrevLevel {});
            assert_eq!(at(&kit), (0, 20 * MIN, true));
            assert_eq!(kit.err(Command::PrevLevel {}), DomainError::NoPrevLevel);
            kit.ok(Command::JumpToNextBreak {});
            assert_eq!(at(&kit), (2, 10 * MIN, true));
            assert_eq!(
                kit.err(Command::JumpToNextBreak {}),
                DomainError::NoNextBreak
            );
            assert_eq!(
                kit.err(Command::JumpTo { level: 9 }),
                DomainError::LevelOutOfRange { level: 9, max: 3 }
            );
            kit.ok(Command::PauseClock {});
            kit.ok(Command::JumpTo { level: 3 });
            assert_eq!(at(&kit), (3, 20 * MIN, false));
            assert_eq!(kit.err(Command::NextLevel {}), DomainError::NoNextLevel);
        }

        #[test]
        fn adjust_and_set_remaining() {
            let mut kit = started();
            kit.now += 5 * MIN;
            kit.ok(Command::AdjustTime { delta_ms: 2 * MIN });
            assert_eq!(at(&kit), (0, 17 * MIN, true));
            for delta_ms in [0, MAX_LEVEL_MS + 1] {
                assert_eq!(
                    kit.err(Command::AdjustTime { delta_ms }),
                    DomainError::InvalidTimeAdjustment {
                        max_ms: MAX_LEVEL_MS
                    }
                );
            }
            kit.ok(Command::SetRemaining { ms: 3 * MIN });
            assert_eq!(at(&kit), (0, 3 * MIN, true));
            assert_eq!(
                kit.err(Command::SetRemaining { ms: -1 }),
                DomainError::InvalidRemaining {
                    max_ms: MAX_LEVEL_MS
                }
            );
            kit.ok(Command::PauseClock {});
            kit.ok(Command::AdjustTime {
                delta_ms: -60 * MIN,
            });
            assert_eq!(at(&kit), (0, 0, false));
            assert_eq!(
                kit.err(Command::AdjustTime { delta_ms: -MIN }),
                DomainError::NoChange
            );
        }

        #[test]
        fn overtime_stays_on_the_last_level() {
            let mut kit = started();
            kit.now += 50 * MIN;
            let view = kit.agg.view(kit.now);
            assert_eq!(view.clock.level_index, 3);
            assert!(
                view.warnings
                    .contains(&Warning::StructureEnding { levels_left: 0 })
            );
            kit.now += 30 * MIN;
            let view = kit.agg.view(kit.now);
            assert_eq!(
                (
                    view.clock.level_index,
                    view.clock.remaining_ms,
                    view.clock.overtime_ms
                ),
                (3, 0, 10 * MIN)
            );
            assert!(view.warnings.contains(&Warning::StructureExhausted));
            assert_eq!(view.clock.recompute_at_ms, None);
            assert_eq!(kit.err(Command::NextLevel {}), DomainError::NoNextLevel);
            kit.ok(Command::PauseClock {});
            assert_eq!(at(&kit), (3, 0, false));
        }
    }
}
