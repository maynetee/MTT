/// The app's commands. Listing them generates an `allow-<command>` permission for each one
/// (underscores become dashes) and puts every command under the capabilities, so that a
/// window can only call the commands its capability grants.
const COMMANDS: &[&str] = &[
    "get_state",
    "create_tournament",
    "reset_tournament",
    "register_player",
    "register_player_at_seat",
    "eliminate_player",
    "revive_player_at_seat",
    "move_player",
    "balance_suggestions",
    "close_table",
    "clock_start",
    "clock_pause",
    "clock_next",
    "clock_prev",
    "clock_adjust",
    "clock_trigger_break",
    "update_itm",
    "undo_last_event",
    "open_display_window",
    "save_export",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run the Tauri build script");
}
