'use strict';
const db = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const v = require('../validate');
const { badRequest, unauthorized, HttpError } = require('../errors');
const config = require('../config');

// Hash descartável com custo real de scrypt, usado quando o e-mail não existe:
// mantém o tempo de resposta do login constante.
const DUMMY_HASH = auth.hashPassword('__usuario_inexistente__');

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  oab: u.oab ?? null,
  hourlyRateCents: u.hourlyRateCents ?? u.hourly_rate_cents ?? null,
});

module.exports = function register(router) {
  router.post('/api/auth/login', async (ctx) => {
    const email = v.email(ctx.body.email, 'e-mail');
    const password = v.str(ctx.body.password, 'senha', { max: 200 });

    if (auth.isLockedOut(email)) {
      throw new HttpError(429, 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
    }

    const row = db.one('SELECT * FROM users WHERE email = ?', [email]);
    // Verifica o hash mesmo sem usuário, para não vazar por tempo de resposta
    // quais e-mails existem no sistema.
    const dummy = DUMMY_HASH;
    const ok = auth.verifyPassword(password, row ? row.password_hash : dummy);

    if (!row || !ok || !row.active) {
      auth.recordLoginAttempt(email, false);
      audit.log(row?.id ?? null, 'login_failed', 'user', row?.id ?? null, { email });
      throw unauthorized('E-mail ou senha inválidos.');
    }

    auth.recordLoginAttempt(email, true);
    const { token, expiresAt } = auth.createSession(row.id, ctx.req.headers['user-agent'] || null);
    ctx.setCookie(auth.serializeCookie(token, expiresAt));
    audit.log(row.id, 'login', 'user', row.id);
    return { user: publicUser(row), firm: config.firm };
  }, { auth: false });

  router.post('/api/auth/logout', async (ctx) => {
    const cookies = auth.parseCookies(ctx.req.headers.cookie);
    if (cookies[auth.COOKIE]) auth.destroySession(cookies[auth.COOKIE]);
    ctx.setCookie(auth.clearCookie());
    audit.log(ctx.user?.id, 'logout', 'user', ctx.user?.id);
    return { ok: true };
  }, { auth: false });

  router.get('/api/auth/me', async (ctx) => ({
    user: publicUser(ctx.user),
    firm: config.firm,
  }));

  router.post('/api/auth/password', async (ctx) => {
    const current = v.str(ctx.body.currentPassword, 'senha atual', { max: 200 });
    const next = v.password(ctx.body.newPassword, 'nova senha');

    const row = db.one('SELECT password_hash FROM users WHERE id = ?', [ctx.user.id]);
    if (!auth.verifyPassword(current, row.password_hash)) {
      throw badRequest('A senha atual está incorreta.');
    }
    if (current === next) throw badRequest('A nova senha deve ser diferente da atual.');

    db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
      auth.hashPassword(next), new Date().toISOString(), ctx.user.id,
    ]);
    // Invalida as demais sessões e reemite a atual: troca de senha deve
    // derrubar qualquer sessão aberta em outro dispositivo.
    auth.destroyUserSessions(ctx.user.id);
    const { token, expiresAt } = auth.createSession(ctx.user.id, ctx.req.headers['user-agent'] || null);
    ctx.setCookie(auth.serializeCookie(token, expiresAt));
    audit.log(ctx.user.id, 'password_change', 'user', ctx.user.id);
    return { ok: true };
  });
};

module.exports.publicUser = publicUser;
