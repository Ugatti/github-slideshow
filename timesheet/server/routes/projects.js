'use strict';
const db = require('../db');
const audit = require('../audit');
const v = require('../validate');
const { notFound, conflict, badRequest } = require('../errors');
const { status } = require('../http');

const BILLING_TYPES = ['hourly', 'fixed', 'pro_bono'];

const shape = (r) => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name,
  name: r.name,
  code: r.code,
  billingType: r.billing_type,
  defaultRateCents: r.default_rate_cents,
  active: !!r.active,
});

const SELECT = `SELECT p.*, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id`;

module.exports = function register(router) {
  router.get('/api/projects', async (ctx) => {
    const includeInactive = v.bool(ctx.query.includeInactive, false) && ctx.user.role === 'master';
    const clientId = ctx.query.clientId ? v.int(ctx.query.clientId, 'clientId') : null;

    const where = [];
    const params = [];
    if (!includeInactive) where.push('p.active = 1 AND c.active = 1');
    if (clientId) { where.push('p.client_id = ?'); params.push(clientId); }

    const rows = db.all(
      `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE`,
      params
    );
    return { projects: rows.map(shape) };
  });

  router.post('/api/projects', async (ctx) => {
    const clientId = v.int(ctx.body.clientId, 'cliente');
    if (!db.one('SELECT id FROM clients WHERE id = ?', [clientId])) {
      throw badRequest('Cliente informado não existe.');
    }
    const name = v.str(ctx.body.name, 'nome do projeto', { max: 200 });
    const code = v.str(ctx.body.code, 'código/processo', { required: false, max: 60 });
    const billingType = v.oneOf(ctx.body.billingType, 'tipo de cobrança', BILLING_TYPES, {
      required: false, fallback: 'hourly',
    });
    const rate = v.money(ctx.body.defaultRate, 'valor/hora do projeto', { required: false });

    const dup = db.one(
      'SELECT id FROM projects WHERE client_id = ? AND name = ? COLLATE NOCASE', [clientId, name]
    );
    if (dup) throw conflict('Este cliente já possui um projeto com esse nome.');

    const now = new Date().toISOString();
    const res = db.run(
      `INSERT INTO projects (client_id, name, code, billing_type, default_rate_cents, active, created_at, updated_at)
       VALUES (?,?,?,?,?,1,?,?)`,
      [clientId, name, code, billingType, rate, now, now]
    );
    const id = Number(res.lastInsertRowid);
    audit.log(ctx.user.id, 'create', 'project', id, { clientId, name });
    return status(201, { project: shape(db.one(`${SELECT} WHERE p.id = ?`, [id])) });
  }, { role: 'master' });

  router.put('/api/projects/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const current = db.one('SELECT * FROM projects WHERE id = ?', [id]);
    if (!current) throw notFound('Projeto não encontrado.');

    const clientId = v.int(ctx.body.clientId, 'cliente');
    if (!db.one('SELECT id FROM clients WHERE id = ?', [clientId])) {
      throw badRequest('Cliente informado não existe.');
    }
    const name = v.str(ctx.body.name, 'nome do projeto', { max: 200 });
    const code = v.str(ctx.body.code, 'código/processo', { required: false, max: 60 });
    const billingType = v.oneOf(ctx.body.billingType, 'tipo de cobrança', BILLING_TYPES, {
      required: false, fallback: 'hourly',
    });
    const rate = v.money(ctx.body.defaultRate, 'valor/hora do projeto', { required: false });
    const active = v.bool(ctx.body.active, true);

    const dup = db.one(
      'SELECT id FROM projects WHERE client_id = ? AND name = ? COLLATE NOCASE AND id <> ?',
      [clientId, name, id]
    );
    if (dup) throw conflict('Este cliente já possui outro projeto com esse nome.');

    db.run(
      `UPDATE projects SET client_id=?, name=?, code=?, billing_type=?, default_rate_cents=?, active=?, updated_at=?
        WHERE id=?`,
      [clientId, name, code, billingType, rate, active ? 1 : 0, new Date().toISOString(), id]
    );
    audit.log(ctx.user.id, 'update', 'project', id, { name, active });
    return { project: shape(db.one(`${SELECT} WHERE p.id = ?`, [id])) };
  }, { role: 'master' });

  router.delete('/api/projects/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    if (!db.one('SELECT id FROM projects WHERE id = ?', [id])) throw notFound('Projeto não encontrado.');

    const used = db.one('SELECT COUNT(*) AS n FROM time_entries WHERE project_id = ?', [id]).n;
    if (used > 0) {
      db.run('UPDATE projects SET active=0, updated_at=? WHERE id=?', [new Date().toISOString(), id]);
      audit.log(ctx.user.id, 'archive', 'project', id, { entries: used });
      return { archived: true, entries: used };
    }
    db.run('DELETE FROM projects WHERE id = ?', [id]);
    audit.log(ctx.user.id, 'delete', 'project', id);
    return { archived: false };
  }, { role: 'master' });
};
