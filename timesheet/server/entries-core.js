'use strict';
const db = require('./db');
const { badRequest, notFound, forbidden } = require('./errors');
const { entryValueCents } = require('./format');

const ENTRY_SELECT = `
  SELECT te.*, u.name AS user_name, p.name AS project_name, p.code AS project_code,
         p.billing_type, c.id AS client_id, c.name AS client_name,
         i.reference AS invoice_reference, i.status AS invoice_status
    FROM time_entries te
    JOIN users    u ON u.id = te.user_id
    JOIN projects p ON p.id = te.project_id
    JOIN clients  c ON c.id = p.client_id
    LEFT JOIN invoices i ON i.id = te.invoice_id`;

function shapeEntry(r) {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    projectId: r.project_id,
    projectName: r.project_name,
    projectCode: r.project_code,
    billingType: r.billing_type,
    clientId: r.client_id,
    clientName: r.client_name,
    workDate: r.work_date,
    minutes: r.minutes,
    description: r.description,
    billable: !!r.billable,
    rateCents: r.rate_cents,
    valueCents: r.billable ? entryValueCents(r.minutes, r.rate_cents) : 0,
    invoiceId: r.invoice_id,
    invoiceReference: r.invoice_reference,
    invoiceStatus: r.invoice_status,
    locked: r.invoice_id !== null && r.invoice_status !== 'cancelled',
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Valor/hora aplicado a um lançamento, em ordem de precedência:
 *   1. valor informado explicitamente (só a master pode sobrescrever)
 *   2. valor/hora padrão do projeto
 *   3. valor/hora do profissional
 *   4. zero (projetos pro bono ou honorário fixo, em que só as horas importam)
 * O resultado é gravado no lançamento e nunca mais recalculado.
 */
function resolveRateCents({ explicitRate, project, user }) {
  if (explicitRate !== null && explicitRate !== undefined) return explicitRate;
  if (project.billing_type === 'pro_bono') return 0;
  if (project.default_rate_cents !== null && project.default_rate_cents !== undefined) {
    return project.default_rate_cents;
  }
  return user.hourly_rate_cents ?? 0;
}

/** Carrega um lançamento e aplica as regras de acesso do perfil. */
function loadEntryForWrite(entryId, actor) {
  const row = db.one(
    `SELECT te.*, i.status AS invoice_status FROM time_entries te
       LEFT JOIN invoices i ON i.id = te.invoice_id WHERE te.id = ?`,
    [entryId]
  );
  if (!row) throw notFound('Lançamento não encontrado.');

  // Regra central de permissão: profissional mexe apenas nas próprias horas;
  // a conta master mexe nas horas de todo o escritório.
  if (actor.role !== 'master' && row.user_id !== actor.id) {
    throw forbidden('Você só pode alterar ou excluir os seus próprios lançamentos.');
  }
  // Horas já fechadas em nota não podem ser mexidas por ninguém sem antes
  // cancelar o fechamento — do contrário o relatório emitido deixa de bater.
  if (row.invoice_id !== null && row.invoice_status !== 'cancelled') {
    throw badRequest(
      'Este lançamento pertence a um fechamento emitido. Cancele o fechamento antes de alterá-lo.'
    );
  }
  return row;
}

/** Monta WHERE + parâmetros a partir dos filtros de listagem/relatório. */
function buildFilter(query, actor, v) {
  const where = [];
  const params = [];

  // Profissional só enxerga as próprias horas, qualquer que seja o filtro pedido.
  if (actor.role !== 'master') {
    where.push('te.user_id = ?');
    params.push(actor.id);
  } else if (query.userId) {
    where.push('te.user_id = ?');
    params.push(v.int(query.userId, 'userId'));
  }

  if (query.from) { where.push('te.work_date >= ?'); params.push(v.isoDate(query.from, 'de')); }
  if (query.to)   { where.push('te.work_date <= ?'); params.push(v.isoDate(query.to, 'até')); }
  if (query.clientId)  { where.push('c.id = ?');           params.push(v.int(query.clientId, 'clientId')); }
  if (query.projectId) { where.push('te.project_id = ?');  params.push(v.int(query.projectId, 'projectId')); }
  if (query.billable !== undefined && query.billable !== '') {
    where.push('te.billable = ?');
    params.push(v.bool(query.billable) ? 1 : 0);
  }
  if (query.invoiced === 'yes') where.push('te.invoice_id IS NOT NULL');
  if (query.invoiced === 'no')  where.push('te.invoice_id IS NULL');
  if (query.search) {
    where.push('te.description LIKE ?');
    params.push(`%${v.str(query.search, 'busca', { max: 100 })}%`);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

module.exports = { ENTRY_SELECT, shapeEntry, resolveRateCents, loadEntryForWrite, buildFilter };
