import "server-only";

import {
  and,
  eq,
} from "drizzle-orm";

import { db } from "@/db";

import {
  monthlyBudgets,
} from "@/db/schema";

import {
  getMonthInfo,
} from "@/features/finance/finance.utils";

export async function upsertBudget(
  userId: number,
  amount: number,
  month?: string,
) {
  const monthInfo =
    getMonthInfo(
      month,
    );

  const [existing] =
    await db
      .select({
        id:
          monthlyBudgets.id,
      })
      .from(
        monthlyBudgets,
      )
      .where(
        and(
          eq(
            monthlyBudgets.userId,
            userId,
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

  if (existing) {
    await db
      .update(
        monthlyBudgets,
      )
      .set({
        amount:
          amount.toFixed(
            2,
          ),

        updatedAt:
          new Date(),
      })
      .where(
        and(
          eq(
            monthlyBudgets.id,
            existing.id,
          ),

          eq(
            monthlyBudgets.userId,
            userId,
          ),
        ),
      );
  } else {
    await db
      .insert(
        monthlyBudgets,
      )
      .values({
        userId,

        year:
          monthInfo.year,

        month:
          monthInfo.month,

        amount:
          amount.toFixed(
            2,
          ),
      });
  }

  return {
    amount,
  };
}