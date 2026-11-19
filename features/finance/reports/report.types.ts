import type { AnalyticsResponse } from "../analytics/analytics.types";
import { formatMoneyCents, toMoneyCents } from "../finance.money";

export type ReportMovement = {
  date: string;
  type: "income" | "expense";
  category: string | null;
  description: string;
  amount: string;
};

export function buildAnalyticsReport(analytics: AnalyticsResponse, movements: ReportMovement[], generatedAt: Date) {
  const zero = BigInt(0);
  const detail = movements.reduce((totals, movement) => {
    totals[movement.type] += toMoneyCents(movement.amount);
    return totals;
  }, { income: zero, expense: zero });
  const totals = analytics.series.reduce((sum, point) => ({
    income: sum.income + toMoneyCents(point.income),
    expense: sum.expense + toMoneyCents(point.expense),
    net: sum.net + toMoneyCents(point.net),
    savings: sum.savings + toMoneyCents(point.savings),
  }), { income: zero, expense: zero, net: zero, savings: zero });

  if (detail.income !== totals.income || detail.expense !== totals.expense
    || detail.income - detail.expense !== totals.net) {
    throw new Error("Los importes no concilian.");
  }

  const { filters, openingAvailable, series, comparison, distribution } = analytics;
  const { startMonth, endMonth, type } = filters;
  return {
    filters: { startMonth, endMonth, type },
    category: filters.category === "all" ? "Todas"
      : filters.category === "uncategorized" ? "Sin categoría o eliminada"
        : analytics.categories.find(({ id }) => id === filters.category)?.name ?? "Sin categoría o eliminada",
    generatedAt,
    openingAvailable,
    series,
    comparison,
    distribution: {
      type: distribution.type,
      total: distribution.total,
      groups: distribution.groups.map(({ name, amount, percent }) => ({ name, amount, percent })),
    },
    movements,
    count: movements.length,
    totals: {
      income: formatMoneyCents(totals.income),
      expense: formatMoneyCents(totals.expense),
      net: formatMoneyCents(totals.net),
      savings: formatMoneyCents(totals.savings),
      available: comparison.current.available,
    },
  };
}

export type AnalyticsReport = ReturnType<typeof buildAnalyticsReport>;

export const reportMetricLabels = {
  income: "Ingresos",
  expense: "Gastos",
  net: "Neto",
  savings: "Ahorro global",
  available: "Disponible global",
} as const;

export const reportMetricKeys = ["income", "expense", "net", "savings", "available"] as const;

export const reportTypeLabels = { all: "Todos", income: "Ingresos", expense: "Gastos" } as const;

const bogotaDate = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "America/Bogota",
});

export function formatReportGeneratedAt(date: Date) {
  return `${bogotaDate.format(date)} (Bogotá)`;
}
