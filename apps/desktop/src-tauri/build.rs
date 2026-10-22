fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "save_received_files",
            "save_db_export",
            "pick_files",
            "take_files",
            "discard_files",
            "read_client_config",
            "write_client_config",
            "choose_received_dir",
            "reset_received_dir",
            "run_devi",
            "tailscale_self_login",
            "tailscale_serve_configured",
            "start_server",
            "stop_server",
            "server_status",
            "show_main_window",
            "set_paused",
            "set_mascot_visible",
            "quit_app",
        ])),
    )
    .expect("falló tauri-build");
}
