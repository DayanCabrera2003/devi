# Instalar Devi

Devi es una app de escritorio para Windows, macOS y Linux. Una PC del equipo hace de **servidor**; todos (incluida esa PC) se conectan a ella por **Tailscale**.

Descarga el instalador de tu sistema en la página de **Releases** del proyecto: https://github.com/DayanCabrera2003/devi/releases/latest

Los instaladores **no están firmados** (Devi no paga certificados), así que el sistema avisa la primera vez. Abajo está cómo abrirlos.

## 1. Tailscale (todos)

1. Instala Tailscale: https://tailscale.com/download
2. Inicia sesión con la cuenta del equipo. Tu login de Tailscale (p. ej. `maria@empresa.com`) es tu identidad en Devi: no hay otra contraseña.

### Solo el admin de la tailnet, una vez

En la consola de Tailscale (https://login.tailscale.com/admin/dns):

1. Activa **MagicDNS**.
2. En **HTTPS Certificates**, pulsa **Enable HTTPS**. `tailscale serve` lo necesita para publicar Devi en `https://<equipo>.<tailnet>.ts.net`.

### Restringir quién llega al servidor (recomendado)

En **Access controls** (política de la tailnet), crea un grupo `devi` y deja que solo ese grupo llegue al puerto 443 de la PC servidor:

```jsonc
{
  "groups": {
    "group:devi": ["dayan@empresa.com", "maria@empresa.com"]
  },
  "hosts": {
    // IP 100.x de la PC servidor (tailscale ip -4 en esa PC)
    "devi-servidor": "100.101.102.103"
  },
  "grants": [
    { "src": ["group:devi"], "dst": ["devi-servidor"], "ip": ["tcp:443"] }
  ]
}
```

La política por defecto de Tailscale permite todo (`{"src": ["*"], "dst": ["*"], "ip": ["*"]}`). Si la mantienes, la regla de arriba no restringe nada. Cámbiala con cuidado, porque afecta al resto de tu tailnet.

**No etiquetes (tags) la PC servidor.** Devi usa el login de la persona que llama, y los dispositivos etiquetados no tienen login de persona.

**Límite del plan gratuito:** el plan Personal de Tailscale es gratis para un equipo pequeño (unas 6 personas; consulta https://tailscale.com/pricing). Si el equipo crece, la alternativa prevista es Headscale.

## 2. Instalar la app

### Windows

1. Descarga `Devi_<versión>_x64-setup.exe` (o el `.msi`).
2. Al abrirlo, Windows SmartScreen dice «Windows protegió tu PC». Pulsa **Más información** y luego **Ejecutar de todos modos**.
3. El instalador es por usuario y no pide permisos de administrador.

### macOS

1. Descarga el `.dmg` de tu Mac: `aarch64` para Apple Silicon (M1 o posterior) o `x64` para Intel.
2. Abre el `.dmg` y arrastra **Devi** a **Aplicaciones**.
3. La primera vez, macOS dice que no puede comprobar el desarrollador:
   - **macOS 14 o anterior:** en Aplicaciones, **clic derecho sobre Devi → Abrir → Abrir**.
   - **macOS 15 o posterior:** intenta abrirla una vez y luego ve a **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el aviso de Devi y pulsa **Abrir igualmente**.
   - **Alternativa por terminal:**

     ```bash
     xattr -dr com.apple.quarantine /Applications/Devi.app
     ```

### Linux

- **Ubuntu / Debian:** `sudo apt install ./Devi_<versión>_amd64.deb`
- **Fedora / RHEL:** `sudo dnf install ./Devi-<versión>-1.x86_64.rpm`
- **Cualquier distribución:** `chmod +x Devi_<versión>_amd64.AppImage && ./Devi_<versión>_amd64.AppImage`

**Icono de la bandeja en GNOME.** GNOME no muestra iconos de bandeja sin una extensión:

- **Ubuntu:** ya la trae.
- **Fedora:** `sudo dnf install gnome-shell-extension-appindicator`, actívala en la app **Extensiones** y cierra sesión.

Sin la extensión, Devi funciona igual: la **ventanita de la mascota** muestra el estado y abre la ventana principal.

## 3. Primer arranque (asistente)

1. **Tailscale:** Devi comprueba que está conectado y muestra tu login.
2. **Servidor:**
   - **Si te conectas al servidor del equipo:** escribe su URL, `https://<pc-servidor>.<tailnet>.ts.net`.
   - **Si esta PC es el servidor:** elige «Este equipo es el servidor». Devi detecta tu login, te pide confirmarlo (serás el primer admin) y arranca el servidor. Si falta publicarlo, ejecuta en una terminal de esa PC:

     ```bash
     tailscale serve --bg 4747
     ```

     En Linux, si pide permisos, ejecuta antes `sudo tailscale set --operator=$USER`. Compruébalo con `tailscale serve status`.

     La PC servidor también se conecta por la URL `https://…ts.net`, nunca por `127.0.0.1`.
3. **Conexión:** Devi prueba la conexión y muestra con qué login entraste. Si dice que tu login no está en el equipo, pide al admin que te añada (Admin → Personas → Invitar por login) y pulsa Reintentar.
4. **Claude Code:** «Instalar integración» copia el binario `devi` a una ruta estable e instala el plugin de Claude Code (`devi@devi-local`). Necesitas Claude Code instalado.
5. **Listo:** «Comprobar todo» ejecuta `devi doctor`.

## 4. Usar Devi con Claude Code

Lanza las sesiones con `devi claude`: abre Claude Code con el canal de Devi y empareja el estado trabajando/libre.

```bash
devi claude --session frontend
```

`devi` queda en una ruta estable tras el paso 4 del asistente (`~/.local/share/devi/bin/devi` en Linux y macOS). Si no está en tu `PATH`, usa esa ruta completa.

**Canales y organizaciones.** Sin política de la organización, Claude Code pide confirmar el canal en modo desarrollo la primera vez. En organizaciones Team o Enterprise, un Owner puede permitir el canal de Devi sin ese aviso con estas managed settings:

```json
{
  "channelsEnabled": true,
  "allowedChannelPlugins": [{ "marketplace": "devi-local", "plugin": "devi" }]
}
```

`devi doctor` comprueba si la política lo permite y muestra este fragmento si falta. Sin el canal, la app sigue mostrando las tarjetas; solo las solicitudes no entran solas en la sesión.

## 5. Actualizaciones

**Las actualizaciones automáticas todavía no están activas.** Requieren generar la clave de firma del updater (Task 25 del plan de la app de escritorio), y aún no se ha hecho. Hasta entonces, para actualizar descarga el instalador de la versión nueva desde Releases e instálalo encima de la actual: se conservan tus datos y tu configuración.

Cuando estén activas, Devi buscará versiones nuevas al abrirse y mostrará «Devi X está disponible → Actualizar y reiniciar», y solo instalará las versiones firmadas con la clave del proyecto.

Si el servidor exige una versión más nueva, la app muestra **Actualiza Devi**: instala la versión nueva como se explica arriba.

## 6. Seguridad

Las acciones que debe decidir una persona (autorizar o descartar un borrador, responder una solicitud, administrar el equipo, roles y ajustes, exportar la base de datos) **solo se aceptan desde la app de Devi**: el servidor exige la cabecera `Origin` de la app. Si un agente intenta hacerlas llamando a la API directamente, recibe «Esta acción solo se puede hacer desde la app de Devi».

Es una barrera, no una garantía: un proceso que corra con tu mismo usuario del sistema podría falsificar esa cabecera. La protección real es que Claude Code te pide permiso antes de ejecutar comandos de red, y que todo borrador aparece en la app para que lo revises antes de autorizarlo.

## 7. Problemas frecuentes

| Mensaje | Qué hacer |
|---|---|
| «Aún no estás en el equipo de Devi» | El admin debe añadir tu login exacto (se muestra en pantalla). |
| «El servidor no sabe quién eres» (401) | Usa la URL `https://…ts.net`, no `127.0.0.1`. Comprueba `tailscale serve status` en la PC servidor. |
| «El servidor rechazó el origen de esta app» | Usa la app instalada. En desarrollo: Vite en el puerto 1420 y el servidor con `--dev`. |
| «Sin conexión, reconectando…» | Tailscale apagado o la PC servidor apagada. Devi reintenta solo (máximo cada 30 s). |
| «Te falta el permiso…» | El admin debe darte un rol con ese permiso (Admin → Roles). |
| «Esta acción solo se puede hacer desde la app de Devi» | Autoriza, responde o administra desde la app, no desde la terminal ni desde Claude. |

Diagnóstico completo: **Ajustes → Diagnóstico (devi doctor)**, o `devi doctor` en una terminal.
