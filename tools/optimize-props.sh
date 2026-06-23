#!/bin/bash
# Пакетная оптимизация сгенерённых GLB-пропов в формат движка (256 JPEG + quantize).
# Ставит gltf-transform+sharp ОДИН раз во временную папку, гонит все файлы.
#   bash tools/optimize-props.sh <in1.glb> <propName1> [<in2.glb> <propName2> ...]
# Кладёт client/public/models/prop_<propName>.glb
set -e
OUT="client/public/models"
mkdir -p "$OUT"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "ставлю gltf-transform+sharp…"
( cd "$WORK" && npm init -y >/dev/null 2>&1 && npm i --no-audit --no-fund @gltf-transform/cli sharp >/dev/null 2>&1 )
GT() { ( cd "$WORK" && npx --no-install @gltf-transform/cli "$@" ); }

while [ -n "$1" ]; do
  IN="$1"; NAME="$2"; shift 2
  ABS="$(cd "$(dirname "$IN")" && pwd)/$(basename "$IN")"
  T="$WORK/t"; FIN="$OUT/prop_${NAME}.glb"
  GT dedup    "$ABS"       "${T}1.glb" >/dev/null 2>&1
  GT weld     "${T}1.glb"  "${T}2.glb" >/dev/null 2>&1
  if [ -n "$SIMPLIFY" ]; then GT simplify "${T}2.glb" "${T}2.glb" --ratio "$SIMPLIFY" --error 0.012 >/dev/null 2>&1; fi
  GT resize   "${T}2.glb"  "${T}3.glb" --width 256 --height 256 >/dev/null 2>&1
  GT jpeg     "${T}3.glb"  "${T}4.glb" --quality 85 --formats "*" >/dev/null 2>&1
  GT quantize "${T}4.glb"  "${T}5.glb" --quantize-normal 8 --quantize-texcoord 12 >/dev/null 2>&1
  cp "${T}5.glb" "$FIN"
  sz=$(stat -f%z "$FIN" 2>/dev/null || stat -c%s "$FIN")
  printf "OK  %s  %.0f KB\n" "$FIN" "$(echo "$sz/1024"|bc -l)"
done
