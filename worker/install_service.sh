#!/usr/bin/env bash
# systemd 部署示例: sudo cp chem-worker.service /etc/systemd/system/ && sudo systemctl enable --now chem-worker
set -e
cat <<'UNIT' > /etc/systemd/system/chem-worker.service
[Unit]
Description=Chem Portal Worker (3x8 xtb)
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/Projects/chem-portal
Environment=CHEM_DB=/root/Projects/chem-portal/database/chem.db
Environment=XTB_BIN=/root/Software/xtb/xtb_v6.7.1/bin/xtb
Environment=WORKER_CONCURRENCY=3
Environment=WORKER_THREADS_PER_JOB=8
Environment=WORKER_POLL_INTERVAL=2
# 有 Redis 时取消下行注释
# Environment=REDIS_URL=redis://127.0.0.1:6379/0
ExecStart=/usr/bin/python3 -m worker.worker
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
echo "written to /etc/systemd/system/chem-worker.service"
echo "run: systemctl daemon-reload && systemctl enable --now chem-worker && journalctl -u chem-worker -f"
