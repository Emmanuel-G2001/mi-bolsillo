import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

import type { AnalyticsQuery } from "../analytics/analytics.schema";
import { readAnalyticsReportMovements, readFinanceAnalytics } from "../analytics/analytics.service";
import { ReportLimitError, ReportTimeoutError, type ReportWork } from "./report-limits";
import { buildAnalyticsReport, type ReportMovement } from "./report.types";

function isStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "57014") return true;
  return "cause" in error && error.cause !== error && isStatementTimeout(error.cause);
}

export async function getAnalyticsReport(userId: number, query: AnalyticsQuery, rowLimit: number, work: ReportWork) {
  try {
    const result = await db.transaction(async (tx) => {
      work.check();
      await tx.execute(sql`set local statement_timeout = '2s'`);

      let movements: ReportMovement[] = [];
      const analytics = await readFinanceAnalytics(tx, userId, query, {
        check: work.check,
        async beforeAggregates() {
          work.check();
          movements = await readAnalyticsReportMovements(tx, userId, query, rowLimit + 1);
          if (movements.length > rowLimit) throw new ReportLimitError();
        },
      });
      return analytics ? { analytics, movements } : null;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });

    work.check();
    return result && buildAnalyticsReport(result.analytics, result.movements, new Date());
  } catch (error) {
    if (isStatementTimeout(error)) throw new ReportTimeoutError();
    throw error;
  }
}
