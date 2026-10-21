#!/usr/bin/env bash
# Actualizador del servidor Devi (lo lanza devi-update.timer como root).
# Mira la última release PUBLICADA de GitHub (no borradores ni prereleases); si su versión
# difiere de la instalada (más nueva o más vieja: publicar una release antigua es un rollback),
# descarga el binario, comprueba su sha256 con SHA256SUMS, lo instala de forma atómica,
# reinicia el servicio y comprueba /health. Si no arranca sano, vuelve a devi.prev.
set -euo pipefail

DEVI_REPO="${DEVI_REPO:-DayanCabrera2003/devi}"
DEVI_BIN="${DEVI_BIN:-/home/asai/devi/bin/devi}"
DEVI_OWNER="${DEVI_OWNER:-asai}"
DEVI_SERVICE="${DEVI_SERVICE:-devi-server}"
DEVI_ASSET="${DEVI_ASSET:-devi-x86_64-unknown-linux-gnu}"
DEVI_API="${DEVI_API:-https://api.github.com}"
DEVI_HEALTH="${DEVI_HEALTH:-http://127.0.0.1:4747/api/v1/health}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-30}"

BIN_DIR="$(dirname "$DEVI_BIN")"
PREV="$DEVI_BIN.prev"

log() { echo "devi-update: $*"; }

# Una sola ejecución a la vez.
exec 9>"$BIN_DIR/.devi-update.lock"
if ! flock -n 9; then
  log "otra actualización en curso; salgo"
  exit 0
fi

as_owner() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "$DEVI_OWNER" -- "$@"
  else
    "$@"
  fi
}

# 1. Última release publicada.
if ! release_json="$(curl -fsSL --connect-timeout 10 --max-time 30 \
  -H "Accept: application/vnd.github+json" "$DEVI_API/repos/$DEVI_REPO/releases/latest" 2>&1)"; then
  log "no se pudo consultar GitHub (se reintentará): ${release_json##*$'\n'}"
  exit 0
fi

if ! parsed="$(printf '%s' "$release_json" | python3 -I -c '
import json, sys
r = json.load(sys.stdin)
urls = {a["name"]: a["browser_download_url"] for a in r.get("assets", [])}
print(r.get("tag_name", ""))
print(urls.get(sys.argv[1], ""))
print(urls.get("SHA256SUMS", ""))
' "$DEVI_ASSET")"; then
  log "respuesta de GitHub ilegible (se reintentará)"
  exit 0
fi
{ read -r tag; read -r asset_url; read -r sums_url; } <<<"$parsed"

want="${tag#v}"
if [ -z "$want" ]; then
  log "la release no tiene etiqueta (se reintentará)"
  exit 0
fi

have="$(as_owner "$DEVI_BIN" --version 2>/dev/null || true)"
if [ "$have" = "$want" ]; then
  log "al día ($have)"
  exit 0
fi

if [ -z "$asset_url" ] || [ -z "$sums_url" ]; then
  log "la release $tag aún no tiene $DEVI_ASSET y SHA256SUMS (se reintentará)"
  exit 0
fi

log "instalada ${have:-ninguna}, publicada $want: actualizando"

# 2. Descarga en un temporal junto al binario (mismo sistema de archivos: el mv es atómico).
tmp="$(mktemp -d "$BIN_DIR/.devi-update.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
chmod 755 "$tmp"

if ! curl -fsSL --connect-timeout 10 --max-time 300 -o "$tmp/devi" "$asset_url" ||
  ! curl -fsSL --connect-timeout 10 --max-time 30 -o "$tmp/SHA256SUMS" "$sums_url"; then
  log "falló la descarga (se reintentará)"
  exit 0
fi

expected="$(awk -v f="$DEVI_ASSET" '$2 == f || $2 == "*" f { print $1; exit }' "$tmp/SHA256SUMS")"
actual="$(sha256sum "$tmp/devi" | awk '{ print $1 }')"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  log "ERROR: el sha256 de $DEVI_ASSET no coincide con SHA256SUMS; no se instala"
  exit 1
fi

chmod 755 "$tmp/devi"
got="$(as_owner "$tmp/devi" --version 2>/dev/null || true)"
if [ "$got" != "$want" ]; then
  log "ERROR: el binario descargado dice '$got', se esperaba $want; no se instala"
  exit 1
fi

# 3. Instalación: copia del actual como devi.prev y mv atómico del nuevo.
if [ -e "$DEVI_BIN" ]; then
  cp -p "$DEVI_BIN" "$tmp/prev"
  mv -f "$tmp/prev" "$PREV"
fi
if [ "$(id -u)" -eq 0 ]; then
  chown "$DEVI_OWNER:" "$tmp/devi"
  [ -e "$PREV" ] && chown "$DEVI_OWNER:" "$PREV"
fi
mv -f "$tmp/devi" "$DEVI_BIN"
"$SYSTEMCTL" restart "$DEVI_SERVICE"

# 4. Comprobación de salud.
healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 2 "$DEVI_HEALTH" 2>/dev/null | grep -q '"ok":[[:space:]]*true'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if healthy; then
  log "actualizado a $want"
  exit 0
fi

log "ERROR: $DEVI_SERVICE no responde sano tras actualizar a $want; vuelvo a ${have:-devi.prev}"
if [ -e "$PREV" ]; then
  cp -p "$PREV" "$tmp/back"
  mv -f "$tmp/back" "$DEVI_BIN"
fi
"$SYSTEMCTL" restart "$DEVI_SERVICE"
exit 1
