import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { monthlyBudgets, users } from "@/db/schema";

import { formatMoneyCents, moneyCentsToNumber } from "@/features/finance/finance.money";
import { getMonthInfo } from "@/features/finance/finance.utils";

export async function upsertBudget(
  userId: number,
  amount: bigint,
  month?: string,
) {
  const monthInfo = getMonthInfo(month);
  const storedAmount = formatMoneyCents(amount);

  return db.transaction(async (tx) => {
    // A user row exists even when this period has no budget to lock yet.
    await tx.select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("no key update");

    const period = and(
      eq(monthlyBudgets.userId, userId),
      eq(monthlyBudgets.year, monthInfo.year),
      eq(monthlyBudgets.month, monthInfo.month),
    );
    const existing = await tx.select({ id: monthlyBudgets.id })
      .from(monthlyBudgets)
      .where(period)
      .limit(2);

    if (existing.length > 1) {
      return null;
    }

    const [budget] = existing;
    if (budget) {
      await tx.update(monthlyBudgets)
        .set({ amount: storedAmount, updatedAt: new Date() })
        .where(and(period, eq(monthlyBudgets.id, budget.id)));
    } else {
      await tx.insert(monthlyBudgets).values({
        userId,
        year: monthInfo.year,
        month: monthInfo.month,
        amount: storedAmount,
      });
    }

    return { amount: moneyCentsToNumber(amount) };
  }, { isolationLevel: "read committed" });
}
