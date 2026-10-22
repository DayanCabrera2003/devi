//! Ventana `avisos`: el panel de cristal con lo pendiente que se abre desde el icono de la bandeja.
//! Se crea la primera vez que se pide, se oculta al perder el foco (y con Esc, desde la UI).
//!
//! Dónde aparece:
//! - macOS y Windows: clic izquierdo en el icono → junto al icono (debajo si la barra está arriba,
//!   encima si está abajo, como la barra de tareas de Windows), siempre dentro del área útil.
//! - Linux (AppIndicator no entrega clics): desde "Ver avisos" del menú, arriba a la derecha del
//!   monitor principal, debajo de la barra superior de GNOME.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindowBuilder};

pub const POPOVER_LABEL: &str = "avisos";
/// Tamaño lógico del panel.
pub const POPOVER_W: f64 = 360.0;
pub const POPOVER_H: f64 = 520.0;
/// Separación lógica entre el panel y el icono o el borde del área útil.
const GAP: f64 = 8.0;
/// Linux: distancia lógica desde arriba del monitor (debajo de la barra superior de GNOME).
const TOP_BAR: f64 = 36.0;
/// Un clic en el icono justo después de ocultarse por perder el foco es el mismo clic: no se reabre.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

/// Rectángulo en píxeles físicos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

fn clamp_axis(pos: i32, size: i32, start: i32, len: i32, gap: i32) -> i32 {
    let min = start + gap;
    let max = start + len - size - gap;
    if max < min {
        start // no cabe con márgenes: pegado al borde
    } else {
        pos.clamp(min, max)
    }
}

/// Posición del panel junto al icono, centrado en él y dentro del área útil del monitor.
/// Si el icono está en la mitad superior se abre debajo; si no, encima.
pub fn at_tray(icon: Area, size: (i32, i32), work: Area, gap: i32) -> (i32, i32) {
    let (w, h) = size;
    let x = icon.x + icon.w / 2 - w / 2;
    let icon_center = icon.y + icon.h / 2;
    let y = if icon_center < work.y + work.h / 2 { icon.y + icon.h + gap } else { icon.y - h - gap };
    (clamp_axis(x, w, work.x, work.w, gap), clamp_axis(y, h, work.y, work.h, gap))
}

/// Arriba a la derecha del monitor, a `right` píxeles del borde derecho y `top` del superior.
pub fn top_right(monitor: Area, size: (i32, i32), right: i32, top: i32) -> (i32, i32) {
    (monitor.x + monitor.w - size.0 - right, monitor.y + top)
}

/// Abajo a la derecha del área útil (Windows sin posición del icono, p. ej. desde el menú).
pub fn bottom_right(work: Area, size: (i32, i32), gap: i32) -> (i32, i32) {
    (work.x + work.w - size.0 - gap, work.y + work.h - size.1 - gap)
}

/// Clic en el icono: si el panel está visible se oculta; si se acaba de ocultar por ese mismo
/// clic (perdió el foco), no se vuelve a abrir.
pub fn should_open(visible: bool, since_hidden: Option<Duration>) -> bool {
    !visible && since_hidden.map_or(true, |d| d >= REOPEN_GUARD)
}

fn scaled(v: f64, scale: f64) -> i32 {
    (v * scale).round() as i32
}

#[derive(Default)]
pub struct PopoverState {
    hidden_at: Mutex<Option<Instant>>,
}

/// Llamado al perder el foco: se oculta y se apunta cuándo.
pub fn hide_on_blur(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
        let _ = w.hide();
    }
    if let Ok(mut t) = app.state::<PopoverState>().hidden_at.lock() {
        *t = Some(Instant::now());
    }
}

fn ensure_popover(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
        return Ok(w);
    }
    let builder = WebviewWindowBuilder::new(app, POPOVER_LABEL, WebviewUrl::App("index.html".into()))
        .title("Avisos de Devi")
        .inner_size(POPOVER_W, POPOVER_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // En macOS exige `app.macOSPrivateApi` (ver tauri.conf.json).
        .transparent(true);
    #[cfg(not(target_os = "linux"))]
    let builder = builder.shadow(false);
    builder.build()
}

fn show_at(app: &AppHandle, pos: (i32, i32)) -> Result<(), String> {
    let w = ensure_popover(app).map_err(|e| e.to_string())?;
    w.set_position(PhysicalPosition::new(pos.0, pos.1)).map_err(|e| e.to_string())?;
    w.show().map_err(|e| e.to_string())?;
    let _ = w.set_focus();
    Ok(())
}

fn area_of(r: &tauri::PhysicalRect<i32, u32>) -> Area {
    Area { x: r.position.x, y: r.position.y, w: r.size.width as i32, h: r.size.height as i32 }
}

/// Sin posición del icono (menú "Ver avisos"): arriba a la derecha en Linux y macOS, abajo a la
/// derecha en Windows.
pub fn open_from_menu(app: &AppHandle) -> Result<(), String> {
    let monitor = app.primary_monitor().map_err(|e| e.to_string())?.ok_or("no hay monitor principal")?;
    let s = monitor.scale_factor();
    let size = (scaled(POPOVER_W, s), scaled(POPOVER_H, s));
    let full = Area {
        x: monitor.position().x,
        y: monitor.position().y,
        w: monitor.size().width as i32,
        h: monitor.size().height as i32,
    };
    let pos = if cfg!(target_os = "windows") {
        bottom_right(area_of(monitor.work_area()), size, scaled(GAP, s))
    } else {
        top_right(full, size, scaled(GAP, s), scaled(TOP_BAR, s))
    };
    show_at(app, pos)
}

/// Clic izquierdo en el icono (macOS y Windows): abre o cierra el panel junto al icono.
pub fn toggle_at_tray(app: &AppHandle, rect: Rect) -> Result<(), String> {
    let visible = app
        .get_webview_window(POPOVER_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    let since = app.state::<PopoverState>().hidden_at.lock().ok().and_then(|t| t.map(|i| i.elapsed()));
    if !should_open(visible, since) {
        if visible {
            if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
                let _ = w.hide();
            }
        }
        return Ok(());
    }
    // La escala sale del monitor donde está el icono.
    let probe = rect.position.to_physical::<f64>(1.0);
    let monitor = app
        .monitor_from_point(probe.x, probe.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return open_from_menu(app) };
    let s = monitor.scale_factor();
    let pos = rect.position.to_physical::<i32>(s);
    let dim = rect.size.to_physical::<i32>(s);
    let icon = Area { x: pos.x, y: pos.y, w: dim.width, h: dim.height };
    let size = (scaled(POPOVER_W, s), scaled(POPOVER_H, s));
    show_at(app, at_tray(icon, size, area_of(monitor.work_area()), scaled(GAP, s)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK_TOP: Area = Area { x: 0, y: 25, w: 1440, h: 875 }; // macOS: barra de menús arriba
    const WORK_BOTTOM: Area = Area { x: 0, y: 0, w: 1920, h: 1032 }; // Windows: barra de tareas abajo

    #[test]
    fn con_la_barra_arriba_se_abre_debajo_del_icono_y_centrado() {
        let icon = Area { x: 1000, y: 0, w: 24, h: 24 };
        // Justo debajo de la barra de menús: a `gap` del borde superior del área útil.
        assert_eq!(at_tray(icon, (360, 520), WORK_TOP, 8), (1012 - 180, 25 + 8));
    }

    #[test]
    fn con_la_barra_abajo_se_abre_encima_del_icono() {
        let icon = Area { x: 1500, y: 1040, w: 24, h: 40 };
        // El icono está en la barra de tareas, fuera del área útil: el panel queda a `gap` de su borde.
        assert_eq!(at_tray(icon, (360, 520), WORK_BOTTOM, 8), (1512 - 180, 1032 - 520 - 8));
    }

    #[test]
    fn no_se_sale_del_area_util() {
        // Icono pegado a la esquina derecha: el panel se queda dentro con margen.
        let icon = Area { x: 1900, y: 1040, w: 20, h: 40 };
        let (x, y) = at_tray(icon, (360, 520), WORK_BOTTOM, 8);
        assert_eq!(x, 1920 - 360 - 8);
        assert!(y + 520 <= 1032 - 8);
        // Icono a la izquierda en una barra superior.
        let left = Area { x: 2, y: 0, w: 24, h: 24 };
        assert_eq!(at_tray(left, (360, 520), WORK_TOP, 8).0, 8);
        // Segundo monitor a la izquierda (coordenadas negativas).
        let work = Area { x: -1920, y: 0, w: 1920, h: 1040 };
        let icon = Area { x: -10, y: 1045, w: 24, h: 35 };
        assert_eq!(at_tray(icon, (360, 520), work, 8), (-360 - 8, 1040 - 520 - 8));
    }

    #[test]
    fn linux_arriba_a_la_derecha_debajo_de_la_barra_superior() {
        let monitor = Area { x: 0, y: 0, w: 1920, h: 1080 };
        assert_eq!(top_right(monitor, (360, 520), 8, 36), (1920 - 360 - 8, 36));
        // Pantalla HiDPI (escala 2): todo en píxeles físicos.
        let hidpi = Area { x: 0, y: 0, w: 3840, h: 2160 };
        assert_eq!(top_right(hidpi, (720, 1040), 16, 72), (3840 - 720 - 16, 72));
    }

    #[test]
    fn windows_sin_icono_abajo_a_la_derecha() {
        assert_eq!(bottom_right(WORK_BOTTOM, (360, 520), 8), (1920 - 368, 1032 - 528));
    }

    #[test]
    fn el_clic_que_le_quito_el_foco_no_lo_reabre() {
        assert!(should_open(false, None));
        assert!(!should_open(true, None));
        assert!(!should_open(false, Some(Duration::from_millis(50))));
        assert!(should_open(false, Some(Duration::from_secs(2))));
    }

    #[test]
    fn el_panel_tiene_lo_minimo() {
        let cap: serde_json::Value = serde_json::from_str(include_str!("../capabilities/avisos.json")).unwrap();
        assert_eq!(cap["windows"], serde_json::json!([POPOVER_LABEL]));
        let perms: Vec<&str> = cap["permissions"].as_array().unwrap().iter().filter_map(|p| p.as_str()).collect();
        for p in &perms {
            assert!(!p.starts_with("fs:") && !p.starts_with("shell:") && !p.starts_with("dialog:"), "{p}");
        }
        for forbidden in ["allow-save-received-files", "allow-save-db-export", "allow-write-client-config", "allow-run-devi", "allow-start-server", "allow-quit-app"] {
            assert!(!perms.contains(&forbidden), "{forbidden}");
        }
        assert!(perms.contains(&"allow-read-client-config") && perms.contains(&"core:window:allow-hide"));
    }
}
