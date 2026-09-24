//! Desktop host of MTT Tournament Director: runs mtt-core behind Tauri commands and keeps
//! each tournament as an event log in SQLite.

mod commands;
mod error;
mod host;
mod store;

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use error::EngineError;
use host::Host;
use store::Store;

/// Registers the plugins and the commands. Shared by `run` and the IPC tests, so that the
/// tests go through the same invoke handler as the app.
fn with_handlers<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_tournaments,
            commands::create_tournament,
            commands::delete_tournament,
            commands::get_view,
            commands::dispatch,
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

/// Name of the database file in the data directory.
const DB_FILE: &str = "mtt.sqlite";

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, EngineError> {
    match env_path(DATA_DIR_ENV) {
        Some(dir) => Ok(dir),
        None => Ok(app.path().app_data_dir()?),
    }
}

/// Creates the data directory and the database if needed, and brings the schema up to date.
fn open_host(data_dir: &Path) -> Result<Host, EngineError> {
    std::fs::create_dir_all(data_dir)?;
    Ok(Host::new(Store::open(&data_dir.join(DB_FILE))?))
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
            let host = open_host(&data_dir(app.handle())?)?;
            app.manage(host);
            Ok(())
        })
        .run(context())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests;
