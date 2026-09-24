//! IPC tests: the real invoke handler, configuration and capabilities on the mock runtime,
//! with the database in a temporary directory.

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tauri::http::HeaderMap;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::*;
use crate::commands::{DISPLAY_WINDOW, EXPORT_FILE_NAME_HEADER, TOURNAMENT_CHANGED};

/// The app with its real configuration and capabilities, on the mock runtime. The
/// previous version's database is `legacy_db`: tests never look for the real one.
fn mock_app_with_legacy(data_dir: &Path, legacy_db: Option<&Path>) -> App<MockRuntime> {
    with_handlers(mock_builder())
        .manage(open_host(data_dir).expect("failed to open the database"))
        .manage(LegacySource {
            path: legacy_db.map(Path::to_path_buf),
        })
        .build(context())
        .expect("failed to build the app")
}

fn mock_app(data_dir: &Path) -> App<MockRuntime> {
    mock_app_with_legacy(data_dir, None)
}

fn window(app: &App<MockRuntime>, label: &str) -> WebviewWindow<MockRuntime> {
    WebviewWindowBuilder::new(app, label, Default::default())
        .build()
        .expect("failed to create the window")
}

fn main_window(app: &App<MockRuntime>) -> WebviewWindow<MockRuntime> {
    window(app, "main")
}

fn invoke_with(
    window: &WebviewWindow<MockRuntime>,
    cmd: &str,
    body: InvokeBody,
    headers: HeaderMap,
) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body,
        headers,
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(window, request).map(|body| body.deserialize::<Value>().unwrap())
}

fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    invoke_with(window, cmd, InvokeBody::Json(args), HeaderMap::default())
}

fn input(name: &str) -> Value {
    json!({
        "config": {
            "name": name,
            "seatsPerTable": 9,
            "maxTables": 2,
            "startingStack": 20000,
            "placesPaid": 2
        },
        "structure": [
            {"type": "play", "sb": 25, "bb": 50, "durationMs": 1_200_000},
            {"type": "break", "durationMs": 600_000},
            {"type": "play", "sb": 50, "bb": 100,
             "ante": {"type": "big_blind", "amount": 100}, "durationMs": 1_200_000}
        ]
    })
}

fn create(window: &WebviewWindow<MockRuntime>, name: &str) -> String {
    let id = invoke(window, "create_tournament", json!({ "input": input(name) }))
        .expect("create_tournament failed");
    id.as_str().expect("the id is a string").to_owned()
}

fn dispatch(window: &WebviewWindow<MockRuntime>, id: &str, command: Value) -> Result<Value, Value> {
    invoke(window, "dispatch", json!({ "id": id, "command": command }))
}

fn register(window: &WebviewWindow<MockRuntime>, id: &str, name: &str) -> Value {
    dispatch(window, id, json!({"type": "register", "name": name})).expect("register failed")
}

fn get_view(window: &WebviewWindow<MockRuntime>, id: &str) -> Result<Value, Value> {
    invoke(window, "get_view", json!({ "id": id }))
}

fn quote_deal(window: &WebviewWindow<MockRuntime>, request: Value) -> Result<Value, Value> {
    invoke(window, "quote_deal", json!({ "request": request }))
}

fn sum(amounts: &Value) -> i64 {
    amounts
        .as_array()
        .unwrap()
        .iter()
        .map(|amount| amount.as_i64().unwrap())
        .sum()
}

/// A view without the fields that depend on when it was computed.
fn timeless(mut view: Value) -> Value {
    view.as_object_mut().unwrap().remove("generatedAtMs");
    view
}

fn names(view: &Value) -> Vec<&str> {
    let mut names: Vec<&str> = view["ranking"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["name"].as_str().unwrap())
        .collect();
    names.sort_unstable();
    names
}

/// Number of stored events of tournament `id`, read straight from the database file.
fn stored_events(data_dir: &Path, id: &str) -> i64 {
    rusqlite::Connection::open(data_dir.join(DB_FILE))
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM events WHERE tournament_id = ?1",
            [id],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn a_tournament_is_created_listed_and_played_through_ipc() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    let changed = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&changed);
    app.listen_any(TOURNAMENT_CHANGED, move |event| {
        let payload: Value = serde_json::from_str(event.payload()).unwrap();
        seen.lock()
            .unwrap()
            .push(payload["id"].as_str().unwrap().to_owned());
    });

    assert_eq!(invoke(&main, "list_tournaments", json!({})), Ok(json!([])));
    let id = create(&main, "Sunday Deepstack");
    assert_eq!(id.len(), 36);

    let list = invoke(&main, "list_tournaments", json!({})).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["id"], json!(id));
    assert_eq!(list[0]["name"], "Sunday Deepstack");
    assert_eq!(list[0]["phase"], "setup");
    assert_eq!(
        (list[0]["players"].clone(), list[0]["alive"].clone()),
        (json!(0), json!(0))
    );
    assert!(list[0]["createdAtMs"].as_i64().unwrap() > 0);

    for name in ["Alice", "Bob", "Carol"] {
        register(&main, &id, name);
    }
    let view = dispatch(&main, &id, json!({"type": "start_clock"})).unwrap();
    assert_eq!(view["phase"], "running");
    assert_eq!(view["clock"]["running"], true);
    let view = dispatch(
        &main,
        &id,
        json!({"type": "bust_players", "busts": [{"player": 1}]}),
    )
    .unwrap();
    assert_eq!(view["counts"]["alive"], 2);

    let view = get_view(&main, &id).unwrap();
    assert_eq!(view["id"], json!(id));
    assert_eq!(view["counts"]["unique"], 3);
    assert_eq!(view["counts"]["busted"], 1);
    let alice = view["ranking"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == "Alice")
        .unwrap();
    assert_eq!(
        (alice["alive"].clone(), alice["place"].clone()),
        (json!(false), json!(3))
    );
    assert_eq!(view["history"]["undo"]["kind"], "players_busted");

    let list = invoke(&main, "list_tournaments", json!({})).unwrap();
    assert_eq!(list[0]["phase"], "running");
    assert_eq!(
        (list[0]["players"].clone(), list[0]["alive"].clone()),
        (json!(3), json!(2))
    );

    // One notification per change: the creation and five commands.
    assert_eq!(*changed.lock().unwrap(), vec![id; 6]);
}

#[test]
fn undo_and_redo_are_persisted_across_a_restart() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    let id = create(&main, "Undo");
    register(&main, &id, "Alice");
    register(&main, &id, "Bob");
    let undone = dispatch(&main, &id, json!({"type": "undo"})).unwrap();
    assert_eq!(names(&undone), ["Alice"]);
    assert_eq!(undone["history"]["redo"]["kind"], "player_registered");
    assert_eq!(undone["history"]["redo"]["names"], json!(["Bob"]));
    drop(main);
    drop(app);

    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    let reloaded = get_view(&main, &id).unwrap();
    assert_eq!(timeless(reloaded), timeless(undone));
    let redone = dispatch(&main, &id, json!({"type": "redo"})).unwrap();
    assert_eq!(names(&redone), ["Alice", "Bob"]);
    drop(main);
    drop(app);

    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    let reloaded = get_view(&main, &id).unwrap();
    assert_eq!(timeless(reloaded), timeless(redone));
    // Undo then a new command: the undone registration is gone for good.
    dispatch(&main, &id, json!({"type": "undo"})).unwrap();
    register(&main, &id, "Carol");
    assert_eq!(stored_events(data_dir.path(), &id), 3);
    drop(main);
    drop(app);

    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    assert_eq!(names(&get_view(&main, &id).unwrap()), ["Alice", "Carol"]);
    assert_eq!(
        dispatch(&main, &id, json!({"type": "redo"})),
        Err(json!({"code": "NOTHING_TO_REDO"}))
    );
}

#[test]
fn a_rejected_command_returns_the_domain_error_and_changes_nothing() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    let id = create(&main, "Rejections");
    register(&main, &id, "Alice");
    let before = get_view(&main, &id).unwrap();
    let stored = stored_events(data_dir.path(), &id);

    assert_eq!(
        dispatch(
            &main,
            &id,
            json!({"type": "bust_players", "busts": [{"player": 1}]})
        ),
        Err(json!({"code": "NOT_STARTED"}))
    );
    assert_eq!(
        dispatch(&main, &id, json!({"type": "register", "name": " ALICE "})),
        Err(json!({"code": "NAME_TAKEN", "params": {"player": 1}}))
    );
    assert_eq!(
        dispatch(&main, &id, json!({"type": "jump_to", "level": 9})),
        Err(json!({"code": "LEVEL_OUT_OF_RANGE", "params": {"level": 9, "max": 2}}))
    );
    let malformed = dispatch(&main, &id, json!({"type": "shuffle_up_and_deal"})).unwrap_err();
    assert_eq!(malformed["code"], "HOST_ERROR");
    let invalid = invoke(
        &main,
        "create_tournament",
        json!({"input": {"config": input("x")["config"], "structure": []}}),
    );
    assert_eq!(invalid, Err(json!({"code": "STRUCTURE_EMPTY"})));

    assert_eq!(stored_events(data_dir.path(), &id), stored);
    assert_eq!(timeless(get_view(&main, &id).unwrap()), timeless(before));
    assert_eq!(
        invoke(&main, "list_tournaments", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        get_view(&main, "missing"),
        Err(json!({"code": "NOT_FOUND", "params": {"id": "missing"}}))
    );
}

#[test]
fn deleting_a_tournament_deletes_its_log() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    let doomed = create(&main, "Doomed");
    let kept = create(&main, "Kept");
    register(&main, &doomed, "Alice");
    register(&main, &kept, "Bob");
    assert_eq!(stored_events(data_dir.path(), &doomed), 2);

    assert_eq!(
        invoke(&main, "delete_tournament", json!({ "id": doomed })),
        Ok(Value::Null)
    );
    assert_eq!(stored_events(data_dir.path(), &doomed), 0);
    let list = invoke(&main, "list_tournaments", json!({})).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["id"], json!(kept));
    let not_found = json!({"code": "NOT_FOUND", "params": {"id": doomed}});
    assert_eq!(get_view(&main, &doomed), Err(not_found.clone()));
    assert_eq!(
        invoke(&main, "delete_tournament", json!({ "id": doomed })),
        Err(not_found)
    );
    assert_eq!(names(&get_view(&main, &kept).unwrap()), ["Bob"]);
}

#[test]
fn the_display_window_can_read_tournaments_but_not_change_them() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let id = create(&main_window(&app), "Display");
    let display = window(&app, DISPLAY_WINDOW);

    let view = get_view(&display, &id);
    assert!(view.is_ok(), "get_view was refused: {view:?}");
    let list = invoke(&display, "list_tournaments", json!({}));
    assert!(list.is_ok(), "list_tournaments was refused: {list:?}");

    for (cmd, args) in [
        (
            "dispatch",
            json!({"id": id, "command": {"type": "start_clock"}}),
        ),
        (
            "quote_deal",
            json!({"request": {"stacks": [2, 1], "prizes": [60, 40]}}),
        ),
        ("create_tournament", json!({"input": input("Nope")})),
        ("delete_tournament", json!({"id": id})),
        ("open_display_window", json!({"id": id})),
        ("save_export", json!({})),
        ("legacy_import_status", json!({})),
        ("import_legacy", json!({})),
    ] {
        let denied = invoke(&display, cmd, args).expect_err(cmd);
        assert!(
            denied
                .as_str()
                .is_some_and(|message| message.contains("not allowed")),
            "{cmd}: {denied}"
        );
    }
    assert_eq!(stored_events(data_dir.path(), &id), 1);
}

/// The level sounds' event (src/app/sound/channel.ts): the windows agree on which one plays.
const SOUND_EVENT: &str = "level_sound_channel";

#[test]
fn both_windows_may_emit_the_level_sound_event() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let heard = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&heard);
    app.listen_any(SOUND_EVENT, move |event| {
        let payload: Value = serde_json::from_str(event.payload()).unwrap();
        seen.lock().unwrap().push(payload["sender"].clone());
    });

    for label in ["main", DISPLAY_WINDOW] {
        let emitted = invoke(
            &window(&app, label),
            "plugin:event|emit",
            json!({
                "event": SOUND_EVENT,
                "payload": {"sender": label, "message": {"type": "query"}}
            }),
        );
        assert!(emitted.is_ok(), "{label} may not emit: {emitted:?}");
    }
    assert_eq!(
        *heard.lock().unwrap(),
        vec![json!("main"), json!("display")]
    );
}

#[test]
fn the_director_window_can_toggle_its_own_full_screen() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let main = main_window(&app);

    for (cmd, args) in [
        ("plugin:window|is_fullscreen", json!({"label": "main"})),
        (
            "plugin:window|set_fullscreen",
            json!({"label": "main", "value": true}),
        ),
    ] {
        let result = invoke(&main, cmd, args);
        assert!(result.is_ok(), "{cmd} was refused: {result:?}");
    }
}

#[test]
fn a_deal_quote_adds_up_exactly_to_the_prizes() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let main = main_window(&app);

    // Malmuth-Harville by hand, 5000/3000/2000 chips for 500/300/200.00: A finishes first
    // 1/2, second 3/10 * 5/7 + 1/5 * 5/8 = 19/56, third 9/56, so 250 + 300 * 19/56 +
    // 200 * 9/56 = 383.93; B 150 + 300 * 3/8 + 200 * 13/40 = 327.50; C 288.57. Chip chop:
    // 200.00 each, the other 400.00 by chips.
    let quote = quote_deal(
        &main,
        json!({"stacks": [5000, 3000, 2000], "prizes": [50000, 30000, 20000]}),
    );
    assert_eq!(
        quote,
        Ok(json!({
            "icm": [38393, 32750, 28857],
            "chipChop": [40000, 32000, 28000],
            "playFor": 0
        }))
    );

    // Uneven amounts and money kept to play for: every minor unit is still handed out.
    let quote = quote_deal(
        &main,
        json!({"stacks": [7001, 5003, 2999, 0], "prizes": [100_003, 60_001, 39_997], "playFor": 1_001}),
    )
    .unwrap();
    assert_eq!(quote["playFor"], 1_001);
    assert_eq!(sum(&quote["icm"]) + 1_001, 200_001);
    assert_eq!(sum(&quote["chipChop"]) + 1_001, 200_001);
    assert_eq!(quote["icm"][3], 0, "no chips, fourth place pays nothing");
    assert_eq!(invoke(&main, "list_tournaments", json!({})), Ok(json!([])));
}

#[test]
fn an_invalid_deal_returns_the_domain_error() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    let invalid = Err(json!({"code": "INVALID_ICM_INPUT"}));

    assert_eq!(
        quote_deal(&main, json!({"stacks": [100], "prizes": [60, 40]})),
        invalid
    );
    assert_eq!(
        quote_deal(&main, json!({"stacks": [100, -1], "prizes": [60, 40]})),
        invalid
    );
    assert_eq!(
        quote_deal(
            &main,
            json!({"stacks": [100, 50], "prizes": [60, 40], "playFor": 61})
        ),
        invalid
    );
    assert_eq!(
        quote_deal(&main, json!({"stacks": vec![1; 21], "prizes": [100]})),
        Err(json!({"code": "ICM_TOO_MANY_PLAYERS", "params": {"max": 20}}))
    );
    let malformed = quote_deal(&main, json!({"stacks": "lots"})).unwrap_err();
    assert_eq!(malformed["code"], "HOST_ERROR");
}

#[test]
fn save_export_rejects_a_json_body() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let mut headers = HeaderMap::new();
    headers.insert(EXPORT_FILE_NAME_HEADER, "ranking.csv".parse().unwrap());

    let result = invoke_with(
        &main_window(&app),
        "save_export",
        InvokeBody::Json(json!({ "content": "Place,Player,Status" })),
        headers,
    );

    assert_eq!(
        result,
        Err(json!({
            "code": "HOST_ERROR",
            "params": {"message": "The export content must be sent as raw bytes"}
        }))
    );
}

// Only the path where the display is already open: the mock runtime has no monitors.
#[test]
fn open_display_window_points_the_open_display_at_the_tournament() {
    let data_dir = tempfile::tempdir().unwrap();
    let app = mock_app(data_dir.path());
    let main = main_window(&app);
    let first = create(&main, "First");
    let second = create(&main, "Second");
    let display = WebviewWindowBuilder::new(
        &app,
        DISPLAY_WINDOW,
        WebviewUrl::App(format!("index.html#/display/{first}").into()),
    )
    .build()
    .unwrap();

    let result = invoke(&main, "open_display_window", json!({ "id": second }));

    assert_eq!(result, Ok(Value::Null));
    assert_eq!(app.webview_windows().len(), 2);
    let url = display.url().unwrap();
    assert_eq!(url.fragment(), Some(format!("/display/{second}").as_str()));
    assert_eq!(
        invoke(&main, "open_display_window", json!({ "id": "missing" })),
        Err(json!({"code": "NOT_FOUND", "params": {"id": "missing"}}))
    );
}

#[test]
fn a_new_data_dir_gets_the_event_log_schema() {
    let data_dir = tempfile::tempdir().unwrap();
    let nested = data_dir.path().join("nested");
    let app = mock_app(&nested);
    assert_eq!(
        invoke(&main_window(&app), "list_tournaments", json!({})),
        Ok(json!([]))
    );
    let version: i64 = rusqlite::Connection::open(nested.join(DB_FILE))
        .unwrap()
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(version, 2);
}

#[test]
fn the_previous_version_tournament_is_imported_without_touching_its_database() {
    let data_dir = tempfile::tempdir().unwrap();
    let legacy_dir = tempfile::tempdir().unwrap();
    let legacy_db = legacy_dir.path().join(DB_FILE);
    crate::legacy::tests::write_fixture(&legacy_db);
    let original = std::fs::read(&legacy_db).unwrap();
    let app = mock_app_with_legacy(data_dir.path(), Some(&legacy_db));
    let main = main_window(&app);
    let changed = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&changed);
    app.listen_any(TOURNAMENT_CHANGED, move |event| {
        seen.lock().unwrap().push(event.payload().to_owned());
    });

    assert_eq!(
        invoke(&main, "legacy_import_status", json!({})),
        Ok(json!({"available": true}))
    );
    let id = invoke(&main, "import_legacy", json!({})).unwrap();
    let id = id.as_str().unwrap();

    let view = get_view(&main, id).unwrap();
    assert_eq!(view["config"]["name"], "Friday Freezeout");
    assert_eq!(view["phase"], "running");
    assert_eq!(view["counts"]["unique"], 8);
    assert_eq!(view["counts"]["alive"], 5);
    assert_eq!(view["placesPaid"], 3);
    assert_eq!(
        view["config"]["lateReg"],
        json!({"type": "end_of_play_level", "n": 3, "throughBreak": false})
    );
    assert_eq!(view["clock"]["levelIndex"], 4);
    assert_eq!(view["clock"]["remainingMs"], 250_000);
    let list = invoke(&main, "list_tournaments", json!({})).unwrap();
    assert_eq!(list[0]["id"], json!(id));
    assert_eq!(
        *changed.lock().unwrap(),
        vec![json!({ "id": id }).to_string()]
    );

    // Imported again after a restart: the log was stored, and the old file never changed.
    drop(main);
    drop(app);
    let app = mock_app_with_legacy(data_dir.path(), Some(&legacy_db));
    let reloaded = get_view(&main_window(&app), id).unwrap();
    assert_eq!(timeless(reloaded), timeless(view));
    assert_eq!(std::fs::read(&legacy_db).unwrap(), original);
    let files: Vec<_> = std::fs::read_dir(legacy_dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(files, [DB_FILE]);
}

#[test]
fn nothing_is_imported_without_a_previous_database() {
    let data_dir = tempfile::tempdir().unwrap();
    let missing = data_dir.path().join("missing").join(DB_FILE);
    for legacy_db in [None, Some(missing.as_path())] {
        let app = mock_app_with_legacy(data_dir.path(), legacy_db);
        let main = main_window(&app);
        assert_eq!(
            invoke(&main, "legacy_import_status", json!({})),
            Ok(json!({"available": false}))
        );
        let err = invoke(&main, "import_legacy", json!({})).unwrap_err();
        assert_eq!(err["code"], "HOST_ERROR");
        assert_eq!(invoke(&main, "list_tournaments", json!({})), Ok(json!([])));
    }
    assert!(!missing.exists());
}

#[test]
fn release_builds_ignore_the_development_overrides() {
    let set = |_: &str| Some(OsString::from("/tmp/mtt-elsewhere"));
    assert_eq!(override_path(DATA_DIR_ENV, false, set), None);
    assert_eq!(override_path(LEGACY_DB_ENV, false, set), None);
}

#[test]
fn development_and_test_builds_honour_the_overrides_when_set() {
    let set = |_: &str| Some(OsString::from("/tmp/mtt-elsewhere"));
    assert_eq!(
        override_path(DATA_DIR_ENV, true, set),
        Some(PathBuf::from("/tmp/mtt-elsewhere"))
    );
    assert_eq!(
        override_path(DATA_DIR_ENV, true, |_| Some(OsString::new())),
        None
    );
    assert_eq!(override_path(DATA_DIR_ENV, true, |_| None), None);
    // The variable read is the one named.
    let named = override_path(LEGACY_DB_ENV, true, |name| Some(OsString::from(name)));
    assert_eq!(named, Some(PathBuf::from("MTT_LEGACY_DB")));
}

#[test]
fn only_debug_and_end_to_end_builds_honour_the_overrides() {
    assert_eq!(
        DEV_OVERRIDES,
        cfg!(debug_assertions) || cfg!(feature = "e2e")
    );
}
