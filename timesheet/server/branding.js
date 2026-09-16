'use strict';
/**
 * Identidade visual do escritório, usada no papel timbrado dos relatórios.
 * Fica no banco (tabela settings) para que o escritório ajuste pela interface,
 * sem precisar editar código nem reimplantar o sistema.
 */
const db = require('./db');
const config = require('./config');

const CHAVE = 'branding';
const CHAVE_LOGO = 'branding_logo';

const PADRAO = {
  name: config.firm.name,
  tagline: 'Advocacia',
  cnpj: '',
  address: '',
  phone: '',
  email: '',
  site: config.firm.site.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  primaryColor: '#0f2033',
  accentColor: '#a8862f',
  footerNote: 'Documento gerado eletronicamente pelo sistema de timesheet do escritório.',
};

function get() {
  const bruto = db.getSetting(CHAVE);
  if (!bruto) return { ...PADRAO, hasLogo: !!db.getSetting(CHAVE_LOGO) };
  try {
    return { ...PADRAO, ...JSON.parse(bruto), hasLogo: !!db.getSetting(CHAVE_LOGO) };
  } catch {
    return { ...PADRAO, hasLogo: false };
  }
}

function save(valores) {
  const atual = get();
  const proximo = {};
  for (const chave of Object.keys(PADRAO)) {
    proximo[chave] = valores[chave] !== undefined ? valores[chave] : atual[chave];
  }
  db.setSetting(CHAVE, JSON.stringify(proximo));
  return get();
}

/** Logotipo como Buffer, ou null. Guardado em base64 na tabela settings. */
function logo() {
  const base64 = db.getSetting(CHAVE_LOGO);
  return base64 ? Buffer.from(base64, 'base64') : null;
}

const saveLogo = (buffer) =>
  db.setSetting(CHAVE_LOGO, Buffer.from(buffer).toString('base64'));

const clearLogo = () => db.run('DELETE FROM settings WHERE key = ?', [CHAVE_LOGO]);

module.exports = { get, save, logo, saveLogo, clearLogo, PADRAO };
