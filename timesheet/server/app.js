'use strict';
const path = require('node:path');
const http = require('node:http');
const db = require('./db');
const auth = require('./auth');
const audit = require('./audit');
const config = require('./config');
const { Router, createHandler } = require('./http');

function buildRouter() {
  const router = new Router();
  require('./routes/auth')(router);
  require('./routes/users')(router);
  require('./routes/clients')(router);
  require('./routes/projects')(router);
  require('./routes/entries')(router);
  require('./routes/invoices')(router);
  require('./routes/reports')(router);
  require('./routes/settings')(router);
  router.get('/api/health', async () => ({ ok: true, firm: config.firm.name }), { auth: false });
  return router;
}

/**
 * Garante a existência de uma conta master. Roda a cada boot, mas só age quando
 * o banco ainda não tem nenhuma; a senha gerada é exibida uma única vez.
 */
function ensureMasterAccount({ quiet = false } = {}) {
  const existing = db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'master'").n;
  if (existing > 0) return null;

  const password = config.bootstrap.password || auth.generatePassword();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at)
     VALUES (?,?,?, 'master', 1, ?, ?)`,
    [config.bootstrap.name, config.bootstrap.email.toLowerCase(),
     auth.hashPassword(password), now, now]
  );
  audit.log(null, 'bootstrap', 'user', null, { email: config.bootstrap.email });

  if (!quiet) {
    const generated = !config.bootstrap.password;
    console.log('\n' + '='.repeat(66));
    console.log('  CONTA MASTER CRIADA');
    console.log(`  E-mail: ${config.bootstrap.email}`);
    console.log(`  Senha : ${password}`);
    if (generated) console.log('  (senha gerada automaticamente — anote agora e troque no 1º acesso)');
    console.log('='.repeat(66) + '\n');
  }
  return { email: config.bootstrap.email, password };
}

function createApp({ dbPath = config.dbPath, quiet = false } = {}) {
  db.open(dbPath);
  ensureMasterAccount({ quiet });
  auth.purgeExpiredSessions();
  const handler = createHandler({
    router: buildRouter(),
    publicDir: path.join(config.ROOT, 'public'),
  });
  return http.createServer(handler);
}

module.exports = { createApp, buildRouter, ensureMasterAccount };
