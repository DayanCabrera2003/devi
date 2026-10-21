//! Tailscale visto desde este equipo: quién soy (login) y si `tailscale serve` publica Devi.
//! El login está en `User["<Self.UserID>"].LoginName` de `tailscale status --json`
//! (PeerStatus no tiene UserProfile).

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleSelf {
    pub login: String,
    /// Nombre MagicDNS sin el punto final, p. ej. "pc-dayan.tail1234.ts.net".
    pub dns_name: String,
}

pub fn parse_self(json: &str) -> Result<TailscaleSelf, String> {
    let v: Value = serde_json::from_str(json)
        .map_err(|e| format!("la salida de `tailscale status --json` no es JSON válido: {e}"))?;
    let state = v.get("BackendState").and_then(Value::as_str).unwrap_or("desconocido");
    if state != "Running" {
        return Err(format!("Tailscale no está conectado (estado: {state}). Ábrelo e inicia sesión."));
    }
    let me = v.get("Self").ok_or("la salida de tailscale no incluye Self")?;
    if me.get("Tags").and_then(Value::as_array).is_some_and(|t| !t.is_empty()) {
        return Err("este equipo está etiquetado (tags) en Tailscale: no tiene un login de persona".into());
    }
    let uid = me.get("UserID").and_then(Value::as_u64).ok_or("Self no trae UserID")?;
    let login = v
        .get("User")
        .and_then(|u| u.get(uid.to_string()))
        .and_then(|p| p.get("LoginName"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("no encuentro el login de este equipo en `tailscale status`")?;
    let dns_name = me.get("DNSName").and_then(Value::as_str).unwrap_or("").trim_end_matches('.').to_string();
    Ok(TailscaleSelf { login: login.to_string(), dns_name })
}

/// ¿`tailscale serve status --json` tiene un proxy hacia 127.0.0.1:<port>?
pub fn serve_points_to(json: &str, port: u16) -> bool {
    // El puerto debe ser exacto: tras "127.0.0.1:4747" no puede seguir otro dígito (47470).
    ["127.0.0.1", "localhost"].iter().any(|host| {
        let needle = format!("{host}:{port}");
        json.match_indices(&needle)
            .any(|(i, _)| !json[i + needle.len()..].starts_with(|c: char| c.is_ascii_digit()))
    })
}

fn candidates() -> Vec<PathBuf> {
    let mut c = vec![PathBuf::from("tailscale")];
    if cfg!(target_os = "macos") {
        c.push("/Applications/Tailscale.app/Contents/MacOS/Tailscale".into());
    }
    if cfg!(windows) {
        c.push(r"C:\Program Files\Tailscale\tailscale.exe".into());
    }
    c
}

fn run_tailscale(args: &[&str]) -> Result<String, String> {
    for bin in candidates() {
        let mut cmd = Command::new(&bin);
        cmd.args(args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: sin consola parpadeando
        }
        match cmd.output() {
            Ok(out) if out.status.success() => return Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
            Ok(out) => {
                return Err(format!(
                    "`tailscale {}` falló: {}",
                    args.join(" "),
                    String::from_utf8_lossy(&out.stderr).trim()
                ))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("no se pudo ejecutar tailscale: {e}")),
        }
    }
    Err("no encuentro el comando `tailscale`: instálalo desde https://tailscale.com/download".into())
}

#[tauri::command]
pub async fn tailscale_self_login() -> Result<TailscaleSelf, String> {
    tauri::async_runtime::spawn_blocking(|| parse_self(&run_tailscale(&["status", "--json"])?))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tailscale_serve_configured(port: Option<u16>) -> Result<bool, String> {
    let port = port.unwrap_or(4747);
    tauri::async_runtime::spawn_blocking(move || {
        run_tailscale(&["serve", "status", "--json"]).map(|out| serve_points_to(&out, port))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATUS: &str = r#"{
      "BackendState": "Running",
      "Self": { "UserID": 12345, "DNSName": "pc-dayan.tail1234.ts.net.", "Tags": null },
      "User": { "12345": { "ID": 12345, "LoginName": "dayan@example.com", "DisplayName": "Dayan" } }
    }"#;

    #[test]
    fn lee_login_y_nombre_dns() {
        assert_eq!(
            parse_self(STATUS).unwrap(),
            TailscaleSelf { login: "dayan@example.com".into(), dns_name: "pc-dayan.tail1234.ts.net".into() }
        );
    }

    #[test]
    fn tailscale_parado() {
        let err = parse_self(&STATUS.replace("Running", "Stopped")).unwrap_err();
        assert!(err.contains("Stopped"), "{err}");
    }

    #[test]
    fn equipo_etiquetado_no_tiene_login() {
        assert!(parse_self(&STATUS.replace(r#""Tags": null"#, r#""Tags": ["tag:server"]"#)).is_err());
    }

    #[test]
    fn falta_el_usuario() {
        assert!(parse_self(&STATUS.replace(r#""12345": {"#, r#""999": {"#)).is_err());
        assert!(parse_self("no es json").is_err());
    }

    #[test]
    fn serve_apunta_al_puerto() {
        let serve = r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"pc:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4747"}}}}}"#;
        assert!(serve_points_to(serve, 4747));
        assert!(!serve_points_to(serve, 5000));
        assert!(!serve_points_to("{}", 4747));
        // Solo el puerto exacto: 47470 no es 4747.
        assert!(!serve_points_to(&serve.replace(":4747", ":47470"), 4747));
        assert!(serve_points_to(&serve.replace("127.0.0.1:4747", "localhost:4747/"), 4747));
    }
}
