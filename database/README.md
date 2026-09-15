# Database

- `chem.db`：SQLite（WAL 模式），不入 git；每日备份到 `/root/Backups/chem-portal-db/`
- 表结构由 API 启动时自动创建/补列（`backend/app/db/session.py`），`schema.sql` 与之一致，仅作参考

手动备份：

```bash
bash scripts/backup_db.sh
```
