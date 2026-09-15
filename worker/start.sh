#!/usr/bin/env bash
# 启动 worker - 3并发×8核，可通过环境变量覆盖
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export CHEM_DB="${CHEM_DB:-$PROJECT_DIR/database/chem.db}"
export XTB_BIN="${XTB_BIN:-/root/Software/xtb/xtb_v6.7.1/bin/xtb}"
export WORKER_CONCURRENCY="${WORKER_CONCURRENCY:-3}"
export WORKER_THREADS_PER_JOB="${WORKER_THREADS_PER_JOB:-8}"
export WORKER_POLL_INTERVAL="${WORKER_POLL_INTERVAL:-2}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"
export OMP_STACKSIZE="${OMP_STACKSIZE:-512M}"

# 24核机器: 3×8 最优；若需调整: WORKER_CONCURRENCY=2 WORKER_THREADS_PER_JOB=8 ./start.sh

echo "CHEM_DB=$CHEM_DB"
echo "XTB_BIN=$XTB_BIN"
echo "CONCURRENCY=$WORKER_CONCURRENCY x THREADS=$WORKER_THREADS_PER_JOB"
echo "REDIS_URL=$REDIS_URL (无 Redis 自动回退 SQLite)"

exec python3 -m worker.worker
