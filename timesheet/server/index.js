'use strict';
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
