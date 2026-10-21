//! `<config del SO>/devi/config.json`, compartido con el CLI `devi`.
//! Forma: { "serverUrl": string, "devUser"?: string, "receivedDir"?: string, "app"?: {...} }.
//! Las claves que Rust no conoce (p. ej. `app`) se conservan tal cual.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    #[serde(default)]
    pub server_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dev_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub received_dir: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

pub fn config_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|d| d.join("devi").join("config.json"))
        .ok_or_else(|| "no encuentro el directorio de configuración del sistema".to_string())
}

pub fn default_received_dir(home: &Path) -> PathBuf {
    home.join("Devi").join("recibidos")
}

pub fn read_from(path: &Path) -> Result<Option<ClientConfig>, String> {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s)
            .map(Some)
            .map_err(|e| format!("{} no es válido: {e}", path.display())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("no se pudo leer {}: {e}", path.display())),
    }
}

pub fn validate(cfg: &ClientConfig) -> Result<(), String> {
    let url = cfg.server_url.trim();
    if !url.is_empty() {
        check_server_url(url)?;
    }
    if let Some(dir) = &cfg.received_dir {
        if !Path::new(dir).is_absolute() {
            return Err("la carpeta de recibidos debe ser una ruta absoluta".into());
        }
    }
    Ok(())
}

/// https:// siempre; http:// solo si el host es exactamente 127.0.0.1, localhost o [::1]
/// (se parsea la URL: `http://localhost.evil.com` no es localhost).
fn check_server_url(raw: &str) -> Result<(), String> {
    use std::net::{Ipv4Addr, Ipv6Addr};
    use url::Host;
    const MSG: &str = "la URL del servidor debe empezar por https:// (o ser http://127.0.0.1 en modo dev)";
    let parsed = url::Url::parse(raw).map_err(|_| format!("la URL del servidor no es válida: {raw}"))?;
    let loopback = match parsed.host() {
        Some(Host::Domain(d)) => d == "localhost",
        Some(Host::Ipv4(ip)) => ip == Ipv4Addr::LOCALHOST,
        Some(Host::Ipv6(ip)) => ip == Ipv6Addr::LOCALHOST,
        None => false,
    };
    let has_credentials = !parsed.username().is_empty() || parsed.password().is_some();
    match parsed.scheme() {
        "https" if parsed.host().is_some() => Ok(()),
        "http" if loopback && !has_credentials => Ok(()),
        _ => Err(MSG.into()),
    }
}

pub fn write_to(path: &Path, cfg: &ClientConfig) -> Result<(), String> {
    validate(cfg)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("no se pudo crear {}: {e}", dir.display()))?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())? + "\n";
    // Escritura atómica: el CLI puede estar leyendo el archivo a la vez.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("no se pudo escribir {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("no se pudo guardar {}: {e}", path.display()))
}

/// Carpeta de recibidos efectiva: la de config.json o ~/Devi/recibidos.
pub fn received_dir() -> Result<PathBuf, String> {
    let cfg = read_from(&config_path()?)?.unwrap_or_default();
    match cfg.received_dir {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => dirs::home_dir()
            .map(|h| default_received_dir(&h))
            .ok_or_else(|| "no encuentro la carpeta personal".to_string()),
    }
}

#[tauri::command]
pub fn read_client_config() -> Result<Option<ClientConfig>, String> {
    read_from(&config_path()?)
}

/// El webview no puede cambiar `receivedDir` con `write_client_config`: esa ruta solo la fija
/// `choose_received_dir`, que abre el diálogo nativo desde Rust.
pub fn check_received_dir_unchanged(existing: Option<&ClientConfig>, next: &ClientConfig) -> Result<(), String> {
    let current = existing.and_then(|c| c.received_dir.as_deref());
    if next.received_dir.as_deref() != current {
        return Err("la carpeta de recibidos solo se cambia desde Ajustes → Archivos recibidos → Cambiar…".into());
    }
    Ok(())
}

/// Fija (o quita, con None) `receivedDir`, conservando el resto de la configuración.
pub fn set_received_dir_at(path: &Path, dir: Option<PathBuf>) -> Result<ClientConfig, String> {
    let mut cfg = read_from(path)?.unwrap_or_default();
    cfg.received_dir = dir.map(|d| d.to_string_lossy().into_owned());
    write_to(path, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub fn write_client_config(config: ClientConfig) -> Result<(), String> {
    let path = config_path()?;
    check_received_dir_unchanged(read_from(&path)?.as_ref(), &config)?;
    write_to(&path, &config)
}

/// Abre el selector de carpeta nativo desde Rust y guarda la elección como `receivedDir`.
/// El webview nunca aporta la ruta. Devuelve None si se cancela.
#[tauri::command]
pub async fn choose_received_dir(app: tauri::AppHandle) -> Result<Option<ClientConfig>, String> {
    use tauri_plugin_dialog::DialogExt;
    // Comando async: se ejecuta fuera del hilo principal, donde el diálogo bloqueante es seguro.
    let picked = app.dialog().file().set_title("Carpeta para los archivos recibidos").blocking_pick_folder();
    let Some(folder) = picked else { return Ok(None) };
    let dir = folder.into_path().map_err(|e| format!("ruta no válida: {e}"))?;
    set_received_dir_at(&config_path()?, Some(dir)).map(Some)
}

/// Vuelve a la carpeta por defecto (~/Devi/recibidos).
#[tauri::command]
pub fn reset_received_dir() -> Result<ClientConfig, String> {
    set_received_dir_at(&config_path()?, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_archivo_devuelve_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(read_from(&tmp.path().join("no.json")), Ok(None));
    }

    #[test]
    fn json_invalido_es_error() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("config.json");
        fs::write(&p, "{ no es json").unwrap();
        assert!(read_from(&p).is_err());
    }

    #[test]
    fn ida_y_vuelta_conserva_campos_desconocidos() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("devi").join("config.json");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(
            &p,
            r#"{"serverUrl":"https://pc.tail1.ts.net","devUser":"d@x","app":{"notifications":false},"futuro":1}"#,
        )
        .unwrap();

        let cfg = read_from(&p).unwrap().unwrap();
        assert_eq!(cfg.server_url, "https://pc.tail1.ts.net");
        assert_eq!(cfg.dev_user.as_deref(), Some("d@x"));
        assert!(cfg.extra.contains_key("app"));

        write_to(&p, &cfg).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["futuro"], 1);
        assert_eq!(v["app"]["notifications"], false);
        assert!(v.get("receivedDir").is_none());
        assert!(!p.with_extension("json.tmp").exists());
    }

    #[test]
    fn valida_url_y_carpeta() {
        let ok = |url: &str| ClientConfig { server_url: url.into(), ..Default::default() };
        assert!(validate(&ok("https://pc.tail1.ts.net")).is_ok());
        assert!(validate(&ok("http://127.0.0.1:4747")).is_ok());
        assert!(validate(&ok("")).is_ok());
        assert!(validate(&ok("http://pc.tail1.ts.net")).is_err());
        assert!(validate(&ok("http://localhost:4747")).is_ok());
        assert!(validate(&ok("http://[::1]:4747")).is_ok());
        // Un prefijo de localhost no es localhost.
        assert!(validate(&ok("http://localhost.evil.com")).is_err());
        assert!(validate(&ok("http://127.0.0.1.attacker.net")).is_err());
        assert!(validate(&ok("http://localhost@evil.com")).is_err());
        assert!(validate(&ok("ftp://pc.tail1.ts.net")).is_err());
        assert!(validate(&ok("no es una url")).is_err());
        let rel = ClientConfig { received_dir: Some("Devi/recibidos".into()), ..Default::default() };
        assert!(validate(&rel).is_err());
    }

    #[test]
    fn el_webview_no_puede_cambiar_la_carpeta_de_recibidos() {
        let actual = ClientConfig { received_dir: Some("/r".into()), ..Default::default() };
        let mismo = ClientConfig {
            server_url: "https://pc.t.ts.net".into(),
            received_dir: Some("/r".into()),
            ..Default::default()
        };
        let otra = ClientConfig { received_dir: Some("/etc".into()), ..Default::default() };
        let sin = ClientConfig::default();
        assert!(check_received_dir_unchanged(Some(&actual), &mismo).is_ok());
        assert!(check_received_dir_unchanged(Some(&actual), &otra).is_err());
        assert!(check_received_dir_unchanged(Some(&actual), &sin).is_err());
        assert!(check_received_dir_unchanged(None, &sin).is_ok());
        assert!(check_received_dir_unchanged(None, &otra).is_err());
    }

    #[test]
    fn fijar_y_quitar_la_carpeta_conserva_lo_demas() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("config.json");
        fs::write(&p, r#"{"serverUrl":"https://pc.t.ts.net","app":{"setupDone":true}}"#).unwrap();
        let dir = tmp.path().join("recibidos");
        let cfg = set_received_dir_at(&p, Some(dir.clone())).unwrap();
        assert_eq!(cfg.received_dir.as_deref(), Some(dir.to_str().unwrap()));
        let v: Value = serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["app"]["setupDone"], true);
        assert_eq!(v["serverUrl"], "https://pc.t.ts.net");
        assert!(set_received_dir_at(&p, None).unwrap().received_dir.is_none());
        assert!(set_received_dir_at(&p, Some(PathBuf::from("relativa"))).is_err());
    }

    #[test]
    fn carpeta_por_defecto() {
        assert_eq!(
            default_received_dir(Path::new("/home/a")),
            PathBuf::from("/home/a/Devi/recibidos")
        );
    }
}
