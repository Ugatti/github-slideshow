'use strict';
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|sim)$/i.test(String(value));
}

/**
 * Caminho base quando o sistema não fica na raiz do domínio.
 * '' (raiz) ou '/timesheet' — sempre com barra inicial e sem barra final.
 */
function normalizeBasePath(value) {
  if (!value) return '';
  const limpo = String(value).trim().replace(/\/+$/, '');
  if (!limpo || limpo === '/') return '';
  return limpo.startsWith('/') ? limpo : `/${limpo}`;
}

module.exports = {
  ROOT,
  basePath: normalizeBasePath(process.env.BASE_PATH),
  /**
   * Endereço público pelo qual o navegador enxerga o sistema, quando ele difere
   * do host que chega ao processo — caso de um proxy que troca o Host, como um
   * Worker da Cloudflare. Ex.: https://azeredoeugatti.com.br
   */
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, ''),
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dbPath: !process.env.TIMESHEET_DB
    ? path.join(ROOT, 'data', 'timesheet.db')
    : process.env.TIMESHEET_DB === ':memory:'
      ? ':memory:'
      : path.resolve(ROOT, process.env.TIMESHEET_DB),
  sessionSecret: process.env.SESSION_SECRET || '',
  secureCookies: bool(process.env.SECURE_COOKIES, false),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  bootstrap: {
    name: process.env.BOOTSTRAP_MASTER_NAME || 'Administrador',
    email: process.env.BOOTSTRAP_MASTER_EMAIL || 'admin@azeredoeugatti.com.br',
    password: process.env.BOOTSTRAP_MASTER_PASSWORD || '',
  },
  firm: {
    name: process.env.FIRM_NAME || 'Azeredo & Ugatti Advogados',
    site: process.env.FIRM_SITE || 'https://www.azeredoeugatti.com.br/',
  },
};
