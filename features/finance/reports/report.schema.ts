import { parseAnalyticsQuery, type AnalyticsQuery } from "../analytics/analytics.schema";

const keys = new Set(["startMonth", "endMonth", "type", "category", "format"]);

export function parseAnalyticsReportQuery(params: URLSearchParams): { format: "pdf" | "xlsx"; query: AnalyticsQuery } | null {
  if (params.size > keys.size || [...params.keys()].some((key) => !keys.has(key))) return null;
  if (params.getAll("format").length !== 1) return null;

  const format = params.get("format");
  if (format !== "pdf" && format !== "xlsx") return null;

  const query = parseAnalyticsQuery(params);
  return query ? { format, query } : null;
}
