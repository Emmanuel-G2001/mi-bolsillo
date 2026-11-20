import { useEffect, useState } from "react";

import { formatCopCents, toMoneyCents } from "@/features/finance/finance.money";

type MonthlyInsightsResponse = {
  month: string;
  income: string;
  expense: string;
  balance: string;
  movementCount: number;
};

type InsightsResult =
  | { id: number; data: MonthlyInsightsResponse }
  | { id: number; error: string };

const countFormat = new Intl.NumberFormat("es-CO");
const insightsError = "No fue posible consultar el resumen mensual.";

export default function MonthlyInsights({
  request,
  active,
  isCurrentRequest,
  onRetry,
}: {
  request: { id: number; month: string };
  active: boolean;
  isCurrentRequest: (id: number, month: string) => boolean;
  onRetry: () => void;
}) {
  const [result, setResult] = useState<InsightsResult | null>(null);
  const { id, month } = request;
  const currentResult = result?.id === id ? result : null;

  const completedId = result?.id;
  useEffect(() => {
    if (!active || completedId === id) return;

    const controller = new AbortController();
    const isCurrent = () =>
      isCurrentRequest(id, month) && !controller.signal.aborted;

    async function loadInsights() {
      try {
        const response = await fetch(
          `/api/finance/insights?month=${encodeURIComponent(month)}`,
          { cache: "no-store", signal: controller.signal },
        );

        if (!isCurrent()) return;
        if (!response.ok) throw new Error(insightsError);

        const data: MonthlyInsightsResponse = await response.json();
        if (data.month !== month) throw new Error(insightsError);

        if (isCurrent()) setResult({ id, data });
      } catch {
        if (isCurrent()) setResult({ id, error: insightsError });
      }
    }

    if (isCurrent()) void loadInsights();
    return () => controller.abort();
  }, [active, completedId, id, month, isCurrentRequest]);

  return (
    <section className="panel mb-5" aria-labelledby="monthly-insights-heading">
      <div className="panel-head flex-wrap">
        <h2 id="monthly-insights-heading">Resumen de movimientos</h2>
      </div>

      {!currentResult ? (
        <p className="subtle" role="status">Cargando el resumen de movimientos…</p>
      ) : "error" in currentResult ? (
        <div>
          <p className="subtle" role="alert">{currentResult.error}</p>
          <button type="button" className="text-button" onClick={() => onRetry()}>
            Reintentar resumen
          </button>
        </div>
      ) : (
        <>
          {currentResult.data.movementCount === 0 && (
            <p className="subtle mb-3" role="status">Sin movimientos en este mes.</p>
          )}
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div className="min-w-0">
              <dt className="subtle">Ingresos</dt>
              <dd className="font-semibold [overflow-wrap:anywhere]">
                {formatCopCents(toMoneyCents(currentResult.data.income))}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="subtle">Gastos</dt>
              <dd className="font-semibold [overflow-wrap:anywhere]">
                {formatCopCents(toMoneyCents(currentResult.data.expense))}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="subtle">Balance del mes</dt>
              <dd className="font-semibold [overflow-wrap:anywhere]">
                {formatCopCents(toMoneyCents(currentResult.data.balance))}
              </dd>
            </div>
            <div>
              <dt className="subtle">Movimientos</dt>
              <dd className="font-semibold">
                {countFormat.format(currentResult.data.movementCount)}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
