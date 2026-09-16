'use strict';
const { badRequest } = require('./errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DURATION_RE = /^(\d{1,3})[:h](\d{1,2})?m?$/i;  // 1:30, 1h30, 1h30m, 2h
const DECIMAL_RE = /^\d{1,3}([.,]\d{1,2})?$/;        // 1,5  1.75  8

function str(value, field, { required = true, max = 500, min = 1 } = {}) {
  const v = value === undefined || value === null ? '' : String(value).trim();
  if (!v) {
    if (required) throw badRequest(`O campo "${field}" é obrigatório.`);
    return null;
  }
  if (v.length < min) throw badRequest(`"${field}" deve ter ao menos ${min} caracteres.`);
  if (v.length > max) throw badRequest(`"${field}" excede ${max} caracteres.`);
  return v;
}

function email(value, field = 'e-mail', { required = true } = {}) {
  const v = str(value, field, { required, max: 200 });
  if (v === null) return null;
  if (!EMAIL_RE.test(v)) throw badRequest(`"${field}" não é um e-mail válido.`);
  return v.toLowerCase();
}

function int(value, field, { required = true, min = null, max = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`O campo "${field}" é obrigatório.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`"${field}" deve ser um número inteiro.`);
  if (min !== null && n < min) throw badRequest(`"${field}" deve ser no mínimo ${min}.`);
  if (max !== null && n > max) throw badRequest(`"${field}" deve ser no máximo ${max}.`);
  return n;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|sim|on)$/i.test(String(value));
}

function isoDate(value, field, { required = true } = {}) {
  const v = str(value, field, { required, max: 10 });
  if (v === null) return null;
  if (!DATE_RE.test(v)) throw badRequest(`"${field}" deve estar no formato AAAA-MM-DD.`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw badRequest(`"${field}" não é uma data válida.`);
  }
  return v;
}

function oneOf(value, field, allowed, { required = true, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`O campo "${field}" é obrigatório.`);
    return fallback;
  }
  const v = String(value);
  if (!allowed.includes(v)) {
    throw badRequest(`"${field}" deve ser um de: ${allowed.join(', ')}.`);
  }
  return v;
}

/**
 * Aceita duração como minutos (número), "1:30"/"1h30" ou decimal "1,5".
 * Retorna minutos inteiros. Decimais são arredondados ao minuto mais próximo.
 */
function duration(value, field = 'duração', { max = 1440 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw badRequest(`O campo "${field}" é obrigatório.`);
  }
  const raw = String(value).trim();
  let minutes;

  const hhmm = raw.match(DURATION_RE);
  if (hhmm) {
    const mins = Number(hhmm[2] ?? 0);
    if (mins > 59) throw badRequest(`Minutos inválidos em "${raw}".`);
    minutes = Number(hhmm[1]) * 60 + mins;
  } else if (/^\d+$/.test(raw)) {
    minutes = Number(raw);
  } else if (DECIMAL_RE.test(raw)) {
    minutes = Math.round(Number(raw.replace(',', '.')) * 60);
  } else {
    throw badRequest(`"${field}" inválida. Use minutos (90), h:mm (1:30) ou decimal (1,5).`);
  }

  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw badRequest(`"${field}" deve ser maior que zero.`);
  }
  if (minutes > max) throw badRequest(`"${field}" não pode exceder ${max / 60} horas em um lançamento.`);
  return minutes;
}

/** Aceita "1.250,00", "1250.00", 1250 → centavos inteiros. */
function money(value, field, { required = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw badRequest(`O campo "${field}" é obrigatório.`);
    return null;
  }
  let raw = String(value).trim().replace(/[R$\s]/g, '');
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`"${field}" deve ser um valor monetário válido.`);
  return Math.round(n * 100);
}

/** Mantém apenas dígitos de CPF/CNPJ; valida o comprimento quando informado. */
function document(value, field = 'CPF/CNPJ', { required = false } = {}) {
  const v = str(value, field, { required, max: 30 });
  if (v === null) return null;
  const digits = v.replace(/\D/g, '');
  if (digits.length !== 11 && digits.length !== 14) {
    throw badRequest(`"${field}" deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ).`);
  }
  return digits;
}

function password(value, field = 'senha') {
  const v = str(value, field, { max: 200, min: 10 });
  if (!/[a-zA-Z]/.test(v) || !/\d/.test(v)) {
    throw badRequest('A senha deve ter ao menos 10 caracteres, incluindo letras e números.');
  }
  return v;
}

module.exports = { str, email, int, bool, isoDate, oneOf, duration, money, document, password };
