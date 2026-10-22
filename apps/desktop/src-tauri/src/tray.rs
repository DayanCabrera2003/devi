//! Icono de la bandeja del sistema (Devi monocromo) y su menú: Ver avisos (N), Abrir Devi,
//! Pausar avisos y Salir. En macOS y Windows el clic izquierdo abre el panel de avisos junto al
//! icono y el derecho, el menú. En GNOME sin la extensión AppIndicator no se ve: entonces cerrar la
//! ventana la minimiza (ver windows.rs) y se puede activar la mascota flotante en Ajustes.

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::windows::WindowState;

/// Evento hacia todas las ventanas (principal y avisos) cuando cambia la pausa.
pub const EVT_PAUSED: &str = "devi://paused";
const TRAY_ID: &str = "devi";

pub struct TrayState {
    pause: CheckMenuItem<Wry>,
    avisos: MenuItem<Wry>,
}

/// Variante del icono: plantilla negra en macOS (el sistema la colorea según la barra de menús),
/// blanca en Linux y Windows; con un punto de acento mientras hay algo pendiente.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayIconKind {
    Template,
    TemplateAttention,
    White,
    WhiteAttention,
}

impl TrayIconKind {
    pub fn choose(macos: bool, attention: bool) -> Self {
        match (macos, attention) {
            (true, false) => Self::Template,
            (true, true) => Self::TemplateAttention,
            (false, false) => Self::White,
            (false, true) => Self::WhiteAttention,
        }
    }

    pub fn is_template(self) -> bool {
        matches!(self, Self::Template | Self::TemplateAttention)
    }

    /// PNG generados con icons/tray/devi-tray.sh.
    pub fn png(self) -> &'static [u8] {
        match self {
            Self::Template => include_bytes!("../icons/tray/template.png"),
            Self::TemplateAttention => include_bytes!("../icons/tray/template-attention.png"),
            Self::White => include_bytes!("../icons/tray/white.png"),
            Self::WhiteAttention => include_bytes!("../icons/tray/white-attention.png"),
        }
    }
}

/// Primera entrada del menú.
pub fn avisos_label(pending: u32) -> String {
    if pending == 0 {
        "Ver avisos".into()
    } else {
        format!("Ver avisos ({pending})")
    }
}

pub fn tooltip(pending: u32) -> String {
    match pending {
        0 => "Devi · nada pendiente".into(),
        1 => "Devi · 1 pendiente".into(),
        n => format!("Devi · {n} pendientes"),
    }
}

fn icon_image(kind: TrayIconKind) -> tauri::Result<Image<'static>> {
    Image::from_bytes(kind.png())
}

/// Muestra, desminimiza y enfoca la ventana principal. La mascota solo vuelve si está activada
/// en Ajustes (y alguien la había cerrado).
pub fn show_main(app: &AppHandle) {
    if app.state::<WindowState>().mascot_wanted() {
        let _ = crate::windows::apply_mascot(app, true);
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
    let avisos = MenuItem::with_id(app, "avisos", avisos_label(0), true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Abrir Devi", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pausar avisos", true, false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&avisos, &open, &pause, &separator, &quit])?;
    app.manage(TrayState { pause: pause.clone(), avisos });

    let kind = TrayIconKind::choose(cfg!(target_os = "macos"), false);
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_image(kind)?)
        .icon_as_template(kind.is_template())
        .tooltip(tooltip(0))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "avisos" => {
                if let Err(e) = crate::popover::open_from_menu(app) {
                    eprintln!("[devi] no se pudo abrir el panel de avisos: {e}");
                }
            }
            "open" => show_main(app),
            "pause" => {
                let paused = pause.is_checked().unwrap_or(false);
                broadcast_paused(app, paused);
            }
            "quit" => exit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // En Linux (AppIndicator) no llegan clics: solo el menú ("Ver avisos").
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                if let Err(e) = crate::popover::toggle_at_tray(tray.app_handle(), rect) {
                    eprintln!("[devi] no se pudo abrir el panel de avisos: {e}");
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn broadcast_paused(app: &AppHandle, paused: bool) {
    app.state::<WindowState>().set_paused(paused);
    let _ = app.emit(EVT_PAUSED, paused);
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

/// La UI pausa o reanuda los avisos: se refleja en la casilla del tray y en todas las ventanas.
#[tauri::command]
pub fn set_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    // Si el tray no se pudo crear, no hay casilla que actualizar.
    if let Some(state) = app.try_state::<TrayState>() {
        state.pause.set_checked(paused).map_err(|e| e.to_string())?;
    }
    broadcast_paused(&app, paused);
    Ok(())
}

/// La ventana principal avisa de cuántas cosas esperan: icono con punto, "Ver avisos (N)" y tooltip.
/// Sin tray no hace nada.
#[tauri::command]
pub fn set_tray_attention(app: AppHandle, pending: u32) -> Result<(), String> {
    let Some(state) = app.try_state::<TrayState>() else { return Ok(()) };
    state.avisos.set_text(avisos_label(pending)).map_err(|e| e.to_string())?;
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return Ok(()) };
    let kind = TrayIconKind::choose(cfg!(target_os = "macos"), pending > 0);
    tray.set_icon(Some(icon_image(kind).map_err(|e| e.to_string())?)).map_err(|e| e.to_string())?;
    tray.set_icon_as_template(kind.is_template()).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip(pending))).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayStatus {
    /// false: no se pudo crear el icono (p. ej. GNOME sin AppIndicator).
    pub available: bool,
    pub paused: bool,
}

#[tauri::command]
pub fn tray_status(app: AppHandle) -> TrayStatus {
    let state = app.state::<WindowState>();
    TrayStatus { available: state.tray_available(), paused: state.paused() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_icono_depende_del_sistema_y_de_si_hay_pendientes() {
        assert_eq!(TrayIconKind::choose(true, false), TrayIconKind::Template);
        assert_eq!(TrayIconKind::choose(true, true), TrayIconKind::TemplateAttention);
        assert_eq!(TrayIconKind::choose(false, false), TrayIconKind::White);
        assert_eq!(TrayIconKind::choose(false, true), TrayIconKind::WhiteAttention);
        assert!(TrayIconKind::Template.is_template() && TrayIconKind::TemplateAttention.is_template());
        assert!(!TrayIconKind::White.is_template() && !TrayIconKind::WhiteAttention.is_template());
    }

    #[test]
    fn los_iconos_son_png_distintos_y_se_decodifican() {
        let all = [TrayIconKind::Template, TrayIconKind::TemplateAttention, TrayIconKind::White, TrayIconKind::WhiteAttention];
        for (i, a) in all.iter().enumerate() {
            assert!(a.png().starts_with(b"\x89PNG"));
            let img = icon_image(*a).unwrap();
            assert_eq!((img.width(), img.height()), (64, 64));
            for b in &all[i + 1..] {
                assert_ne!(a.png(), b.png());
            }
        }
    }

    #[test]
    fn etiqueta_del_menu_y_tooltip() {
        assert_eq!(avisos_label(0), "Ver avisos");
        assert_eq!(avisos_label(3), "Ver avisos (3)");
        assert_eq!(tooltip(0), "Devi · nada pendiente");
        assert_eq!(tooltip(1), "Devi · 1 pendiente");
        assert_eq!(tooltip(4), "Devi · 4 pendientes");
    }
}
