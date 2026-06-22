#!/bin/bash
# Оптимизация «сырого» GLB (Blender-экспорт, ~15-25 МБ, текстура 4096 PNG) в формат
# движка `_opt` (~0.8 МБ): KHR_mesh_quantization + текстура 256 JPEG. Геометрия НЕ
# децимируется (исходники уже ~40k треуг. = бюджет существующих моделей).
#
#   bash tools/optimize-glb.sh <input.glb> <tankId> [outDir]
#   пример: bash tools/optimize-glb.sh ~/Downloads/usa/sherman.glb sher client/public/models
#
# Кладёт <outDir>/<tankId>_opt.glb. Дальше прописать в meta.js: TANK_MODELS,
# TANK_LENGTH_M, и (если «едет задом») MODEL_FLIP. Флип определяй через
# client/public/_idcheck.html (добавь id в список MODELS, открой в браузере).
#
# ВАЖНО: gltf-transform требует sharp для JPEG. Скрипт ставит обе зависимости во
# временную папку и гонит CLI оттуда (в песочнице node_modules не персистится между
# вызовами — поэтому install+convert ОДНИМ вызовом). jpeg-шагу нужен --formats "*",
# иначе PNG-вход молча пропускается.
set -e
IN="$1"; ID="$2"; OUT="${3:-client/public/models}"
[ -z "$IN" ] || [ -z "$ID" ] && { echo "usage: optimize-glb.sh <input.glb> <tankId> [outDir]"; exit 1; }
[ -f "$IN" ] || { echo "no such file: $IN"; exit 1; }
mkdir -p "$OUT"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
( cd "$WORK" && npm init -y >/dev/null 2>&1 && npm i --no-audit --no-fund @gltf-transform/cli sharp >/dev/null 2>&1 )
GT() { ( cd "$WORK" && npx --no-install @gltf-transform/cli "$@" ); }

T="$WORK/t"; FIN="$OUT/${ID}_opt.glb"
GT dedup    "$(cd "$(dirname "$IN")"&&pwd)/$(basename "$IN")" "${T}1.glb" >/dev/null 2>&1
GT weld     "${T}1.glb" "${T}2.glb" >/dev/null 2>&1
GT resize   "${T}2.glb" "${T}3.glb" --width 256 --height 256 >/dev/null 2>&1
GT jpeg     "${T}3.glb" "${T}4.glb" --quality 85 --formats "*" >/dev/null 2>&1
GT quantize "${T}4.glb" "${T}5.glb" --quantize-normal 8 --quantize-texcoord 12 >/dev/null 2>&1
cp "${T}5.glb" "$FIN"

sz=$(stat -f%z "$FIN" 2>/dev/null || stat -c%s "$FIN")
tex=$(GT inspect "$FIN" 2>/dev/null | grep -oE "image/(jpeg|png)" | head -1)
printf "OK  %s  %.0f KB  tex=%s\n" "$FIN" "$(echo "$sz/1024"|bc -l)" "$tex"
