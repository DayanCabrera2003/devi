# Servidor de Devi en Linux (PC del equipo)

El servidor corre como servicio de systemd `devi-server` (usuario `asai`), escucha en `127.0.0.1:4747` y se publica en la tailnet con `tailscale serve`. Un timer lo actualiza solo desde las releases de GitHub. Sin Docker; el actualizador corre con prioridad baja de CPU y disco.

| Fichero | Qué hace |
|---|---|
| `devi-server.service` | El servicio del servidor (copia de la unidad instalada en `/etc/systemd/system/`). Binario en `/home/asai/devi/bin/devi`, datos en `/home/asai/.local/share/devi`. |
| `devi-update.sh` | Mira la última release **publicada** de GitHub. Si su versión difiere de la instalada, descarga `devi-x86_64-unknown-linux-gnu`, comprueba su sha256 con `SHA256SUMS` y que `--version` dé la de la etiqueta, guarda el binario actual como `devi.prev`, instala el nuevo, reinicia `devi-server` y espera a que `/api/v1/health` responda. Si no arranca sano, vuelve a `devi.prev`. Un error de red no hace nada (se reintenta en la siguiente pasada). |
| `devi-update.service` | Ejecuta el script una vez, como root (tiene que reiniciar el servicio), con `Nice=10` e E/S en reposo. |
| `devi-update.timer` | Lanza el actualizador 5 min después de arrancar y luego cada 15 min. |
| `devi-update.test.ts` | Prueba de extremo a extremo del script (GitHub falso, `systemctl` falso). Va en `bun run test`. |

## Instalación (una vez, con sudo)

Desde una copia del repo en la PC servidor:

```bash
sudo install -o root -g root -m 755 deploy/servidor-linux/devi-update.sh /home/asai/devi/devi-update.sh
sudo install -o root -g root -m 644 deploy/servidor-linux/devi-server.service deploy/servidor-linux/devi-update.service deploy/servidor-linux/devi-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now devi-update.timer
```

Para probarlo en el momento: `sudo systemctl start devi-update.service`.

El script es de root (no de `asai`) porque corre como root: así el usuario del servicio no puede cambiarlo.

## Ver qué hace

```bash
journalctl -u devi-update            # historial del actualizador
journalctl -u devi-update -f         # en vivo
systemctl list-timers devi-update    # próxima pasada
journalctl -u devi-server -f         # el servidor
```

## Desplegar una versión

1. `bun run version:set X.Y.Z`, commit, y etiqueta `vX.Y.Z`. Al subir la etiqueta, GitHub Actions crea una release **borrador** con los instaladores, los binarios `devi` y `SHA256SUMS`.
2. Cuando el borrador esté completo, **publícalo** en GitHub (Releases → Edit → Publish release). En 15 minutos como mucho el servidor se actualiza solo.

Los borradores y las prereleases no se despliegan: el script solo mira `releases/latest`.

## Volver atrás

- **Publicando una release anterior:** el script instala la versión de la última release publicada aunque sea más vieja. Despublica la mala (o márcala como prerelease) y asegúrate de que la buena es la «Latest».
- **A mano, al momento** (el timer volvería a instalar la última publicada; páralo mientras tanto):

  ```bash
  sudo systemctl stop devi-update.timer
  sudo cp -p /home/asai/devi/bin/devi.prev /home/asai/devi/bin/devi.tmp
  sudo mv -f /home/asai/devi/bin/devi.tmp /home/asai/devi/bin/devi
  sudo systemctl restart devi-server
  ```

  Vuelve a activarlo con `sudo systemctl start devi-update.timer` cuando la release correcta sea la publicada.

## Configuración

El script lee de variables de entorno (con estos valores por defecto): `DEVI_REPO=DayanCabrera2003/devi`, `DEVI_BIN=/home/asai/devi/bin/devi`, `DEVI_OWNER=asai`, `DEVI_SERVICE=devi-server`, `DEVI_ASSET=devi-x86_64-unknown-linux-gnu`, `DEVI_API=https://api.github.com`, `DEVI_HEALTH=http://127.0.0.1:4747/api/v1/health`, `SYSTEMCTL=systemctl`, `HEALTH_TIMEOUT=30`. Para cambiarlas, añade `Environment=…` con `sudo systemctl edit devi-update.service`.

Necesita `curl`, `python3`, `flock`, `runuser` y `sha256sum` (vienen en cualquier distribución de escritorio).
