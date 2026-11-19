import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";

import { toMoneyCents } from "../finance.money";
import {
  collectReportBytes,
  createReportWork,
  reportFormats,
  ReportLimitError,
  type ReportWork,
} from "./report-limits";
import { xlsxReportText } from "./report-text";
import {
  formatReportGeneratedAt,
  type AnalyticsReport,
  reportMetricKeys,
  reportMetricLabels,
  reportTypeLabels,
} from "./report.types";

const maxExcelCents = BigInt("999999999999999");

export function safeExcelMoney(amount: string) {
  const cents = toMoneyCents(amount);
  const value = Number(amount);
  return cents >= -maxExcelCents && cents <= maxExcelCents && value.toFixed(2) === amount ? value : null;
}

function money(amount: string): [string, number | null] {
  return [amount, safeExcelMoney(amount)];
}

const exactHeader = "Importe exacto (COP)";
const numberHeader = "Importe numérico (COP)";
const monetaryLegend = "El texto conserva los importes oficiales del servidor. Excel puede omitir celdas numéricas vacías y redondear sumas en coma flotante.";

type Value = string | number | null;

function writeHeader(sheet: ExcelJS.Worksheet, labels: string[]) {
  const row = sheet.addRow(labels);
  row.height = 21;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF087A70" } };
  });
  row.commit();
}

function writeRow(sheet: ExcelJS.Worksheet, values: Value[], numericMoneyColumns: readonly number[] = []) {
  const row = sheet.addRow(values.map((value) => typeof value === "string" ? xlsxReportText(value) : value));
  for (const column of numericMoneyColumns) {
    const cell = row.getCell(column);
    if (typeof cell.value === "number") cell.numFmt = "0.00";
  }
  row.commit();
}

export async function renderReportXlsx(report: AnalyticsReport, work: ReportWork = createReportWork()) {
  if (report.count > reportFormats.xlsx.rows) throw new ReportLimitError();
  work.check();

  const stream = new PassThrough();
  const options = {
    stream,
    useStyles: true,
    useSharedStrings: false,
    created: report.generatedAt,
    creator: "Mi Bolsillo",
    lastModifiedBy: "Mi Bolsillo",
  };
  const book = new ExcelJS.stream.xlsx.WorkbookWriter(options);

  let streamError: unknown;
  // Discard excess bytes and drain the archive so the writer can settle.
  const bytes = collectReportBytes(stream, reportFormats.xlsx.bytes, true).catch((error: unknown) => {
    streamError = error;
    return null;
  });

  async function checkpoint() {
    await work.pause();
    if (streamError) throw streamError;
  }

  function addSheet(name: string, widths: number[], freeze = false) {
    const sheet = book.addWorksheet(name, freeze ? { views: [{ state: "frozen", ySplit: 1 }] } : undefined);
    sheet.columns = widths.map((width) => ({ width }));
    return sheet;
  }

  let finalizationStarted = false;
  try {
    const summary = addSheet("Resumen", [48, 40, 30, 28, 30, 30, 30, 27]);
    writeHeader(summary, ["Mi Bolsillo · Reporte de analítica", "Selección aplicada"]);
    writeRow(summary, ["Período", `${report.filters.startMonth} a ${report.filters.endMonth}`]);
    writeRow(summary, ["Generación", formatReportGeneratedAt(report.generatedAt)]);
    writeRow(summary, ["Tipo", reportTypeLabels[report.filters.type]]);
    writeRow(summary, ["Categoría", report.category]);
    writeRow(summary, ["Moneda", "COP"]);
    writeRow(summary, ["Movimientos", report.count]);
    writeRow(summary, ["Importes exactos", monetaryLegend]);
    writeHeader(summary, ["Indicador", exactHeader, numberHeader]);
    for (const key of reportMetricKeys) {
      writeRow(summary, [reportMetricLabels[key], ...money(report.totals[key])], [3]);
    }
    writeRow(summary, ["Apertura del disponible global", ...money(report.openingAvailable)], [3]);

    const { current, previous, difference, percent } = report.comparison;
    writeRow(summary, [
      "Comparación mensual",
      `${current.month} frente a ${previous.month}${report.series.length === 1 ? " (fuera del rango)" : ""}`,
    ]);
    writeHeader(summary, [
      "Indicador", "Anterior exacto (COP)", "Anterior numérico (COP)", "Actual exacto (COP)",
      "Actual numérico (COP)", "Variación exacta (COP)", "Variación numérica (COP)", "Variación (%)",
    ]);
    for (const key of reportMetricKeys) {
      writeRow(summary, [
        reportMetricLabels[key], ...money(previous[key]), ...money(current[key]), ...money(difference[key]),
        percent[key] ?? "Base cero",
      ], [3, 5, 7]);
    }
    summary.commit();

    const movements = addSheet("Movimientos", [15, 13, 33, 65, 28, 28], true);
    movements.autoFilter = { from: "A1", to: `F${report.count + 1}` };
    writeHeader(movements, ["Fecha", "Tipo", "Categoría", "Descripción", exactHeader, numberHeader]);
    for (const [index, movement] of report.movements.entries()) {
      if (index % 100 === 0) await checkpoint();
      writeRow(movements, [
        movement.date,
        movement.type === "income" ? "Ingreso" : "Gasto",
        movement.category ?? "Sin categoría o eliminada",
        movement.description,
        ...money(movement.amount),
      ], [6]);
    }
    movements.commit();

    const categories = addSheet("Categorías", [17, 46, 28, 28, 25], true);
    writeHeader(categories, ["Tipo distribuido", "Categoría", exactHeader, numberHeader, "Participación (%)"]);
    const distributedType = reportTypeLabels[report.distribution.type];
    for (const [index, group] of report.distribution.groups.entries()) {
      if (index % 100 === 0) await checkpoint();
      writeRow(categories, [distributedType, group.name, ...money(group.amount), group.percent], [4]);
    }
    writeRow(categories, [distributedType, "Total", ...money(report.distribution.total)], [4]);
    categories.commit();

    const evolution = addSheet("Evolución mensual", [15, ...Array<number>(10).fill(32)], true);
    writeHeader(evolution, [
      "Mes", ...reportMetricKeys.flatMap((key) => [
        `${reportMetricLabels[key]} · exacto (COP)`,
        `${reportMetricLabels[key]} · numérico (COP)`,
      ]),
    ]);
    for (const point of report.series) {
      writeRow(evolution, [point.month, ...reportMetricKeys.flatMap((key) => money(point[key]))], [3, 5, 7, 9, 11]);
    }
    evolution.commit();

    await checkpoint();
    finalizationStarted = true;
    await book.commit();
    const buffer = await bytes;
    work.check();
    if (streamError) throw streamError;
    if (!buffer) throw new Error("No se pudo finalizar el libro.");
    return buffer;
  } catch (error) {
    // ExcelJS 4.4.0 exposes no public abort. Drain its already written rows to
    // finish the archive on early cancellation, while keeping the HTTP slot occupied.
    if (!finalizationStarted && !stream.destroyed) {
      await book.commit().catch(() => undefined);
    }
    stream.destroy();
    await bytes;
    throw streamError ?? error;
  }
}
