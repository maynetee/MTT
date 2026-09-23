//! Tournament configuration and its validation.

use serde::{Deserialize, Serialize};

use crate::error::DomainError;
use crate::event::Event;
use crate::ids::TableNo;
use crate::money::Chips;
use crate::state::{Phase, State, TableStatus};
use crate::structure::{self, Level};

/// Seats per table accepted by the configuration.
pub const SEATS_RANGE: (u8, u8) = (2, 12);
/// Number of tables accepted by the configuration.
pub const TABLES_RANGE: (u16, u16) = (1, 1000);
/// Longest tournament name, in characters.
pub const MAX_TOURNAMENT_NAME: usize = 100;
/// Longest time-based late registration (7 days).
pub const MAX_LATE_REG_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// When late registration closes (registration is always open during setup).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum Deadline {
    /// Open until the end of the `n`-th play level (1-based, breaks not counted),
    /// or until the end of the break that follows it when `through_break` is set.
    #[serde(rename = "end_of_play_level")]
    EndOfPlayLevel {
        n: u16,
        #[serde(default)]
        through_break: bool,
    },
    /// Open while less than `ms` of structure time has elapsed (pauses excluded).
    #[serde(rename = "elapsed")]
    Elapsed { ms: i64 },
    /// Open until the director closes it.
    #[default]
    #[serde(rename = "manual")]
    Manual,
}

/// Payout settings. Reserved: places paid is a fixed number for now.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct PayoutConfig {}

/// Tournament settings editable by the director.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Config {
    pub name: String,
    pub seats_per_table: u8,
    pub max_tables: u16,
    /// Players at the final table; defaults to `seats_per_table`.
    #[serde(default)]
    pub final_table_size: Option<u8>,
    /// Rebalance when the largest and smallest tables differ by at least this much.
    #[serde(default = "default_balance_trigger")]
    pub balance_trigger: u8,
    /// Tables to break first, in order; other tables follow from the highest number down.
    #[serde(default)]
    pub break_order: Vec<TableNo>,
    pub starting_stack: Chips,
    pub places_paid: u16,
    #[serde(default)]
    pub late_reg: Deadline,
    #[serde(default)]
    pub payout: PayoutConfig,
}

fn default_balance_trigger() -> u8 {
    2
}

impl Config {
    /// A configuration with defaults for everything but the essentials.
    pub fn new(name: &str, seats_per_table: u8, max_tables: u16, starting_stack: i64) -> Self {
        Self {
            name: name.to_owned(),
            seats_per_table,
            max_tables,
            final_table_size: None,
            balance_trigger: default_balance_trigger(),
            break_order: Vec::new(),
            starting_stack: Chips(starting_stack),
            places_paid: 1,
            late_reg: Deadline::Manual,
            payout: PayoutConfig::default(),
        }
    }

    /// Effective final table size.
    pub fn final_table_size(&self) -> u8 {
        self.final_table_size.unwrap_or(self.seats_per_table)
    }
}

/// Validates a configuration against the structure it will run with.
pub fn validate(config: &Config, levels: &[Level]) -> Result<(), DomainError> {
    let name_len = config.name.trim().chars().count();
    if name_len == 0 || name_len > MAX_TOURNAMENT_NAME {
        return Err(DomainError::InvalidTournamentName {
            max: MAX_TOURNAMENT_NAME as u16,
        });
    }
    let (min_seats, max_seats) = SEATS_RANGE;
    let seats = config.seats_per_table;
    if !(min_seats..=max_seats).contains(&seats) {
        return Err(DomainError::InvalidSeatsPerTable {
            min: min_seats,
            max: max_seats,
        });
    }
    let (min_tables, max_tables) = TABLES_RANGE;
    if !(min_tables..=max_tables).contains(&config.max_tables) {
        return Err(DomainError::InvalidMaxTables {
            min: min_tables,
            max: max_tables,
        });
    }
    if !(2..=seats).contains(&config.final_table_size()) {
        return Err(DomainError::InvalidFinalTableSize { min: 2, max: seats });
    }
    if !(2..=seats).contains(&config.balance_trigger) {
        return Err(DomainError::InvalidBalanceTrigger { min: 2, max: seats });
    }
    for (i, table) in config.break_order.iter().enumerate() {
        let out_of_range = table.0 == 0 || table.0 > config.max_tables;
        if out_of_range || config.break_order[..i].contains(table) {
            return Err(DomainError::InvalidBreakOrder { table: *table });
        }
    }
    if !config.starting_stack.is_positive() {
        return Err(DomainError::InvalidStartingStack);
    }
    if config.places_paid == 0 {
        return Err(DomainError::InvalidPlacesPaid { min: 1 });
    }
    validate_late_reg(config, levels)
}

/// Checks the late registration deadline against a structure.
pub fn validate_late_reg(config: &Config, levels: &[Level]) -> Result<(), DomainError> {
    match config.late_reg {
        Deadline::EndOfPlayLevel { n, .. } => {
            let max = structure::play_level_count(levels);
            if n == 0 || n > max {
                return Err(DomainError::InvalidLateRegLevel { n, max });
            }
        }
        Deadline::Elapsed { ms } => {
            if ms <= 0 || ms > MAX_LATE_REG_MS {
                return Err(DomainError::InvalidLateRegElapsed {
                    max_ms: MAX_LATE_REG_MS,
                });
            }
        }
        Deadline::Manual => {}
    }
    Ok(())
}

/// `UpdateConfig`: seats and starting stack are frozen once started; tables in use
/// cannot be removed.
pub(crate) fn decide_update(state: &State, config: &Config) -> Result<Event, DomainError> {
    validate(config, &state.structure)?;
    if *config == state.config {
        return Err(DomainError::NoChange);
    }
    if state.phase != Phase::Setup {
        let locked = if config.seats_per_table != state.config.seats_per_table {
            Some("seats_per_table")
        } else if config.starting_stack != state.config.starting_stack {
            Some("starting_stack")
        } else {
            None
        };
        if let Some(field) = locked {
            return Err(DomainError::ConfigLocked {
                field: field.to_owned(),
            });
        }
    }
    for table in state.tables.values() {
        if table.no.0 > config.max_tables && table.status != TableStatus::Idle {
            return Err(DomainError::TableInUse { table: table.no });
        }
        if let Some(&seat) = table.occupants.keys().next_back() {
            if seat.0 > config.seats_per_table {
                return Err(DomainError::SeatInUse {
                    table: table.no,
                    seat,
                });
            }
        }
    }
    Ok(Event::ConfigUpdated {
        config: config.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structure::tests::{pause, play};

    fn levels() -> Vec<Level> {
        vec![
            play(25, 50, 20),
            play(50, 100, 20),
            pause(10),
            play(75, 150, 20),
        ]
    }

    #[test]
    fn accepts_a_sane_config() {
        assert_eq!(
            validate(&Config::new("Sunday", 9, 10, 20_000), &levels()),
            Ok(())
        );
    }

    #[test]
    fn rejects_out_of_range_values() {
        let base = Config::new("Sunday", 9, 10, 20_000);
        let cases: Vec<(Config, DomainError)> = vec![
            (
                Config {
                    name: "  ".into(),
                    ..base.clone()
                },
                DomainError::InvalidTournamentName { max: 100 },
            ),
            (
                Config {
                    seats_per_table: 1,
                    ..base.clone()
                },
                DomainError::InvalidSeatsPerTable { min: 2, max: 12 },
            ),
            (
                Config {
                    max_tables: 0,
                    ..base.clone()
                },
                DomainError::InvalidMaxTables { min: 1, max: 1000 },
            ),
            (
                Config {
                    final_table_size: Some(10),
                    ..base.clone()
                },
                DomainError::InvalidFinalTableSize { min: 2, max: 9 },
            ),
            (
                Config {
                    balance_trigger: 1,
                    ..base.clone()
                },
                DomainError::InvalidBalanceTrigger { min: 2, max: 9 },
            ),
            (
                Config {
                    break_order: vec![TableNo(2), TableNo(2)],
                    ..base.clone()
                },
                DomainError::InvalidBreakOrder { table: TableNo(2) },
            ),
            (
                Config {
                    break_order: vec![TableNo(11)],
                    ..base.clone()
                },
                DomainError::InvalidBreakOrder { table: TableNo(11) },
            ),
            (
                Config {
                    starting_stack: Chips(0),
                    ..base.clone()
                },
                DomainError::InvalidStartingStack,
            ),
            (
                Config {
                    places_paid: 0,
                    ..base.clone()
                },
                DomainError::InvalidPlacesPaid { min: 1 },
            ),
            (
                Config {
                    late_reg: Deadline::EndOfPlayLevel {
                        n: 4,
                        through_break: false,
                    },
                    ..base.clone()
                },
                DomainError::InvalidLateRegLevel { n: 4, max: 3 },
            ),
            (
                Config {
                    late_reg: Deadline::Elapsed { ms: 0 },
                    ..base.clone()
                },
                DomainError::InvalidLateRegElapsed {
                    max_ms: MAX_LATE_REG_MS,
                },
            ),
        ];
        for (config, expected) in cases {
            assert_eq!(validate(&config, &levels()), Err(expected));
        }
    }

    #[test]
    fn optional_fields_have_defaults() {
        let json = serde_json::json!({
            "name": "Sunday", "seats_per_table": 9, "max_tables": 4,
            "starting_stack": 20000, "places_paid": 3
        });
        let config: Config = serde_json::from_value(json).unwrap();
        assert_eq!(config.balance_trigger, 2);
        assert_eq!(config.final_table_size(), 9);
        assert_eq!(config.late_reg, Deadline::Manual);
        assert_eq!(config.payout, PayoutConfig::default());
    }
}
