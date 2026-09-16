'use strict';
const db = require('../db');
const v = require('../validate');
const { badRequest } = require('../errors');
const { send } = require('../http');
const fmt = require('../format');
const { ENTRY_SELECT, shapeEntry, buildFilter } = require('../entries-core');
const reportsPdf = require('../reports-pdf');
const branding = require('../branding');
const audit = require('../audit');

const GROUPS = {
  client:  { label: 'Cliente',       key: 'c.id',          name: 'c.name' },
  project: { label: 'Projeto',       key: 'p.id',          name: "c.name || ' — ' || p.name" },
  user:    { label: 'Profissional',  key: 'u.id',          name: 'u.name' },
  date:    { label: 'Data',          key: 'te.work_date',  name: 'te.work_date' },
  month:   { label: 'Mês',           key: "substr(te.work_date,1,7)", name: "substr(te.work_date,1,7)" },
};

const VALUE_SUM = `COALESCE(SUM(CASE WHEN te.billable=1
                                     THEN CAST(ROUND(te.minutes * te.rate_cents / 60.0) AS INTEGER)
                                     ELSE 0 END),0)`;

const FROM = `FROM time_entries te
  JOIN users    u ON u.id = te.user_id
  JOIN projects p ON p.id = te.project_id
  JOIN clients  c ON c.id = p.client_id`;

function aggregate(groupName, clause, params) {
  const group = GROUPS[groupName];
  return db.all(
    `SELECT ${group.key} AS group_id, ${group.name} AS group_name,
            COUNT(*) AS entries,
            COALESCE(SUM(te.minutes),0) AS minutes,
            COALESCE(SUM(CASE WHEN te.billable=1 THEN te.minutes ELSE 0 END),0) AS billable_minutes,
            ${VALUE_SUM} AS value_cents
       ${FROM} ${clause}
      GROUP BY ${group.key}
      ORDER BY value_cents DESC, minutes DESC`,
    params
  ).map((r) => ({
    id: r.group_id,
    name: groupName === 'date' ? fmt.isoToBr(r.group_name) : r.group_name,
    entries: r.entries,
    minutes: r.minutes,
    hours: fmt.minutesToHm(r.minutes),
    billableMinutes: r.billable_minutes,
    valueCents: r.value_cents,
  }));
}

/**
 * Memória de cálculo de um cliente num período, opcionalmente restrita a um
 * único projeto. É a base tanto do JSON consumido pela tela quanto do PDF.
 *
 * Escopo:
 *   - sem projectId → consolida todos os projetos do cliente;
 *   - com projectId → isola aquele projeto.
 */
function buildInvoiceReport(ctx) {
  const clientId = v.int(ctx.query.clientId, 'cliente');
  const from = v.isoDate(ctx.query.from, 'de');
  const to = v.isoDate(ctx.query.to, 'até');
  if (from > to) throw badRequest('A data inicial deve ser anterior à data final.');

  const client = db.one('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) throw badRequest('Cliente não encontrado.');

  let project = null;
  if (ctx.query.projectId) {
    const projectId = v.int(ctx.query.projectId, 'projeto');
    project = db.one('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) throw badRequest('Projeto não encontrado.');
    if (project.client_id !== clientId) {
      throw badRequest('O projeto informado não pertence a este cliente.');
    }
  }

  const query = { ...ctx.query, clientId: String(clientId), from, to };
  const { clause, params } = buildFilter(query, ctx.user, v);
  const entries = db.all(
    `${ENTRY_SELECT} ${clause} ORDER BY p.name, te.work_date, te.id`, params
  ).map(shapeEntry);

  const byProject = new Map();
  for (const e of entries) {
    if (!byProject.has(e.projectId)) {
      byProject.set(e.projectId, {
        projectId: e.projectId, projectName: e.projectName, projectCode: e.projectCode,
        billingType: e.billingType, minutes: 0, billableMinutes: 0, valueCents: 0,
        professionals: new Map(), entries: [],
      });
    }
    const p = byProject.get(e.projectId);
    p.minutes += e.minutes;
    if (e.billable) p.billableMinutes += e.minutes;
    p.valueCents += e.valueCents;
    p.entries.push(e);

    const key = `${e.userId}:${e.rateCents}`;
    const prof = p.professionals.get(key) || {
      userId: e.userId, userName: e.userName, rateCents: e.rateCents,
      minutes: 0, billableMinutes: 0, valueCents: 0,
    };
    prof.minutes += e.minutes;
    if (e.billable) prof.billableMinutes += e.minutes;
    prof.valueCents += e.valueCents;
    p.professionals.set(key, prof);
  }

  const projects = [...byProject.values()].map((p) => ({
    ...p,
    hours: fmt.minutesToHm(p.minutes),
    professionals: [...p.professionals.values()],
  }));

  return {
    client: { id: client.id, name: client.name, document: client.document, email: client.email },
    project: project ? { id: project.id, name: project.name, code: project.code } : null,
    period: { from, to },
    generatedAt: new Date().toISOString(),
    projects,
    totals: {
      entries: entries.length,
      minutes: entries.reduce((s, e) => s + e.minutes, 0),
      billableMinutes: entries.reduce((s, e) => s + (e.billable ? e.minutes : 0), 0),
      valueCents: entries.reduce((s, e) => s + e.valueCents, 0),
    },
  };
}

module.exports = function register(router) {
  /** Painel analítico: totais + quebras por cliente, projeto, profissional e mês. */
  router.get('/api/reports/summary', async (ctx) => {
    const { clause, params } = buildFilter(ctx.query, ctx.user, v);
    const groupBy = v.oneOf(ctx.query.groupBy ?? 'client', 'agrupamento', Object.keys(GROUPS), {
      required: false, fallback: 'client',
    });

    const totals = db.one(
      `SELECT COUNT(*) AS entries,
              COALESCE(SUM(te.minutes),0) AS minutes,
              COALESCE(SUM(CASE WHEN te.billable=1 THEN te.minutes ELSE 0 END),0) AS billable_minutes,
              ${VALUE_SUM} AS value_cents,
              COUNT(DISTINCT te.user_id) AS professionals,
              COUNT(DISTINCT c.id) AS clients
         ${FROM} ${clause}`,
      params
    );

    return {
      groupBy,
      totals: {
        entries: totals.entries,
        minutes: totals.minutes,
        hours: fmt.minutesToHm(totals.minutes),
        billableMinutes: totals.billable_minutes,
        billableHours: fmt.minutesToHm(totals.billable_minutes),
        nonBillableMinutes: totals.minutes - totals.billable_minutes,
        valueCents: totals.value_cents,
        professionals: totals.professionals,
        clients: totals.clients,
      },
      groups: aggregate(groupBy, clause, params),
      byUser: ctx.user.role === 'master' ? aggregate('user', clause, params) : undefined,
    };
  });

  /** Exportação analítica em CSV (separador ";", BOM UTF-8 — abre direto no Excel). */
  router.get('/api/reports/export.csv', async (ctx) => {
    const { clause, params } = buildFilter(ctx.query, ctx.user, v);
    const rows = db.all(
      `${ENTRY_SELECT} ${clause} ORDER BY c.name, p.name, te.work_date, te.id`,
      params
    ).map(shapeEntry);

    const csv = fmt.toCsv(
      ['Data', 'Cliente', 'Projeto', 'Código/Processo', 'Profissional', 'Descrição',
       'Horas (h:mm)', 'Horas (decimal)', 'Faturável', 'Valor/hora (R$)', 'Valor (R$)', 'Fechamento'],
      rows.map((e) => [
        fmt.isoToBr(e.workDate), e.clientName, e.projectName, e.projectCode || '', e.userName,
        e.description, fmt.minutesToHm(e.minutes),
        fmt.minutesToDecimalBr(e.minutes),
        e.billable ? 'Sim' : 'Não', fmt.centsToBrl(e.rateCents), fmt.centsToBrl(e.valueCents),
        e.invoiceReference || '',
      ])
    );

    const stamp = new Date().toISOString().slice(0, 10);
    send(ctx.res, 200, Buffer.from(csv, 'utf8'), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="timesheet-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    });
  });

  /**
   * Memória de cálculo para nota fiscal: um cliente, um período, quebrado por
   * projeto e por profissional, com o detalhamento das atividades — que é o que
   * o cliente costuma exigir como anexo da NF de honorários.
   */
  router.get('/api/reports/invoice', async (ctx) => {
    return buildInvoiceReport(ctx);
  });

  /**
   * O mesmo relatório em PDF, com o papel timbrado do escritório.
   * `projectId` ausente consolida o cliente inteiro; presente, isola o projeto.
   * `detail=full` acrescenta o detalhamento de todas as atividades.
   */
  router.get('/api/reports/pdf', async (ctx) => {
    const dados = buildInvoiceReport(ctx);
    if (dados.totals.entries === 0) {
      throw badRequest('Não há horas lançadas para este escopo e período — nada a gerar.');
    }
    const detalhado = ctx.query.detail === 'full';
    const pdf = reportsPdf.build(dados, branding.get(), branding.logo(), {
      detailed: detalhado,
      projectName: dados.project ? dados.project.name : null,
      emitidoPor: ctx.user.name,
    });

    audit.log(ctx.user.id, 'export_pdf', 'client', dados.client.id, {
      projectId: dados.project?.id ?? null, from: dados.period.from, to: dados.period.to,
      entries: dados.totals.entries, detailed: detalhado,
    });

    const nome = reportsPdf.fileName(dados, dados.project ? dados.project.name : null);
    send(ctx.res, 200, pdf, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nome}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    });
  });

  /** Trilha de auditoria — exclusiva da conta master. */
  router.get('/api/reports/audit', async (ctx) => {
    const limit = v.int(ctx.query.limit ?? 200, 'limit', { min: 1, max: 1000 });
    const rows = db.all(
      `SELECT a.*, u.name AS actor_name FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.id DESC LIMIT ?`,
      [limit]
    );
    return {
      events: rows.map((r) => ({
        id: r.id, at: r.at, actorId: r.actor_user_id, actorName: r.actor_name,
        action: r.action, entity: r.entity, entityId: r.entity_id,
        details: r.details ? JSON.parse(r.details) : null,
      })),
    };
  }, { role: 'master' });
};

module.exports.buildInvoiceReport = buildInvoiceReport;
