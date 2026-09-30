#!/usr/bin/env bash
# VisOMP — pasang skill ke OMP (sekali saja, di mesin ini).
#   bash install.sh [--skills-dir DIR] [--link]
# Default: salin ke ~/.agents/skills/visomp (aman di Windows). --link membuat symlink (butuh hak akses).
set -u
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/skills/visomp" && pwd -P)"
DEST="${1:-}"
LINK=0
for a in "$@"; do
  case "$a" in
    --link) LINK=1 ;;
    --skills-dir=*) DEST="${a#--skills-dir=}" ;;
    --skills-dir) shift; DEST="${1:-}" ;;
  esac
done
[ -z "${DEST:-}" ] && DEST="$HOME/.agents/skills/visomp"

command -v node >/dev/null 2>&1 || { echo "VisOMP: butuh Node ≥ 18 (node tidak ditemukan)." >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null \
  || { echo "VisOMP: butuh Node ≥ 18 (terpasang: $(node -v))." >&2; exit 1; }

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
if [ "$LINK" = 1 ]; then
  ln -s "$SRC" "$DEST" && echo "VisOMP: tertaut $DEST -> $SRC"
else
  cp -R "$SRC" "$DEST" && echo "VisOMP: tersalin ke $DEST"
fi
echo "VisOMP: buka sesi OMP baru, lalu jalankan: /skill:visomp   (atau: node \"$DEST/bin/visomp.mjs\" start)"
