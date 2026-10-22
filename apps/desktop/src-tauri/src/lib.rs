//! App de escritorio de Devi. Rust solo hace lo nativo: tray, ventanas (ver windows.rs), sidecar `devi`,
//! escritura confinada en disco y configuración. La UI habla con el servidor por HTTP/SSE.

mod config;
mod files;
mod picked;
mod sidecar;
mod tailscale;
mod tray;
mod windows;

use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        // Debe ir el primero: abrir Devi otra vez desde el menú muestra, desminimiza y enfoca la
        // ventana principal existente (y así nunca hay dos servidores sidecar).
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
        .manage(picked::PickedFiles::default())
        .manage(windows::WindowState::default())
        .setup(|app| {
            let handle = app.handle();
            // Sin tray (p. ej. GNOME sin AppIndicator) cerrar la ventana la minimiza en vez de ocultarla.
            match tray::create(handle) {
                Ok(()) => app.state::<windows::WindowState>().set_tray_available(true),
                Err(e) => eprintln!("[devi] no se pudo crear el icono de la bandeja: {e}"),
            }
            // La mascota flotante es opcional: solo aparece si se activó en Ajustes.
            let cfg = config::config_path().and_then(|p| config::read_from(&p)).unwrap_or(None);
            if windows::mascot_pref(cfg.as_ref()) {
                if let Err(e) = windows::apply_mascot(handle, true) {
                    eprintln!("[devi] no se pudo mostrar la mascota: {e}");
                }
            }
            // Al arrancar con la sesión (autostart) la ventana principal no se abre delante.
            if std::env::args().any(|a| a == "--minimized") {
                windows::tuck_away_main(handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Archivos soltados sobre la ventana principal: los lee y valida Rust (ver picked.rs).
            if let WindowEvent::DragDrop(drag) = event {
                picked::on_drag_drop(window, drag);
            }
            // Cerrar no sale de Devi (se sale con "Salir de Devi"). La principal se oculta si hay tray
            // o mascota para volver; si no, se minimiza y queda en la barra de tareas.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() == windows::MAIN_LABEL {
                    windows::tuck_away_main(window.app_handle());
                } else {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            config::read_client_config,
            config::write_client_config,
            config::choose_received_dir,
            config::reset_received_dir,
            files::save_received_files,
            files::save_db_export,
            picked::pick_files,
            picked::take_files,
            picked::discard_files,
            tailscale::tailscale_self_login,
            tailscale::tailscale_serve_configured,
            sidecar::run_devi,
            sidecar::start_server,
            sidecar::stop_server,
            sidecar::server_status,
            tray::show_main_window,
            tray::set_paused,
            windows::set_mascot_visible,
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
