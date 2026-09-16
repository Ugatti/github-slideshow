'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db = null;

/** Abre (e cria, se necessário) o banco e aplica o esquema. Idempotente. */
function open(dbPath = config.dbPath) {
  if (db) return db;
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

function get() {
  if (!db) throw new Error('Banco não inicializado: chame db.open() primeiro.');
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

/** Executa `fn` dentro de uma transação, revertendo em caso de erro. */
function tx(fn) {
  const d = get();
  d.exec('BEGIN');
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch { /* transação já desfeita */ }
    throw err;
  }
}

const all = (sql, params = []) => get().prepare(sql).all(...params);
const one = (sql, params = []) => get().prepare(sql).get(...params) ?? null;
const run = (sql, params = []) => get().prepare(sql).run(...params);

function getSetting(key) {
  const row = one('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

/**
 * Segredo de sessão: usa SESSION_SECRET quando definido; caso contrário gera um
 * e persiste no banco, para que as sessões sobrevivam a reinícios do servidor.
 */
function sessionSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  let secret = getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    setSetting('session_secret', secret);
  }
  return secret;
}

module.exports = { open, get, close, tx, all, one, run, getSetting, setSetting, sessionSecret };
