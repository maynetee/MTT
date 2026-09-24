//! Tournament configuration and its validation.

use serde::{Deserialize, Serialize};

use crate::error::DomainError;
use crate::event::Event;
use crate::ids::TableNo;
use crate::money::{Chips, Money, Price};
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
#[serde(tag = "type", rename_all_fields = "camelCase")]
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
#[cfg_attr(
    any(test, feature = "ts"),
    derive(ts_rs::TS),
    ts(export, type = "Record<string, never>")
)]
pub struct PayoutConfig {}

/// Largest currency exponent accepted (ISO 4217 uses 0 to 4).
pub const MAX_CURRENCY_EXPONENT: u8 = 4;

/// An ISO 4217 currency: amounts are integers of `10^-exponent` units (EUR: 2, JPY: 0).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Currency {
    /// Three uppercase letters, e.g. `EUR`.
    pub code: String,
    /// Number of minor-unit digits.
    pub exponent: u8,
}

/// Buy-ins, fees and prize pool settings. All amounts are in minor units.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct MoneyConfig {
    pub currency: Currency,
    /// Price of a registration (first entry).
    pub buy_in: Price,
    /// Minimum prize pool promised by the house; it pays the overlay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub guarantee: Option<Money>,
    /// Payouts are multiples of this amount (the remainder goes to first place).
    pub rounding_unit: Money,
    /// Smallest payout: places paid shrink until the last one reaches it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub min_cash: Option<Money>,
}

impl MoneyConfig {
    /// A configuration with a buy-in, no guarantee and payouts rounded to minor units.
    pub fn new(code: &str, exponent: u8, prize: i64, fee: i64) -> Self {
        Self {
            currency: Currency {
                code: code.to_owned(),
                exponent,
            },
            buy_in: Price {
                prize: Money(prize),
                fee: Money(fee),
            },
            guarantee: None,
            rounding_unit: Money(1),
            min_cash: None,
        }
    }
}

/// Tournament settings editable by the director.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// Buy-ins and prize pool; absent for a tournament without money tracking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub money: Option<MoneyConfig>,
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
            money: None,
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
    if let Some(money) = &config.money {
        validate_money(money)?;
    }
    validate_late_reg(config, levels)
}

fn validate_money(money: &MoneyConfig) -> Result<(), DomainError> {
    let code = &money.currency.code;
    if code.len() != 3
        || !code.bytes().all(|b| b.is_ascii_uppercase())
        || money.currency.exponent > MAX_CURRENCY_EXPONENT
    {
        return Err(DomainError::InvalidCurrency {
            max_exponent: MAX_CURRENCY_EXPONENT,
        });
    }
    if !money.buy_in.is_valid() {
        return Err(DomainError::InvalidBuyIn);
    }
    if money.guarantee.is_some_and(|g| !g.is_valid()) {
        return Err(DomainError::InvalidGuarantee);
    }
    if !money.rounding_unit.is_positive() {
        return Err(DomainError::InvalidRoundingUnit);
    }
    if money.min_cash.is_some_and(|m| !m.is_valid()) {
        return Err(DomainError::InvalidMinCash);
    }
    Ok(())
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

/// First field of `config` that cannot change in the current state, if any.
///
/// Money tracking and the currency are frozen once someone has paid (recorded amounts
/// would change meaning); seats, starting stack and buy-in once started.
fn locked_field(state: &State, config: &Config) -> Option<&'static str> {
    let (old, new) = (&state.config.money, &config.money);
    if !state.players.is_empty() {
        match (old, new) {
            (Some(_), None) | (None, Some(_)) => return Some("money"),
            (Some(old), Some(new)) if old.currency != new.currency => {
                return Some("money.currency");
            }
            _ => {}
        }
    }
    if state.phase == Phase::Setup {
        return None;
    }
    if config.seats_per_table != state.config.seats_per_table {
        Some("seatsPerTable")
    } else if config.starting_stack != state.config.starting_stack {
        Some("startingStack")
    } else if old.as_ref().map(|m| m.buy_in) != new.as_ref().map(|m| m.buy_in) {
        Some("money.buyIn")
    } else {
        None
    }
}

/// `UpdateConfig`: see [`locked_field`]; tables in use cannot be removed. Amounts already
/// paid are recorded in their events, so a new buy-in only applies to later entries.
pub(crate) fn decide_update(state: &State, config: &Config) -> Result<Event, DomainError> {
    validate(config, &state.structure)?;
    if *config == state.config {
        return Err(DomainError::NoChange);
    }
    if let Some(field) = locked_field(state, config) {
        return Err(DomainError::ConfigLocked {
            field: field.to_owned(),
        });
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
            "name": "Sunday", "seatsPerTable": 9, "maxTables": 4,
            "startingStack": 20000, "placesPaid": 3
        });
        let config: Config = serde_json::from_value(json).unwrap();
        assert_eq!(config.balance_trigger, 2);
        assert_eq!(config.final_table_size(), 9);
        assert_eq!(config.late_reg, Deadline::Manual);
        assert_eq!(config.payout, PayoutConfig::default());
        assert_eq!(config.money, None);
        // Absent optional sections stay absent, so old logs serialize unchanged.
        let back = serde_json::to_value(&config).unwrap();
        assert!(back.get("money").is_none());
    }

    #[test]
    fn money_config_json_shape() {
        let json = serde_json::json!({
            "currency": {"code": "EUR", "exponent": 2},
            "buyIn": {"prize": 10000, "fee": 1000},
            "roundingUnit": 100
        });
        let money: MoneyConfig = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(money, {
            let mut m = MoneyConfig::new("EUR", 2, 10_000, 1_000);
            m.rounding_unit = Money(100);
            m
        });
        assert_eq!(serde_json::to_value(&money).unwrap(), json);
    }

    #[test]
    fn rejects_invalid_money() {
        let with = |edit: fn(&mut MoneyConfig)| {
            let mut money = MoneyConfig::new("EUR", 2, 10_000, 1_000);
            edit(&mut money);
            Config {
                money: Some(money),
                ..Config::new("Sunday", 9, 10, 20_000)
            }
        };
        assert_eq!(validate(&with(|_| {}), &levels()), Ok(()));
        let currency = DomainError::InvalidCurrency { max_exponent: 4 };
        let cases: Vec<(Config, DomainError)> = vec![
            (with(|m| m.currency.code = "eur".into()), currency.clone()),
            (with(|m| m.currency.code = "EURO".into()), currency.clone()),
            (with(|m| m.currency.exponent = 5), currency),
            (
                with(|m| m.buy_in.prize = Money(-1)),
                DomainError::InvalidBuyIn,
            ),
            (
                with(|m| m.buy_in.fee = Money::MAX),
                DomainError::InvalidBuyIn,
            ),
            (
                with(|m| m.guarantee = Some(Money(-5))),
                DomainError::InvalidGuarantee,
            ),
            (
                with(|m| m.rounding_unit = Money(0)),
                DomainError::InvalidRoundingUnit,
            ),
            (
                with(|m| m.min_cash = Some(Money(-1))),
                DomainError::InvalidMinCash,
            ),
        ];
        for (config, expected) in cases {
            assert_eq!(validate(&config, &levels()), Err(expected));
        }
    }

    mod locks {
        use super::*;
        use crate::command::Command;
        use crate::testkit::Kit;

        fn money() -> MoneyConfig {
            MoneyConfig::new("EUR", 2, 5_000, 500)
        }

        fn update(kit: &Kit, edit: impl FnOnce(&mut Config)) -> Command {
            let mut config = kit.agg.state().config.clone();
            edit(&mut config);
            Command::UpdateConfig { config }
        }

        fn locked(field: &str) -> DomainError {
            DomainError::ConfigLocked {
                field: field.to_owned(),
            }
        }

        #[test]
        fn money_and_currency_are_frozen_once_someone_paid() {
            let mut kit = Kit::new(9, 2);
            let cmd = update(&kit, |c| c.money = Some(money()));
            kit.ok(cmd);
            let a = kit.register("A");
            assert_eq!(kit.err(update(&kit, |c| c.money = None)), locked("money"));
            let cmd = update(&kit, |c| {
                if let Some(m) = c.money.as_mut() {
                    m.currency.exponent = 0;
                }
            });
            assert_eq!(kit.err(cmd), locked("money.currency"));
            // The buy-in may change before the start; paid entries keep their price.
            let cmd = update(&kit, |c| {
                if let Some(m) = c.money.as_mut() {
                    m.buy_in.prize = Money(6_000);
                }
            });
            kit.ok(cmd);
            kit.ok(Command::Unregister { player: a });
            let cmd = update(&kit, |c| c.money = None);
            kit.ok(cmd);
        }

        #[test]
        fn buy_in_is_frozen_once_started() {
            let mut kit = Kit::with_config(Config {
                money: Some(money()),
                ..Config::new("Unit", 9, 2, 10_000)
            });
            kit.register("A");
            kit.register("B");
            kit.ok(Command::StartClock {});
            let cmd = update(&kit, |c| {
                if let Some(m) = c.money.as_mut() {
                    m.buy_in.fee = Money(600);
                }
            });
            assert_eq!(kit.err(cmd), locked("money.buyIn"));
            let cmd = update(&kit, |c| {
                if let Some(m) = c.money.as_mut() {
                    m.guarantee = Some(Money(100_000));
                }
            });
            kit.ok(cmd);
        }
    }
}
