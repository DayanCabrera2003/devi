//! El binario `devi` empaquetado como sidecar. Desde la UI solo se permiten
//! `install-integration [--json]`, `doctor` y `shell-alias install|remove|status --json`; el modo servidor tiene comandos propios y su proceso
//! se mata al salir de la app.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Invocaciones exactas permitidas desde la UI (nunca `--from`, `--bin-dir`… ni `server`/`mcp`).
const ALLOWED: [&[&str]; 6] = [
    &["install-integration"],
    &["install-integration", "--json"],
    &["doctor"],
    &["shell-alias", "install"],
    &["shell-alias", "remove"],
    &["shell-alias", "status", "--json"],
];
pub const LOG_LINES: usize = 200;
pub const SERVER_PORT: u16 = 4747;

#[derive(Default)]
pub struct ServerState(Mutex<ServerInner>);

/// Genérico solo para poder probar la lógica sin un proceso real (`C = CommandChild` en la app).
struct ServerInner<C = CommandChild> {
    child: Option<C>,
    /// Sube con cada arranque. La tarea que lee los eventos de un proceso lleva su generación:
    /// si el servidor se paró y se volvió a arrancar, los eventos del viejo ya no tocan al nuevo.
    generation: u64,
    log: VecDeque<String>,
    exit_code: Option<i32>,
}

impl<C> Default for ServerInner<C> {
    fn default() -> Self {
        Self { child: None, generation: 0, log: VecDeque::new(), exit_code: None }
    }
}

impl<C> ServerInner<C> {
    /// Registra un proceso recién arrancado y devuelve su generación.
    fn attach(&mut self, child: C) -> u64 {
        self.generation += 1;
        self.child = Some(child);
        self.exit_code = None;
        self.log.clear();
        self.generation
    }

    /// Suelta el proceso actual (para matarlo). Su generación sigue siendo la actual hasta el
    /// próximo `attach`, así que su aviso de fin aún se registra.
    fn detach(&mut self) -> Option<C> {
        self.child.take()
    }

    fn is_current(&self, generation: u64) -> bool {
        generation == self.generation
    }

    /// Fin del proceso de esa generación; si ya hay otro más nuevo, se ignora.
    fn on_terminated(&mut self, generation: u64, code: Option<i32>) {
        if !self.is_current(generation) {
            return;
        }
        self.child = None;
        self.exit_code = code;
        push_log(&mut self.log, format!("el servidor terminó (código {code:?})"));
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    running: bool,
    pid: Option<u32>,
    exit_code: Option<i32>,
    log: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

pub fn check_args(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("falta el subcomando de devi".into());
    }
    if ALLOWED.iter().any(|allowed| allowed.iter().copied().eq(args.iter().map(String::as_str))) {
        Ok(())
    } else {
        Err(format!("invocación de devi no permitida desde la app: {}", args.join(" ")))
    }
}

pub fn server_args(admin_login: &str) -> Result<Vec<String>, String> {
    let login = admin_login.trim();
    if login.is_empty() || login.starts_with('-') || login.chars().any(char::is_whitespace) {
        return Err(format!("login de admin inválido: {admin_login:?}"));
    }
    Ok(vec!["server".into(), "--admin".into(), login.into()])
}

pub fn push_log(log: &mut VecDeque<String>, line: String) {
    if log.len() >= LOG_LINES {
        log.pop_front();
    }
    log.push_back(line);
}

/// ¿Está libre el puerto en loopback? Si no, seguramente quedó un servidor de antes.
pub fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Solo en builds de desarrollo: DEVI_SERVER_EXTRA_ARGS (p. ej. "--dev --data-dir /tmp/x") permite
/// probar el modo servidor sin tocar los datos reales (Task 24). En release no existe.
#[cfg(debug_assertions)]
fn dev_extra_args() -> Vec<String> {
    std::env::var("DEVI_SERVER_EXTRA_ARGS")
        .map(|v| v.split_whitespace().map(String::from).collect())
        .unwrap_or_default()
}

#[cfg(not(debug_assertions))]
fn dev_extra_args() -> Vec<String> {
    Vec::new()
}

fn status_of(inner: &ServerInner) -> ServerStatus {
    ServerStatus {
        running: inner.child.is_some(),
        pid: inner.child.as_ref().map(CommandChild::pid),
        exit_code: inner.exit_code,
        log: inner.log.iter().cloned().collect(),
    }
}

#[tauri::command]
pub async fn run_devi(app: AppHandle, args: Vec<String>) -> Result<DeviOutput, String> {
    check_args(&args)?;
    let out = app
        .shell()
        .sidecar("devi")
        .map_err(|e| e.to_string())?
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("no se pudo ejecutar devi: {e}"))?;
    Ok(DeviOutput {
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

#[tauri::command]
pub fn start_server(app: AppHandle, state: State<'_, ServerState>, admin_login: String) -> Result<ServerStatus, String> {
    let mut args = server_args(&admin_login)?;
    args.extend(dev_extra_args());
    let mut inner = state.0.lock().map_err(|_| "estado del servidor bloqueado")?;
    if inner.child.is_some() {
        return Ok(status_of(&inner));
    }
    if !port_free(SERVER_PORT) {
        return Err(format!(
            "Ya hay un servidor de Devi en el puerto {SERVER_PORT} (¿quedó abierto de antes?). Ciérralo o reinicia el equipo y vuelve a intentarlo."
        ));
    }
    let (mut rx, child) = app
        .shell()
        .sidecar("devi")
        .map_err(|e| e.to_string())?
        .args(&args)
        .spawn()
        .map_err(|e| format!("no se pudo arrancar el servidor: {e}"))?;
    let generation = inner.attach(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let state = handle.state::<ServerState>();
            let Ok(mut inner) = state.0.lock() else { break };
            // Proceso de un arranque anterior: su salida no se mezcla con la del actual.
            if !inner.is_current(generation) {
                continue;
            }
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    push_log(&mut inner.log, String::from_utf8_lossy(&bytes).trim_end().to_string())
                }
                CommandEvent::Error(e) => push_log(&mut inner.log, format!("error: {e}")),
                CommandEvent::Terminated(p) => inner.on_terminated(generation, p.code),
                _ => {}
            }
        }
    });
    Ok(status_of(&inner))
}

#[tauri::command]
pub fn stop_server(state: State<'_, ServerState>) -> Result<ServerStatus, String> {
    let mut inner = state.0.lock().map_err(|_| "estado del servidor bloqueado")?;
    if let Some(child) = inner.detach() {
        child.kill().map_err(|e| format!("no se pudo detener el servidor: {e}"))?;
        push_log(&mut inner.log, "servidor detenido desde la app".into());
    }
    Ok(status_of(&inner))
}

#[tauri::command]
pub fn server_status(state: State<'_, ServerState>) -> Result<ServerStatus, String> {
    let inner = state.0.lock().map_err(|_| "estado del servidor bloqueado")?;
    Ok(status_of(&inner))
}

/// Se llama al salir de la app: el servidor sidecar nunca queda huérfano.
pub fn kill_server(app: &AppHandle) {
    if let Some(state) = app.try_state::<ServerState>() {
        if let Ok(mut inner) = state.0.lock() {
            if let Some(child) = inner.detach() {
                let _ = child.kill();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn solo_subcomandos_permitidos() {
        assert!(check_args(&v(&["doctor"])).is_ok());
        assert!(check_args(&v(&["install-integration"])).is_ok());
        assert!(check_args(&v(&["install-integration", "--json"])).is_ok());
        assert!(check_args(&v(&["shell-alias", "install"])).is_ok());
        assert!(check_args(&v(&["shell-alias", "remove"])).is_ok());
        assert!(check_args(&v(&["shell-alias", "status", "--json"])).is_ok());
        assert!(check_args(&v(&["shell-alias", "status"])).is_err());
        assert!(check_args(&v(&["shell-alias", "install", "--json"])).is_err());
        assert!(check_args(&v(&["shell-alias"])).is_err());
        // --from instalaría otro binario: nunca desde el webview.
        assert!(check_args(&v(&["install-integration", "--from", "/tmp/x"])).is_err());
        assert!(check_args(&v(&["doctor", "--fix"])).is_err());
        assert!(check_args(&v(&["server"])).is_err());
        assert!(check_args(&v(&["mcp"])).is_err());
        assert!(check_args(&v(&[])).is_err());
    }

    #[test]
    fn argumentos_del_servidor() {
        assert_eq!(server_args(" dayan@x ").unwrap(), v(&["server", "--admin", "dayan@x"]));
        assert!(server_args("").is_err());
        assert!(server_args("--import").is_err());
        assert!(server_args("a b").is_err());
    }

    #[test]
    fn detecta_el_puerto_ocupado() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(!port_free(port));
        drop(listener);
        assert!(port_free(port));
    }

    #[test]
    fn el_log_tiene_tope() {
        let mut log = VecDeque::new();
        for i in 0..(LOG_LINES + 5) {
            push_log(&mut log, format!("l{i}"));
        }
        assert_eq!(log.len(), LOG_LINES);
        assert_eq!(log.front().unwrap(), "l5");
    }

    #[test]
    fn un_terminated_viejo_no_borra_el_servidor_nuevo() {
        // Parar y arrancar enseguida: el aviso de fin del primer proceso llega tarde.
        let mut inner: ServerInner<u32> = ServerInner::default();
        let g1 = inner.attach(1);
        inner.detach();
        let g2 = inner.attach(2);
        assert_ne!(g1, g2);
        assert!(!inner.is_current(g1));
        inner.on_terminated(g1, Some(0));
        assert_eq!(inner.child, Some(2));
        assert_eq!(inner.exit_code, None);
        inner.on_terminated(g2, Some(1));
        assert_eq!(inner.child, None);
        assert_eq!(inner.exit_code, Some(1));
    }
}
