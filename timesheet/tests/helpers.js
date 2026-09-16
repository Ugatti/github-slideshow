'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

/** Sobe uma instância do app com banco temporário e devolve um cliente HTTP. */
async function startTestServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-ts-'));
  const dbPath = path.join(dir, 'test.db');

  // O app é carregado depois do env para que config.js leia estes valores.
  process.env.BOOTSTRAP_MASTER_EMAIL = 'master@teste.com.br';
  process.env.BOOTSTRAP_MASTER_PASSWORD = 'MasterTeste123';
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}timesheet${path.sep}server${path.sep}`)) delete require.cache[key];
  }
  const { createApp } = require('../server/app');
  const db = require('../server/db');
  db.close();

  const server = createApp({ dbPath, quiet: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Cliente HTTP que mantém o cookie de sessão entre chamadas. */
function makeClient(base) {
  let cookie = null;
  async function request(method, url, body) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    // Lê os bytes crus: res.text() remove o BOM por especificação, e o BOM é
    // justamente o que garante que o Excel abra o CSV com acentuação correta.
    const raw = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    const payload = type.includes('application/json')
      ? JSON.parse(raw.toString('utf8') || '{}')
      : raw.toString('utf8');
    return { status: res.status, body: payload, raw, headers: res.headers };
  }
  return {
    get: (u) => request('GET', u),
    post: (u, b) => request('POST', u, b ?? {}),
    put: (u, b) => request('PUT', u, b ?? {}),
    patch: (u, b) => request('PATCH', u, b ?? {}),
    del: (u) => request('DELETE', u),
    login: async (email, password) => request('POST', '/api/auth/login', { email, password }),
    get cookie() { return cookie; },
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

module.exports = { startTestServer, makeClient, today, daysAgo };
