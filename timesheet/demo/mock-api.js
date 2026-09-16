'use strict';
/**
 * Backend simulado para a versão demonstrativa.
 *
 * Substitui window.fetch para as rotas /api/*, reproduzindo em memória as
 * mesmas regras do servidor real (server/routes/*.js) — em especial as de
 * permissão, que são o que precisa ser verificado numa avaliação. A interface
 * carregada é exatamente a de produção: public/app.js roda sem alteração.
 *
 * Os dados são fictícios e vivem apenas na aba aberta: recarregar reinicia tudo.
 */
(function () {
  const nowIso = () => new Date().toISOString();
  const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = () => isoDay(new Date());
  const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));
  const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];

  /* Gerador determinístico: a demonstração mostra os mesmos números a cada visita. */
  function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ dados */

  const db = { users: [], clients: [], projects: [], entries: [], invoices: [], audit: [], seq: {} };
  const nextId = (table) => (db.seq[table] = (db.seq[table] || 0) + 1);

  const USERS = [
    { name: 'Mariana Azeredo', email: 'mariana@exemplo.com.br', role: 'master', oab: 'SP 148.220', rate: 65000 },
    { name: 'Leonardo Ugatti', email: 'leonardo@exemplo.com.br', role: 'master', oab: 'SP 152.911', rate: 65000 },
    { name: 'Carla Menezes',   email: 'carla@exemplo.com.br',   role: 'user',   oab: 'SP 301.455', rate: 38000 },
    { name: 'Rafael Tanaka',   email: 'rafael@exemplo.com.br',  role: 'user',   oab: 'SP 322.104', rate: 32000 },
    { name: 'Júlia Prado',     email: 'julia@exemplo.com.br',   role: 'user',   oab: null,         rate: 14000 },
  ];

  const CARTEIRA = [
    { nome: 'Indústria Bandeirantes S.A.', doc: '12345678000195', email: 'fiscal@bandeirantes.com.br', projetos: [
      { name: 'Contencioso Trabalhista — Reclamatórias', code: '0001234-55.2026.5.02.0011', rate: 48000 },
      { name: 'Consultivo Trabalhista', code: null, rate: 52000 },
    ]},
    { nome: 'Comercial Ipiranga Ltda.', doc: '98765432000110', email: 'contas@ipiranga.com.br', projetos: [
      { name: 'Execução Fiscal — ICMS', code: '1002345-66.2025.8.26.0053', rate: 55000 },
      { name: 'Due Diligence Societária', code: 'DD-2026-04', rate: null },
    ]},
    { nome: 'Construtora Horizonte S.A.', doc: '45678912000133', email: 'juridico@horizonte.com.br', projetos: [
      { name: 'Arbitragem CAM-CCBC', code: 'CAM 0112/2026', rate: 78000 },
    ]},
    { nome: 'Instituto Raízes', doc: '33221144000188', email: 'contato@raizes.org.br', projetos: [
      { name: 'Assessoria institucional (pro bono)', code: null, rate: null, billing: 'pro_bono' },
    ]},
  ];

  const ATIVIDADES = [
    'Análise da documentação encaminhada pelo cliente e elaboração de parecer preliminar.',
    'Elaboração de contestação e organização das provas documentais.',
    'Participação em audiência de instrução e julgamento.',
    'Reunião com o cliente para alinhamento da estratégia processual.',
    'Pesquisa de jurisprudência sobre a tese de prescrição intercorrente.',
    'Redação de recurso ordinário e revisão das razões recursais.',
    'Elaboração de memoriais e preparação da sustentação oral.',
    'Análise de contrato de prestação de serviços e sugestão de alterações.',
    'Acompanhamento de publicação e conferência de prazos processuais.',
    'Diligência no fórum para carga e cópia integral dos autos.',
    'Revisão de cálculos de liquidação e elaboração de impugnação.',
    'Videoconferência com a área de compliance do cliente.',
  ];

  function seed() {
    for (const u of USERS) {
      db.users.push({
        id: nextId('users'), name: u.name, email: u.email, password: 'Demo123456',
        role: u.role, oab: u.oab, hourly_rate_cents: u.rate, active: 1, created_at: nowIso(),
      });
    }
    for (const c of CARTEIRA) {
      const client = {
        id: nextId('clients'), name: c.nome, document: c.doc, email: c.email,
        notes: null, active: 1,
      };
      db.clients.push(client);
      for (const p of c.projetos) {
        db.projects.push({
          id: nextId('projects'), client_id: client.id, name: p.name, code: p.code,
          billing_type: p.billing || 'hourly', default_rate_cents: p.rate ?? null, active: 1,
        });
      }
    }

    const rnd = seededRandom(20260916);
    for (let dia = 118; dia >= 0; dia--) {
      const data = daysAgo(dia);
      const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
      if (diaSemana === 0 || diaSemana === 6) continue;
      for (const u of db.users) {
        const quantos = 1 + Math.floor(rnd() * 4);
        for (let i = 0; i < quantos; i++) {
          const projeto = pick(db.projects, rnd);
          const proBono = projeto.billing_type === 'pro_bono';
          const minutes = pick([30, 45, 60, 75, 90, 120, 150, 180, 240], rnd);
          const billable = proBono ? 0 : (rnd() > 0.12 ? 1 : 0);
          db.entries.push({
            id: nextId('entries'), user_id: u.id, project_id: projeto.id, work_date: data,
            minutes, description: pick(ATIVIDADES, rnd), billable,
            rate_cents: proBono ? 0 : (projeto.default_rate_cents ?? u.hourly_rate_cents ?? 0),
            invoice_id: null, created_by: u.id, created_at: nowIso(), updated_at: nowIso(),
          });
        }
      }
    }
    audit(null, 'bootstrap', 'user', null, { demo: true });
  }

  /* ------------------------------------------------------- utilidades de domínio */

  const audit = (actorId, action, entity, entityId, details) =>
    db.audit.push({
      id: nextId('audit'), at: nowIso(), actor_user_id: actorId, action, entity,
      entity_id: entityId, details: details || null,
    });

  const entryValueCents = (minutes, rate) => Math.round((minutes * rate) / 60);
  const minutesToHm = (m) => `${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`;
  const findUser = (id) => db.users.find((u) => u.id === Number(id));
  const findProject = (id) => db.projects.find((p) => p.id === Number(id));
  const findClient = (id) => db.clients.find((c) => c.id === Number(id));

  function parseDuration(value) {
    const raw = String(value ?? '').trim();
    let minutes;
    const hhmm = raw.match(/^(\d{1,3})[:h](\d{1,2})?m?$/i);
    if (hhmm) {
      const mins = Number(hhmm[2] ?? 0);
      if (mins > 59) throw fail(400, `Minutos inválidos em "${raw}".`);
      minutes = Number(hhmm[1]) * 60 + mins;
    } else if (/^\d+$/.test(raw)) {
      minutes = Number(raw);
    } else if (/^\d{1,3}([.,]\d{1,2})?$/.test(raw)) {
      minutes = Math.round(Number(raw.replace(',', '.')) * 60);
    } else {
      throw fail(400, 'Duração inválida. Use minutos (90), h:mm (1:30) ou decimal (1,5).');
    }
    if (!minutes) throw fail(400, 'A duração deve ser maior que zero.');
    if (minutes > 1440) throw fail(400, 'A duração não pode exceder 24 horas em um lançamento.');
    return minutes;
  }

  function parseMoney(value, required) {
    if (value === undefined || value === null || String(value).trim() === '') {
      if (required) throw fail(400, 'Valor obrigatório.');
      return null;
    }
    let raw = String(value).trim().replace(/[R$\s]/g, '');
    if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw fail(400, 'Valor monetário inválido.');
    return Math.round(n * 100);
  }

  const onlyDigits = (v) => (v ? String(v).replace(/\D/g, '') : null);
  const fail = (status, error) => ({ __httpError: true, status, error });

  /* --------------------------------------------------------------- expansão */

  function expandEntry(e) {
    const user = findUser(e.user_id);
    const project = findProject(e.project_id);
    const client = findClient(project.client_id);
    const invoice = e.invoice_id ? db.invoices.find((i) => i.id === e.invoice_id) : null;
    return {
      id: e.id, userId: e.user_id, userName: user.name,
      projectId: project.id, projectName: project.name, projectCode: project.code,
      billingType: project.billing_type, clientId: client.id, clientName: client.name,
      workDate: e.work_date, minutes: e.minutes, description: e.description,
      billable: !!e.billable, rateCents: e.rate_cents,
      valueCents: e.billable ? entryValueCents(e.minutes, e.rate_cents) : 0,
      invoiceId: e.invoice_id, invoiceReference: invoice ? invoice.reference : null,
      invoiceStatus: invoice ? invoice.status : null,
      locked: !!e.invoice_id && invoice && invoice.status !== 'cancelled',
      createdBy: e.created_by, createdAt: e.created_at, updatedAt: e.updated_at,
    };
  }

  /** Mesma regra do servidor: profissional só enxerga as próprias horas. */
  function filterEntries(query, actor) {
    return db.entries.filter((e) => {
      if (actor.role !== 'master') {
        if (e.user_id !== actor.id) return false;
      } else if (query.userId && e.user_id !== Number(query.userId)) return false;

      if (query.from && e.work_date < query.from) return false;
      if (query.to && e.work_date > query.to) return false;

      const project = findProject(e.project_id);
      if (query.projectId && project.id !== Number(query.projectId)) return false;
      if (query.clientId && project.client_id !== Number(query.clientId)) return false;

      if (query.billable === 'true' && !e.billable) return false;
      if (query.billable === 'false' && e.billable) return false;
      if (query.invoiced === 'yes' && !e.invoice_id) return false;
      if (query.invoiced === 'no' && e.invoice_id) return false;
      if (query.search && !e.description.toLowerCase().includes(query.search.toLowerCase())) return false;
      return true;
    });
  }

  function loadEntryForWrite(id, actor) {
    const entry = db.entries.find((e) => e.id === Number(id));
    if (!entry) throw fail(404, 'Lançamento não encontrado.');
    if (actor.role !== 'master' && entry.user_id !== actor.id) {
      throw fail(403, 'Você só pode alterar ou excluir os seus próprios lançamentos.');
    }
    const invoice = entry.invoice_id ? db.invoices.find((i) => i.id === entry.invoice_id) : null;
    if (invoice && invoice.status !== 'cancelled') {
      throw fail(400, 'Este lançamento pertence a um fechamento emitido. Cancele o fechamento antes de alterá-lo.');
    }
    return entry;
  }

  function resolveRate(project, user) {
    if (project.billing_type === 'pro_bono') return 0;
    if (project.default_rate_cents != null) return project.default_rate_cents;
    return user.hourly_rate_cents ?? 0;
  }

  /* -------------------------------------------------------------- sessão */

  let session = null;   // { userId }
  const actor = () => (session ? findUser(session.userId) : null);
  const publicUser = (u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role,
    oab: u.oab, hourlyRateCents: u.hourly_rate_cents,
  });
  const FIRM = { name: 'Azeredo & Ugatti Advogados', site: 'https://www.azeredoeugatti.com.br/' };

  /* --------------------------------------------------------------- rotas */

  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const names = [];
    const source = pattern.split('/').map((seg) => {
      if (!seg.startsWith(':')) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(seg.slice(1));
      return '([^/]+)';
    }).join('/');
    routes.push({ method, regex: new RegExp(`^${source}$`), names, handler, opts: { auth: true, ...opts } });
  };

  /* --- autenticação --- */
  route('POST', '/api/auth/login', ({ body }) => {
    const user = db.users.find(
      (u) => u.email.toLowerCase() === String(body.email || '').toLowerCase()
    );
    if (!user || user.password !== body.password || !user.active) {
      throw fail(401, 'E-mail ou senha inválidos.');
    }
    session = { userId: user.id };
    audit(user.id, 'login', 'user', user.id);
    return { user: publicUser(user), firm: FIRM };
  }, { auth: false });

  route('POST', '/api/auth/logout', () => { session = null; return { ok: true }; }, { auth: false });
  route('GET', '/api/auth/me', ({ me }) => ({ user: publicUser(me), firm: FIRM }));

  route('POST', '/api/auth/password', ({ me, body }) => {
    if (body.currentPassword !== me.password) throw fail(400, 'A senha atual está incorreta.');
    if (String(body.newPassword || '').length < 10) {
      throw fail(400, 'A senha deve ter ao menos 10 caracteres, incluindo letras e números.');
    }
    me.password = body.newPassword;
    audit(me.id, 'password_change', 'user', me.id);
    return { ok: true };
  });

  /* --- usuários --- */
  route('GET', '/api/users', ({ me }) => {
    if (me.role === 'master') {
      return { users: db.users.map((u) => ({
        id: u.id, name: u.name, email: u.email, role: u.role, oab: u.oab,
        hourlyRateCents: u.hourly_rate_cents, active: !!u.active,
      })) };
    }
    // Profissional recebe apenas nome e id — sem e-mail nem remuneração dos colegas.
    return { users: db.users.filter((u) => u.active).map((u) => ({
      id: u.id, name: u.name, role: u.role, active: true,
    })) };
  });

  route('POST', '/api/users', ({ me, body }) => {
    const email = String(body.email || '').toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      throw fail(409, 'Já existe um usuário com este e-mail.');
    }
    const password = body.password || generatePassword();
    const user = {
      id: nextId('users'), name: body.name, email, password, role: body.role,
      oab: body.oab || null, hourly_rate_cents: parseMoney(body.hourlyRate, false),
      active: 1, created_at: nowIso(),
    };
    db.users.push(user);
    audit(me.id, 'create', 'user', user.id, { name: user.name, email });
    return { __status: 201, user: { ...publicUser(user), active: true }, provisionalPassword: password };
  }, { role: 'master' });

  route('PUT', '/api/users/:id', ({ me, params, body }) => {
    const user = findUser(params.id);
    if (!user) throw fail(404, 'Usuário não encontrado.');
    const ativos = db.users.filter((u) => u.role === 'master' && u.active).length;
    const perderiaMaster = user.role === 'master' && user.active &&
      (body.role !== 'master' || body.active === false);
    if (perderiaMaster && ativos <= 1) {
      throw fail(400, 'É necessário manter ao menos uma conta master ativa.');
    }
    Object.assign(user, {
      name: body.name, email: String(body.email || '').toLowerCase(), role: body.role,
      oab: body.oab || null, hourly_rate_cents: parseMoney(body.hourlyRate, false),
      active: body.active === false ? 0 : 1,
    });
    audit(me.id, 'update', 'user', user.id, { name: user.name });
    return { user: { ...publicUser(user), active: !!user.active } };
  }, { role: 'master' });

  route('POST', '/api/users/:id/password', ({ me, params }) => {
    const user = findUser(params.id);
    if (!user) throw fail(404, 'Usuário não encontrado.');
    user.password = generatePassword();
    audit(me.id, 'password_reset', 'user', user.id);
    return { provisionalPassword: user.password };
  }, { role: 'master' });

  route('DELETE', '/api/users/:id', ({ me, params }) => {
    const user = findUser(params.id);
    if (!user) throw fail(404, 'Usuário não encontrado.');
    if (user.id === me.id) throw fail(400, 'Você não pode desativar a própria conta.');
    const ativos = db.users.filter((u) => u.role === 'master' && u.active).length;
    if (user.role === 'master' && ativos <= 1) {
      throw fail(400, 'É necessário manter ao menos uma conta master ativa.');
    }
    user.active = 0;
    audit(me.id, 'deactivate', 'user', user.id);
    return { ok: true };
  }, { role: 'master' });

  function generatePassword() {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=';
    let out = '';
    for (let i = 0; i < 16; i++) out += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    return out;
  }

  /* --- clientes --- */
  route('GET', '/api/clients', ({ me, query }) => {
    const todos = query.includeInactive === 'true' && me.role === 'master';
    return { clients: db.clients.filter((c) => todos || c.active).map((c) => ({
      id: c.id, name: c.name, document: c.document, email: c.email, notes: c.notes,
      active: !!c.active,
      projectCount: db.projects.filter((p) => p.client_id === c.id && p.active).length,
    })) };
  });

  route('POST', '/api/clients', ({ me, body }) => {
    if (db.clients.some((c) => c.name.toLowerCase() === String(body.name || '').toLowerCase())) {
      throw fail(409, 'Já existe um cliente com este nome.');
    }
    const client = {
      id: nextId('clients'), name: body.name, document: onlyDigits(body.document),
      email: body.email || null, notes: body.notes || null, active: 1,
    };
    db.clients.push(client);
    audit(me.id, 'create', 'client', client.id, { name: client.name });
    return { __status: 201, client: { ...client, active: true } };
  }, { role: 'master' });

  route('PUT', '/api/clients/:id', ({ me, params, body }) => {
    const client = findClient(params.id);
    if (!client) throw fail(404, 'Cliente não encontrado.');
    Object.assign(client, {
      name: body.name, document: onlyDigits(body.document), email: body.email || null,
      notes: body.notes || null, active: body.active === false ? 0 : 1,
    });
    audit(me.id, 'update', 'client', client.id, { name: client.name });
    return { client: { ...client, active: !!client.active } };
  }, { role: 'master' });

  route('DELETE', '/api/clients/:id', ({ me, params }) => {
    const client = findClient(params.id);
    if (!client) throw fail(404, 'Cliente não encontrado.');
    const projetos = db.projects.filter((p) => p.client_id === client.id);
    const usados = db.entries.filter((e) => projetos.some((p) => p.id === e.project_id)).length;
    if (usados > 0) {
      client.active = 0;
      projetos.forEach((p) => { p.active = 0; });
      audit(me.id, 'archive', 'client', client.id, { entries: usados });
      return { archived: true, entries: usados };
    }
    db.projects = db.projects.filter((p) => p.client_id !== client.id);
    db.clients = db.clients.filter((c) => c.id !== client.id);
    audit(me.id, 'delete', 'client', client.id);
    return { archived: false };
  }, { role: 'master' });

  /* --- projetos --- */
  const shapeProject = (p) => ({
    id: p.id, clientId: p.client_id, clientName: findClient(p.client_id).name,
    name: p.name, code: p.code, billingType: p.billing_type,
    defaultRateCents: p.default_rate_cents, active: !!p.active,
  });

  route('GET', '/api/projects', ({ me, query }) => {
    const todos = query.includeInactive === 'true' && me.role === 'master';
    return { projects: db.projects
      .filter((p) => todos || (p.active && findClient(p.client_id).active))
      .filter((p) => !query.clientId || p.client_id === Number(query.clientId))
      .map(shapeProject) };
  });

  route('POST', '/api/projects', ({ me, body }) => {
    const clientId = Number(body.clientId);
    if (!findClient(clientId)) throw fail(400, 'Cliente informado não existe.');
    const dup = db.projects.some((p) => p.client_id === clientId &&
      p.name.toLowerCase() === String(body.name || '').toLowerCase());
    if (dup) throw fail(409, 'Este cliente já possui um projeto com esse nome.');
    const project = {
      id: nextId('projects'), client_id: clientId, name: body.name, code: body.code || null,
      billing_type: body.billingType || 'hourly',
      default_rate_cents: parseMoney(body.defaultRate, false), active: 1,
    };
    db.projects.push(project);
    audit(me.id, 'create', 'project', project.id, { name: project.name });
    return { __status: 201, project: shapeProject(project) };
  }, { role: 'master' });

  route('PUT', '/api/projects/:id', ({ me, params, body }) => {
    const project = findProject(params.id);
    if (!project) throw fail(404, 'Projeto não encontrado.');
    Object.assign(project, {
      client_id: Number(body.clientId), name: body.name, code: body.code || null,
      billing_type: body.billingType || 'hourly',
      default_rate_cents: parseMoney(body.defaultRate, false),
      active: body.active === false ? 0 : 1,
    });
    audit(me.id, 'update', 'project', project.id, { name: project.name });
    return { project: shapeProject(project) };
  }, { role: 'master' });

  route('DELETE', '/api/projects/:id', ({ me, params }) => {
    const project = findProject(params.id);
    if (!project) throw fail(404, 'Projeto não encontrado.');
    const usados = db.entries.filter((e) => e.project_id === project.id).length;
    if (usados > 0) {
      project.active = 0;
      audit(me.id, 'archive', 'project', project.id, { entries: usados });
      return { archived: true, entries: usados };
    }
    db.projects = db.projects.filter((p) => p.id !== project.id);
    audit(me.id, 'delete', 'project', project.id);
    return { archived: false };
  }, { role: 'master' });

  /* --- lançamentos --- */
  route('GET', '/api/entries', ({ me, query }) => {
    const todos = filterEntries(query, me)
      .sort((a, b) => (b.work_date === a.work_date ? b.id - a.id : b.work_date.localeCompare(a.work_date)));
    const limit = Math.min(Number(query.limit || 100), 500);
    const offset = Number(query.offset || 0);
    const pagina = todos.slice(offset, offset + limit).map(expandEntry);
    const expandidos = todos.map(expandEntry);
    return {
      entries: pagina,
      totals: {
        count: todos.length,
        minutes: expandidos.reduce((s, e) => s + e.minutes, 0),
        billableMinutes: expandidos.reduce((s, e) => s + (e.billable ? e.minutes : 0), 0),
        valueCents: expandidos.reduce((s, e) => s + e.valueCents, 0),
      },
      page: { limit, offset, hasMore: offset + pagina.length < todos.length },
    };
  });

  route('GET', '/api/entries/:id', ({ me, params }) => {
    const entry = db.entries.find((e) => e.id === Number(params.id));
    if (!entry) throw fail(404, 'Lançamento não encontrado.');
    if (me.role !== 'master' && entry.user_id !== me.id) {
      throw fail(403, 'Você só pode consultar os seus próprios lançamentos.');
    }
    return { entry: expandEntry(entry) };
  });

  route('POST', '/api/entries', ({ me, body }) => {
    let targetId = me.id;
    if (body.userId) {
      if (Number(body.userId) !== me.id && me.role !== 'master') {
        throw fail(403, 'Você só pode lançar horas em seu próprio nome.');
      }
      targetId = Number(body.userId);
    }
    const user = findUser(targetId);
    if (!user || !user.active) throw fail(400, 'Profissional inexistente ou inativo.');

    const project = findProject(body.projectId);
    if (!project) throw fail(400, 'Projeto inexistente.');
    if (!project.active || !findClient(project.client_id).active) {
      throw fail(400, 'Projeto ou cliente inativo — não aceita novos lançamentos.');
    }
    if (!body.workDate) throw fail(400, 'O campo "data" é obrigatório.');
    if (body.workDate > today()) throw fail(400, 'Não é possível lançar horas em data futura.');

    const description = String(body.description || '').trim();
    if (description.length < 3) throw fail(400, 'Descreva a atividade com ao menos 3 caracteres.');

    const minutes = parseDuration(body.duration ?? body.minutes);
    const explicito = me.role === 'master' && body.rate ? parseMoney(body.rate, false) : null;

    const entry = {
      id: nextId('entries'), user_id: targetId, project_id: project.id,
      work_date: body.workDate, minutes, description,
      billable: body.billable === false ? 0 : 1,
      rate_cents: explicito ?? resolveRate(project, user),
      invoice_id: null, created_by: me.id, created_at: nowIso(), updated_at: nowIso(),
    };
    db.entries.push(entry);
    audit(me.id, 'create', 'time_entry', entry.id, {
      workDate: entry.work_date, minutes, onBehalf: targetId !== me.id,
    });
    return { __status: 201, entry: expandEntry(entry) };
  });

  route('PUT', '/api/entries/:id', ({ me, params, body }) => {
    const entry = loadEntryForWrite(params.id, me);
    let targetId = entry.user_id;
    if (body.userId) {
      if (Number(body.userId) !== entry.user_id && me.role !== 'master') {
        throw fail(403, 'Você não pode transferir um lançamento para outro profissional.');
      }
      targetId = Number(body.userId);
    }
    const user = findUser(targetId);
    const project = findProject(body.projectId);
    if (!project) throw fail(400, 'Projeto inexistente.');
    if (body.workDate > today()) throw fail(400, 'Não é possível lançar horas em data futura.');

    const antes = { minutes: entry.minutes, workDate: entry.work_date, projectId: entry.project_id };
    const minutes = parseDuration(body.duration ?? body.minutes);

    let rate = entry.rate_cents;
    if (me.role === 'master' && body.rate) rate = parseMoney(body.rate, false) ?? rate;
    else if (project.id !== entry.project_id || targetId !== entry.user_id) rate = resolveRate(project, user);

    Object.assign(entry, {
      user_id: targetId, project_id: project.id, work_date: body.workDate, minutes,
      description: String(body.description || '').trim(),
      billable: body.billable === false ? 0 : 1, rate_cents: rate, updated_at: nowIso(),
    });
    audit(me.id, 'update', 'time_entry', entry.id, {
      before: antes, after: { minutes, workDate: entry.work_date, projectId: project.id },
    });
    return { entry: expandEntry(entry) };
  });

  route('DELETE', '/api/entries/:id', ({ me, params }) => {
    const entry = loadEntryForWrite(params.id, me);
    db.entries = db.entries.filter((e) => e.id !== entry.id);
    audit(me.id, 'delete', 'time_entry', entry.id, {
      workDate: entry.work_date, minutes: entry.minutes, description: entry.description,
      ownEntry: entry.user_id === me.id,
    });
    return { ok: true };
  });

  /* --- fechamentos --- */
  const shapeInvoice = (i) => ({
    id: i.id, clientId: i.client_id, clientName: findClient(i.client_id).name,
    reference: i.reference, periodStart: i.period_start, periodEnd: i.period_end,
    totalMinutes: i.total_minutes, totalHours: minutesToHm(i.total_minutes),
    totalCents: i.total_cents, status: i.status, notes: i.notes,
    entryCount: db.entries.filter((e) => e.invoice_id === i.id).length,
    createdAt: i.created_at,
  });

  route('GET', '/api/invoices', () => ({ invoices: db.invoices.map(shapeInvoice) }), { role: 'master' });

  route('POST', '/api/invoices', ({ me, body }) => {
    const clientId = Number(body.clientId);
    if (!findClient(clientId)) throw fail(400, 'Cliente não encontrado.');
    if (body.from > body.to) throw fail(400, 'A data inicial deve ser anterior à data final.');

    const candidatos = db.entries.filter((e) => {
      if (e.invoice_id) return false;
      if (!body.includeNonBillable && !e.billable) return false;
      if (findProject(e.project_id).client_id !== clientId) return false;
      return e.work_date >= body.from && e.work_date <= body.to;
    });
    if (!candidatos.length) {
      throw fail(400, 'Nenhum lançamento em aberto para este cliente no período informado.');
    }
    const invoice = {
      id: nextId('invoices'), client_id: clientId, reference: body.reference,
      period_start: body.from, period_end: body.to,
      total_minutes: candidatos.reduce((s, e) => s + e.minutes, 0),
      total_cents: candidatos.reduce((s, e) => s + (e.billable ? entryValueCents(e.minutes, e.rate_cents) : 0), 0),
      status: 'closed', notes: body.notes || null, created_at: nowIso(),
    };
    db.invoices.push(invoice);
    candidatos.forEach((e) => { e.invoice_id = invoice.id; });
    audit(me.id, 'create', 'invoice', invoice.id, {
      reference: invoice.reference, entries: candidatos.length,
    });
    return { __status: 201, invoice: shapeInvoice(invoice) };
  }, { role: 'master' });

  route('PATCH', '/api/invoices/:id', ({ me, params, body }) => {
    const invoice = db.invoices.find((i) => i.id === Number(params.id));
    if (!invoice) throw fail(404, 'Fechamento não encontrado.');
    const antes = invoice.status;
    invoice.status = body.status;
    if (body.notes !== undefined) invoice.notes = body.notes;
    audit(me.id, 'update', 'invoice', invoice.id, { from: antes, to: invoice.status });
    return { invoice: shapeInvoice(invoice) };
  }, { role: 'master' });

  route('DELETE', '/api/invoices/:id', ({ me, params }) => {
    const invoice = db.invoices.find((i) => i.id === Number(params.id));
    if (!invoice) throw fail(404, 'Fechamento não encontrado.');
    const liberados = db.entries.filter((e) => e.invoice_id === invoice.id);
    liberados.forEach((e) => { e.invoice_id = null; });
    db.invoices = db.invoices.filter((i) => i.id !== invoice.id);
    audit(me.id, 'delete', 'invoice', invoice.id, {
      reference: invoice.reference, releasedEntries: liberados.length,
    });
    return { ok: true, releasedEntries: liberados.length };
  }, { role: 'master' });

  /* --- identidade visual --- */

  let marca = {
    name: 'Azeredo & Ugatti Advogados', tagline: 'Advocacia empresarial',
    cnpj: '12345678000195', address: 'Av. Paulista, 1000 — cj. 142 — São Paulo/SP',
    phone: '(11) 3000-0000', email: 'contato@azeredoeugatti.com.br',
    site: 'azeredoeugatti.com.br', primaryColor: '#0f2033', accentColor: '#a8862f',
    footerNote: 'Documento gerado eletronicamente pelo sistema de timesheet do escritório.',
    hasLogo: false,
  };

  route('GET', '/api/settings/branding', () => ({ branding: marca }));

  route('PUT', '/api/settings/branding', ({ me, body }) => {
    if (!String(body.name || '').trim()) throw fail(400, 'O campo "nome do escritório" é obrigatório.');
    for (const campo of ['primaryColor', 'accentColor']) {
      if (body[campo] && !/^#[0-9a-fA-F]{6}$/.test(body[campo])) {
        throw fail(400, `"${campo}" deve ser uma cor em hexadecimal, como #0f2033.`);
      }
    }
    marca = { ...marca, ...body, cnpj: onlyDigits(body.cnpj) || '' };
    audit(me.id, 'update', 'branding', null, { name: marca.name });
    return { branding: marca };
  }, { role: 'master' });

  route('POST', '/api/settings/logo', ({ body }) => {
    if (!/^data:image\/(png|jpeg|jpg);base64,/i.test(String(body.dataUrl || ''))) {
      throw fail(400, 'Envie um arquivo PNG ou JPEG.');
    }
    marca.hasLogo = true;
    return { ok: true, width: 0, height: 0 };
  }, { role: 'master' });

  route('DELETE', '/api/settings/logo', () => { marca.hasLogo = false; return { ok: true }; },
    { role: 'master' });

  /* --- relatórios --- */
  const GROUPS = {
    client:  (e) => ({ id: e.clientId, name: e.clientName }),
    project: (e) => ({ id: e.projectId, name: `${e.clientName} — ${e.projectName}` }),
    user:    (e) => ({ id: e.userId, name: e.userName }),
    date:    (e) => ({ id: e.workDate, name: e.workDate.split('-').reverse().join('/') }),
    month:   (e) => ({ id: e.workDate.slice(0, 7), name: e.workDate.slice(0, 7) }),
  };

  function aggregate(entries, groupBy) {
    const mapa = new Map();
    for (const e of entries) {
      const { id, name } = GROUPS[groupBy](e);
      const atual = mapa.get(id) || {
        id, name, entries: 0, minutes: 0, billableMinutes: 0, valueCents: 0,
      };
      atual.entries++;
      atual.minutes += e.minutes;
      if (e.billable) atual.billableMinutes += e.minutes;
      atual.valueCents += e.valueCents;
      mapa.set(id, atual);
    }
    return [...mapa.values()]
      .map((g) => ({ ...g, hours: minutesToHm(g.minutes) }))
      .sort((a, b) => b.valueCents - a.valueCents || b.minutes - a.minutes);
  }

  route('GET', '/api/reports/summary', ({ me, query }) => {
    const entries = filterEntries(query, me).map(expandEntry);
    const groupBy = GROUPS[query.groupBy] ? query.groupBy : 'client';
    const minutes = entries.reduce((s, e) => s + e.minutes, 0);
    const billableMinutes = entries.reduce((s, e) => s + (e.billable ? e.minutes : 0), 0);
    return {
      groupBy,
      totals: {
        entries: entries.length, minutes, hours: minutesToHm(minutes),
        billableMinutes, billableHours: minutesToHm(billableMinutes),
        nonBillableMinutes: minutes - billableMinutes,
        valueCents: entries.reduce((s, e) => s + e.valueCents, 0),
        professionals: new Set(entries.map((e) => e.userId)).size,
        clients: new Set(entries.map((e) => e.clientId)).size,
      },
      groups: aggregate(entries, groupBy),
      byUser: me.role === 'master' ? aggregate(entries, 'user') : undefined,
    };
  });

  route('GET', '/api/reports/invoice', ({ me, query }) => {
    const client = findClient(query.clientId);
    if (!client) throw fail(400, 'Cliente não encontrado.');

    let projeto = null;
    if (query.projectId) {
      projeto = findProject(query.projectId);
      if (!projeto) throw fail(400, 'Projeto não encontrado.');
      if (projeto.client_id !== client.id) {
        throw fail(400, 'O projeto informado não pertence a este cliente.');
      }
    }

    const entries = filterEntries({ ...query, clientId: String(client.id) }, me)
      .map(expandEntry)
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.workDate.localeCompare(b.workDate));

    const porProjeto = new Map();
    for (const e of entries) {
      if (!porProjeto.has(e.projectId)) {
        porProjeto.set(e.projectId, {
          projectId: e.projectId, projectName: e.projectName, projectCode: e.projectCode,
          billingType: e.billingType, minutes: 0, billableMinutes: 0, valueCents: 0,
          professionals: new Map(), entries: [],
        });
      }
      const p = porProjeto.get(e.projectId);
      p.minutes += e.minutes;
      if (e.billable) p.billableMinutes += e.minutes;
      p.valueCents += e.valueCents;
      p.entries.push(e);

      const chave = `${e.userId}:${e.rateCents}`;
      const prof = p.professionals.get(chave) || {
        userId: e.userId, userName: e.userName, rateCents: e.rateCents,
        minutes: 0, billableMinutes: 0, valueCents: 0,
      };
      prof.minutes += e.minutes;
      if (e.billable) prof.billableMinutes += e.minutes;
      prof.valueCents += e.valueCents;
      p.professionals.set(chave, prof);
    }

    return {
      client: { id: client.id, name: client.name, document: client.document, email: client.email },
      project: projeto ? { id: projeto.id, name: projeto.name, code: projeto.code } : null,
      period: { from: query.from, to: query.to },
      generatedAt: nowIso(),
      projects: [...porProjeto.values()].map((p) => ({
        ...p, hours: minutesToHm(p.minutes), professionals: [...p.professionals.values()],
      })),
      totals: {
        entries: entries.length,
        minutes: entries.reduce((s, e) => s + e.minutes, 0),
        billableMinutes: entries.reduce((s, e) => s + (e.billable ? e.minutes : 0), 0),
        valueCents: entries.reduce((s, e) => s + e.valueCents, 0),
      },
    };
  });

  route('GET', '/api/reports/audit', ({ query }) => ({
    events: [...db.audit].reverse().slice(0, Number(query.limit || 200)).map((a) => ({
      id: a.id, at: a.at, actorId: a.actor_user_id,
      actorName: a.actor_user_id ? findUser(a.actor_user_id)?.name : null,
      action: a.action, entity: a.entity, entityId: a.entity_id, details: a.details,
    })),
  }), { role: 'master' });

  /* ------------------------------------------------- interceptação do fetch */

  const realFetch = window.fetch.bind(window);

  const respond = (status, payload) => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/api/')) return realFetch(input, init);

    // Latência simulada: sem ela a interface parece instantânea de um jeito
    // que não corresponde ao sistema real rodando em rede.
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 90));

    const parsed = new URL(url, window.location.origin);
    const method = (init.method || 'GET').toUpperCase();
    const query = Object.fromEntries(parsed.searchParams.entries());
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }

    for (const r of routes) {
      const m = parsed.pathname.match(r.regex);
      if (!m || r.method !== method) continue;
      const params = {};
      r.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });

      const me = actor();
      if (r.opts.auth && !me) return respond(401, { error: 'Autenticação necessária.' });
      if (r.opts.role === 'master' && me?.role !== 'master') {
        return respond(403, { error: 'Esta operação é exclusiva da conta master.' });
      }
      try {
        const result = r.handler({ me, params, query, body });
        const status = result?.__status || 200;
        if (result) delete result.__status;
        return respond(status, result ?? {});
      } catch (err) {
        if (err && err.__httpError) return respond(err.status, { error: err.error });
        console.error('[demo] erro inesperado', err);
        return respond(500, { error: 'Erro interno na demonstração.' });
      }
    }
    return respond(404, { error: 'Rota não encontrada.' });
  };

  seed();
  window.__demoDb = db;   // disponível no console para inspeção
})();
