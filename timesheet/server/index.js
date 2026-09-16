'use strict';

// `node:sqlite` só existe a partir do Node 22.5. Sem esta checagem o sistema
// morre com "Cannot find module 'node:sqlite'", que não diz o que fazer.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`
Node.js ${process.versions.node} é antigo demais para este sistema.

  Necessário: Node.js 22.5 ou superior (o banco usa o módulo node:sqlite,
              incluído no Node a partir dessa versão).

  Para atualizar:
    macOS    brew install node
    Windows  https://nodejs.org  (baixe a versão LTS mais recente)
    Linux    https://github.com/nodesource/distributions

  Confira depois com: node --version
`);
  process.exit(1);
}

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const { createApp } = require('./app');

const server = createApp();

server.listen(config.port, config.host, () => {
  console.log(`${config.firm.name} — Timesheet`);
  console.log(`Servidor em http://localhost:${config.port}  (banco: ${config.dbPath})`);
});

// Higiene de sessões: remove as expiradas de hora em hora sem prender o processo.
const cleanup = setInterval(() => {
  try { auth.purgeExpiredSessions(); } catch (err) { console.error('[limpeza]', err.message); }
}, 60 * 60 * 1000);
cleanup.unref();

function shutdown(signal) {
  console.log(`\n${signal} recebido — encerrando...`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
