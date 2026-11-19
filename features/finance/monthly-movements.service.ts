import "server-only";

import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, transactions } from "@/db/schema";

import { formatMovementInsights, type MovementMonth } from "./monthly-movements";
import { MAX_MONTHLY_EXPORT_ROWS } from "./monthly-movements.csv";

function monthlyMovementFilter(userId: number, { start, end }: MovementMonth) {
  return and(
    eq(transactions.userId, userId),
    gte(transactions.transactionDate, start),
    lt(transactions.transactionDate, end),
  );
}

export async function getMonthlyMovementInsights(userId: number, period: MovementMonth) {
  const [totals] = await db.select({
    income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)::text`,
    expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense'), 0)::text`,
    movementCount: count(),
  })
    .from(transactions)
    .where(monthlyMovementFilter(userId, period));

  return formatMovementInsights(period.month, totals);
}

export function getMonthlyMovementExportRows(userId: number, period: MovementMonth) {
  return db.select({
    date: sql<string>`to_char(${transactions.transactionDate}::timestamp, 'YYYY-MM-DD')`,
    type: transactions.type,
    category: categories.name,
    description: transactions.description,
    amount: transactions.amount,
  })
    .from(transactions)
    .leftJoin(categories, and(
      eq(categories.id, transactions.categoryId),
      eq(categories.userId, userId),
    ))
    .where(monthlyMovementFilter(userId, period))
    .orderBy(desc(transactions.transactionDate), desc(transactions.id))
    .limit(MAX_MONTHLY_EXPORT_ROWS + 1);
}
