'use strict';
/**
 * Popula o banco com dados de demonstração para avaliar o sistema.
 * Uso: npm run seed  (opcionalmente TIMESHEET_DB=./data/demo.db)
 * Não roda se o banco já tiver lançamentos, para não contaminar dados reais.
 */
const db = require('../server/db');
const auth = require('../server/auth');
const config = require('../server/config');
const { ensureMasterAccount } = require('../server/app');

const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

db.open();
ensureMasterAccount({ quiet: true });

if (db.one('SELECT COUNT(*) AS n FROM time_entries').n > 0) {
  console.error('O banco já possui lançamentos — seed cancelado para não sobrescrever dados.');
  process.exit(1);
}

const SENHA_DEMO = 'Demo123456';

const profissionais = [
  { name: 'Mariana Azeredo',   email: 'mariana@exemplo.com.br',  oab: 'SP 148.220', rate: 65000, role: 'master' },
  { name: 'Leonardo Ugatti',   email: 'leonardo@exemplo.com.br', oab: 'SP 152.911', rate: 65000, role: 'master' },
  { name: 'Carla Menezes',     email: 'carla@exemplo.com.br',    oab: 'SP 301.455', rate: 38000, role: 'user' },
  { name: 'Rafael Tanaka',     email: 'rafael@exemplo.com.br',   oab: 'SP 322.104', rate: 32000, role: 'user' },
  { name: 'Júlia Prado',       email: 'julia@exemplo.com.br',    oab: null,         rate: 14000, role: 'user' },
];

const carteira = [
  { cliente: 'Indústria Bandeirantes S.A.', doc: '12345678000195', email: 'fiscal@bandeirantes.com.br', projetos: [
    { name: 'Contencioso Trabalhista — Reclamatórias', code: '0001234-55.2026.5.02.0011', rate: 48000 },
    { name: 'Consultivo Trabalhista',                  code: null,                        rate: 52000 },
  ]},
  { cliente: 'Comercial Ipiranga Ltda.', doc: '98765432000110', email: 'contas@ipiranga.com.br', projetos: [
    { name: 'Execução Fiscal — ICMS',      code: '1002345-66.2025.8.26.0053', rate: 55000 },
    { name: 'Due Diligence Societária',    code: 'DD-2026-04',                rate: null  },
  ]},
  { cliente: 'Construtora Horizonte S.A.', doc: '45678912000133', email: 'juridico@horizonte.com.br', projetos: [
    { name: 'Arbitragem CAM-CCBC',         code: 'CAM 0112/2026', rate: 78000 },
  ]},
  { cliente: 'Instituto Raízes', doc: '33221144000188', email: 'contato@raizes.org.br', projetos: [
    { name: 'Assessoria institucional (pro bono)', code: null, rate: null, billing: 'pro_bono' },
  ]},
];

const atividades = [
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

const senhaHash = auth.hashPassword(SENHA_DEMO);
const userIds = [];

db.tx(() => {
  for (const p of profissionais) {
    if (db.one('SELECT id FROM users WHERE email = ?', [p.email])) continue;
    const res = db.run(
      `INSERT INTO users (name, email, password_hash, role, oab, hourly_rate_cents, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,1,?,?)`,
      [p.name, p.email, senhaHash, p.role, p.oab, p.rate, now(), now()]
    );
    userIds.push({ id: Number(res.lastInsertRowid), role: p.role });
  }

  const projetoIds = [];
  for (const c of carteira) {
    const cres = db.run(
      'INSERT INTO clients (name, document, email, active, created_at, updated_at) VALUES (?,?,?,1,?,?)',
      [c.cliente, c.doc, c.email, now(), now()]
    );
    const clientId = Number(cres.lastInsertRowid);
    for (const p of c.projetos) {
      const pres = db.run(
        `INSERT INTO projects (client_id, name, code, billing_type, default_rate_cents, active, created_at, updated_at)
         VALUES (?,?,?,?,?,1,?,?)`,
        [clientId, p.name, p.code, p.billing || 'hourly', p.rate, now(), now()]
      );
      projetoIds.push({ id: Number(pres.lastInsertRowid), rate: p.rate, proBono: p.billing === 'pro_bono' });
    }
  }

  // ~4 meses de lançamentos, concentrados em dias úteis.
  const stmt = db.get().prepare(
    `INSERT INTO time_entries (user_id, project_id, work_date, minutes, description, billable,
                               rate_cents, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  let total = 0;
  for (let dia = 118; dia >= 0; dia--) {
    const data = daysAgo(dia);
    const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
    if (diaSemana === 0 || diaSemana === 6) continue;

    for (const u of userIds) {
      const lancamentos = 1 + Math.floor(Math.random() * 4);
      for (let i = 0; i < lancamentos; i++) {
        const projeto = pick(projetoIds);
        const usuario = db.one('SELECT hourly_rate_cents FROM users WHERE id = ?', [u.id]);
        const minutos = pick([30, 45, 60, 75, 90, 120, 150, 180, 240]);
        const faturavel = projeto.proBono ? 0 : (Math.random() > 0.12 ? 1 : 0);
        const rate = projeto.proBono ? 0 : (projeto.rate ?? usuario.hourly_rate_cents ?? 0);
        stmt.run(u.id, projeto.id, data, minutos, pick(atividades), faturavel, rate,
                 u.id, now(), now());
        total++;
      }
    }
  }
  console.log(`${total} lançamentos de demonstração criados.`);
});

console.log(`
Dados de demonstração prontos (banco: ${config.dbPath}).

  Contas master:      mariana@exemplo.com.br | leonardo@exemplo.com.br
  Contas profissional: carla@exemplo.com.br | rafael@exemplo.com.br | julia@exemplo.com.br
  Senha de todas:      ${SENHA_DEMO}

Suba o servidor com: npm start
`);
db.close();
