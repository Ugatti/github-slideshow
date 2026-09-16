'use strict';
/**
 * Monta o PDF do relatório de horas com o papel timbrado do escritório.
 *
 * Dois escopos, escolhidos por quem emite:
 *   - cliente  → consolida todos os projetos do cliente num relatório só;
 *   - projeto  → isola um projeto, para faturar ou prestar contas em separado.
 */
const { PdfDocument } = require('./pdf/document');
const fmt = require('./format');

const CINZA = '#55616e';
const CINZA_CLARO = '#8494a3';
const LINHA = '#dfe5ec';
const TINTA = '#16202b';

const formatarDocumento = (doc) => {
  if (!doc) return '';
  const d = String(doc).replace(/\D/g, '');
  if (d.length === 14) return `CNPJ ${d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`;
  if (d.length === 11) return `CPF ${d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}`;
  return doc;
};

const TIPO_COBRANCA = { hourly: 'Por hora', fixed: 'Honorário fixo', pro_bono: 'Pro bono' };

/**
 * @param {object} dados resultado de /api/reports/invoice
 * @param {object} marca identidade visual (branding.get())
 * @param {Buffer|null} logo
 * @param {{detailed:boolean, scope:string, projectName:string|null, emitidoPor:string}} opcoes
 */
function build(dados, marca, logo, opcoes = {}) {
  const { detailed = false, projectName = null, emitidoPor = '' } = opcoes;
  const primaria = marca.primaryColor || '#0f2033';
  const destaque = marca.accentColor || '#a8862f';

  const titulo = projectName ? 'Relatório de horas — projeto' : 'Relatório de horas — cliente';
  const periodo = `${fmt.isoToBr(dados.period.from)} a ${fmt.isoToBr(dados.period.to)}`;

  const doc = new PdfDocument({
    margin: { top: 42, right: 46, bottom: 58, left: 46 },
    info: {
      title: `${titulo} — ${dados.client.name} — ${periodo}`,
      author: marca.name,
      subject: 'Demonstrativo de horas para faturamento de honorários',
    },
    header: (d, pagina) => (pagina === 0 ? timbrado(d) : cabecalhoCompacto(d)),
    footer: (d, pagina, total) => rodape(d, pagina, total),
  });

  /* ------------------------------------------------------ papel timbrado */

  function timbrado(d) {
    const x = d.margin.left;
    let alturaLogo = 0;

    if (logo) {
      try {
        const desenhada = d.image(logo, x, 34, { width: 128, height: 46 });
        alturaLogo = desenhada.height;
      } catch {
        alturaLogo = 0;   // logotipo inválido nunca impede a emissão do relatório
      }
    }

    const yTexto = alturaLogo ? 34 + alturaLogo + 14 : 44;
    if (!alturaLogo) {
      d.drawText(marca.name, x, yTexto, { font: 'bold', size: 15, fill: primaria });
      if (marca.tagline) {
        d.drawText(String(marca.tagline).toUpperCase(), x, yTexto + 13,
          { font: 'regular', size: 7, fill: destaque });
      }
    }

    // Bloco de contato alinhado à direita
    const contato = [
      formatarDocumento(marca.cnpj), marca.address, marca.phone, marca.email, marca.site,
    ].filter(Boolean);
    let yContato = 40;
    for (const linha of contato) {
      d.drawText(linha, d.size.width - d.margin.right - 210, yContato, {
        size: 7.5, fill: CINZA_CLARO, align: 'right', width: 210,
      });
      yContato += 10;
    }

    const yRegua = Math.max(alturaLogo ? 34 + alturaLogo + 16 : yTexto + 22, yContato + 4);
    d.rect(x, yRegua, d.contentWidth, 2, { fill: destaque });
    d.y = yRegua + 26;
  }

  function cabecalhoCompacto(d) {
    const x = d.margin.left;
    d.drawText(marca.name, x, 34, { font: 'bold', size: 8.5, fill: primaria });
    d.drawText(`${dados.client.name} · ${periodo}`, x, 34,
      { size: 8, fill: CINZA_CLARO, align: 'right', width: d.contentWidth });
    d.line(x, 40, x + d.contentWidth, 40, { stroke: LINHA, width: 0.8 });
    d.y = 58;
  }

  function rodape(d, pagina, total) {
    const x = d.margin.left;
    const y = d.size.height - 40;
    d.line(x, y, x + d.contentWidth, y, { stroke: LINHA, width: 0.5 });
    d.drawText(marca.footerNote || marca.name, x, y + 12, { size: 6.8, fill: CINZA_CLARO });
    d.drawText(`Página ${pagina + 1} de ${total}`, x, y + 12,
      { size: 6.8, fill: CINZA_CLARO, align: 'right', width: d.contentWidth });
  }

  /* ------------------------------------------------------------- conteúdo */

  doc.drawText(titulo.toUpperCase(), doc.margin.left, doc.y,
    { font: 'bold', size: 7.5, fill: destaque });
  doc.y += 16;

  doc.drawText(dados.client.name, doc.margin.left, doc.y, { font: 'bold', size: 16, fill: primaria });
  doc.y += 18;

  const identificacao = [formatarDocumento(dados.client.document), `Período: ${periodo}`]
    .filter(Boolean).join('   ·   ');
  doc.drawText(identificacao, doc.margin.left, doc.y, { size: 8.5, fill: CINZA });
  doc.y += 12;

  doc.drawText(
    projectName ? `Escopo: projeto "${projectName}"` : 'Escopo: todos os projetos do cliente',
    doc.margin.left, doc.y, { size: 8.5, fill: CINZA }
  );
  doc.y += 24;

  /* Indicadores */
  const indicadores = [
    ['Horas lançadas', fmt.minutesToHm(dados.totals.minutes),
     `${fmt.minutesToDecimalBr(dados.totals.minutes)} h decimais`],
    ['Horas faturáveis', fmt.minutesToHm(dados.totals.billableMinutes),
     `${dados.totals.entries} atividade(s)`],
    ['Total a faturar', `R$ ${fmt.centsToBrl(dados.totals.valueCents)}`, 'horas × valor/hora'],
  ];
  const larguraCaixa = (doc.contentWidth - 16) / 3;
  indicadores.forEach(([rotulo, valor, nota], i) => {
    const x = doc.margin.left + i * (larguraCaixa + 8);
    doc.rect(x, doc.y, larguraCaixa, 52, { fill: '#f7f9fb' });
    doc.rect(x, doc.y, 2.5, 52, { fill: i === 2 ? destaque : primaria });
    doc.drawText(rotulo.toUpperCase(), x + 11, doc.y + 15, { font: 'bold', size: 6.5, fill: CINZA_CLARO });
    doc.drawText(valor, x + 11, doc.y + 34, {
      font: 'bold', size: 15, fill: i === 2 ? destaque : primaria,
    });
    doc.drawText(nota, x + 11, doc.y + 46, { size: 6.8, fill: CINZA_CLARO });
  });
  doc.y += 52 + 26;

  /* Um bloco por projeto */
  const colunasResumo = (largura) => {
    const proporcoes = [0.40, 0.14, 0.14, 0.16, 0.16];
    const rotulos = ['Profissional', 'Horas', 'Decimal', 'Valor/hora', 'Valor (R$)'];
    const chaves = ['profissional', 'horas', 'decimal', 'taxa', 'valor'];
    return rotulos.map((label, i) => ({
      key: chaves[i], label, width: largura * proporcoes[i],
      align: i === 0 ? 'left' : 'right',
    }));
  };

  for (const projeto of dados.projects) {
    doc.ensureSpace(96);

    doc.drawText(projeto.projectName, doc.margin.left, doc.y + 9,
      { font: 'bold', size: 10.5, fill: primaria, width: doc.contentWidth * 0.62 });
    doc.drawText(
      `${projeto.hours} h · R$ ${fmt.centsToBrl(projeto.valueCents)}`,
      doc.margin.left, doc.y + 9,
      { font: 'bold', size: 10.5, fill: TINTA, align: 'right', width: doc.contentWidth }
    );
    doc.y += 14;

    const etiquetas = [projeto.projectCode, TIPO_COBRANCA[projeto.billingType]].filter(Boolean);
    if (etiquetas.length) {
      doc.drawText(etiquetas.join('   ·   '), doc.margin.left, doc.y + 8,
        { size: 7.5, fill: CINZA_CLARO });
      doc.y += 12;
    }
    doc.y += 6;

    doc.table({
      columns: colunasResumo(doc.contentWidth),
      rows: projeto.professionals.map((p) => ({
        profissional: p.userName,
        horas: fmt.minutesToHm(p.minutes),
        decimal: fmt.minutesToDecimalBr(p.minutes),
        taxa: fmt.centsToBrl(p.rateCents),
        valor: fmt.centsToBrl(p.valueCents),
      })),
      totals: [{
        profissional: 'Subtotal do projeto',
        horas: fmt.minutesToHm(projeto.minutes),
        decimal: fmt.minutesToDecimalBr(projeto.minutes),
        taxa: '',
        valor: fmt.centsToBrl(projeto.valueCents),
      }],
      zebra: '#fbfcfe',
    });
    doc.y += 18;

    if (detailed) {
      doc.ensureSpace(60);
      doc.drawText('Detalhamento das atividades', doc.margin.left, doc.y + 8,
        { font: 'bold', size: 8, fill: CINZA });
      doc.y += 14;

      const largura = doc.contentWidth;
      doc.table({
        columns: [
          { key: 'data', label: 'Data', width: largura * 0.115 },
          { key: 'profissional', label: 'Profissional', width: largura * 0.175 },
          { key: 'atividade', label: 'Atividade', width: largura * 0.455, wrap: true },
          { key: 'horas', label: 'Horas', width: largura * 0.10, align: 'right' },
          { key: 'valor', label: 'Valor', width: largura * 0.155, align: 'right' },
        ],
        rows: projeto.entries.map((e) => ({
          data: fmt.isoToBr(e.workDate),
          profissional: e.userName,
          atividade: e.description,
          horas: fmt.minutesToHm(e.minutes),
          valor: e.billable ? fmt.centsToBrl(e.valueCents) : '—',
        })),
        size: 7.6,
        zebra: '#fbfcfe',
      });
      doc.y += 20;
    }
  }

  /* Fecho */
  doc.ensureSpace(74);
  doc.y += 4;
  doc.rect(doc.margin.left, doc.y, doc.contentWidth, 56, { fill: '#f7f9fb' });
  doc.rect(doc.margin.left, doc.y, doc.contentWidth, 2.5, { fill: destaque });
  doc.drawText('TOTAL DO PERÍODO', doc.margin.left + 14, doc.y + 20,
    { font: 'bold', size: 7, fill: CINZA_CLARO });
  doc.drawText(`R$ ${fmt.centsToBrl(dados.totals.valueCents)}`, doc.margin.left + 14, doc.y + 43,
    { font: 'bold', size: 19, fill: destaque });
  doc.drawText(
    `${fmt.minutesToHm(dados.totals.minutes)} h lançadas · ` +
    `${fmt.minutesToHm(dados.totals.billableMinutes)} h faturáveis`,
    doc.margin.left, doc.y + 32,
    { size: 8, fill: CINZA, align: 'right', width: doc.contentWidth - 14 }
  );
  doc.drawText(`${dados.projects.length} projeto(s) · ${dados.totals.entries} atividade(s)`,
    doc.margin.left, doc.y + 44,
    { size: 8, fill: CINZA_CLARO, align: 'right', width: doc.contentWidth - 14 });
  doc.y += 56 + 16;

  const emissao = new Date(dados.generatedAt).toLocaleString('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  });
  doc.paragraph(
    `Emitido em ${emissao}${emitidoPor ? ` por ${emitidoPor}` : ''}.`,
    { size: 7.5, fill: CINZA_CLARO }
  );

  return doc.finish();
}

/** Nome de arquivo previsível, útil quando se emite um relatório por projeto. */
function fileName(dados, projectName) {
  const limpar = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 42);
  const partes = ['horas', limpar(dados.client.name)];
  if (projectName) partes.push(limpar(projectName));
  partes.push(dados.period.from, dados.period.to);
  return `${partes.filter(Boolean).join('_')}.pdf`;
}

module.exports = { build, fileName };
