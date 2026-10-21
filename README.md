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

- **Servidor de Devi** (`packages/server/`): la única fuente de verdad. Módulos `team`, `settings`, `sessions`, `files` y `requests` sobre SQLite (ver `docs/superpowers/specs/2026-10-21-devi-produccion-design.md`).
- **MCP de Devi** (`src/mcp/devi-channel.ts`): uno por sesión de Claude Code. Ofrece `list_teammates`, `send_request` y `respond_to_request`, y es un [**Claude Code channel**](https://code.claude.com/docs/en/channels-reference): empuja las solicitudes y respuestas dentro de la sesión abierta.
- **Ventana de Devi** (`web/`): HTML, CSS y JS sin framework. Muestra las tarjetas y lanza notificaciones del sistema.
- **Hooks** (`src/hooks/status.ts`): marcan cada sesión como *trabajando* o *libre*.

## Requisitos

- [Bun](https://bun.sh) 1.x
- [Claude Code](https://code.claude.com) con **Channels** permitidos. Funcionan por defecto en Pro/Max y con API key de Console; en organizaciones Team o Enterprise, un Owner debe activar `channelsEnabled`.
- Chromium o Firefox para la ventana de Devi.

## Probarlo (servidor nuevo)

```bash
bun install
bun run server:dev -- --admin dayan@dev --import team.json   # la primera vez: crea el admin e importa el equipo
bun run server:dev                                           # las siguientes
```

En modo dev la identidad va en la cabecera `X-Devi-Dev-User` (o en `?devUser=` en los SSE) y todas las peticiones llevan `X-Devi-Version: 1.0.0`:

```bash
curl -s -H "X-Devi-Version: 1.0.0" -H "X-Devi-Dev-User: dayan@dev" http://127.0.0.1:4747/api/v1/me
```

El MCP (`src/mcp/`) y la ventana (`web/`) del proof of concept se están migrando: la Fase 2 los sustituye por `devi mcp` y la Fase 3, por la app de escritorio.

## Tests

```bash
bun test packages/          # unitarios por módulo + recorrido completo por HTTP y SSE
bun run typecheck
```

## Simplificaciones (proof of concept)

- Hub local en `localhost`, no un servidor de equipo en red.
- Identidad por `?user=` y `--user`, sin login.
- Equipo en `team.json` (datos de ejemplo), sin interfaz de administración.
- Estado en memoria: se pierde al reiniciar el hub.
- Solo Claude Code, solo texto (sin archivos).
