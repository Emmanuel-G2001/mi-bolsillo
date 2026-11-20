import "server-only";

import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, transactions } from "@/db/schema";

import { savingsFlowAmount, savingsFlowDate, savingsFlowForUser } from "../goal-savings-projection";

import { buildAnalyticsResponse } from "./analytics.result";
import type { AnalyticsQuery } from "./analytics.schema";
import type { AnalyticsResponse } from "./analytics.types";

const netAmount = sql`case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end`;

export async function getFinanceAnalytics(userId: number, query: AnalyticsQuery): Promise<AnalyticsResponse | null> {
  return db.transaction(
    (tx) => readFinanceAnalytics(tx, userId, query),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

type AnalyticsTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function analyticsPredicates(userId: number, { filters }: AnalyticsQuery) {
  const categoryId = filters.category === "all" || filters.category === "uncategorized"
    ? null
    : Number(filters.category);
  const categoryFilter = filters.category === "uncategorized"
    ? isNull(categories.id)
    : categoryId === null ? undefined : eq(categories.id, categoryId);
  const typeFilter = filters.type === "all" ? undefined : eq(transactions.type, filters.type);
  const matched = and(categoryFilter, typeFilter) ?? sql`true`;
  const categoryRelation = and(eq(categories.id, transactions.categoryId), eq(categories.userId, transactions.userId));
  const ownMovements = eq(transactions.userId, userId);
  return { categoryId, categoryFilter, categoryRelation, matched, ownMovements };
}

function movementRange(startDate: string, endDate: string) {
  return and(gte(transactions.transactionDate, startDate), lt(transactions.transactionDate, endDate));
}

export function readAnalyticsReportMovements(tx: AnalyticsTransaction, userId: number, query: AnalyticsQuery, limit: number) {
  const { categoryRelation, matched, ownMovements } = analyticsPredicates(userId, query);
  return tx.select({
    date: sql<string>`to_char(${transactions.transactionDate}::timestamp without time zone, 'YYYY-MM-DD')`,
    type: transactions.type,
    category: categories.name,
    description: transactions.description,
    amount: transactions.amount,
  }).from(transactions)
    .leftJoin(categories, categoryRelation)
    .where(and(ownMovements, movementRange(query.startDate, query.endDate), matched))
    .orderBy(desc(transactions.transactionDate), desc(transactions.id))
    .limit(limit);
}

export async function readFinanceAnalytics(
  tx: AnalyticsTransaction,
  userId: number,
  query: AnalyticsQuery,
  report?: { check: () => void; beforeAggregates: () => Promise<void> },
): Promise<AnalyticsResponse | null> {
  const { filters, startDate, endDate, readStartDate } = query;
  const { categoryId, categoryFilter, categoryRelation, matched, ownMovements } = analyticsPredicates(userId, query);
  const savingsFlow = savingsFlowForUser(userId);
  const movementMonth = sql<string>`to_char(${transactions.transactionDate}::timestamp, 'YYYY-MM')`;
  const contributionMonth = sql<string>`to_char(${savingsFlowDate}::timestamp, 'YYYY-MM')`;
  const distributionType = filters.type === "income" ? "income" : "expense";
  const ownCategories = eq(categories.userId, userId);
  const readCatalog = tx.select({
    id: categories.id,
    name: categories.name,
    type: categories.type,
  }).from(categories);

  report?.check();
  const catalog = report
    ? categoryId === null ? [] : await readCatalog.where(and(ownCategories, eq(categories.id, categoryId))).limit(1)
    : await readCatalog.where(ownCategories).orderBy(asc(categories.id));

  if (categoryId !== null && !catalog.some((category) => category.id === categoryId)) return null;
  await report?.beforeAggregates();

  report?.check();
  const [openingMovements] = await tx.select({
    net: sql<string>`coalesce(sum(${netAmount}), 0)::text`,
  }).from(transactions)
    .where(and(ownMovements, lt(transactions.transactionDate, startDate)));

  report?.check();
  const [openingSavings] = await tx.select({
    savings: sql<string>`coalesce(sum(${savingsFlowAmount}), 0)::text`,
  }).from(savingsFlow)
    .where(sql`${savingsFlowDate} < ${startDate}::date`);

  report?.check();
  const movements = await tx.select({
    month: movementMonth,
    income: sql<string>`coalesce(sum(${transactions.amount}) filter
      (where ${matched} and ${transactions.type} = 'income'), 0)::text`,
    expense: sql<string>`coalesce(sum(${transactions.amount}) filter
      (where ${matched} and ${transactions.type} = 'expense'), 0)::text`,
    globalNet: sql<string>`sum(${netAmount})::text`,
    hasFilteredMovements: sql<boolean>`bool_or(${matched}) is true`,
  }).from(transactions)
    .leftJoin(categories, categoryRelation)
    .where(and(ownMovements, movementRange(readStartDate, endDate)))
    .groupBy(movementMonth);

  report?.check();
  const savings = await tx.select({
    month: contributionMonth,
    amount: sql<string>`sum(${savingsFlowAmount})::text`,
  }).from(savingsFlow)
    .where(sql`${savingsFlowDate} >= ${readStartDate}::date and ${savingsFlowDate} < ${endDate}::date`)
    .groupBy(contributionMonth);

  report?.check();
  const distribution = await tx.select({
    id: categories.id,
    name: categories.name,
    amount: sql<string>`sum(${transactions.amount})::text`,
  }).from(transactions)
    .leftJoin(categories, categoryRelation)
    .where(and(ownMovements, movementRange(startDate, endDate),
      eq(transactions.type, distributionType), categoryFilter))
    .groupBy(categories.id, categories.name);

  report?.check();
  return buildAnalyticsResponse(
    query,
    catalog.map((category) => ({ ...category, id: String(category.id) })),
    { ...openingMovements, ...openingSavings },
    movements,
    savings,
    distribution,
  );
}
