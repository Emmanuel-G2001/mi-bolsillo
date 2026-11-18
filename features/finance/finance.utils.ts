import {
  and,
  eq,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  categories,
} from "@/db/schema";

export function getBogotaToday() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "America/Bogota",
    },
  ).format(
    new Date(),
  );
}

export function getMonthInfo(
  monthValue?:
    | string
    | null,
) {
  if (
    monthValue &&
    /^\d{4}-\d{2}$/.test(
      monthValue,
    )
  ) {
    const [
      year,
      month,
    ] =
      monthValue
        .split("-")
        .map(Number);

    if (
      month >= 1 &&
      month <= 12
    ) {
      const nextYear =
        month === 12
          ? year + 1
          : year;

      const nextMonth =
        month === 12
          ? 1
          : month + 1;

      return {
        year,
        month,

        value:
          monthValue,

        start:
          `${year}-${String(
            month,
          ).padStart(
            2,
            "0",
          )}-01`,

        end:
          `${nextYear}-${String(
            nextMonth,
          ).padStart(
            2,
            "0",
          )}-01`,
      };
    }
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "America/Bogota",

        year:
          "numeric",

        month:
          "2-digit",
      },
    ).formatToParts(
      new Date(),
    );

  const year =
    Number(
      parts.find(
        (part) =>
          part.type ===
          "year",
      )?.value,
    );

  const month =
    Number(
      parts.find(
        (part) =>
          part.type ===
          "month",
      )?.value,
    );

  const nextYear =
    month === 12
      ? year + 1
      : year;

  const nextMonth =
    month === 12
      ? 1
      : month + 1;

  return {
    year,
    month,

    value:
      `${year}-${String(
        month,
      ).padStart(
        2,
        "0",
      )}`,

    start:
      `${year}-${String(
        month,
      ).padStart(
        2,
        "0",
      )}-01`,

    end:
      `${nextYear}-${String(
        nextMonth,
      ).padStart(
        2,
        "0",
      )}-01`,
  };
}

type FinanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CategoryType = typeof categories.$inferSelect.type;

// Reserved application namespaces for the two-int PostgreSQL advisory lock.
const categoryLockNamespace: Record<CategoryType, number> = {
  income: 0x46540001,
  expense: 0x46540002,
};

export async function lockTransactionCategories(
  tx: FinanceTransaction,
  userId: number,
  type: CategoryType,
) {
  // The second key is the authenticated owner's PostgreSQL integer ID.
  await tx.execute(sql`select pg_advisory_xact_lock(${categoryLockNamespace[type]}::integer, ${userId}::integer)`);
}

// Run after acquiring the owner/type lock in a separate READ COMMITTED statement.
export async function resolveCategory(
  tx: FinanceTransaction,
  userId: number,
  type: CategoryType,
  categoryName: string,
) {
  const [existing] = await tx.select()
    .from(categories)
    .where(and(
      eq(categories.userId, userId),
      eq(categories.name, categoryName),
      eq(categories.type, type),
    ))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await tx.insert(categories)
    .values({ userId, name: categoryName, type })
    .returning();

  return created;
}
