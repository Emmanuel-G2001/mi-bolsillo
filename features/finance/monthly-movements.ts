import { z } from "zod";

import { formatMoneyCents, toMoneyCents } from "./finance.money";

const movementMonthSchema = z.string().length(7)
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
  .refine((month) => month >= "0100-01");

export function parseMovementMonth(params: URLSearchParams) {
  const months = params.getAll("month");
  if (months.length !== 1) return null;

  const parsed = movementMonthSchema.safeParse(months[0]);
  if (!parsed.success) return null;

  const month = parsed.data;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;

  // transactionDate is already a Bogotá civil date in PostgreSQL.
  return {
    month,
    start: `${month}-01`,
    end: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

export type MovementMonth = NonNullable<ReturnType<typeof parseMovementMonth>>;

export function formatMovementInsights(
  month: string,
  totals: { income: string; expense: string; movementCount: number },
) {
  const income = toMoneyCents(totals.income);
  const expense = toMoneyCents(totals.expense);

  return {
    month,
    income: formatMoneyCents(income),
    expense: formatMoneyCents(expense),
    balance: formatMoneyCents(income - expense),
    movementCount: totals.movementCount,
  };
}

export const monthlyMovementHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
