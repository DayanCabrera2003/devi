//! App de escritorio de Devi. Rust solo hace lo nativo: tray, ventanas, sidecar `devi`,
//! escritura confinada en disco y configuración. La UI habla con el servidor por HTTP/SSE.

mod config;
mod files;
mod sidecar;
mod tailscale;
mod tray;

use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        // Debe ir el primero: una segunda instancia solo enfoca la ventana existente
        // (y así nunca hay dos servidores sidecar).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sidecar::ServerState::default())
        .setup(|app| {
            // Sin tray (p. ej. falta libayatana-appindicator) Devi sigue funcionando con la mascota.
            if let Err(e) = tray::create(app.handle()) {
                eprintln!("[devi] no se pudo crear el icono de la bandeja: {e}");
            }
            // Al arrancar con la sesión (autostart) solo se ve la mascota.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    w.hide()?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar una ventana (también la mascota) la oculta: Devi sigue vivo. "Abrir" del tray
            // o una segunda instancia vuelven a mostrar las dos; se sale con "Salir de Devi".
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            config::read_client_config,
            config::write_client_config,
            config::choose_received_dir,
            config::reset_received_dir,
            files::save_received_files,
            files::save_db_export,
            tailscale::tailscale_self_login,
            tailscale::tailscale_serve_configured,
            sidecar::run_devi,
            sidecar::start_server,
            sidecar::stop_server,
            sidecar::server_status,
            tray::show_main_window,
            tray::set_paused,
            tray::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Devi")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                sidecar::kill_server(app);
            }
        });
}
