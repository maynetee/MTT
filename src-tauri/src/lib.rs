mod commands;

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use commands::AppState;

/// Registers the plugins and the commands. Shared by `run` and the IPC tests, so that the
/// tests go through the same invoke handler as the app.
fn with_handlers<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::create_tournament,
            commands::reset_tournament,
            commands::register_player,
            commands::register_player_at_seat,
            commands::eliminate_player,
            commands::revive_player_at_seat,
            commands::move_player,
            commands::balance_suggestions,
            commands::close_table,
            commands::clock_start,
            commands::clock_pause,
            commands::clock_next,
            commands::clock_prev,
            commands::clock_adjust,
            commands::clock_trigger_break,
            commands::update_itm,
            commands::undo_last_event,
            commands::open_display_window,
            commands::save_export
        ])
}

/// Environment variable that overrides the data directory, the one holding `mtt.sqlite`.
///
/// Meant for development and tests, so that they run against a throwaway directory instead
/// of the real tournament data, e.g. `MTT_DATA_DIR=/tmp/mtt-dev npm run tauri dev`. When it
/// is unset or empty, the platform's app data directory is used (on macOS,
/// `~/Library/Application Support/com.maynetee.mtt`).
const DATA_DIR_ENV: &str = "MTT_DATA_DIR";

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    match std::env::var_os(DATA_DIR_ENV) {
        Some(dir) if !dir.is_empty() => Ok(PathBuf::from(dir)),
        _ => app.path().app_data_dir().map_err(|err| err.to_string()),
    }
}

/// Creates the data directory and the database if needed, and brings the schema up to date.
fn open_database(data_dir: &Path) -> Result<AppState, String> {
    std::fs::create_dir_all(data_dir).map_err(|err| err.to_string())?;
    let db_path = data_dir.join("mtt.sqlite");
    let conn = commands::open_connection(&db_path)?;
    commands::migrate(&conn)?;
    Ok(AppState { db_path })
}

/// The configuration, capabilities and assets. Expanded once: the macro defines symbols
/// that cannot appear twice in the crate.
fn context<R: Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    with_handlers(tauri::Builder::default())
        .setup(|app| {
            let state = open_database(&data_dir(app.handle())?)?;
            commands::start_clock_thread(app.handle().clone(), state.db_path.clone());
            app.manage(state);
            Ok(())
        })
        .run(context())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use tauri::http::HeaderMap;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::{App, WebviewWindow, WebviewWindowBuilder};

    /// The app with its real configuration and capabilities, on the mock runtime.
    fn mock_app(data_dir: &Path) -> App<MockRuntime> {
        with_handlers(mock_builder())
            .manage(open_database(data_dir).expect("failed to open the database"))
            .build(context())
            .expect("failed to build the app")
    }

    fn main_window(app: &App<MockRuntime>) -> WebviewWindow<MockRuntime> {
        WebviewWindowBuilder::new(app, "main", Default::default())
            .build()
            .expect("failed to create the main window")
    }

    fn invoke(
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

    #[test]
    fn get_state_returns_an_empty_state_for_a_new_data_dir() {
        let data_dir = tempfile::tempdir().unwrap();
        let app = mock_app(data_dir.path());

        let state = invoke(
            &main_window(&app),
            "get_state",
            InvokeBody::default(),
            HeaderMap::default(),
        );

        assert_eq!(
            state,
            Ok(json!({
                "tournament": null,
                "players": [],
                "tables": [],
                "seats": [],
                "levels": []
            }))
        );
        assert!(data_dir.path().join("mtt.sqlite").is_file());
    }

    #[test]
    fn save_export_rejects_a_json_body() {
        let data_dir = tempfile::tempdir().unwrap();
        let app = mock_app(data_dir.path());
        let mut headers = HeaderMap::new();
        headers.insert(
            commands::EXPORT_FILE_NAME_HEADER,
            "ranking.csv".parse().unwrap(),
        );

        let result = invoke(
            &main_window(&app),
            "save_export",
            InvokeBody::Json(json!({ "content": "Place,Player,Status" })),
            headers,
        );

        assert_eq!(
            result,
            Err(json!("The export content must be sent as raw bytes"))
        );
    }
}
