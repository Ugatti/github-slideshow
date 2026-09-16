'use strict';
/**
 * Prepara um logotipo PNG ou JPEG para virar um XObject de imagem no PDF.
 *
 * JPEG entra intacto (o PDF entende DCTDecode nativamente). PNG é
 * descomprimido, tem os filtros de linha desfeitos e é recomprimido como RGB;
 * havendo transparência, o canal alfa vira uma máscara suave (SMask), para que
 * um logotipo com fundo transparente não apareça sobre um retângulo preto.
 */
const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parse(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return parsePng(buffer);
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return parseJpeg(buffer);
  throw new Error('Formato de imagem não suportado. Use PNG ou JPEG.');
}

/* ------------------------------------------------------------------- JPEG */

function parseJpeg(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('JPEG inválido.');
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);

    // SOF0..SOF15, exceto os marcadores que não carregam dimensões.
    if (marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      const components = buffer[offset + 9];
      const space = components === 1 ? 'DeviceGray' : components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
      return { width, height, colorSpace: space, filter: 'DCTDecode', data: buffer, smask: null };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG sem cabeçalho de dimensões.');
}

/* -------------------------------------------------------------------- PNG */

function parsePng(buffer) {
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') transparency = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;

    offset += 12 + length;
  }

  if (!header) throw new Error('PNG sem cabeçalho IHDR.');
  if (header.interlace !== 0) throw new Error('PNG entrelaçado não é suportado. Salve sem "interlaced".');
  if (![8, 16].includes(header.bitDepth) && header.colorType !== 3) {
    throw new Error('PNG deve ter 8 bits por canal.');
  }

  const { width, height, bitDepth, colorType } = header;
  const canaisPorTipo = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const canais = canaisPorTipo[colorType];
  if (!canais) throw new Error(`Tipo de cor PNG ${colorType} não suportado.`);

  const bits = colorType === 3 ? bitDepth : bitDepth;
  const bytesPorPixel = Math.max(1, Math.ceil((canais * bits) / 8));
  const bytesPorLinha = Math.ceil((width * canais * bits) / 8);

  const bruto = zlib.inflateSync(Buffer.concat(idat));
  const pixels = unfilter(bruto, height, bytesPorLinha, bytesPorPixel);

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height);
  let temAlfa = false;

  const amostra = (linha, indice) => {
    if (bits === 16) return pixels[linha * bytesPorLinha + indice * 2];   // descarta o byte baixo
    return pixels[linha * bytesPorLinha + indice];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r, g, b, a = 255;
      if (colorType === 0) { r = g = b = amostra(y, x); }
      else if (colorType === 4) { r = g = b = amostra(y, x * 2); a = amostra(y, x * 2 + 1); }
      else if (colorType === 2) {
        r = amostra(y, x * 3); g = amostra(y, x * 3 + 1); b = amostra(y, x * 3 + 2);
      } else if (colorType === 6) {
        r = amostra(y, x * 4); g = amostra(y, x * 4 + 1);
        b = amostra(y, x * 4 + 2); a = amostra(y, x * 4 + 3);
      } else if (colorType === 3) {
        const indice = lerIndicePaleta(pixels, y, x, bytesPorLinha, bitDepth);
        r = palette[indice * 3]; g = palette[indice * 3 + 1]; b = palette[indice * 3 + 2];
        if (transparency && indice < transparency.length) a = transparency[indice];
      }
      const p = (y * width + x) * 3;
      rgb[p] = r; rgb[p + 1] = g; rgb[p + 2] = b;
      alpha[y * width + x] = a;
      if (a !== 255) temAlfa = true;
    }
  }

  return {
    width, height, colorSpace: 'DeviceRGB', filter: 'FlateDecode',
    data: zlib.deflateSync(rgb, { level: 9 }),
    smask: temAlfa ? zlib.deflateSync(alpha, { level: 9 }) : null,
  };
}

function lerIndicePaleta(pixels, linha, x, bytesPorLinha, bitDepth) {
  if (bitDepth === 8) return pixels[linha * bytesPorLinha + x];
  const porByte = 8 / bitDepth;
  const byte = pixels[linha * bytesPorLinha + Math.floor(x / porByte)];
  const deslocamento = (porByte - 1 - (x % porByte)) * bitDepth;
  return (byte >> deslocamento) & ((1 << bitDepth) - 1);
}

/** Desfaz os filtros por linha do PNG (tipos 0 a 4). */
function unfilter(bruto, height, bytesPorLinha, bpp) {
  const saida = Buffer.alloc(height * bytesPorLinha);
  let origem = 0;

  for (let y = 0; y < height; y++) {
    const filtro = bruto[origem++];
    const linha = y * bytesPorLinha;
    const anterior = linha - bytesPorLinha;

    for (let i = 0; i < bytesPorLinha; i++) {
      const x = bruto[origem + i];
      const a = i >= bpp ? saida[linha + i - bpp] : 0;         // pixel à esquerda
      const b = y > 0 ? saida[anterior + i] : 0;                // pixel acima
      const c = y > 0 && i >= bpp ? saida[anterior + i - bpp] : 0;  // diagonal

      let valor;
      switch (filtro) {
        case 0: valor = x; break;
        case 1: valor = x + a; break;
        case 2: valor = x + b; break;
        case 3: valor = x + ((a + b) >> 1); break;
        case 4: valor = x + paeth(a, b, c); break;
        default: throw new Error(`Filtro PNG desconhecido: ${filtro}`);
      }
      saida[linha + i] = valor & 0xff;
    }
    origem += bytesPorLinha;
  }
  return saida;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

module.exports = { parse };
