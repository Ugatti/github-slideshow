'use strict';
const db = require('../db');
const audit = require('../audit');
const v = require('../validate');
const { badRequest, notFound } = require('../errors');
const { status } = require('../http');
const fmt = require('../format');

const shape = (r) => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name,
  reference: r.reference,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  totalMinutes: r.total_minutes,
  totalHours: fmt.minutesToHm(r.total_minutes),
  totalCents: r.total_cents,
  status: r.status,
  notes: r.notes,
  entryCount: r.entry_count,
  createdAt: r.created_at,
});

const SELECT = `SELECT i.*, c.name AS client_name,
                       (SELECT COUNT(*) FROM time_entries te WHERE te.invoice_id = i.id) AS entry_count
                  FROM invoices i JOIN clients c ON c.id = i.client_id`;

module.exports = function register(router) {
  router.get('/api/invoices', async (ctx) => {
    const rows = db.all(`${SELECT} ORDER BY i.period_end DESC, i.id DESC LIMIT 200`);
    return { invoices: rows.map(shape) };
  }, { role: 'master' });

  /**
   * Fecha um período: marca todos os lançamentos faturáveis, ainda não fechados,
   * do cliente no intervalo — congelando-os contra edição e exclusão. É o
   * registro que dá lastro à nota fiscal emitida.
   */
  router.post('/api/invoices', async (ctx) => {
    const clientId = v.int(ctx.body.clientId, 'cliente');
    const from = v.isoDate(ctx.body.from, 'de');
    const to = v.isoDate(ctx.body.to, 'até');
    const reference = v.str(ctx.body.reference, 'referência', { max: 60 });
    const notes = v.str(ctx.body.notes, 'observações', { required: false, max: 2000 });
    const includeNonBillable = v.bool(ctx.body.includeNonBillable, false);

    if (from > to) throw badRequest('A data inicial deve ser anterior à data final.');
    const client = db.one('SELECT id FROM clients WHERE id = ?', [clientId]);
    if (!client) throw badRequest('Cliente não encontrado.');

    const billableClause = includeNonBillable ? '' : 'AND te.billable = 1';
    const candidates = db.all(
      `SELECT te.id, te.minutes, te.billable, te.rate_cents
         FROM time_entries te JOIN projects p ON p.id = te.project_id
        WHERE p.client_id = ? AND te.work_date BETWEEN ? AND ?
          AND te.invoice_id IS NULL ${billableClause}`,
      [clientId, from, to]
    );
    if (!candidates.length) {
      throw badRequest('Nenhum lançamento em aberto para este cliente no período informado.');
    }

    const totalMinutes = candidates.reduce((s, e) => s + e.minutes, 0);
    const totalCents = candidates.reduce(
      (s, e) => s + (e.billable ? fmt.entryValueCents(e.minutes, e.rate_cents) : 0), 0
    );

    const now = new Date().toISOString();
    const invoiceId = db.tx(() => {
      const res = db.run(
        `INSERT INTO invoices (client_id, reference, period_start, period_end, total_minutes,
                               total_cents, status, notes, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?, 'closed', ?,?,?,?)`,
        [clientId, reference, from, to, totalMinutes, totalCents, notes, ctx.user.id, now, now]
      );
      const id = Number(res.lastInsertRowid);
      const stmt = db.get().prepare('UPDATE time_entries SET invoice_id = ?, updated_at = ? WHERE id = ?');
      for (const entry of candidates) stmt.run(id, now, entry.id);
      return id;
    });

    audit.log(ctx.user.id, 'create', 'invoice', invoiceId, {
      clientId, from, to, reference, entries: candidates.length, totalMinutes, totalCents,
    });
    return status(201, { invoice: shape(db.one(`${SELECT} WHERE i.id = ?`, [invoiceId])) });
  }, { role: 'master' });

  router.patch('/api/invoices/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const row = db.one('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!row) throw notFound('Fechamento não encontrado.');

    const next = v.oneOf(ctx.body.status, 'situação', ['closed', 'invoiced', 'cancelled']);
    const notes = ctx.body.notes !== undefined
      ? v.str(ctx.body.notes, 'observações', { required: false, max: 2000 })
      : row.notes;

    db.run('UPDATE invoices SET status=?, notes=?, updated_at=? WHERE id=?', [
      next, notes, new Date().toISOString(), id,
    ]);
    audit.log(ctx.user.id, 'update', 'invoice', id, { from: row.status, to: next });
    return { invoice: shape(db.one(`${SELECT} WHERE i.id = ?`, [id])) };
  }, { role: 'master' });

  /** Reabre o período: devolve os lançamentos ao estado editável e apaga o fechamento. */
  router.delete('/api/invoices/:id', async (ctx) => {
    const id = v.int(ctx.params.id, 'id');
    const row = db.one('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!row) throw notFound('Fechamento não encontrado.');

    const released = db.tx(() => {
      const n = db.one('SELECT COUNT(*) AS n FROM time_entries WHERE invoice_id = ?', [id]).n;
      db.run('UPDATE time_entries SET invoice_id = NULL, updated_at = ? WHERE invoice_id = ?', [
        new Date().toISOString(), id,
      ]);
      db.run('DELETE FROM invoices WHERE id = ?', [id]);
      return n;
    });
    audit.log(ctx.user.id, 'delete', 'invoice', id, {
      reference: row.reference, releasedEntries: released,
    });
    return { ok: true, releasedEntries: released };
  }, { role: 'master' });
};
