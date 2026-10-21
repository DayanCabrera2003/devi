# Servidor de Devi en Linux (PC del equipo)

El servidor de Devi corre en una PC Linux como servicio de systemd, con su propio usuario de sistema, y se publica en la tailnet con `tailscale serve`. Un timer lo actualiza solo cuando se publica una release en GitHub. Sin Docker.

| Qué | Dónde |
|---|---|
| Usuario del servicio | `devi` (de sistema, sin shell ni login) |
| Binario | `/opt/devi/bin/devi`, de `root:root`, modo `755` (el servicio no puede reemplazarlo) |
| Datos (`devi.db`, `files/`) | `/var/lib/devi`, de `devi`, modo `0700` |
| Socket | `/run/devi/devi.sock`, modo `0600`, dentro de `/run/devi` (`0700`, de `devi`) |
| Publicación | `tailscale serve --bg unix:/run/devi/devi.sock` |
| Flags | `--socket /run/devi/devi.sock --data-dir /var/lib/devi --admin dcabrera@asai.digital --allowed-domain asai.digital` |

## Ficheros

| Fichero | Qué hace |
|---|---|
| `devi-server.service` | El servicio del servidor, endurecido (ver [Seguridad](#seguridad)). Se instala en `/etc/systemd/system/`. |
| `devi-update.sh` | Actualizador. Mira la última release **publicada** de GitHub; si su versión difiere de la instalada, descarga `devi-x86_64-unknown-linux-gnu`, comprueba su sha256 con `SHA256SUMS` y que `--version` (ejecutado como `devi`) dé la de la etiqueta, guarda el binario actual como `devi.prev`, instala el nuevo como `root:root 755`, reinicia `devi-server` y espera a que `/api/v1/health` responda por el socket. Si no arranca sano, vuelve a `devi.prev`. Un error de red no cambia nada: se reintenta en la siguiente pasada. Se instala en `/opt/devi/devi-update.sh`. |
| `devi-update.service` | Ejecuta el actualizador una vez, como root, con `Nice=10` y E/S en reposo. |
| `devi-update.timer` | Lanza el actualizador 5 min después de arrancar y luego cada 15 min. |
| `devi-update.test.ts` | Prueba de extremo a extremo del actualizador (GitHub falso, `systemctl` falso, salud por TCP y por socket). Va en `bun run test`. |

Todos los comandos de esta guía se lanzan desde una copia del repo en la PC servidor.

## Instalación nueva

```bash
sudo useradd --system --user-group --home-dir /var/lib/devi --shell /usr/sbin/nologin devi
sudo install -d -o root -g root -m 0755 /opt/devi /opt/devi/bin
sudo install -o root -g root -m 0755 deploy/servidor-linux/devi-update.sh /opt/devi/devi-update.sh
sudo install -o root -g root -m 0644 deploy/servidor-linux/devi-server.service deploy/servidor-linux/devi-update.service deploy/servidor-linux/devi-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo tailscale serve --bg unix:/run/devi/devi.sock
sudo systemctl enable devi-server
# La primera pasada del actualizador descarga e instala el binario y arranca el servidor.
sudo systemctl start devi-update.service
sudo systemctl enable --now devi-update.timer
```

Antes de usarlo, edita `--admin` y `--allowed-domain` en `devi-server.service` si el equipo no es `asai.digital`. Después, [verifica](#verificar).

## Migración desde la instalación anterior

La instalación anterior: usuario `asai`, binario en `/home/asai/devi/bin/devi`, datos en `/home/asai/.local/share/devi`, unidad en `/etc/systemd/system/devi-server.service` escuchando en `127.0.0.1:4747` y `tailscale serve --bg 4747` activo.

Con el puerto TCP, cualquier proceso de la PC puede hablar con el servidor y hacerse pasar por otra persona (ver [Seguridad](#seguridad)). La migración lo cambia a un socket que solo ven `devi` y root, y mueve binario y datos fuera de `/home`. La URL del servidor no cambia: las apps y la CLI siguen funcionando sin tocar nada.

```bash
sudo systemctl stop devi-update.timer devi-server
sudo useradd --system --user-group --home-dir /var/lib/devi --shell /usr/sbin/nologin devi
sudo install -d -o root -g root -m 0755 /opt/devi /opt/devi/bin
sudo install -o root -g root -m 0755 /home/asai/devi/bin/devi /opt/devi/bin/devi
sudo install -d -o devi -g devi -m 0700 /var/lib/devi
sudo cp -a /home/asai/.local/share/devi/. /var/lib/devi/
sudo chown -R devi:devi /var/lib/devi
sudo install -o root -g root -m 0755 deploy/servidor-linux/devi-update.sh /opt/devi/devi-update.sh
sudo install -o root -g root -m 0644 deploy/servidor-linux/devi-server.service deploy/servidor-linux/devi-update.service deploy/servidor-linux/devi-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo tailscale serve --https=443 off
sudo tailscale serve --bg unix:/run/devi/devi.sock
sudo systemctl enable --now devi-server
sudo systemctl enable --now devi-update.timer
systemctl status devi-server --no-pager
sudo ls -l /run/devi/devi.sock
sudo curl -fsS --unix-socket /run/devi/devi.sock http://localhost/api/v1/health
tailscale serve status
```

- El servicio se para antes de copiar: la base SQLite queda cerrada y consistente. `cp -a …/.` copia también `devi.db-wal` y `devi.db-shm` si existen.
- `journalctl -u devi-server -n 20` debe decir `servidor en unix:/run/devi/devi.sock`.
- Cuando todo funcione (prueba la app desde otro equipo), borra la copia vieja, que contiene la base y los archivos: `sudo rm -rf /home/asai/.local/share/devi /home/asai/devi`.

## Verificar

```bash
systemctl status devi-server --no-pager                 # active (running), User=devi
sudo ls -l /run/devi/devi.sock                          # srw------- devi devi
sudo curl -fsS --unix-socket /run/devi/devi.sock http://localhost/api/v1/health   # {"ok":true,...}
tailscale serve status                                  # https://<pc>.<tailnet>.ts.net -> unix:/run/devi/devi.sock
systemctl list-timers devi-update                       # próxima pasada del actualizador
```

Desde otro equipo de la tailnet: `https://<pc>.<tailnet>.ts.net/api/v1/health`. Y `curl http://127.0.0.1:4747/api/v1/health` en la PC servidor ya **no** debe responder.

## Seguridad

### Por qué un socket Unix

`tailscale serve` autentica a quien llega por la tailnet y añade la cabecera `Tailscale-User-Login`. El servidor confía en esa cabecera. Si escuchara en `127.0.0.1:4747`, **cualquier proceso de la misma PC** (otro usuario, un script, un navegador) podría conectarse directamente y mandar `Tailscale-User-Login: admin@empresa.com`.

Por eso en producción el servidor escucha en un socket Unix `0600` dentro de un directorio `0700` del usuario `devi`: solo `devi` y root llegan a él, y `tailscaled` (root) lo publica. `--port` queda para desarrollo y pruebas; el servidor avisa en el log si arranca en un puerto TCP fuera del modo dev.

### Qué hace el servidor

- `--socket RUTA`: escucha en un socket Unix en vez de un puerto TCP (excluyente con `--port`). Crea el directorio padre si falta, borra un socket huérfano de un arranque anterior (nunca otro tipo de archivo) y deja el socket en `0600`.
- `--allowed-domain DOMINIO` (repetible): solo entran logins `@DOMINIO`. Cualquier otro recibe `403 domain` antes de buscarlo en el equipo, y el admin no puede añadir personas de otros dominios. Los flags se suman al ajuste `allowedDomains` (visible y editable en Admin → Servidor) en cada arranque. Un admin no puede guardar una lista de dominios que lo deje fuera a él. Con la lista vacía no se filtra (lo normal en desarrollo).
- **Registro de auditoría** (Admin → Auditoría, solo admins): borradores, solicitudes, respuestas, descargas, cambios de personas, roles y ajustes, exportaciones de la base y logins rechazados. De los mensajes guarda solo su SHA-256. Las entradas no se modifican y se borran a los 365 días. Los cambios sensibles avisan a los admins en la app.
- **Límites de ritmo por persona**: 20 borradores cada 10 min (5 con archivos) y 120 acciones por minuto en el resto (el latido de presencia no cuenta). Quien los supera recibe `429 rate_limit` con `Retry-After`.
- **Cabeceras de seguridad**: `nosniff`, `no-referrer`, `no-store` en la API y `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` en JSON y descargas.

### La unidad systemd

- `StateDirectory=devi` crea `/var/lib/devi` de `devi`; `RuntimeDirectory=devi` crea `/run/devi` (`0700`) en cada arranque y lo borra al parar.
- `ProtectSystem=strict` deja el sistema en solo lectura salvo `/var/lib/devi` y `/run/devi`; `ProtectHome=yes` oculta `/home`; sin capacidades (`CapabilityBoundingSet=`), sin namespaces ni SUID.
- `MemoryDenyWriteExecute=no` es a propósito: el JIT de Bun necesita memoria escribible y ejecutable.
- `systemd-analyze verify` solo avisa de que falta `/opt/devi/bin/devi` si aún no está instalado; `systemd-analyze security devi-server` da una exposición de 3.0 («OK»).

### Política de Tailscale

Por defecto una tailnet deja que cualquier dispositivo hable con cualquier otro. Restringe la PC servidor para que solo el grupo de Devi llegue al 443 y que SSH siga abierto para quien la administra. En el panel de Tailscale → Access controls:

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

### Recomendaciones de la tailnet

- **Activa Device Approval** (Settings → Device management): un dispositivo nuevo no entra en la tailnet hasta que un admin lo aprueba, aunque alguien tenga una cuenta del dominio.
- **No compartas la PC servidor** (Machines → la PC → Share): un nodo compartido con usuarios de fuera de la tailnet les da acceso a sus puertos.
- Mantén `--allowed-domain` aunque las reglas de Tailscale ya filtren: son dos barreras independientes.
- Revisa de vez en cuando Admin → Auditoría y los avisos de logins rechazados.

## Operación

### Ver qué hace

```bash
journalctl -u devi-server -f         # el servidor
journalctl -u devi-update            # historial del actualizador
systemctl list-timers devi-update    # próxima pasada
```

Para lanzar el actualizador en el momento: `sudo systemctl start devi-update.service`.

### Desplegar una versión

1. `bun run version:set X.Y.Z`, commit, y etiqueta `vX.Y.Z`. Al subir la etiqueta, GitHub Actions crea una release **borrador** con los instaladores, los binarios `devi` y `SHA256SUMS`.
2. Cuando el borrador esté completo, **publícalo** en GitHub (Releases → Edit → Publish release). En 15 minutos como mucho el servidor se actualiza solo.

Los borradores y las prereleases no se despliegan: el actualizador solo mira `releases/latest`.

### Volver atrás

- **Publicando una release anterior:** el actualizador instala la versión de la última release publicada aunque sea más vieja. Despublica la mala (o márcala como prerelease) y asegúrate de que la buena es la «Latest».
- **A mano, al momento** (para el timer mientras tanto, o volvería a instalar la última publicada):

  ```bash
  sudo systemctl stop devi-update.timer
  sudo install -o root -g root -m 0755 /opt/devi/bin/devi.prev /opt/devi/bin/devi.tmp
  sudo mv -f /opt/devi/bin/devi.tmp /opt/devi/bin/devi
  sudo systemctl restart devi-server
  ```

  Vuelve a activarlo con `sudo systemctl start devi-update.timer` cuando la release correcta sea la publicada.

### Configuración del actualizador

Lee variables de entorno, con estos valores por defecto: `DEVI_REPO=DayanCabrera2003/devi`, `DEVI_BIN=/opt/devi/bin/devi`, `DEVI_OWNER=devi` (usuario con el que se prueba `--version`), `DEVI_SERVICE=devi-server`, `DEVI_ASSET=devi-x86_64-unknown-linux-gnu`, `DEVI_API=https://api.github.com`, `DEVI_SOCKET=/run/devi/devi.sock`, `DEVI_HEALTH=http://localhost/api/v1/health`, `SYSTEMCTL=systemctl`, `HEALTH_TIMEOUT=30`. Con `DEVI_SOCKET` vacío, la salud se pide a `DEVI_HEALTH` por TCP (para un servidor con `--port`). Para cambiarlas, añade `Environment=…` con `sudo systemctl edit devi-update.service`.

Necesita `curl` (7.40 o más nuevo, por `--unix-socket`), `python3`, `flock`, `runuser` y `sha256sum`.
