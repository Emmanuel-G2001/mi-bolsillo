// QA de A1–A3, I3-04 y MA-01–MA-03. Requiere Node 22.15+ y PostgreSQL 16 local desechable.
// Configura DATABASE_URL con loopback y la base `mi_bolsillo_qa` con el esquema disponible.
// Ejecuta desde la raíz del repositorio:
// node --import tsx scripts/financial-consistency-postgres-check.ts
// Este script crea y elimina únicamente sus propios usuarios sintéticos.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import ExcelJS from "exceljs";
import { Pool } from "pg";
import { parseAnalyticsQuery } from "../features/finance/analytics/analytics.schema";
import { buildAnalyticsReport } from "../features/finance/reports/report.types";
import { renderReportXlsx } from "../features/finance/reports/report.xlsx";

let stage = "configuración y conexión";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/mi_bolsillo_qa" || url.search || url.hash
  ) {
    throw new Error("Se requiere la base desechable mi_bolsillo_qa en loopback, sin parámetros de URL.");
  }

  // Reproduce la resolución de server-only que Next aplica al código de servidor.
  const nextServerOnly = nodeModule.createRequire(__filename).resolve("next/dist/compiled/server-only/empty");
  const registerHooks = (nodeModule as typeof nodeModule & {
    registerHooks?: (hooks: {
      resolve: (specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) => unknown;
    }) => void;
  }).registerHooks;
  assert.ok(registerHooks, "Node 22.15 o posterior es necesario.");
  registerHooks({
    resolve: (specifier, context, next) => next(specifier === "server-only" ? nextServerOnly : specifier, context),
  });

  const label = `finance-qa-${randomUUID()}`;
  url.searchParams.set("application_name", label);
  process.env.DATABASE_URL = url.href;
  const { createTransaction, updateTransaction, deleteTransaction } = await import("../features/finance/transactions.service");
  url.searchParams.set("application_name", `${label}-fixture`);
  const pool = new Pool({ connectionString: url.href });
  const emails = [`${label}-a@example.com`, `${label}-b@example.com`];
  const input = { type: "expense", amount: BigInt(1234), description: label, date: "2026-11-12" } as const;

  async function categoryIds(user: number, name: string) {
    const result = await pool.query<{ id: number }>(
      "SELECT id FROM categories WHERE user_id = $1 AND type = 'expense' AND name = $2",
      [user, name],
    );
    return result.rows.map(({ id }) => id);
  }

  async function assertSharedCategory(user: number, name: string, ids: string[]) {
    const categories = await categoryIds(user, name);
    assert.equal(categories.length, 1);
    const result = await pool.query<{ category_id: number }>(
      "SELECT category_id FROM transactions WHERE user_id = $1 AND id = ANY($2::integer[])",
      [user, ids],
    );
    assert.deepEqual(result.rows.map(({ category_id }) => category_id), ids.map(() => categories[0]));
  }

  async function runCategoryRace<A, B>(
    user: number,
    first: () => Promise<A>,
    second: () => Promise<B>,
  ): Promise<[A, B]> {
    // Namespace de expense de finance.utils.ts. Verificamos el bloqueo efectivo
    // desde sesiones independientes antes de dejar que resuelvan la categoría.
    const expenseNamespace = 0x46540002;
    const blocker = await pool.connect();
    let operations: Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> | undefined;
    let waiting = 0;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [expenseNamespace, user]);
      operations = Promise.allSettled([
        Promise.resolve().then(first),
        Promise.resolve().then(second),
      ]);
      for (let attempt = 0; attempt < 100 && waiting < 2; attempt++) {
        const { rows: [status] } = await pool.query<{ waiting: number }>(
          `SELECT count(DISTINCT l.pid)::integer AS waiting
             FROM pg_locks AS l JOIN pg_stat_activity AS a USING (pid)
            WHERE a.application_name = $1 AND l.locktype = 'advisory'
              AND l.classid = $2::oid AND l.objid = $3::oid
              AND l.objsubid = 2 AND NOT l.granted`,
          [label, expenseNamespace, user],
        );
        waiting = status.waiting;
        if (waiting < 2) await delay(20);
      }
    } finally {
      // Cerrar la sesión libera el bloqueo aunque falle ROLLBACK.
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release(true);
        await operations;
      }
    }

    assert.equal(waiting, 2, "Ambas operaciones deben esperar el bloqueo de categoría.");
    assert.ok(operations);
    const [one, two] = await operations;
    if (one.status === "rejected") throw one.reason;
    if (two.status === "rejected") throw two.reason;
    return [one.value, two.value];
  }

  try {
    const { rows: [owner, other] } = await pool.query<{ id: number }>(
      "INSERT INTO users (name, email, password_hash) VALUES ('QA A', $1, 'unused'), ('QA B', $2, 'unused') RETURNING id",
      emails,
    );
    stage = "dos altas concurrentes";
    const creates = await runCategoryRace(
      owner.id,
      () => createTransaction(owner.id, { ...input, category: "Altas concurrentes" }),
      () => createTransaction(owner.id, { ...input, category: "Altas concurrentes" }),
    );
    await assertSharedCategory(owner.id, "Altas concurrentes", creates.map(({ id }) => id));
    assert.equal(creates[0].amount, 12.34);

    stage = "alta y edición concurrentes";
    const edit = { ...input, id: Number(creates[0].id) };
    const [created, updated] = await runCategoryRace(
      owner.id,
      () => createTransaction(owner.id, { ...input, category: "Alta y edición" }),
      () => updateTransaction(owner.id, { ...edit, category: "Alta y edición" }),
    );
    assert.equal(updated?.id, creates[0].id);
    await assertSharedCategory(owner.id, "Alta y edición", [created.id, creates[0].id]);

    stage = "autorización";
    assert.equal(await updateTransaction(other.id, { ...edit, category: "Ajena" }), null);
    assert.equal(await deleteTransaction(other.id, edit.id), false);
    assert.deepEqual(await categoryIds(other.id, "Ajena"), []);

    stage = "rollback al fallar la persistencia";
    const overflow = { ...input, category: "Rollback", amount: BigInt("100000000000000") };
    const numericOverflow = (error: unknown) =>
      error instanceof Error && error.cause instanceof Error &&
      "code" in error.cause && error.cause.code === "22003";
    await assert.rejects(createTransaction(owner.id, overflow), numericOverflow);
    await assert.rejects(updateTransaction(owner.id, { ...edit, ...overflow }), numericOverflow);
    assert.deepEqual(await categoryIds(owner.id, "Rollback"), []);
    await assertSharedCategory(owner.id, "Alta y edición", [created.id, creates[0].id]);

    stage = "edición concurrente con borrado";
    const deleting = await pool.connect();
    let committed = false;
    try {
      await deleting.query("BEGIN");
      const { rows: [{ pid }] } = await deleting.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await deleting.query("DELETE FROM transactions WHERE user_id = $1 AND id = $2", [owner.id, edit.id]);
      const patch = updateTransaction(owner.id, { ...edit, category: "Borrado concurrente" });
      const result = patch.then((value) => ({ value }), (error: unknown) => ({ error }));
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const status = await pool.query<{ waiting: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND $2 = ANY(pg_blocking_pids(pid))) AS waiting",
          [label, pid],
        );
        waiting = status.rows[0].waiting;
        if (!waiting) await delay(20);
      }
      await deleting.query("COMMIT");
      committed = true;
      assert.deepEqual(await result, { value: null });
      assert.ok(waiting, "La edición debe esperar a que se resuelva el borrado de la fila.");
      assert.deepEqual(await categoryIds(owner.id, "Borrado concurrente"), []);
    } finally {
      try {
        if (!committed) await deleting.query("ROLLBACK");
      } finally {
        deleting.release();
      }
    }

    console.log("A1–A3: concurrencia, aislamiento, rollback y borrado verificados.");

    stage = "MA-01–MA-03: progreso inicial, aportes y devolución";
    const { getFinanceAnalytics, readAnalyticsReportMovements, readFinanceAnalytics } =
      await import("../features/finance/analytics/analytics.service");
    const { createGoal, contributeToGoal, deleteGoal } = await import("../features/finance/goals.service");
    const { getBogotaToday } = await import("../features/finance/finance.utils");
    const today = getBogotaToday();
    const month = today.slice(0, 7);
    const goalQuery = parseAnalyticsQuery(new URLSearchParams({ startMonth: month, endMonth: month }));
    assert.ok(goalQuery);
    await pool.query(
      `INSERT INTO transactions (user_id, type, description, amount, transaction_date)
       VALUES ($1, 'income', 'Disponible QA', 50.00, $2)`,
      [other.id, today],
    );
    const baseline = await getFinanceAnalytics(other.id, goalQuery);
    assert.ok(baseline);
    assert.equal(baseline.series[0].available, "50.00");
    assert.equal(baseline.series[0].savings, "0.00");
    const goal = await createGoal(other.id, { name: "Meta QA", target: BigInt(10000), current: BigInt(1234) });
    assert.equal(goal.current, 12.34);
    const goalId = Number(goal.id);
    const contributions = () => pool.query<{ amount: string }>(
      "SELECT amount::text FROM savings_contributions WHERE goal_id = $1 ORDER BY id",
      [goalId],
    );
    assert.deepEqual((await contributions()).rows, []);
    assert.deepEqual(await getFinanceAnalytics(other.id, goalQuery), baseline);
    assert.deepEqual(await contributeToGoal(owner.id, goalId, BigInt(567)), { status: "not_found" });
    assert.equal(await deleteGoal(owner.id, goalId), "not_found");
    const contributed = await contributeToGoal(other.id, goalId, BigInt(567));
    assert.equal(contributed.status, "ok");
    assert.equal(contributed.goal.current, 18.01);
    assert.equal(contributed.appliedAmount, 5.67);
    assert.deepEqual((await contributions()).rows, [{ amount: "5.67" }]);
    const afterContribution = await getFinanceAnalytics(other.id, goalQuery);
    assert.ok(afterContribution);
    assert.deepEqual(afterContribution.series[0], {
      ...baseline.series[0],
      available: "44.33",
      savings: "5.67",
    });
    assert.equal(await deleteGoal(other.id, goalId), "has_contributions");
    assert.deepEqual((await contributions()).rows, [{ amount: "5.67" }]);
    assert.deepEqual(await getFinanceAnalytics(other.id, goalQuery), afterContribution);

    const initialOnly = await createGoal(other.id, {
      name: "Solo ahorro inicial QA", target: BigInt(500000000), current: BigInt(200000000),
    });
    assert.equal(initialOnly.current, 2000000);
    assert.equal(await deleteGoal(other.id, Number(initialOnly.id)), "deleted");
    assert.equal(await deleteGoal(other.id, Number(initialOnly.id)), "not_found");
    assert.deepEqual(await getFinanceAnalytics(other.id, goalQuery), afterContribution);

    const almostComplete = await createGoal(other.id, {
      name: "Meta concurrente QA", target: BigInt(10000), current: BigInt(9899),
    });
    const concurrentId = Number(almostComplete.id);
    const results = await Promise.all([
      contributeToGoal(other.id, concurrentId, BigInt(100)),
      contributeToGoal(other.id, concurrentId, BigInt(100)),
    ]);
    assert.deepEqual(results.map((result) => {
      assert.equal(result.status, "ok");
      return result.appliedAmount;
    }).sort((first, second) => first - second), [0.01, 1]);
    const capped = await getFinanceAnalytics(other.id, goalQuery);
    assert.ok(capped);
    assert.equal(capped.series[0].savings, "6.68");
    assert.equal(capped.series[0].available, "43.32");
    assert.equal(await deleteGoal(other.id, concurrentId), "has_contributions");
    assert.deepEqual(await getFinanceAnalytics(other.id, goalQuery), capped);

    const racing = await createGoal(other.id, { name: "Aporte contra borrado QA", target: BigInt(1000), current: BigInt(50) });
    const racingId = Number(racing.id);
    const [deletion, contribution] = await Promise.all([
      deleteGoal(other.id, racingId),
      contributeToGoal(other.id, racingId, BigInt(99)),
    ]);
    assert.deepEqual(
      [deletion, contribution.status],
      deletion === "deleted" ? ["deleted", "not_found"] : ["has_contributions", "ok"],
    );
    const raceState = await pool.query<{ current_amount: string; contributed: string }>(
      `SELECT g.current_amount::text, coalesce(sum(c.amount), 0)::text AS contributed
       FROM savings_goals g
       LEFT JOIN savings_contributions c ON c.goal_id = g.id AND c.user_id = g.user_id
       WHERE g.id = $1 AND g.user_id = $2 GROUP BY g.id`,
      [racingId, other.id],
    );
    assert.deepEqual(raceState.rows, deletion === "deleted" ? [] : [{ current_amount: "1.49", contributed: "0.99" }]);

    const legacy = await createGoal(other.id, {
      name: "Meta histórica QA", target: BigInt(500000000), current: BigInt(230000000),
    });
    const legacyId = Number(legacy.id);
    await pool.query(
      `INSERT INTO savings_contributions (user_id, goal_id, amount, contribution_date)
       VALUES ($1, $3, 2000000.00, DATE '2024-01-15'),
              ($1, $3, 300000.00, DATE '2024-02-15'),
              ($2, $3, 0.01, DATE '2024-02-16')`,
      [other.id, owner.id, legacyId],
    );
    const readLinks = () => pool.query(
      "SELECT id, goal_id, user_id, amount::text, contribution_date::text FROM savings_contributions WHERE goal_id = $1 ORDER BY id",
      [legacyId],
    );
    const history = (await readLinks()).rows;
    assert.equal(await deleteGoal(other.id, legacyId), "has_contributions");
    assert.deepEqual((await readLinks()).rows, history);
    console.log("MH-01–MH-03: progreso, centavos, saldo, borrado, aportes históricos y aislamiento verificados.");

    stage = "I3-04: fechas civiles en el archivo XLSX";
    await pool.query(
      `INSERT INTO transactions (user_id, type, description, amount, transaction_date)
       VALUES ($1, 'income', 'Día anterior', 0.01, DATE '2024-02-28'),
              ($1, 'income', 'Día bisiesto', 0.02, DATE '2024-02-29'),
              ($1, 'expense', 'Mes siguiente', 0.03, DATE '2024-03-01'),
              ($2, 'income', 'Movimiento ajeno', 0.04, DATE '2024-02-29')`,
      [owner.id, other.id],
    );
    const query = parseAnalyticsQuery(new URLSearchParams({ startMonth: "2024-02", endMonth: "2024-03" }));
    assert.ok(query);
    for (const dateStyle of ["ISO, MDY", "SQL, DMY", "German, DMY"]) {
      const report = await drizzle(pool).transaction(async (tx) => {
        await tx.execute(sql`select set_config('DateStyle', ${dateStyle}, true)`);
        await tx.execute(sql`select set_config('TimeZone', 'America/Bogota', true)`);
        const analytics = await readFinanceAnalytics(tx, owner.id, query);
        assert.ok(analytics);
        const movements = await readAnalyticsReportMovements(tx, owner.id, query, 10);
        return buildAnalyticsReport(analytics, movements, new Date("2024-03-02T02:00:00Z"));
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(await renderReportXlsx(report)).buffer);
      const sheet = workbook.getWorksheet("Movimientos");
      assert.ok(sheet);
      assert.equal(sheet.rowCount, 4, dateStyle);
      assert.deepEqual(
        [2, 3, 4].map((row) => sheet.getCell(row, 1).value),
        ["2024-03-01", "2024-02-29", "2024-02-28"],
        dateStyle,
      );
    }
    console.log("I3-04: fechas civiles ISO verificadas en XLSX con DateStyle ISO, SQL y German.");
  } finally {
    await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]).finally(() => pool.end());
  }
}

void main().catch(() => {
  console.error(`Falló la comprobación de PostgreSQL aislado durante ${stage}.`);
  process.exitCode = 1;
});
