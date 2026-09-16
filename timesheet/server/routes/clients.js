'use strict';
const db = require('../db');
const audit = require('../audit');
const v = require('../validate');
const { notFound, conflict } = require('../errors');
const { status } = require('../http');

const shape = (r) => ({
  id: r.id,
  name: r.name,
  document: r.document,
  email: r.email,
  notes: r.notes,
  active: !!r.active,
  projectCount: r.project_count ?? undefined,
});

module.exports = function register(router) {
  router.get('/api/clients', async (ctx) => {
    const includeInactive = v.bool(ctx.query.includeInactive, false) && ctx.user.role === 'master';
    const rows = db.all(
      `SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id AND p.active = 1) AS project_count
         FROM clients c
        ${includeInactive ? '' : 'WHERE c.active = 1'}
        ORDER BY c.active DESC, c.name COLLATE NOCASE`
    );
    return { clients: rows.map(shape) };
  });

  router.post('/api/clients', async (ctx) => {
    const name = v.str(ctx.body.name, 'nome do cliente', { max: 200 });
    const document = v.document(ctx.body.document, 'CPF/CNPJ', { required: false });
    const email = v.email(ctx.body.email, 'e-mail', { required: false });
    const notes = v.str(ctx.body.notes, 'observações', { required: false, max: 2000 });

    if (db.one('SELECT id FROM clients WHERE name = ? COLLATE NOCASE', [name])) {
      throw conflict('Já existe um cliente com este nome.');
    }
    const now = new Date().toISOString();
    const res = db.run(
      'INSERT INTO clients (name, document, email, notes, active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)',
      [name, document, email, notes, now, now]
    );
    const id = Number(res.lastInsertRowid);
    audit.log(ctx.user.id, 'create', 'client', id, { name });
    return status(201, { client: shape(db.one('SELECT * FROM clients WHERE id = ?', [id])) });
  }, { role: 'master' });

  router.put('/api/clients/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    if (!db.one('SELECT id FROM clients WHERE id = ?', [id])) throw notFound('Cliente não encontrado.');

    const name = v.str(ctx.body.name, 'nome do cliente', { max: 200 });
    const document = v.document(ctx.body.document, 'CPF/CNPJ', { required: false });
    const email = v.email(ctx.body.email, 'e-mail', { required: false });
    const notes = v.str(ctx.body.notes, 'observações', { required: false, max: 2000 });
    const active = v.bool(ctx.body.active, true);

    if (db.one('SELECT id FROM clients WHERE name = ? COLLATE NOCASE AND id <> ?', [name, id])) {
      throw conflict('Já existe outro cliente com este nome.');
    }
    db.run(
      'UPDATE clients SET name=?, document=?, email=?, notes=?, active=?, updated_at=? WHERE id=?',
      [name, document, email, notes, active ? 1 : 0, new Date().toISOString(), id]
    );
    audit.log(ctx.user.id, 'update', 'client', id, { name, active });
    return { client: shape(db.one('SELECT * FROM clients WHERE id = ?', [id])) };
  }, { role: 'master' });

  /**
   * Remove de verdade só se nunca houve lançamento; caso contrário arquiva.
   * Cliente com horas lançadas precisa continuar existindo para os relatórios.
   */
  router.delete('/api/clients/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    if (!db.one('SELECT id FROM clients WHERE id = ?', [id])) throw notFound('Cliente não encontrado.');

    const used = db.one(
      `SELECT COUNT(*) AS n FROM time_entries te
         JOIN projects p ON p.id = te.project_id WHERE p.client_id = ?`,
      [id]
    ).n;

    if (used > 0) {
      db.run('UPDATE clients SET active=0, updated_at=? WHERE id=?', [new Date().toISOString(), id]);
      db.run('UPDATE projects SET active=0, updated_at=? WHERE client_id=?', [new Date().toISOString(), id]);
      audit.log(ctx.user.id, 'archive', 'client', id, { reason: 'possui lançamentos', entries: used });
      return { archived: true, entries: used };
    }
    db.tx(() => {
      db.run('DELETE FROM projects WHERE client_id = ?', [id]);
      db.run('DELETE FROM clients WHERE id = ?', [id]);
    });
    audit.log(ctx.user.id, 'delete', 'client', id);
    return { archived: false };
  }, { role: 'master' });
};
