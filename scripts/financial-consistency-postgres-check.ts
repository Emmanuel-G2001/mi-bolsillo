// QA externo A1–A3. Requiere Node 22.15+ y PostgreSQL 16 local desechable.
// Configura DATABASE_URL con loopback y una base vacía `mi_bolsillo_qa`,
// aplica las migraciones existentes con `pnpm exec drizzle-kit migrate` y ejecuta:
// node --import tsx scripts/financial-consistency-postgres-check.ts
// Este script crea y elimina únicamente sus propios usuarios sintéticos.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";

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
  } finally {
    await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]).finally(() => pool.end());
  }
}

void main().catch(() => {
  console.error(`Falló la comprobación de PostgreSQL aislado durante ${stage}.`);
  process.exitCode = 1;
});
