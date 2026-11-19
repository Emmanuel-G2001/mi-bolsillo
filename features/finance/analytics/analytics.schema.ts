import { z } from "zod";

import { parseMovementMonth } from "../monthly-movements";

const queryKeys = ["startMonth", "endMonth", "type", "category"] as const;
const categoryId = z.string().max(10).regex(/^[1-9]\d*$/)
  .refine((value) => String(Number(value)) === value && Number(value) <= 2147483647);

const filterSchema = z.object({
  type: z.enum(["all", "income", "expense"]).default("all"),
  category: z.union([z.literal("all"), z.literal("uncategorized"), categoryId]).default("all"),
});

function monthIndex(month: string) {
  const [year, number] = month.split("-").map(Number);
  return year * 12 + number - 1;
}

function formatMonth(index: number) {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function parseAnalyticsQuery(params: URLSearchParams) {
  if (queryKeys.some((key) => params.getAll(key).length > 1)) return null;

  const start = parseMovementMonth(new URLSearchParams({ month: params.get("startMonth") ?? "" }));
  const end = parseMovementMonth(new URLSearchParams({ month: params.get("endMonth") ?? "" }));
  const filters = filterSchema.safeParse({
    type: params.get("type") ?? undefined,
    category: params.get("category") ?? undefined,
  });
  if (!start || !end || !filters.success) return null;

  const startIndex = monthIndex(start.month);
  const endIndex = monthIndex(end.month);
  const length = endIndex - startIndex + 1;
  if (length < 1 || length > 12) return null;

  const previousMonth = formatMonth(endIndex - 1);
  return {
    filters: { startMonth: start.month, endMonth: end.month, ...filters.data },
    months: Array.from({ length }, (_, offset) => formatMonth(startIndex + offset)),
    previousMonth,
    startDate: start.start,
    endDate: end.end,
    readStartDate: length === 1 ? `${previousMonth}-01` : start.start,
  };
}

export type AnalyticsQuery = NonNullable<ReturnType<typeof parseAnalyticsQuery>>;
