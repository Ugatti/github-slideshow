'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../server/validate');
const fmt = require('../server/format');

test('duração aceita os formatos usados no dia a dia', () => {
  const casos = [
    ['90', 90], ['1:30', 90], ['1h30', 90], ['1h30m', 90], ['1,5', 90], ['1.5', 90],
    ['2h', 120], ['2:00', 120], ['0:45', 45], ['0,25', 15], ['8', 8], ['480', 480],
  ];
  for (const [entrada, esperado] of casos) {
    assert.equal(v.duration(entrada), esperado, `"${entrada}" deveria virar ${esperado} min`);
  }
});

test('duração rejeita entradas inválidas', () => {
  for (const ruim of ['', '0', '-30', 'uma hora', '1:75', '25:00', 'abc', '1441']) {
    assert.throws(() => v.duration(ruim), /obrigatório|inválid|zero|exceder|Minutos/i, `aceitou "${ruim}"`);
  }
});

test('valores monetários aceitam formato brasileiro e viram centavos', () => {
  assert.equal(v.money('1.250,50', 'v'), 125050);
  assert.equal(v.money('1250.50', 'v'), 125050);
  assert.equal(v.money('R$ 450,00', 'v'), 45000);
  assert.equal(v.money('300', 'v'), 30000);
  assert.equal(v.money('0', 'v'), 0);
  assert.equal(v.money('', 'v', { required: false }), null);
  assert.throws(() => v.money('-10', 'v'), /válido/);
});

test('o valor de um lançamento arredonda só no final', () => {
  // 20 min a R$ 333,33/h: arredondar a hora antes produziria erro de centavos
  assert.equal(fmt.entryValueCents(20, 33333), 11111);
  assert.equal(fmt.entryValueCents(90, 45000), 67500);
  assert.equal(fmt.entryValueCents(1, 45000), 750);

  // Três lançamentos de 20 min somam o mesmo que um de 60 min, sem sobra
  const tres = 3 * fmt.entryValueCents(20, 30000);
  assert.equal(tres, fmt.entryValueCents(60, 30000));
});

test('CPF e CNPJ são normalizados para dígitos', () => {
  assert.equal(v.document('12.345.678/0001-95'), '12345678000195');
  assert.equal(v.document('123.456.789-09'), '12345678909');
  assert.equal(v.document('', 'doc', { required: false }), null);
  assert.throws(() => v.document('123'), /11 dígitos|14 dígitos/);
});

test('datas exigem AAAA-MM-DD e precisam existir no calendário', () => {
  assert.equal(v.isoDate('2026-02-28', 'd'), '2026-02-28');
  assert.throws(() => v.isoDate('28/02/2026', 'd'), /AAAA-MM-DD/);
  assert.throws(() => v.isoDate('2026-02-30', 'd'), /não é uma data válida/);
  assert.throws(() => v.isoDate('2026-13-01', 'd'), /não é uma data válida/);
});

test('senha exige 10 caracteres com letras e números', () => {
  assert.equal(v.password('SenhaForte123'), 'SenhaForte123');
  assert.throws(() => v.password('curta1'), /ao menos 10|caracteres/);
  assert.throws(() => v.password('somenteletras'), /letras e números/);
});

test('CSV neutraliza fórmulas e escapa o separador', () => {
  const csv = fmt.toCsv(['a', 'b'], [['=SOMA(A1:A9)', 'texto; com ponto-e-vírgula']]);
  assert.ok(csv.startsWith('﻿'), 'faltou o BOM que o Excel usa para detectar UTF-8');
  assert.ok(csv.includes("'=SOMA(A1:A9)"), 'fórmula não foi neutralizada');
  assert.ok(csv.includes('"texto; com ponto-e-vírgula"'), 'campo com separador não foi escapado');
});

test('formatação pt-BR de horas e valores', () => {
  assert.equal(fmt.minutesToHm(90), '1:30');
  assert.equal(fmt.minutesToHm(605), '10:05');
  assert.equal(fmt.minutesToDecimal(90), 1.5);
  assert.equal(fmt.centsToBrl(125050), '1.250,50');
  assert.equal(fmt.centsToBrl(1234567890), '12.345.678,90');
  assert.equal(fmt.centsToBrl(5), '0,05');
  assert.equal(fmt.isoToBr('2026-09-16'), '16/09/2026');
});
