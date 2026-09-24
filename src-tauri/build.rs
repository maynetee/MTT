/// The app's commands. Listing them generates an `allow-<command>` permission for each one
/// (underscores become dashes) and puts every command under the capabilities, so that a
/// window can only call the commands its capability grants.
const COMMANDS: &[&str] = &[
    "list_tournaments",
    "create_tournament",
    "delete_tournament",
    "get_view",
    "dispatch",
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
