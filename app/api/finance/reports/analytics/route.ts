import type { NextRequest } from "next/server";

import {
  createReportAdmission,
  createReportWork,
  reportFormats,
  ReportLimitError,
  ReportTimeoutError,
} from "@/features/finance/reports/report-limits";
import { renderReportPdf } from "@/features/finance/reports/report.pdf";
import { parseAnalyticsReportQuery } from "@/features/finance/reports/report.schema";
import { getAnalyticsReport } from "@/features/finance/reports/report.service";
import { renderReportXlsx } from "@/features/finance/reports/report.xlsx";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const messages = {
  400: "El formato o los filtros del reporte son inválidos.",
  401: "Inicia sesión para descargar el reporte.",
  403: "Solicitud no permitida.",
  413: "El reporte supera el tamaño permitido. Reduce el período o aplica filtros.",
  429: "Ya hay una descarga en preparación. Inténtalo de nuevo.",
  500: "No fue posible generar el reporte.",
  503: "No fue posible preparar el reporte a tiempo. Inténtalo de nuevo.",
};

const admission = createReportAdmission();
const reportDeadline = 15000;

function reportError(status: keyof typeof messages) {
  return Response.json({ error: messages[status] }, { status, headers: privateHeaders });
}

export function HEAD() {
  return new Response(null, { status: 405, headers: { ...privateHeaders, Allow: "GET" } });
}

export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return reportError(403);

  try {
    const user = await getCurrentUser();
    if (!user) return reportError(401);

    const input = parseAnalyticsReportQuery(request.nextUrl.searchParams);
    if (!input) return reportError(400);

    const { id: userId } = user;
    const { format, query } = input;
    const slot = admission.admit(userId);
    if ("status" in slot) return reportError(slot.status);

    const deadline = AbortSignal.timeout(reportDeadline);
    const workSignal = AbortSignal.any([deadline, request.signal]);
    const work = createReportWork(workSignal, reportDeadline);
    const limit = reportFormats[format];
    let stopWaiting = () => {};

    const timeout = new Promise<never>((_, reject) => {
      const stopped = () => reject(new ReportTimeoutError());
      if (workSignal.aborted) stopped();
      else workSignal.addEventListener("abort", stopped, { once: true });
      stopWaiting = () => workSignal.removeEventListener("abort", stopped);
    });

    async function prepare() {
      work.check();
      const report = await getAnalyticsReport(userId, query, limit.rows, work);
      if (!report) return null;

      const render = format === "pdf" ? renderReportPdf : renderReportXlsx;
      const bytes = await render(report, work);
      work.check();
      return bytes;
    }

    let file: Buffer | null;
    try {
      // The connection pool may still be waiting when the caller's deadline expires.
      // Hold the slot until the real work settles, and check the signal in the reader.
      file = await Promise.race([prepare().finally(slot.release), timeout]);
    } finally {
      stopWaiting();
    }
    if (!file) return reportError(400);

    const { startMonth, endMonth } = query.filters;
    const filename = `mi-bolsillo-analitica-${startMonth}-a-${endMonth}.${format}`;
    return new Response(new Uint8Array(file), {
      headers: {
        ...privateHeaders,
        "Content-Type": limit.mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(file.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof ReportLimitError) return reportError(413);
    if (error instanceof ReportTimeoutError) return reportError(503);
    return reportError(500);
  }
}
