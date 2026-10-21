# Servidor de Devi en Linux: instalación segura

Esta guía deja el servidor de Devi en una PC Linux compartida de forma que solo la gente del equipo, entrando por Tailscale, pueda usarlo.

## El problema que resuelve

`tailscale serve` autentica a quien llega por la tailnet y añade la cabecera `Tailscale-User-Login`. El servidor confía en esa cabecera. Si escucha en `127.0.0.1:4747`, **cualquier proceso de la misma PC** (otro usuario, un script, un navegador) puede conectarse directamente y mandar `Tailscale-User-Login: admin@empresa.com`. Así se haría pasar por el admin.

En producción el servidor escucha en un **socket Unix** con permisos `0600`, dentro de un directorio `0700` del usuario de sistema `devi`. Solo `devi` y root llegan a él. `tailscaled` corre como root y publica el socket con `tailscale serve unix:…`. Nadie más puede inyectar cabeceras.

**En producción usa siempre `--socket`.** `--port` queda para desarrollo y pruebas, y el servidor avisa en el log si arranca en un puerto TCP fuera del modo dev.

## Qué hace el servidor

- `--socket RUTA`: escucha en un socket Unix en vez de un puerto TCP. Es excluyente con `--port`. Crea el directorio padre si falta, borra un socket huérfano de un arranque anterior (nunca otro tipo de archivo) y deja el socket en `0600`.
- `--allowed-domain DOMINIO` (repetible): solo entran logins `@DOMINIO`. Cualquier otro login recibe `403 domain` antes incluso de buscarlo en el equipo, y el admin no puede añadir personas de otros dominios. Los flags se suman al ajuste `allowedDomains` (visible y editable en Admin → Servidor) cada vez que el servidor arranca; repetirlos no cambia nada. Un admin no puede guardar una lista de dominios que lo deje fuera a él. Si la lista está vacía, no se filtra por dominio (es lo normal en desarrollo).
- **Registro de auditoría** (`GET /api/v1/audit`, solo admins). Guarda borradores, solicitudes, respuestas, descargas, cambios de personas, roles y ajustes, exportaciones de la base y logins rechazados. De los mensajes guarda solo su SHA-256, nunca el texto. Las entradas no se pueden modificar y se borran a los 365 días. Los cambios sensibles avisan a los admins en la app (`audit.alert`).
- **Límites de ritmo por persona**: 20 borradores cada 10 min (5 con archivos) y 120 acciones por minuto en el resto (el latido de presencia no cuenta). Si alguien los supera, recibe `429 rate_limit` con `Retry-After`.
- **Cabeceras de seguridad**: `nosniff`, `no-referrer`, `no-store` en la API y `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` en JSON y descargas.

## Instalación

### 1. Usuario de sistema y binario

```sh
sudo useradd --system --home-dir /var/lib/devi --shell /usr/sbin/nologin devi
sudo install -d -o root -g root -m 0755 /opt/devi/bin
sudo install -o root -g root -m 0755 ./devi /opt/devi/bin/devi
```

El binario es de root: el servicio, que corre como `devi`, no puede reemplazarlo.

### 2. Unidad systemd

`/etc/systemd/system/devi-server.service`:

```ini
[Unit]
Description=Devi - servidor del equipo
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=devi
Group=devi
# Socket en /run/devi (0700, de devi): solo devi y root (tailscaled) llegan a él.
RuntimeDirectory=devi
RuntimeDirectoryMode=0700
StateDirectory=devi
StateDirectoryMode=0700
ExecStart=/opt/devi/bin/devi server --socket /run/devi/devi.sock --data-dir /var/lib/devi --admin dcabrera@asai.digital --allowed-domain asai.digital
Restart=on-failure
RestartSec=5
UMask=0077

# Recursos (igual que antes)
MemoryMin=128M
MemoryMax=512M
CPUWeight=500
OOMScoreAdjust=-500

# Endurecimiento
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
# El JIT de Bun (JavaScriptCore) necesita páginas escribibles y ejecutables: con
# MemoryDenyWriteExecute=yes el binario no arranca.
MemoryDenyWriteExecute=no
CapabilityBoundingSet=
SystemCallArchitectures=native
ReadWritePaths=/var/lib/devi

[Install]
WantedBy=multi-user.target
```

- `StateDirectory=devi` crea `/var/lib/devi` (datos: `devi.db` y `files/`) propiedad de `devi`.
- `RuntimeDirectory=devi` crea `/run/devi` con modo `0700` en cada arranque y lo borra al parar.
- `ProtectSystem=strict` deja todo el sistema en solo lectura salvo `/var/lib/devi` (y `/run/devi`). `ProtectHome=yes` oculta `/home`.
- `MemoryDenyWriteExecute=no` es a propósito: el JIT de Bun necesita memoria escribible y ejecutable.

Comprobado con `systemd-analyze verify` (solo avisa de que falta `/opt/devi/bin/devi` si no está instalado) y `systemd-analyze security` (exposición 3.0, «OK»).

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now devi-server
systemctl status devi-server
sudo ls -l /run/devi/devi.sock   # srw------- devi devi
```

### 3. Publicar con Tailscale

```sh
sudo tailscale serve --https=443 off            # quita el proxy anterior a 127.0.0.1:4747
sudo tailscale serve --bg unix:/run/devi/devi.sock
tailscale serve status
```

Prueba desde otro equipo de la tailnet: `https://<pc>.<tailnet>.ts.net/api/v1/health`.

## Migrar desde la instalación anterior

Antes: el binario en `/home/asai/devi/bin/devi`, los datos en `/home/asai/.local/share/devi`, la unidad como `asai` en `--port 4747` y `tailscale serve` apuntando a 4747.

```sh
# 1. Parar el servicio (la base SQLite queda cerrada y consistente)
sudo systemctl stop devi-server

# 2. Usuario y binario (paso 1 de la instalación)
sudo useradd --system --home-dir /var/lib/devi --shell /usr/sbin/nologin devi
sudo install -d -o root -g root -m 0755 /opt/devi/bin
sudo install -o root -g root -m 0755 /home/asai/devi/bin/devi /opt/devi/bin/devi

# 3. Copiar los datos (incluye devi.db-wal / devi.db-shm si existen) y darlos a devi
sudo install -d -o devi -g devi -m 0700 /var/lib/devi
sudo cp -a /home/asai/.local/share/devi/. /var/lib/devi/
sudo chown -R devi:devi /var/lib/devi
sudo chmod 0700 /var/lib/devi

# 4. Sustituir la unidad por la de arriba y arrancar
sudoedit /etc/systemd/system/devi-server.service
sudo systemctl daemon-reload
sudo systemctl start devi-server
journalctl -u devi-server -n 20      # debe decir "servidor en unix:/run/devi/devi.sock"

# 5. Cambiar el proxy de Tailscale
sudo tailscale serve --https=443 off
sudo tailscale serve --bg unix:/run/devi/devi.sock

# 6. Cuando todo funcione, borrar la copia vieja (contiene la base y archivos)
sudo rm -rf /home/asai/.local/share/devi
```

La URL del servidor no cambia, así que las apps y la CLI siguen funcionando sin tocar nada.

Si usas el actualizador (`devi-update.service`), apúntalo a `/opt/devi/bin/devi` y haz que instale el binario nuevo como root con `install -o root -g root -m 0755`.

## Política de Tailscale

Por defecto una tailnet deja que cualquier dispositivo hable con cualquier otro. Restringe la PC servidor para que solo el grupo de Devi llegue al 443, y que SSH siga abierto para quien la administra. En el panel de Tailscale → Access controls:

```jsonc
{
  "groups": {
    // Quién usa Devi (sus logins de Tailscale)
    "group:devi": ["dcabrera@asai.digital", "maria@asai.digital"]
  },
  "hosts": {
    // IP 100.x de la PC servidor (tailscale ip -4)
    "devi-server": "100.64.0.10"
  },
  "grants": [
    // Devi: solo HTTPS (tailscale serve) para el grupo
    { "src": ["group:devi"], "dst": ["devi-server"], "ip": ["tcp:443"] },
    // Dueño de la PC: SSH para administrarla
    { "src": ["dcabrera@asai.digital"], "dst": ["devi-server"], "ip": ["tcp:22"] }
    // …el resto de reglas de tu tailnet, sin "dst": ["*"] que incluya a devi-server
  ]
}
```

- Quita la regla por defecto que lo permite todo (`{"src": ["*"], "dst": ["*"], "ip": ["*"]}`, o la antigua `"acls": [{"action": "accept", "src": ["*"], "dst": ["*:*"]}]`). Si sigue ahí, las reglas de arriba no restringen nada.
- Si usas Tailscale SSH en vez de `sshd`, añade también su bloque `"ssh"` para el dueño.
- Los dispositivos con tag no tienen login de persona: `tailscale serve` no manda `Tailscale-User-Login` y Devi responde 401. No hace falta darles acceso.

## Recomendaciones de la tailnet

- **Activa Device Approval** (Settings → Device management). Así un dispositivo nuevo no entra en la tailnet hasta que un admin lo aprueba, aunque alguien tenga una cuenta del dominio.
- **Quita el acceso compartido a la PC servidor** (Machines → la PC → Share). Un nodo compartido con usuarios de fuera de la tailnet les da acceso a sus puertos, y sus logins no son del dominio.
- Mantén `--allowed-domain` con el dominio del equipo, aunque las reglas de Tailscale ya filtren: son dos barreras independientes.
- Revisa de vez en cuando el registro de auditoría (Admin → Auditoría) y los avisos de logins rechazados.
