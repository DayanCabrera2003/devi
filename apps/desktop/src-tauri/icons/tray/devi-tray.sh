#!/usr/bin/env sh
# Genera los iconos de la bandeja (Devi monocromo: círculo con dos ojos) con rsvg-convert (librsvg).
# template*: negro para macOS (icon_as_template adapta el color a la barra de menús).
# white*: blanco para Linux y Windows. *-attention: con un punto de acento si hay pendientes.
set -eu
cd "$(dirname "$0")"
svg() { # $1 color del cuerpo, $2 punto (vacío = sin punto)
  dot=""; cut=""
  if [ -n "$2" ]; then
    cut='<circle cx="82" cy="18" r="21" fill="black"/>'
    dot="<circle cx=\"82\" cy=\"18\" r=\"15\" fill=\"$2\"/>"
  fi
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="64" height="64">
  <mask id="m"><rect width="100" height="100" fill="white"/>
    <ellipse cx="36" cy="46" rx="7" ry="11" fill="black"/><ellipse cx="64" cy="46" rx="7" ry="11" fill="black"/>$cut</mask>
  <circle cx="50" cy="50" r="44" fill="$1" mask="url(#m)"/>$dot
</svg>
SVG
}
for spec in "template:#000000:" "template-attention:#000000:#000000" "white:#ffffff:" "white-attention:#ffffff:#0a84ff"; do
  name=${spec%%:*}; rest=${spec#*:}; body=${rest%%:*}; dot=${rest#*:}
  svg "$body" "$dot" > "$name.svg"
  rsvg-convert -w 64 -h 64 "$name.svg" -o "$name.png"
done
