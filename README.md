# Devi

**Devi** es una mascota (un circulito blanco con ojos) que conecta las sesiones de Claude Code de un equipo.

Cuando estás bloqueado esperando algo de un compañero (una duda, un PR, un permiso que solo él tiene), se lo pides a **tu agente**. El agente mira quién está conectado y recomienda a la persona con el **menor privilegio necesario**. Al compañero le llega una **notificación de Devi** y elige entre:

- **Aceptar**: lo hace él mismo (por ejemplo, un cambio en GCP o GitHub que el agente no puede hacer), con una nota opcional.
- **Rechazar**: con un motivo obligatorio.
- **Enviar a sesión**: elige una de sus sesiones de Claude Code, y la solicitud llega **dentro de la sesión abierta** como *pregunta abierta, nunca como orden*. Su agente le pregunta qué hacer y responde.

La respuesta vuelve como notificación a quien preguntó, que puede **aceptarla** o **enviarla a su sesión**. Si nadie actúa a tiempo, Devi avisa con **Reenviar** o **Ignorar**.

## Cómo funciona

```
 Claude Code (dayan) ─stdio─ MCP devi ─HTTP/SSE─┐                 ┌─SSE─ Ventana Devi (dayan)
                                                ├─ Devi Hub :4747 ┤
 Claude Code (maria) ─stdio─ MCP devi ─HTTP/SSE─┘   SQLite        └─SSE─ Ventana Devi (maria)
```

- **Servidor de Devi** (`packages/server/`): la única fuente de verdad. Módulos `team`, `settings`, `sessions`, `requests`, `files` y `audit` sobre SQLite. Arquitectura: [docs/arquitectura.md](docs/arquitectura.md).
- **MCP de Devi** (`devi mcp`, en `packages/cli/`): uno por sesión de Claude Code. Ofrece `list_teammates`, `send_request` y `respond_to_request`, y es un [**Claude Code channel**](https://code.claude.com/docs/en/channels-reference): empuja las solicitudes y respuestas dentro de la sesión abierta.
- **App de escritorio** (`apps/desktop/`): Tauri v2 + Svelte 5. Bandeja de tarjetas, autorizaciones, selector de sesiones, admin y modo servidor. Instalación: [docs/instalacion.md](docs/instalacion.md).
- **Hooks** (`devi hook`): marcan cada sesión como *trabajando* o *libre*.

## Requisitos

- [Bun](https://bun.sh) 1.x
- [Claude Code](https://code.claude.com) con **Channels** permitidos. Funcionan por defecto en Pro/Max y con API key de Console; en organizaciones Team o Enterprise, un Owner debe activar `channelsEnabled`.
- Para usar la app instalada no hace falta Bun: sigue [docs/instalacion.md](docs/instalacion.md).
- Servidor del equipo en una PC Linux (systemd + actualización automática al publicar una release): [deploy/servidor-linux/README.md](deploy/servidor-linux/README.md). Puede haber varios admins: da el rol «Admin Devi» (o uno con «Administrar equipo») a más personas; solo se bloquea quitar el último.

## Probarlo (modo dev, una sola máquina)

```bash
bun install
bun run devi server --dev --admin dayan@dev --data-dir /tmp/devi-dev   # servidor en 127.0.0.1:4747
```

En modo dev la identidad va en la cabecera `X-Devi-Dev-User` y la CLI lee `devi/config.json` del directorio de configuración del SO (normalmente lo escribe la app de escritorio): `~/.config/devi/config.json` en Linux, `~/Library/Application Support/devi/config.json` en macOS y `%APPDATA%\devi\config.json` en Windows. En Linux:

```bash
mkdir -p ~/.config/devi
echo '{ "serverUrl": "http://127.0.0.1:4747", "devUser": "dayan@dev" }' > ~/.config/devi/config.json
```

Compila el binario e instala el plugin de Claude Code (binario estable y marketplace local `devi-local`):

```bash
bun scripts/build-cli.ts --current
./dist/bin/devi-bun-linux-x64 install-integration   # el nombre depende de la plataforma
```

Lanza una sesión con el canal de Devi y comprueba el entorno. La ruta del binario estable es la de Linux; en macOS y Windows mira la tabla de [docs/instalacion.md](docs/instalacion.md#4-usar-devi-con-claude-code):

```bash
~/.local/share/devi/bin/devi claude --session frontend
~/.local/share/devi/bin/devi doctor
```

Para que escribir `claude` en la terminal haga lo mismo que `devi claude`, instala la función `claude` en tus perfiles de shell (la app lo hace en el asistente si dejas marcada la casilla):

```bash
~/.local/share/devi/bin/devi shell-alias install   # remove para quitarla; status --json para ver dónde está
```

Desde una terminal nueva, el uso normal es simplemente `claude` (`claude -c`, `claude --resume`… pasan tal cual); `devi claude` sigue funcionando. Para el `claude` original: `command claude` o `DEVI_NO_ALIAS=1 claude`. Detalles en [docs/instalacion.md](docs/instalacion.md#4-usar-devi-con-claude-code).

La primera vez, Claude Code pide confirmar el canal en modo desarrollo. El estado trabajando/libre solo se empareja en sesiones lanzadas con `claude` (con la función instalada) o `devi claude`.

La interfaz es la app de escritorio (`apps/desktop/`, `bun run --cwd apps/desktop tauri dev`).

## Tests

```bash
bun run test        # unitarios de todos los paquetes + smoke de integración (devi mcp contra un servidor dev)
bun run typecheck
```

## Estructura

- `packages/protocol`, `server`, `client`, `cli`: contrato, servidor, cliente HTTP y binario `devi`.
- `apps/desktop`: app de escritorio (Tauri + Svelte).
- `plugin/`: plugin de Claude Code. `scripts/`: compilación del binario por plataforma.
- `docs/ejemplos/team.json`: ejemplo para importar un equipo con `devi server --import docs/ejemplos/team.json`.
- `deploy/servidor-linux/`: servicio systemd del servidor y actualizador automático.

## Documentación

- [docs/arquitectura.md](docs/arquitectura.md): componentes, protocolo, modelo de datos, flujos, seguridad y cómo añadir un módulo.
- [docs/instalacion.md](docs/instalacion.md): instalar la app, Tailscale y la integración con Claude Code.
- [deploy/servidor-linux/README.md](deploy/servidor-linux/README.md): servidor del equipo en Linux (instalación, migración, seguridad y actualizaciones).
