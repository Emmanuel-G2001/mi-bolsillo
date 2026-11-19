import { useEffect, useState } from "react";
import { Download } from "lucide-react";

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

type ExportState = {
  month: string;
  error?: string;
};

const countFormat = new Intl.NumberFormat("es-CO");
const insightsError = "No fue posible consultar el resumen mensual.";
const exportError = "No fue posible exportar los movimientos del mes.";

export default function MonthlyInsights({
  request,
  isCurrentRequest,
  onRetry,
}: {
  request: { id: number; month: string };
  isCurrentRequest: (id: number) => boolean;
  onRetry: () => void;
}) {
  const [result, setResult] = useState<InsightsResult | null>(null);
  const [exportState, setExportState] = useState<ExportState | null>(null);
  const { id, month } = request;
  const currentResult = result?.id === id ? result : null;
  const exporting = Boolean(exportState && !exportState.error);

  useEffect(() => {
    const controller = new AbortController();
    const isCurrent = () =>
      isCurrentRequest(id) && !controller.signal.aborted;

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
  }, [id, month, isCurrentRequest]);

  async function downloadCsv() {
    const exportMonth = month;
    setExportState({ month: exportMonth });

    try {
      const response = await fetch(
        `/api/finance/reports/export?month=${encodeURIComponent(exportMonth)}`,
        { cache: "no-store", credentials: "same-origin" },
      );

      if (response.status === 401) {
        setExportState({ month: exportMonth, error: "Inicia sesión para exportar." });
        return;
      }

      if (response.status === 413) {
        setExportState({
          month: exportMonth,
          error: "El mes supera el límite de 10 000 movimientos para exportar.",
        });
        return;
      }

      if (
        !response.ok ||
        response.headers.get("content-type")?.split(";")[0] !== "text/csv"
      ) {
        throw new Error(exportError);
      }

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `mi-bolsillo-${exportMonth}.csv`;
      try {
        document.body.append(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setExportState(null);
    } catch {
      setExportState({ month: exportMonth, error: exportError });
    }
  }

  return (
    <section className="panel mb-5" aria-labelledby="monthly-insights-heading">
      <div className="panel-head flex-wrap">
        <h2 id="monthly-insights-heading">Resumen de movimientos</h2>
        <button
          type="button"
          className="text-button inline-flex items-center gap-2 disabled:opacity-60"
          onClick={downloadCsv}
          disabled={exporting}
        >
          <Download size={16} aria-hidden="true" />
          {exporting ? "Preparando CSV…" : "Descargar CSV"}
        </button>
      </div>

      {exportState?.error && (
        <p className="mb-3 text-sm text-red-700" role="alert">
          {exportState.month} · {exportState.error}
        </p>
      )}

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
