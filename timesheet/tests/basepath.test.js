'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer, makeClient } = require('./helpers');

/**
 * O sistema pode ser publicado como subpágina de um site já existente
 * (azeredoeugatti.com.br/timesheet). Estes testes garantem que nada ficou
 * amarrado à raiz do domínio — um único caminho absoluto esquecido quebra a
 * página inteira quando ela sai da raiz.
 */

const BASE = '/timesheet';
let server;

test.before(async () => { server = await startTestServer({ basePath: BASE }); });
test.after(async () => { await server.stop(); });

test('a página abre sob a subpasta', async () => {
  const res = await fetch(`${server.origin}${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>Timesheet/);
});

test('sem a barra final, redireciona em vez de servir a página torta', async () => {
  const res = await fetch(`${server.origin}${BASE}`, { redirect: 'manual' });
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), `${BASE}/`);
});

test('nada responde fora da subpasta', async () => {
  for (const caminho of ['/', '/styles.css', '/app.js', '/api/health']) {
    const res = await fetch(server.origin + caminho, { redirect: 'manual' });
    assert.equal(res.status, 404, `${caminho} deveria ser 404 fora da base`);
  }
});

test('os arquivos da interface são servidos sob a subpasta', async () => {
  for (const [arquivo, tipo] of [['styles.css', /text\/css/], ['app.js', /javascript/]]) {
    const res = await fetch(`${server.origin}${BASE}/${arquivo}`);
    assert.equal(res.status, 200, `${arquivo} não foi servido`);
    assert.match(res.headers.get('content-type'), tipo);
  }
});

test('o HTML não referencia caminhos absolutos', () => {
  // Uma referência como href="/styles.css" carregaria da raiz do domínio —
  // que, numa subpágina, pertence ao site institucional, não a este sistema.
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const absolutos = [...html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(absolutos, [], `referências absolutas encontradas: ${absolutos.join(', ')}`);
});

test('o front-end deriva a base da própria URL', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(js, /const API_BASE = location\.pathname/);
  // Toda ida à rede precisa passar por apiUrl(); um fetch cru quebraria fora da raiz.
  const fetchesCrus = [...js.matchAll(/fetch\((?!apiUrl)([^)]{0,40})/g)]
    .map((m) => m[1].trim())
    .filter((arg) => arg.startsWith("'/") || arg.startsWith('"/') || arg.startsWith('`/'));
  assert.deepEqual(fetchesCrus, [], `fetch com caminho absoluto: ${fetchesCrus.join(', ')}`);
});

test('a API funciona sob a subpasta e o cookie vale só ali', async () => {
  const cliente = makeClient(server.base);
  const saude = await cliente.get('/api/health');
  assert.equal(saude.status, 200);
  assert.equal(saude.body.ok, true);

  const login = await fetch(`${server.origin}${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'master@teste.com.br', password: 'MasterTeste123' }),
  });
  assert.equal(login.status, 200);

  // Path=/timesheet impede que o cookie seja enviado ao site institucional
  // hospedado na mesma origem.
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`Path=${BASE}(;|$)`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('o fluxo completo continua funcionando sob a subpasta', async () => {
  const cliente = makeClient(server.base);
  await cliente.login('master@teste.com.br', 'MasterTeste123');

  const c = await cliente.post('/api/clients', { name: 'Cliente Subpasta Ltda.' });
  assert.equal(c.status, 201);
  const projeto = await cliente.post('/api/projects', {
    clientId: c.body.client.id, name: 'Projeto Subpasta', defaultRate: '500,00',
  });
  assert.equal(projeto.status, 201);

  const hoje = new Date().toISOString().slice(0, 10);
  const lancamento = await cliente.post('/api/entries', {
    projectId: projeto.body.project.id, workDate: hoje, duration: '2:00',
    description: 'Atividade lançada com o sistema em subpasta.',
  });
  assert.equal(lancamento.status, 201);
  assert.equal(lancamento.body.entry.valueCents, 100000);

  const pdf = await fetch(
    `${server.base}/api/reports/pdf?clientId=${c.body.client.id}&from=${hoje}&to=${hoje}`,
    { headers: { cookie: cliente.cookie } }
  );
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.ok(bytes.subarray(0, 8).toString().startsWith('%PDF-1.'));
});

test('atrás de proxy que troca o Host, a origem pública configurada é aceita', async () => {
  const cliente = makeClient(server.base);
  await cliente.login('master@teste.com.br', 'MasterTeste123');

  const enviar = (origem) => fetch(`${server.base}/api/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cliente.cookie, Origin: origem },
    body: JSON.stringify({ name: `Cliente ${origem.replace(/\W/g, '')}` }),
  });

  // Sem PUBLIC_ORIGIN, uma origem estranha continua barrada.
  const invasor = await enviar('https://site-malicioso.example');
  assert.equal(invasor.status, 403);

  const config = require('../server/config');
  const anterior = config.publicOrigin;
  config.publicOrigin = 'https://azeredoeugatti.com.br';
  try {
    const legitimo = await enviar('https://azeredoeugatti.com.br');
    assert.equal(legitimo.status, 201, 'a origem pública configurada deveria passar');

    // E configurar uma origem pública não abre a porta para as demais.
    const outro = await enviar('https://outro-site.example');
    assert.equal(outro.status, 403);
  } finally {
    config.publicOrigin = anterior;
  }
});
