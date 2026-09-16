'use strict';
const db = require('../db');
const audit = require('../audit');
const v = require('../validate');
const { badRequest, notFound, forbidden } = require('../errors');
const { status } = require('../http');
const {
  ENTRY_SELECT, shapeEntry, resolveRateCents, loadEntryForWrite, buildFilter,
} = require('../entries-core');

const MAX_PAGE = 500;

module.exports = function register(router) {
  /** Lista lançamentos. Profissional vê só os próprios; master vê tudo. */
  router.get('/api/entries', async (ctx) => {
    const { clause, params } = buildFilter(ctx.query, ctx.user, v);
    const limit = Math.min(v.int(ctx.query.limit ?? 100, 'limit', { min: 1, max: MAX_PAGE }), MAX_PAGE);
    const offset = v.int(ctx.query.offset ?? 0, 'offset', { min: 0 });

    const rows = db.all(
      `${ENTRY_SELECT} ${clause} ORDER BY te.work_date DESC, te.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const totals = db.one(
      `SELECT COUNT(*) AS count, COALESCE(SUM(te.minutes),0) AS minutes,
              COALESCE(SUM(CASE WHEN te.billable=1 THEN te.minutes ELSE 0 END),0) AS billable_minutes,
              COALESCE(SUM(CASE WHEN te.billable=1
                                THEN CAST(ROUND(te.minutes * te.rate_cents / 60.0) AS INTEGER)
                                ELSE 0 END),0) AS value_cents
         FROM time_entries te
         JOIN projects p ON p.id = te.project_id
         JOIN clients  c ON c.id = p.client_id
         ${clause}`,
      params
    );
    return {
      entries: rows.map(shapeEntry),
      totals: {
        count: totals.count,
        minutes: totals.minutes,
        billableMinutes: totals.billable_minutes,
        valueCents: totals.value_cents,
      },
      page: { limit, offset, hasMore: offset + rows.length < totals.count },
    };
  });

  router.get('/api/entries/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const row = db.one(`${ENTRY_SELECT} WHERE te.id = ?`, [id]);
    if (!row) throw notFound('Lançamento não encontrado.');
    if (ctx.user.role !== 'master' && row.user_id !== ctx.user.id) {
      throw forbidden('Você só pode consultar os seus próprios lançamentos.');
    }
    return { entry: shapeEntry(row) };
  });

  router.post('/api/entries', async (ctx) => {
    const projectId = v.int(ctx.body.projectId, 'projeto');
    const workDate = v.isoDate(ctx.body.workDate, 'data');
    const minutes = v.duration(ctx.body.duration ?? ctx.body.minutes, 'duração');
    const description = v.str(ctx.body.description, 'descrição da atividade', { min: 3, max: 2000 });
    const billable = v.bool(ctx.body.billable, true);

    // Só a master lança horas em nome de outro profissional.
    let targetUserId = ctx.user.id;
    if (ctx.body.userId !== undefined && ctx.body.userId !== null && ctx.body.userId !== '') {
      const requested = v.int(ctx.body.userId, 'profissional');
      if (requested !== ctx.user.id && ctx.user.role !== 'master') {
        throw forbidden('Você só pode lançar horas em seu próprio nome.');
      }
      targetUserId = requested;
    }

    const targetUser = db.one('SELECT * FROM users WHERE id = ? AND active = 1', [targetUserId]);
    if (!targetUser) throw badRequest('Profissional inexistente ou inativo.');

    const project = db.one(
      `SELECT p.*, c.active AS client_active FROM projects p
         JOIN clients c ON c.id = p.client_id WHERE p.id = ?`,
      [projectId]
    );
    if (!project) throw badRequest('Projeto inexistente.');
    if (!project.active || !project.client_active) {
      throw badRequest('Projeto ou cliente inativo — não aceita novos lançamentos.');
    }
    assertNotFuture(workDate);

    const explicitRate =
      ctx.user.role === 'master' && ctx.body.rate !== undefined && ctx.body.rate !== ''
        ? v.money(ctx.body.rate, 'valor/hora')
        : null;
    const rateCents = resolveRateCents({ explicitRate, project, user: targetUser });

    const now = new Date().toISOString();
    const res = db.run(
      `INSERT INTO time_entries
         (user_id, project_id, work_date, minutes, description, billable, rate_cents, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [targetUserId, projectId, workDate, minutes, description, billable ? 1 : 0,
       rateCents, ctx.user.id, now, now]
    );
    const id = Number(res.lastInsertRowid);
    audit.log(ctx.user.id, 'create', 'time_entry', id, {
      targetUserId, projectId, workDate, minutes, onBehalf: targetUserId !== ctx.user.id,
    });
    return status(201, { entry: shapeEntry(db.one(`${ENTRY_SELECT} WHERE te.id = ?`, [id])) });
  });

  router.put('/api/entries/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const current = loadEntryForWrite(id, ctx.user);

    const projectId = v.int(ctx.body.projectId, 'projeto');
    const workDate = v.isoDate(ctx.body.workDate, 'data');
    const minutes = v.duration(ctx.body.duration ?? ctx.body.minutes, 'duração');
    const description = v.str(ctx.body.description, 'descrição da atividade', { min: 3, max: 2000 });
    const billable = v.bool(ctx.body.billable, true);

    let targetUserId = current.user_id;
    if (ctx.body.userId !== undefined && ctx.body.userId !== null && ctx.body.userId !== '') {
      const requested = v.int(ctx.body.userId, 'profissional');
      if (requested !== current.user_id && ctx.user.role !== 'master') {
        throw forbidden('Você não pode transferir um lançamento para outro profissional.');
      }
      targetUserId = requested;
    }
    const targetUser = db.one('SELECT * FROM users WHERE id = ? AND active = 1', [targetUserId]);
    if (!targetUser) throw badRequest('Profissional inexistente ou inativo.');

    const project = db.one(
      `SELECT p.*, c.active AS client_active FROM projects p
         JOIN clients c ON c.id = p.client_id WHERE p.id = ?`,
      [projectId]
    );
    if (!project) throw badRequest('Projeto inexistente.');
    // Projeto arquivado continua aceito se o lançamento já estava nele: editar
    // a descrição de uma hora antiga não deve exigir reabrir o projeto.
    if ((!project.active || !project.client_active) && projectId !== current.project_id) {
      throw badRequest('Projeto ou cliente inativo — não aceita lançamentos.');
    }
    assertNotFuture(workDate);

    // O valor/hora congelado só muda se a master pedir explicitamente.
    let rateCents = current.rate_cents;
    if (ctx.user.role === 'master' && ctx.body.rate !== undefined && ctx.body.rate !== '') {
      rateCents = v.money(ctx.body.rate, 'valor/hora');
    } else if (projectId !== current.project_id || targetUserId !== current.user_id) {
      rateCents = resolveRateCents({ explicitRate: null, project, user: targetUser });
    }

    db.run(
      `UPDATE time_entries SET user_id=?, project_id=?, work_date=?, minutes=?, description=?,
              billable=?, rate_cents=?, updated_at=? WHERE id=?`,
      [targetUserId, projectId, workDate, minutes, description, billable ? 1 : 0,
       rateCents, new Date().toISOString(), id]
    );
    audit.log(ctx.user.id, 'update', 'time_entry', id, {
      before: { minutes: current.minutes, workDate: current.work_date, projectId: current.project_id },
      after: { minutes, workDate, projectId },
    });
    return { entry: shapeEntry(db.one(`${ENTRY_SELECT} WHERE te.id = ?`, [id])) };
  });

  router.delete('/api/entries/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const current = loadEntryForWrite(id, ctx.user);
    db.run('DELETE FROM time_entries WHERE id = ?', [id]);
    audit.log(ctx.user.id, 'delete', 'time_entry', id, {
      userId: current.user_id, projectId: current.project_id,
      workDate: current.work_date, minutes: current.minutes,
      description: current.description, ownEntry: current.user_id === ctx.user.id,
    });
    return { ok: true };
  });
};

/** Lançar horas no futuro quase sempre é erro de digitação na data. */
function assertNotFuture(workDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (workDate > today) throw badRequest('Não é possível lançar horas em data futura.');
}
