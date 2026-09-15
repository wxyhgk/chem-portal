#!/bin/bash
# chem.db 在线备份：SQLite backup API（WAL 下也得到一致快照）→ 完整性检查 → gzip，保留最近 KEEP 份
# 由 systemd 定时器 chem-portal-backup.timer 每天执行；手动：bash scripts/backup_db.sh
set -euo pipefail
DB=/root/Projects/chem-portal/database/chem.db
DEST=${CHEM_BACKUP_DIR:-/root/Backups/chem-portal-db}
KEEP=${CHEM_BACKUP_KEEP:-14}
PY=/usr/local/lib/hermes-agent/venv/bin/python

mkdir -p "$DEST"
chmod 700 "$DEST"
OUT="$DEST/chem-$(date +%Y%m%d-%H%M%S).db"
"$PY" - "$DB" "$OUT" <<'PYEOF'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1], timeout=60)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close()
src.close()
chk = sqlite3.connect(sys.argv[2])
ok = chk.execute("pragma integrity_check").fetchone()[0]
n = chk.execute("select count(*) from jobs").fetchone()[0]
chk.close()
if ok != "ok":
    sys.exit(f"integrity_check failed: {ok}")
print(f"jobs={n}")
PYEOF
gzip -f "$OUT"
chmod 600 "$OUT.gz"
ls -1t "$DEST"/chem-*.db.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup ok: $OUT.gz ($(ls -1 "$DEST"/chem-*.db.gz | wc -l) kept)"
