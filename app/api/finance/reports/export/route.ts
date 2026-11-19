import type { NextRequest } from "next/server";

import { monthlyMovementHeaders, parseMovementMonth } from "@/features/finance/monthly-movements";
import { renderMonthlyMovementsCsv } from "@/features/finance/monthly-movements.csv";
import { getMonthlyMovementExportRows } from "@/features/finance/monthly-movements.service";
import { getCurrentUser } from "@/lib/auth/current-user";

export async function GET(request: NextRequest) {
  const headers = monthlyMovementHeaders;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    }

    const period = parseMovementMonth(request.nextUrl.searchParams);
    if (!period) {
      return Response.json({ error: "Mes inválido." }, { status: 400, headers });
    }

    const rows = await getMonthlyMovementExportRows(user.id, period);
    const csv = renderMonthlyMovementsCsv(rows);
    if (csv === null) {
      return Response.json(
        { error: "El mes supera el límite de 10 000 movimientos para exportar." },
        { status: 413, headers },
      );
    }

    return new Response(csv, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mi-bolsillo-${period.month}.csv"`,
      },
    });
  } catch {
    return Response.json(
      { error: "No fue posible exportar los movimientos del mes." },
      { status: 500, headers },
    );
  }
}
