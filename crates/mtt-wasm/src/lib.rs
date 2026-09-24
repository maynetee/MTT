//! Browser host of `mtt-core`, built with wasm-bindgen (`--target web`).
//!
//! Every value crosses the boundary as a JSON string, with the same serde as the Tauri IPC,
//! so the browser and the desktop app see identical shapes. Errors are `EngineError` JSON
//! strings: the core's `DomainError`, or `HOST_ERROR` when the host cannot read its input
//! (malformed JSON, invalid seed or time, unreadable saved log).
//!
//! The host supplies time and randomness: `now_ms` is the browser's wall clock and `seed` a
//! fresh random `u64` per command, passed as a decimal string because a JS number cannot
//! hold 64 bits. Nothing here reads a clock or an entropy source.

use mtt_core::{Aggregate, Command, Config, Ctx, Level, NewTournament, TournamentId};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// Largest integer a JS number holds exactly.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// `NewTournament` without its id, which the host assigns.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewTournamentInput {
    config: Config,
    structure: Vec<Level>,
}

fn host_error(message: impl Into<String>) -> String {
    serde_json::json!({ "code": "HOST_ERROR", "params": { "message": message.into() } }).to_string()
}

fn domain_error(err: &mtt_core::DomainError) -> String {
    serde_json::to_string(err).unwrap_or_else(|e| host_error(e.to_string()))
}

fn parse_now(now_ms: f64) -> Result<i64, String> {
    if now_ms.is_finite() && now_ms.abs() <= MAX_SAFE_INTEGER {
        Ok(now_ms as i64)
    } else {
        Err(host_error(format!("invalid time: {now_ms}")))
    }
}

fn parse_seed(seed: &str) -> Result<u64, String> {
    seed.parse::<u64>()
        .map_err(|_| host_error(format!("invalid seed: {seed:?}")))
}

fn ctx(now_ms: f64, seed: &str) -> Result<Ctx, String> {
    Ok(Ctx::new(parse_now(now_ms)?, parse_seed(seed)?))
}

fn create(id: &str, input_json: &str, now_ms: f64, seed: &str) -> Result<Aggregate, String> {
    let input: NewTournamentInput =
        serde_json::from_str(input_json).map_err(|e| host_error(e.to_string()))?;
    let new = NewTournament {
        id: TournamentId(id.to_owned()),
        config: input.config,
        structure: input.structure,
    };
    Aggregate::create(new, &ctx(now_ms, seed)?).map_err(|e| domain_error(&e))
}

fn load(saved_json: &str) -> Result<Aggregate, String> {
    Aggregate::from_json(saved_json).map_err(|e| host_error(e.to_string()))
}

fn dispatch(
    agg: &mut Aggregate,
    command_json: &str,
    now_ms: f64,
    seed: &str,
) -> Result<String, String> {
    let command: Command =
        serde_json::from_str(command_json).map_err(|e| host_error(e.to_string()))?;
    let ctx = ctx(now_ms, seed)?;
    let outcome = agg.dispatch(command, &ctx).map_err(|e| domain_error(&e))?;
    serde_json::to_string(&outcome).map_err(|e| host_error(e.to_string()))
}

fn view(agg: &Aggregate, now_ms: f64) -> String {
    // A time outside the safe range saturates instead of failing: a view never mutates.
    serde_json::to_string(&agg.view(now_ms as i64)).unwrap_or_else(|e| host_error(e.to_string()))
}

fn saved(agg: &Aggregate) -> String {
    agg.to_json().unwrap_or_else(|e| host_error(e.to_string()))
}

/// One tournament: the core aggregate with its event log and undo cursor.
#[wasm_bindgen]
pub struct WasmTournament {
    agg: Aggregate,
}

#[wasm_bindgen]
impl WasmTournament {
    /// Creates a tournament from a `NewTournamentInput` JSON (config and structure).
    pub fn create(
        id: &str,
        input_json: &str,
        now_ms: f64,
        seed: &str,
    ) -> Result<WasmTournament, JsValue> {
        create(id, input_json, now_ms, seed)
            .map(|agg| Self { agg })
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Rebuilds a tournament from a `SavedLog` JSON written by [`WasmTournament::to_saved`].
    pub fn from_saved(saved_json: &str) -> Result<WasmTournament, JsValue> {
        load(saved_json)
            .map(|agg| Self { agg })
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Runs a `Command` JSON and returns the `Outcome` JSON. On error nothing changes.
    pub fn dispatch(
        &mut self,
        command_json: &str,
        now_ms: f64,
        seed: &str,
    ) -> Result<String, JsValue> {
        dispatch(&mut self.agg, command_json, now_ms, seed).map_err(|e| JsValue::from_str(&e))
    }

    /// `View` JSON at `now_ms`, with the undo/redo labels.
    pub fn view(&self, now_ms: f64) -> String {
        view(&self.agg, now_ms)
    }

    /// `SavedLog` JSON: every event plus the undo cursor.
    pub fn to_saved(&self) -> String {
        saved(&self.agg)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const T0: f64 = 1_700_000_000_000.0;

    fn input() -> String {
        json!({
            "config": {
                "name": "Friday",
                "seatsPerTable": 9,
                "maxTables": 2,
                "startingStack": 10000,
                "placesPaid": 2
            },
            "structure": [
                { "type": "play", "sb": 25, "bb": 50, "durationMs": 1_200_000 },
                { "type": "break", "durationMs": 600_000 },
                { "type": "play", "sb": 50, "bb": 100, "durationMs": 1_200_000 }
            ]
        })
        .to_string()
    }

    fn parse(json: &str) -> Value {
        serde_json::from_str(json).expect("valid JSON")
    }

    fn register(agg: &mut Aggregate, name: &str, seed: &str) -> Value {
        let cmd = json!({ "type": "register", "name": name }).to_string();
        parse(&dispatch(agg, &cmd, T0 + 1000.0, seed).expect("registered"))
    }

    #[test]
    fn creates_dispatches_and_renders_camel_case_json() {
        let mut agg = create("t-1", &input(), T0, "42").expect("created");
        let outcome = register(&mut agg, "Alice", "18446744073709551615");
        assert_eq!(outcome["type"], "recorded");
        assert_eq!(outcome["envelope"]["seq"], 2);

        let view = parse(&view(&agg, T0 + 2000.0));
        assert_eq!(view["id"], "t-1");
        assert_eq!(view["generatedAtMs"], 1_700_000_002_000_i64);
        assert_eq!(view["counts"]["unique"], 1);
        assert_eq!(view["history"]["undo"]["kind"], "player_registered");
        assert_eq!(view["history"]["undo"]["names"], json!(["Alice"]));
    }

    #[test]
    fn domain_errors_keep_their_code_and_params() {
        let mut agg = create("t-1", &input(), T0, "1").expect("created");
        register(&mut agg, "Alice", "2");
        let cmd = json!({ "type": "register", "name": "alice" }).to_string();
        let err = parse(&dispatch(&mut agg, &cmd, T0, "3").unwrap_err());
        assert_eq!(
            err,
            json!({ "code": "NAME_TAKEN", "params": { "player": 1 } })
        );

        let err = parse(&dispatch(&mut agg, r#"{"type":"redo"}"#, T0, "4").unwrap_err());
        assert_eq!(err, json!({ "code": "NOTHING_TO_REDO" }));
    }

    #[test]
    fn invalid_creation_is_a_domain_error() {
        let bad = input().replace("\"sb\":25", "\"sb\":0");
        let err = parse(&create("t-1", &bad, T0, "1").unwrap_err());
        assert_eq!(
            err,
            json!({ "code": "INVALID_BLINDS", "params": { "index": 0 } })
        );
    }

    #[test]
    fn unreadable_input_is_a_host_error() {
        let host = |raw: String| parse(&raw)["code"].as_str().map(str::to_owned);
        assert_eq!(
            host(create("t-1", "{", T0, "1").unwrap_err()).as_deref(),
            Some("HOST_ERROR")
        );
        assert_eq!(
            host(create("t-1", &input(), T0, "-1").unwrap_err()).as_deref(),
            Some("HOST_ERROR")
        );
        assert_eq!(
            host(create("t-1", &input(), T0, "18446744073709551616").unwrap_err()).as_deref(),
            Some("HOST_ERROR")
        );
        assert_eq!(
            host(create("t-1", &input(), f64::NAN, "1").unwrap_err()).as_deref(),
            Some("HOST_ERROR")
        );

        let mut agg = create("t-1", &input(), T0, "1").expect("created");
        let before = saved(&agg);
        assert_eq!(
            host(dispatch(&mut agg, r#"{"type":"fly"}"#, T0, "1").unwrap_err()).as_deref(),
            Some("HOST_ERROR")
        );
        assert_eq!(saved(&agg), before, "a rejected command changes nothing");
        assert_eq!(
            host(load("not json").unwrap_err()).as_deref(),
            Some("HOST_ERROR")
        );
    }

    #[test]
    fn saved_log_round_trips_with_the_undo_cursor() {
        let mut agg = create("t-1", &input(), T0, "1").expect("created");
        register(&mut agg, "Alice", "2");
        register(&mut agg, "Bob", "3");
        dispatch(&mut agg, r#"{"type":"undo"}"#, T0, "4").expect("undone");

        let json = saved(&agg);
        assert_eq!(parse(&json)["head"], 2);
        let reloaded = load(&json).expect("reloaded");
        assert_eq!(reloaded, agg);
        assert_eq!(view(&reloaded, T0), view(&agg, T0));
    }
}
