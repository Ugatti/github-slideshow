'use strict';
/**
 * Backup consistente do banco, com o sistema no ar.
 *
 * Usa VACUUM INTO, que o SQLite executa dentro de uma transação: o arquivo
 * gerado é um instantâneo íntegro mesmo com gravações acontecendo. Copiar o
 * .db com `cp` durante o uso pode capturar um estado parcial — por isso este
 * script existe em vez de uma linha de cópia.
 *
 * Uso:  node scripts/backup.js [diretório] [--keep=30]
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/db');
const config = require('../server/config');

const argumentos = process.argv.slice(2);
const destino = path.resolve(argumentos.find((a) => !a.startsWith('--')) || path.join(config.ROOT, 'backups'));
const manter = Number((argumentos.find((a) => a.startsWith('--keep=')) || '--keep=30').split('=')[1]);

if (!fs.existsSync(config.dbPath)) {
  console.error(`Banco não encontrado em ${config.dbPath} — nada a salvar.`);
  process.exit(1);
}

fs.mkdirSync(destino, { recursive: true });

const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const arquivo = path.join(destino, `timesheet-${carimbo}.db`);

db.open();
// O caminho vai como literal SQL: aspas simples internas precisam ser dobradas.
db.get().exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);
db.close();

const tamanho = fs.statSync(arquivo).size;
console.log(`Backup criado: ${arquivo} (${(tamanho / 1024).toFixed(0)} KB)`);

/* Rotação: mantém os N mais recentes. */
const antigos = fs.readdirSync(destino)
  .filter((n) => /^timesheet-.*\.db$/.test(n))
  .sort()
  .reverse()
  .slice(manter);

for (const nome of antigos) {
  fs.unlinkSync(path.join(destino, nome));
  console.log(`Removido backup antigo: ${nome}`);
}
console.log(`Retenção: ${manter} cópias.`);
