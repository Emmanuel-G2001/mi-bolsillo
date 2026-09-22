import "server-only";

import {
  and,
  desc,
  eq,
  gte,
  lt,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  categories,
  monthlyBudgets,
  savingsContributions,
  savingsGoals,
  transactions,
} from "@/db/schema";

import {
  getMonthInfo,
} from "@/features/finance/finance.utils";

type DashboardUser = {
  id: number;
  name: string;
};

export async function getFinanceDashboard(
  user: DashboardUser,
  month?: string,
) {
  const monthInfo =
    getMonthInfo(
      month,
    );

  /*
   * =======================================================
   * MOVIMIENTOS ANTERIORES
   * =======================================================
   */

  const [
    previousSummary,
  ] =
    await db
      .select({
        income:
          sql<string>`
            COALESCE(
              SUM(
                CASE
                  WHEN ${transactions.type} = 'income'
                  THEN ${transactions.amount}
                  ELSE 0
                END
              ),
              0
            )
          `,

        expense:
          sql<string>`
            COALESCE(
              SUM(
                CASE
                  WHEN ${transactions.type} = 'expense'
                  THEN ${transactions.amount}
                  ELSE 0
                END
              ),
              0
            )
          `,
      })
      .from(
        transactions,
      )
      .where(
        and(
          eq(
            transactions.userId,
            user.id,
          ),

          lt(
            transactions.transactionDate,
            monthInfo.start,
          ),
        ),
      );

  /*
   * =======================================================
   * AHORRO ANTERIOR
   * =======================================================
   */

  const [
    previousSavings,
  ] =
    await db
      .select({
        total:
          sql<string>`
            COALESCE(
              SUM(
                ${savingsContributions.amount}
              ),
              0
            )
          `,
      })
      .from(
        savingsContributions,
      )
      .where(
        and(
          eq(
            savingsContributions.userId,
            user.id,
          ),

          lt(
            savingsContributions.contributionDate,
            monthInfo.start,
          ),
        ),
      );

  const previousBalance =
    Number(
      previousSummary?.income ??
        0,
    ) -
    Number(
      previousSummary?.expense ??
        0,
    ) -
    Number(
      previousSavings?.total ??
        0,
    );

  /*
   * =======================================================
   * MOVIMIENTOS DEL MES
   * =======================================================
   */

  const transactionRows =
    await db
      .select({
        id:
          transactions.id,

        description:
          transactions.description,

        amount:
          transactions.amount,

        type:
          transactions.type,

        date:
          transactions.transactionDate,

        category:
          categories.name,
      })
      .from(
        transactions,
      )
      .leftJoin(
        categories,

        and(
          eq(
            transactions.categoryId,
            categories.id,
          ),

          eq(
            categories.userId,
            user.id,
          ),
        ),
      )
      .where(
        and(
          eq(
            transactions.userId,
            user.id,
          ),

          gte(
            transactions.transactionDate,
            monthInfo.start,
          ),

          lt(
            transactions.transactionDate,
            monthInfo.end,
          ),
        ),
      )
      .orderBy(
        desc(
          transactions.transactionDate,
        ),

        desc(
          transactions.id,
        ),
      );

  /*
   * =======================================================
   * AHORRO DEL MES
   * =======================================================
   */

  const [
    monthlySavings,
  ] =
    await db
      .select({
        total:
          sql<string>`
            COALESCE(
              SUM(
                ${savingsContributions.amount}
              ),
              0
            )
          `,
      })
      .from(
        savingsContributions,
      )
      .where(
        and(
          eq(
            savingsContributions.userId,
            user.id,
          ),

          gte(
            savingsContributions.contributionDate,
            monthInfo.start,
          ),

          lt(
            savingsContributions.contributionDate,
            monthInfo.end,
          ),
        ),
      );

  /*
   * =======================================================
   * METAS
   * =======================================================
   */

  const goalRows =
    await db
      .select()
      .from(
        savingsGoals,
      )
      .where(
        eq(
          savingsGoals.userId,
          user.id,
        ),
      )
      .orderBy(
        desc(
          savingsGoals.id,
        ),
      );

  /*
   * =======================================================
   * PRESUPUESTO
   * =======================================================
   */

  const [budgetRow] =
    await db
      .select()
      .from(
        monthlyBudgets,
      )
      .where(
        and(
          eq(
            monthlyBudgets.userId,
            user.id,
          ),

          eq(
            monthlyBudgets.year,
            monthInfo.year,
          ),

          eq(
            monthlyBudgets.month,
            monthInfo.month,
          ),
        ),
      )
      .limit(1);

  return {
    userName:
      user.name,

    month:
      monthInfo.value,

    previousBalance,

    savings:
      Number(
        monthlySavings?.total ??
          0,
      ),

    transactions:
      transactionRows.map(
        (item) => ({
          id:
            String(
              item.id,
            ),

          description:
            item.description,

          amount:
            Number(
              item.amount,
            ),

          type:
            item.type,

          category:
            item.category ??
            (
              item.type ===
              "income"
                ? "Ingresos"
                : "Otros"
            ),

          date:
            item.date,
        }),
      ),

    goals:
      goalRows.map(
        (goal) => ({
          id:
            String(
              goal.id,
            ),

          name:
            goal.name,

          current:
            Number(
              goal.currentAmount,
            ),

          target:
            Number(
              goal.targetAmount,
            ),
        }),
      ),

    budget:
      Number(
        budgetRow?.amount ??
          0,
      ),
  };
}