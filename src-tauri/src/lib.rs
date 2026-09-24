//! Desktop host of MTT Tournament Director: runs mtt-core behind Tauri commands and keeps
//! each tournament as an event log in SQLite.

mod commands;
mod error;
mod host;
mod legacy;
mod store;

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use error::EngineError;
use host::Host;
use legacy::{LEGACY_DB_ENV, LEGACY_IDENTIFIER, LegacySource};
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
            commands::quote_deal,
            commands::open_display_window,
            commands::save_export,
            commands::legacy_import_status,
            commands::import_legacy
        ])
}

/// Environment variable that overrides the data directory, the one holding `mtt.sqlite`.
///
/// For development and tests only, so that they run against a throwaway directory instead
/// of the real tournament data, e.g. `MTT_DATA_DIR=/tmp/mtt-dev npm run tauri dev`. When it
/// is unset or empty, or in a release build, the platform's app data directory is used (on
/// macOS, `~/Library/Application Support/com.maynetee.mtt`).
const DATA_DIR_ENV: &str = "MTT_DATA_DIR";

/// Name of the database file in the data directory (the previous version used the same).
const DB_FILE: &str = "mtt.sqlite";

/// Whether this build honours the development overrides (`MTT_DATA_DIR`, `MTT_LEGACY_DB`):
/// debug builds and end-to-end test builds do. A release build always reads and writes the
/// real data, whatever environment it was started from.
const DEV_OVERRIDES: bool = cfg!(any(debug_assertions, feature = "e2e"));

/// The path an override variable names, when overrides are `honoured` and it is set and not
/// empty. `lookup` reads the environment.
fn override_path(
    name: &str,
    honoured: bool,
    lookup: impl FnOnce(&str) -> Option<OsString>,
) -> Option<PathBuf> {
    if !honoured {
        return None;
    }
    lookup(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn env_path(name: &str) -> Option<PathBuf> {
    override_path(name, DEV_OVERRIDES, |name| std::env::var_os(name))
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, EngineError> {
    match env_path(DATA_DIR_ENV) {
        Some(dir) => Ok(dir),
        None => Ok(app.path().app_data_dir()?),
    }
}

/// The previous version's database: `MTT_LEGACY_DB` when set (development and test builds
/// only), else `mtt.sqlite` in the data directory of its identifier, next to ours (on macOS,
/// `~/Library/Application Support/com.mtt.app/mtt.sqlite`).
fn legacy_db<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    env_path(LEGACY_DB_ENV).or_else(|| {
        let ours = app.path().app_data_dir().ok()?;
        Some(ours.parent()?.join(LEGACY_IDENTIFIER).join(DB_FILE))
    })
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

/// End-to-end test builds (`--features e2e`): an embedded WebDriver server, on the port in
/// `TAURI_WEBDRIVER_PORT`, lets WebdriverIO drive both windows (e2e/desktop). Its permission
/// is granted here rather than in `capabilities/`, which must stay valid without the plugin.
#[cfg(feature = "e2e")]
mod e2e {
    use tauri::ipc::CapabilityBuilder;
    use tauri::{Manager, Runtime};

    pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
        tauri_plugin_wdio_webdriver::init()
    }

    pub fn grant<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
        app.add_capability(
            CapabilityBuilder::new("e2e-webdriver")
                .windows(["main", "display"])
                .permission("wdio-webdriver:default"),
        )
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = with_handlers(tauri::Builder::default());
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(e2e::plugin());
    builder
        .setup(|app| {
            #[cfg(feature = "e2e")]
            e2e::grant(app)?;
            let host = open_host(&data_dir(app.handle())?)?;
            app.manage(host);
            app.manage(LegacySource {
                path: legacy_db(app.handle()),
            });
            Ok(())
        })
        .run(context())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests;
