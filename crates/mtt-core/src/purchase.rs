//! Re-entries, rebuys and add-ons.
//!
//! A re-entry brings a busted player back as a new entry of the same player (entries
//! count, unique players do not); rebuys and add-ons add chips to a player still in. Each
//! event records the stack and the price applied, so config edits never rewrite them.
//!
//! Windows (only while running): without a window, or with a `manual` deadline, a purchase
//! follows registration (the director's override included); `until` another deadline is
//! evaluated like the late registration deadline; `break_after { n }` is open during the
//! break right after play level `n`. A re-entry also needs registration to be open.

use crate::clock;
use crate::config::{Deadline, Purchase, PurchaseKind, PurchaseWindow};
use crate::error::DomainError;
use crate::event::Event;
use crate::ids::{PlayerId, SeatRef};
use crate::registration;
use crate::rng::Rng;
use crate::state::{Phase, Player, State};
use crate::structure;

/// True when `window` is open at `now_ms` (ignores the phase).
fn window_open(state: &State, window: Option<PurchaseWindow>, now_ms: i64) -> bool {
    match window {
        None
        | Some(PurchaseWindow::Until {
            deadline: Deadline::Manual,
        }) => registration::is_open(state, now_ms),
        Some(PurchaseWindow::Until { deadline }) => {
            registration::time_left_ms(state, deadline, now_ms).is_none_or(|left| left > 0)
        }
        Some(PurchaseWindow::BreakAfter { n }) => {
            let levels = &state.structure;
            let level = clock::current_level(&state.clock, levels, now_ms);
            structure::play_level_index(levels, n)
                .is_some_and(|i| level == i + 1 && levels.get(level).is_some_and(|l| l.is_break()))
        }
    }
}

/// True when `kind` can be bought at `now_ms`: offered, running and inside its window;
/// a re-entry also needs registration to be open.
pub fn is_open(state: &State, kind: PurchaseKind, now_ms: i64) -> bool {
    let Some(purchase) = state.config.purchase(kind) else {
        return false;
    };
    state.phase == Phase::Running
        && window_open(state, purchase.window, now_ms)
        && (kind != PurchaseKind::Reentry || registration::is_open(state, now_ms))
}

/// Clock time before the window of `kind` closes when a deadline (not a level change or
/// the director) closes it.
pub fn closes_in_ms(state: &State, kind: PurchaseKind, now_ms: i64) -> Option<i64> {
    let purchase = state.config.purchase(kind)?;
    match purchase.window? {
        PurchaseWindow::Until { deadline } if is_open(state, kind, now_ms) => {
            registration::time_left_ms(state, deadline, now_ms).filter(|&left| left > 0)
        }
        _ => None,
    }
}

/// True while new entries can still arrive: registration or re-entry open. The
/// tournament cannot finish before that.
pub fn entries_open(state: &State, now_ms: i64) -> bool {
    registration::is_open(state, now_ms) || is_open(state, PurchaseKind::Reentry, now_ms)
}

/// Most purchases of a kind per player (`None` in the config means unlimited, bounded by
/// the counters).
fn limit(purchase: &Purchase, kind: PurchaseKind) -> u8 {
    let storage = match kind {
        // `entries` counts the first entry too.
        PurchaseKind::Reentry => u8::MAX - 1,
        PurchaseKind::Rebuy | PurchaseKind::Addon => u8::MAX,
    };
    purchase.max.map_or(storage, |max| max.min(storage))
}

/// True when `player` is busted and may re-enter at `now_ms`.
pub fn can_reenter(state: &State, player: &Player, now_ms: i64) -> bool {
    let Some(purchase) = &state.config.reentry else {
        return false;
    };
    !player.is_alive()
        && player.entries <= limit(purchase, PurchaseKind::Reentry)
        && is_open(state, PurchaseKind::Reentry, now_ms)
}

fn require_running(state: &State) -> Result<(), DomainError> {
    match state.phase {
        Phase::Setup => Err(DomainError::NotStarted),
        Phase::Running => Ok(()),
        Phase::Finished { .. } => Err(DomainError::TournamentFinished),
    }
}

fn closed(kind: PurchaseKind) -> DomainError {
    match kind {
        PurchaseKind::Reentry => DomainError::ReentryClosed,
        PurchaseKind::Rebuy => DomainError::RebuyClosed,
        PurchaseKind::Addon => DomainError::AddonClosed,
    }
}

/// The purchase settings of `kind` when it can be bought now.
fn open_purchase(state: &State, kind: PurchaseKind, now_ms: i64) -> Result<Purchase, DomainError> {
    match state.config.purchase(kind) {
        Some(purchase) if is_open(state, kind, now_ms) => Ok(*purchase),
        _ => Err(closed(kind)),
    }
}

fn price(state: &State, purchase: &Purchase) -> Option<crate::money::Price> {
    state.config.money.as_ref().map(|_| purchase.price())
}

/// `ReEnter`: a busted player buys a new entry and is seated like a registration.
pub(crate) fn decide_reenter(
    state: &State,
    player: PlayerId,
    forced: Option<SeatRef>,
    now_ms: i64,
    rng: &mut Rng,
) -> Result<Event, DomainError> {
    require_running(state)?;
    let found = state
        .player(player)
        .ok_or(DomainError::PlayerNotFound { player })?;
    if found.is_alive() {
        return Err(DomainError::PlayerNotBusted { player });
    }
    let kind = PurchaseKind::Reentry;
    let purchase = open_purchase(state, kind, now_ms)?;
    let max = limit(&purchase, kind);
    // `entries` counts the first entry: `entries - 1` re-entries were bought.
    if found.entries > max {
        return Err(DomainError::MaxEntries { max });
    }
    let (seat, opened_table) = registration::seat_new_entry(state, forced, rng)?;
    Ok(Event::PlayerReEntered {
        player,
        entry: found.entries + 1,
        seat,
        stack: purchase.stack,
        opened_table,
        price: price(state, &purchase),
    })
}

/// `Rebuy` and `AddOn`: a player still in buys chips.
pub(crate) fn decide_buy(
    state: &State,
    kind: PurchaseKind,
    player: PlayerId,
    now_ms: i64,
) -> Result<Event, DomainError> {
    require_running(state)?;
    let found = state
        .player(player)
        .ok_or(DomainError::PlayerNotFound { player })?;
    if !found.is_alive() {
        return Err(DomainError::PlayerNotActive { player });
    }
    let purchase = open_purchase(state, kind, now_ms)?;
    let max = limit(&purchase, kind);
    let (stack, price) = (purchase.stack, price(state, &purchase));
    match kind {
        PurchaseKind::Rebuy if found.rebuys >= max => Err(DomainError::RebuyLimit { max }),
        PurchaseKind::Addon if found.addons >= max => Err(DomainError::AddonLimit { max }),
        PurchaseKind::Rebuy => Ok(Event::RebuyRecorded {
            player,
            stack,
            price,
        }),
        PurchaseKind::Addon => Ok(Event::AddOnRecorded {
            player,
            stack,
            price,
        }),
        PurchaseKind::Reentry => Err(DomainError::Internal {
            reason: "re-entries are not bought by a player still in".to_owned(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::Command;
    use crate::config::{Config, MoneyConfig};
    use crate::money::{Chips, Money, Price};
    use crate::structure::tests::{pause, play};
    use crate::testkit::{Kit, T0, bust};

    const MIN: i64 = 60_000;

    /// Kit structure: `[P1 20', P2 20', break 10', P3 20']`.
    fn kit_with(edit: impl FnOnce(&mut Config)) -> (Kit, Vec<PlayerId>) {
        let mut config = Config {
            money: Some(MoneyConfig::new("EUR", 2, 10_000, 1_000)),
            ..Config::new("Unit", 9, 3, 10_000)
        };
        edit(&mut config);
        let mut kit = Kit::with_config(config);
        let ids = (0..4).map(|i| kit.register(&format!("P{i}"))).collect();
        (kit, ids)
    }

    fn reenter(player: PlayerId) -> Command {
        Command::ReEnter { player, seat: None }
    }

    fn player(kit: &Kit, id: PlayerId) -> &Player {
        kit.agg.state().player(id).unwrap()
    }

    #[test]
    fn reentry_needs_a_busted_player_and_an_open_window() {
        let (mut kit, ids) = kit_with(|c| {
            c.reentry = Some(Purchase {
                max: Some(1),
                ..Purchase::new(10_000, 1_000, 10_000)
            })
        });
        assert_eq!(kit.err(reenter(ids[0])), DomainError::NotStarted);
        kit.ok(Command::StartClock {});
        assert_eq!(
            kit.err(reenter(ids[0])),
            DomainError::PlayerNotBusted { player: ids[0] }
        );
        assert_eq!(
            kit.err(reenter(PlayerId(99))),
            DomainError::PlayerNotFound {
                player: PlayerId(99)
            }
        );
        kit.ok(bust(&[ids[0]]));
        kit.ok(reenter(ids[0]));
        let p = player(&kit, ids[0]);
        assert!(p.is_alive());
        assert_eq!((p.entries, p.chips_bought), (2, Chips(20_000)));
        assert_eq!((p.prize_paid, p.fees_paid), (Money(20_000), Money(2_000)));
        kit.ok(bust(&[ids[0]]));
        assert_eq!(kit.err(reenter(ids[0])), DomainError::MaxEntries { max: 1 });
        kit.ok(bust(&[ids[1]]));
        kit.ok(Command::CloseRegistration {});
        assert_eq!(kit.err(reenter(ids[1])), DomainError::ReentryClosed);
    }

    #[test]
    fn reentry_is_closed_when_not_offered() {
        let (mut kit, ids) = kit_with(|_| {});
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[ids[0]]));
        assert_eq!(kit.err(reenter(ids[0])), DomainError::ReentryClosed);
    }

    #[test]
    fn reentry_is_seated_like_a_registration() {
        let (mut kit, ids) = kit_with(|c| c.reentry = Some(Purchase::new(10_000, 1_000, 8_000)));
        kit.ok(Command::StartClock {});
        let seat = kit.seat_of(ids[0]).unwrap();
        let taken = kit.seat_of(ids[1]).unwrap();
        kit.ok(bust(&[ids[0]]));
        assert_eq!(
            kit.err(Command::ReEnter {
                player: ids[0],
                seat: Some(taken)
            }),
            DomainError::SeatOccupied {
                table: taken.table,
                seat: taken.seat
            }
        );
        // A forced seat at an idle table opens it.
        let idle = SeatRef::new(3, 2);
        kit.ok(Command::ReEnter {
            player: ids[0],
            seat: Some(idle),
        });
        assert_eq!(kit.seat_of(ids[0]), Some(idle));
        assert_ne!(seat, idle);
        assert_eq!(player(&kit, ids[0]).chips_bought, Chips(18_000));
        let last = kit.agg.events().last().unwrap().event.clone();
        assert_eq!(
            last,
            Event::PlayerReEntered {
                player: ids[0],
                entry: 2,
                seat: idle,
                stack: Chips(8_000),
                opened_table: Some(crate::ids::TableNo(3)),
                price: Some(Price {
                    prize: Money(10_000),
                    fee: Money(1_000)
                }),
            }
        );
    }

    #[test]
    fn reentry_deadline_can_close_before_registration() {
        let (mut kit, ids) = kit_with(|c| {
            c.reentry = Some(Purchase {
                window: Some(PurchaseWindow::Until {
                    deadline: Deadline::EndOfPlayLevel {
                        n: 1,
                        through_break: false,
                    },
                }),
                ..Purchase::new(10_000, 1_000, 10_000)
            })
        });
        kit.ok(Command::StartClock {});
        kit.ok(bust(&[ids[0], ids[1]]));
        kit.now = T0 + 19 * MIN;
        kit.ok(reenter(ids[0]));
        kit.now = T0 + 21 * MIN;
        assert!(registration::is_open(kit.agg.state(), kit.now));
        assert_eq!(kit.err(reenter(ids[1])), DomainError::ReentryClosed);
    }

    #[test]
    fn rebuys_add_chips_to_players_still_in() {
        let (mut kit, ids) = kit_with(|c| {
            c.rebuy = Some(Purchase {
                max: Some(2),
                ..Purchase::new(10_000, 0, 10_000)
            })
        });
        let rebuy = |player| Command::Rebuy { player };
        assert_eq!(kit.err(rebuy(ids[0])), DomainError::NotStarted);
        kit.ok(Command::StartClock {});
        kit.ok(rebuy(ids[0]));
        kit.ok(rebuy(ids[0]));
        assert_eq!(kit.err(rebuy(ids[0])), DomainError::RebuyLimit { max: 2 });
        let p = player(&kit, ids[0]);
        assert_eq!((p.rebuys, p.entries), (2, 1));
        assert_eq!(
            (p.chips_bought, p.prize_paid),
            (Chips(30_000), Money(30_000))
        );
        kit.ok(bust(&[ids[1]]));
        assert_eq!(
            kit.err(rebuy(ids[1])),
            DomainError::PlayerNotActive { player: ids[1] }
        );
        kit.ok(Command::CloseRegistration {});
        assert_eq!(kit.err(rebuy(ids[2])), DomainError::RebuyClosed);
    }

    #[test]
    fn addon_during_the_break_after_a_level() {
        let (mut kit, ids) = kit_with(|c| {
            c.addon = Some(Purchase {
                max: Some(1),
                window: Some(PurchaseWindow::BreakAfter { n: 2 }),
                ..Purchase::new(5_000, 500, 15_000)
            })
        });
        let addon = |player| Command::AddOn { player };
        kit.ok(Command::StartClock {});
        assert_eq!(kit.err(addon(ids[0])), DomainError::AddonClosed);
        kit.now = T0 + 41 * MIN;
        let view = kit.agg.view(kit.now);
        assert_eq!(view.registration.addon_open, Some(true));
        kit.ok(addon(ids[0]));
        assert_eq!(kit.err(addon(ids[0])), DomainError::AddonLimit { max: 1 });
        assert_eq!(player(&kit, ids[0]).chips_bought, Chips(25_000));
        kit.now = T0 + 50 * MIN;
        assert_eq!(kit.err(addon(ids[1])), DomainError::AddonClosed);
        // Registration closing does not matter to a window with its own schedule.
        kit.ok(Command::CloseRegistration {});
        kit.ok(Command::JumpTo { level: 2 });
        kit.ok(addon(ids[1]));
    }

    #[test]
    fn purchases_without_money_record_no_price() {
        let mut kit = Kit::with_config(Config {
            rebuy: Some(Purchase::new(0, 0, 10_000)),
            ..Config::new("Unit", 9, 1, 10_000)
        });
        let a = kit.register("A");
        kit.register("B");
        kit.ok(Command::StartClock {});
        kit.ok(Command::Rebuy { player: a });
        assert_eq!(
            kit.agg.events().last().unwrap().event,
            Event::RebuyRecorded {
                player: a,
                stack: Chips(10_000),
                price: None
            }
        );
    }

    #[test]
    fn purchase_settings_are_validated() {
        let levels = vec![
            play(25, 50, 20),
            play(50, 100, 20),
            pause(10),
            play(75, 150, 20),
        ];
        let base = Config::new("Unit", 9, 2, 10_000);
        let check = |edit: fn(&mut Config)| {
            let mut config = base.clone();
            edit(&mut config);
            crate::config::validate(&config, &levels)
        };
        let invalid = Err(DomainError::InvalidPurchase {
            purchase: PurchaseKind::Rebuy,
        });
        assert_eq!(check(|c| c.rebuy = Some(Purchase::new(0, 0, 0))), invalid);
        assert_eq!(
            check(|c| c.rebuy = Some(Purchase {
                max: Some(0),
                ..Purchase::new(0, 0, 1_000)
            })),
            invalid
        );
        // A price needs money tracking.
        assert_eq!(
            check(|c| c.rebuy = Some(Purchase::new(100, 0, 1_000))),
            invalid
        );
        let window = Err(DomainError::InvalidPurchaseWindow {
            purchase: PurchaseKind::Addon,
        });
        fn addon_after(n: u16) -> Option<Purchase> {
            Some(Purchase {
                window: Some(PurchaseWindow::BreakAfter { n }),
                ..Purchase::new(0, 0, 1_000)
            })
        }
        assert_eq!(check(|c| c.addon = addon_after(2)), Ok(()));
        assert_eq!(check(|c| c.addon = addon_after(1)), window);
        assert_eq!(check(|c| c.addon = addon_after(4)), window);
        assert_eq!(
            check(|c| c.addon = Some(Purchase {
                window: Some(PurchaseWindow::Until {
                    deadline: Deadline::Elapsed { ms: 0 }
                }),
                ..Purchase::new(0, 0, 1_000)
            })),
            window
        );
    }

    #[test]
    fn structure_edits_keep_purchase_windows_valid() {
        let (mut kit, _) = kit_with(|c| {
            c.addon = Some(Purchase {
                window: Some(PurchaseWindow::BreakAfter { n: 2 }),
                ..Purchase::new(0, 0, 1_000)
            })
        });
        let levels = vec![play(25, 50, 20), play(50, 100, 20), play(75, 150, 20)];
        assert_eq!(
            kit.err(Command::UpdateStructure { levels }),
            DomainError::InvalidPurchaseWindow {
                purchase: PurchaseKind::Addon
            }
        );
    }
}
