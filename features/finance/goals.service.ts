import "server-only";

import {
  and,
  eq,
} from "drizzle-orm";

import { db } from "@/db";

import {
  savingsContributions,
  savingsGoals,
} from "@/db/schema";

import {
  getBogotaToday,
} from "@/features/finance/finance.utils";

import {
  formatMoneyCents,
  moneyCentsToNumber,
  toMoneyCents,
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
): Promise<ContributionResult> {
  return db.transaction(
    async (tx) => {
      const [goal] =
        await tx
          .select()
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
        return {
          status:
            "not_found",
        };
      }

      const current = toMoneyCents(goal.currentAmount);
      const target = toMoneyCents(goal.targetAmount);
      const remaining = target - current;

      if (remaining <= BigInt(0)) {
        return {
          status: "completed",
        };
      }

      const appliedCents = contribution < remaining ? contribution : remaining;
      const newCurrent = current + appliedCents;

      const [updated] =
        await tx
          .update(
            savingsGoals,
          )
          .set({
            currentAmount:
              formatMoneyCents(newCurrent),

            updatedAt:
              new Date(),
          })
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
          .returning();

      await tx
        .insert(
          savingsContributions,
        )
        .values({
          userId,

          goalId:
            goal.id,

          amount:
            formatMoneyCents(appliedCents),

          contributionDate:
            getBogotaToday(),
        });

      return {
        status:
          "ok",

        appliedAmount: moneyCentsToNumber(appliedCents),

        goal: {
          id:
            String(
              updated.id,
            ),

          name:
            updated.name,

          current:
            Number(
              updated.currentAmount,
            ),

          target:
            Number(
              updated.targetAmount,
            ),
        },
      };
    },
    { isolationLevel: "read committed" },
  );
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
        return false;
      }

      /*
       * Al eliminar una meta,
       * sus aportes desaparecen.
       *
       * Por tanto ese dinero vuelve
       * al saldo disponible.
       */
      await tx
        .delete(
          savingsContributions,
        )
        .where(
          and(
            eq(
              savingsContributions.goalId,
              id,
            ),

            eq(
              savingsContributions.userId,
              userId,
            ),
          ),
        );

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

      return true;
    },
    { isolationLevel: "read committed" },
  );
}
