'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { PdfDocument } = require('../server/pdf/document');
const { parse: parseImage } = require('../server/pdf/image');
const enc = require('../server/pdf/encoding');

/* ---------------------------------------------------- validador estrutural */

/**
 * Lê o PDF de volta: confere a tabela de referências cruzadas, conta páginas e
 * extrai o texto dos fluxos de conteúdo. Serve de rede contra um gerador que
 * produz bytes plausíveis mas um arquivo que nenhum leitor abre.
 */
function inspect(buffer) {
  const texto = buffer.toString('latin1');
  assert.ok(texto.startsWith('%PDF-1.'), 'não começa com o cabeçalho %PDF');
  assert.ok(texto.trimEnd().endsWith('%%EOF'), 'não termina com %%EOF');

  const inicioXref = Number(/startxref\s+(\d+)/.exec(texto)[1]);
  assert.ok(texto.startsWith('xref', inicioXref), 'startxref não aponta para a tabela xref');

  // Cada deslocamento da xref precisa cair exatamente no início de um objeto.
  const corpoXref = texto.slice(inicioXref);
  const entradas = [...corpoXref.matchAll(/^(\d{10}) (\d{5}) n\s*$/gm)].map((m) => Number(m[1]));
  assert.ok(entradas.length > 0, 'xref sem entradas');
  entradas.forEach((offset, i) => {
    assert.match(texto.slice(offset, offset + 24), new RegExp(`^${i + 1} 0 obj`),
      `entrada ${i + 1} da xref aponta para fora do objeto`);
  });

  const paginas = [...texto.matchAll(/\/Type \/Page[^s]/g)].length;

  // Descomprime cada fluxo de conteúdo e junta o texto dos operadores Tj.
  let extraido = '';
  const re = /<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const inicio = m.index + m[0].length;
    const bruto = buffer.subarray(inicio, inicio + Number(m[1]));
    try {
      const fluxo = zlib.inflateSync(bruto).toString('latin1');
      for (const t of fluxo.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)) {
        extraido += t[1].replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
                        .replace(/\\(.)/g, '$1') + '\n';
      }
    } catch { /* fluxo de imagem, não de conteúdo */ }
  }
  return { paginas, texto: extraido, bytes: buffer.length };
}

/* ------------------------------------------------------------------ testes */

test('gera um PDF estruturalmente válido', () => {
  const doc = new PdfDocument();
  doc.drawText('Azeredo & Ugatti Advogados', 50, 80, { font: 'bold', size: 16 });
  const pdf = doc.finish();
  const info = inspect(pdf);
  assert.equal(info.paginas, 1);
  assert.match(info.texto, /Azeredo & Ugatti Advogados/);
});

test('preserva acentuação portuguesa no texto da página', () => {
  const doc = new PdfDocument();
  doc.drawText('Indústria São João — atuação jurídica (ação nº 1)', 40, 60);
  const info = inspect(doc.finish());
  assert.match(info.texto, /Indústria São João/);
  assert.match(info.texto, /atuação jurídica/);
  assert.match(info.texto, /\(ação nº 1\)/, 'parênteses precisam sair escapados e íntegros');
});

test('título do documento usa UTF-16, não a codificação da fonte', () => {
  const doc = new PdfDocument({ info: { title: 'Relatório — cliente' } });
  doc.drawText('x', 40, 40);
  const texto = doc.finish().toString('latin1');
  const hex = /\/Title <([0-9a-f]+)>/.exec(texto);
  assert.ok(hex, 'o título deveria ser uma string hexadecimal');
  const decodificado = Buffer.from(hex[1], 'hex').subarray(2).swap16().toString('utf16le');
  assert.equal(decodificado, 'Relatório — cliente');
});

test('tabela longa quebra em páginas e repete o cabeçalho', () => {
  const doc = new PdfDocument({
    footer: (d, i, total) => d.drawText(`Página ${i + 1} de ${total}`, 40, 800, { size: 8 }),
  });
  doc.table({
    columns: [
      { key: 'a', label: 'Profissional', width: 200 },
      { key: 'b', label: 'Horas', width: 80, align: 'right' },
    ],
    rows: Array.from({ length: 120 }, (_, i) => ({ a: `Profissional ${i + 1}`, b: `${i}:30` })),
  });
  const info = inspect(doc.finish());
  assert.ok(info.paginas >= 3, `esperava 3+ páginas, veio ${info.paginas}`);

  const cabecalhos = info.texto.split('\n').filter((l) => l === 'PROFISSIONAL').length;
  assert.equal(cabecalhos, info.paginas, 'o cabeçalho deve reaparecer em cada página');

  assert.match(info.texto, new RegExp(`Página 1 de ${info.paginas}`));
  assert.match(info.texto, new RegExp(`Página ${info.paginas} de ${info.paginas}`));
  assert.match(info.texto, /Profissional 120/, 'a última linha não pode ser perdida na quebra');
});

test('texto longo quebra por palavra dentro da largura pedida', () => {
  const linhas = enc.wrapText(
    'Elaboração de contestação e organização das provas documentais do processo.',
    'regular', 9, 140
  );
  assert.ok(linhas.length > 1);
  for (const linha of linhas) {
    assert.ok(enc.textWidth(linha, 'regular', 9) <= 140, `linha excede a largura: "${linha}"`);
  }
  assert.equal(linhas.join(' ').replace(/\s+/g, ' '),
    'Elaboração de contestação e organização das provas documentais do processo.');
});

test('palavra maior que a coluna é partida em vez de estourar', () => {
  const linhas = enc.wrapText('0001234-55.2026.5.02.0011-SP-TRT2', 'regular', 8, 40);
  assert.ok(linhas.length > 1);
  for (const linha of linhas) assert.ok(enc.textWidth(linha, 'regular', 8) <= 40);
});

test('incorpora PNG com transparência como imagem com máscara', () => {
  const png = pngRgba(6, 3);
  const img = parseImage(png);
  assert.equal(img.width, 6);
  assert.equal(img.height, 3);
  assert.equal(img.colorSpace, 'DeviceRGB');
  assert.ok(img.smask, 'PNG com alfa precisa gerar SMask');

  const doc = new PdfDocument();
  const desenhada = doc.image(png, 40, 40, { width: 120 });
  assert.equal(Math.round(desenhada.height), 60);   // preserva a proporção 2:1
  const pdf = doc.finish();
  const texto = pdf.toString('latin1');
  assert.match(texto, /\/Subtype \/Image/);
  assert.match(texto, /\/SMask \d+ 0 R/);
  inspect(pdf);   // continua válido com a imagem dentro
});

test('recusa formato de imagem que não saiba incorporar', () => {
  assert.throws(() => parseImage(Buffer.from('GIF89a...')), /não suportado/i);
  assert.throws(() => parseImage(Buffer.alloc(40)), /não suportado/i);
});

test('logotipo grande é reduzido para caber na caixa do timbrado', () => {
  const doc = new PdfDocument();
  const largo = doc.image(pngRgba(400, 100), 40, 30, { width: 128, height: 46 });
  assert.ok(largo.width <= 128.01 && largo.height <= 46.01,
    `imagem estourou a caixa: ${largo.width}x${largo.height}`);
  const alto = doc.image(pngRgba(100, 400), 40, 30, { width: 128, height: 46 });
  assert.ok(alto.width <= 128.01 && alto.height <= 46.01);
});

/** PNG RGBA sintético, com a primeira coluna transparente. */
function pngRgba(w, h) {
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
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const linhas = [];
  for (let y = 0; y < h; y++) {
    const l = Buffer.alloc(1 + w * 4);
    l[0] = y % 5;                       // exercita todos os filtros PNG (0..4)
    for (let x = 0; x < w; x++) {
      l[1 + x * 4] = (x * 7) & 255; l[2 + x * 4] = (y * 11) & 255;
      l[3 + x * 4] = 180; l[4 + x * 4] = x === 0 ? 0 : 255;
    }
    linhas.push(l);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(linhas))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
