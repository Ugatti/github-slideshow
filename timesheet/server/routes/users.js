'use strict';
const db = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const v = require('../validate');
const { badRequest, notFound, conflict } = require('../errors');
const { status } = require('../http');

const shape = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  oab: r.oab,
  hourlyRateCents: r.hourly_rate_cents,
  active: !!r.active,
  createdAt: r.created_at,
});

module.exports = function register(router) {
  // Lista visível a todos: o formulário de lançamento e os filtros de
  // relatório precisam exibir nomes de colegas. Dados sensíveis (valor/hora,
  // e-mail) só saem para a master.
  router.get('/api/users', async (ctx) => {
    const rows = db.all('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE');
    if (ctx.user.role === 'master') return { users: rows.map(shape) };
    return {
      users: rows
        .filter((r) => r.active)
        .map((r) => ({ id: r.id, name: r.name, role: r.role, active: true })),
    };
  });

  router.post('/api/users', async (ctx) => {
    const name = v.str(ctx.body.name, 'nome', { max: 150 });
    const email = v.email(ctx.body.email, 'e-mail');
    const role = v.oneOf(ctx.body.role, 'perfil', ['master', 'user']);
    const oab = v.str(ctx.body.oab, 'OAB', { required: false, max: 30 });
    const rate = v.money(ctx.body.hourlyRate, 'valor/hora', { required: false });

    if (db.one('SELECT id FROM users WHERE email = ?', [email])) {
      throw conflict('Já existe um usuário com este e-mail.');
    }

    // Senha provisória gerada pelo sistema; devolvida uma única vez para ser
    // entregue ao profissional, que a troca no primeiro acesso.
    const provisional = ctx.body.password
      ? v.password(ctx.body.password, 'senha')
      : auth.generatePassword();

    const now = new Date().toISOString();
    const res = db.run(
      `INSERT INTO users (name, email, password_hash, role, oab, hourly_rate_cents, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,1,?,?)`,
      [name, email, auth.hashPassword(provisional), role, oab, rate, now, now]
    );
    const id = Number(res.lastInsertRowid);
    audit.log(ctx.user.id, 'create', 'user', id, { name, email, role });
    const created = db.one('SELECT * FROM users WHERE id = ?', [id]);
    return status(201, { user: shape(created), provisionalPassword: provisional });
  }, { role: 'master' });

  router.put('/api/users/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const row = db.one('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw notFound('Usuário não encontrado.');

    const name = v.str(ctx.body.name, 'nome', { max: 150 });
    const email = v.email(ctx.body.email, 'e-mail');
    const role = v.oneOf(ctx.body.role, 'perfil', ['master', 'user']);
    const oab = v.str(ctx.body.oab, 'OAB', { required: false, max: 30 });
    const rate = v.money(ctx.body.hourlyRate, 'valor/hora', { required: false });
    const active = v.bool(ctx.body.active, true);

    const clash = db.one('SELECT id FROM users WHERE email = ? AND id <> ?', [email, id]);
    if (clash) throw conflict('Já existe outro usuário com este e-mail.');

    // Trava de segurança: o sistema precisa manter ao menos uma conta master
    // ativa, senão ninguém consegue administrar clientes, projetos e usuários.
    const wouldRemoveMaster =
      row.role === 'master' && row.active && (role !== 'master' || !active);
    if (wouldRemoveMaster && countActiveMasters() <= 1) {
      throw badRequest('É necessário manter ao menos uma conta master ativa.');
    }

    db.run(
      `UPDATE users SET name=?, email=?, role=?, oab=?, hourly_rate_cents=?, active=?, updated_at=?
        WHERE id=?`,
      [name, email, role, oab, rate, active ? 1 : 0, new Date().toISOString(), id]
    );
    if (!active) auth.destroyUserSessions(id);
    audit.log(ctx.user.id, 'update', 'user', id, { name, email, role, active });
    return { user: shape(db.one('SELECT * FROM users WHERE id = ?', [id])) };
  }, { role: 'master' });

  /** Reset de senha pela master: gera senha provisória e derruba as sessões. */
  router.post('/api/users/:id/password', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const row = db.one('SELECT id FROM users WHERE id = ?', [id]);
    if (!row) throw notFound('Usuário não encontrado.');

    const provisional = ctx.body.password
      ? v.password(ctx.body.password, 'senha')
      : auth.generatePassword();
    db.run('UPDATE users SET password_hash=?, updated_at=? WHERE id=?', [
      auth.hashPassword(provisional), new Date().toISOString(), id,
    ]);
    auth.destroyUserSessions(id);
    audit.log(ctx.user.id, 'password_reset', 'user', id);
    return { provisionalPassword: provisional };
  }, { role: 'master' });

  /**
   * Usuários nunca são apagados: horas lançadas são registro contábil e as
   * FKs são RESTRICT. Desativar remove o acesso preservando o histórico.
   */
  router.delete('/api/users/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const row = db.one('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw notFound('Usuário não encontrado.');
    if (id === ctx.user.id) throw badRequest('Você não pode desativar a própria conta.');
    if (row.role === 'master' && countActiveMasters() <= 1) {
      throw badRequest('É necessário manter ao menos uma conta master ativa.');
    }
    db.run('UPDATE users SET active=0, updated_at=? WHERE id=?', [new Date().toISOString(), id]);
    auth.destroyUserSessions(id);
    audit.log(ctx.user.id, 'deactivate', 'user', id);
    return { ok: true };
  }, { role: 'master' });
};

function countActiveMasters() {
  return db.one("SELECT COUNT(*) AS n FROM users WHERE role='master' AND active=1").n;
}
