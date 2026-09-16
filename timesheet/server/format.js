'use strict';

/** 90 → "1:30" */
function minutesToHm(minutes) {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** 90 → 1.5 (duas casas, como usado para multiplicar pelo valor/hora) */
const minutesToDecimal = (minutes) => Math.round((minutes / 60) * 100) / 100;

/** 90 → "1,50"; 840 → "14,00". Sempre duas casas, para as colunas alinharem. */
const minutesToDecimalBr = (minutes) => ((minutes || 0) / 60).toFixed(2).replace('.', ',');

/**
 * Valor de um lançamento. Trabalha em centavos e arredonda só no final,
 * evitando o acúmulo de centavos que aparece ao somar valores já arredondados.
 */
const entryValueCents = (minutes, rateCents) => Math.round((minutes * rateCents) / 60);

/** 125050 → "1.250,50" */
function centsToBrl(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${reais},${String(abs % 100).padStart(2, '0')}`;
}

/** 2026-09-16 → 16/09/2026 */
function isoToBr(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Escapa um campo CSV; prefixa fórmulas para impedir injeção em planilhas. */
function csvCell(value) {
  let v = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[";\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/**
 * CSV com separador ";" e BOM UTF-8 — é o que o Excel em português abre
 * corretamente com dois cliques, sem passar pelo assistente de importação.
 */
function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(';')];
  for (const row of rows) lines.push(row.map(csvCell).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = {
  minutesToHm, minutesToDecimal, minutesToDecimalBr, entryValueCents, centsToBrl,
  isoToBr, csvCell, toCsv,
};
