import PDFDocument from "pdfkit";

import {
  collectReportBytes,
  createReportWork,
  reportFormats,
  ReportLimitError,
  type ReportWork,
} from "./report-limits";
import { pdfReportText } from "./report-text";
import {
  formatReportGeneratedAt,
  type AnalyticsReport,
  reportMetricKeys,
  reportMetricLabels,
  reportTypeLabels,
} from "./report.types";

const margin = 42;
const ink = "#172b3d";
const muted = "#40566b";
const teal = "#087a70";
const violet = "#6063a7";
const border = "#d9e2ec";

type Column = { label: string; width: number; align?: "right" };

export async function renderReportPdf(report: AnalyticsReport, work: ReportWork = createReportWork()) {
  if (report.count > reportFormats.pdf.rows) throw new ReportLimitError();
  work.check();

  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    info: { Title: "Mi Bolsillo · Reporte de analítica", CreationDate: report.generatedAt },
  });
  let streamError: unknown;
  const bytes = collectReportBytes(doc, reportFormats.pdf.bytes).catch((error: unknown) => {
    streamError = error;
    return null;
  });
  const right = doc.page.width - margin;
  const bottom = doc.page.height - margin - 27;
  const contentWidth = right - margin;
  let y = margin;

  function check() {
    if (streamError) throw streamError;
    work.check();
  }

  function text(value: string, x: number, top: number, size: number, color = ink, bold = false) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
    doc.text(value, x, top, { lineBreak: false });
  }

  function nextPage() {
    doc.addPage();
    text("MI BOLSILLO  /  ANALÍTICA", margin, margin, 9, teal, true);
    y = margin + 28;
  }

  function room(height: number) {
    if (y + height > bottom) nextPage();
  }

  function heading(label: string, minimumRemaining = 44) {
    room(27 + minimumRemaining);
    text(label, margin, y, 15, ink, true);
    y += 25;
  }

  // Use the same measured advances as the font, and break long tokens without discarding characters.
  function wrap(value: string, width: number): string[] {
    return pdfReportText(value).split("\n").flatMap((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const token of paragraph.match(/ +|[^ ]+/g) ?? []) {
        if (doc.widthOfString(line + token) <= width) {
          line += token;
          continue;
        }

        if (line) lines.push(line);
        line = "";
        if (doc.widthOfString(token) <= width) {
          line = token;
          continue;
        }

        for (const character of token) {
          if (doc.widthOfString(line + character) > width) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
      }
      return [...lines, line];
    });
  }

  function table(columns: Column[]) {
    const size = 9;
    const leading = 13;
    const height = (lines: number) => lines * leading + 8;

    function draw(cells: string[][], header: boolean) {
      const rowHeight = height(Math.max(...cells.map((cell) => cell.length)));
      doc.rect(margin, y, contentWidth, rowHeight).fill(header ? "#e5f2ef" : "#ffffff");
      let x = margin;
      for (const [index, column] of columns.entries()) {
        for (const [line, value] of cells[index].entries()) {
          doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(size);
          const offset = column.align === "right" ? column.width - 6 - doc.widthOfString(value) : 5;
          text(value, x + offset, y + 4 + line * leading, size, ink, header);
        }
        x += column.width;
      }
      doc.moveTo(margin, y + rowHeight).lineTo(right, y + rowHeight).lineWidth(0.4).stroke(border);
      y += rowHeight;
    }

    function drawHeader() {
      draw(columns.map(({ label }) => [label]), true);
    }

    drawHeader();
    return (values: string[]) => {
      doc.font("Helvetica").fontSize(size);
      const cells = values.map((value, index) => wrap(value, columns[index].width - 11));
      const lineCount = Math.max(...cells.map((cell) => cell.length));

      // Keep ordinary rows intact and split only when a row cannot fit on a fresh page.
      if (y + height(lineCount) > bottom) {
        nextPage();
        drawHeader();
      }
      const pageLineLimit = Math.floor((bottom - y - 8) / leading);
      for (let start = 0; start < lineCount; start += pageLineLimit) {
        if (start > 0) {
          nextPage();
          drawHeader();
        }
        draw(cells.map((cell) => cell.slice(start, start + pageLineLimit)), false);
      }
    };
  }

  function notes(value: string) {
    doc.font("Helvetica").fontSize(10);
    for (const line of wrap(value, contentWidth)) {
      room(14);
      text(line, margin, y, 10, muted);
      y += 14;
    }
  }

  try {
    text("MI BOLSILLO  /  ANALÍTICA", margin, y, 10, teal, true);
    y += 21;
    text("Reporte financiero", margin, y, 27, ink, true);
    y += 39;
    notes(`Período ${report.filters.startMonth} a ${report.filters.endMonth} · ${formatReportGeneratedAt(report.generatedAt)}`);
    notes(`Tipo: ${reportTypeLabels[report.filters.type]} · Categoría: ${report.category}`);
    notes(`${report.count} movimientos · Importes en pesos colombianos (COP)`);
    y += 14;

    heading("Resumen del período");
    const summaryRow = table([{ label: "Indicador", width: 365 }, { label: "COP", width: 146, align: "right" }]);
    for (const key of reportMetricKeys) summaryRow([reportMetricLabels[key], report.totals[key]]);
    summaryRow(["Apertura del disponible global", report.openingAvailable]);
    y += 18;

    heading("Evolución mensual", 132);
    notes("Barras por mes: ingresos (verde) y gastos (violeta).");
    const peak = report.series.reduce((max, point) =>
      Math.max(max, Math.abs(Number(point.income)), Math.abs(Number(point.expense))), 1);
    const spacing = contentWidth / report.series.length;
    const barWidth = Math.min(spacing / 3, 15);
    const chartTop = y + 7;
    const baseline = chartTop + 69;
    doc.moveTo(margin, baseline).lineTo(right, baseline).lineWidth(0.5).stroke(border);
    for (const [index, point] of report.series.entries()) {
      const x = margin + (index + 0.5) * spacing;
      const income = Math.abs(Number(point.income)) / peak * 64;
      const expense = Math.abs(Number(point.expense)) / peak * 64;
      doc.rect(x - barWidth - 1, baseline - income, barWidth, income).fill(teal);
      doc.rect(x + 1, baseline - expense, barWidth, expense).fill(violet);
      text(point.month, x - 17, baseline + 5, 8, muted);
    }
    y = baseline + 22;
    const seriesRow = table([
      { label: "Mes", width: 58 },
      { label: "Ingresos", width: 85, align: "right" },
      { label: "Gastos", width: 85, align: "right" },
      { label: "Neto", width: 85, align: "right" },
      { label: "Ahorro neto global", width: 95, align: "right" },
      { label: "Disponible global", width: 103, align: "right" },
    ]);
    for (const point of report.series) seriesRow([point.month, ...reportMetricKeys.map((key) => point[key])]);
    y += 18;

    const { current, previous, difference, percent } = report.comparison;
    heading("Comparación mensual");
    notes(`${current.month} frente a ${previous.month}${report.series.length === 1 ? " (fuera del rango)" : ""}.`);
    room(48);
    const comparisonRow = table([
      { label: "Indicador", width: 119 },
      { label: previous.month, width: 90, align: "right" },
      { label: current.month, width: 90, align: "right" },
      { label: "Variación (COP)", width: 90, align: "right" },
      { label: "Variación (%)", width: 122, align: "right" },
    ]);
    for (const key of reportMetricKeys) comparisonRow([
      reportMetricLabels[key], previous[key], current[key], difference[key],
      percent[key] === null ? "Base cero" : percent[key],
    ]);
    y += 18;

    heading("Distribución por categorías");
    notes(`${reportTypeLabels[report.distribution.type]} del período · Total COP ${report.distribution.total}`);
    if (!report.distribution.groups.length) notes("Sin importes para distribuir.");
    if (report.distribution.groups.length) {
      const shown = report.distribution.groups.slice(0, 5);
      notes("Gráfico: hasta cinco categorías con mayor importe. La tabla incluye todas.");
      room(shown.length * 20 + 10);
      for (const [index, group] of shown.entries()) {
        const ratio = Math.min(100, Math.abs(Number(group.percent)));
        doc.rect(margin + 22, y + 2, 350, 9).fill("#e5f2ef");
        doc.rect(margin + 22, y + 2, ratio / 100 * 350, 9).fill(teal);
        text(String(index + 1), margin, y, 9, muted);
        text(`${group.percent}%`, margin + 386, y, 9, muted);
        y += 20;
      }
      y += 8;
    }
    room(50);
    const categoryRow = table([
      { label: "Categoría", width: 310 },
      { label: "Importe (COP)", width: 110, align: "right" },
      { label: "Participación", width: 91, align: "right" },
    ]);
    for (const [index, group] of report.distribution.groups.entries()) {
      if (index % 32 === 0) { await work.pause(); check(); }
      categoryRow([`${index + 1}. ${group.name}`, group.amount, `${group.percent}%`]);
    }
    y += 18;

    heading("Movimientos");
    if (!report.count) notes("Sin movimientos para los filtros aplicados.");
    const movementRow = table([
      { label: "Fecha", width: 65 },
      { label: "Tipo", width: 51 },
      { label: "Categoría", width: 111 },
      { label: "Descripción", width: 174 },
      { label: "Importe (COP)", width: 110, align: "right" },
    ]);
    for (const [index, movement] of report.movements.entries()) {
      if (index % 24 === 0) { await work.pause(); check(); }
      movementRow([
        movement.date,
        movement.type === "income" ? "Ingreso" : "Gasto",
        movement.category ?? "Sin categoría o eliminada",
        movement.description,
        movement.amount,
      ]);
    }

    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page++) {
      check();
      doc.switchToPage(page);
      doc.moveTo(margin, bottom + 10).lineTo(right, bottom + 10).lineWidth(0.5).stroke(border);
      text(`Página ${page + 1} de ${pages.count}`, margin, bottom + 17, 8, muted);
    }

    doc.end();
    const buffer = await bytes;
    check();
    if (!buffer) throw new Error("No se pudo finalizar el PDF.");
    return buffer;
  } catch (error) {
    doc.destroy();
    await bytes;
    throw error;
  }
}
