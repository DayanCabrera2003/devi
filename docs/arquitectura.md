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
| `devi mcp` | Servidor MCP por stdio y canal de Claude Code. Herramientas: `list_teammates`, `send_request`, `respond_to_request`. |
| `devi hook <start\|working\|idle>` | Lo llaman los hooks: marca la sesión como trabajando o libre y, sin canal, entrega lo pendiente (ver más abajo). Nunca falla ni bloquea. |
| `devi claude [--session <nombre>] [-- args]` | Lanza `claude` con el canal de Devi cargado. |
| `devi doctor` | Diagnóstico: Tailscale, servidor, login, plugin y política de canales. |
| `devi install-integration` | Copia el binario a una ruta estable e instala el plugin desde un marketplace local (`devi@devi-local`). Lo usa el asistente de la app. |
| `devi shell-alias` | Instala o quita la función `claude` en los perfiles de shell para que `claude` abra la sesión con el canal. |

La configuración del cliente (URL del servidor) vive en `devi/config.json` del directorio de configuración del SO; la escribe la app.

**Emparejamiento de sesiones.** El MCP y los hooks son hijos directos del mismo proceso de Claude Code, así que comparten el PID del padre. El MCP registra la sesión con ese PID y los hooks se emparejan con ella por PID y, si no, por `claude_session_id`.

### App de escritorio

- **Tray** con el icono de Devi (punto de acento si hay pendientes) y un **panel de avisos** (ventana `avisos`, 360 × 520, con las mismas acciones que la app y su propia conexión mientras se usa): clic izquierdo en macOS y Windows, "Ver avisos (N)" del menú en Linux. **Mascota flotante** opcional (Ajustes → Mostrar a Devi flotando; ventana transparente creada bajo demanda). Sin tray (GNOME sin extensión) cerrar la ventana la minimiza. Notificaciones nativas y arranque al iniciar sesión.
- **Asistente de primer arranque**: comprueba Tailscale, pide la URL del servidor o activa «Este equipo es el servidor», prueba la conexión, instala la integración con Claude Code y ejecuta `devi doctor`.
- **Modo servidor**: lanza `devi server` como sidecar y muestra el comando `tailscale serve` si falta.
- **Vistas**: Bandeja (borradores por autorizar, solicitudes, respuestas, plazos vencidos), conversaciones por compañero (con envío directo desde la app), selector de sesiones, Ajustes y Admin (Personas · Roles · Servidor · Auditoría; solo con `team.admin`).
- **Adjuntar archivos** al enviar desde la app: el webview nunca elige rutas. `pick_files` abre el diálogo nativo en Rust; al soltar archivos sobre la ventana principal, Rust recibe `WindowEvent::DragDrop` y emite `devi://drag-hover` (`{ active }`) y `devi://files-dropped`. En los dos casos Rust lee y valida cada archivo (texto UTF-8 sin NUL, ≤ 1 MB, ≤ 5 por vez), guarda los aceptados en memoria con un token aleatorio (como máximo 20; se olvidan los más antiguos) y devuelve `PickResult` (`files`: token, nombre, tamaño y los primeros 4 KB; `rejected`: nombre y motivo). Al enviar, `take_files(tokens)` entrega el contenido y lo borra; `discard_files` lo descarta. Tauri también emite sus propios `tauri://drag-*` con rutas y no se pueden desactivar sin perder `DragDrop`: la UI no los escucha y el webview no tiene plugin `fs` ni protocolo `asset`, así que una ruta no le sirve para leer nada.
- La UI habla con el servidor directamente por HTTP/SSE desde el webview con `@devi/client`. Rust solo hace lo nativo: tray, ventanas, sidecar, rutas, Tailscale local y guardar archivos recibidos (`save_received_files`, con nombres saneados y confinado a la carpeta de recibidos; el webview no tiene permiso general de escritura en disco).

## Protocolo y módulos

### Rutas

Todas las rutas están declaradas en `API` (`packages/protocol/src/api.ts`) con su método, ruta, permiso, actor, esquema del cuerpo y de la respuesta, y si es una **acción humana**. El servidor y los clientes usan la misma tabla.

| Ruta | Quién | Uso |
|---|---|---|
| `GET /health` | cualquiera | Salud y versión (sin identidad). |
| `GET /me` · `GET /team` | miembro | Persona, permisos efectivos; equipo con roles, capacidades y presencia. |
| `POST/PATCH/DELETE /team/members[/:id]` · `/team/roles[/:id]` | admin, humana | Personas y roles. |
| `GET/PATCH /settings` · `GET /settings/export` | admin (PATCH y export humanas) | Ajustes del servidor y copia de `devi.db`. |
| `GET /audit?limit=&before=` | admin | Registro de auditoría, paginado por id. |
| `POST /sessions` · `DELETE /sessions/:id` · `POST /sessions/hook` | miembro / dueño | El MCP registra o cierra su sesión; los hooks informan del estado. |
| `GET /sessions/inbox` · `POST /sessions/inbox/ack` | dueño | Entregas pendientes de una sesión sin canal. |
| `GET /members/:id/sessions` | miembro | Sesiones vivas de una persona (selector). |
| `POST /presence/heartbeat` | miembro | Latido de presencia (app y MCP). |
| `POST /drafts` | `requests.send` (+ `files.send` con archivos) | Borrador de solicitud o respuesta (multipart: `meta` JSON + archivos). |
| `POST /drafts/:id/authorize` · `/discard` | autor, humana | Autorizar o descartar un borrador. |
| `POST /requests` | `requests.send` (+ `files.send` con archivos), humana | Solicitud escrita en la app (multipart: `meta` = `{ to, message }` + archivos). Sale ya en `pending`, sin borrador; mismos límites de ritmo que los borradores. |
| `GET /conversations` | miembro | Una fila por compañero activo: última actividad (fecha, 120 caracteres, si fue mía) y cuántas cosas esperan mi acción. |
| `GET /conversations/:memberId?before=&limit=` | miembro (solo las suyas) | Solicitudes entre quien llama y esa persona, en los dos sentidos, de la más nueva a la más vieja (30 por defecto, hasta 100). |
| `POST /requests/:id/forward` · `/accept` · `/reject` | destinatario, humana | Decisiones de quien recibe. |
| `POST /requests/:id/response/accept` · `/response/forward` | remitente, humana | Decisiones sobre la respuesta. |
| `POST /requests/:id/resend` · `/ignore` | remitente, humana | Tras un plazo vencido. |
| `GET /files/:id` | remitente o destinatario | Descargar un archivo. |
| `GET /events/user` · `GET /events/session/:id` | miembro / dueño | SSE de la app y del MCP. |
| `POST /debug/push` | admin | Solo en modo dev (404 en producción). |

### Eventos

**SSE de usuario** (app): `draft.awaiting`, `draft.discarded`, `request.incoming`, `request.updated`, `response.incoming`, `request.timed_out`, `conversation.updated` (`{ memberId }`: cambió una solicitud o borrador con esa persona; llega a las dos partes), `team.updated`, `sessions.updated` y, solo a admins, `audit.alert`. Al conectar, el servidor reenvía las tarjetas abiertas.

**SSE de sesión** (MCP → canal): un único evento `deliver` con `kind` = `request`, `response`, `draft_authorized`, `draft_discarded` o `debug`, el texto para el agente y los atributos del canal (`request_id`, `draft_id`, rutas de archivos…).

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
| `audit` | Registro de auditoría y avisos `audit.alert`. |
| `sessions` | Sesiones de Claude Code, estado trabajando/libre, presencia y bandeja de entregas. |
| `files` | Validación, almacenamiento, descarga y retención de archivos. |
| `requests` | Borradores, solicitudes, respuestas y plazos. |

Los módulos no se importan entre sí: se comunican por el **bus** (`draft.discarded`, `request.closed`, `session.closed`) y por **servicios** que se ofrecen en `ctx.services` (`team`, `settings`, `sessions`, `files`, `audit`).

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
               claude_session_id, last_seen, channel
session_inbox  id, session_id, kind, content, meta, created_at, acked_at
drafts         id, kind (request|response), author_member, author_session, author_session_name,
               to_member (request), request_id (response), message,
               status (awaiting|authorized|discarded), created_at, expires_at
requests       id, origin (session|app), from_member, from_session, from_session_name, to_member, message,
               status, forwarded_session, outcome, outcome_text, created_at, sent_at, deadline,
               responded_at
files          id, draft_id, request_id, direction (request|response), name, size, sha256, path,
               author_member, peer_member, created_at, released_at, deleted_at
audit_log      id, at, actor_member_id, actor_login, action, target_type, target_id, details
```

- Los **borradores** son una tabla aparte: una solicitud de un agente solo existe en `requests` cuando su borrador se autoriza. Las escritas en la app (`origin = app`) se crean directamente, con `from_session` y `from_session_name` vacíos y sus archivos ya unidos a la solicitud (`draft_id` vacío).
- **Permisos** (`packages/protocol/src/perms.ts`): `requests.send`, `files.send` y `team.admin`. Los de una persona son la unión de los de sus roles. Siempre debe quedar al menos un admin.
- **Ajustes por defecto**: plazo de una solicitud 1 h, 15 min para autorizar un borrador, archivos 7 días tras cerrarse la solicitud y 30 días como máximo, dominios permitidos vacíos.
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
pending ──forward──▶ forwarded ──(borrador de respuesta autorizado)──▶ answered
   ├─accept─▶ accepted
   └─reject─▶ rejected
pending|forwarded ──plazo──▶ timed_out ─resend─▶ pending
                                        └─ignore─▶ closed
accepted|rejected|answered ──el remitente acepta o la envía a una sesión──▶ closed
```

- `respond_to_request` solo vale con la solicitud en `forwarded`. Hay como máximo un borrador de respuesta pendiente por solicitud; uno nuevo sustituye al anterior.
- Mientras haya un borrador de respuesta pendiente, el plazo de la solicitud se pausa. Si se descarta o caduca, la solicitud sigue en `forwarded` con un plazo nuevo completo.
- Aceptar y Rechazar desde la tarjeta son acciones humanas directas.
- Plazos y caducidades se guardan en SQLite y se reprograman al arrancar (`onStart`), así que sobreviven a reinicios.

Una solicitud escrita en la app entra directamente en `pending` (auditoría `request.sent_from_app`) y sigue el mismo ciclo; nada supone que el remitente tenga una sesión: su respuesta se acepta o se envía a cualquiera de sus sesiones.

### Recorrido completo

1. **Enviar.** El agente de A llama a `send_request(to, message, files?)`. El MCP resuelve las rutas respecto al `cwd` de la sesión, valida los archivos (texto UTF-8 sin NUL, ≤ 1 MB, ≤ 5) y busca secretos; después crea el borrador. El servidor repite la validación y comprueba permisos.
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

## Presencia

Un SSE abierto no basta para saber que alguien está conectado: si el cliente se cae sin cerrar la conexión, el stream puede tardar en abortarse. Por eso la app y el MCP mandan `POST /presence/heartbeat` cada 20 s mientras tienen un SSE abierto. Una clave (`user:<id>` o `session:<id>`) está viva si tiene el stream abierto y un latido en los últimos 60 s; el servidor lo revisa cada 15 s y anuncia cada cambio una sola vez por el bus. `GET /team` y el selector de sesiones se basan en esto.

## Modelo de seguridad

- **Identidad.** La pone `tailscale serve` en `Tailscale-User-Login` (y borra la que traiga el cliente). Los dispositivos con tag no tienen login de persona y reciben `401`.
- **Socket Unix en producción.** Con un puerto TCP, cualquier proceso de la PC servidor podría conectarse a `127.0.0.1` y falsificar esa cabecera. En producción el servidor escucha en un socket `0600` dentro de un directorio `0700` del usuario `devi`; solo `devi` y root (`tailscaled`) llegan a él. El servidor avisa en el log si arranca en TCP fuera del modo dev.
- **Dos barreras de acceso.** La política de Tailscale (grants) decide quién llega a la PC; `--allowed-domain` y la lista del equipo deciden quién entra en Devi.
- **Acciones humanas solo desde la app.** Las rutas `human` exigen un `Origin` permitido, que el webview manda solo y la CLI y el MCP no. Así un agente no puede autorizar, responder ni administrar por su cuenta llamando a la API.
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
