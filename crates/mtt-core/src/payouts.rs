//! Prize pool: what the entries paid, the guarantee and the overlay.
//!
//! Every amount comes from the events (the price recorded with each entry), never from
//! the current configuration, so editing the buy-in never rewrites what was paid.

use crate::money::Money;
use crate::state::State;

/// Prize pool totals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pool {
    /// Sum of the prize parts paid.
    pub prize: Money,
    /// Sum of the fees paid (not in the prize pool).
    pub fees: Money,
    pub guarantee: Option<Money>,
    /// Paid by the house: guarantee minus prize pool, when positive.
    pub overlay: Money,
    /// What the payouts distribute: the larger of the prize pool and the guarantee.
    pub effective: Money,
}

/// Prize pool of the current state.
pub fn pool(state: &State) -> Pool {
    let (prize, fees) =
        state
            .players
            .values()
            .fold((Money::ZERO, Money::ZERO), |(prize, fees), p| {
                (
                    prize.saturating_add(p.prize_paid),
                    fees.saturating_add(p.fees_paid),
                )
            });
    let guarantee = state.config.money.as_ref().and_then(|m| m.guarantee);
    let effective = guarantee.map_or(prize, |g| g.max(prize));
    Pool {
        prize,
        fees,
        guarantee,
        overlay: Money(effective.0 - prize.0),
        effective,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::Command;
    use crate::config::{Config, MoneyConfig};
    use crate::testkit::Kit;

    fn money_kit(guarantee: Option<i64>) -> Kit {
        let mut money = MoneyConfig::new("EUR", 2, 10_000, 1_000);
        money.guarantee = guarantee.map(Money);
        Kit::with_config(Config {
            money: Some(money),
            ..Config::new("Unit", 9, 2, 10_000)
        })
    }

    #[test]
    fn pool_sums_the_recorded_prices() {
        let mut kit = money_kit(None);
        kit.register("A");
        kit.register("B");
        let p = pool(kit.agg.state());
        assert_eq!((p.prize, p.fees), (Money(20_000), Money(2_000)));
        assert_eq!((p.overlay, p.effective), (Money(0), Money(20_000)));
        // A new buy-in only applies to later entries.
        let mut config = kit.agg.state().config.clone();
        if let Some(m) = config.money.as_mut() {
            m.buy_in.prize = Money(5_000);
        }
        kit.ok(Command::UpdateConfig { config });
        kit.register("C");
        assert_eq!(pool(kit.agg.state()).prize, Money(25_000));
    }

    #[test]
    fn guarantee_covers_a_small_pool() {
        let mut kit = money_kit(Some(50_000));
        let a = kit.register("A");
        kit.register("B");
        let p = pool(kit.agg.state());
        assert_eq!((p.overlay, p.effective), (Money(30_000), Money(50_000)));
        kit.ok(Command::Unregister { player: a });
        let p = pool(kit.agg.state());
        assert_eq!(
            (p.prize, p.fees, p.overlay),
            (Money(10_000), Money(1_000), Money(40_000))
        );
        for name in ["C", "D", "E", "F", "G"] {
            kit.register(name);
        }
        let p = pool(kit.agg.state());
        assert_eq!((p.overlay, p.effective), (Money(0), Money(60_000)));
    }

    #[test]
    fn unregister_refunds_what_was_paid() {
        let mut kit = money_kit(None);
        let a = kit.register("A");
        kit.ok(Command::Unregister { player: a });
        let refund = match &kit.agg.events().last().unwrap().event {
            crate::event::Event::PlayerUnregistered { refund, .. } => *refund,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(
            refund,
            Some(crate::money::Price {
                prize: Money(10_000),
                fee: Money(1_000)
            })
        );
    }
}
