import { type ReactNode, useId, useState } from "react";

import type {
  AnalyticsMetrics,
  AnalyticsPoint,
  AnalyticsResponse,
} from "@/features/finance/analytics/analytics.types";
import { formatCopCents, formatMoneyCents, toMoneyCents } from "@/features/finance/finance.money";

import styles from "./financial-analytics.module.css";

const metrics = {
  income: "Ingresos filtrados",
  expense: "Gastos filtrados",
  net: "Balance neto filtrado",
  savings: "Reserva neta global",
  available: "Saldo disponible global",
} as const satisfies AnalyticsMetrics<string>;

type Metric = keyof typeof metrics;

const metricKeys = Object.keys(metrics) as Metric[];
const zero = BigInt(0);
const monthFormat = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function monthLabel(month: string) {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}

function money(amount: string) {
  return formatCopCents(toMoneyCents(amount));
}

function percent(value: string | null) {
  return value === null ? "Sin base" : `${value.replace(".", ",")} %`;
}

function magnitude(value: bigint) {
  return value < zero ? -value : value;
}

function barWidth(value: bigint, maximum: bigint) {
  return maximum === zero ? "0%" : `${formatMoneyCents(magnitude(value) * BigInt(10000) / maximum)}%`;
}

function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.tableRegion} tabIndex={0} role="region" aria-label={label}>
      <table className={styles.table}>{children}</table>
    </div>
  );
}

function MonthlyChart({ series }: { series: AnalyticsPoint[] }) {
  const [metric, setMetric] = useState<Metric>("net");
  const metricId = useId();
  const values = series.map((point) => toMoneyCents(point[metric]));
  const maximum = values.reduce((largest, value) => (
    magnitude(value) > largest ? magnitude(value) : largest
  ), zero);
  const hasNegative = values.some((value) => value < zero);
  const hasPositive = values.some((value) => value > zero);

  return (
    <section className={styles.card}>
      <div className={styles.chartHeader}>
        <h3>Evolución mensual</h3>
        <label className={styles.metricControl} htmlFor={metricId}>
          Métrica
          <select
            id={metricId}
            value={metric}
            onChange={(event) => setMetric(event.target.value as Metric)}
          >
            {metricKeys.map((key) => <option key={key} value={key}>{metrics[key]}</option>)}
          </select>
        </label>
      </div>

      <div className={styles.chart} aria-hidden="true">
        {series.map((point, index) => {
          const value = values[index];
          const negative = value < zero;
          return (
            <div className={styles.chartRow} key={point.month}>
              <time dateTime={point.month}>{monthLabel(point.month)}</time>
              <span className={styles.track}>
                {hasNegative && (
                  <span className={`${styles.half} ${styles.negativeSide}`}>
                    {negative && (
                      <span className={styles.negativeBar} style={{ width: barWidth(value, maximum) }} />
                    )}
                  </span>
                )}
                {(hasPositive || !hasNegative) && (
                  <span className={styles.half}>
                    {!negative && value !== zero && (
                      <span className={styles.bar} style={{ width: barWidth(value, maximum) }} />
                    )}
                  </span>
                )}
              </span>
              <strong>{money(point[metric])}</strong>
            </div>
          );
        })}
      </div>

      <details className={styles.details}>
        <summary>Ver datos mensuales en tabla</summary>
        <TableRegion label="Datos mensuales">
          <caption className="sr-only">Importes por mes en pesos colombianos</caption>
          <thead>
            <tr>
              <th scope="col">Mes</th>
              {metricKeys.map((key) => <th key={key} scope="col">{metrics[key]}</th>)}
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.month}>
                <th scope="row"><time dateTime={point.month}>{monthLabel(point.month)}</time></th>
                {metricKeys.map((key) => <td key={key}>{money(point[key])}</td>)}
              </tr>
            ))}
          </tbody>
        </TableRegion>
      </details>
    </section>
  );
}

function MonthlyComparison({ comparison }: { comparison: AnalyticsResponse["comparison"] }) {
  const { current, previous, difference, percent: change } = comparison;

  return (
    <section className={styles.card}>
      <h3>Comparación mensual</h3>
      <p className={styles.note}>
        La variación divide la diferencia por el valor absoluto del mes anterior.
        «Sin base» indica que el valor anterior es cero.
      </p>
      <TableRegion label="Comparación mensual">
        <caption className="sr-only">Comparación entre el mes final y el mes calendario anterior</caption>
        <thead>
          <tr>
            <th scope="col">Métrica</th>
            <th scope="col"><time dateTime={previous.month}>{monthLabel(previous.month)}</time></th>
            <th scope="col"><time dateTime={current.month}>{monthLabel(current.month)}</time></th>
            <th scope="col">Diferencia</th>
            <th scope="col">Variación</th>
          </tr>
        </thead>
        <tbody>
          {metricKeys.map((key) => (
            <tr key={key}>
              <th scope="row">{metrics[key]}</th>
              <td>{money(previous[key])}</td>
              <td>{money(current[key])}</td>
              <td>{money(difference[key])}</td>
              <td>{percent(change[key])}</td>
            </tr>
          ))}
        </tbody>
      </TableRegion>
    </section>
  );
}

function CategoryDistribution({ distribution }: { distribution: AnalyticsResponse["distribution"] }) {
  const label = distribution.type === "income" ? "ingresos" : "gastos";
  const total = toMoneyCents(distribution.total);

  return (
    <section className={styles.card}>
      <h3>Distribución de {label}</h3>
      {distribution.groups.length === 0 ? (
        <p className={styles.note}>No hay {label} para distribuir con estos filtros.</p>
      ) : (
        <>
          <p className={styles.note}>Total · <strong>{money(distribution.total)}</strong></p>
          <TableRegion label={`Distribución de ${label} por categoría`}>
            <caption className="sr-only">Importe y porcentaje por categoría</caption>
            <thead>
              <tr>
                <th scope="col">Categoría</th>
                <th scope="col">Importe</th>
                <th scope="col">Participación</th>
              </tr>
            </thead>
            <tbody>
              {distribution.groups.map((group) => (
                <tr key={group.category}>
                  <th scope="row">{group.name}</th>
                  <td>{money(group.amount)}</td>
                  <td>
                    {percent(group.percent)}
                    <span className={styles.shareTrack} aria-hidden="true">
                      <span className={styles.bar} style={{ width: barWidth(toMoneyCents(group.amount), total) }} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableRegion>
        </>
      )}
    </section>
  );
}

export default function AnalyticsResults({ data }: { data: AnalyticsResponse }) {
  return (
    <div className={styles.results}>
      <div className={styles.scope}>
        <p>Reserva neta global (aportes a metas menos liberaciones) y saldo disponible acumulado sin filtros de tipo ni categoría.</p>
        <p>Saldo disponible antes del período · <strong>{money(data.openingAvailable)}</strong></p>
      </div>
      <MonthlyChart series={data.series} />
      <MonthlyComparison comparison={data.comparison} />
      <CategoryDistribution distribution={data.distribution} />
    </div>
  );
}
