// Regresiones monetarias con node:test y el tsx ya instalado. Requiere Node 22.
// Convención: scripts/<funcionalidad>.test.ts. Suite completa desde la raíz:
// node --import tsx --test scripts/*.test.ts
// Usa datos sintéticos y no requiere variables de entorno ni PostgreSQL.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCopCents,
  moneyCentsToNumber,
  parseFinanceJson,
  toMoneyCents,
} from "../features/finance/finance.money";
import { financePatchSchema } from "../features/finance/finance.schema";

test("A4: los importes decimales del formulario llegan a PATCH como números JSON y centavos exactos", () => {
  const cases = [
    {
      values: { kind: "transaction", id: "27", description: "QA", type: "expense", date: "2026-11-12" },
      amount: "12.34",
      cents: BigInt(1234),
    },
    {
      values: { month: "2026-11" },
      amount: "250.75",
      cents: BigInt(25075),
    },
    {
      values: { month: "2026-11" },
      amount: "0.01",
      cents: BigInt(1),
    },
  ];

  for (const { values, amount, cents } of cases) {
    const payload = JSON.stringify({ ...values, amount: Number(amount) });
    assert.equal(JSON.parse(payload).amount, Number(amount));
    assert.equal(financePatchSchema.parse(parseFinanceJson(payload)).amount, cents);
  }
});

test("A5: los formatos COP preservan centavos por encima del entero seguro", () => {
  const first = toMoneyCents("9007199254740992.01");
  const next = first + BigInt(1);
  assert.equal(moneyCentsToNumber(first), moneyCentsToNumber(next));
  assert.equal(formatCopCents(first), "$\u00a09.007.199.254.740.992,01");
  assert.equal(formatCopCents(next), "$\u00a09.007.199.254.740.992,02");
  assert.equal(formatCopCents(next, "short"), "$9.007.199.254.740.992,02");

  const aboveSafeCents = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(2);
  assert.equal(formatCopCents(aboveSafeCents), "$\u00a090.071.992.547.409,93");
});

test("A5: el formato COP conserva el signo bajo un peso y el estilo de pesos enteros", () => {
  assert.equal(formatCopCents(BigInt(-1)), "-$\u00a00,01");
  assert.equal(formatCopCents(BigInt(25000)), "$\u00a0250");
  assert.equal(formatCopCents(BigInt(25000), "short"), "$250");
});
