// Suite monetaria con node:test. Requiere Node 22, sin dependencias ni variables.
// Convención: scripts/<funcionalidad>.test.ts.
// Ejecutar desde la raíz:
// node --experimental-strip-types --test scripts/financial-consistency-money.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const {
  toMoneyCents,
  formatMoneyCents,
  moneyCentsToNumber,
  parseFinanceDashboardJson,
  parseFinanceJson,
  parseMoneyInput,
  serializeFinanceDashboardJson,
}: typeof import("../features/finance/finance.money") =
  createRequire(import.meta.url)("../features/finance/finance.money.ts");

test("SDD-04: redondea HALF_UP alrededor del empate decimal", () => {
  assert.equal(toMoneyCents(1.005), BigInt(101));
  assert.equal(toMoneyCents("1.004999999999999999"), BigInt(100));
  assert.equal(toMoneyCents("1.005000000000000001"), BigInt(101));
  assert.equal(toMoneyCents("9.995"), BigInt(1000));
  assert.equal(toMoneyCents("-1.005"), BigInt(-101));
  assert.equal(toMoneyCents("5e-3"), BigInt(1));
});

test("SDD-04/06: distingue lexemas JSON que producen el mismo número", () => {
  const belowTie = "1.004999999999999999";
  const tie = "1.005";
  assert.equal(Number(belowTie), Number(tie));
  assert.equal(parseMoneyInput(belowTie, Number(belowTie), false), BigInt(100));
  assert.equal(parseMoneyInput(tie, Number(tie), false), BigInt(101));
});

test("SDD-04/06: conserva los lexemas monetarios de primer nivel sin context.source", () => {
  const source = String.raw`{
    "amount": 1.005,
    "\u0061mount": 1.004999999999999999,
    "target": 5E-3,
    "current": -0.00e+0,
    "categoryId": 27,
    "description": "Texto con \"amount\": 1.005 y \\42",
    "nested": {"amount": 1.005, "target": 2, "current": 3},
    "items": [{"amount": 4}, 5]
  }`;
  const result = parseFinanceJson(source);
  assert.deepEqual(result, {
    amount: "1.004999999999999999",
    target: "5E-3",
    current: "-0.00e+0",
    categoryId: 27,
    description: 'Texto con "amount": 1.005 y \\42',
    nested: { amount: 1.005, target: 2, current: 3 },
    items: [{ amount: 4 }, 5],
  });
});

test("SDD-06: respeta los tipos JSON y la última propiedad duplicada", () => {
  assert.deepEqual(parseFinanceJson('{"amount":1.005,"amount":"2.005","target":null,"current":0}'), {
    amount: "2.005",
    target: null,
    current: "0",
  });
  assert.deepEqual(parseFinanceJson('[{"amount":1.005},2]'), [{ amount: 1.005 }, 2]);
  assert.equal(parseFinanceJson("null"), null);
  assert.throws(() => parseFinanceJson('{"amount":01}'), SyntaxError);
});

test("SDD-01/04: rechaza importes subcentavo y permite el cero inicial", () => {
  assert.equal(parseMoneyInput(0, 0, true), BigInt(0));
  assert.equal(parseMoneyInput("0.000", 0, true), BigInt(0));
  assert.equal(parseMoneyInput(0, 0, false), null);
  assert.equal(parseMoneyInput(0.0049, 0.0049, false), null);
  assert.equal(parseMoneyInput(0.0049, 0.0049, true), null);
  assert.equal(parseMoneyInput("1e-400", 0, true), null);
  assert.equal(parseMoneyInput(0.005, 0.005, false), BigInt(1));
});

test("SDD-04/06: preserva el tope y las representaciones de persistencia y JSON", () => {
  const max = "999999999999.99";
  const maxCents = BigInt("99999999999999");
  assert.equal(parseMoneyInput(max, Number(max), false), maxCents);
  assert.equal(parseMoneyInput("999999999999.995", 999999999999.995, false), null);
  assert.equal(formatMoneyCents(maxCents), max);
  assert.equal(formatMoneyCents(BigInt(0)), "0.00");
  assert.equal(formatMoneyCents(BigInt(-1)), "-0.01");
  assert.equal(moneyCentsToNumber(maxCents), Number(max));
  assert.equal(JSON.stringify({ amount: moneyCentsToNumber(BigInt(101)) }), '{"amount":1.01}');
});

test("SDD-04: conserva centavos al sumar y restar importes persistidos", () => {
  const income = toMoneyCents("0.30");
  const expense = toMoneyCents("0.10");
  const savings = toMoneyCents("0.20");
  assert.equal(income - expense - savings, BigInt(0));
});

test("SDD-04/06: el GET conserva los tipos JSON y permite calcular el saldo residual exacto", () => {
  const previousBalance = "900719925474099.31";
  const savings = "900719925474099.28";
  const dashboard = {
    userName: 'Usuario "de prueba"',
    month: "2026-11",
    budget: 250.75,
    transactions: [
      { id: "27", amount: 0.1, description: "Ingreso", type: "income", category: "Ingresos", date: "2026-11-12" },
      { id: "28", amount: 0.12, description: "Gasto", type: "expense", category: "Otros", date: "2026-11-12" },
    ],
    goals: [{ id: "3", name: "Meta", current: 0.28, target: 100.25 }],
  };
  const source = serializeFinanceDashboardJson({
    ...dashboard,
    previousBalance: toMoneyCents(previousBalance),
    savings: toMoneyCents(savings),
  });

  assert.equal(Number(previousBalance), Number(savings));
  assert.deepEqual(JSON.parse(source), {
    ...dashboard,
    previousBalance: Number(previousBalance),
    savings: Number(savings),
  });

  const preserved = parseFinanceDashboardJson(source);
  assert.deepEqual(preserved, { ...dashboard, previousBalance, savings });

  const { previousBalance: balanceLexeme, savings: savingsLexeme, transactions } =
    preserved as typeof dashboard & { previousBalance: string; savings: string };
  const residual = transactions.reduce(
    (balance, { amount, type }) =>
      balance + (type === "income" ? toMoneyCents(amount) : -toMoneyCents(amount)),
    toMoneyCents(balanceLexeme) - toMoneyCents(savingsLexeme),
  );
  assert.equal(residual, BigInt(1));
});
