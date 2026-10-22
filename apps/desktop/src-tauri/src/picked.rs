//! Archivos para adjuntar al enviar desde la app. El webview nunca elige rutas para leer: los archivos
//! llegan por el diálogo nativo (`pick_files`) o al soltarlos sobre la ventana principal, y siempre los
//! lee y valida Rust (texto UTF-8 sin NUL, ≤ 1 MB; misma regla que el servidor y `devi mcp`).
//! Los aceptados se guardan en memoria con un token aleatorio; el webview solo ve nombre, tamaño y
//! una vista previa, y recoge el contenido con `take_files` (que lo borra) al enviar.

use serde::Serialize;
use std::collections::hash_map::RandomState;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::hash::{BuildHasher, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::files::{sanitize_file_name, MAX_BYTES, MAX_FILES};

/// Como máximo tantos archivos esperando en memoria; al pasarse se olvidan los más antiguos.
pub const MAX_PENDING: usize = 20;
/// Bytes de la vista previa (cortada en un límite de carácter).
pub const PREVIEW_BYTES: usize = 4096;

pub const DRAG_HOVER_EVENT: &str = "devi://drag-hover";
pub const FILES_DROPPED_EVENT: &str = "devi://files-dropped";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PickedFile {
    pub token: String,
    pub name: String,
    pub size: u64,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RejectedFile {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct PickResult {
    pub files: Vec<PickedFile>,
    pub rejected: Vec<RejectedFile>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TakenFile {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DragHover {
    pub active: bool,
}

/// Comprueba que los bytes sean un archivo de texto aceptable y los devuelve como texto.
pub fn validate_content(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > MAX_BYTES {
        return Err("pesa más de 1 MB".into());
    }
    if bytes.contains(&0) {
        return Err("no es un archivo de texto (tiene bytes NUL)".into());
    }
    String::from_utf8(bytes).map_err(|_| "no es texto UTF-8".into())
}

/// Los primeros `max` bytes del texto, sin partir un carácter.
pub fn preview_of(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// Nombre visible (saneado) de una ruta.
fn display_name(path: &Path) -> String {
    sanitize_file_name(&path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

/// Lee y valida un archivo. Lee como mucho 1 MB + 1 byte, aunque el archivo crezca mientras tanto.
pub fn read_text_file(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|_| "no se pudo leer".to_string())?;
    if meta.is_dir() {
        return Err("es una carpeta".into());
    }
    if !meta.is_file() {
        return Err("no es un archivo normal".into());
    }
    if meta.len() > MAX_BYTES as u64 {
        return Err("pesa más de 1 MB".into());
    }
    let file = fs::File::open(path).map_err(|_| "no se pudo leer".to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|_| "no se pudo leer".to_string())?;
    validate_content(bytes)
}

/// Archivos aceptados a la espera de que el webview los recoja.
#[derive(Default)]
pub struct PickedFiles {
    inner: Mutex<Pending>,
}

#[derive(Default)]
struct Pending {
    order: VecDeque<String>,
    files: HashMap<String, TakenFile>,
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Token aleatorio de 128 bits (hex). RandomState se siembra con aleatoriedad del SO.
fn new_token() -> String {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let half = |salt: u64| {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(n);
        h.write_u128(nanos);
        h.write_u64(salt);
        h.finish()
    };
    format!("{:016x}{:016x}", half(1), half(2))
}

impl PickedFiles {
    /// Guarda un archivo y devuelve su token. Si hay más de MAX_PENDING, olvida los más antiguos.
    pub fn insert(&self, name: String, content: String) -> String {
        let mut p = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut token = new_token();
        while p.files.contains_key(&token) {
            token = new_token();
        }
        p.order.push_back(token.clone());
        p.files.insert(token.clone(), TakenFile { name, content });
        while p.order.len() > MAX_PENDING {
            if let Some(old) = p.order.pop_front() {
                p.files.remove(&old);
            }
        }
        token
    }

    /// Devuelve y borra los archivos de esos tokens, en ese orden. Los desconocidos se ignoran.
    pub fn take(&self, tokens: &[String]) -> Vec<TakenFile> {
        let mut p = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let out: Vec<TakenFile> = tokens.iter().filter_map(|t| p.files.remove(t)).collect();
        p.order.retain(|t| !tokens.contains(t));
        out
    }

    pub fn discard(&self, tokens: &[String]) {
        self.take(tokens);
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).files.len()
    }

    /// Lee y valida las rutas elegidas (diálogo) o soltadas sobre la ventana. Como máximo MAX_FILES
    /// por vez: el resto se rechaza.
    pub fn accept_paths(&self, paths: &[PathBuf]) -> PickResult {
        let mut result = PickResult::default();
        for path in paths {
            let name = display_name(path);
            if result.files.len() >= MAX_FILES {
                result.rejected.push(RejectedFile { name, reason: format!("como máximo {MAX_FILES} archivos por envío") });
                continue;
            }
            match read_text_file(path) {
                Ok(content) => {
                    let size = content.len() as u64;
                    let preview = preview_of(&content, PREVIEW_BYTES);
                    let token = self.insert(name.clone(), content);
                    result.files.push(PickedFile { token, name, size, preview });
                }
                Err(reason) => result.rejected.push(RejectedFile { name, reason }),
            }
        }
        result
    }
}

/// Abre el diálogo nativo de varios archivos. Comando async: fuera del hilo principal, donde el
/// diálogo bloqueante es seguro. Cancelar devuelve un resultado vacío.
#[tauri::command]
pub async fn pick_files(app: tauri::AppHandle, state: tauri::State<'_, PickedFiles>) -> Result<PickResult, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().set_title("Adjuntar archivos de texto").blocking_pick_files() else {
        return Ok(PickResult::default());
    };
    let paths: Vec<PathBuf> = picked.into_iter().filter_map(|p| p.into_path().ok()).collect();
    Ok(state.accept_paths(&paths))
}

#[tauri::command]
pub fn take_files(tokens: Vec<String>, state: tauri::State<'_, PickedFiles>) -> Vec<TakenFile> {
    state.take(&tokens)
}

#[tauri::command]
pub fn discard_files(tokens: Vec<String>, state: tauri::State<'_, PickedFiles>) {
    state.discard(&tokens);
}

/// Arrastrar y soltar sobre la ventana principal: el webview solo recibe `devi://drag-hover` y, al
/// soltar, `devi://files-dropped` con un PickResult (nombres, tamaños y tokens; nunca rutas).
pub fn on_drag_drop<R: tauri::Runtime>(window: &tauri::Window<R>, event: &tauri::DragDropEvent) {
    use tauri::{Emitter, Manager};
    if window.label() != "main" {
        return;
    }
    let hover = |active: bool| {
        let _ = window.emit_to("main", DRAG_HOVER_EVENT, DragHover { active });
    };
    match event {
        tauri::DragDropEvent::Enter { .. } | tauri::DragDropEvent::Over { .. } => hover(true),
        tauri::DragDropEvent::Leave => hover(false),
        tauri::DragDropEvent::Drop { paths, .. } => {
            hover(false);
            // La lectura (hasta 5 MB) va en otro hilo para no bloquear el bucle de eventos.
            let app = window.app_handle().clone();
            let paths = paths.clone();
            std::thread::spawn(move || {
                let result = app.state::<PickedFiles>().accept_paths(&paths);
                let _ = app.emit_to("main", FILES_DROPPED_EVENT, result);
            });
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn valida_el_contenido() {
        assert_eq!(validate_content(b"hola \xc3\xb1".to_vec()).unwrap(), "hola ñ");
        assert!(validate_content(vec![b'a', 0, b'b']).unwrap_err().contains("NUL"));
        assert!(validate_content(vec![0xe9]).unwrap_err().contains("UTF-8"));
        assert!(validate_content(vec![b'x'; MAX_BYTES + 1]).unwrap_err().contains("1 MB"));
        assert_eq!(validate_content(vec![b'x'; MAX_BYTES]).unwrap().len(), MAX_BYTES);
    }

    #[test]
    fn vista_previa_sin_partir_caracteres() {
        assert_eq!(preview_of("hola", 10), "hola");
        assert_eq!(preview_of("ñññ", 3), "ñ"); // 2 + 2 bytes: el segundo no cabe entero
        assert_eq!(preview_of(&"a".repeat(5000), PREVIEW_BYTES).len(), PREVIEW_BYTES);
    }

    #[test]
    fn acepta_texto_y_rechaza_el_resto_con_motivo() {
        let tmp = tempfile::tempdir().unwrap();
        let ok = write(tmp.path(), "nota.md", "# Hola\nñandú".as_bytes());
        let bin = write(tmp.path(), "img.png", &[0x89, 0x50, 0x00]);
        let latin1 = write(tmp.path(), "viejo.txt", &[0x63, 0x61, 0xe9]);
        let big = write(tmp.path(), "big.log", &vec![b'x'; MAX_BYTES + 1]);
        let dir = tmp.path().join("carpeta");
        fs::create_dir(&dir).unwrap();
        let missing = tmp.path().join("no-existe.txt");

        let store = PickedFiles::default();
        let r = store.accept_paths(&[ok, bin, latin1, big, dir, missing]);
        assert_eq!(r.files.len(), 1);
        let f = &r.files[0];
        assert_eq!((f.name.as_str(), f.size, f.preview.as_str()), ("nota.md", 14, "# Hola\nñandú"));
        assert_eq!(f.token.len(), 32);
        let reasons: Vec<(&str, &str)> = r.rejected.iter().map(|x| (x.name.as_str(), x.reason.as_str())).collect();
        assert_eq!(
            reasons,
            vec![
                ("img.png", "no es un archivo de texto (tiene bytes NUL)"),
                ("viejo.txt", "no es texto UTF-8"),
                ("big.log", "pesa más de 1 MB"),
                ("carpeta", "es una carpeta"),
                ("no-existe.txt", "no se pudo leer"),
            ]
        );
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn la_vista_previa_es_de_4_kb() {
        let tmp = tempfile::tempdir().unwrap();
        let p = write(tmp.path(), "largo.txt", &vec![b'a'; 10_000]);
        let r = PickedFiles::default().accept_paths(&[p]);
        assert_eq!(r.files[0].size, 10_000);
        assert_eq!(r.files[0].preview.len(), PREVIEW_BYTES);
    }

    #[test]
    fn como_maximo_cinco_por_vez() {
        let tmp = tempfile::tempdir().unwrap();
        let paths: Vec<PathBuf> = (0..7).map(|i| write(tmp.path(), &format!("{i}.txt"), b"x")).collect();
        let r = PickedFiles::default().accept_paths(&paths);
        assert_eq!(r.files.len(), MAX_FILES);
        assert_eq!(r.rejected.len(), 2);
        assert!(r.rejected[0].reason.contains("como máximo 5"));
    }

    #[test]
    fn take_devuelve_y_borra_e_ignora_desconocidos() {
        let store = PickedFiles::default();
        let a = store.insert("a.txt".into(), "A".into());
        let b = store.insert("b.txt".into(), "B".into());
        assert_ne!(a, b);
        let got = store.take(&[b.clone(), "desconocido".into(), a.clone()]);
        assert_eq!(
            got,
            vec![TakenFile { name: "b.txt".into(), content: "B".into() }, TakenFile { name: "a.txt".into(), content: "A".into() }]
        );
        assert!(store.take(&[a, b]).is_empty());
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn discard_olvida_los_archivos() {
        let store = PickedFiles::default();
        let a = store.insert("a.txt".into(), "A".into());
        let b = store.insert("b.txt".into(), "B".into());
        store.discard(&[a.clone()]);
        assert!(store.take(&[a]).is_empty());
        assert_eq!(store.take(&[b]).len(), 1);
    }

    #[test]
    fn como_maximo_20_pendientes_se_olvidan_los_mas_antiguos() {
        let store = PickedFiles::default();
        let tokens: Vec<String> = (0..MAX_PENDING + 3).map(|i| store.insert(format!("{i}.txt"), i.to_string())).collect();
        assert_eq!(store.len(), MAX_PENDING);
        assert!(store.take(&tokens[..3]).is_empty());
        let rest = store.take(&tokens[3..]);
        assert_eq!(rest.len(), MAX_PENDING);
        assert_eq!(rest[0].name, "3.txt");
    }

    #[test]
    fn tokens_distintos() {
        let store = PickedFiles::default();
        let mut seen = std::collections::HashSet::new();
        for i in 0..200 {
            assert!(seen.insert(store.insert(i.to_string(), String::new())));
        }
    }

    #[test]
    fn los_comandos_solo_se_conceden_a_la_ventana_principal() {
        let main: serde_json::Value = serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        let mascota: serde_json::Value = serde_json::from_str(include_str!("../capabilities/mascota.json")).unwrap();
        let perms = |v: &serde_json::Value| -> Vec<String> {
            v["permissions"].as_array().unwrap().iter().filter_map(|p| p.as_str().map(String::from)).collect()
        };
        for cmd in ["allow-pick-files", "allow-take-files", "allow-discard-files"] {
            assert!(perms(&main).iter().any(|p| p == cmd), "{cmd} en main");
            assert!(!perms(&mascota).iter().any(|p| p == cmd), "{cmd} no en mascota");
        }
        // Ninguna ventana puede leer rutas por su cuenta (sin plugin fs).
        for p in perms(&main).iter().chain(perms(&mascota).iter()) {
            assert!(!p.starts_with("fs:"), "{p}");
        }
    }

    #[test]
    fn las_rutas_soltadas_no_sirven_al_webview() {
        // Tauri avisa al webview de lo que se suelta con sus propios eventos (tauri://drag-drop, con rutas)
        // y no deja quitarlos sin perder WindowEvent::DragDrop. Sin protocolo asset ni plugin fs, el webview
        // no tiene forma de leer una ruta: solo puede usar los tokens de PickResult.
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_ne!(conf["app"]["security"]["assetProtocol"]["enable"], serde_json::Value::Bool(true));
        for w in conf["app"]["windows"].as_array().unwrap() {
            if w["label"] == "main" {
                assert_ne!(w["dragDropEnabled"], serde_json::Value::Bool(false), "main necesita los eventos de arrastre");
            }
        }
    }
}
