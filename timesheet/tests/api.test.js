'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, makeClient, today, daysAgo } = require('./helpers');

const MASTER = { email: 'master@teste.com.br', password: 'MasterTeste123' };

let server;
let master;          // conta master autenticada
let ana, bruno;      // dois profissionais
let clientId, projectA, projectB;
let anaUserId, brunoUserId;

test.before(async () => {
  server = await startTestServer();
  master = makeClient(server.base);

  const login = await master.login(MASTER.email, MASTER.password);
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.role, 'master');

  const c = await master.post('/api/clients', {
    name: 'Indústria Beta S.A.', document: '12.345.678/0001-95', email: 'financeiro@beta.com.br',
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  clientId = c.body.client.id;

  const pa = await master.post('/api/projects', {
    clientId, name: 'Contencioso Trabalhista', code: '0001234-55.2026.5.02.0001',
    billingType: 'hourly', defaultRate: '450,00',
  });
  projectA = pa.body.project.id;

  const pb = await master.post('/api/projects', {
    clientId, name: 'Consultivo Societário', billingType: 'hourly',
  });
  projectB = pb.body.project.id;

  const ua = await master.post('/api/users', {
    name: 'Ana Advogada', email: 'ana@teste.com.br', role: 'user',
    oab: 'SP 123.456', hourlyRate: '300,00', password: 'AnaSenha12345',
  });
  assert.equal(ua.status, 201, JSON.stringify(ua.body));
  anaUserId = ua.body.user.id;

  const ub = await master.post('/api/users', {
    name: 'Bruno Estagiário', email: 'bruno@teste.com.br', role: 'user',
    hourlyRate: '120,00', password: 'BrunoSenha12345',
  });
  brunoUserId = ub.body.user.id;

  ana = makeClient(server.base);
  await ana.login('ana@teste.com.br', 'AnaSenha12345');
  bruno = makeClient(server.base);
  await bruno.login('bruno@teste.com.br', 'BrunoSenha12345');
});

test.after(async () => { await server.stop(); });

/* ------------------------------------------------------------- autenticação */

test('rejeita acesso sem sessão', async () => {
  const anon = makeClient(server.base);
  const res = await anon.get('/api/entries');
  assert.equal(res.status, 401);
});

test('rejeita senha incorreta sem revelar se o e-mail existe', async () => {
  const anon = makeClient(server.base);
  const errado = await anon.login('ana@teste.com.br', 'senha-errada-123');
  const inexistente = await anon.login('ninguem@teste.com.br', 'senha-errada-123');
  assert.equal(errado.status, 401);
  assert.equal(inexistente.status, 401);
  assert.equal(errado.body.error, inexistente.body.error);
});

test('logout encerra a sessão', async () => {
  const tmp = makeClient(server.base);
  await tmp.login('bruno@teste.com.br', 'BrunoSenha12345');
  assert.equal((await tmp.get('/api/auth/me')).status, 200);
  await tmp.post('/api/auth/logout');
  assert.equal((await tmp.get('/api/auth/me')).status, 401);
});

/* -------------------------------------------- permissões de cadastro (master) */

test('profissional não cria clientes, projetos nem usuários', async () => {
  assert.equal((await ana.post('/api/clients', { name: 'Cliente Pirata' })).status, 403);
  assert.equal((await ana.post('/api/projects', { clientId, name: 'X' })).status, 403);
  assert.equal((await ana.post('/api/users', {
    name: 'Y', email: 'y@t.com', role: 'master', password: 'Senha123456',
  })).status, 403);
});

test('profissional lê clientes e projetos ativos para lançar horas', async () => {
  const res = await ana.get('/api/projects');
  assert.equal(res.status, 200);
  assert.ok(res.body.projects.length >= 2);
});

test('lista de usuários oculta valor/hora e e-mail dos colegas', async () => {
  const visaoAna = await ana.get('/api/users');
  assert.equal(visaoAna.status, 200);
  for (const u of visaoAna.body.users) {
    assert.equal(u.hourlyRateCents, undefined);
    assert.equal(u.email, undefined);
  }
  const visaoMaster = await master.get('/api/users');
  assert.ok(visaoMaster.body.users.some((u) => u.hourlyRateCents === 30000));
});

/* ------------------------------------------------------ lançamento de horas */

test('profissional lança horas para si mesmo', async () => {
  const res = await ana.post('/api/entries', {
    projectId: projectA, workDate: daysAgo(1), duration: '2:30',
    description: 'Elaboração de contestação e análise de documentos.',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.entry.minutes, 150);
  assert.equal(res.body.entry.userId, anaUserId);
  // valor/hora do projeto (450) tem precedência sobre o do profissional (300)
  assert.equal(res.body.entry.rateCents, 45000);
  assert.equal(res.body.entry.valueCents, 112500); // 2,5h × R$ 450,00
});

test('sem valor no projeto, usa o valor/hora do profissional', async () => {
  const res = await ana.post('/api/entries', {
    projectId: projectB, workDate: daysAgo(1), duration: '1h00',
    description: 'Reunião de alinhamento societário.',
  });
  assert.equal(res.body.entry.rateCents, 30000);
  assert.equal(res.body.entry.valueCents, 30000);
});

test('aceita duração em minutos, h:mm e decimal', async () => {
  for (const [entrada, esperado] of [['45', 45], ['0:45', 45], ['0,75', 45]]) {
    const res = await bruno.post('/api/entries', {
      projectId: projectA, workDate: daysAgo(2), duration: entrada,
      description: `Pesquisa de jurisprudência (${entrada}).`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.entry.minutes, esperado);
  }
});

test('recusa data futura, duração zero e descrição vazia', async () => {
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal((await ana.post('/api/entries', {
    projectId: projectA, workDate: amanha, duration: '1:00', description: 'Adiantado.',
  })).status, 400);
  assert.equal((await ana.post('/api/entries', {
    projectId: projectA, workDate: today(), duration: '0', description: 'Nada.',
  })).status, 400);
  assert.equal((await ana.post('/api/entries', {
    projectId: projectA, workDate: today(), duration: '1:00', description: '',
  })).status, 400);
});

test('profissional não lança horas em nome de outro', async () => {
  const res = await ana.post('/api/entries', {
    projectId: projectA, workDate: today(), duration: '1:00',
    description: 'Tentativa de lançar para o Bruno.', userId: brunoUserId,
  });
  assert.equal(res.status, 403);
});

test('master lança horas em nome de qualquer profissional', async () => {
  const res = await master.post('/api/entries', {
    projectId: projectA, workDate: daysAgo(3), duration: '3:00',
    description: 'Audiência de instrução (lançada pela coordenação).', userId: brunoUserId,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.entry.userId, brunoUserId);
  assert.equal(res.body.entry.createdBy, 1);
});

/* ------------------------------------------------ isolamento entre usuários */

test('cada profissional enxerga somente as próprias horas', async () => {
  const daAna = await ana.get('/api/entries');
  assert.ok(daAna.body.entries.length > 0);
  assert.ok(daAna.body.entries.every((e) => e.userId === anaUserId));

  const doBruno = await bruno.get('/api/entries');
  assert.ok(doBruno.body.entries.every((e) => e.userId === brunoUserId));
});

test('filtrar por outro usuário não vaza dados para o profissional', async () => {
  const res = await ana.get(`/api/entries?userId=${brunoUserId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.entries.every((e) => e.userId === anaUserId));
});

test('master enxerga as horas de todo o escritório', async () => {
  const res = await master.get('/api/entries');
  const usuarios = new Set(res.body.entries.map((e) => e.userId));
  assert.ok(usuarios.has(anaUserId) && usuarios.has(brunoUserId));
});

test('profissional não consulta lançamento alheio pelo id', async () => {
  const doBruno = (await bruno.get('/api/entries')).body.entries[0];
  assert.equal((await ana.get(`/api/entries/${doBruno.id}`)).status, 403);
  assert.equal((await master.get(`/api/entries/${doBruno.id}`)).status, 200);
});

/* -------------------------------------------------- edição e exclusão */

test('profissional edita e exclui o próprio lançamento', async () => {
  const criado = await ana.post('/api/entries', {
    projectId: projectA, workDate: daysAgo(4), duration: '1:00', description: 'Rascunho inicial.',
  });
  const id = criado.body.entry.id;

  const editado = await ana.put(`/api/entries/${id}`, {
    projectId: projectA, workDate: daysAgo(4), duration: '1:45',
    description: 'Rascunho inicial revisado e protocolado.',
  });
  assert.equal(editado.status, 200);
  assert.equal(editado.body.entry.minutes, 105);

  assert.equal((await ana.del(`/api/entries/${id}`)).status, 200);
  assert.equal((await ana.get(`/api/entries/${id}`)).status, 404);
});

test('profissional não edita nem exclui lançamento de colega', async () => {
  const doBruno = (await bruno.get('/api/entries')).body.entries[0];
  const edit = await ana.put(`/api/entries/${doBruno.id}`, {
    projectId: projectA, workDate: today(), duration: '9:00', description: 'Sequestro de horas.',
  });
  assert.equal(edit.status, 403);
  assert.equal((await ana.del(`/api/entries/${doBruno.id}`)).status, 403);
  // e o lançamento continua intacto
  assert.equal((await master.get(`/api/entries/${doBruno.id}`)).body.entry.description,
    doBruno.description);
});

test('master edita e exclui lançamento de qualquer profissional', async () => {
  const criado = await bruno.post('/api/entries', {
    projectId: projectA, workDate: daysAgo(5), duration: '2:00', description: 'Diligência no fórum.',
  });
  const id = criado.body.entry.id;

  const editado = await master.put(`/api/entries/${id}`, {
    projectId: projectA, workDate: daysAgo(5), duration: '2:30',
    description: 'Diligência no fórum (ajustada pela coordenação).',
  });
  assert.equal(editado.status, 200);
  assert.equal(editado.body.entry.minutes, 150);
  assert.equal((await master.del(`/api/entries/${id}`)).status, 200);
});

/* ----------------------------------------------------------- relatórios */

test('resumo do master soma o escritório; o do profissional, só ele', async () => {
  const doMaster = await master.get('/api/reports/summary?groupBy=client');
  const daAna = await ana.get('/api/reports/summary?groupBy=client');
  assert.ok(doMaster.body.totals.minutes > daAna.body.totals.minutes);
  assert.ok(doMaster.body.byUser.length >= 2);
  assert.equal(daAna.body.byUser, undefined);
});

test('exportação CSV sai com BOM e separador ponto-e-vírgula', async () => {
  const res = await master.get('/api/reports/export.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.ok(res.body.startsWith('﻿'));
  assert.ok(res.body.split('\r\n')[0].includes('Cliente;Projeto'));
});

test('memória de cálculo da nota fiscal agrupa por projeto e profissional', async () => {
  const res = await master.get(
    `/api/reports/invoice?clientId=${clientId}&from=${daysAgo(30)}&to=${today()}`
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.client.id, clientId);
  assert.ok(res.body.projects.length >= 1);
  const soma = res.body.projects.reduce((s, p) => s + p.valueCents, 0);
  assert.equal(soma, res.body.totals.valueCents);
  assert.ok(res.body.projects[0].professionals.length >= 1);
});

test('trilha de auditoria é exclusiva da master', async () => {
  assert.equal((await ana.get('/api/reports/audit')).status, 403);
  const res = await master.get('/api/reports/audit');
  assert.equal(res.status, 200);
  assert.ok(res.body.events.some((e) => e.entity === 'time_entry' && e.action === 'delete'));
});

/* --------------------------------------------------- fechamento / nota fiscal */

test('fechamento congela os lançamentos do período', async () => {
  const fechamento = await master.post('/api/invoices', {
    clientId, from: daysAgo(30), to: today(), reference: 'NF 2026/001',
  });
  assert.equal(fechamento.status, 201, JSON.stringify(fechamento.body));
  const invoiceId = fechamento.body.invoice.id;
  assert.ok(fechamento.body.invoice.totalCents > 0);

  // um lançamento fechado não aceita mais edição — nem do dono, nem da master
  const fechada = (await ana.get('/api/entries')).body.entries.find((e) => e.locked);
  assert.ok(fechada, 'esperava ao menos um lançamento travado');
  const tentativa = await ana.put(`/api/entries/${fechada.id}`, {
    projectId: projectA, workDate: fechada.workDate, duration: '9:00', description: 'Alterar fechado.',
  });
  assert.equal(tentativa.status, 400);
  assert.match(tentativa.body.error, /fechamento/i);
  assert.equal((await master.del(`/api/entries/${fechada.id}`)).status, 400);

  // reabrir o fechamento devolve os lançamentos ao estado editável
  const reabertura = await master.del(`/api/invoices/${invoiceId}`);
  assert.equal(reabertura.status, 200);
  assert.ok(reabertura.body.releasedEntries > 0);
  assert.equal((await ana.put(`/api/entries/${fechada.id}`, {
    projectId: projectA, workDate: fechada.workDate, duration: '3:00',
    description: 'Ajuste após reabertura do período.',
  })).status, 200);
});

test('profissional não acessa fechamentos', async () => {
  assert.equal((await ana.get('/api/invoices')).status, 403);
  assert.equal((await ana.post('/api/invoices', {
    clientId, from: daysAgo(10), to: today(), reference: 'NF pirata',
  })).status, 403);
});

/* ------------------------------------------------ integridade dos cadastros */

test('cliente com horas lançadas é arquivado, não apagado', async () => {
  const res = await master.del(`/api/clients/${clientId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.archived, true);
  assert.ok(res.body.entries > 0);
  // o histórico continua acessível nos relatórios
  const resumo = await master.get('/api/reports/summary');
  assert.ok(resumo.body.totals.minutes > 0);
  // reativa para não afetar os testes seguintes
  await master.put(`/api/clients/${clientId}`, {
    name: 'Indústria Beta S.A.', document: '12.345.678/0001-95', active: true,
  });
  await master.put(`/api/projects/${projectA}`, {
    clientId, name: 'Contencioso Trabalhista', billingType: 'hourly',
    defaultRate: '450,00', active: true,
  });
});

test('não é possível ficar sem conta master ativa', async () => {
  const res = await master.put('/api/users/1', {
    name: 'Administrador', email: 'master@teste.com.br', role: 'user',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /master/i);
});

test('troca de senha derruba as demais sessões', async () => {
  const sessao1 = makeClient(server.base);
  await sessao1.login('bruno@teste.com.br', 'BrunoSenha12345');
  const sessao2 = makeClient(server.base);
  await sessao2.login('bruno@teste.com.br', 'BrunoSenha12345');

  const troca = await sessao2.post('/api/auth/password', {
    currentPassword: 'BrunoSenha12345', newPassword: 'NovaSenhaBruno123',
  });
  assert.equal(troca.status, 200);
  assert.equal((await sessao1.get('/api/auth/me')).status, 401);  // sessão antiga caiu
  assert.equal((await sessao2.get('/api/auth/me')).status, 200);  // a atual segue válida
});

test('usuário desativado perde o acesso imediatamente', async () => {
  const novo = await master.post('/api/users', {
    name: 'Temporário', email: 'temp@teste.com.br', role: 'user', password: 'TempSenha12345',
  });
  const sessao = makeClient(server.base);
  await sessao.login('temp@teste.com.br', 'TempSenha12345');
  assert.equal((await sessao.get('/api/auth/me')).status, 200);

  await master.del(`/api/users/${novo.body.user.id}`);
  assert.equal((await sessao.get('/api/auth/me')).status, 401);
  assert.equal((await sessao.login('temp@teste.com.br', 'TempSenha12345')).status, 401);
});
