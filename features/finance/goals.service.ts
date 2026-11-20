import "server-only";

import { randomUUID } from "node:crypto";

import {
  and,
  eq,
  or,
} from "drizzle-orm";

import { db } from "@/db";

import {
  savingsContributions,
  savingsGoals,
  savingsGoalOperations,
} from "@/db/schema";

import { GoalLedgerError, writeGoalOperation } from "./goal-ledger.service";

import {
  formatMoneyCents,
} from "@/features/finance/finance.money";

type CreateGoalInput = {
  name: string;
  target: bigint;
  current: bigint;
};

type ContributionResult =
  | {
      status:
        "not_found";
    }
  | {
      status:
        "completed";
    }
  | { status: "conflict"; error: string }
  | {
      status:
        "ok";

      appliedAmount:
        number;

      goal: {
        id: string;
        name: string;
        current: number;
        target: number;
      };
    };

export async function createGoal(
  userId: number,
  input: CreateGoalInput,
) {
  const initialSavings =
    input.current < input.target ? input.current : input.target;

  // El dinero previamente ahorrado cuenta únicamente para el progreso de la meta.
  const [created] = await db.insert(savingsGoals).values({
    userId,
    name: input.name,
    targetAmount: formatMoneyCents(input.target),
    currentAmount: formatMoneyCents(initialSavings),
    initialAmount: formatMoneyCents(initialSavings),
  }).returning();

  return {
    id: String(created.id),
    name: created.name,
    current: Number(created.currentAmount),
    target: Number(created.targetAmount),
  };
}

export async function contributeToGoal(
  userId: number,
  id: number,
  contribution: bigint,
  operationId: string = randomUUID(),
): Promise<ContributionResult> {
  try {
    const result = await writeGoalOperation(userId, { kind: "fund", goalId: id, operationId, amount: contribution });
    return {
      status: "ok",
      appliedAmount: Number(result.amount),
      goal: {
        id: String(result.goal.id), name: result.goal.name,
        current: Number(result.goal.current), target: Number(result.goal.target),
      },
    };
  } catch (error) {
    if (!(error instanceof GoalLedgerError)) throw error;
    if (error.status === 404) return { status: "not_found" };
    if (error.code === "completed") return { status: "completed" };
    return { status: "conflict", error: error.message };
  }
}

export async function deleteGoal(
  userId: number,
  id: number,
) {
  return db.transaction(
    async (tx) => {
      const [goal] =
        await tx
          .select({
            id:
              savingsGoals.id,
          })
          .from(
            savingsGoals,
          )
          .where(
            and(
              eq(
                savingsGoals.id,
                id,
              ),

              eq(
                savingsGoals.userId,
                userId,
              ),
            ),
          )
          .for("update");

      if (!goal) {
        return "not_found" as const;
      }

      // Any link must survive deletion, including inconsistent legacy links.
      const [contribution] = await tx
        .select({ id: savingsContributions.id })
        .from(savingsContributions)
        .where(eq(savingsContributions.goalId, goal.id))
        .limit(1);

      if (contribution) return "has_contributions" as const;

      const [journalEntry] = await tx.select({ id: savingsGoalOperations.operationId })
        .from(savingsGoalOperations).where(and(
          eq(savingsGoalOperations.userId, userId),
          or(eq(savingsGoalOperations.goalId, id), eq(savingsGoalOperations.destinationGoalId, id)),
        )).limit(1);
      if (journalEntry) return "has_contributions" as const;

      await tx
        .delete(
          savingsGoals,
        )
        .where(
          and(
            eq(
              savingsGoals.id,
              id,
            ),

            eq(
              savingsGoals.userId,
              userId,
            ),
          ),
        );

      return "deleted" as const;
    },
    { isolationLevel: "read committed" },
  );
}
