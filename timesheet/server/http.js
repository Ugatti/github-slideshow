'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, notFound, badRequest, unauthorized, forbidden } = require('./errors');
const auth = require('./auth');
const config = require('./config');

const MAX_BODY_BYTES = 1024 * 1024;   // acomoda o envio do logotipo em base64
// Acima deste volume nem vale drenar para responder: a conexão é encerrada.
const HARD_BODY_LIMIT = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/* ------------------------------------------------------------------ roteador */

class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * @param {string} method
   * @param {string} pattern  ex.: '/api/entries/:id'
   * @param {Function} handler (ctx) => body
   * @param {{auth?: boolean, role?: 'master'}} opts
   */
  add(method, pattern, handler, opts = {}) {
    const names = [];
    const regexSource = pattern
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        names.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.routes.push({
      method,
      regex: new RegExp(`^${regexSource}$`),
      names,
      handler,
      opts: { auth: true, ...opts },
    });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  put(p, h, o) { return this.add('PUT', p, h, o); }
  patch(p, h, o) { return this.add('PATCH', p, h, o); }
  delete(p, h, o) { return this.add('DELETE', p, h, o); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = pathname.match(route.regex);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

/* -------------------------------------------------------------------- corpo */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Para de acumular (protege a memória), mas continua drenando para que
        // o cliente consiga ler a resposta 413 — derrubar o socket aqui faria o
        // navegador ver apenas "falha de rede", sem explicação.
        tooLarge = true;
        chunks.length = 0;
        if (size > HARD_BODY_LIMIT) {
          reject(new HttpError(413, 'Corpo da requisição muito grande.'));
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'Corpo da requisição muito grande.'));
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function parseJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  const type = req.headers['content-type'] || '';
  if (!type.includes('application/json')) {
    throw badRequest('Content-Type deve ser application/json.');
  }
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw badRequest('O corpo deve ser um objeto JSON.');
    }
    return parsed;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest('JSON inválido no corpo da requisição.');
  }
}

/* ---------------------------------------------------------------- respostas */

function send(res, status, body, headers = {}) {
  const base = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    ...headers,
  };
  res.writeHead(status, base);
  res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function serveStatic(res, rootDir, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(rootDir, rel);
  // Impede traversal: o caminho resolvido precisa continuar dentro de rootDir.
  if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
    return sendJson(res, 403, { error: 'Acesso negado.' });
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
  }
  if (!stat.isFile()) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
  const ext = path.extname(filePath).toLowerCase();
  send(res, 200, fs.readFileSync(filePath), {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
}

/* -------------------------------------------------------------- CSRF / origem */

/**
 * Defesa em profundidade contra CSRF. O cookie já é SameSite=Strict; além disso
 * toda mutação precisa vir da mesma origem (fetch do próprio app envia Origin).
 *
 * Atrás de um proxy que reescreve o Host (um Worker da Cloudflare, por
 * exemplo), o Host que chega aqui não é o que o navegador vê. Nesse caso
 * PUBLIC_ORIGIN informa o endereço público, e ele também é aceito.
 */
function assertSameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return; // clientes não-browser (curl, testes) não enviam Origin

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden('Origem inválida.');
  }

  const aceitos = new Set();
  if (req.headers.host) aceitos.add(req.headers.host);
  if (config.publicOrigin) {
    try { aceitos.add(new URL(config.publicOrigin).host); } catch { /* valor inválido */ }
  }

  if (!aceitos.has(originHost)) {
    throw forbidden('Requisição de origem cruzada bloqueada.');
  }
}

/* ------------------------------------------------------------------ handler */

function createHandler({ router, publicDir }) {
  const root = path.resolve(publicDir);

  const base = config.basePath;

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = url.pathname;

    try {
      if (base) {
        // Servido como subpágina de um site: o proxy encaminha o caminho
        // inteiro, e é aqui que ele é retirado antes do roteamento.
        if (pathname === base) {
          // Sem a barra final, "styles.css" resolveria para a raiz do domínio
          // e a página carregaria sem estilo nenhum.
          res.writeHead(308, { Location: `${base}/` });
          return res.end();
        }
        if (!pathname.startsWith(`${base}/`)) throw notFound('Rota não encontrada.');
        pathname = pathname.slice(base.length) || '/';
      }

      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return sendJson(res, 405, { error: 'Método não permitido.' });
        }
        return serveStatic(res, root, pathname);
      }

      const matched = router.match(req.method, pathname);
      if (!matched) throw notFound('Rota não encontrada.');
      if (matched.methodNotAllowed) throw new HttpError(405, 'Método não permitido.');

      assertSameOrigin(req);

      const { route, params } = matched;
      const cookies = auth.parseCookies(req.headers.cookie);
      const user = auth.userForToken(cookies[auth.COOKIE]);

      if (route.opts.auth && !user) throw unauthorized();
      if (route.opts.role === 'master' && user?.role !== 'master') {
        throw forbidden('Esta operação é exclusiva da conta master.');
      }

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? await parseJsonBody(req)
        : {};

      const ctx = {
        req, res, user, params, body,
        query: Object.fromEntries(url.searchParams.entries()),
        setCookie: (value) => res.setHeader('Set-Cookie', value),
      };

      const result = await route.handler(ctx);
      if (res.writableEnded) return undefined;          // handler respondeu sozinho
      if (result === undefined) return sendJson(res, 204, {});
      return sendJson(res, result.__status || 200, result.__status ? result.body : result);
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, {
          error: err.message,
          ...(err.details ? { details: err.details } : {}),
        });
      }
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return sendJson(res, 409, { error: 'Já existe um registro com esses dados.' });
      }
      if (err && String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
        return sendJson(res, 409, {
          error: 'Operação viola uma restrição de integridade (registro em uso).',
        });
      }
      console.error('[erro-nao-tratado]', err);
      return sendJson(res, 500, { error: 'Erro interno do servidor.' });
    }
  };
}

const status = (code, body) => ({ __status: code, body });

module.exports = { Router, createHandler, sendJson, send, status, parseJsonBody };
