import { formatMoneyCents, toMoneyCents } from "../finance.money";
import type { AnalyticsQuery } from "./analytics.schema";
import type { AnalyticsMetrics, AnalyticsResponse } from "./analytics.types";

export type MonthlyMovements = {
  month: string;
  income: string;
  expense: string;
  globalNet: string;
  hasFilteredMovements: boolean;
};

export type MonthlySavings = { month: string; amount: string };
export type DistributionRow = { id: number | null; name: string | null; amount: string };

const zero = BigInt(0);

export function formatAnalyticsPercent(numerator: bigint, denominator: bigint): string | null {
  if (denominator === zero) return null;

  return formatRatio(numerator, denominator < zero ? -denominator : denominator);
}

function formatRatio(numerator: bigint, positiveBase: bigint): string {
  const negative = numerator < zero;
  const scaled = (negative ? -numerator : numerator) * BigInt(10000);
  // Integer division rounds to the nearest hundredth, with ties away from zero.
  const rounded = (scaled * BigInt(2) + positiveBase) / (positiveBase * BigInt(2));
  return formatMoneyCents(negative ? -rounded : rounded);
}

function mapMetrics<T>(map: (key: keyof AnalyticsMetrics<unknown>) => T): AnalyticsMetrics<T> {
  return {
    income: map("income"),
    expense: map("expense"),
    net: map("net"),
    savings: map("savings"),
    available: map("available"),
  };
}

function formatDistribution(type: "income" | "expense", rows: DistributionRow[]) {
  const amounts = rows.map((row) => ({ ...row, cents: toMoneyCents(row.amount) }));
  const total = amounts.reduce((sum, row) => sum + row.cents, zero);

  return {
    type,
    total: formatMoneyCents(total),
    groups: total === zero ? [] : amounts
      .sort((a, b) => {
        if (a.cents !== b.cents) return a.cents > b.cents ? -1 : 1;
        return (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER);
      })
      .map(({ id, name, cents }) => ({
        category: id === null ? "uncategorized" : String(id),
        name: name ?? "Sin categoría o eliminada",
        amount: formatMoneyCents(cents),
        percent: total < zero ? formatRatio(-cents, -total) : formatRatio(cents, total),
      })),
  };
}

export function buildAnalyticsResponse(
  query: AnalyticsQuery,
  categories: AnalyticsResponse["categories"],
  opening: { net: string; savings: string },
  movements: MonthlyMovements[],
  savings: MonthlySavings[],
  distribution: DistributionRow[],
): AnalyticsResponse {
  const openingAvailable = toMoneyCents(opening.net) - toMoneyCents(opening.savings);
  const movementByMonth = new Map(movements.map((row) => [row.month, row]));
  const savingsByMonth = new Map(savings.map((row) => [row.month, toMoneyCents(row.amount)]));

  function metrics(month: string, available: bigint): AnalyticsMetrics<bigint> {
    const movement = movementByMonth.get(month);
    const income = toMoneyCents(movement?.income ?? "0");
    const expense = toMoneyCents(movement?.expense ?? "0");
    return { income, expense, net: income - expense, savings: savingsByMonth.get(month) ?? zero, available };
  }

  let available = openingAvailable;
  const points = query.months.map((month) => {
    available += toMoneyCents(movementByMonth.get(month)?.globalNet ?? "0") - (savingsByMonth.get(month) ?? zero);
    return { month, ...metrics(month, available) };
  });
  const current = points[points.length - 1];
  const previous = points[points.length - 2] ?? {
    month: query.previousMonth,
    ...metrics(query.previousMonth, openingAvailable),
  };
  const difference = mapMetrics((key) => current[key] - previous[key]);
  const series = points.map((point) => ({ month: point.month, ...mapMetrics((key) => formatMoneyCents(point[key])) }));

  return {
    filters: query.filters,
    categories,
    openingAvailable: formatMoneyCents(openingAvailable),
    hasFilteredMovements: query.months.some((month) => movementByMonth.get(month)?.hasFilteredMovements),
    series,
    comparison: {
      current: series[series.length - 1],
      previous: { month: previous.month, ...mapMetrics((key) => formatMoneyCents(previous[key])) },
      difference: mapMetrics((key) => formatMoneyCents(difference[key])),
      percent: mapMetrics((key) => formatAnalyticsPercent(difference[key], previous[key])),
    },
    distribution: formatDistribution(query.filters.type === "income" ? "income" : "expense", distribution),
  };
}
