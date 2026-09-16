'use strict';
/**
 * Codificação WinAnsi (CP1252) e larguras das fontes padrão do PDF.
 *
 * As 14 fontes padrão do PDF (Helvetica entre elas) dispensam incorporação do
 * arquivo da fonte: o leitor já as possui. Em troca, é preciso converter o texto
 * para WinAnsi e conhecer as larguras dos glifos para alinhar e quebrar linhas.
 */

/* Larguras de Helvetica para os códigos 32..126, na ordem. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/**
 * Nas fontes padrão da Adobe, um glifo acentuado tem exatamente a mesma largura
 * do seu caractere-base — "á" ocupa o mesmo que "a". Dobrar os acentos sobre a
 * base evita carregar uma tabela de 256 larguras por fonte.
 */
const FOLD = {
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A', 'Å': 'A',
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a',
  'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
  'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'U', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
  'Ç': 'C', 'ç': 'c', 'Ñ': 'N', 'ñ': 'n', 'Ý': 'Y', 'ý': 'y', 'ÿ': 'y',
};

/* Caracteres fora do ASCII que aparecem em texto em português, com código
   WinAnsi e a largura a usar (mesma escala de 1000 unidades por em). */
const EXTRA = {
  '€': [0x80, 556], '‚': [0x82, 222], 'ƒ': [0x83, 556],
  '„': [0x84, 333], '…': [0x85, 1000], '†': [0x86, 556],
  '‡': [0x87, 556], 'ˆ': [0x88, 333], '‰': [0x89, 1000],
  '‘': [0x91, 222], '’': [0x92, 222], '“': [0x93, 333],
  '”': [0x94, 333], '•': [0x95, 350], '–': [0x96, 556],
  '—': [0x97, 1000], '™': [0x99, 1000],
  ' ': [0xA0, 278], 'ª': [0xAA, 370], '«': [0xAB, 556],
  '°': [0xB0, 400], '²': [0xB2, 333], '³': [0xB3, 333],
  '·': [0xB7, 278], 'º': [0xBA, 365], '»': [0xBB, 556],
  '§': [0xA7, 556], '©': [0xA9, 737], '®': [0xAE, 737],
  '±': [0xB1, 584], '¼': [0xBC, 834], '½': [0xBD, 834],
  '£': [0xA3, 556], '¥': [0xA5, 556], '¢': [0xA2, 556],
};

const TABLES = { regular: HELVETICA, bold: HELVETICA_BOLD, italic: HELVETICA };

/** Largura de um caractere em milésimos de em, para a fonte dada. */
function charWidth(ch, font) {
  const table = TABLES[font] || HELVETICA;
  const folded = FOLD[ch] || ch;
  const code = folded.charCodeAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  if (EXTRA[ch]) return EXTRA[ch][1];
  return table[0];
}

/** Largura de um texto, em pontos. */
function textWidth(text, font, size) {
  let total = 0;
  for (const ch of String(text)) total += charWidth(ch, font);
  return (total * size) / 1000;
}

/**
 * Converte a string para bytes WinAnsi já escapados como literal PDF.
 * Caracteres sem representação viram "?" — melhor do que um PDF corrompido.
 */
function encodeText(text) {
  const out = [];
  for (const ch of String(text)) {
    const point = ch.codePointAt(0);
    let code;
    if (point >= 32 && point <= 126) code = point;
    else if (EXTRA[ch]) code = EXTRA[ch][0];
    else if (point >= 0xA0 && point <= 0xFF) code = point;
    else if (FOLD[ch]) code = FOLD[ch].charCodeAt(0);
    else if (ch === '\t') code = 32;
    else code = 63;                                    // '?'

    if (code === 0x28 || code === 0x29 || code === 0x5C) {
      out.push(0x5C, code);                            // escapa ( ) \
    } else if (code < 32 || code > 126) {
      for (const d of '\\' + code.toString(8).padStart(3, '0')) out.push(d.charCodeAt(0));
    } else {
      out.push(code);
    }
  }
  return Buffer.from(out);
}

/** Quebra o texto em linhas que caibam em `maxWidth`, quebrando por palavra. */
function wrapText(text, font, size, maxWidth) {
  const linhas = [];
  for (const paragrafo of String(text).split(/\r?\n/)) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    if (!palavras.length) { linhas.push(''); continue; }

    let atual = '';
    for (const palavra of palavras) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (textWidth(tentativa, font, size) <= maxWidth) { atual = tentativa; continue; }
      if (atual) linhas.push(atual);

      if (textWidth(palavra, font, size) > maxWidth) {
        // Palavra sozinha maior que a coluna: parte no meio para não estourar.
        let pedaco = '';
        for (const ch of palavra) {
          if (textWidth(pedaco + ch, font, size) > maxWidth && pedaco) {
            linhas.push(pedaco);
            pedaco = ch;
          } else {
            pedaco += ch;
          }
        }
        atual = pedaco;
      } else {
        atual = palavra;
      }
    }
    if (atual) linhas.push(atual);
  }
  return linhas;
}

/** Corta o texto com reticências se exceder a largura. */
function ellipsize(text, font, size, maxWidth) {
  const s = String(text);
  if (textWidth(s, font, size) <= maxWidth) return s;
  let out = '';
  for (const ch of s) {
    if (textWidth(`${out}${ch}…`, font, size) > maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}

module.exports = { textWidth, encodeText, wrapText, ellipsize, charWidth };
