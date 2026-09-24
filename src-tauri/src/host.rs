//! The tournaments of the desktop app: the core's aggregates, kept in memory and persisted
//! by [`Store`] before any change becomes visible.

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use mtt_core::view::PhaseName;
use mtt_core::{Aggregate, Command, Config, Ctx, Level, NewTournament, TournamentId, View};
use serde::{Deserialize, Serialize};

use crate::error::EngineError;
use crate::store::Store;

/// One line of the tournament list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentSummary {
    pub id: TournamentId,
    pub name: String,
    pub phase: PhaseName,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    /// Distinct players registered.
    pub players: u32,
    /// Players still in.
    pub alive: u32,
}

/// A new tournament as the front end describes it; the host assigns the id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTournamentInput {
    pub config: Config,
    pub structure: Vec<Level>,
}

/// Wall-clock time in Unix milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// Context of one command: the current time and a fresh seed from the OS.
pub fn fresh_ctx() -> Result<Ctx, EngineError> {
    let seed = getrandom::u64()
        .map_err(|err| EngineError::host(format!("no randomness available: {err}")))?;
    Ok(Ctx::new(now_ms(), seed))
}

/// A new tournament id: a random UUID (version 4).
pub fn new_tournament_id() -> TournamentId {
    TournamentId(uuid::Uuid::new_v4().to_string())
}

/// The store and the aggregates loaded from it, behind one lock.
pub struct Host {
    inner: Mutex<Inner>,
}

struct Inner {
    store: Store,
    /// Aggregates already rebuilt from the store; always equal to what it holds.
    loaded: BTreeMap<TournamentId, Aggregate>,
}

impl Inner {
    /// Tournament `id`, rebuilt from its log on first use.
    fn get(&mut self, id: &str) -> Result<&Aggregate, EngineError> {
        let key = TournamentId(id.to_owned());
        if !self.loaded.contains_key(&key) {
            let agg = self
                .store
                .load(id)?
                .ok_or_else(|| EngineError::not_found(id))?;
            self.loaded.insert(key.clone(), agg);
        }
        self.loaded
            .get(&key)
            .ok_or_else(|| EngineError::not_found(id))
    }
}

impl Host {
    pub fn new(store: Store) -> Self {
        Self {
            inner: Mutex::new(Inner {
                store,
                loaded: BTreeMap::new(),
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        // Nothing is left half-done while the lock is held: a change is persisted before
        // the aggregate is swapped in.
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Every tournament, most recently updated first. A tournament whose log cannot be
    /// rebuilt is left out and reported on stderr.
    pub fn list(&self, now_ms: i64) -> Result<Vec<TournamentSummary>, EngineError> {
        let mut inner = self.lock();
        let rows = inner.store.tournaments()?;
        let mut summaries = Vec::with_capacity(rows.len());
        for row in rows {
            let view = match inner.get(&row.id.0) {
                Ok(agg) => agg.view(now_ms),
                Err(err) => {
                    eprintln!("tournament {} cannot be loaded: {err}", row.id.0);
                    continue;
                }
            };
            summaries.push(TournamentSummary {
                id: row.id,
                name: view.config.name,
                phase: view.phase,
                created_at_ms: row.created_at_ms,
                updated_at_ms: row.updated_at_ms,
                players: view.counts.unique,
                alive: view.counts.alive,
            });
        }
        Ok(summaries)
    }

    /// Creates a tournament with a new id.
    pub fn create(
        &self,
        input: NewTournamentInput,
        ctx: &Ctx,
    ) -> Result<TournamentId, EngineError> {
        let new = NewTournament {
            id: new_tournament_id(),
            config: input.config,
            structure: input.structure,
        };
        let agg = Aggregate::create(new, ctx)?;
        self.insert(agg, ctx.now_ms)
    }

    /// Stores a tournament built elsewhere (an import) and returns its id.
    pub fn insert(&self, agg: Aggregate, now_ms: i64) -> Result<TournamentId, EngineError> {
        let mut inner = self.lock();
        let id = agg.state().id.clone();
        inner.store.insert(&agg, now_ms)?;
        inner.loaded.insert(id.clone(), agg);
        Ok(id)
    }

    /// Deletes a tournament and its log.
    pub fn delete(&self, id: &str) -> Result<(), EngineError> {
        let mut inner = self.lock();
        if !inner.store.delete(id)? {
            return Err(EngineError::not_found(id));
        }
        inner.loaded.remove(&TournamentId(id.to_owned()));
        Ok(())
    }

    /// Fails with `NOT_FOUND` unless tournament `id` is stored.
    pub fn require(&self, id: &str) -> Result<TournamentId, EngineError> {
        let inner = self.lock();
        let key = TournamentId(id.to_owned());
        if inner.loaded.contains_key(&key) || inner.store.contains(id)? {
            Ok(key)
        } else {
            Err(EngineError::not_found(id))
        }
    }

    /// View of tournament `id` at `now_ms`.
    pub fn view(&self, id: &str, now_ms: i64) -> Result<View, EngineError> {
        Ok(self.lock().get(id)?.view(now_ms))
    }

    /// Runs a command on tournament `id` and returns the view after it. The outcome is
    /// written to the database before the new aggregate replaces the old one: on any
    /// failure, nothing changes.
    pub fn dispatch(&self, id: &str, cmd: Command, ctx: &Ctx) -> Result<View, EngineError> {
        let mut inner = self.lock();
        let mut next = inner.get(id)?.clone();
        let outcome = next.dispatch(cmd, ctx)?;
        inner.store.record(&next, &outcome, ctx.now_ms)?;
        let view = next.view(ctx.now_ms);
        inner.loaded.insert(next.state().id.clone(), next);
        Ok(view)
    }

    #[cfg(test)]
    pub(crate) fn with_store<T>(&self, f: impl FnOnce(&Store) -> T) -> T {
        f(&self.lock().store)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::HostFailure;
    use mtt_core::{Ante, Chips, DomainError, PlayerId};

    fn input() -> NewTournamentInput {
        NewTournamentInput {
            config: Config::new("Host test", 9, 2, 10_000),
            structure: vec![Level::Play {
                sb: Chips(25),
                bb: Chips(50),
                ante: Ante::None,
                duration_ms: 600_000,
            }],
        }
    }

    fn register(name: &str) -> Command {
        Command::Register {
            name: name.into(),
            seat: None,
        }
    }

    fn host(dir: &std::path::Path) -> Host {
        Host::new(Store::open(&dir.join("mtt.sqlite")).unwrap())
    }

    #[test]
    fn ids_are_uuids_the_core_accepts() {
        let id = new_tournament_id();
        assert_eq!(id.0.len(), 36);
        assert_eq!(id.0.chars().nth(14), Some('4'));
        assert_ne!(id, new_tournament_id());
    }

    #[test]
    fn a_failed_write_leaves_the_tournament_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let host = host(dir.path());
        let ctx = Ctx::new(1_000, 1);
        let id = host.create(input(), &ctx).unwrap();
        host.dispatch(&id.0, register("Alice"), &ctx).unwrap();
        let before = host.view(&id.0, 2_000).unwrap();

        host.with_store(|store| {
            store
                .connection()
                .execute_batch("PRAGMA query_only = ON")
                .unwrap()
        });
        let err = host.dispatch(&id.0, register("Bob"), &ctx).unwrap_err();
        assert!(
            matches!(err, EngineError::Host(HostFailure::HostError { .. })),
            "{err}"
        );
        assert_eq!(host.view(&id.0, 2_000).unwrap(), before);

        host.with_store(|store| {
            store
                .connection()
                .execute_batch("PRAGMA query_only = OFF")
                .unwrap()
        });
        let view = host.dispatch(&id.0, register("Bob"), &ctx).unwrap();
        assert_eq!(view.counts.unique, 2);
        let bob = view.ranking.iter().find(|row| row.name == "Bob").unwrap();
        assert_eq!(bob.player, PlayerId(2));
    }

    #[test]
    fn unknown_ids_are_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let host = host(dir.path());
        let ctx = Ctx::new(1_000, 1);
        let not_found = EngineError::not_found("nope");
        assert_eq!(host.view("nope", 0).unwrap_err(), not_found);
        assert_eq!(
            host.dispatch("nope", register("A"), &ctx).unwrap_err(),
            not_found
        );
        assert_eq!(host.delete("nope").unwrap_err(), not_found);
        assert_eq!(host.require("nope").unwrap_err(), not_found);
    }

    #[test]
    fn an_invalid_tournament_is_rejected_by_the_core() {
        let dir = tempfile::tempdir().unwrap();
        let host = host(dir.path());
        let mut bad = input();
        bad.structure.clear();
        assert_eq!(
            host.create(bad, &Ctx::new(0, 0)).unwrap_err(),
            EngineError::Domain(DomainError::StructureEmpty)
        );
        assert!(host.list(0).unwrap().is_empty());
    }
}
