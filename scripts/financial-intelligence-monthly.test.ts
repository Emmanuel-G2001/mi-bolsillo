// Unitarias con node:test y tsx. Requieren Node 22 y las dependencias instaladas.
// Convención: scripts/<funcionalidad>.test.ts. Suite completa desde la raíz:
// node --import tsx --test scripts/*.test.ts
// Usa datos sintéticos y no requiere variables de entorno ni PostgreSQL.
import assert from "node:assert/strict";
import { test } from "node:test";

import { renderMonthlyMovementsCsv } from "../features/finance/monthly-movements.csv";
import {
  formatMovementInsights,
  parseMovementMonth,
} from "../features/finance/monthly-movements";

const header = "\uFEFFFecha;Tipo;Categoría;Descripción;Importe\r\n";
const movement = {
  date: "2024-02-29",
  type: "expense" as const,
  category: null,
  description: "Compra de prueba",
  amount: "123456789012.01",
};

test("I1-02: los límites civiles conservan febrero bisiesto, el cambio anual y los años extremos", () => {
  for (const [month, end] of [
    ["2024-02", "2024-03-01"],
    ["2026-12", "2027-01-01"],
    ["0100-01", "0100-02-01"],
    ["0999-12", "1000-01-01"],
    ["9999-12", "10000-01-01"],
  ]) {
    assert.deepEqual(parseMovementMonth(new URLSearchParams({ month })), {
      month,
      start: `${month}-01`,
      end,
    });
  }
});

test("I1-03: el mes es obligatorio, único, canónico y está dentro del rango", () => {
  for (const query of [
    "", "month=", "month=2024-2", "month=2024-13", "month=2024-00",
    "month=0099-12", "month=10000-01", "month=2024-02%0A",
    "month=2024-02&month=2024-02", "month=2024-02&month=2024-03",
  ]) {
    assert.equal(parseMovementMonth(new URLSearchParams(query)), null, query);
  }
});

test("I1-01: el mes vacío y el saldo negativo se representan con centavos exactos", () => {
  const month = "2024-02";
  assert.deepEqual(formatMovementInsights(month, {
    income: "0", expense: "0", movementCount: 0,
  }), { month, income: "0.00", expense: "0.00", balance: "0.00", movementCount: 0 });

  assert.deepEqual(formatMovementInsights(month, {
    income: "9007199254740992.01",
    expense: "9007199254740992.02",
    movementCount: 2,
  }), {
    month,
    income: "9007199254740992.01",
    expense: "9007199254740992.02",
    balance: "-0.01",
    movementCount: 2,
  });
});

test("I1-04 e I1-05: el CSV preserva el dialecto, Unicode, comillas y saltos de línea", () => {
  assert.equal(renderMonthlyMovementsCsv([]), header);
  const csv = renderMonthlyMovementsCsv([
    { ...movement, category: "Café; té", description: 'Trajo "piña"\r\npara todos' },
    { ...movement, date: "2024-02-01", type: "income", amount: "0.01" },
  ]);
  assert.equal(csv, header +
    '2024-02-29;expense;"Café; té";"Trajo ""piña""\r\npara todos";123456789012,01\r\n' +
    "2024-02-01;income;;Compra de prueba;0,01\r\n");
  assert.deepEqual([...Buffer.from(csv!, "utf8").subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("I1-05: el CSV antepone un apóstrofo a texto con prefijos de fórmula", () => {
  for (const value of ["=texto", "+texto", "-texto", "@texto", " \u200B＋texto", "\ttexto"]) {
    assert.equal(
      renderMonthlyMovementsCsv([{ ...movement, category: value, description: value }]),
      header + `2024-02-29;expense;'${value};'${value};123456789012,01\r\n`,
    );
  }
  const value = "\r\ntexto";
  assert.equal(
    renderMonthlyMovementsCsv([{ ...movement, description: value }]),
    header + `2024-02-29;expense;;"'${value}";123456789012,01\r\n`,
  );
});

test("I1-06: el serializador acepta 10 000 filas y rechaza 10 001 antes de emitir CSV", () => {
  const rows = Array.from({ length: 10_000 }, () => movement);
  const csv = renderMonthlyMovementsCsv(rows);
  assert.ok(csv);
  assert.equal(csv.split("\r\n").length, 10_002);
  assert.equal(renderMonthlyMovementsCsv([...rows, movement]), null);
});
