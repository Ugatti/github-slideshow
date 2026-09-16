#!/bin/sh
# Backup diário do banco, com o sistema no ar.
#
# Instale no cron do servidor (crontab -e), às 2h da manhã:
#   0 2 * * * /caminho/para/timesheet/deploy/backup-diario.sh >> /var/log/timesheet-backup.log 2>&1
#
# IMPORTANTE: um backup que mora no mesmo servidor não protege contra a perda
# do servidor. Configure o envio para fora (rclone/rsync) na seção abaixo.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "[$(date '+%F %T')] iniciando backup"
docker compose exec -T app node scripts/backup.js /app/backups --keep=30
echo "[$(date '+%F %T')] backup local concluído em $DIR/backups"

# --- Cópia para fora do servidor (descomente e ajuste) ---------------------
# Requer rclone configurado com um destino chamado "backup":
#   rclone config   → escolha Google Drive, S3, Backblaze etc.
#
# rclone sync "$DIR/backups" backup:timesheet-azeredoeugatti --max-age 40d
# echo "[$(date '+%F %T')] cópia externa concluída"
