import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { savingsContributions, savingsGoalOperations, savingsGoals } from "@/db/schema";
import { formatMoneyCents, toMoneyCents } from "./finance.money";
import { getBogotaToday } from "./finance.utils";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Goal = typeof savingsGoals.$inferSelect;
type Entry = typeof savingsGoalOperations.$inferSelect;
type Operation = {
  kind: "fund" | "release" | "transfer" | "archive" | "restore" | "close" | "reverse" | "reclassify";
  goalId: number;
  operationId: string;
  amount?: bigint;
  destinationGoalId?: number;
  reason?: string;
  originalOperationId?: string;
  legacyContributionId?: number;
};

type HistoricalApproval = {
  caseId: string;
  evidenceReference: string;
  evidenceDigest: string;
  authorizedBy: string;
  expectedEconomicDate: string;
};

function validApproval(approval: HistoricalApproval | undefined): approval is HistoricalApproval {
  return approval !== undefined && /^[0-9a-f]{64}$/i.test(approval.evidenceDigest) &&
    /^\d{4}-\d{2}-\d{2}$/.test(approval.expectedEconomicDate) &&
    [approval.caseId, approval.evidenceReference, approval.authorizedBy]
      .every(value => value.trim().length > 0 && value.length <= 240);
}

const zero = BigInt(0);

export class GoalLedgerError extends Error {
  constructor(public status: 404 | 409, message: string, public code?: "completed") {
    super(message);
  }
}

function conflict(message: string): never {
  throw new GoalLedgerError(409, message);
}

function notFound(): never {
  throw new GoalLedgerError(404, "Meta u operación no encontrada.");
}

function status(goal: Goal) {
  return goal.closedAt ? "closed" : goal.archivedAt ? "archived" : "active";
}

// Reversals store the original endpoints and amount. The sign is resolved from
// the original kind, so a transfer reversal affects both of its original goals.
async function reserves(tx: Tx, userId: number, goalIds: number[]) {
  const balances = new Map<number, bigint>();
  if (!goalIds.length) return balances;
  const result = await tx.execute<{ goal_id: number; amount: string }>(sql`
    with edges as (
      select
        e.goal_id,
        e.destination_goal_id,
        case when e.kind = 'reverse' then original.kind else e.kind end as kind,
        case when e.kind = 'reverse' then -e.amount else e.amount end as amount
      from savings_goal_operations e
      left join savings_goal_operations original
        on original.user_id = e.user_id and original.operation_id = e.original_operation_id
      where e.user_id = ${userId}
    ), deltas as (
      select goal_id, case when kind = 'fund' then amount else -amount end as amount
        from edges where kind in ('fund', 'release', 'transfer')
      union all
      select destination_goal_id, amount from edges where kind = 'transfer'
    )
    select goal_id, sum(amount)::text as amount from deltas
    where goal_id in (${sql.join(goalIds.map(id => sql`${id}`), sql`, `)})
    group by goal_id
  `);
  for (const row of result.rows) balances.set(row.goal_id, toMoneyCents(row.amount));
  return balances;
}

function badge(goal: Goal, reserved = zero) {
  const current = toMoneyCents(goal.currentAmount);
  const initial = goal.initialAmount === null ? null : toMoneyCents(goal.initialAmount);
  return {
    id: goal.id, name: goal.name, target: goal.targetAmount, current: goal.currentAmount,
    initial: goal.initialAmount, reserved: formatMoneyCents(reserved),
    unverified: formatMoneyCents(current - (initial ?? zero) - reserved), status: status(goal),
  };
}

type GoalView = ReturnType<typeof badge>;
export type GoalOperationResult = { operationId: string; amount: string | null; goal: GoalView; destination: GoalView | null };

function hasUnverifiedProgress(goal: Goal, reserved: bigint) {
  return toMoneyCents(goal.currentAmount) !== toMoneyCents(goal.initialAmount ?? "0") + reserved;
}

async function hasUnverifiedLegacyEntries(tx: Tx, userId: number, goalId: number) {
  const result = await tx.execute(sql`
    select 1 from savings_contributions legacy
    where legacy.user_id = ${userId} and legacy.goal_id = ${goalId}
      and not exists (
        select 1 from savings_goal_operations classification
        where classification.user_id = legacy.user_id
          and classification.goal_id = legacy.goal_id
          and classification.legacy_contribution_id = legacy.id
          and classification.kind = 'reclassify'
          and not exists (
            select 1 from savings_goal_operations reversal
            where reversal.user_id = classification.user_id
              and reversal.original_operation_id = classification.operation_id
          )
      )
    limit 1
  `);
  return result.rows.length > 0;
}

async function hasReserveDebit(tx: Tx, userId: number, goalId: number) {
  const result = await tx.execute(sql`
    select 1
    from savings_goal_operations operation
    left join savings_goal_operations original
      on operation.kind = 'reverse'
      and original.user_id = operation.user_id
      and original.operation_id = operation.original_operation_id
    where operation.user_id = ${userId}
      and (
        (operation.goal_id = ${goalId} and operation.kind in ('release', 'transfer'))
        or (operation.kind = 'reverse' and (
          (operation.goal_id = ${goalId} and original.kind = 'fund')
          or (operation.destination_goal_id = ${goalId} and original.kind = 'transfer')
        ))
      )
    limit 1
  `);
  return result.rows.length > 0;
}

function validateMovement(goal: Goal, reserved: bigint, delta: bigint) {
  if (status(goal) !== "active") conflict("Restaura la meta antes de mover fondos.");
  if (reserved + delta < zero) conflict("La meta no tiene suficientes fondos reservados.");
  if (toMoneyCents(goal.currentAmount) + delta > toMoneyCents(goal.targetAmount)) {
    conflict("El importe supera la capacidad de la meta.");
  }
  if (toMoneyCents(goal.currentAmount) + delta < zero) {
    conflict("No se puede dejar el progreso en negativo.");
  }
}

async function changeProgress(tx: Tx, goal: Goal, delta: bigint) {
  const [updated] = await tx.update(savingsGoals).set({
    currentAmount: formatMoneyCents(toMoneyCents(goal.currentAmount) + delta),
    updatedAt: new Date(),
  }).where(and(eq(savingsGoals.userId, goal.userId), eq(savingsGoals.id, goal.id))).returning();
  return updated;
}

async function findEntry(tx: Tx, userId: number, operationId: string) {
  const [entry] = await tx.select().from(savingsGoalOperations).where(and(
    eq(savingsGoalOperations.userId, userId), eq(savingsGoalOperations.operationId, operationId),
  ));
  return entry;
}

function fingerprint(input: Operation, historical?: HistoricalApproval) {
  return createHash("sha256").update(JSON.stringify([
    input.kind, input.goalId, input.amount?.toString(), input.destinationGoalId ?? null,
    input.reason ?? null, input.originalOperationId ?? null, input.legacyContributionId ?? null,
    historical ? [historical.caseId, historical.evidenceReference, historical.evidenceDigest, historical.authorizedBy, historical.expectedEconomicDate] : null,
  ])).digest("hex");
}

export async function writeGoalOperation(
  userId: number,
  input: Operation,
  options: { historical?: HistoricalApproval } = {},
): Promise<GoalOperationResult> {
  const hash = fingerprint(input, options.historical);
  if (input.kind === "reclassify" && !validApproval(options.historical)) {
    conflict("Se requiere una conciliación histórica autorizada.");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local datestyle to 'ISO, YMD'`);
    // Serializes even repeated UUIDs aimed at different goals. Goal locks also
    // coordinate with the existing hard-delete path.
    await tx.execute(sql`select pg_advisory_xact_lock(20726715, ${userId})`);
    const prior = await findEntry(tx, userId, input.operationId);
    if (prior) {
      if (prior.requestHash !== hash) conflict("La clave de operación ya se usó con otros datos.");
      const saved = prior.result as GoalOperationResult;
      return { operationId: saved.operationId, amount: saved.amount, goal: saved.goal, destination: saved.destination };
    }

    let original: Entry | undefined;
    if (input.kind === "reverse") {
      if (!input.originalOperationId) notFound();
      original = await findEntry(tx, userId, input.originalOperationId);
      if (!original || original.goalId !== input.goalId) notFound();
      const permitted = ["fund", "release", "transfer"].includes(original.kind) ||
        (original.kind === "reclassify" && validApproval(options.historical));
      if (!permitted) conflict("Esta operación no se puede revertir.");
      const [reversed] = await tx.select({ id: savingsGoalOperations.operationId }).from(savingsGoalOperations).where(
        and(eq(savingsGoalOperations.userId, userId), eq(savingsGoalOperations.originalOperationId, original.operationId)),
      );
      if (reversed) conflict("La operación ya fue revertida.");
    }

    const destinationId = original?.destinationGoalId ?? input.destinationGoalId;
    if (destinationId === input.goalId) conflict("Elige una meta de destino distinta.");
    const goalIds = [input.goalId, ...(destinationId ? [destinationId] : [])];
    const locked = await tx.select().from(savingsGoals).where(and(
      eq(savingsGoals.userId, userId), inArray(savingsGoals.id, goalIds),
    )).orderBy(savingsGoals.id).for("update");
    const source = locked.find(goal => goal.id === input.goalId);
    const target = locked.find(goal => goal.id === destinationId);
    if (!source || (destinationId && !target)) notFound();

    // The ledger does not assign debits to credits or establish causal order.
    // Any debit makes the original credit's remaining provenance uncertain.
    const debitedGoalId = original?.kind === "fund" ? source.id
      : original?.kind === "transfer" ? target?.id : undefined;
    if (debitedGoalId !== undefined && await hasReserveDebit(tx, userId, debitedGoalId)) {
      conflict("No se puede verificar que los fondos del asiento original sigan reservados.");
    }

    const balances = await reserves(tx, userId, goalIds);
    const sourceReserve = balances.get(source.id) ?? zero;
    const targetReserve = target ? balances.get(target.id) ?? zero : zero;
    let sourceAfter = source;
    let targetAfter = target;
    let sourceDelta = zero;
    let targetDelta = zero;
    let economicDate = getBogotaToday();
    let amount: bigint | undefined = input.amount;
    let legacyContributionId: number | undefined;
    let historicalAudit: { approval: HistoricalApproval; initialBefore: string | null } | undefined;

    const kind = original?.kind ?? input.kind;
    if (kind === "fund" || kind === "release" || kind === "transfer") {
      if (original) amount = original.amount ? toMoneyCents(original.amount) : undefined;
      if (!amount || amount <= zero) conflict("El importe debe ser mayor que cero.");
      if (kind === "fund" && !original) {
        const capacity = toMoneyCents(source.targetAmount) - toMoneyCents(source.currentAmount);
        if (capacity <= zero) throw new GoalLedgerError(409, "La meta ya está completada.", "completed");
        if (amount > capacity) amount = capacity;
      }
      sourceDelta = kind === "fund" ? amount : -amount;
      if (original) sourceDelta = -sourceDelta;
      validateMovement(source, sourceReserve, sourceDelta);
      if (kind === "transfer") {
        if (!target) notFound();
        targetDelta = -sourceDelta;
        validateMovement(target, targetReserve, targetDelta);
        targetAfter = await changeProgress(tx, target, targetDelta);
      }
      sourceAfter = await changeProgress(tx, source, sourceDelta);
    } else if (kind === "reclassify") {
      if (!validApproval(options.historical) || !input.reason?.trim() || status(source) === "closed") {
        conflict("Se requiere una conciliación histórica autorizada.");
      }
      const legacyId = original?.legacyContributionId ?? input.legacyContributionId;
      if (!legacyId) notFound();
      const [legacy] = await tx.select().from(savingsContributions).where(and(
        eq(savingsContributions.id, legacyId), eq(savingsContributions.goalId, source.id),
        eq(savingsContributions.userId, userId),
      )).for("update");
      if (!legacy) notFound();
      if (legacy.contributionDate !== options.historical.expectedEconomicDate ||
        (original && (original.economicDate !== legacy.contributionDate || original.amount !== legacy.amount))) {
        conflict("La fecha o el importe histórico ya no coincide con el expediente.");
      }
      legacyContributionId = original ? undefined : legacy.id;
      economicDate = legacy.contributionDate;
      amount = toMoneyCents(legacy.amount);
      if (amount <= zero || (!original && input.amount !== amount)) {
        conflict("El importe histórico ya no coincide con la evidencia.");
      }
      if (!original) {
        if (source.initialAmount !== null) conflict("La meta ya tiene un importe inicial identificado.");
        const active = await tx.execute(sql`
          select 1 from savings_goal_operations c where c.user_id = ${userId}
            and c.kind = 'reclassify' and c.legacy_contribution_id = ${legacy.id}
            and not exists (select 1 from savings_goal_operations r
              where r.user_id = c.user_id and r.original_operation_id = c.operation_id)
        `);
        if (active.rows.length) conflict("El aporte ya tiene una clasificación vigente.");
      }
      const newInitial = toMoneyCents(source.initialAmount ?? "0") + (original ? -amount : amount);
      if (newInitial < zero || newInitial + sourceReserve > toMoneyCents(source.currentAmount)) {
        conflict("La reclasificación no coincide con el progreso de la meta.");
      }
      // Restore the recorded provenance, including the distinction between zero and unknown.
      const recordedAudit = (original?.result as { historicalAudit?: typeof historicalAudit } | undefined)?.historicalAudit;
      if (original && (!recordedAudit || toMoneyCents(recordedAudit.initialBefore ?? "0") !== newInitial)) {
        conflict("La meta no coincide con la procedencia del asiento original.");
      }
      historicalAudit = { approval: options.historical, initialBefore: source.initialAmount };
      [sourceAfter] = await tx.update(savingsGoals).set({
        initialAmount: recordedAudit ? recordedAudit.initialBefore : formatMoneyCents(newInitial), updatedAt: new Date(),
      }).where(and(eq(savingsGoals.userId, userId), eq(savingsGoals.id, source.id))).returning();
    } else {
      const currentStatus = status(source);
      if ((kind === "archive" && currentStatus !== "active") ||
        (kind === "restore" && currentStatus !== "archived") ||
        (kind === "close" && currentStatus !== "active")) {
        conflict("La acción no está disponible para el estado de esta meta.");
      }
      if (kind === "close" && (sourceReserve !== zero || hasUnverifiedProgress(source, sourceReserve) ||
        await hasUnverifiedLegacyEntries(tx, userId, source.id))) {
        conflict("Libera o transfiere la reserva y concilia los importes pendientes antes de cerrar.");
      }
      const now = new Date();
      [sourceAfter] = await tx.update(savingsGoals).set({
        updatedAt: now,
        ...(kind === "close" ? { closedAt: now } : { archivedAt: kind === "archive" ? now : null }),
      }).where(and(eq(savingsGoals.userId, userId), eq(savingsGoals.id, source.id))).returning();
    }

    const result = {
      operationId: input.operationId, amount: amount === undefined ? null : formatMoneyCents(amount),
      goal: badge(sourceAfter, sourceReserve + sourceDelta),
      destination: targetAfter ? badge(targetAfter, targetReserve + targetDelta) : null,
    };
    await tx.insert(savingsGoalOperations).values({
      userId, operationId: input.operationId, kind: input.kind, goalId: source.id,
      destinationGoalId: target?.id, amount: result.amount, reason: input.reason,
      economicDate, originalOperationId: original?.operationId,
      legacyContributionId, requestHash: hash, result: historicalAudit ? { ...result, historicalAudit } : result,
    });
    return result;
  }, { isolationLevel: "read committed" });
}

export async function readGoalLedger(userId: number, goalId?: number, before?: string, legacyBefore?: number) {
  return db.transaction(async tx => {
    await tx.execute(sql`set local datestyle to 'ISO, YMD'`);
    const owner = eq(savingsGoals.userId, userId);
    const goals = await tx.select().from(savingsGoals).where(goalId
      ? and(owner, eq(savingsGoals.id, goalId)) : owner).orderBy(savingsGoals.id);
    const balances = await reserves(tx, userId, goals.map(goal => goal.id));
    if (!goalId) return { goals: goals.map(goal => badge(goal, balances.get(goal.id))) };
    const [goal] = goals;
    if (!goal) notFound();
    const offset = before ? await findEntry(tx, userId, before) : undefined;
    if (before && (!offset || (offset.goalId !== goalId && offset.destinationGoalId !== goalId))) notFound();
    const entries = await tx.select({
      operationId: savingsGoalOperations.operationId, kind: savingsGoalOperations.kind,
      goalId: savingsGoalOperations.goalId, destinationGoalId: savingsGoalOperations.destinationGoalId,
      amount: savingsGoalOperations.amount, reason: sql<string | null>`case
        when savings_goal_operations.legacy_contribution_id is null
          and not exists (select 1 from savings_goal_operations classified
            where classified.user_id = savings_goal_operations.user_id
              and classified.operation_id = savings_goal_operations.original_operation_id
              and classified.kind = 'reclassify')
        then savings_goal_operations.reason end`,
      economicDate: savingsGoalOperations.economicDate, createdAt: savingsGoalOperations.createdAt,
      originalOperationId: savingsGoalOperations.originalOperationId,
      legacyContributionId: savingsGoalOperations.legacyContributionId,
      reversed: sql<boolean>`exists (select 1 from savings_goal_operations reversal
        where reversal.user_id = savings_goal_operations.user_id
          and reversal.original_operation_id = savings_goal_operations.operation_id)`,
    }).from(savingsGoalOperations).where(and(
      eq(savingsGoalOperations.userId, userId), or(
        eq(savingsGoalOperations.goalId, goalId), eq(savingsGoalOperations.destinationGoalId, goalId),
      ),
      offset ? sql`(${savingsGoalOperations.createdAt}, ${savingsGoalOperations.operationId}) <
        ((select created_at from savings_goal_operations where user_id = ${userId} and operation_id = ${offset.operationId}), ${offset.operationId}::uuid)` : undefined,
    )).orderBy(desc(savingsGoalOperations.createdAt), desc(savingsGoalOperations.operationId)).limit(51);
    const history = entries.slice(0, 50);
    const legacyOwner = and(eq(savingsContributions.userId, userId), eq(savingsContributions.goalId, goalId));
    const [legacyOffset] = legacyBefore === undefined ? [] : await tx.select({
      id: savingsContributions.id,
      date: savingsContributions.contributionDate,
    }).from(savingsContributions).where(and(legacyOwner, eq(savingsContributions.id, legacyBefore)));
    if (legacyBefore !== undefined && !legacyOffset) notFound();
    const legacyRows = await tx.select({
      id: savingsContributions.id, amount: savingsContributions.amount, economicDate: savingsContributions.contributionDate,
    }).from(savingsContributions).where(and(
      legacyOwner, legacyOffset ? sql`(${savingsContributions.contributionDate}, ${savingsContributions.id}) <
        (${legacyOffset.date}::date, ${legacyOffset.id})` : undefined,
    )).orderBy(desc(savingsContributions.contributionDate), desc(savingsContributions.id)).limit(51);
    return {
      goal: badge(goal, balances.get(goal.id)), history, legacy: legacyRows.slice(0, 50),
      nextCursor: entries.length > 50 ? history[49].operationId : null,
      legacyNextCursor: legacyRows.length > 50 ? legacyRows[49].id : null,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
