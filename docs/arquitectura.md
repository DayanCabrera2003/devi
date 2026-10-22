# Arquitectura de Devi

## Objetivo

Devi conecta las sesiones de Claude Code de un equipo. Cuando alguien necesita algo de un compañero, su agente prepara una solicitud; el compañero la recibe en la app de escritorio y decide si la hace él, la rechaza o la envía a una de sus sesiones de Claude Code. La respuesta vuelve por el mismo camino.

Principios:

- **Siempre decide una persona.** Todo lo que un agente envía (solicitud o respuesta) queda como borrador hasta que su humano lo autoriza en la app, y todo lo que llega espera en la app hasta que quien lo recibe decide qué hacer.
- **Una solicitud nunca es una orden.** Al agente que la recibe se le presenta como una pregunta abierta de un compañero.
- **Identidad sin contraseñas.** La da Tailscale: el login de la tailnet es la identidad en Devi.
- **Coste cero.** Sin servicios de pago, sin firma de código del SO, CI gratuito.
- **Modular.** Cada feature del servidor es un módulo; añadir una no toca el núcleo.

Fuera de alcance: tiendas de apps, clientes móviles, integraciones distintas de Claude Code y cifrado de extremo a extremo (el transporte ya va cifrado por Tailscale y HTTPS).

## Componentes

```
 Claude Code (dayan) ─stdio─ devi mcp ─HTTP/SSE─┐                         ┌─HTTP/SSE─ App Devi (dayan)
                       └──── devi hook ─HTTP────┤                         │
                                                ├─ tailscale serve ─ devi server ─ SQLite + files/
 Claude Code (maria) ─stdio─ devi mcp ─HTTP/SSE─┘   (HTTPS, identidad)          └─HTTP/SSE─ App Devi (maria)
```

| Pieza | Dónde | Qué hace |
|---|---|---|
| Protocolo | `packages/protocol` | Esquemas zod, tipos, rutas de la API, eventos SSE, permisos, límites y `API_VERSION`. Sin dependencias de runtime. Lo comparten todos. |
| Servidor | `packages/server` | `devi server`. La única fuente de verdad: núcleo HTTP/SSE + módulos sobre SQLite. |
| Cliente | `packages/client` | Cliente HTTP/SSE tipado (`createClient`): cabeceras de versión, validación de respuestas y eventos, reconexión y latidos de presencia. Lo usan la CLI y la app. |
| CLI | `packages/cli` | Binario `devi` (Bun compilado, nadie necesita Bun instalado): `server`, `mcp`, `hook`, `claude`, `doctor`, `install-integration`, `shell-alias`. |
| Plugin | `plugin/devi` | Plugin de Claude Code: declara el MCP `devi` (`devi mcp`), su canal y los hooks `SessionStart`, `UserPromptSubmit` y `Stop` en forma exec (portables a Windows). |
| App de escritorio | `apps/desktop` | Tauri v2 + Svelte 5. Bandeja de tarjetas, autorizaciones, selector de sesiones, ajustes, Admin y modo servidor. |
| Despliegue | `deploy/servidor-linux` | Servicio systemd del servidor y actualizador automático desde las releases. |

### Servidor

- Escucha en un **socket Unix** (`--socket`, producción) o en `127.0.0.1:<puerto>` (`--port`, por defecto 4747: desarrollo y la app en modo servidor). `tailscale serve` lo publica en `https://<pc>.<tailnet>.ts.net`.
- Datos en `--data-dir` (por defecto el directorio de datos del SO): `devi.db` (SQLite) y `files/`.
- API bajo `/api/v1`. Cada cliente manda su versión en `X-Devi-Version` (en los SSE, en `?v=`, porque `EventSource` no admite cabeceras). Cliente y servidor son compatibles si comparten la versión mayor; si no, `426` con la versión mínima.
- Arranque: `devi server --admin <login>` es obligatorio mientras no haya ningún admin, así nadie de la tailnet puede adelantarse a quedarse como admin. `--import team.json` importa un equipo una sola vez. `--allowed-domain` limita los logins aceptados.

### CLI y plugin

| Subcomando | Qué hace |
|---|---|
| `devi server` | Arranca el servidor (como servicio del SO o como sidecar de la app). |
| `devi mcp` | Servidor MCP por stdio y canal de Claude Code. Herramientas de lectura: `whoami`, `list_teammates`, `get_conversation`, `list_pending`, `get_request`, `search_knowledge`; de envío: `send_request` (con `kind: handoff` para traspasos), `respond_to_request` (con `share_with_team` para guardar la respuesta en la base del equipo). Prompts: `pedir`, `pendientes`, `equipo`, `traspaso`. |
| `devi hook <start\|working\|idle>` | Lo llaman los hooks: marca la sesión como trabajando o libre y, sin canal, entrega lo pendiente (ver más abajo). Nunca falla ni bloquea. |
| `devi claude [--session <nombre>] [--handoff <id>] [-- args]` | Lanza `claude` con el canal de Devi cargado. Con `--handoff`, empieza con el traspaso `<id>` de un compañero como prompt inicial (contexto a verificar). |
| `devi doctor` | Diagnóstico: Tailscale, servidor, login, plugin y política de canales. |
| `devi install-integration` | Copia el binario a una ruta estable e instala el plugin desde un marketplace local (`devi@devi-local`). Lo usa el asistente de la app. |
| `devi shell-alias` | Instala o quita la función `claude` en los perfiles de shell para que `claude` abra la sesión con el canal. |

La configuración del cliente (URL del servidor) vive en `devi/config.json` del directorio de configuración del SO; la escribe la app.

**Plugin.** `plugin/` es la copia de referencia que genera `scripts/gen-plugin.ts` (la instalación real la escribe `devi install-integration` con la ruta absoluta del binario): el MCP, el canal, los hooks `SessionStart`, `UserPromptSubmit` y `Stop`, y la skill `devi` (`skills/devi/SKILL.md`, guía completa para el agente; su fuente es `packages/cli/src/skill.md`). Las instrucciones del MCP son solo el núcleo, por debajo del corte de 4.096 caracteres de Claude Code.

**Emparejamiento de sesiones.** Ver [Identidad y sesiones](#identidad-y-sesiones).

### App de escritorio

- **Tray** con el icono de Devi (punto de acento si hay pendientes) y un **panel de avisos** (ventana `avisos`, 360 × 520, con las mismas acciones que la app y su propia conexión mientras se usa): clic izquierdo en macOS y Windows, "Ver avisos (N)" del menú en Linux. **Mascota flotante** opcional (Ajustes → Mostrar a Devi flotando; ventana transparente creada bajo demanda). Sin tray (GNOME sin extensión) cerrar la ventana la minimiza. Notificaciones nativas y arranque al iniciar sesión.
- **Asistente de primer arranque**: comprueba Tailscale, pide la URL del servidor o activa «Este equipo es el servidor», prueba la conexión, instala la integración con Claude Code y ejecuta `devi doctor`.
- **Modo servidor**: lanza `devi server` como sidecar y muestra el comando `tailscale serve` si falta.
- **Vistas**: Bandeja (borradores por autorizar, solicitudes, respuestas, plazos vencidos), conversaciones por compañero (con envío directo desde la app), selector de sesiones, Ajustes y Admin (Personas · Roles · Servidor · Auditoría; solo con `team.admin`).
- **Humor de Devi** (`lib/mood.ts`, el mismo en la ventana principal, la mascota flotante y el panel de avisos): sin conexión gris; contenta (ojos ^ ^) unos segundos al llegar una respuesta; inquieta (tiembla y suda) si algo venció (una solicitud mía caducó o una que me piden pasó su plazo); atenta (mira hacia abajo) con pendientes; dormida (ojos cerrados y «z z») tras 10 minutos sin pendientes ni novedades. Con `prefers-reduced-motion` cambia de cara pero no se mueve.
- **Tu semana**: resumen de los últimos 7 días (enviadas, recibidas, respondidas, tiempo medio de respuesta y a quién más ayudaste). Los lunes sale sola en la barra lateral hasta que se descarta (`app.weekDismissed` en `config.json`, con la semana ISO); siempre se puede abrir desde el icono del calendario.
- **Adjuntar archivos** al enviar desde la app: el webview nunca elige rutas. `pick_files` abre el diálogo nativo en Rust; al soltar archivos sobre la ventana principal, Rust recibe `WindowEvent::DragDrop` y emite `devi://drag-hover` (`{ active }`) y `devi://files-dropped`. En los dos casos Rust lee y valida cada archivo (texto UTF-8 sin NUL, ≤ 1 MB, ≤ 5 por vez), guarda los aceptados en memoria con un token aleatorio (como máximo 20; se olvidan los más antiguos) y devuelve `PickResult` (`files`: token, nombre, tamaño y los primeros 4 KB; `rejected`: nombre y motivo). Al enviar, `take_files(tokens)` entrega el contenido y lo borra; `discard_files` lo descarta. Tauri también emite sus propios `tauri://drag-*` con rutas y no se pueden desactivar sin perder `DragDrop`: la UI no los escucha y el webview no tiene plugin `fs` ni protocolo `asset`, así que una ruta no le sirve para leer nada.
- La UI habla con el servidor directamente por HTTP/SSE desde el webview con `@devi/client`. Rust solo hace lo nativo: tray, ventanas, sidecar, rutas, Tailscale local y guardar archivos recibidos (`save_received_files`, con nombres saneados y confinado a la carpeta de recibidos; el webview no tiene permiso general de escritura en disco).

## Protocolo y módulos

### Rutas

Todas las rutas están declaradas en `API` (`packages/protocol/src/api.ts`) con su método, ruta, permiso, actor, esquema del cuerpo y de la respuesta, y si es una **acción humana**. El servidor y los clientes usan la misma tabla.

| Ruta | Quién | Uso |
|---|---|---|
| `GET /health` | cualquiera | Salud y versión (sin identidad). |
| `GET /me` · `GET /team` | miembro | Persona, permisos efectivos; equipo con roles, capacidades y presencia. |
| `GET /me/prefs` · `PATCH /me/prefs` | miembro (solo lo suyo; PATCH humana) | Preferencias de la persona: `sessionNotices` (aviso en sus sesiones al llegarle una solicitud, activado por defecto). |
| `GET /me/week` | miembro (solo lo suyo) | «Tu semana»: enviadas y recibidas (por creación), respondidas y tiempo medio de respuesta (por fecha de respuesta) y las 3 personas a las que más ayudó (sin contar rechazos), en los últimos 7 días. |
| `POST/PATCH/DELETE /team/members[/:id]` · `/team/roles[/:id]` | admin, humana | Personas y roles. |
| `GET/PATCH /settings` · `GET /settings/export` | admin (PATCH y export humanas) | Ajustes del servidor y copia de `devi.db`. |
| `GET /audit?limit=&before=&features=` | admin | Registro de auditoría, paginado por id. Sin `features=audit_in_chat` (app anterior), `request.taken_in_chat` y `request.declined_in_chat` salen como `request.forwarded` / `request.rejected` con `via: "chat"`. |
| `POST /sessions` · `DELETE /sessions/:id` · `POST /sessions/hook` | miembro / dueño | El MCP registra o cierra su sesión; los hooks informan del estado. |
| `GET /sessions/inbox` · `POST /sessions/inbox/ack` | dueño | Entregas pendientes de una sesión sin canal. |
| `GET /members/:id/sessions` | miembro | Sesiones vivas de una persona (selector). |
| `POST /presence/heartbeat` | miembro | Latido de presencia (app y MCP). |
| `POST /drafts` | `requests.send` (+ `files.send` con archivos) | Borrador de solicitud o respuesta (multipart: `meta` JSON + archivos). |
| `POST /drafts/:id/authorize` · `/discard` | autor, humana | Autorizar o descartar un borrador. |
| `POST /requests` | `requests.send` (+ `files.send` con archivos), humana | Solicitud escrita en la app (multipart: `meta` = `{ to, message }` + archivos). Sale ya en `pending`, sin borrador; mismos límites de ritmo que los borradores. |
| `GET /conversations` | miembro | Una fila por compañero activo: última actividad (fecha, 120 caracteres, si fue mía) y cuántas cosas esperan mi acción. |
| `GET /pending` | miembro | Lo que espera a quien llama (solicitudes para mí, respuestas sin aceptar, caducadas, borradores por autorizar) y sus solicitudes abiertas. Lo usa `list_pending`. |
| `GET /requests/:id` | remitente o destinatario | Una solicitud (404 para cualquier otro). Lo usa `get_request`. |
| `GET /conversations/:memberId?before=&limit=` | miembro (solo las suyas) | Solicitudes entre quien llama y esa persona, en los dos sentidos, de la más nueva a la más vieja (30 por defecto, hasta 100). |
| `POST /requests/:id/forward` · `/accept` · `/reject` | destinatario, humana | Decisiones de quien recibe. |
| `POST /requests/:id/take` · `/decline` | destinatario (no humana) | Traer a la sesión que llama (`{ sessionId, approval }`) o rechazar con motivo (`{ sessionId, reason, approval }`) desde Claude Code (`take_request` / `decline_request`). Solo con `approval: "chat"` y el ajuste `chatApproval` activo; si no, `403 chat_approval_unavailable`. Ver «Atender desde Claude Code». |
| `POST /requests/:id/response/accept` · `/response/forward` | remitente, humana | Decisiones sobre la respuesta. |
| `POST /requests/:id/resend` · `/ignore` | remitente, humana | Tras un plazo vencido. |
| `GET /knowledge?q=&limit=` | miembro | Base del equipo: búsqueda de texto completo (sin `q`, las más recientes; 10 por defecto, hasta 50). Lo usa `search_knowledge`. |
| `DELETE /knowledge/:id` | quien respondió o admin, humana | Retirar una entrada de la base del equipo. |
| `POST /requests/:id/reassign` | remitente, `requests.send` (+ `files.send` con archivos), humana | Pedírselo a otra persona (`{ to }`), con la solicitud en `pending` o `timed_out`: crea una nueva con el mismo mensaje, origen y archivos (copiados) y cierra la original con `closed_note` «Reenviada a …» y `replaced_by`. |
| `GET /files/:id` | remitente o destinatario | Descargar un archivo. |
| `GET /events/user` · `GET /events/session/:id` | miembro / dueño | SSE de la app y del MCP. |
| `POST /debug/push` | admin | Solo en modo dev (404 en producción). |

### Eventos

**SSE de usuario** (app): `draft.awaiting`, `draft.discarded`, `request.incoming`, `request.updated`, `response.incoming`, `request.timed_out`, `request.escalated` (solo al autor: sigue sin respuesta al cumplirse el plazo de escalado), `conversation.updated` (`{ memberId }`: cambió una solicitud o borrador con esa persona; llega a las dos partes), `team.updated`, `sessions.updated`, `knowledge.saved` / `knowledge.refused` (a quien respondió: su respuesta entró en la base del equipo o no se publicó por posibles secretos) y, solo a admins, `audit.alert`. Al conectar, el servidor reenvía las tarjetas abiertas.

**Compatibilidad.** Un MCP o un hook anteriores validan los `kind` con un enum cerrado. Por eso el servidor solo manda un `kind` nuevo a las sesiones que lo declararon en `features` al registrarse, y `@devi/client` valida la bandeja entrega a entrega: una con un `kind` que no conoce se salta (y se apunta en el log con `onIgnored`) sin perder las demás; lo mismo con el SSE de sesión.

**SSE de sesión** (MCP → canal): un único evento `deliver` con `kind` = `request`, `response`, `draft_authorized`, `draft_discarded`, `escalation` (una solicitud tuya sigue sin respuesta), `request_notice` (te llegó una solicitud: resumen para atenderla desde la sesión) o `debug`, el texto para el agente y los atributos del canal (`request_id`, `draft_id`, rutas de archivos…).

### Núcleo y módulos del servidor

El núcleo (`packages/server/src/core`) ofrece router, SSE, SQLite con migraciones, identidad, presencia, límites de ritmo, reloj inyectable, bus de eventos y registro de servicios. Cada petición pasa por este orden:

1. `Origin`, si viene, debe estar en la lista permitida (orígenes de Tauri y, en dev, el de Vite); si no, `403 origin`.
2. Versión compatible, o `426`.
3. Identidad (`IdentityProvider`): `TailscaleServeIdentity` lee `Tailscale-User-Login`; `DevIdentity` (solo `--dev` en loopback) la toma de `X-Devi-Dev-User`. Sin identidad, `401`.
4. Dominio permitido (`allowedDomains`), o `403 domain`.
5. Login del equipo, o `403 unknown_login` (la app muestra el login para pedir al admin que lo añada).
6. Ruta humana sin `Origin`: `403 human_only`.
7. Permiso de la ruta, o `403 missing_perm`.
8. Límite de ritmo por persona (borradores aparte; latidos y lecturas no cuentan), o `429` con `Retry-After`.

Las comprobaciones de actor (autor, destinatario, remitente, dueño) las hace cada módulo.

Módulos, en el orden en que se registran (`MODULES` en `packages/server/src/main.ts`):

| Módulo | Responsabilidad |
|---|---|
| `team` | Personas, logins, roles, capacidades y permisos. Resuelve login → persona y permisos. Bootstrap del admin e importación de `team.json`. |
| `settings` | Ajustes del servidor (plazos, retención, dominios permitidos) y exportación de la base. |
| `prefs` | Preferencias de cada persona (`member_prefs`), p. ej. el aviso en sus sesiones. |
| `audit` | Registro de auditoría y avisos `audit.alert`. |
| `sessions` | Sesiones de Claude Code, estado trabajando/libre, presencia y bandeja de entregas. |
| `files` | Validación, almacenamiento, descarga y retención de archivos. |
| `requests` | Borradores, solicitudes, respuestas y plazos. |
| `knowledge` | Base de conocimiento del equipo: indexa con FTS5 las respuestas compartidas, búsqueda y retirada. |

Los módulos no se importan entre sí: se comunican por el **bus** (`draft.discarded`, `request.closed`, `session.closed`, `request.shared`) y por **servicios** que se ofrecen en `ctx.services` (`team`, `settings`, `sessions`, `files`, `audit`, `prefs`).

## Modelo de datos

SQLite (`bun:sqlite`), con migraciones versionadas por módulo (`schema_versions`).

```
members        id, login (único), name, description, created_at, disabled_at
roles          id, name (único), color
role_caps      role_id, position, text            -- capacidades que lee el agente
role_perms     role_id, perm                      -- permisos de Devi
member_roles   member_id, role_id
settings       key, value (JSON)                  -- solo los que el admin cambia
sessions       id, member_id, name, cwd, parent_pid, status (idle|working),
               claude_session_id, last_seen, channel, machine, instance_id
session_inbox  id, session_id, kind, content, meta, created_at, acked_at
drafts         id, kind (request|response), author_member, author_session, author_session_name,
               to_member (request), request_id (response), message,
               status (awaiting|authorized|discarded), created_at, expires_at, context, share_with_team,
               request_kind (request|handoff)
requests       id, origin (session|app), from_member, from_session, from_session_name, to_member, message,
               status, forwarded_session, outcome, outcome_text, created_at, sent_at, deadline,
               responded_at, context, kind (request|handoff), escalated_at, closed_note, replaced_by
files          id, draft_id, request_id, direction (request|response), name, size, sha256, path,
               author_member, peer_member, created_at, released_at, deleted_at
audit_log      id, at, actor_member_id, actor_login, action, target_type, target_id, details
knowledge_entries  id, request_id (único), question, answer, asked_by, answered_by, created_at
knowledge_fts      entry_id, question, answer   -- FTS5, sin acentos ni mayúsculas
```

- Los **borradores** son una tabla aparte: una solicitud de un agente solo existe en `requests` cuando su borrador se autoriza. Las escritas en la app (`origin = app`) se crean directamente, con `from_session` y `from_session_name` vacíos y sus archivos ya unidos a la solicitud (`draft_id` vacío).
- **Traspasos de sesión** (`kind = handoff`): una solicitud con el contexto de un trabajo (estado, decisiones, próximos pasos, archivos clave, riesgos y dudas) para que otra persona lo continúe. Sigue el mismo ciclo (borrador, autorización, aceptar, rechazar, reenviar). Al entregarse a una sesión va encuadrado como contexto a verificar, nunca órdenes, con `meta.request_kind = handoff`. `devi claude --handoff <id>` lo descarga con `GET /requests/:id` (solo el destinatario) y abre Claude Code con él como prompt inicial, también encuadrado.
- **Permisos** (`packages/protocol/src/perms.ts`): `requests.send`, `files.send` y `team.admin`. Los de una persona son la unión de los de sus roles. Siempre debe quedar al menos un admin.
- **Ajustes por defecto**: plazo de una solicitud 1 h, aviso de escalado a los 30 min (`escalateAfterMs`; null lo desactiva), 15 min para autorizar un borrador, archivos 7 días tras cerrarse la solicitud y 30 días como máximo, dominios permitidos vacíos.
- **Base del equipo**: quien responde decide si guarda la respuesta («Guardar en la base del equipo» en la app al aceptar con nota, o `share_with_team` en `respond_to_request`; queda en el borrador como `share_with_team`). Al enviarse, `requests` emite `request.shared` y `knowledge` lo indexa: pregunta (el mensaje original), respuesta, quién preguntó, quién respondió y cuándo, nunca los archivos. Si el detector de secretos salta en la pregunta o en la respuesta, no se publica y se avisa a quien respondió. Al agente le llega encuadrada como cualquier texto de compañeros (`DEVI-UNTRUSTED`).
- **Auditoría**: solo se añade (un trigger impide modificar filas) y se borra a los 365 días. De los mensajes guarda su SHA-256, nunca el texto.

## Ciclo de vida

### Borradores

```
awaiting ──autorizar──▶ authorized   (request: crea la solicitud en pending)
   │                                 (response: responde la solicitud → answered)
   └─ descartar / caducar (15 min) ──▶ discarded   (la sesión autora recibe draft_discarded)
```

Al autorizar, la sesión autora recibe `draft_authorized`: así el agente sabe que el mensaje salió.

### Solicitudes

```
pending ──forward | take──▶ forwarded ──(borrador de respuesta autorizado)──▶ answered
   ├─accept─▶ accepted
   └─reject | decline─▶ rejected
pending|forwarded ──plazo──▶ timed_out ─resend─▶ pending
                                        └─ignore─▶ closed
pending|timed_out ──reassign──▶ closed   (y una solicitud nueva en pending para otra persona)
accepted|rejected|answered ──el remitente acepta o la envía a una sesión──▶ closed
```

- `respond_to_request` solo vale con la solicitud en `forwarded`. Hay como máximo un borrador de respuesta pendiente por solicitud; uno nuevo sustituye al anterior.
- Mientras haya un borrador de respuesta pendiente, el plazo de la solicitud se pausa. Si se descarta o caduca, la solicitud sigue en `forwarded` con un plazo nuevo completo.
- Aceptar y Rechazar desde la tarjeta son acciones humanas directas.
- Plazos y caducidades se guardan en SQLite y se reprograman al arrancar (`onStart`), así que sobreviven a reinicios.
- **Escalado.** Si la solicitud sigue en `pending` a los `escalateAfterMs` de `sent_at` (y eso cae antes del plazo), el servidor avisa al autor: `kind="escalation"` a su sesión de origen (a su bandeja, como el resto de entregas; las escritas en la app no tienen sesión) y `request.escalated` a su app. `escalated_at` hace que sea una sola vez por solicitud, también tras un reenvío o un reinicio (si venció con el servidor apagado, avisa al arrancar). Bajar el timeout por debajo del escalado no se rechaza: entonces no avisa. El servidor no elige a nadie: el agente propone (con `list_teammates`) y la persona decide, normalmente con «Pedírselo a otra persona» (`reassign`, auditoría `request.reassigned`).

### Atender desde Claude Code

Para atender una solicitud sin la app delante (p. ej. Claude Code en el móvil con Remote Control):

- **Aviso.** Cada vez que a B le llega una solicitud nueva en `pending` (autorizada, aprobada en el chat, escrita en la app, reenviada tras un plazo o pedida a otra persona), además de `request.incoming` a su app, el servidor entrega `kind="request_notice"` a **una** sesión: la viva de B con el latido más reciente de entre las que declararon entenderlo al registrarse (`features: ["request_notice"]` en `POST /sessions`; un MCP anterior no lo declara y nunca lo recibe, ni en la bandeja). Si ninguna lo declaró, no hay aviso: basta la tarjeta. Lleva quién, desde qué sesión, el `request_id`, cuántos archivos y un resumen del mensaje recortado a `NOTICE_LIMITS.summaryChars`, dentro de un bloque `DEVI-UNTRUSTED`; si el mensaje o el contexto dan aviso de inyección, lo dice. Va a la bandeja como el resto (sin canal lo inyecta el hook). B lo desactiva en Ajustes («Avisar en mis sesiones de Claude Code»), que se guarda en el módulo `prefs`.
- **take.** Igual que «Enviar a mi sesión», con destino la sesión que llama: la solicitud pasa a `forwarded` y la entrega (`requestContent`/`handoffContent`) se guarda en la bandeja y vuelve en la respuesta; el MCP la devuelve como resultado de `take_request`, descarga los archivos a la carpeta de recibidos y confirma la entrada. No se empuja por el SSE para no repetirla por el canal. Auditoría `request.taken_in_chat`.
- **decline.** Igual que Rechazar (motivo obligatorio). Auditoría `request.declined_in_chat` (con el SHA-256 del motivo).
- **Condiciones.** Las mismas que la aprobación en el chat de los envíos: el MCP solo manda `approval: "chat"` si su cliente es un Claude Code ≥ `MIN_CLAUDE_CODE_VERSION` (las dos herramientas llevan `anthropic/requiresUserInteraction`, así que el aviso de permisos sale en cada llamada), y el servidor exige además `chatApproval`. La sesión tiene que ser de B y estar viva, y la solicitud, `pending` (como el reenvío desde la app). `take` analiza mensaje, contexto y archivos con el mismo detector que las tarjetas de la app: con cualquier aviso (`409 injection`) no se trae y hay que revisarla en la app.

Una solicitud escrita en la app entra directamente en `pending` (auditoría `request.sent_from_app`) y sigue el mismo ciclo; nada supone que el remitente tenga una sesión: su respuesta se acepta o se envía a cualquiera de sus sesiones.

### Recorrido completo

1. **Enviar.** El agente de A llama a `send_request(to, message, context?, files?)`. El MCP resuelve las rutas respecto al `cwd` de la sesión, valida los archivos (texto UTF-8 sin NUL, ≤ 1 MB, ≤ 5) y busca secretos en el mensaje, el contexto y los archivos; después crea el borrador. El servidor repite la validación y comprueba permisos.
   - **Contexto** (opcional, límites en `CONTEXT_LIMITS`): `summary`, `tried`, `error` y `urgency` (`baja|normal|alta`) los pone el agente; el MCP añade `git` (rama, último commit y `git diff --stat` recortado a 50 líneas) ejecutando `git` en el `cwd` de la sesión, con un plazo de 2 s por orden y sin diff externo, textconv ni fsmonitor. Fuera de un repo, o sin git, no hay `git` y no es un error. El diff completo solo viaja como archivo adjunto. Se guarda como JSON en `drafts.context` y pasa a `requests.context` al enviarse; al agente receptor le llega dentro del mismo bloque `DEVI-UNTRUSTED` que el mensaje, y la app lo muestra plegado en la tarjeta (también en el borrador, antes de autorizar).
2. **Autorizar.** La app de A muestra «Claude quiere enviar esto a María» con el mensaje y la vista previa de los archivos. Al autorizar se crea la solicitud y B la recibe.
3. **Recibir.** La app de B muestra la tarjeta con la vista previa (nada se escribe en disco todavía) y avisos si el contenido parece una prompt injection. B elige Aceptar (nota opcional), Rechazar (motivo obligatorio) o Enviar a sesión.
4. **Enviar a sesión.** La sesión elegida recibe la entrega; el MCP (o el hook) descarga los archivos en `<carpeta de recibidos>/<request-id>/` con nombres saneados.
5. **Responder.** El agente de B llama a `respond_to_request(id, message, files?)`, que crea un borrador de respuesta; B lo autoriza.
6. **Cerrar.** A recibe la respuesta y la acepta o la envía a una de sus sesiones.

Los archivos se borran del servidor según la retención de los ajustes. Los ya descargados en las máquinas de las personas no se tocan.

## Entrega a la sesión

Claude Code solo carga un canal si la sesión se lanzó con un flag de canal. Devi funciona con y sin él.

**Con canal.** `devi claude` (o la función `claude` del shell) añade `--channels plugin:devi@devi-local` si la organización lo permite, o el flag de canales de desarrollo si no, y pone `DEVI_CHANNEL=1` en el entorno; el MCP lo hereda y registra la sesión con `channel: true`. Cada entrega llega por el SSE de sesión, el MCP la empuja al canal y la confirma por su `inbox_id`. Llega al momento, aunque la sesión esté esperando.

**Sin canal** (`claude` a secas, desde un IDE, u organizaciones sin canales). Cada entrega `request`, `response`, `draft_authorized` o `draft_discarded` se guarda en `session_inbox` en la misma transacción que el cambio de estado que la provoca. Los hooks `start` (SessionStart) y `working` (UserPromptSubmit) piden la bandeja, descargan los archivos con el mismo código que el MCP, devuelven el texto como `additionalContext` del hook (cada entrega en `<devi kind="…" request_id="…">`, recortado por debajo del límite de Claude Code) y confirman. Llega cuando la persona escribe en la sesión o la abre. Las entregas sin confirmar caducan a los 7 días.

El selector de sesiones de la app marca cada una como «en tiempo real» (con canal) o «al escribir» (sin canal).

## Identidad y sesiones

**La persona** sale siempre del login de Tailscale (cabecera `Tailscale-User-Login`), que corresponde a un miembro. Todas las sesiones de una persona, en la misma máquina o en otras, son el **mismo miembro**: `list_teammates`, las conversaciones y la presencia nunca la cuentan como compañera de sí misma, y no puede enviarse solicitudes (el servidor lo rechaza y `send_request` da un error que lo explica). Para pasar algo a otra de sus sesiones, la persona usa el selector de sesiones de la app al reenviar.

**Qué distingue una sesión de otra de la misma persona** (`RegisterSessionBody` y `HookBody`):

| Campo | Qué es |
|---|---|
| `parentPid` | PID de Claude Code. El MCP y los hooks son hijos directos suyos, así que lo comparten. |
| `machine` | Id estable de la máquina para la cuenta del SO: `<datos de Devi>/machine-id`, creado una vez y compartido por el MCP y los hooks (`DEVI_MACHINE_ID` lo fija). Un PID solo es único dentro de una máquina. |
| `instanceId` | Id aleatorio de cada proceso `devi mcp`, estable mientras vive. |
| `claudeSessionId` | `session_id` de Claude Code: lo mandan los hooks y, si lo conoce (`CLAUDE_CODE_SESSION_ID`), el MCP. |

**Registro** (`POST /sessions`):

1. Mismo `instanceId`: es una reconexión del mismo MCP (el servidor se reinició o se cayó el stream) y devuelve la misma sesión.
2. Si no, sustituye a las sesiones del mismo Claude Code (misma persona, máquina y PID): Claude Code relanzó su MCP. El MCP sustituido recibe `409 session_replaced` si vuelve a registrarse y deja de intentarlo.
3. **Nombre**: el que pide el MCP (la carpeta, o `--session`), único entre las sesiones activas de la persona: "api", "api (2)", "api (3)"… Dos Claude Code en la misma carpeta conviven; nunca se sustituye una sesión por llamarse igual. El MCP adopta el nombre que devuelve el servidor (`whoami`).

**Emparejamiento de los hooks** (`POST /sessions/hook` y `GET /sessions/inbox`), solo entre las sesiones **activas** de quien llama, nunca de otra persona ni una ya muerta (aunque el sistema reutilice su PID): primero mismo Claude Code (máquina y PID) y mismo `claudeSessionId`; después mismo Claude Code; por último mismo `claudeSessionId`. El PID manda sobre un `claudeSessionId` que otra sesión pudo heredar, así que el hook de una sesión nunca cambia el estado de otra ni recoge su bandeja.

**Cierre.** Al cerrarse stdin (Claude Code terminó) o con `SIGTERM`, `SIGINT` o `SIGHUP`, el MCP cierra su sesión en el servidor (`DELETE /sessions/:id`, con un plazo de 1,5 s si el servidor no responde) y sale. Las solicitudes reenviadas a esa sesión vuelven a `pending` para que la persona las reenvíe a otra.

**No soportado:** dos personas de Devi en la misma cuenta del SO. La configuración (`devi/config.json`), el id de máquina y los procesos son de la cuenta, así que todo lo que se lance desde ella cuenta como la misma persona.

## Presencia

Un SSE abierto no basta para saber que alguien está conectado: si el cliente se cae sin cerrar la conexión, el stream puede tardar en abortarse. Por eso la app y el MCP mandan `POST /presence/heartbeat` cada 20 s mientras tienen un SSE abierto. Una clave (`user:<id>` o `session:<id>`) está viva si tiene el stream abierto y un latido en los últimos 60 s; el servidor lo revisa cada 15 s y anuncia cada cambio una sola vez por el bus. `GET /team` y el selector de sesiones se basan en esto.

## Modelo de seguridad

- **Identidad.** La pone `tailscale serve` en `Tailscale-User-Login` (y borra la que traiga el cliente). Los dispositivos con tag no tienen login de persona y reciben `401`.
- **Socket Unix en producción.** Con un puerto TCP, cualquier proceso de la PC servidor podría conectarse a `127.0.0.1` y falsificar esa cabecera. En producción el servidor escucha en un socket `0600` dentro de un directorio `0700` del usuario `devi`; solo `devi` y root (`tailscaled`) llegan a él. El servidor avisa en el log si arranca en TCP fuera del modo dev.
- **Dos barreras de acceso.** La política de Tailscale (grants) decide quién llega a la PC; `--allowed-domain` y la lista del equipo deciden quién entra en Devi.
- **Acciones humanas solo desde la app.** Las rutas `human` exigen un `Origin` permitido, que el webview manda solo y la CLI y el MCP no. Así un agente no puede autorizar, responder ni administrar por su cuenta llamando a la API.
- **Aprobación en el chat.** Los envíos (`approval: "chat"` en `POST /drafts`) y atender una solicitud desde Claude Code (`take` / `decline`) no son rutas humanas: los aprueba la persona en el aviso de permisos de Claude Code, que sale en cada llamada. El admin lo puede desactivar para todo el equipo con `chatApproval`; entonces solo queda la app.
- **Encuadre del contenido ajeno.** Lo que escribe otra persona llega al agente dentro de un marco con un nonce aleatorio (`DEVI-UNTRUSTED`); lo que imite el marco, etiquetas del canal o cabeceras de rol se neutraliza y los caracteres invisibles se hacen visibles. Los archivos se dan solo como rutas, marcados como no verificados. Las instrucciones del MCP dicen al agente que es contenido de datos, nunca órdenes.
- **Avisos en la app.** Las tarjetas analizan mensajes y archivos y avisan de posibles inyecciones; con riesgo alto, «Enviar a sesión» exige confirmar que se revisó. Lo que sale se revisa en busca de secretos (claves, tokens, contraseñas) y no se envía sin confirmación expresa.
- **Límites de ritmo** por persona: 20 borradores cada 10 min (5 con archivos) y 120 acciones por minuto.
- **Auditoría** de borradores, solicitudes, respuestas, descargas, cambios de equipo, roles y ajustes, exportaciones y logins rechazados, con aviso a los admins de los cambios sensibles.
- **Cabeceras**: `nosniff`, `no-referrer`, `no-store` en la API y una CSP `default-src 'none'` en JSON y descargas. CORS solo para los orígenes de la app.

**Límites.** La exigencia de `Origin` frena a un agente que use las herramientas normales, no a un proceso del mismo usuario del SO que falsifique cabeceras. Los avisos de inyección y de secretos son heurísticas: se pueden esquivar y pueden dar falsos positivos. El control real es que una persona lee lo que entra y lo que sale, que Claude Code pide permiso antes de ejecutar comandos de red y que una solicitud nunca es una orden. Detalles para el equipo en [instalacion.md](instalacion.md#6-seguridad) y para el servidor en [deploy/servidor-linux/README.md](../deploy/servidor-linux/README.md#seguridad).

## Añadir un módulo

Un módulo implementa `DeviModule` (`packages/server/src/core/module.ts`):

```ts
export interface DeviModule {
  name: string;
  migrations: Migration[];                              // se aplican en orden, versionadas por módulo
  routes(router: Router, ctx: ModuleContext): void;
  onStart?(ctx: ModuleContext): void | Promise<void>;   // p. ej. reprogramar temporizadores
}
```

1. **Protocolo.** Declara los esquemas y las rutas nuevas en `packages/protocol` (`API`, con permiso, actor y `human` si una persona debe decidir). Si hace falta un permiso nuevo, añádelo a `PERMS` con su etiqueta en `PERM_LABELS`; la casilla aparece sola en la pestaña Roles.
2. **Módulo.** Crea `packages/server/src/modules/<nombre>/` con sus migraciones, su store y sus rutas. Usa `ctx.timers` (no `setTimeout`) para que los tests puedan usar el reloj falso.
3. **Comunicación.** Si necesita a otro módulo, usa un servicio de `ctx.services` (y amplía `ServiceMap`) o eventos del bus (amplía `BusEvents` con `declare module`). No importes otros módulos.
4. **Registro.** Añádelo a `MODULES` en `packages/server/src/main.ts`.
5. **Auditoría.** Si la acción es sensible, añade la acción a `AUDIT_ACTIONS` y regístrala con el servicio `audit`; la app obliga a darle una etiqueta en español.
6. **Tests.** Un `*.test.ts` del módulo con SQLite en memoria (`bun run test`).

## Release y despliegue

- **Versión.** `bun run version:set X.Y.Z` actualiza la app y la CLI; la etiqueta `vX.Y.Z` debe coincidir.
- **CI** (`.github/workflows/release-desktop.yml`, al subir la etiqueta): comprueba la versión, ejecuta los tests, compila la app para Windows x64, macOS arm64 y x64 y Linux x64 (con su sidecar `devi`) y los binarios `devi` de cada plataforma con `SHA256SUMS`, y lo deja todo en una release **borrador**.
- **Publicar** el borrador en GitHub es lo que despliega el servidor del equipo: su actualizador (`devi-update.timer`, cada 15 min) solo mira la última release publicada, comprueba el sha256 y la versión, instala, reinicia y vuelve atrás si el servidor no responde sano. Publicar una release anterior hace rollback.
- **Servidor del equipo**: servicio systemd endurecido con usuario `devi`, binario de root en `/opt/devi/bin/devi`, datos en `/var/lib/devi` y socket `/run/devi/devi.sock` publicado con `tailscale serve`. Instalación, migración y operación en [deploy/servidor-linux/README.md](../deploy/servidor-linux/README.md).
- **App**: instaladores sin firma de código del SO (la guía explica cómo abrirlos la primera vez). Las actualizaciones automáticas de la app aún no están activas: falta generar la clave de firma del updater; mientras tanto se instala la versión nueva encima. Si el servidor exige una versión más nueva, la app muestra «Actualiza Devi».
