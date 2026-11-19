import type { NextRequest } from "next/server";

import { monthlyMovementHeaders, parseMovementMonth } from "@/features/finance/monthly-movements";
import { getMonthlyMovementInsights } from "@/features/finance/monthly-movements.service";
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

    const insights = await getMonthlyMovementInsights(user.id, period);
    return Response.json(insights, { headers });
  } catch {
    return Response.json(
      { error: "No fue posible consultar el resumen mensual." },
      { status: 500, headers },
    );
  }
}
