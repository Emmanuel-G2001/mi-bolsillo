import type { NextRequest } from "next/server";

import { parseAnalyticsQuery } from "@/features/finance/analytics/analytics.schema";
import { getFinanceAnalytics } from "@/features/finance/analytics/analytics.service";
import { getCurrentUser } from "@/lib/auth/current-user";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function invalidFilters() {
  return Response.json({ error: "Filtros de analítica inválidos." }, { status: 400, headers });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    }

    const query = parseAnalyticsQuery(request.nextUrl.searchParams);
    if (!query) return invalidFilters();

    const analytics = await getFinanceAnalytics(user.id, query);
    if (!analytics) return invalidFilters();

    return Response.json(analytics, { headers });
  } catch {
    return Response.json(
      { error: "No fue posible consultar la analítica financiera." },
      { status: 500, headers },
    );
  }
}
