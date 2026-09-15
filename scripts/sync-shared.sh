#!/bin/bash
# shared 契约同步 — chem-portal-web 与 chem-portal 共用 Job 契约，防止手工复制漂移
# 默认 --check：只比对 job.ts / job.py，漂移则非零退出（本地跑，不接入 build，Vercel 无 sibling 目录）
# 同步：--to-web（以 chem-portal 为源，覆盖本仓）或 --to-portal（反向）
set -e
cd "$(dirname "$0")/.."
FILES="schemas/job.ts schemas/job.py"
SRC="shared"; DST="../chem-portal/shared"
MODE="--check"
for a in "$@"; do case "$a" in --to-web) MODE="--to-web";; --to-portal) MODE="--to-portal";; esac; done

if [ "$MODE" = "--check" ]; then
  for f in $FILES; do
    if ! diff -q "$SRC/$f" "$DST/$f" >/dev/null 2>&1; then
      echo "DRIFT: $f — 跑 scripts/sync-shared.sh --to-web 或 --to-portal"
      diff "$SRC/$f" "$DST/$f" || true
      exit 1
    fi
  done
  echo "shared 一致"
  exit 0
fi

if [ "$MODE" = "--to-web" ]; then FROM="$DST"; TO="$SRC"; else FROM="$SRC"; TO="$DST"; fi
for f in $FILES; do cp "$FROM/$f" "$TO/$f"; echo "copied $f ($MODE)"; done
