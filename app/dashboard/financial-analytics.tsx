import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  AnalyticsFilters,
  AnalyticsResponse,
  AnalyticsType,
} from "@/features/finance/analytics/analytics.types";

import AnalyticsResults from "./financial-analytics-results";
import styles from "./financial-analytics.module.css";

const minimumMonth = "0100-01";
const maximumMonth = "9999-12";
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const loadError = "No fue posible consultar la analítica financiera.";

type Props = {
  initialMonth: string;
  mutationId: number;
  isCurrentMutation: (id: number) => boolean;
};

type Result = { id: number; mutationId: number } & (
  | { data: AnalyticsResponse }
  | { error: string }
);

const reportFormats = {
  pdf: { label: "PDF", mime: "application/pdf", maxBytes: 8 * 1024 * 1024 },
  xlsx: {
    label: "XLSX",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    maxBytes: 16 * 1024 * 1024,
  },
} as const;

type ReportFormat = keyof typeof reportFormats;
type ReportStatus = { message: string; kind: "pending" | "success" | "error" };

const reportError = "No fue posible descargar el reporte. Inténtalo de nuevo.";
const reportErrors: Partial<Record<number, string>> = {
  400: "Vuelve a aplicar los filtros antes de descargar el reporte.",
  401: "Inicia sesión para descargar el reporte.",
  403: "Abre Analítica en Mi Bolsillo para descargar el reporte.",
  413: "El reporte supera el tamaño permitido. Reduce el período o aplica filtros.",
  429: "Ya hay una descarga en preparación. Inténtalo de nuevo.",
  503: "No fue posible preparar el reporte a tiempo. Inténtalo de nuevo.",
};

function ReportDownloads({
  filters,
  isCurrentSelection,
}: {
  filters: AnalyticsFilters;
  isCurrentSelection: () => boolean;
}) {
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const active = useRef<AbortController | null>(null);

  useLayoutEffect(() => () => active.current?.abort(), []);

  async function download(format: ReportFormat) {
    if (active.current || !isCurrentSelection()) return;

    const controller = new AbortController();
    active.current = controller;
    const isCurrent = () =>
      active.current === controller && !controller.signal.aborted && isCurrentSelection();
    const { label, mime, maxBytes } = reportFormats[format];
    setStatus({ kind: "pending", message: `Preparando ${label}…` });

    try {
      const query = new URLSearchParams({ ...filters, format });
      const response = await fetch(`/api/finance/reports/analytics?${query}`, {
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!isCurrent()) return;

      const responseMime = response.headers.get("Content-Type")?.split(";")[0].trim();
      if (response.status !== 200 || responseMime !== mime) {
        setStatus({ kind: "error", message: reportErrors[response.status] ?? reportError });
        return;
      }

      const blob = await response.blob();
      if (!isCurrent()) return;
      if (blob.size === 0 || blob.size > maxBytes) {
        setStatus({ kind: "error", message: reportError });
        return;
      }

      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      try {
        link.href = url;
        link.download = `mi-bolsillo-analitica-${filters.startMonth}-a-${filters.endMonth}.${format}`;
        document.body.append(link);
        link.click();
        setStatus({ kind: "success", message: `Descarga de ${label} iniciada.` });
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      if (isCurrent()) setStatus({ kind: "error", message: reportError });
    } finally {
      if (active.current === controller) active.current = null;
      controller.abort();
    }
  }

  const pending = status?.kind === "pending";
  return (
    <>
      <div className={styles.actions} role="group" aria-label="Descargar reportes de analítica">
        <button type="button" className={styles.button} aria-disabled={pending} onClick={() => void download("pdf")}>
          Descargar PDF
        </button>
        <button type="button" className={styles.button} aria-disabled={pending} onClick={() => void download("xlsx")}>
          Descargar XLSX
        </button>
      </div>
      <div role="status" aria-atomic="true">
        {status && status.kind !== "error" && <p className={styles.note}>{status.message}</p>}
      </div>
      <div role="alert" aria-atomic="true">
        {status?.kind === "error" && <p className={styles.error}>{status.message}</p>}
      </div>
    </>
  );
}

function monthIndex(month: string) {
  const [year, monthOfYear] = month.split("-").map(Number);
  return year * 12 + monthOfYear - 1;
}

function presetStart(anchor: string, months: number) {
  const start = Math.max(monthIndex(minimumMonth), monthIndex(anchor) - months + 1);
  const year = String(Math.floor(start / 12)).padStart(4, "0");
  const month = String(start % 12 + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function validPeriod({ startMonth, endMonth }: AnalyticsFilters) {
  return (
    monthPattern.test(startMonth) &&
    monthPattern.test(endMonth) &&
    startMonth >= minimumMonth &&
    endMonth <= maximumMonth &&
    startMonth <= endMonth &&
    monthIndex(endMonth) - monthIndex(startMonth) < 12
  );
}

function matchesFilters(actual: AnalyticsFilters, expected: AnalyticsFilters) {
  return actual.startMonth === expected.startMonth &&
    actual.endMonth === expected.endMonth &&
    actual.type === expected.type &&
    actual.category === expected.category;
}

export default function FinancialAnalytics({
  initialMonth,
  mutationId,
  isCurrentMutation,
}: Props) {
  const [defaultFilters] = useState<AnalyticsFilters>(() => ({
    startMonth: presetStart(initialMonth, 6),
    endMonth: initialMonth,
    type: "all",
    category: "all",
  }));
  const [draft, setDraft] = useState(defaultFilters);
  const [request, setRequest] = useState({ id: 0, filters: defaultFilters });
  const [categories, setCategories] = useState<AnalyticsResponse["categories"]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [periodError, setPeriodError] = useState(false);

  const latestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const { id, filters } = request;
  const current = result?.id === id && result.mutationId === mutationId ? result : null;

  function requestAnalytics(nextFilters: AnalyticsFilters) {
    const nextId = ++latestId.current;
    activeController.current?.abort();
    setRequest({ id: nextId, filters: nextFilters });
  }

  function applyPeriod(filters: AnalyticsFilters) {
    setDraft(filters);
    setPeriodError(false);
    requestAnalytics(filters);
  }

  function applyPreset(months: number) {
    const anchor = defaultFilters.endMonth;
    applyPeriod({ ...draft, startMonth: presetStart(anchor, months), endMonth: anchor });
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validPeriod(draft)) {
      setPeriodError(true);
      return;
    }
    applyPeriod(draft);
  }

  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    const isCurrent = () =>
      id === latestId.current && isCurrentMutation(mutationId) && !controller.signal.aborted;

    async function loadAnalytics() {
      try {
        const query = new URLSearchParams(filters);
        const response = await fetch(`/api/finance/analytics?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        if (!response.ok) {
          setResult({
            id,
            mutationId,
            error: response.status === 400
              ? "Revisa el período y la categoría seleccionados."
              : response.status === 401 ? "Inicia sesión para consultar la analítica." : loadError,
          });
          return;
        }

        const data: AnalyticsResponse = await response.json();
        if (!isCurrent()) return;
        if (!matchesFilters(data.filters, filters)) throw new Error(loadError);

        setCategories(data.categories);
        setResult({ id, mutationId, data });
      } catch {
        if (isCurrent()) setResult({ id, mutationId, error: loadError });
      }
    }

    if (isCurrent()) void loadAnalytics();
    return () => controller.abort();
  }, [id, filters, mutationId, isCurrentMutation]);

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="analytics-heading">
      <h2 id="analytics-heading">Analítica financiera</h2>

      <div className={styles.actions} role="group" aria-label="Períodos predefinidos">
        <button type="button" className={styles.button} onClick={() => applyPreset(6)}>
          6 meses
        </button>
        <button type="button" className={styles.button} onClick={() => applyPreset(12)}>
          12 meses
        </button>
        <button type="button" className={styles.button} onClick={() => applyPeriod(defaultFilters)}>
          Restaurar filtros
        </button>
      </div>

      <form onSubmit={submitFilters} noValidate>
        <div className={styles.controls}>
          <label>
            Desde
            <input
              type="month"
              value={draft.startMonth}
              min={minimumMonth}
              max={maximumMonth}
              required
              placeholder="AAAA-MM"
              aria-invalid={periodError || undefined}
              aria-describedby={periodError ? "analytics-period-error" : undefined}
              onChange={(event) => setDraft({ ...draft, startMonth: event.target.value })}
            />
          </label>
          <label>
            Hasta
            <input
              type="month"
              value={draft.endMonth}
              min={minimumMonth}
              max={maximumMonth}
              required
              placeholder="AAAA-MM"
              aria-invalid={periodError || undefined}
              aria-describedby={periodError ? "analytics-period-error" : undefined}
              onChange={(event) => setDraft({ ...draft, endMonth: event.target.value })}
            />
          </label>
          <label>
            Tipo
            <select
              value={draft.type}
              onChange={(event) => setDraft({ ...draft, type: event.target.value as AnalyticsType })}
            >
              <option value="all">Todos</option>
              <option value="income">Ingresos</option>
              <option value="expense">Gastos</option>
            </select>
          </label>
          <label>
            Categoría
            <select
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            >
              <option value="all">Todas</option>
              <option value="uncategorized">Sin categoría o eliminada</option>
              {categories.map(({ id, name, type }) => (
                <option key={id} value={id}>
                  {name} ({type === "income" ? "ingreso" : "gasto"})
                </option>
              ))}
            </select>
          </label>
          <button className={`${styles.button} ${styles.primary}`} type="submit">
            Aplicar filtros
          </button>
        </div>
        {periodError && (
          <p className={styles.error} id="analytics-period-error" role="alert">
            Introduce meses válidos (AAAA-MM) en orden y selecciona entre 1 y 12 meses.
          </p>
        )}
      </form>

      <p className={styles.period}>
        Período aplicado · <time dateTime={filters.startMonth}>{filters.startMonth}</time> a{" "}
        <time dateTime={filters.endMonth}>{filters.endMonth}</time> · Bogotá
      </p>

      <div role="status" aria-atomic="true">
        {!current && <p>Cargando analítica…</p>}
        {current && "data" in current && !current.data.hasFilteredMovements && (
          <p>No hay movimientos para los filtros aplicados.</p>
        )}
      </div>
      {current && "error" in current && (
        <div className={styles.actions}>
          <p className={styles.error} role="alert">{current.error}</p>
          <button type="button" className={styles.button} onClick={() => requestAnalytics(filters)}>
            Reintentar
          </button>
        </div>
      )}
      {current && "data" in current && (
        <>
          <ReportDownloads
            key={`${id}:${mutationId}`}
            filters={current.data.filters}
            isCurrentSelection={() => id === latestId.current && isCurrentMutation(mutationId)}
          />
          <AnalyticsResults data={current.data} />
        </>
      )}
    </section>
  );
}
