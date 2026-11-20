import { type FormEvent, useLayoutEffect, useRef, useState } from "react";

import type { AnalyticsFilters, AnalyticsResponse, AnalyticsType } from "@/features/finance/analytics/analytics.types";

import { maximumMonth, minimumMonth, validPeriod } from "./financial-analytics";
import styles from "./financial-analytics.module.css";

const reportFormats = {
  csv: { label: "CSV", mime: "text/csv" },
  pdf: { label: "PDF", mime: "application/pdf", maxBytes: 8 * 1024 * 1024 },
  xlsx: {
    label: "Excel",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    maxBytes: 16 * 1024 * 1024,
  },
};

type ReportFormat = keyof typeof reportFormats;
type DownloadStatus = { message: string; kind: "pending" | "success" | "error" };
type ReportSelection = { month: string } | AnalyticsFilters;
const typeLabels = { all: "Todos", income: "Ingresos", expense: "Gastos" };

function downloadError(status: number, format: ReportFormat) {
  switch (status) {
    case 400: return "Revisa el período y los filtros antes de descargar.";
    case 401: return "Inicia sesión para descargar el reporte.";
    case 403: return "Abre Reportes en Mi Bolsillo para descargar.";
    case 413: return format === "csv"
      ? "El mes supera el límite de 10 000 movimientos para exportar."
      : "El reporte supera el tamaño permitido. Reduce el período o aplica filtros.";
    case 429: return "Ya hay una descarga en preparación. Inténtalo de nuevo.";
    case 503: return "No fue posible preparar el reporte a tiempo. Inténtalo de nuevo.";
    default: return "No fue posible descargar el reporte. Inténtalo de nuevo.";
  }
}

function reportRequest(format: ReportFormat, selection: ReportSelection) {
  if ("month" in selection) {
    return {
      path: "/api/finance/reports/export",
      query: new URLSearchParams(selection),
      filename: `mi-bolsillo-${selection.month}.csv`,
    };
  }
  return {
    path: "/api/finance/reports/analytics",
    query: new URLSearchParams({ ...selection, format }),
    filename: `mi-bolsillo-analitica-${selection.startMonth}-a-${selection.endMonth}.${format}`,
  };
}

function DownloadButtons({
  formats, selection, label,
}: {
  formats: ReportFormat[];
  selection: ReportSelection;
  label: string;
}) {
  const [status, setStatus] = useState<DownloadStatus | null>(null);
  const request = useRef<AbortController | null>(null);

  useLayoutEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  async function download(format: ReportFormat) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const config = reportFormats[format];
    const { path, query, filename } = reportRequest(format, selection);
    const isCurrent = () => request.current === controller && !controller.signal.aborted;
    setStatus({ kind: "pending", message: `Preparando ${config.label}…` });

    try {
      const response = await fetch(`${path}?${query}`, {
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!isCurrent()) return;

      const mime = response.headers.get("Content-Type")?.split(";")[0].trim();
      if (response.status !== 200 || mime !== config.mime) {
        setStatus({ kind: "error", message: downloadError(response.status, format) });
        return;
      }

      const blob = await response.blob();
      if (!isCurrent()) return;
      if (blob.size === 0 || ("maxBytes" in config && blob.size > config.maxBytes)) {
        setStatus({ kind: "error", message: downloadError(413, format) });
        return;
      }

      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      try {
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        setStatus({ kind: "success", message: `Descarga de ${config.label} iniciada.` });
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      if (isCurrent()) setStatus({ kind: "error", message: downloadError(0, format) });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  const isPending = status?.kind === "pending";
  return (
    <>
      <div className={styles.actions} role="group" aria-label={label}>
        {formats.map((format) => (
          <button key={format} type="button" className={styles.button} aria-disabled={isPending} onClick={() => void download(format)}>
            Descargar {reportFormats[format].label}
          </button>
        ))}
      </div>
      <div role="status" aria-atomic="true">
        {status && (status.kind === "success" || isPending) && <p className={styles.note}>{status.message}</p>}
      </div>
      <div role="alert" aria-atomic="true">
        {status?.kind === "error" && <p className={styles.error}>{status.message}</p>}
      </div>
    </>
  );
}

export default function FinancialReports({
  initialMonth, active, categories, analyticsFilters, catalogError, onRetryCatalog,
}: {
  initialMonth: string;
  active: boolean;
  categories?: AnalyticsResponse["categories"];
  catalogError: boolean;
  onRetryCatalog: () => void;
  analyticsFilters?: AnalyticsFilters;
}) {
  const [csvMonth, setCsvMonth] = useState(initialMonth);
  const [confirmed, setConfirmed] = useState<AnalyticsFilters>({
    startMonth: initialMonth, endMonth: initialMonth, type: "all", category: "all",
  });
  const [draft, setDraft] = useState(confirmed);
  const [periodError, setPeriodError] = useState(false);
  const categoryLabel = confirmed.category === "all" ? "Todas"
    : confirmed.category === "uncategorized" ? "Sin categoría o eliminada"
    : categories?.find(({ id }) => id === confirmed.category)?.name ?? "Categoría seleccionada";

  function applyFilters(filters: AnalyticsFilters) {
    setDraft(filters);
    setConfirmed(filters);
    setPeriodError(false);
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validPeriod(draft)) {
      setPeriodError(true);
      return;
    }
    applyFilters(draft);
  }

  const csvSelection = { startMonth: csvMonth, endMonth: csvMonth, type: "all", category: "all" } as const;

  return (
    <section className={styles.results} aria-labelledby="reports-heading">
      <h1 id="reports-heading" tabIndex={-1} className="text-2xl font-bold">Reportes</h1>
      <section className={`panel ${styles.panel}`} aria-labelledby="report-csv-heading">
        <h2 id="report-csv-heading">Movimientos mensuales</h2>
        <div className={styles.controls}>
          <label>
            Mes del CSV
            <input type="month" value={csvMonth} min={minimumMonth} max={maximumMonth} onChange={(event) => setCsvMonth(event.target.value)} />
          </label>
        </div>
        {validPeriod(csvSelection) ? (
          <>
            <p className={styles.period}>Período del CSV · <time dateTime={csvMonth}>{csvMonth}</time> · Bogotá</p>
            {active && <DownloadButtons key={csvMonth} formats={["csv"]} selection={{ month: csvMonth }} label="Descargar movimientos mensuales" />}
          </>
        ) : <p className={styles.error} role="alert">Selecciona un mes válido para el CSV.</p>}
      </section>
      <section className={`panel ${styles.panel}`} aria-labelledby="report-analytics-heading">
        <h2 id="report-analytics-heading">Reporte financiero en PDF o Excel</h2>
        <form onSubmit={submitFilters} noValidate>
          <div className={styles.controls}>
            <label>
              Desde
              <input type="month" value={draft.startMonth} min={minimumMonth} max={maximumMonth} required
                aria-invalid={periodError || undefined} aria-describedby={periodError ? "report-period-error" : undefined}
                onChange={(event) => setDraft({ ...draft, startMonth: event.target.value })} />
            </label>
            <label>
              Hasta
              <input type="month" value={draft.endMonth} min={minimumMonth} max={maximumMonth} required
                aria-invalid={periodError || undefined} aria-describedby={periodError ? "report-period-error" : undefined}
                onChange={(event) => setDraft({ ...draft, endMonth: event.target.value })} />
            </label>
            <label>
              Tipo
              <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as AnalyticsType })}>
                {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Categoría
              <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                <option value="all">Todas</option>
                <option value="uncategorized">Sin categoría o eliminada</option>
                {categories?.map(({ id, name, type }) => (
                  <option key={id} value={id}>{name} ({type === "income" ? "ingreso" : "gasto"})</option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.actions}>
            <button type="submit" className={`${styles.button} ${styles.primary}`}>Aplicar filtros</button>
            {analyticsFilters && (
              <button type="button" className={styles.button} onClick={() => applyFilters(analyticsFilters)}>
                Usar filtros de Analítica
              </button>
            )}
          </div>
          {!categories && (
            catalogError ? (
              <div className={styles.actions}>
                <p className={styles.error} role="alert">No fue posible cargar las categorías.</p>
                <button type="button" className={styles.button} onClick={onRetryCatalog}>Reintentar categorías</button>
              </div>
            ) : <p className={styles.note} role="status">Cargando categorías…</p>
          )}
          {periodError && (
            <p id="report-period-error" className={styles.error} role="alert">
              Introduce meses válidos en orden y selecciona entre 1 y 12 meses.
            </p>
          )}
        </form>
        <p className={styles.period}>
          Período aplicado · <time dateTime={confirmed.startMonth}>{confirmed.startMonth}</time> a{" "}
          <time dateTime={confirmed.endMonth}>{confirmed.endMonth}</time> · Bogotá
          {" · "}{typeLabels[confirmed.type]}{" · "}{categoryLabel}
        </p>
        {active && <DownloadButtons key={JSON.stringify(confirmed)} formats={["pdf", "xlsx"]} selection={confirmed} label="Descargar reporte financiero" />}
      </section>
    </section>
  );
}
