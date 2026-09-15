# Database

- `schema.sql` 任务表定义
- MVP 用 SQLite: `database/chem.db` (零依赖，适合单机24核)
- 生产可切 PostgreSQL: 用 docker-compose 起 `postgres:16`

启动:
```bash
# SQLite
sqlite3 database/chem.db < database/schema.sql
# PostgreSQL (docker)
docker compose up -d db
```
