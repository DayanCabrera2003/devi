# Devi

**Devi** es una mascota (un circulito blanco con ojos) que conecta las sesiones de Claude Code de un equipo.

Cuando estás bloqueado esperando algo de un compañero (una duda, un PR, un permiso que solo él tiene), se lo pides a **tu agente**. El agente mira quién está conectado y recomienda a la persona con el **menor privilegio necesario**. Al compañero le llega una **notificación de Devi** y elige entre:

- **Aceptar**: lo hace él mismo (por ejemplo, un cambio en GCP o GitHub que el agente no puede hacer), con una nota opcional.
- **Rechazar**: con un motivo obligatorio.
- **Enviar a sesión**: elige una de sus sesiones de Claude Code, y la solicitud llega **dentro de la sesión abierta** como *pregunta abierta, nunca como orden*. Su agente le pregunta qué hacer y responde.

La respuesta vuelve como notificación a quien preguntó, que puede **aceptarla** o **enviarla a su sesión**. Si nadie actúa a tiempo, Devi avisa con **Reenviar** o **Ignorar**.

> Proyecto de [Build With AI: Basics](https://devpost.com) (Devpost). Proof of concept: los dos compañeros se simulan en una sola máquina. El plan está en [`devpost/`](devpost/): [scope](devpost/scope.md), [PRD](devpost/prd.md), [spec](devpost/spec.md) y [checklist](devpost/checklist.md).

## Cómo funciona

```
 Claude Code (dayan) ─stdio─ MCP devi ─HTTP/SSE─┐                 ┌─SSE─ Ventana Devi (dayan)
                                                ├─ Devi Hub :4747 ┤
 Claude Code (maria) ─stdio─ MCP devi ─HTTP/SSE─┘   team.json     └─SSE─ Ventana Devi (maria)
```

- **Devi Hub** (`src/hub/`): servidor local, la única fuente de verdad. Conoce el equipo (`team.json`), quién está conectado, las sesiones y el ciclo de vida de cada solicitud, incluido el timeout.
- **MCP de Devi** (`src/mcp/devi-channel.ts`): uno por sesión de Claude Code. Ofrece `list_teammates`, `send_request` y `respond_to_request`, y es un [**Claude Code channel**](https://code.claude.com/docs/en/channels-reference): empuja las solicitudes y respuestas dentro de la sesión abierta.
- **Ventana de Devi** (`web/`): HTML, CSS y JS sin framework. Muestra las tarjetas y lanza notificaciones del sistema.
- **Hooks** (`src/hooks/status.ts`): marcan cada sesión como *trabajando* o *libre*.

## Requisitos

- [Bun](https://bun.sh) 1.x
- [Claude Code](https://code.claude.com) con **Channels** permitidos. Funcionan por defecto en Pro/Max y con API key de Console; en organizaciones Team o Enterprise, un Owner debe activar `channelsEnabled`.
- Chromium o Firefox para la ventana de Devi.

## Probarlo

```bash
bun install
DEVI_TIMEOUT_MS=60000 bun run hub      # timeout de 1 min para la demo (por defecto, 1 h)
```

Abre una ventana de Devi por persona y pulsa **Activar avisos**:

```bash
google-chrome --app="http://localhost:4747/?user=dayan"
google-chrome --app="http://localhost:4747/?user=maria"
```

Lanza una sesión de Claude Code por persona, en dos terminales:

```bash
bin/devi-claude --user dayan --session frontend
bin/devi-claude --user maria --session backend-api
```

La primera vez, acepta el aviso de *development channels* y el del MCP. El launcher registra el servidor `devi` en el scope local de la carpeta donde lo ejecutas.

Luego, en la sesión de Dayan: *"necesito que alguien me apruebe el PR #12"*.

## Tests

```bash
bun test                                         # ciclo de vida de las solicitudes
DEVI_PORT=4848 bun run hub &                     # hub de pruebas
DEVI_HUB_URL=http://localhost:4848 bun scripts/smoke-mcp.ts
DEVI_HUB_URL=http://localhost:4848 bun scripts/smoke-flow.ts
# con DEVI_TIMEOUT_MS=1500 en el hub:
DEVI_HUB_URL=http://localhost:4848 bun scripts/smoke-timeout.ts
```

Los scripts `smoke-*` hacen de "Claude Code falso" (un cliente MCP por stdio) y de "ventana falsa" (un lector SSE), y recorren el viaje completo.

## Simplificaciones (proof of concept)

- Hub local en `localhost`, no un servidor de equipo en red.
- Identidad por `?user=` y `--user`, sin login.
- Equipo en `team.json` (datos de ejemplo), sin interfaz de administración.
- Estado en memoria: se pierde al reiniciar el hub.
- Solo Claude Code, solo texto (sin archivos).
