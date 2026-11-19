import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { inflateRawSync, inflateSync } from "node:zlib";

import ExcelJS from "exceljs";

import { buildAnalyticsResponse } from "../features/finance/analytics/analytics.result";
import { parseAnalyticsQuery } from "../features/finance/analytics/analytics.schema";
import { formatMoneyCents, toMoneyCents } from "../features/finance/finance.money";
import {
  collectReportBytes,
  createReportAdmission,
  createReportWork,
  ReportLimitError,
  ReportTimeoutError,
  reportFormats,
} from "../features/finance/reports/report-limits";
import { renderReportPdf } from "../features/finance/reports/report.pdf";
import { parseAnalyticsReportQuery } from "../features/finance/reports/report.schema";
import { buildAnalyticsReport, type ReportMovement } from "../features/finance/reports/report.types";
import { renderReportXlsx, safeExcelMoney } from "../features/finance/reports/report.xlsx";

const generatedAt = new Date("2024-03-01T02:30:00Z");
const sheets = ["Resumen", "Movimientos", "Categorías", "Evolución mensual"];

function analyticsFor(movements: ReportMovement[], month = "2024-02") {
  const query = parseAnalyticsQuery(new URLSearchParams({ startMonth: month, endMonth: month }));
  assert.ok(query);
  const total = (type: ReportMovement["type"]) => formatMoneyCents(movements
    .filter((row) => row.type === type)
    .reduce((sum, row) => sum + toMoneyCents(row.amount), BigInt(0)));
  const income = total("income");
  const expense = total("expense");
  return buildAnalyticsResponse(query, [], { net: "-2.00", savings: "0.00" }, [{
    month, income, expense,
    globalNet: formatMoneyCents(toMoneyCents(income) - toMoneyCents(expense)),
    hasFilteredMovements: movements.length !== 0,
  }], [{ month, amount: "0.30" }], expense === "0.00" ? [] : [
    { id: 1, name: "Café", amount: expense },
  ]);
}

function movement(description: string, amount = "0.01", overrides: Partial<ReportMovement> = {}): ReportMovement {
  return { description, date: "2024-02-29", amount, type: "expense", category: "Café", ...overrides };
}

function reportFor(movements: ReportMovement[], month?: string) {
  return buildAnalyticsReport(analyticsFor(movements, month), movements, generatedAt);
}

test("I3-01: formatos, rangos civiles, selección combinada y rechazo de claves", () => {
  for (const [startMonth, endMonth, length, exclusiveEnd] of [
    ["0100-01", "0100-01", 1, "0100-02-01"],
    ["2024-02", "2024-02", 1, "2024-03-01"],
    ["2024-01", "2024-03", 3, "2024-04-01"],
    ["2023-12", "2024-01", 2, "2024-02-01"],
    ["2024-01", "2024-12", 12, "2025-01-01"],
    ["9999-12", "9999-12", 1, "10000-01-01"],
  ] as const) {
    for (const format of ["pdf", "xlsx"]) {
      const params = new URLSearchParams({ startMonth, endMonth, format, type: "expense", category: "42" });
      const parsed = parseAnalyticsReportQuery(params);
      assert.equal(parsed?.format, format);
      assert.equal(parsed.query.months.length, length);
      assert.equal(parsed.query.endDate, exclusiveEnd);
      assert.deepEqual(parsed.query.filters, { startMonth, endMonth, type: "expense", category: "42" });
    }
  }
  const months = "startMonth=2024-02&endMonth=2024-02";
  const base = `${months}&format=pdf`;
  assert.deepEqual(parseAnalyticsReportQuery(new URLSearchParams(base))?.query.filters, {
    startMonth: "2024-02", endMonth: "2024-02", type: "all", category: "all",
  });
  for (const raw of [
    months, `${months}&format=`, `${months}&format=PDF`, `${months}&format=csv`,
    "format=pdf&startMonth=2024-02&endMonth=2025-02",
    "format=pdf&startMonth=2024-02&endMonth=2024-01",
    ...["format=pdf", "startMonth=2024-02", "endMonth=2024-02", "type=expense&type=expense",
      "category=42&category=42", "type=invalid", "category=0001", "userId=5", "unexpected=1",
    ].map((extra) => `${base}&${extra}`),
  ]) {
    assert.equal(parseAnalyticsReportQuery(new URLSearchParams(raw)), null, raw);
  }
});

test("I3-02: conciliación exacta, comparación externa y métricas globales", () => {
  const rows = [
    movement("Ingreso sintético", "9007199254740992.01", { type: "income", category: null }),
    movement("Gasto sintético", "9007199254740992.00"),
    movement("Dos centavos", "0.02"),
  ];
  const analytics = analyticsFor(rows);
  const report = buildAnalyticsReport(analytics, rows, generatedAt);
  assert.deepEqual(report.totals, {
    income: "9007199254740992.01", expense: "9007199254740992.02", net: "-0.01",
    savings: "0.30", available: "-2.31",
  });
  assert.equal(report.count, 3);
  assert.equal(report.openingAvailable, "-2.00");
  assert.deepEqual(report.series, analytics.series);
  assert.equal(report.series[0].savings, "0.30");
  assert.equal(report.series[0].available, "-2.31");
  assert.equal(report.comparison.previous.month, "2024-01");
  assert.equal(report.comparison.percent.net, null);
  assert.throws(() => buildAnalyticsReport(analytics, rows.slice(0, -1), generatedAt));
  const empty = reportFor([]);
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.totals, {
    income: "0.00", expense: "0.00", net: "0.00", savings: "0.30", available: "-2.30",
  });
  assert.equal(empty.series[0].available, "-2.30");
});

test("I3-06: topes exactos de bytes y descarte al exceder o fallar el stream", async () => {
  for (const { bytes: maxBytes } of [reportFormats.pdf, reportFormats.xlsx]) {
    const chunk = Buffer.alloc(maxBytes / 2, 1);
    const read = (parts: Buffer[]) => collectReportBytes(Readable.from(parts), maxBytes);
    const exact = await read([chunk, chunk]);
    assert.equal(exact.length, maxBytes);
    assert.equal(exact[0], 1);
    assert.equal(exact[exact.length - 1], 1);
    await assert.rejects(read([chunk, chunk, Buffer.alloc(1)]), ReportLimitError);
    const failing = Readable.from((async function* () {
      yield chunk;
      throw new Error("Fallo sintético");
    })());
    await assert.rejects(collectReportBytes(failing, maxBytes), /Fallo sintético/);
  }
});

test("I3-06: admisión por cuenta e instancia y comprobaciones de expiración y aborto", async () => {
  const admission = createReportAdmission();
  const first = admission.admit(1);
  const second = admission.admit(2);
  assert.ok("release" in first && "release" in second);
  assert.deepEqual(admission.admit(1), { status: 429 });
  assert.deepEqual(admission.admit(3), { status: 503 });

  const controller = new AbortController();
  const work = createReportWork(controller.signal);
  await work.pause();
  controller.abort();
  assert.throws(work.check, ReportTimeoutError);
  await assert.rejects(work.pause(), ReportTimeoutError);
  assert.throws(createReportWork(undefined, 0).check, ReportTimeoutError);
  assert.deepEqual(admission.admit(1), { status: 429 });

  first.release();
  const retry = admission.admit(1);
  assert.ok("release" in retry);
  first.release();
  assert.deepEqual(admission.admit(1), { status: 429 });
  second.release();
  retry.release();
  assert.ok("release" in admission.admit(3));
});

function pdfContent(pdf: Buffer) {
  // PDFKit uses an indirect content stream for each page. Use its length rather than scanning binary data.
  const raw = pdf.toString("latin1");
  const decoder = new TextDecoder("windows-1252");
  return Array.from(raw.matchAll(/\/Type \/Page\b[\s\S]*?\/Contents (\d+) 0 R/g), ([, reference]) => {
    const object = new RegExp(`(?:^|\\n)${reference} 0 obj\\n(<<[\\s\\S]*?>>)\\nstream\\r?\\n`).exec(raw);
    assert.ok(object, `Missing page stream ${reference}`);
    const size = Number(/\/Length (\d+)/.exec(object[1])?.[1]);
    assert.ok(Number.isInteger(size) && size > 0);
    const offset = object.index + object[0].length;
    const stream = pdf.subarray(offset, offset + size);
    const commands = (object[1].includes("/FlateDecode") ? inflateSync(stream) : stream).toString("latin1");
    const text = Array.from(commands.matchAll(/\[([^\]]*)\] TJ/g), ([, line]) =>
      Array.from(line.matchAll(/<([a-f\d]+)>/gi), ([, hex]) => decoder.decode(Buffer.from(hex, "hex"))).join(""),
    ).join("\n");
    return { text, commands };
  });
}

test("I3-03: PDF con PDFKit local, Helvetica WinAnsi, detalle completo y pies por página", async () => {
  const marker = "¡Café, piñata, pingüino y acción! ¿Sí?";
  const longDescription = `${"segmento ".repeat(26)}final-del-texto`;
  const rows = Array.from({ length: 110 }, (_, idx) => movement(
    `R${String(idx).padStart(3, "0")} ${idx === 0 ? `${marker} 漢 😀` : idx === 55 ? longDescription : "sintético"}`,
  ));
  const pdf = await renderReportPdf(reportFor(rows));
  const raw = pdf.toString("latin1");
  assert.match(raw, /^%PDF-/);
  assert.match(raw, /\/BaseFont \/Helvetica\b/);
  assert.match(raw, /\/Encoding \/WinAnsiEncoding\b/);
  assert.doesNotMatch(raw, /\/(JavaScript|OpenAction|AcroForm|EmbeddedFile|URI)\b/);
  const pages = pdfContent(pdf);
  assert.ok(pages.length >= 3, "Se requiere un detalle de varias páginas");
  const text = pages.map((page) => page.text).join("\n");
  assert.match(text, /Mi Bolsillo/i);
  assert.ok(text.replace(/\s+/g, " ").includes(marker));
  assert.match(text, /U\+6F22/i);
  assert.match(text, /U\+1F600/i);
  assert.match(text, /final-del-texto/);
  assert.match(text, /Evolución mensual/);
  assert.match(text, /Distribución por categorías/);
  assert.match(text, /Total COP 1\.10/);
  assert.match(text, /2024-01 \(fuera del rango\)/);
  assert.match(text, /Base cero/);
  assert.deepEqual(Array.from(text.matchAll(/\bR(\d{3})\b/g), ([, index]) => Number(index)),
    rows.map((_, index) => index));
  assert.ok(pages.some(({ commands }) => /\bre\s/.test(commands)), "El PDF incluye geometría vectorial");
  for (const [index, page] of pages.entries()) {
    assert.match(page.text, new RegExp(`Página ${index + 1} de ${pages.length}\\b`));
    if (/\bR\d{3}\b/.test(page.text)) {
      assert.match(page.text, /Fecha/);
      assert.match(page.text, /Descripci[oó]n/);
    }
  }
});

test("I3-03: el PDF vacío mantiene los indicadores globales y explica el detalle vacío", async () => {
  const pdf = await renderReportPdf(reportFor([]));
  const text = pdfContent(pdf).map((page) => page.text).join("\n");
  assert.match(text, /0 movimientos/);
  assert.match(text, /Ahorro global/);
  assert.match(text, /Disponible global/);
  assert.match(text, /-2\.30/);
  assert.match(text, /Sin movimientos para los filtros aplicados/);
});

function zipParts(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  const parts = new Map<string, string>();
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameSize = zip.readUInt16LE(offset + 28);
    const extraSize = zip.readUInt16LE(offset + 30);
    const commentSize = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameSize);
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const bytes = zip.subarray(data, data + size);
    assert.ok(method === 0 || method === 8);
    parts.set(name, (method === 8 ? inflateRawSync(bytes) : bytes).toString("utf8"));
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return parts;
}

test("I3-04: XLSX con hojas, fechas civiles y valores literales tipados de forma segura", async () => {
  const safe = "9999999999999.99";
  const beyond = "10000000000000.00";
  for (const value of ["0.00", "0.01", "-0.01", safe, `-${safe}`]) {
    assert.equal(safeExcelMoney(value)?.toFixed(2), value);
  }
  for (const value of [beyond, `-${beyond}`, "9007199254740992.01"]) {
    assert.equal(safeExcelMoney(value) == null, true);
  }
  const date = "0100-01-02";
  const rows = [
    movement("=1+1", "0.01", { date }),
    movement("https://example.test/a", safe, { date }),
    movement("Café 漢 😀\u0001\u202E", beyond, { date }),
  ];
  const xlsx = await renderReportXlsx(reportFor(rows, "0100-01"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(xlsx).buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), sheets);
  assert.ok(workbook.worksheets.every((sheet) => sheet.state === "visible"));
  const details = workbook.getWorksheet("Movimientos");
  assert.ok(details);
  assert.equal(details.rowCount, rows.length + 1);
  assert.equal(details.views[0]?.state, "frozen");
  assert.ok(details.autoFilter);
  for (const [index, row] of rows.entries()) {
    const record = details.getRow(index + 2);
    assert.equal(record.getCell(1).value, row.date);
    assert.equal(record.getCell(4).value, row.description.replace("\u0001\u202E", "[U+0001][U+202E]"));
    assert.equal(record.getCell(5).value, row.amount);
    assert.equal(record.getCell(6).value, index < 2 ? Number(row.amount) : null);
  }
  const parts = zipParts(xlsx);
  const detailXml = parts.get("xl/worksheets/sheet2.xml");
  assert.match(detailXml ?? "", /<autoFilter\b/);
  assert.match(detailXml ?? "", /<c r="F3"[^>]*><v>9999999999999\.99<\/v><\/c>/);
  assert.doesNotMatch(detailXml ?? "", /<c r="F4"[^>]*><v>/);
  for (const [name, content] of parts) {
    assert.doesNotMatch(name, /(?:externalLinks|vbaProject)/i);
    assert.doesNotMatch(content, /<f(?:\s|>)|<hyperlink\b|TargetMode="External"/i);
  }
  const empty = new ExcelJS.Workbook();
  await empty.xlsx.load(Uint8Array.from(await renderReportXlsx(reportFor([]))).buffer);
  assert.deepEqual(empty.worksheets.map((sheet) => sheet.name), sheets);
  assert.equal(empty.getWorksheet("Movimientos")?.rowCount, 1);
});

test("I3-04: las descripciones con escapes OOXML aparentes se conservan como texto literal", async () => {
  const descriptions = ["_x0041_", "_x0041_x0042_", "_x005F_"];
  const xlsx = await renderReportXlsx(reportFor(descriptions.map((description) => movement(description))));
  const xml = zipParts(xlsx).get("xl/worksheets/sheet2.xml");
  assert.ok(xml);
  const expectedXML = ["_x005F_x0041_", "_x005F_x0041_x005F_x0042_", "_x005F_x005F_"];
  for (const [index, description] of descriptions.entries()) {
    const cell = new RegExp(`<c r="D${index + 2}"[^>]*t="str"[^>]*><v>([^<]*)</v></c>`).exec(xml);
    assert.ok(cell);
    assert.equal(cell[1], expectedXML[index]);
    const decoded = cell[1].replace(/_x([\da-f]{4})_/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)));
    assert.equal(decoded, description);
  }
});

test("I3-06: ambos renderizadores aceptan su máximo de filas y rechazan una más", async (context) => {
  for (const [format, render] of [["pdf", renderReportPdf], ["xlsx", renderReportXlsx]] as const) {
    const { rows, bytes } = reportFormats[format];
    const movements = Array.from({ length: rows }, (_, index) =>
      movement(`Nº ${index} · ${"Texto Café 漢 😀 ".repeat(15)}`),
    );
    const start = performance.now();
    const buffer = await render(reportFor(movements));
    assert.ok(buffer.length > 0 && buffer.length <= bytes);
    context.diagnostic(`${format}: ${rows} filas, ${buffer.length} bytes, ${Math.round(performance.now() - start)} ms`);
    const overLimit = reportFor([...movements, movement("Exceso sintético")]);
    await assert.rejects(render(overLimit), ReportLimitError);
  }
});

test("I3-06: el aborto durante la preparación rechaza ambos adjuntos", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => movement(`Fila sintética ${index}`));
  const report = reportFor(rows);
  for (const render of [renderReportPdf, renderReportXlsx]) {
    const controller = new AbortController();
    const pending = render(report, createReportWork(controller.signal));
    controller.abort();
    await assert.rejects(pending, ReportTimeoutError);
  }
});
