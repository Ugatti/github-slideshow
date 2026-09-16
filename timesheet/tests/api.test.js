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

test('bloqueia a conta após sucessivas tentativas de senha errada', async () => {
  const alvo = await master.post('/api/users', {
    name: 'Alvo Bruteforce', email: 'alvo@teste.com.br', role: 'user', password: 'AlvoSenha12345',
  });
  assert.equal(alvo.status, 201);

  const atacante = makeClient(server.base);
  for (let i = 0; i < 8; i++) {
    const res = await atacante.login('alvo@teste.com.br', `chute-errado-${i}`);
    assert.equal(res.status, 401);
  }
  // a 9ª tentativa é barrada antes mesmo de conferir a senha
  const bloqueado = await atacante.login('alvo@teste.com.br', 'AlvoSenha12345');
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.body.error, /tentativas/i);
});

test('rejeita requisição de mutação vinda de outra origem', async () => {
  const res = await fetch(`${server.base}/api/entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://site-malicioso.example',
      cookie: ana.cookie,
    },
    body: JSON.stringify({
      projectId: projectA, workDate: today(), duration: '1:00', description: 'CSRF.',
    }),
  });
  assert.equal(res.status, 403);
});

test('recusa corpo que não seja JSON e payload gigante', async () => {
  const semTipo = await fetch(`${server.base}/api/entries`, {
    method: 'POST', headers: { cookie: ana.cookie, 'Content-Type': 'text/plain' }, body: 'x=1',
  });
  assert.equal(semTipo.status, 400);

  const gigante = await fetch(`${server.base}/api/entries`, {
    method: 'POST',
    headers: { cookie: ana.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'x'.repeat(300 * 1024) }),
  });
  assert.ok([400, 413].includes(gigante.status), `status inesperado: ${gigante.status}`);
});

test('não serve arquivos fora do diretório público', async () => {
  for (const alvo of ['/../server/db.js', '/..%2fserver%2fdb.js', '/../.env']) {
    const res = await fetch(server.base + alvo, { redirect: 'manual' });
    assert.ok(res.status === 403 || res.status === 404, `${alvo} devolveu ${res.status}`);
    const corpo = await res.text();
    assert.ok(!corpo.includes('DatabaseSync'), `${alvo} vazou código-fonte`);
  }
});

/* ------------------------------------------------- relatórios em PDF e marca */

test('relatório em PDF por cliente consolida todos os projetos', async () => {
  const res = await fetch(
    `${server.base}/api/reports/pdf?${new URLSearchParams({
      clientId: String(clientId), from: daysAgo(30), to: today(),
    })}`,
    { headers: { cookie: master.cookie } }
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /attachment; filename=".*\.pdf"/);

  const pdf = Buffer.from(await res.arrayBuffer());
  assert.ok(pdf.subarray(0, 8).toString().startsWith('%PDF-1.'));
  assert.ok(pdf.toString('latin1').trimEnd().endsWith('%%EOF'));
  assert.ok(pdf.length > 1500, `PDF suspeito de estar vazio: ${pdf.length} bytes`);
});

test('relatório em PDF por projeto isola apenas aquele projeto', async () => {
  // Fixture própria: outros testes movem lançamentos entre projetos, então este
  // não pode depender do estado acumulado da suíte.
  const cli = await master.post('/api/clients', { name: 'Transportes Aurora Ltda.' });
  const id = cli.body.client.id;
  const alfa = (await master.post('/api/projects', {
    clientId: id, name: 'Recuperação Judicial', code: 'RJ-2026-07', defaultRate: '600,00',
  })).body.project.id;
  const beta = (await master.post('/api/projects', {
    clientId: id, name: 'Consultivo Regulatório', defaultRate: '400,00',
  })).body.project.id;

  await master.post('/api/entries', {
    projectId: alfa, workDate: daysAgo(3), duration: '5:00',
    description: 'Elaboração do plano de recuperação judicial.',
  });
  await master.post('/api/entries', {
    projectId: beta, workDate: daysAgo(3), duration: '2:00',
    description: 'Parecer sobre exigência regulatória.',
  });

  const periodo = (extra) => new URLSearchParams({
    clientId: String(id), from: daysAgo(10), to: today(), ...extra,
  });

  const doCliente = await master.get(`/api/reports/invoice?${periodo({})}`);
  assert.equal(doCliente.body.projects.length, 2);
  assert.equal(doCliente.body.project, null, 'sem projectId o escopo é o cliente inteiro');
  assert.equal(doCliente.body.totals.minutes, 420);
  assert.equal(doCliente.body.totals.valueCents, 5 * 60000 + 2 * 40000);

  const doProjeto = await master.get(`/api/reports/invoice?${periodo({ projectId: String(alfa) })}`);
  assert.equal(doProjeto.body.projects.length, 1);
  assert.equal(doProjeto.body.project.id, alfa);
  assert.equal(doProjeto.body.totals.minutes, 300);
  assert.equal(doProjeto.body.totals.valueCents, 5 * 60000);

  // Os dois relatórios em separado precisam somar exatamente o consolidado.
  const doOutro = await master.get(`/api/reports/invoice?${periodo({ projectId: String(beta) })}`);
  assert.equal(
    doProjeto.body.totals.valueCents + doOutro.body.totals.valueCents,
    doCliente.body.totals.valueCents
  );

  // O nome do arquivo identifica o projeto, para não sobrescrever o do cliente.
  const pdfCliente = await fetch(`${server.base}/api/reports/pdf?${periodo({})}`,
    { headers: { cookie: master.cookie } });
  const pdfProjeto = await fetch(`${server.base}/api/reports/pdf?${periodo({ projectId: String(alfa) })}`,
    { headers: { cookie: master.cookie } });
  assert.equal(pdfCliente.status, 200);
  assert.equal(pdfProjeto.status, 200);

  const nomeCliente = pdfCliente.headers.get('content-disposition');
  const nomeProjeto = pdfProjeto.headers.get('content-disposition');
  assert.match(nomeCliente, /transportes-aurora/);
  assert.match(nomeProjeto, /recuperacao-judicial/);
  assert.notEqual(nomeCliente, nomeProjeto);
});

test('recusa projeto que não pertence ao cliente informado', async () => {
  const outro = await master.post('/api/clients', { name: 'Cliente Diverso Ltda.' });
  const res = await master.get(
    `/api/reports/invoice?clientId=${outro.body.client.id}&projectId=${projectA}` +
    `&from=${daysAgo(30)}&to=${today()}`
  );
  assert.equal(res.status, 400);
  assert.match(res.body.error, /não pertence/i);
});

test('PDF de período sem horas é recusado com explicação', async () => {
  const res = await fetch(
    `${server.base}/api/reports/pdf?clientId=${clientId}&from=2019-01-01&to=2019-01-31`,
    { headers: { cookie: master.cookie } }
  );
  assert.equal(res.status, 400);
  const corpo = await res.json();
  assert.match(corpo.error, /nada a gerar/i);
});

test('PDF do profissional contém apenas as horas dele', async () => {
  const meu = await fetch(
    `${server.base}/api/reports/pdf?clientId=${clientId}&from=${daysAgo(30)}&to=${today()}`,
    { headers: { cookie: ana.cookie } }
  );
  assert.equal(meu.status, 200);

  const doMaster = await master.get(
    `/api/reports/invoice?clientId=${clientId}&from=${daysAgo(30)}&to=${today()}`);
  const daAna = await ana.get(
    `/api/reports/invoice?clientId=${clientId}&from=${daysAgo(30)}&to=${today()}`);
  assert.ok(daAna.body.totals.minutes < doMaster.body.totals.minutes);
  for (const projeto of daAna.body.projects) {
    for (const prof of projeto.professionals) assert.equal(prof.userId, anaUserId);
  }
});

test('identidade visual: master edita, profissional apenas lê', async () => {
  const leitura = await ana.get('/api/settings/branding');
  assert.equal(leitura.status, 200);
  assert.ok(leitura.body.branding.name);

  assert.equal((await ana.put('/api/settings/branding', { name: 'Escritório Pirata' })).status, 403);

  const salvo = await master.put('/api/settings/branding', {
    name: 'Azeredo & Ugatti Advogados', tagline: 'Advocacia empresarial',
    cnpj: '12.345.678/0001-95', address: 'Av. Paulista, 1000 — São Paulo/SP',
    phone: '(11) 3000-0000', email: 'contato@azeredoeugatti.com.br',
    primaryColor: '#0F2033', accentColor: '#A8862F',
  });
  assert.equal(salvo.status, 200);
  assert.equal(salvo.body.branding.cnpj, '12345678000195');
  assert.equal(salvo.body.branding.primaryColor, '#0f2033');

  // a marca salva precisa sobreviver a uma nova leitura
  assert.equal((await master.get('/api/settings/branding')).body.branding.tagline,
    'Advocacia empresarial');
});

test('recusa cor inválida na identidade visual', async () => {
  const res = await master.put('/api/settings/branding', {
    name: 'Azeredo & Ugatti Advogados', accentColor: 'dourado',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /hexadecimal/i);
});

test('logotipo: aceita PNG válido e recusa arquivo que não é imagem', async () => {
  const zlib = require('node:zlib');
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
    return (~c) >>> 0;
  };
  const chunk = (tipo, dados) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const td = Buffer.concat([Buffer.from(tipo), dados]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const w = 200, h = 60;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = [];
  for (let y = 0; y < h; y++) {
    const l = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) { l[1 + x * 3] = 15; l[2 + x * 3] = 32; l[3 + x * 3] = 51; }
    linhas.push(l);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(linhas))), chunk('IEND', Buffer.alloc(0)),
  ]);

  const enviado = await master.post('/api/settings/logo', {
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
  });
  assert.equal(enviado.status, 200, JSON.stringify(enviado.body));
  assert.equal(enviado.body.width, 200);

  assert.equal((await master.get('/api/settings/branding')).body.branding.hasLogo, true);

  const ruim = await master.post('/api/settings/logo', {
    dataUrl: 'data:image/png;base64,' + Buffer.from('isto não é um png').toString('base64'),
  });
  assert.equal(ruim.status, 400);
  assert.match(ruim.body.error, /imagem|PNG/i);

  assert.equal((await ana.post('/api/settings/logo', { dataUrl: 'x' })).status, 403);

  // com logotipo cadastrado o PDF continua íntegro
  const res = await fetch(
    `${server.base}/api/reports/pdf?clientId=${clientId}&from=${daysAgo(30)}&to=${today()}`,
    { headers: { cookie: master.cookie } }
  );
  assert.equal(res.status, 200);
  const pdf = Buffer.from(await res.arrayBuffer());
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);

  assert.equal((await master.del('/api/settings/logo')).status, 200);
  assert.equal((await master.get('/api/settings/branding')).body.branding.hasLogo, false);
});
