'use strict';
/**
 * Escritor de PDF mínimo, sem dependências externas.
 *
 * Cobre o necessário para relatórios: texto com as fontes padrão, linhas,
 * retângulos, imagens e tabelas com quebra automática de página. As coordenadas
 * expostas contam a partir do TOPO da página (o PDF conta de baixo), porque
 * relatório se escreve de cima para baixo.
 */
const zlib = require('node:zlib');
const { textWidth, encodeText, wrapText, ellipsize } = require('./encoding');
const { parse: parseImage } = require('./image');

const A4 = { width: 595.28, height: 841.89 };

const FONT_RESOURCE = { regular: 'F1', bold: 'F2', italic: 'F3' };
const FONT_BASE = {
  regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique',
};

/** '#1f4066' → '0.121 0.251 0.400' (espaço de cor RGB do PDF) */
function color(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#000000'));
  const n = parseInt(m ? m[1] : '000000', 16);
  const c = (v) => (v / 255).toFixed(3);
  return `${c((n >> 16) & 255)} ${c((n >> 8) & 255)} ${c(n & 255)}`;
}

const num = (v) => (Math.round(v * 100) / 100).toString();

class PdfDocument {
  /**
   * @param {object} options
   * @param {{top,right,bottom,left}} [options.margin]
   * @param {Function} [options.header] chamado ao abrir cada página: (doc, pageIndex)
   * @param {Function} [options.footer] chamado ao finalizar: (doc, pageIndex, totalPages)
   * @param {object} [options.info] metadados (title, author, subject)
   */
  constructor(options = {}) {
    this.size = options.size || A4;
    this.margin = { top: 56, right: 48, bottom: 56, left: 48, ...(options.margin || {}) };
    this.headerFn = options.header || null;
    this.footerFn = options.footer || null;
    this.info = options.info || {};
    this.pages = [];
    this.images = new Map();      // chave → {id, ...dadosDaImagem}
    this.y = 0;
    this.addPage();
  }

  get contentWidth() {
    return this.size.width - this.margin.left - this.margin.right;
  }

  get bottomLimit() {
    return this.size.height - this.margin.bottom;
  }

  /* -------------------------------------------------------------- páginas */

  addPage() {
    this.current = { ops: [] };
    this.pages.push(this.current);
    this.y = this.margin.top;
    if (this.headerFn) this.headerFn(this, this.pages.length - 1);
    return this;
  }

  /** Abre nova página se não couberem `altura` pontos na atual. */
  ensureSpace(altura) {
    if (this.y + altura > this.bottomLimit) this.addPage();
    return this;
  }

  op(texto) {
    this.current.ops.push(texto);
    return this;
  }

  /* ---------------------------------------------------------------- texto */

  /**
   * Escreve uma linha de texto. `y` conta a partir do topo e refere-se à
   * BASE da linha (baseline). Não move o cursor.
   */
  drawText(texto, x, y, opcoes = {}) {
    const { font = 'regular', size = 10, fill = '#000000', align = 'left', width = 0 } = opcoes;
    let conteudo = String(texto ?? '');
    if (width && align !== 'left') conteudo = ellipsize(conteudo, font, size, width);

    let posX = x;
    if (width) {
      const largura = textWidth(conteudo, font, size);
      if (align === 'right') posX = x + width - largura;
      else if (align === 'center') posX = x + (width - largura) / 2;
    }

    this.op(`BT ${color(fill)} rg /${FONT_RESOURCE[font]} ${num(size)} Tf ` +
            `${num(posX)} ${num(this.size.height - y)} Td ` +
            `(${encodeText(conteudo).toString('latin1')}) Tj ET`);
    return this;
  }

  /**
   * Escreve um parágrafo com quebra automática a partir do cursor, e avança o
   * cursor. Retorna a altura consumida.
   */
  paragraph(texto, opcoes = {}) {
    const {
      font = 'regular', size = 10, fill = '#000000', lineHeight = 1.35,
      width = this.contentWidth, x = this.margin.left, align = 'left', spaceAfter = 0,
    } = opcoes;

    const alturaLinha = size * lineHeight;
    const linhas = wrapText(texto, font, size, width);
    for (const linha of linhas) {
      this.ensureSpace(alturaLinha);
      this.drawText(linha, x, this.y + size, { font, size, fill, align, width });
      this.y += alturaLinha;
    }
    this.y += spaceAfter;
    return alturaLinha * linhas.length + spaceAfter;
  }

  /* -------------------------------------------------------------- formas */

  line(x1, y1, x2, y2, opcoes = {}) {
    const { stroke = '#000000', width = 0.5, dash = null } = opcoes;
    const h = this.size.height;
    this.op(
      `q ${color(stroke)} RG ${num(width)} w ` +
      (dash ? `[${dash.join(' ')}] 0 d ` : '') +
      `${num(x1)} ${num(h - y1)} m ${num(x2)} ${num(h - y2)} l S Q`
    );
    return this;
  }

  rect(x, y, largura, altura, opcoes = {}) {
    const { fill = null, stroke = null, lineWidth = 0.5 } = opcoes;
    if (!fill && !stroke) return this;
    const h = this.size.height;
    const pintura = fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.op(
      `q ${fill ? `${color(fill)} rg ` : ''}${stroke ? `${color(stroke)} RG ${num(lineWidth)} w ` : ''}` +
      `${num(x)} ${num(h - y - altura)} ${num(largura)} ${num(altura)} re ${pintura} Q`
    );
    return this;
  }

  /* -------------------------------------------------------------- imagem */

  /** Registra a imagem (uma vez) e a desenha. Devolve as dimensões usadas. */
  image(buffer, x, y, opcoes = {}) {
    const chave = buffer.length + ':' + buffer.subarray(0, 24).toString('hex');
    let img = this.images.get(chave);
    if (!img) {
      img = { ...parseImage(buffer), nome: `Im${this.images.size + 1}` };
      this.images.set(chave, img);
    }

    // Encaixa dentro da caixa pedida preservando a proporção.
    const proporcao = img.width / img.height;
    let largura = opcoes.width || 0;
    let altura = opcoes.height || 0;
    if (largura && !altura) altura = largura / proporcao;
    else if (altura && !largura) largura = altura * proporcao;
    else if (largura && altura) {
      // Encaixa dentro da caixa informada, sem distorcer.
      if (largura / altura > proporcao) largura = altura * proporcao;
      else altura = largura / proporcao;
    } else { largura = img.width; altura = img.height; }

    const h = this.size.height;
    this.op(`q ${num(largura)} 0 0 ${num(altura)} ${num(x)} ${num(h - y - altura)} cm /${img.nome} Do Q`);
    return { width: largura, height: altura };
  }

  /* -------------------------------------------------------------- tabela */

  /**
   * Desenha uma tabela com cabeçalho repetido a cada página.
   * @param {object} spec
   * @param {Array<{key,label,width,align,font}>} spec.columns larguras em pontos
   * @param {Array<object>} spec.rows
   * @param {Array<object>} [spec.totals] linha(s) de total ao final
   */
  table(spec) {
    const {
      columns, rows, totals = null,
      size = 8.5, headerSize = 7.5, padding = 5, lineHeight = 1.25,
      headerFill = '#f1f4f8', headerText = '#55616e',
      rowLine = '#e3e9ef', text = '#16202b', zebra = null,
      x = this.margin.left,
    } = spec;

    const desenhaCabecalho = () => {
      const altura = headerSize * 1.4 + padding * 2 - 4;
      this.ensureSpace(altura + 14);
      this.rect(x, this.y, columns.reduce((s, c) => s + c.width, 0), altura, { fill: headerFill });
      let cx = x;
      for (const col of columns) {
        this.drawText(String(col.label).toUpperCase(), cx + padding, this.y + altura - padding - 1, {
          font: 'bold', size: headerSize, fill: headerText,
          align: col.align || 'left', width: col.width - padding * 2,
        });
        cx += col.width;
      }
      this.y += altura;
    };

    desenhaCabecalho();

    let indice = 0;
    for (const linha of rows) {
      // Altura da linha: a coluna que quebrar em mais linhas manda.
      const celulas = columns.map((col) => {
        const valor = linha[col.key] ?? '';
        return col.wrap
          ? wrapText(valor, col.font || 'regular', size, col.width - padding * 2)
          : [ellipsize(valor, col.font || 'regular', size, col.width - padding * 2)];
      });
      const linhasTexto = Math.max(...celulas.map((c) => c.length));
      const altura = linhasTexto * size * lineHeight + padding * 2 - 3;

      if (this.y + altura > this.bottomLimit) {
        this.addPage();
        desenhaCabecalho();
      }

      if (zebra && indice % 2 === 1) {
        this.rect(x, this.y, columns.reduce((s, c) => s + c.width, 0), altura, { fill: zebra });
      }

      let cx = x;
      columns.forEach((col, i) => {
        celulas[i].forEach((pedaco, j) => {
          this.drawText(pedaco, cx + padding, this.y + padding + size + j * size * lineHeight - 1, {
            font: col.font || 'regular', size, fill: col.fill || text,
            align: col.align || 'left', width: col.width - padding * 2,
          });
        });
        cx += col.width;
      });

      this.y += altura;
      this.line(x, this.y, x + columns.reduce((s, c) => s + c.width, 0), this.y,
                { stroke: rowLine, width: 0.4 });
      indice++;
    }

    if (totals) {
      for (const total of totals) {
        const altura = size * lineHeight + padding * 2 - 2;
        this.ensureSpace(altura);
        const largura = columns.reduce((s, c) => s + c.width, 0);
        this.rect(x, this.y, largura, altura, { fill: headerFill });
        this.line(x, this.y, x + largura, this.y, { stroke: headerText, width: 0.8 });
        let cx = x;
        for (const col of columns) {
          this.drawText(total[col.key] ?? '', cx + padding, this.y + padding + size - 1, {
            font: 'bold', size, fill: text, align: col.align || 'left', width: col.width - padding * 2,
          });
          cx += col.width;
        }
        this.y += altura;
      }
    }
    return this;
  }

  /* ---------------------------------------------------------- serialização */

  /** Escreve os rodapés (que dependem do total de páginas) e serializa. */
  finish() {
    if (this.footerFn) {
      const total = this.pages.length;
      const anterior = this.current;
      this.pages.forEach((pagina, indice) => {
        this.current = pagina;
        this.footerFn(this, indice, total);
      });
      this.current = anterior;
    }
    return this.serialize();
  }

  serialize() {
    const objetos = [];                       // objetos[n] = Buffer do corpo
    const add = (corpo) => {
      objetos.push(Buffer.isBuffer(corpo) ? corpo : Buffer.from(String(corpo), 'latin1'));
      return objetos.length;                  // numeração começa em 1
    };

    // Reserva: 1 catálogo, 2 páginas. Os demais são alocados na ordem.
    const idCatalogo = add('');
    const idPaginas = add('');

    const idsFonte = {};
    for (const [chave, base] of Object.entries(FONT_BASE)) {
      idsFonte[chave] = add(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`
      );
    }

    const idsImagem = {};
    for (const img of this.images.values()) {
      let idSMask = null;
      if (img.smask) {
        idSMask = add(Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
            `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode ` +
            `/Length ${img.smask.length} >>\nstream\n`, 'latin1'),
          img.smask, Buffer.from('\nendstream', 'latin1'),
        ]));
      }
      idsImagem[img.nome] = add(Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
          `/ColorSpace /${img.colorSpace} /BitsPerComponent 8 /Filter /${img.filter} ` +
          (idSMask ? `/SMask ${idSMask} 0 R ` : '') +
          `/Length ${img.data.length} >>\nstream\n`, 'latin1'),
        img.data, Buffer.from('\nendstream', 'latin1'),
      ]));
    }

    const recursos =
      `<< /Font << ${Object.entries(idsFonte)
        .map(([k, id]) => `/${FONT_RESOURCE[k]} ${id} 0 R`).join(' ')} >>` +
      (Object.keys(idsImagem).length
        ? ` /XObject << ${Object.entries(idsImagem).map(([n, id]) => `/${n} ${id} 0 R`).join(' ')} >>`
        : '') + ' >>';

    const idsPagina = [];
    for (const pagina of this.pages) {
      const fluxo = zlib.deflateSync(
        Buffer.from(pagina.ops.join('\n'), 'latin1'), { level: 9 }
      );
      const idConteudo = add(Buffer.concat([
        Buffer.from(`<< /Length ${fluxo.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
        fluxo, Buffer.from('\nendstream', 'latin1'),
      ]));
      idsPagina.push(add(
        `<< /Type /Page /Parent ${idPaginas} 0 R ` +
        `/MediaBox [0 0 ${num(this.size.width)} ${num(this.size.height)}] ` +
        `/Resources ${recursos} /Contents ${idConteudo} 0 R >>`
      ));
    }

    /**
     * Strings do dicionário Info não usam a codificação da fonte: o leitor as
     * interpreta como PDFDocEncoding, onde 0x97 não é travessão. UTF-16BE com
     * BOM, em hexadecimal, é o formato que qualquer leitor entende.
     */
    const literal = (texto) => {
      const bytes = [0xfe, 0xff];
      for (const ch of String(texto)) {
        const ponto = ch.codePointAt(0);
        if (ponto > 0xffff) {                       // par substituto
          const v = ponto - 0x10000;
          const alto = 0xd800 + (v >> 10), baixo = 0xdc00 + (v & 0x3ff);
          bytes.push(alto >> 8, alto & 0xff, baixo >> 8, baixo & 0xff);
        } else {
          bytes.push(ponto >> 8, ponto & 0xff);
        }
      }
      return `<${Buffer.from(bytes).toString('hex')}>`;
    };
    const agora = new Date();
    const carimbo = 'D:' + [
      agora.getUTCFullYear(), agora.getUTCMonth() + 1, agora.getUTCDate(),
      agora.getUTCHours(), agora.getUTCMinutes(), agora.getUTCSeconds(),
    ].map((v, i) => String(v).padStart(i === 0 ? 4 : 2, '0')).join('') + 'Z';

    const idInfo = add(
      `<< ${this.info.title ? `/Title ${literal(this.info.title)} ` : ''}` +
      `${this.info.author ? `/Author ${literal(this.info.author)} ` : ''}` +
      `${this.info.subject ? `/Subject ${literal(this.info.subject)} ` : ''}` +
      `/Producer ${literal('Timesheet (sistema proprietário)')} /CreationDate (${carimbo}) >>`
    );

    objetos[idCatalogo - 1] = Buffer.from(
      `<< /Type /Catalog /Pages ${idPaginas} 0 R >>`, 'latin1');
    objetos[idPaginas - 1] = Buffer.from(
      `<< /Type /Pages /Kids [${idsPagina.map((id) => `${id} 0 R`).join(' ')}] ` +
      `/Count ${idsPagina.length} >>`, 'latin1');

    /* Montagem final com tabela de referências cruzadas. */
    const partes = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let posicao = partes[0].length;
    const deslocamentos = [];

    objetos.forEach((corpo, i) => {
      deslocamentos[i + 1] = posicao;
      const bloco = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), corpo, Buffer.from('\nendobj\n', 'latin1'),
      ]);
      partes.push(bloco);
      posicao += bloco.length;
    });

    const inicioXref = posicao;
    let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objetos.length; i++) {
      xref += `${String(deslocamentos[i]).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R ` +
            `/Info ${idInfo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
    partes.push(Buffer.from(xref, 'latin1'));

    return Buffer.concat(partes);
  }
}

module.exports = { PdfDocument, A4, color };
