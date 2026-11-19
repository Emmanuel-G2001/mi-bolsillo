import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAnalyticsResponse,
  formatAnalyticsPercent,
} from "../features/finance/analytics/analytics.result";
import { parseAnalyticsQuery } from "../features/finance/analytics/analytics.schema";

function parse(startMonth: string, endMonth: string, extra = {}) {
  const query = parseAnalyticsQuery(new URLSearchParams({ startMonth, endMonth, ...extra }));
  assert.ok(query);
  return query;
}

test("I2-01: límites civiles, comparación anterior y doce meses inclusivos", () => {
  const year = parse("2023-12", "2024-11");
  assert.deepEqual(year.months, [
    "2023-12", "2024-01", "2024-02", "2024-03", "2024-04", "2024-05",
    "2024-06", "2024-07", "2024-08", "2024-09", "2024-10", "2024-11",
  ]);
  assert.equal(year.readStartDate, "2023-12-01");
  assert.equal(year.endDate, "2024-12-01");
  const leap = parse("2024-02", "2024-02");
  assert.equal(leap.startDate, "2024-02-01");
  assert.equal(leap.endDate, "2024-03-01");
  assert.equal(leap.readStartDate, "2024-01-01");
  assert.equal(parse("0100-01", "0100-01").readStartDate, "0099-12-01");
  assert.equal(parse("9999-12", "9999-12").endDate, "10000-01-01");
});

test("I2-01: filtra valores inválidos y duplicados, normaliza omisiones", () => {
  const base = "startMonth=2024-01&endMonth=2024-01";
  for (const query of [
    "", "startMonth=2024-01", "endMonth=2024-01",
    "startMonth=2024-02&endMonth=2024-01", "startMonth=2024-01&endMonth=2025-01",
    "startMonth=2024-1&endMonth=2024-02", "startMonth=0099-12&endMonth=0100-01",
    "startMonth=2024-01&endMonth=2024-13", "startMonth=2024-01&endMonth=2024-01%0A",
    ...["startMonth=2024-01", "endMonth=2024-01", "type=all&type=income",
      "category=all&category=all", "type=", "type=other", "category=", "category=0",
      "category=014", "category=%2B1", "category=1%0A", "category=2147483648",
    ].map((tail) => `${base}&${tail}`),
  ]) {
    assert.equal(parseAnalyticsQuery(new URLSearchParams(query)), null, query);
  }
  assert.deepEqual(parseAnalyticsQuery(new URLSearchParams(`${base}&userId=99`))?.filters, {
    startMonth: "2024-01", endMonth: "2024-01", type: "all", category: "all",
  });
  assert.equal(parse("2024-01", "2024-01", { type: "income", category: "2147483647" }).filters.category, "2147483647");
  assert.equal(parse("2024-01", "2024-01", { category: "uncategorized" }).filters.category, "uncategorized");
});

test("I2-03 e I2-04: apertura global, meses vacíos y comparación después de acumular", () => {
  const query = parse("2024-01", "2024-03", { type: "expense", category: "9" });
  const result = buildAnalyticsResponse(query, [], { net: "95.80", savings: "5.80" }, [
    { month: "2024-01", income: "0", expense: "3.03", globalNet: "10.00", hasFilteredMovements: true },
    { month: "2024-03", income: "0", expense: "8.03", globalNet: "-5.00", hasFilteredMovements: true },
  ], [{ month: "2024-02", amount: "20.00" }], []);
  assert.equal(result.openingAvailable, "90.00");
  assert.equal(result.hasFilteredMovements, true);
  assert.deepEqual(result.series, [
    { month: "2024-01", income: "0.00", expense: "3.03", net: "-3.03", savings: "0.00", available: "100.00" },
    { month: "2024-02", income: "0.00", expense: "0.00", net: "0.00", savings: "20.00", available: "80.00" },
    { month: "2024-03", income: "0.00", expense: "8.03", net: "-8.03", savings: "0.00", available: "75.00" },
  ]);
  assert.deepEqual(result.comparison.previous, result.series[1]);
  assert.deepEqual(result.comparison.difference, {
    income: "0.00", expense: "8.03", net: "-8.03", savings: "-20.00", available: "-5.00",
  });
  assert.deepEqual(result.comparison.percent, {
    income: null, expense: null, net: null, savings: "-100.00", available: "-6.25",
  });
});

test("I2-03, I2-04 e I2-08: un mes sin coincidencias preserva ahorro, apertura y mes anterior", () => {
  const result = buildAnalyticsResponse(parse("2025-01", "2025-01"), [], { net: "30", savings: "40" }, [
    { month: "2024-12", income: "1.00", expense: "9.00", globalNet: "-8", hasFilteredMovements: true },
  ], [{ month: "2025-01", amount: "2.00" }], []);
  assert.equal(result.hasFilteredMovements, false);
  assert.deepEqual(result.comparison.previous, {
    month: "2024-12", income: "1.00", expense: "9.00", net: "-8.00", savings: "0.00", available: "-10.00",
  });
  assert.equal(result.comparison.current.available, "-12.00");
  assert.equal(result.comparison.current.savings, "2.00");
  assert.equal(result.comparison.percent.available, "-20.00");
  assert.equal(result.comparison.percent.net, "100.00");
  assert.deepEqual(result.distribution, { type: "expense", total: "0.00", groups: [] });
});

test("I2-05 e I2-06: clasificación por centavos, desempate numérico y categoría real Otros", () => {
  const result = buildAnalyticsResponse(parse("2024-02", "2024-02", { type: "income" }), [], { net: "0", savings: "0" }, [], [], [
    { id: null, name: null, amount: "9007199254740992.01" },
    { id: 10, name: "Café", amount: "9007199254740992.01" },
    { id: 2, name: "Otros", amount: "9007199254740992.01" },
    { id: 11, name: "Casa", amount: "9007199254740992.02" },
  ]);
  assert.deepEqual(result.distribution, { type: "income", total: "36028797018963968.05", groups: [
    { category: "11", name: "Casa", amount: "9007199254740992.02", percent: "25.00" },
    { category: "2", name: "Otros", amount: "9007199254740992.01", percent: "25.00" },
    { category: "10", name: "Café", amount: "9007199254740992.01", percent: "25.00" },
    { category: "uncategorized", name: "Sin categoría o eliminada", amount: "9007199254740992.01", percent: "25.00" },
  ] });
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("I2-04 e I2-06: porcentajes con base absoluta, cero y empates en ambos signos", () => {
  assert.equal(formatAnalyticsPercent(BigInt(1), BigInt(-3)), "33.33");
  assert.equal(formatAnalyticsPercent(BigInt(1), BigInt(32)), "3.13");
  assert.equal(formatAnalyticsPercent(BigInt(-1), BigInt(-32)), "-3.13");
  assert.equal(formatAnalyticsPercent(BigInt(-1), BigInt(100000)), "0.00");
  assert.equal(formatAnalyticsPercent(BigInt(0), BigInt(0)), null);
});
