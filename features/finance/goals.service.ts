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

type CreateGoalInput = {
  name: string;
  target: number;
  current: number;
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
  const currentAmount =
    Math.min(
      input.current,
      input.target,
    );

  return db.transaction(
    async (tx) => {
      const [created] =
        await tx
          .insert(
            savingsGoals,
          )
          .values({
            userId,

            name:
              input.name,

            targetAmount:
              input.target.toFixed(
                2,
              ),

            currentAmount:
              currentAmount.toFixed(
                2,
              ),
          })
          .returning();

      /*
       * Si el usuario indica que ya
       * tiene dinero ahorrado al crear
       * la meta, también registramos
       * ese dinero como ahorro.
       *
       * Así sí disminuye el saldo
       * disponible.
       */
      if (
        currentAmount > 0
      ) {
        await tx
          .insert(
            savingsContributions,
          )
          .values({
            userId,

            goalId:
              created.id,

            amount:
              currentAmount.toFixed(
                2,
              ),

            contributionDate:
              getBogotaToday(),
          });
      }

      return {
        id:
          String(
            created.id,
          ),

        name:
          created.name,

        current:
          Number(
            created.currentAmount,
          ),

        target:
          Number(
            created.targetAmount,
          ),
      };
    },
  );
}

export async function contributeToGoal(
  userId: number,
  id: number,
  contribution: number,
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
          .limit(1);

      if (!goal) {
        return {
          status:
            "not_found",
        };
      }

      const current =
        Number(
          goal.currentAmount,
        );

      const target =
        Number(
          goal.targetAmount,
        );

      const remaining =
        Math.max(
          target -
            current,
          0,
        );

      if (
        remaining <= 0
      ) {
        return {
          status:
            "completed",
        };
      }

      const appliedAmount =
        Math.min(
          contribution,
          remaining,
        );

      const newCurrent =
        current +
        appliedAmount;

      const [updated] =
        await tx
          .update(
            savingsGoals,
          )
          .set({
            currentAmount:
              newCurrent.toFixed(
                2,
              ),

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
            appliedAmount.toFixed(
              2,
            ),

          contributionDate:
            getBogotaToday(),
        });

      return {
        status:
          "ok",

        appliedAmount,

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
          .limit(1);

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
  );
}