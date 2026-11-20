import { type FormEvent, useEffect, useRef, useState } from "react";

import type {
  AnalyticsFilters,
  AnalyticsResponse,
  AnalyticsType,
} from "@/features/finance/analytics/analytics.types";

import AnalyticsResults from "./financial-analytics-results";
import styles from "./financial-analytics.module.css";

export const minimumMonth = "0100-01";
export const maximumMonth = "9999-12";
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const loadError = "No fue posible consultar la analítica financiera.";

type Props = {
  initialMonth: string;
  active: boolean;
  onResult: (data: AnalyticsResponse, mutationId: number) => void;
  onFailure: (mutationId: number) => void;
  retryToken: number;
  mutationId: number;
  isCurrentMutation: (id: number) => boolean;
};

type Result = { id: number; mutationId: number } & (
  | { data: AnalyticsResponse }
  | { error: string }
);

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

export function validPeriod({ startMonth, endMonth }: AnalyticsFilters) {
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
  active,
  onResult,
  onFailure,
  retryToken,
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
  const completedRequest = useRef<{ id: number; mutationId: number; retryToken: number } | null>(null);
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
    const completed = completedRequest.current;
    if (!active || (completed?.id === id && completed.mutationId === mutationId && completed.retryToken === retryToken)) return;

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
          completedRequest.current = { id, mutationId, retryToken };
          onFailure(mutationId);
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

        completedRequest.current = { id, mutationId, retryToken };
        setCategories(data.categories);
        onResult(data, mutationId);
        setResult({ id, mutationId, data });
      } catch {
        if (isCurrent()) {
          completedRequest.current = { id, mutationId, retryToken };
          onFailure(mutationId);
          setResult({ id, mutationId, error: loadError });
        }
      }
    }

    if (isCurrent()) void loadAnalytics();
    return () => controller.abort();
  }, [active, id, filters, mutationId, isCurrentMutation, onResult, onFailure, retryToken]);

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="analytics-heading">
      <h1 id="analytics-heading" tabIndex={-1} className="text-lg font-bold tracking-tight">Analítica financiera</h1>

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
      {current && "data" in current && <AnalyticsResults data={current.data} />}
    </section>
  );
}
