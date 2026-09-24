//! Tauri commands: thin wrappers around [`Host`]. Arguments and results are the core's JSON
//! shapes; every error is an [`EngineError`] object.

use std::path::Path;

use mtt_core::{Command, TournamentId, View};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tauri::http::HeaderMap;
use tauri::ipc::{InvokeBody, Request};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, Runtime, State, WebviewUrl, WebviewWindowBuilder, Window,
};
use tauri_plugin_dialog::DialogExt;

use crate::error::EngineError;
use crate::host::{self, Host, NewTournamentInput, TournamentSummary};
use crate::legacy::{self, LegacySource, LegacyStatus};

type CmdResult<T> = Result<T, EngineError>;

/// Event emitted after every change to a tournament, so that every window refetches it.
pub const TOURNAMENT_CHANGED: &str = "tournament_changed";

/// Payload of [`TOURNAMENT_CHANGED`].
#[derive(Debug, Clone, Serialize)]
pub struct TournamentChanged {
    pub id: TournamentId,
}

pub(crate) fn notify_changed<R: Runtime>(app: &AppHandle<R>, id: &TournamentId) {
    let payload = TournamentChanged { id: id.clone() };
    if let Err(err) = app.emit(TOURNAMENT_CHANGED, payload) {
        eprintln!("cannot emit {TOURNAMENT_CHANGED}: {err}");
    }
}

#[tauri::command]
pub fn list_tournaments(host: State<'_, Host>) -> CmdResult<Vec<TournamentSummary>> {
    host.list(host::now_ms())
}

/// Reads a JSON argument, so that a malformed one is reported as an [`EngineError`] too.
fn parse<T: DeserializeOwned>(what: &str, value: serde_json::Value) -> CmdResult<T> {
    serde_json::from_value(value).map_err(|err| EngineError::host(format!("invalid {what}: {err}")))
}

/// Creates a tournament from a `NewTournamentInput` and returns its id.
#[tauri::command]
pub fn create_tournament<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, Host>,
    input: serde_json::Value,
) -> CmdResult<TournamentId> {
    let input: NewTournamentInput = parse("tournament", input)?;
    let id = host.create(input, &host::fresh_ctx()?)?;
    notify_changed(&app, &id);
    Ok(id)
}

#[tauri::command]
pub fn delete_tournament<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, Host>,
    id: String,
) -> CmdResult<()> {
    host.delete(&id)?;
    notify_changed(&app, &TournamentId(id));
    Ok(())
}

#[tauri::command]
pub fn get_view(host: State<'_, Host>, id: String) -> CmdResult<View> {
    host.view(&id, host::now_ms())
}

/// Runs a core `Command`, undo and redo included, and returns the view after it.
#[tauri::command]
pub fn dispatch<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, Host>,
    id: String,
    command: serde_json::Value,
) -> CmdResult<View> {
    let command: Command = parse("command", command)?;
    let view = host.dispatch(&id, command, &host::fresh_ctx()?)?;
    notify_changed(&app, &view.id);
    Ok(view)
}

/// Whether the previous version left a tournament to import.
#[tauri::command]
pub fn legacy_import_status(source: State<'_, LegacySource>) -> CmdResult<LegacyStatus> {
    Ok(LegacyStatus {
        available: source.path.as_deref().is_some_and(legacy::available),
    })
}

/// Imports the latest tournament of the previous version as a new tournament. The old
/// database is only read.
#[tauri::command]
pub fn import_legacy<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, Host>,
    source: State<'_, LegacySource>,
) -> CmdResult<TournamentId> {
    let v1 = match source.path.as_deref() {
        Some(path) => legacy::read(path)?,
        None => None,
    }
    .ok_or_else(|| EngineError::host("No tournament from the previous version to import"))?;
    let agg = legacy::rebuild(&v1, host::new_tournament_id(), host::fresh_ctx)?;
    let id = host.insert(agg, host::now_ms())?;
    notify_changed(&app, &id);
    Ok(id)
}

pub(crate) const DISPLAY_WINDOW: &str = "display";

/// Opens the public display of tournament `id` fullscreen, on a secondary monitor when
/// there is one, or brings the open display to the front and points it at `id`.
///
/// Async because creating a window from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn open_display_window<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, Host>,
    id: String,
) -> CmdResult<()> {
    let id = host.require(&id)?;
    let route = format!("/display/{}", id.0);
    if let Some(window) = app.get_webview_window(DISPLAY_WINDOW) {
        let mut url = window.url()?;
        if url.fragment() != Some(route.as_str()) {
            url.set_fragment(Some(&route));
            window.navigate(url)?;
        }
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        DISPLAY_WINDOW,
        WebviewUrl::App(format!("index.html#{route}").into()),
    )
    .title("MTT Display")
    .visible(false);
    if let Some(monitor) = secondary_monitor(&app)? {
        // The builder takes logical coordinates, the monitor reports physical ones.
        let scale_factor = monitor.scale_factor();
        let position = monitor.position().to_logical::<f64>(scale_factor);
        let size = monitor.size().to_logical::<f64>(scale_factor);
        builder = builder
            .position(position.x, position.y)
            .inner_size(size.width, size.height);
    }
    let window = builder.build()?;
    // On macOS, simple fullscreen covers the monitor the window is on without moving it to a
    // new Space; other platforms fall back to regular fullscreen.
    window.set_simple_fullscreen(true)?;
    window.show()?;
    Ok(())
}

/// A monitor other than the primary one, if there is one.
fn secondary_monitor<R: Runtime>(app: &AppHandle<R>) -> CmdResult<Option<Monitor>> {
    let Some(primary) = app.primary_monitor()? else {
        return Ok(None);
    };
    let monitors = app.available_monitors()?;
    Ok(monitors
        .into_iter()
        .find(|monitor| monitor.position() != primary.position()))
}

/// Request header carrying the suggested file name of an export. URL-encoded, because
/// header values are limited to visible ASCII.
pub(crate) const EXPORT_FILE_NAME_HEADER: &str = "x-file-name";

/// Asks where to save an export with the native save dialog, then writes it there.
///
/// The file content is the raw request body, so the bytes are not JSON-encoded on the way;
/// the suggested file name comes in the `x-file-name` header. Returns `false` when the user
/// cancels the dialog. Async so that the blocking dialog does not run on the main thread.
#[tauri::command]
pub async fn save_export<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    request: Request<'_>,
) -> CmdResult<bool> {
    let InvokeBody::Raw(content) = request.body() else {
        return Err(EngineError::host(
            "The export content must be sent as raw bytes",
        ));
    };
    let file_name = export_file_name(request.headers())?;
    let extension = Path::new(&file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    let (filter_name, extension) = match extension.as_deref() {
        Some("csv") => ("CSV", "csv"),
        Some("pdf") => ("PDF", "pdf"),
        _ => {
            return Err(EngineError::host(format!(
                "Unsupported export file type: {file_name}"
            )));
        }
    };

    let dialog = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter(filter_name, &[extension]);
    #[cfg(desktop)]
    let dialog = dialog.set_parent(&window);
    #[cfg(not(desktop))]
    let _ = window;
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(EngineError::host)?;
    std::fs::write(&path, content)?;
    Ok(true)
}

fn export_file_name(headers: &HeaderMap) -> CmdResult<String> {
    let encoded = headers
        .get(EXPORT_FILE_NAME_HEADER)
        .ok_or_else(|| EngineError::host("Missing export file name"))?
        .to_str()
        .map_err(EngineError::host)?;
    let decoded = percent_decode_str(encoded)
        .decode_utf8()
        .map_err(EngineError::host)?;
    // The name is only a suggestion for the dialog: never let it carry a directory.
    Path::new(decoded.as_ref())
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| EngineError::host("Invalid export file name"))
}
