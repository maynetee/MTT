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

/// Longest custom payout table.
pub const MAX_PAID_PLACES: usize = 10_000;
/// Basis points in 100 %.
pub const BPS: u16 = 10_000;

/// How many places are paid (always at least 1 and at most the number of players).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum PlacesPaid {
    /// A share of the entries (re-entries included) in basis points, rounded up.
    #[serde(rename = "percent")]
    Percent { bps: u16 },
    #[serde(rename = "fixed")]
    Fixed { n: u16 },
}

/// How the effective prize pool is split between the places paid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum PayoutAmounts {
    /// Power-law curve giving first place `first_share_bps` of the pool (default by the
    /// number of places paid).
    #[serde(rename = "curve")]
    Curve {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(any(test, feature = "ts"), ts(optional))]
        first_share_bps: Option<u16>,
    },
    /// Share of each place in basis points (non-increasing, sum 10000). The table sets the
    /// places paid.
    #[serde(rename = "custom_bps")]
    CustomBps { bps: Vec<u16> },
    /// Amount of each place (non-increasing), paid as is. The table sets the places paid.
    #[serde(rename = "custom_amounts")]
    CustomAmounts { amounts: Vec<Money> },
}

/// Payout settings. Everything is optional: by default `Config.places_paid` places are
/// paid on the default curve.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct PayoutConfig {
    /// Rule for the places paid; absent: `Config.places_paid`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub places_paid: Option<PlacesPaid>,
    /// Split of the pool; absent: the default curve.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub amounts: Option<PayoutAmounts>,
}

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

/// A purchase after the first entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum PurchaseKind {
    /// A busted player comes back as a new entry.
    #[serde(rename = "reentry")]
    Reentry,
    /// A player still in buys more chips.
    #[serde(rename = "rebuy")]
    Rebuy,
    /// A player still in buys the add-on stack.
    #[serde(rename = "addon")]
    Addon,
}

/// When a purchase can be made (only while the tournament runs). Without a window, it
/// follows registration, the director's override included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub enum PurchaseWindow {
    /// Until `deadline`, evaluated like the late registration deadline; `manual`
    /// follows registration.
    #[serde(rename = "until")]
    Until { deadline: Deadline },
    /// Only during the break right after play level `n` (1-based, breaks not counted).
    #[serde(rename = "break_after")]
    BreakAfter { n: u16 },
}

/// Re-entry, rebuy or add-on settings. Events record the price and stack applied, so
/// editing these never changes past purchases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "ts"), derive(ts_rs::TS), ts(export))]
pub struct Purchase {
    /// Part added to the prize pool (0 without money tracking).
    pub prize: Money,
    /// Part kept by the house (0 without money tracking).
    pub fee: Money,
    /// Chips received.
    pub stack: Chips,
    /// Most purchases of this kind per player (re-entries: not counting the first
    /// entry); unlimited when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub max: Option<u8>,
    /// When it can be bought; absent: while registration is open.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub window: Option<PurchaseWindow>,
}

impl Purchase {
    /// A purchase at `prize + fee` for `stack` chips, unlimited, following registration.
    pub fn new(prize: i64, fee: i64, stack: i64) -> Self {
        Self {
            prize: Money(prize),
            fee: Money(fee),
            stack: Chips(stack),
            max: None,
            window: None,
        }
    }

    /// Price paid, split between the pool and the house.
    pub fn price(&self) -> Price {
        Price {
            prize: self.prize,
            fee: self.fee,
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
    /// Places paid by default (see `PayoutConfig`); ignored without payouts.
    pub places_paid: u16,
    #[serde(default)]
    pub late_reg: Deadline,
    /// Whether the tournament pays prizes (the default). Without payouts nobody is in the
    /// money: no places paid, no bubble, no payouts, no deal. `places_paid` and `payout`
    /// are kept for when it is turned back on. Only `false` is written, so logs from
    /// before this field serialize unchanged.
    #[serde(default = "default_payouts", skip_serializing_if = "is_true")]
    pub payouts: bool,
    #[serde(default)]
    pub payout: PayoutConfig,
    /// Buy-ins and prize pool; absent for a tournament without money tracking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub money: Option<MoneyConfig>,
    /// Busted players may come back as new entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub reentry: Option<Purchase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub rebuy: Option<Purchase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(any(test, feature = "ts"), ts(optional))]
    pub addon: Option<Purchase>,
}

fn default_balance_trigger() -> u8 {
    2
}

fn default_payouts() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
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
            payouts: true,
            payout: PayoutConfig::default(),
            money: None,
            reentry: None,
            rebuy: None,
            addon: None,
        }
    }

    /// Effective final table size.
    pub fn final_table_size(&self) -> u8 {
        self.final_table_size.unwrap_or(self.seats_per_table)
    }

    /// Settings of a purchase kind, when offered.
    pub fn purchase(&self, kind: PurchaseKind) -> Option<&Purchase> {
        match kind {
            PurchaseKind::Reentry => self.reentry.as_ref(),
            PurchaseKind::Rebuy => self.rebuy.as_ref(),
            PurchaseKind::Addon => self.addon.as_ref(),
        }
    }
}

/// Every purchase kind, in display order.
pub const PURCHASE_KINDS: [PurchaseKind; 3] = [
    PurchaseKind::Reentry,
    PurchaseKind::Rebuy,
    PurchaseKind::Addon,
];

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
    validate_payout(&config.payout)?;
    if let Some(money) = &config.money {
        validate_money(money)?;
    }
    for purchase in PURCHASE_KINDS {
        let Some(p) = config.purchase(purchase) else {
            continue;
        };
        let priced = p.prize != Money::ZERO || p.fee != Money::ZERO;
        let invalid = !p.price().is_valid()
            || !p.stack.is_positive()
            || p.max == Some(0)
            || (priced && config.money.is_none());
        if invalid {
            return Err(DomainError::InvalidPurchase { purchase });
        }
    }
    validate_deadlines(config, levels)
}

/// Checks the late registration deadline and the purchase windows against a structure.
pub fn validate_deadlines(config: &Config, levels: &[Level]) -> Result<(), DomainError> {
    validate_late_reg(config, levels)?;
    for purchase in PURCHASE_KINDS {
        let window = config.purchase(purchase).and_then(|p| p.window);
        let valid = match window {
            None => true,
            Some(PurchaseWindow::Until { deadline }) => deadline_is_valid(deadline, levels),
            Some(PurchaseWindow::BreakAfter { n }) => structure::play_level_index(levels, n)
                .and_then(|i| levels.get(i + 1))
                .is_some_and(Level::is_break),
        };
        if !valid {
            return Err(DomainError::InvalidPurchaseWindow { purchase });
        }
    }
    Ok(())
}

fn deadline_is_valid(deadline: Deadline, levels: &[Level]) -> bool {
    match deadline {
        Deadline::EndOfPlayLevel { n, .. } => {
            (1..=structure::play_level_count(levels)).contains(&n)
        }
        Deadline::Elapsed { ms } => ms > 0 && ms <= MAX_LATE_REG_MS,
        Deadline::Manual => true,
    }
}

fn non_increasing<T: PartialOrd>(values: &[T]) -> bool {
    values.windows(2).all(|w| w[0] >= w[1])
}

fn validate_payout(payout: &PayoutConfig) -> Result<(), DomainError> {
    match payout.places_paid {
        Some(PlacesPaid::Fixed { n: 0 }) => {
            return Err(DomainError::InvalidPlacesPaid { min: 1 });
        }
        Some(PlacesPaid::Percent { bps }) if bps == 0 || bps > BPS => {
            return Err(DomainError::InvalidPlacesPaidPercent { min: 1, max: BPS });
        }
        _ => {}
    }
    match &payout.amounts {
        Some(PayoutAmounts::Curve {
            first_share_bps: Some(bps),
        }) if *bps == 0 || *bps > BPS => Err(DomainError::InvalidFirstShare { min: 1, max: BPS }),
        Some(PayoutAmounts::CustomBps { bps }) => {
            let sum: u32 = bps.iter().map(|&b| u32::from(b)).sum();
            let valid = !bps.is_empty()
                && bps.len() <= MAX_PAID_PLACES
                && bps.iter().all(|&b| b > 0)
                && non_increasing(bps)
                && sum == u32::from(BPS);
            if valid {
                Ok(())
            } else {
                Err(DomainError::InvalidPayoutShares { total: BPS })
            }
        }
        Some(PayoutAmounts::CustomAmounts { amounts }) => {
            let total = amounts
                .iter()
                .try_fold(Money::ZERO, |sum, &a| sum.checked_add(a));
            let valid = !amounts.is_empty()
                && amounts.len() <= MAX_PAID_PLACES
                && amounts.iter().all(|a| a.is_positive())
                && non_increasing(amounts)
                && total.is_some();
            if valid {
                Ok(())
            } else {
                Err(DomainError::InvalidPayoutAmounts)
            }
        }
        _ => Ok(()),
    }
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

/// Settings that shape the payouts (the pool aside).
fn payout_rules(config: &Config) -> (u16, &PayoutConfig, Option<(Money, Option<Money>)>) {
    let money = config.money.as_ref().map(|m| (m.rounding_unit, m.min_cash));
    (config.places_paid, &config.payout, money)
}

/// `UpdateConfig`: see [`locked_field`]; payout settings (turning payouts off included)
/// are frozen while payouts are locked, hence while a deal stands; tables in use cannot
/// be removed. Amounts already paid are recorded in their events, so a new buy-in only
/// applies to later entries.
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
    let payouts_changed = config.payouts != state.config.payouts
        || payout_rules(config) != payout_rules(&state.config);
    if state.payouts_locked.is_some() && payouts_changed {
        return Err(DomainError::PayoutsLocked);
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
        assert!(config.payouts);
        // Absent optional sections stay absent, so old logs serialize unchanged.
        let back = serde_json::to_value(&config).unwrap();
        assert!(back.get("money").is_none());
        assert!(back.get("payouts").is_none());
    }

    #[test]
    fn only_a_tournament_without_payouts_writes_the_flag() {
        let json = serde_json::json!({
            "name": "League night", "seatsPerTable": 9, "maxTables": 4,
            "startingStack": 20000, "placesPaid": 3, "payouts": false
        });
        let config: Config = serde_json::from_value(json).unwrap();
        assert!(!config.payouts);
        // Places paid keep their valid value for when payouts are turned back on.
        assert_eq!(validate(&config, &levels()), Ok(()));
        let back = serde_json::to_value(&config).unwrap();
        assert_eq!(back.get("payouts"), Some(&serde_json::json!(false)));
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

    #[test]
    fn payout_settings_json_and_validation() {
        let json = serde_json::json!({
            "placesPaid": {"type": "percent", "bps": 1500},
            "amounts": {"type": "curve", "firstShareBps": 2500}
        });
        let payout: PayoutConfig = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(serde_json::to_value(&payout).unwrap(), json);
        // The old empty object still reads as the defaults.
        let empty: PayoutConfig = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(empty, PayoutConfig::default());
        let check = |places_paid, amounts| {
            validate(
                &Config {
                    payout: PayoutConfig {
                        places_paid,
                        amounts,
                    },
                    ..Config::new("Sunday", 9, 10, 20_000)
                },
                &levels(),
            )
        };
        assert_eq!(
            check(Some(PlacesPaid::Percent { bps: 1_500 }), None),
            Ok(())
        );
        assert_eq!(
            check(Some(PlacesPaid::Fixed { n: 0 }), None),
            Err(DomainError::InvalidPlacesPaid { min: 1 })
        );
        for bps in [0, 10_001] {
            assert_eq!(
                check(Some(PlacesPaid::Percent { bps }), None),
                Err(DomainError::InvalidPlacesPaidPercent {
                    min: 1,
                    max: 10_000
                })
            );
        }
        assert_eq!(
            check(
                None,
                Some(PayoutAmounts::Curve {
                    first_share_bps: Some(0)
                })
            ),
            Err(DomainError::InvalidFirstShare {
                min: 1,
                max: 10_000
            })
        );
        let shares =
            |bps: &[u16]| check(None, Some(PayoutAmounts::CustomBps { bps: bps.to_vec() }));
        assert_eq!(shares(&[5_000, 3_000, 2_000]), Ok(()));
        let bad_shares = Err(DomainError::InvalidPayoutShares { total: 10_000 });
        assert_eq!(shares(&[5_000, 3_000]), bad_shares);
        assert_eq!(shares(&[3_000, 5_000, 2_000]), bad_shares);
        assert_eq!(shares(&[10_000, 0]), bad_shares);
        assert_eq!(shares(&[]), bad_shares);
        let amounts = |values: &[i64]| {
            check(
                None,
                Some(PayoutAmounts::CustomAmounts {
                    amounts: values.iter().copied().map(Money).collect(),
                }),
            )
        };
        assert_eq!(amounts(&[500, 300, 300]), Ok(()));
        assert_eq!(amounts(&[300, 500]), Err(DomainError::InvalidPayoutAmounts));
        assert_eq!(amounts(&[500, 0]), Err(DomainError::InvalidPayoutAmounts));
        assert_eq!(
            amounts(&[Money::MAX.0, 1]),
            Err(DomainError::InvalidPayoutAmounts)
        );
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
        fn payouts_turn_off_and_on_unless_locked() {
            let mut kit = Kit::with_config(Config {
                money: Some(money()),
                ..Config::new("Unit", 9, 2, 10_000)
            });
            kit.register("A");
            kit.register("B");
            kit.ok(Command::StartClock {});
            kit.ok(update(&kit, |c| c.payouts = false));
            assert!(!kit.agg.state().config.payouts);
            kit.ok(update(&kit, |c| c.payouts = true));
            kit.ok(Command::LockPayouts {});
            assert_eq!(
                kit.err(update(&kit, |c| c.payouts = false)),
                DomainError::PayoutsLocked
            );
            kit.ok(Command::UnlockPayouts {});
            kit.ok(update(&kit, |c| c.payouts = false));
            // Undo brings the payouts back, redo removes them again.
            kit.ok(Command::Undo {});
            assert!(kit.agg.state().config.payouts);
            kit.ok(Command::Redo {});
            assert!(!kit.agg.state().config.payouts);
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
