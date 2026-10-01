#!/usr/bin/env bash
# VisOMP — pasang skill + autostart hook ke OMP (sekali saja, di mesin ini).
#   bash install.sh [--skills-dir DIR] [--no-hook] [--link]
# Default: salin ke ~/.agents/skills/visomp + pasang hook di ~/.omp/agent/hooks/pre/
set -u
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/skills/visomp" && pwd -P)"
HOOK_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/hooks/pre/visomp-autostart.js" && pwd -P)"
DEST=""
LINK=0
NO_HOOK=0
for a in "$@"; do
  case "$a" in
    --link) LINK=1 ;;
    --no-hook) NO_HOOK=1 ;;
    --skills-dir=*) DEST="${a#--skills-dir=}" ;;
    --skills-dir) shift; DEST="${1:-}" ;;
  esac
done
[ -z "${DEST:-}" ] && DEST="$HOME/.agents/skills/visomp"

command -v node >/dev/null 2>&1 || { echo "VisOMP: butuh Node ≥ 18 (node tidak ditemukan)." >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null \
  || { echo "VisOMP: butuh Node ≥ 18 (terpasang: $(node -v))." >&2; exit 1; }

# Pasang skill
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
if [ "$LINK" = 1 ]; then
  ln -s "$SRC" "$DEST" && echo "VisOMP: skill tertaut $DEST -> $SRC"
else
  cp -R "$SRC" "$DEST" && echo "VisOMP: skill tersalin ke $DEST"
fi

# Pasang autostart hook
if [ "$NO_HOOK" = 0 ]; then
  HOOK_DIR="$HOME/.omp/agent/hooks/pre"
  mkdir -p "$HOOK_DIR"
  cp "$HOOK_SRC" "$HOOK_DIR/visomp-autostart.js"
  echo "VisOMP: autostart hook dipasang di $HOOK_DIR/visomp-autostart.js"
  echo "        → kantor 3D akan menyala otomatis setiap sesi OMP dibuka."
else
  echo "VisOMP: hook dilewati (--no-hook). Jalankan manual: node \"$DEST/bin/visomp.mjs\" start"
fi

echo ""
echo "✅ VisOMP terpasang. Buka sesi OMP baru untuk mulai — kantor otomatis menyala."
echo "   Pantau di: http://127.0.0.1:8788/kerja"
