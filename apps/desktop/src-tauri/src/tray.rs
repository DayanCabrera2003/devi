//! Icono de la bandeja del sistema: Abrir, Pausar avisos, Ajustes y Salir (y `quit_app` para la UI).
//! En GNOME sin la extensión AppIndicator no se ve; por eso existe la ventana mascota.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// Eventos hacia la ventana principal.
pub const EVT_PAUSED: &str = "devi://paused";
pub const EVT_NAVIGATE: &str = "devi://navigate";

pub struct TrayState {
    pause: CheckMenuItem<Wry>,
}

/// Muestra la ventana principal y, si se había cerrado (oculta), también la mascota.
pub fn show_main(app: &AppHandle) {
    if let Some(m) = app.get_webview_window("mascota") {
        let _ = m.show();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Mata el servidor sidecar y cierra la app (también lo hace `RunEvent::Exit`; repetirlo no daña).
pub fn exit_app(app: &AppHandle) {
    crate::sidecar::kill_server(app);
    app.exit(0);
}

pub fn create(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pausar avisos", true, false, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Ajustes", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &settings, &separator, &quit])?;
    app.manage(TrayState { pause: pause.clone() });

    let icon = app.default_window_icon().cloned().ok_or("falta el icono de la app")?;
    TrayIconBuilder::with_id("devi")
        .icon(icon)
        .tooltip("Devi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "pause" => {
                let paused = pause.is_checked().unwrap_or(false);
                let _ = app.emit_to("main", EVT_PAUSED, paused);
            }
            "settings" => {
                show_main(app);
                let _ = app.emit_to("main", EVT_NAVIGATE, "ajustes");
            }
            "quit" => exit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // En Linux (AppIndicator) no llegan clics: solo el menú.
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}

/// "Salir de Devi" desde la ventana principal: sin tray no habría otra forma de cerrar la app.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    exit_app(&app);
}

/// La UI pausa o reanuda los avisos: se refleja en la casilla del tray.
#[tauri::command]
pub fn set_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    // Si el tray no se pudo crear, no hay casilla que actualizar: solo se avisa a la ventana.
    if let Some(state) = app.try_state::<TrayState>() {
        state.pause.set_checked(paused).map_err(|e| e.to_string())?;
    }
    app.emit_to("main", EVT_PAUSED, paused).map_err(|e| e.to_string())
}
