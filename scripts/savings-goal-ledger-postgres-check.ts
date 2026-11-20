// Run against the disposable migrated PostgreSQL QA database. The journal
// deliberately keeps the synthetic records. Dispose of the database afterward.
// Set SAVINGS_LEDGER_SKIP_HISTORICAL=1 to omit synthetic reclassification.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as nodeModule from "node:module";

import ExcelJS from "exceljs";
import { Pool } from "pg";

import { parseAnalyticsQuery } from "../features/finance/analytics/analytics.schema";
import { toMoneyCents } from "../features/finance/finance.money";
import { getBogotaToday } from "../features/finance/finance.utils";
import { parseMovementMonth } from "../features/finance/monthly-movements";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
    url.port !== "54863" || url.pathname !== "/mi_bolsillo_qa" || url.search || url.hash) {
    throw new Error("Usa exclusivamente PostgreSQL desechable local en 127.0.0.1:54863/mi_bolsillo_qa.");
  }

  // Match the server-only alias used by Next when invoking services directly.
  const nextServerOnly = nodeModule.createRequire(__filename).resolve("next/dist/compiled/server-only/empty");
  const { registerHooks } = nodeModule as typeof nodeModule & {
    registerHooks: (hooks: {
      resolve: (specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) => unknown;
    }) => void;
  };
  registerHooks({
    resolve: (specifier, context, next) => next(specifier === "server-only" ? nextServerOnly : specifier, context),
  });

  const { GoalLedgerError, readGoalLedger, writeGoalOperation } = await import("../features/finance/goal-ledger.service");
  const { createGoal, deleteGoal } = await import("../features/finance/goals.service");
  const { getFinanceAnalytics } = await import("../features/finance/analytics/analytics.service");
  const { getFinanceDashboard } = await import("../features/finance/finance-dashboard.service");
  const { getMonthlyMovementExportRows } = await import("../features/finance/monthly-movements.service");
  const { getAnalyticsReport } = await import("../features/finance/reports/report.service");
  const { createReportWork } = await import("../features/finance/reports/report-limits");
  const { renderReportPdf } = await import("../features/finance/reports/report.pdf");
  const { renderReportXlsx } = await import("../features/finance/reports/report.xlsx");
  const pool = new Pool({ connectionString: url.href });
  const run = randomUUID();
  const month = getBogotaToday().slice(0, 7);
  const period = parseMovementMonth(new URLSearchParams({ month }));
  assert.ok(period);
  const query = parseAnalyticsQuery(new URLSearchParams({ startMonth: month, endMonth: month }));
  assert.ok(query);

  const rejectsWith = (status: number) => (error: unknown) =>
    error instanceof GoalLedgerError && error.status === status;

  try {
    const { rows: [owner, other] } = await pool.query<{ id: number }>(
      "insert into users (name, email, password_hash) values ('QA', $1, 'x'), ('QA', $2, 'x') returning id",
      [`${run}@example.invalid`, `${run}-other@example.invalid`],
    );
    await pool.query(
      "insert into transactions (user_id, type, description, amount, transaction_date) values ($1, 'income', 'Ingreso sintético', 1000.00, $2)",
      [owner.id, getBogotaToday()],
    );
    const makeGoal = async (name: string, target: string, initial = "0", userId = owner.id) =>
      Number((await createGoal(userId, { name, target: BigInt(target), current: BigInt(initial) })).id);
    const source = await makeGoal("Origen sintético", "100000", "50001");
    const target = await makeGoal("Destino sintético", "10000");
    const foreign = await makeGoal("Ajena sintética", "10000", "0", other.id);
    type Operation = Parameters<typeof writeGoalOperation>[1];
    const perform = (input: Omit<Operation, "operationId">) =>
      writeGoalOperation(owner.id, { operationId: randomUUID(), ...input });
    const balance = async () => (await getFinanceAnalytics(owner.id, query))?.series[0];
    const read = async (goalId: number) => {
      const data = await readGoalLedger(owner.id, goalId);
      assert.ok("goal" in data && data.goal);
      return data;
    };

    // SM-01: initial money does not enter period totals or export movements.
    const csvBefore = await getMonthlyMovementExportRows(owner.id, period);
    assert.equal(csvBefore.length, 1);
    assert.equal((await read(source)).goal.current, "500.01");
    assert.equal((await balance())?.available, "1000.00");
    assert.equal((await balance())?.savings, "0.00");

    const fund = { kind: "fund", goalId: source, amount: BigInt(12003), operationId: randomUUID() } as const;
    const retries = await Promise.all([writeGoalOperation(owner.id, fund), writeGoalOperation(owner.id, fund)]);
    assert.deepEqual(retries[0], retries[1]);
    assert.equal(retries[0].goal.current, "620.04");
    await assert.rejects(writeGoalOperation(owner.id, { ...fund, amount: BigInt(12004) }), rejectsWith(409));
    assert.equal((await balance())?.available, "879.97");

    // SM-02/03: partial and full transfers/releases, cap, and exact reserve accounting.
    const released = await perform({ kind: "release", goalId: source, amount: BigInt(4001), reason: "Liberación parcial QA" });
    assert.equal(released.goal.reserved, "80.02");
    assert.equal((await balance())?.available, "919.98");
    const first = await perform({ kind: "transfer", goalId: source, destinationGoalId: target, amount: BigInt(5001) });
    assert.equal(first.goal.reserved, "30.01");
    assert.equal(first.destination?.reserved, "50.01");
    const full = await perform({ kind: "transfer", goalId: source, destinationGoalId: target, amount: BigInt(3001) });
    assert.equal(full.goal.reserved, "0.00");
    assert.equal(full.destination?.reserved, "80.02");
    assert.equal((await balance())?.available, "919.98");

    await assert.rejects(perform({ kind: "transfer", goalId: source, destinationGoalId: source, amount: BigInt(1) }), rejectsWith(409));
    await assert.rejects(perform({ kind: "transfer", goalId: target, destinationGoalId: foreign, amount: BigInt(1) }), rejectsWith(404));
    await assert.rejects(readGoalLedger(other.id, source), rejectsWith(404));
    await assert.rejects(perform({ kind: "release", goalId: source, amount: BigInt(1) }), rejectsWith(409));
    const small = await makeGoal("Capacidad mínima QA", "10");
    const beforeFailed = [await read(target), await read(small)];
    await assert.rejects(perform({ kind: "transfer", goalId: target, destinationGoalId: small, amount: BigInt(11) }), rejectsWith(409));
    assert.deepEqual([await read(target), await read(small)], beforeFailed);
    // Writes to both goals precede the INSERT. A DB constraint failure must undo both.
    await assert.rejects(perform({
      kind: "transfer", goalId: target, destinationGoalId: small, amount: BigInt(1), reason: "x".repeat(301),
    }), error => (error as { cause?: { code?: string } }).cause?.code === "22001");
    assert.deepEqual([await read(target), await read(small)], beforeFailed);

    const reversals = await Promise.allSettled([
      perform({ kind: "reverse", goalId: source, originalOperationId: full.operationId }),
      perform({ kind: "reverse", goalId: source, originalOperationId: full.operationId }),
    ]);
    const [success] = reversals.filter(result => result.status === "fulfilled");
    const [failure] = reversals.filter(result => result.status === "rejected");
    assert.equal(reversals.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(rejectsWith(409)(failure.reason));
    assert.equal(success.value.goal.reserved, "30.01");
    assert.equal(success.value.destination?.reserved, "50.01");
    assert.equal((await balance())?.available, "919.98");

    // SM-04: archive, restore, and close record history without changing money.
    const archived = await perform({ kind: "archive", goalId: source });
    assert.equal(archived.goal.status, "archived");
    assert.equal(archived.goal.reserved, "30.01");
    await assert.rejects(perform({ kind: "release", goalId: source, amount: BigInt(1) }), rejectsWith(409));
    const restored = await perform({ kind: "restore", goalId: source });
    assert.equal(restored.goal.status, "active");
    assert.equal(restored.goal.reserved, "30.01");
    await assert.rejects(perform({ kind: "close", goalId: source }), rejectsWith(409));
    await perform({ kind: "release", goalId: source, amount: BigInt(3001), reason: "Liberación total QA" });
    await perform({ kind: "release", goalId: target, amount: BigInt(5001), reason: "Liberación total QA" });
    assert.equal((await balance())?.available, "1000.00");
    const closed = await perform({ kind: "close", goalId: source });
    assert.equal(closed.goal.status, "closed");
    assert.equal(closed.goal.current, "500.01");
    assert.equal(await deleteGoal(owner.id, source), "has_contributions");
    assert.ok((await read(source)).history.some(entry => entry.kind === "close"));
    assert.ok((await read(target)).history.some(entry => entry.operationId === full.operationId));
    await assert.rejects(pool.query(
      "update savings_goal_operations set reason = $1 where user_id = $2 and operation_id = $3",
      ["Edición que debe fallar", owner.id, full.operationId],
    ), error => (error as { code?: string }).code === "23514");
    assert.deepEqual(await getMonthlyMovementExportRows(owner.id, period), csvBefore);

    // SM-05: concurrent withdrawals cannot reserve a negative amount.
    await perform({ kind: "fund", goalId: target, amount: BigInt(11) });
    const outcomes = await Promise.allSettled([
      perform({ kind: "release", goalId: target, amount: BigInt(8) }),
      perform({ kind: "release", goalId: target, amount: BigInt(8) }),
    ]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") assert.ok(rejectsWith(409)(outcome.reason));
    }
    assert.equal((await read(target)).goal.reserved, "0.03");
    const opposite = await makeGoal("Transferencia opuesta QA", "100");
    await perform({ kind: "fund", goalId: opposite, amount: BigInt(5) });
    const beforeOpposite = await balance();
    await Promise.all([
      perform({ kind: "transfer", goalId: target, destinationGoalId: opposite, amount: BigInt(1) }),
      perform({ kind: "transfer", goalId: opposite, destinationGoalId: target, amount: BigInt(2) }),
    ]);
    assert.equal((await read(target)).goal.reserved, "0.04");
    assert.equal((await read(opposite)).goal.reserved, "0.04");
    assert.deepEqual(await balance(), beforeOpposite);

    // SM-05: a replenished aggregate reserve does not establish provenance.
    const snapshot = async (goalIds: number[]) => ({
      analytics: await balance(),
      dashboard: await getFinanceDashboard({ id: owner.id, name: "QA" }, month),
      csv: await getMonthlyMovementExportRows(owner.id, period),
      ledger: await Promise.all(goalIds.map(read)),
    });
    const rejectWithoutEffects = async (
      operation: () => Promise<unknown>, goalIds: number[], status = 409,
    ) => {
      const before = await snapshot(goalIds);
      await assert.rejects(operation, rejectsWith(status));
      assert.deepEqual(await snapshot(goalIds), before);
    };
    const undo = (goalId: number, originalOperationId: string) =>
      ({ kind: "reverse", goalId, originalOperationId, operationId: randomUUID() } as const);
    const clean = await makeGoal("Reserva sin consumo QA", "50000");
    const cleanFund = await perform({ kind: "fund", goalId: clean, amount: BigInt(10001) });
    const laterFund = await perform({ kind: "fund", goalId: clean, amount: BigInt(12003) });
    const cleanUndo = undo(clean, cleanFund.operationId);
    await rejectWithoutEffects(() => writeGoalOperation(other.id, cleanUndo), [clean], 404);
    const undone = await writeGoalOperation(owner.id, cleanUndo);
    assert.equal(undone.goal.reserved, "120.03");
    assert.equal(undone.goal.current, "120.03");
    const afterUndo = await snapshot([clean]);
    assert.deepEqual(await writeGoalOperation(owner.id, cleanUndo), undone);
    assert.deepEqual(await snapshot([clean]), afterUndo);
    await rejectWithoutEffects(
      () => writeGoalOperation(owner.id, { ...cleanUndo, reason: "Otro contenido QA" }), [clean],
    );
    await rejectWithoutEffects(
      () => writeGoalOperation(owner.id, undo(clean, laterFund.operationId)), [clean],
    );
    const ownerAfterReversal = await snapshot([clean]);
    const otherResult = await writeGoalOperation(other.id, {
      kind: "fund", goalId: foreign, amount: BigInt(201), operationId: cleanUndo.operationId,
    });
    assert.equal(otherResult.goal.reserved, "2.01");
    assert.deepEqual(await snapshot([clean]), ownerAfterReversal);

    for (const consumed of [BigInt(10000), BigInt(1)]) {
      const goal = await makeGoal("Aporte consumido QA", "50000");
      const originalFund = await perform({ kind: "fund", goalId: goal, amount: BigInt(10000) });
      const release = await perform({ kind: "release", goalId: goal, amount: consumed });
      await perform({ kind: "fund", goalId: goal, amount: BigInt(10000) });
      await rejectWithoutEffects(() => writeGoalOperation(owner.id, undo(goal, originalFund.operationId)), [goal]);
      assert.equal((await read(goal)).goal.reserved, consumed === BigInt(1) ? "199.99" : "100.00");
      const beforeReleaseUndo = await balance();
      const restoredRelease = await writeGoalOperation(owner.id, undo(goal, release.operationId));
      assert.equal(restoredRelease.goal.reserved, "200.00");
      const afterReleaseUndo = await balance();
      assert.ok(beforeReleaseUndo && afterReleaseUndo);
      assert.equal(afterReleaseUndo.income, beforeReleaseUndo.income);
      assert.equal(afterReleaseUndo.expense, beforeReleaseUndo.expense);
      assert.equal(afterReleaseUndo.net, beforeReleaseUndo.net);
      assert.equal(toMoneyCents(afterReleaseUndo.available), toMoneyCents(beforeReleaseUndo.available) - consumed);
      assert.equal(toMoneyCents(afterReleaseUndo.savings), toMoneyCents(beforeReleaseUndo.savings) + consumed);
      assert.deepEqual(await getMonthlyMovementExportRows(owner.id, period), csvBefore);
    }

    const filled = await makeGoal("Capacidad ocupada QA", "10000");
    await perform({ kind: "fund", goalId: filled, amount: BigInt(10000) });
    const opening = await perform({ kind: "release", goalId: filled, amount: BigInt(1) });
    await perform({ kind: "fund", goalId: filled, amount: BigInt(1) });
    await rejectWithoutEffects(() => writeGoalOperation(owner.id, undo(filled, opening.operationId)), [filled]);

    const transferSource = await makeGoal("Origen consumido QA", "50000");
    const transferTarget = await makeGoal("Destino consumido QA", "50000");
    const transferredFund = await perform({ kind: "fund", goalId: transferSource, amount: BigInt(10000) });
    const transfer = await perform({
      kind: "transfer", goalId: transferSource, destinationGoalId: transferTarget, amount: BigInt(10000),
    });
    await perform({ kind: "fund", goalId: transferSource, amount: BigInt(10000) });
    await rejectWithoutEffects(
      () => writeGoalOperation(owner.id, undo(transferSource, transferredFund.operationId)),
      [transferSource, transferTarget],
    );
    await perform({ kind: "release", goalId: transferTarget, amount: BigInt(10000) });
    await perform({ kind: "fund", goalId: transferTarget, amount: BigInt(10000) });
    await rejectWithoutEffects(
      () => writeGoalOperation(owner.id, undo(transferSource, transfer.operationId)),
      [transferSource, transferTarget],
    );

    const recallSource = await makeGoal("Origen de retorno QA", "50000");
    const recallTarget = await makeGoal("Destino de retorno QA", "50000");
    await perform({ kind: "fund", goalId: recallSource, amount: BigInt(10001) });
    const targetFund = await perform({ kind: "fund", goalId: recallTarget, amount: BigInt(101) });
    const incoming = await perform({
      kind: "transfer", goalId: recallSource, destinationGoalId: recallTarget, amount: BigInt(10001),
    });
    const recalled = await writeGoalOperation(owner.id, undo(recallSource, incoming.operationId));
    assert.equal(recalled.goal.reserved, "100.01");
    assert.equal(recalled.destination?.reserved, "1.01");
    await rejectWithoutEffects(
      () => writeGoalOperation(owner.id, undo(recallTarget, targetFund.operationId)),
      [recallSource, recallTarget],
    );

    const race = await makeGoal("Carrera de reversión QA", "50000");
    const raceFund = await perform({ kind: "fund", goalId: race, amount: BigInt(10000) });
    const beforeRace = await balance();
    assert.ok(beforeRace);
    const raceResults = await Promise.allSettled([
      writeGoalOperation(owner.id, undo(race, raceFund.operationId)),
      perform({ kind: "release", goalId: race, amount: BigInt(10000) }),
    ]);
    assert.equal(raceResults.filter(result => result.status === "fulfilled").length, 1);
    for (const result of raceResults) {
      if (result.status === "rejected") assert.ok(rejectsWith(409)(result.reason));
    }
    const raceLedger = await read(race);
    assert.equal(raceLedger.goal.reserved, "0.00");
    assert.equal(raceLedger.goal.current, "0.00");
    assert.equal(raceLedger.history.length, 2);
    assert.equal(raceLedger.history.filter(entry => entry.kind === "release" || entry.kind === "reverse").length, 1);
    const afterRace = await balance();
    assert.ok(afterRace);
    assert.equal(toMoneyCents(afterRace.available), toMoneyCents(beforeRace.available) + BigInt(10000));
    assert.equal(toMoneyCents(afterRace.savings), toMoneyCents(beforeRace.savings) - BigInt(10000));
    assert.equal(afterRace.net, beforeRace.net);
    assert.deepEqual(await getMonthlyMovementExportRows(owner.id, period), csvBefore);

    const dashboardAfterRace = await getFinanceDashboard({ id: owner.id, name: "QA" }, month);
    assert.equal(dashboardAfterRace.savings, toMoneyCents(afterRace.savings));
    const monthlyReport = await getAnalyticsReport(owner.id, query, 100, createReportWork());
    assert.ok(monthlyReport);
    assert.deepEqual(monthlyReport.series[0], afterRace);
    assert.equal(monthlyReport.count, csvBefore.length);
    assert.equal((await renderReportPdf(monthlyReport)).subarray(0, 5).toString(), "%PDF-");
    const monthlyWorkbook = new ExcelJS.Workbook();
    await monthlyWorkbook.xlsx.load(Uint8Array.from(await renderReportXlsx(monthlyReport)).buffer);
    const monthlySummary = monthlyWorkbook.getWorksheet("Resumen");
    assert.ok(monthlySummary);
    const exactIndicators = new Map<string, unknown>();
    monthlySummary.eachRow(row => {
      const label = row.getCell(1).value;
      if (typeof label === "string" && !exactIndicators.has(label)) exactIndicators.set(label, row.getCell(2).value);
    });
    assert.equal(exactIndicators.get("Ahorro neto global"), afterRace.savings);
    assert.equal(exactIndicators.get("Disponible global"), afterRace.available);

    console.log("SM-05: reversión con reserva intacta, consumo parcial y total, transferencias, UUID, aislamiento y carreras verificados.");
    if (process.env.SAVINGS_LEDGER_SKIP_HISTORICAL === "1") return;

    // SM-06/08: synthetic reconciliation changes the original period and preserves progress.
    const { rows: [legacy] } = await pool.query<{ id: number }>(
      "insert into savings_goals (user_id, name, target_amount, current_amount) values ($1, 'Legado sintético', 500.00, 180.30) returning id",
      [owner.id],
    );
    const { rows: [candidate, legitimate] } = await pool.query<{ id: number }>(
      "insert into savings_contributions (user_id, goal_id, amount, contribution_date) values ($1, $2, 100.01, '2024-02-29'), ($1, $2, 80.29, '2024-03-01') returning id",
      [owner.id, legacy.id],
    );
    const legacyQuery = parseAnalyticsQuery(new URLSearchParams({ startMonth: "2024-02", endMonth: "2024-03" }));
    assert.ok(legacyQuery);
    const original = await getFinanceAnalytics(owner.id, legacyQuery);
    assert.ok(original);
    assert.equal(original.series[0].savings, "100.01");
    const classification = {
      kind: "reclassify", goalId: legacy.id, operationId: randomUUID(), legacyContributionId: candidate.id,
      amount: BigInt(10001), reason: "Motivo interno sintético",
    } as const;
    const authority = {
      historical: {
        caseId: "QA-123",
        evidenceReference: "evidence-local",
        evidenceDigest: "a".repeat(64),
        authorizedBy: "operator-qa",
        expectedEconomicDate: "2024-02-29",
      },
    };
    await assert.rejects(writeGoalOperation(owner.id, classification), rejectsWith(409));
    await assert.rejects(writeGoalOperation(owner.id, classification, {
      historical: { ...authority.historical, expectedEconomicDate: "2024-03-01" },
    }), rejectsWith(409));
    assert.deepEqual(await getFinanceAnalytics(owner.id, legacyQuery), original);
    const classified = await writeGoalOperation(owner.id, classification, authority);
    assert.equal(classified.goal.initial, "100.01");
    assert.equal(classified.goal.current, "180.30");
    const reexpressed = await getFinanceAnalytics(owner.id, legacyQuery);
    assert.ok(reexpressed);
    assert.equal(reexpressed.series[0].savings, "0.00");
    assert.equal(reexpressed.series[0].available, "0.00");
    assert.equal(reexpressed.series[1].savings, "80.29");
    assert.equal(reexpressed.series[1].available, "-80.29");
    assert.equal(reexpressed.series[0].income, "0.00");
    const dashboard = await getFinanceDashboard({ id: owner.id, name: "QA" }, "2024-02");
    assert.equal(dashboard.savings, BigInt(0));
    assert.equal(dashboard.previousBalance, BigInt(0));
    const report = await getAnalyticsReport(owner.id, legacyQuery, 100, createReportWork());
    assert.ok(report);
    assert.equal(report.totals.savings, "80.29");
    assert.equal(report.totals.income, "0.00");
    assert.equal(report.count, 0);
    assert.equal((await renderReportPdf(report)).subarray(0, 5).toString(), "%PDF-");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(await renderReportXlsx(report)).buffer);
    const summary = workbook.getWorksheet("Resumen");
    assert.ok(summary);
    let savingsInExport: unknown;
    summary.eachRow(row => {
      if (row.getCell(1).value === "Ahorro neto global" && savingsInExport === undefined) {
        savingsInExport = row.getCell(2).value;
      }
    });
    assert.equal(savingsInExport, "80.29");
    const after = await read(legacy.id);
    assert.equal(after.history[0].reason, null);
    assert.equal(after.history[0].economicDate, "2024-02-29");
    assert.ok(after.legacy.some(entry => entry.id === legitimate.id));
    await assert.rejects(writeGoalOperation(owner.id, { ...classification, operationId: randomUUID() }, authority), rejectsWith(409));

    const historicalReverse = {
      kind: "reverse", goalId: legacy.id, operationId: randomUUID(),
      originalOperationId: classified.operationId, reason: "Reversión sintética",
    } as const;
    await assert.rejects(writeGoalOperation(owner.id, historicalReverse), rejectsWith(409));
    const reversed = await writeGoalOperation(owner.id, historicalReverse, authority);
    assert.equal(reversed.goal.initial, null);
    assert.equal(reversed.goal.current, "180.30");
    assert.deepEqual(await getFinanceAnalytics(owner.id, legacyQuery), original);
    const final = await read(legacy.id);
    assert.equal(final.history[0].reason, null);
    assert.ok(final.legacy.some(entry => entry.id === candidate.id));
    const classifiedAgain = await writeGoalOperation(owner.id, { ...classification, operationId: randomUUID() }, {
      historical: { ...authority.historical, caseId: "QA-124" },
    });
    assert.equal(classifiedAgain.goal.initial, "100.01");
    assert.equal(classifiedAgain.goal.current, "180.30");
    assert.deepEqual(await getFinanceAnalytics(owner.id, legacyQuery), reexpressed);

    await pool.query(
      `insert into savings_contributions (user_id, goal_id, amount, contribution_date)
       select $1, $2, 0.01, date '2024-01-01' from generate_series(1, 50)`,
      [owner.id, legacy.id],
    );
    const page = await read(legacy.id);
    assert.equal(page.legacy.length, 50);
    assert.ok(page.legacyNextCursor);
    const nextPage = await readGoalLedger(owner.id, legacy.id, undefined, page.legacyNextCursor);
    assert.ok("legacy" in nextPage && nextPage.legacy);
    assert.equal(nextPage.legacy.length, 2);
    assert.equal(nextPage.legacyNextCursor, null);
    assert.ok(nextPage.legacy.every(entry => !page.legacy.some(first => first.id === entry.id)));
    await assert.rejects(readGoalLedger(other.id, legacy.id, undefined, page.legacyNextCursor), rejectsWith(404));

    console.log("SM-01–SM-08: proyección, libro, reversión, históricos, idempotencia, concurrencia, rollback y aislamiento verificados.");
  } finally {
    await pool.end();
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
