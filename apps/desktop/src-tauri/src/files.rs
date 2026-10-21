//! Guardar archivos recibidos. El webview no tiene permiso de escritura general en disco:
//! solo puede pedir a este módulo que escriba en `<carpeta de recibidos>/<request_id>/`
//! (archivos de la solicitud) o en `<carpeta de recibidos>/<request_id>/respuesta/` (de la respuesta),
//! con nombres saneados y sin salirse nunca de esa carpeta.
//! Las reglas de saneado son las mismas que usa `devi mcp` al descargar (packages/cli/src/files.ts).

use serde::Deserialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_FILES: usize = 5;
pub const MAX_BYTES: usize = 1_048_576;
const MAX_NAME_CHARS: usize = 120;
/// Subcarpeta de los archivos de la respuesta (misma convención que `devi mcp`).
pub const RESPONSE_SUBDIR: &str = "respuesta";
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// De qué lado son los archivos: mismos valores que `FileMeta.direction` del protocolo.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Request,
    Response,
}

#[derive(Debug, Deserialize)]
pub struct IncomingFile {
    pub name: String,
    pub content: String,
}

fn is_dot_or_space(c: char) -> bool {
    c == '.' || c.is_whitespace()
}

/// Nombre seguro en cualquier SO: sin rutas, sin caracteres reservados ni de control,
/// sin puntos o espacios en los extremos y sin nombres de dispositivo de Windows.
pub fn sanitize_file_name(raw: &str) -> String {
    let base = raw.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let truncated: String = cleaned.trim_matches(is_dot_or_space).chars().take(MAX_NAME_CHARS).collect();
    let mut name = truncated.trim_end_matches(is_dot_or_space).to_string();
    if name.is_empty() {
        return "archivo".into();
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        name.insert(0, '_');
    }
    name
}

fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// Evita colisiones dentro de un mismo envío ("a.txt", "a (2).txt"…), sin distinguir mayúsculas
/// (Windows y macOS no las distinguen).
pub fn unique_names(names: &[String]) -> Vec<String> {
    let mut used: Vec<String> = Vec::new();
    names
        .iter()
        .map(|n| {
            let (stem, ext) = split_ext(n);
            let mut candidate = n.clone();
            let mut i = 2;
            while used.iter().any(|u| u.to_lowercase() == candidate.to_lowercase()) {
                candidate = format!("{stem} ({i}){ext}");
                i += 1;
            }
            used.push(candidate.clone());
            candidate
        })
        .collect()
}

fn valid_request_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn io_err(what: &'static str) -> impl Fn(std::io::Error) -> String {
    move |e| format!("no se pudo {what}: {e}")
}

/// Escribe los archivos en `<base>/<request_id>/` (solicitud) o `<base>/<request_id>/respuesta/`
/// (respuesta) y devuelve sus rutas absolutas.
pub fn save_files(base: &Path, request_id: &str, kind: FileKind, files: &[IncomingFile]) -> Result<Vec<PathBuf>, String> {
    if !valid_request_id(request_id) {
        return Err(format!("id de solicitud inválido: {request_id:?}"));
    }
    if files.len() > MAX_FILES {
        return Err(format!("como máximo {MAX_FILES} archivos por solicitud"));
    }
    if let Some(f) = files.iter().find(|f| f.content.len() > MAX_BYTES) {
        return Err(format!("{} supera 1 MB", f.name));
    }

    fs::create_dir_all(base).map_err(io_err("crear la carpeta de recibidos"))?;
    let base = base.canonicalize().map_err(io_err("resolver la carpeta de recibidos"))?;
    let req_dir = base.join(request_id);
    fs::create_dir_all(&req_dir).map_err(io_err("crear la carpeta de la solicitud"))?;
    // canonicalize sigue enlaces: si <base>/<id> apunta fuera, el padre ya no es <base>.
    let req_dir = req_dir.canonicalize().map_err(io_err("resolver la carpeta de la solicitud"))?;
    if req_dir.parent() != Some(base.as_path()) {
        return Err("la carpeta destino se sale de la carpeta de recibidos".into());
    }
    let dir = match kind {
        FileKind::Request => req_dir,
        FileKind::Response => {
            let d = req_dir.join(RESPONSE_SUBDIR);
            if fs::symlink_metadata(&d).is_ok_and(|m| m.is_file()) {
                return Err(format!(
                    "{} existe pero es un archivo, no es una carpeta: muévelo o bórralo para guardar la respuesta",
                    d.display()
                ));
            }
            fs::create_dir_all(&d).map_err(io_err("crear la carpeta de la respuesta"))?;
            let d = d.canonicalize().map_err(io_err("resolver la carpeta de la respuesta"))?;
            if d.parent() != Some(req_dir.as_path()) {
                return Err("la carpeta de la respuesta se sale de la carpeta de recibidos".into());
            }
            d
        }
    };

    let names = unique_names(&files.iter().map(|f| sanitize_file_name(&f.name)).collect::<Vec<_>>());
    let mut out = Vec::with_capacity(files.len());
    for (f, name) in files.iter().zip(names) {
        let path = dir.join(&name);
        if path.parent() != Some(dir.as_path()) {
            return Err(format!("nombre de archivo inválido: {name}"));
        }
        // create_new: nunca sobrescribe ni sigue un enlace simbólico existente.
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => file.write_all(f.content.as_bytes()).map_err(io_err("escribir el archivo"))?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let meta = fs::symlink_metadata(&path).map_err(io_err("comprobar el archivo existente"))?;
                if meta.file_type().is_symlink() || !meta.is_file() {
                    return Err(format!("{name}: ya existe y no es un archivo normal"));
                }
                // Ya estaba (lo guardó antes la app o el MCP): se conserva, igual que hace el MCP.
            }
            Err(e) => return Err(io_err("crear el archivo")(e)),
        }
        out.push(path);
    }
    Ok(out)
}

/// Tope de la copia de la base de datos.
pub const MAX_EXPORT_BYTES: usize = 512 * 1024 * 1024;

/// Escribe la copia en `path` sin sobrescribir nunca un archivo (ni seguir un enlace) que ya exista.
pub fn write_export(path: &Path, data: &[u8], max_bytes: usize) -> Result<(), String> {
    if data.len() > max_bytes {
        return Err(format!("la copia supera el máximo de {} MB", max_bytes / (1024 * 1024)));
    }
    let mut file = match fs::OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(format!("{} ya existe; no se sobrescribe", path.display()))
        }
        Err(e) => return Err(io_err("crear la copia")(e)),
    };
    file.write_all(data).map_err(io_err("guardar la copia"))
}

pub fn export_path(dir: &Path, unix_secs: u64) -> PathBuf {
    dir.join(format!("devi-copia-{unix_secs}.db"))
}

#[tauri::command]
pub fn save_received_files(request_id: String, kind: FileKind, files: Vec<IncomingFile>) -> Result<Vec<String>, String> {
    let base = crate::config::received_dir()?;
    let paths = save_files(&base, &request_id, kind, &files)?;
    Ok(paths.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

/// Guarda la copia de `devi.db` (bytes crudos de la petición) en Descargas, con nombre fijo.
/// El webview no elige la ruta.
#[tauri::command]
pub fn save_db_export(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("se esperaban los bytes de la base de datos".into());
    };
    let dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .ok_or("no encuentro la carpeta de descargas")?;
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let path = export_path(&dir, secs);
    write_export(&path, data, MAX_EXPORT_BYTES)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn file(name: &str, content: &str) -> IncomingFile {
        IncomingFile { name: name.into(), content: content.into() }
    }

    #[test]
    fn sanea_nombres() {
        let cases = [
            ("informe.txt", "informe.txt"),
            ("../../etc/passwd", "passwd"),
            ("..\\..\\Windows\\win.ini", "win.ini"),
            ("..", "archivo"),
            ("", "archivo"),
            ("   ", "archivo"),
            (".bashrc", "bashrc"),
            ("nota final. ", "nota final"),
            ("a<b>c:d\"e|f?g*h.md", "a_b_c_d_e_f_g_h.md"),
            ("tab\there.txt", "tab_here.txt"),
            ("CON", "_CON"),
            ("con.txt", "_con.txt"),
            ("lpt9.log", "_lpt9.log"),
            ("console.txt", "console.txt"),
            ("informe ñandú.txt", "informe ñandú.txt"),
        ];
        for (raw, want) in cases {
            assert_eq!(sanitize_file_name(raw), want, "entrada {raw:?}");
        }
    }

    #[test]
    fn trunca_nombres_largos() {
        let long = "a".repeat(300) + ".txt";
        let s = sanitize_file_name(&long);
        assert!(!s.is_empty() && s.chars().count() <= 120);
    }

    #[test]
    fn nombres_repetidos_sin_distinguir_mayusculas() {
        let names: Vec<String> = ["a.txt", "A.txt", "a.txt", "b", "b"].iter().map(|s| s.to_string()).collect();
        assert_eq!(unique_names(&names), vec!["a.txt", "A (2).txt", "a (3).txt", "b", "b (2)"]);
    }

    #[test]
    fn guarda_dentro_de_la_carpeta_de_la_solicitud() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("recibidos");
        let paths = save_files(&base, "q1", FileKind::Request, &[file("../fuera.txt", "hola"), file("log.txt", "x")]).unwrap();
        let root = base.canonicalize().unwrap().join("q1");
        assert_eq!(paths, vec![root.join("fuera.txt"), root.join("log.txt")]);
        assert_eq!(fs::read_to_string(&paths[0]).unwrap(), "hola");
        assert!(!tmp.path().join("fuera.txt").exists());
    }

    #[test]
    fn rechaza_ids_de_solicitud_peligrosos() {
        let tmp = tempfile::tempdir().unwrap();
        let long = "x".repeat(65);
        for id in ["", "..", "../x", "a/b", "a\\b", "q 1", long.as_str()] {
            assert!(save_files(tmp.path(), id, FileKind::Request, &[file("a.txt", "b")]).is_err(), "id {id:?}");
        }
        assert!(save_files(tmp.path(), "q1_b-2", FileKind::Request, &[file("a.txt", "b")]).is_ok());
    }

    #[test]
    fn rechaza_demasiados_o_demasiado_grandes() {
        let tmp = tempfile::tempdir().unwrap();
        let six: Vec<IncomingFile> = (0..6).map(|i| file(&format!("{i}.txt"), "x")).collect();
        assert!(save_files(tmp.path(), "q1", FileKind::Request, &six).is_err());
        let big = "x".repeat(MAX_BYTES + 1);
        assert!(save_files(tmp.path(), "q2", FileKind::Request, &[file("big.txt", &big)]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn no_sigue_una_carpeta_de_solicitud_enlazada_fuera() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("recibidos");
        let outside = tmp.path().join("fuera");
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, base.join("q1")).unwrap();
        assert!(save_files(&base, "q1", FileKind::Request, &[file("a.txt", "b")]).is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn no_escribe_a_traves_de_un_enlace_simbolico() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("recibidos");
        fs::create_dir_all(base.join("q1")).unwrap();
        let victim = tmp.path().join("victima.txt");
        fs::write(&victim, "original").unwrap();
        std::os::unix::fs::symlink(&victim, base.join("q1").join("log.txt")).unwrap();
        assert!(save_files(&base, "q1", FileKind::Request, &[file("log.txt", "pisado")]).is_err());
        assert_eq!(fs::read_to_string(&victim).unwrap(), "original");
    }

    #[test]
    fn no_sobrescribe_archivos_existentes() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("recibidos");
        let first = save_files(&base, "q1", FileKind::Request, &[file("log.txt", "del MCP")]).unwrap();
        let again = save_files(
            &base,
            "q1",
            FileKind::Request,
            &[file("log.txt", "otra cosa"), file("nuevo.txt", "n")],
        )
        .unwrap();
        assert_eq!(again[0], first[0]);
        assert_eq!(fs::read_to_string(&first[0]).unwrap(), "del MCP");
        assert_eq!(fs::read_to_string(&again[1]).unwrap(), "n");
    }

    #[test]
    fn las_respuestas_van_a_su_subcarpeta() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("recibidos");
        let req = save_files(&base, "q1", FileKind::Request, &[file("log.txt", "pregunta")]).unwrap();
        let resp = save_files(&base, "q1", FileKind::Response, &[file("log.txt", "respuesta")]).unwrap();
        let root = base.canonicalize().unwrap().join("q1");
        assert_eq!(req, vec![root.join("log.txt")]);
        assert_eq!(resp, vec![root.join("respuesta").join("log.txt")]);
        assert_eq!(fs::read_to_string(&req[0]).unwrap(), "pregunta");
        assert_eq!(fs::read_to_string(&resp[0]).unwrap(), "respuesta");
    }

    #[cfg(unix)]
    #[test]
    fn no_sigue_una_subcarpeta_de_respuesta_enlazada_fuera() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("recibidos");
        let outside = tmp.path().join("fuera");
        fs::create_dir_all(base.join("q1")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, base.join("q1").join("respuesta")).unwrap();
        assert!(save_files(&base, "q1", FileKind::Response, &[file("a.txt", "b")]).is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    }

    #[test]
    fn respuesta_como_archivo_da_un_error_claro() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("recibidos");
        fs::create_dir_all(base.join("q1")).unwrap();
        fs::write(base.join("q1").join("respuesta"), "x").unwrap();
        let err = save_files(&base, "q1", FileKind::Response, &[file("a.txt", "b")]).unwrap_err();
        assert!(err.contains("no es una carpeta"), "{err}");
    }

    #[test]
    fn la_copia_no_sobrescribe_ni_supera_el_tope() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("devi-copia-1.db");
        write_export(&path, b"uno", 10).unwrap();
        let err = write_export(&path, b"dos", 10).unwrap_err();
        assert!(err.contains("ya existe"), "{err}");
        assert_eq!(fs::read(&path).unwrap(), b"uno");
        let big = tmp.path().join("grande.db");
        assert!(write_export(&big, &[0u8; 11], 10).is_err());
        assert!(!big.exists());
        assert_eq!(MAX_EXPORT_BYTES, 512 * 1024 * 1024);
    }

    #[test]
    fn tipo_desde_json() {
        assert_eq!(serde_json::from_str::<FileKind>("\"request\"").unwrap(), FileKind::Request);
        assert_eq!(serde_json::from_str::<FileKind>("\"response\"").unwrap(), FileKind::Response);
        assert!(serde_json::from_str::<FileKind>("\"otro\"").is_err());
    }

    #[test]
    fn ruta_de_exportacion() {
        assert_eq!(export_path(Path::new("/d"), 42), PathBuf::from("/d/devi-copia-42.db"));
    }
}
