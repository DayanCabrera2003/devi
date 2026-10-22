//! Ventanas de Devi: la principal (estática, en tauri.conf.json) y la mascota flotante, que es
//! opcional (preferencia `app.showMascot`, apagada por defecto) y se crea solo cuando se pide.
//! También decide qué hace cerrar la ventana principal según haya tray o mascota.

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::config::ClientConfig;

pub const MAIN_LABEL: &str = "main";
pub const MASCOT_LABEL: &str = "mascota";

/// Estado nativo: si el icono de la bandeja existe, si se quiere la mascota y si los avisos están en pausa.
#[derive(Default)]
pub struct WindowState {
    tray: AtomicBool,
    mascot: AtomicBool,
    paused: AtomicBool,
}

impl WindowState {
    pub fn set_tray_available(&self, available: bool) {
        self.tray.store(available, Ordering::SeqCst);
    }

    pub fn tray_available(&self) -> bool {
        self.tray.load(Ordering::SeqCst)
    }

    pub fn set_mascot_wanted(&self, wanted: bool) {
        self.mascot.store(wanted, Ordering::SeqCst);
    }

    pub fn mascot_wanted(&self) -> bool {
        self.mascot.load(Ordering::SeqCst)
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
    }

    pub fn paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
}

/// `app.showMascot` de config.json. Sin la clave (instalaciones anteriores) la mascota no se muestra.
pub fn mascot_pref(cfg: Option<&ClientConfig>) -> bool {
    cfg.and_then(|c| c.extra.get("app"))
        .and_then(|app| app.get("showMascot"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    Hide,
    Minimize,
}

/// Qué hace cerrar (o arrancar minimizada) la ventana principal. Ocultarla solo tiene sentido si
/// queda algo para volver: el icono de la bandeja o la mascota visible. Si no, se minimiza y Devi
/// sigue en la barra de tareas.
pub fn close_action(tray_available: bool, mascot_visible: bool) -> CloseAction {
    if tray_available || mascot_visible {
        CloseAction::Hide
    } else {
        CloseAction::Minimize
    }
}

fn mascot_visible(app: &AppHandle) -> bool {
    app.get_webview_window(MASCOT_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Oculta o minimiza la ventana principal según `close_action`.
pub fn tuck_away_main(app: &AppHandle) {
    let Some(w) = app.get_webview_window(MAIN_LABEL) else { return };
    let tray = app.state::<WindowState>().tray_available();
    let _ = match close_action(tray, mascot_visible(app)) {
        CloseAction::Hide => w.hide(),
        CloseAction::Minimize => w.minimize(),
    };
}

/// Crea la ventana mascota si aún no existe (misma página que la principal; App.svelte elige la
/// vista por la etiqueta). Sin fondo: transparente, sin bordes y sin sombra.
fn ensure_mascot(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(MASCOT_LABEL) {
        return Ok(w);
    }
    let builder = WebviewWindowBuilder::new(app, MASCOT_LABEL, WebviewUrl::App("index.html".into()))
        .title("Devi")
        .inner_size(132.0, 168.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // En macOS exige `app.macOSPrivateApi` (ver tauri.conf.json).
        .transparent(true);
    // Sin sombra donde se puede (Windows y macOS; en Linux no aplica).
    #[cfg(not(target_os = "linux"))]
    let builder = builder.shadow(false);
    builder.build()
}

/// Muestra u oculta la mascota y recuerda la elección para "Abrir" y para cerrar la principal.
pub fn apply_mascot(app: &AppHandle, visible: bool) -> Result<(), String> {
    app.state::<WindowState>().set_mascot_wanted(visible);
    if visible {
        ensure_mascot(app).and_then(|w| w.show()).map_err(|e| e.to_string())
    } else {
        match app.get_webview_window(MASCOT_LABEL) {
            Some(w) => w.hide().map_err(|e| e.to_string()),
            None => Ok(()),
        }
    }
}

/// Ajustes → "Mostrar a Devi flotando". La UI guarda la preferencia en config.json.
/// Async: crear una ventana desde un comando síncrono bloquea en Windows.
#[tauri::command]
pub async fn set_mascot_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    apply_mascot(&app, visible)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(json: &str) -> ClientConfig {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn la_mascota_esta_apagada_por_defecto() {
        assert!(!mascot_pref(None));
        assert!(!mascot_pref(Some(&cfg(r#"{"serverUrl":"https://pc.t.ts.net"}"#))));
        // Instalaciones anteriores: hay `app` pero sin `showMascot`.
        assert!(!mascot_pref(Some(&cfg(r#"{"app":{"notifications":true,"setupDone":true}}"#))));
        assert!(!mascot_pref(Some(&cfg(r#"{"app":{"showMascot":"si"}}"#))));
        assert!(!mascot_pref(Some(&cfg(r#"{"app":{"showMascot":false}}"#))));
        assert!(mascot_pref(Some(&cfg(r#"{"app":{"showMascot":true}}"#))));
    }

    #[test]
    fn cerrar_oculta_solo_si_queda_por_donde_volver() {
        assert_eq!(close_action(true, false), CloseAction::Hide);
        assert_eq!(close_action(true, true), CloseAction::Hide);
        assert_eq!(close_action(false, true), CloseAction::Hide);
        assert_eq!(close_action(false, false), CloseAction::Minimize);
    }

    #[test]
    fn el_estado_recuerda_tray_y_mascota() {
        let s = WindowState::default();
        assert!(!s.tray_available() && !s.mascot_wanted());
        s.set_tray_available(true);
        s.set_mascot_wanted(true);
        assert!(s.tray_available() && s.mascot_wanted());
    }

    fn json(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn la_mascota_no_es_una_ventana_estatica() {
        let conf = json(include_str!("../tauri.conf.json"));
        let labels: Vec<&str> = conf["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|w| w["label"].as_str())
            .collect();
        assert_eq!(labels, vec![MAIN_LABEL]);
        // La transparencia en macOS necesita la API privada.
        assert_eq!(conf["app"]["macOSPrivateApi"], true);
    }

    #[test]
    fn solo_la_ventana_principal_puede_mostrar_la_mascota() {
        let main = json(include_str!("../capabilities/main.json"));
        let mascota = json(include_str!("../capabilities/mascota.json"));
        let has = |cap: &Value| cap["permissions"].as_array().unwrap().iter().any(|p| p == "allow-set-mascot-visible");
        assert!(has(&main));
        assert!(!has(&mascota));
        assert!(include_str!("../build.rs").contains("\"set_mascot_visible\""));
    }
}
