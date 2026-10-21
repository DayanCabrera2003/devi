//! App de escritorio de Devi. Rust solo hace lo nativo: tray, ventanas, sidecar `devi`,
//! escritura confinada en disco y configuración. La UI habla con el servidor por HTTP/SSE.

// Módulos nativos (se añaden en las tareas 5 a 9).
mod config;
mod files;
mod tailscale;

use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        // Debe ir el primero: una segunda instancia solo enfoca la ventana existente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            // Cerrar una ventana la oculta: Devi sigue vivo en la bandeja del sistema.
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
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Devi");
}
