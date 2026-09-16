'use strict';
const crypto = require('node:crypto');
const db = require('./db');
const config = require('./config');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const COOKIE = 'ae_ts_session';
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_WINDOW_MIN = 15;

const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ senhas */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Senha aleatória legível para bootstrap/reset (sem caracteres ambíguos). */
function generatePassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/* ------------------------------------------------------------------ sessões */

const tokenHash = (token) =>
  crypto.createHmac('sha256', db.sessionSecret()).update(token).digest('hex');

function createSession(userId, userAgent = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)',
    [tokenHash(token), userId, nowIso(), expires.toISOString(), userAgent]
  );
  return { token, expiresAt: expires };
}

function userForToken(token) {
  if (!token) return null;
  const row = db.one(
    `SELECT s.expires_at, u.id, u.name, u.email, u.role, u.oab, u.hourly_rate_cents, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [tokenHash(token)]
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    destroySession(token);
    return null;
  }
  if (!row.active) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    oab: row.oab,
    hourlyRateCents: row.hourly_rate_cents,
  };
}

const destroySession = (token) =>
  db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);

const destroyUserSessions = (userId) =>
  db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);

const purgeExpiredSessions = () =>
  db.run('DELETE FROM sessions WHERE expires_at < ?', [nowIso()]);

/* --------------------------------------------------- proteção contra força bruta */

function recordLoginAttempt(email, ok) {
  db.run('INSERT INTO login_attempts (email, at, ok) VALUES (?,?,?)', [
    String(email).toLowerCase(), nowIso(), ok ? 1 : 0,
  ]);
  if (ok) {
    db.run('DELETE FROM login_attempts WHERE email = ? AND ok = 0', [
      String(email).toLowerCase(),
    ]);
  }
}

function isLockedOut(email) {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60 * 1000).toISOString();
  const row = db.one(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND ok = 0 AND at > ?',
    [String(email).toLowerCase(), since]
  );
  return (row?.n ?? 0) >= MAX_FAILED_ATTEMPTS;
}

/* ------------------------------------------------------------------ cookies */

function serializeCookie(token, expiresAt) {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

const clearCookie = () =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const piece of header.split(';')) {
    const idx = piece.indexOf('=');
    if (idx === -1) continue;
    out[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
  }
  return out;
}

module.exports = {
  COOKIE,
  MAX_FAILED_ATTEMPTS,
  hashPassword,
  verifyPassword,
  generatePassword,
  createSession,
  userForToken,
  destroySession,
  destroyUserSessions,
  purgeExpiredSessions,
  recordLoginAttempt,
  isLockedOut,
  serializeCookie,
  clearCookie,
  parseCookies,
};
