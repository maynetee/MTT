//! Runs the JSON scenarios in `tests/scenarios/`.
//!
//! Format: `{name, seed, tournament: {id, config, structure}, steps: [{at_ms, cmd, expect?, view?}],
//! checks: [{now_ms, view}]}`. The tournament is created at `at_ms = 0`. `expect` is `"ok"`
//! (default) or `{"error": "CODE"}`. `view` is a partial match: objects match on the listed
//! keys, arrays element by element with the same length.

mod common;

use std::fs;
use std::path::Path;

use common::check_invariants;
use mtt_core::rng::mix_seed;
use mtt_core::{Aggregate, Command, Ctx, NewTournament};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Scenario {
    name: String,
    seed: u64,
    tournament: NewTournament,
    steps: Vec<Step>,
    #[serde(default)]
    checks: Vec<Check>,
}

#[derive(Deserialize)]
struct Step {
    at_ms: i64,
    cmd: Command,
    #[serde(default)]
    expect: Option<Expect>,
    #[serde(default)]
    view: Option<Value>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Expect {
    Ok(String),
    Error { error: String },
}

#[derive(Deserialize)]
struct Check {
    now_ms: i64,
    view: Value,
}

fn partial_match(expected: &Value, actual: &Value, path: &str) -> Result<(), String> {
    match (expected, actual) {
        (Value::Object(exp), Value::Object(act)) => {
            for (key, value) in exp {
                let found = act
                    .get(key)
                    .ok_or_else(|| format!("{path}.{key}: missing"))?;
                partial_match(value, found, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        (Value::Array(exp), Value::Array(act)) => {
            if exp.len() != act.len() {
                return Err(format!(
                    "{path}: expected {} items, got {}: {act:?}",
                    exp.len(),
                    act.len()
                ));
            }
            for (i, (e, a)) in exp.iter().zip(act).enumerate() {
                partial_match(e, a, &format!("{path}[{i}]"))?;
            }
            Ok(())
        }
        _ if expected == actual => Ok(()),
        _ => Err(format!("{path}: expected {expected}, got {actual}")),
    }
}

fn run(scenario: Scenario) {
    let name = scenario.name;
    let mut agg = Aggregate::create(scenario.tournament, &Ctx::new(0, scenario.seed))
        .unwrap_or_else(|e| panic!("{name}: invalid tournament: {e}"));
    for (i, step) in scenario.steps.into_iter().enumerate() {
        let ctx = Ctx::new(step.at_ms, mix_seed(scenario.seed ^ i as u64));
        let label = format!("{name} step {i} ({:?})", step.cmd);
        let result = agg.dispatch(step.cmd, &ctx);
        match (step.expect, result) {
            (None, Ok(_)) => {}
            (Some(Expect::Ok(s)), Ok(_)) if s == "ok" => {}
            (Some(Expect::Error { error }), Err(err)) => {
                assert_eq!(err.code(), error, "{label}: wrong error {err}");
            }
            (_, Ok(outcome)) => panic!("{label}: expected an error, got {outcome:?}"),
            (_, Err(err)) => panic!("{label}: rejected with {err}"),
        }
        let view = agg.view(step.at_ms);
        check_invariants(agg.state(), &view);
        if let Some(expected) = step.view {
            let actual = serde_json::to_value(&view).unwrap();
            if let Err(msg) = partial_match(&expected, &actual, "view") {
                panic!("{label}: {msg}");
            }
        }
    }
    for check in scenario.checks {
        let actual = serde_json::to_value(agg.view(check.now_ms)).unwrap();
        if let Err(msg) = partial_match(&check.view, &actual, "view") {
            panic!("{name} check at {}: {msg}", check.now_ms);
        }
    }
    let reloaded = Aggregate::from_json(&agg.to_json().unwrap()).unwrap();
    assert_eq!(reloaded, agg, "{name}: replay differs");
}

#[test]
fn json_scenarios() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/scenarios");
    let mut files: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no scenario in {dir:?}");
    for file in files {
        let text = fs::read_to_string(&file).unwrap();
        let scenario: Scenario =
            serde_json::from_str(&text).unwrap_or_else(|e| panic!("{file:?}: {e}"));
        run(scenario);
    }
}
