import "server-only";

import {
  and,
  eq,
} from "drizzle-orm";

import { db } from "@/db";
import {
  transactions,
} from "@/db/schema";

import {
  getBogotaToday,
  resolveCategory,
} from "@/features/finance/finance.utils";

type TransactionType =
  | "income"
  | "expense";

type CreateTransactionInput = {
  description: string;
  amount: number;
  type: TransactionType;
  category?: string;
  date?: string;
};

type UpdateTransactionInput = {
  id: number;
  description: string;
  amount: number;
  type: TransactionType;
  category?: string;
  date: string;
};

export async function createTransaction(
  userId: number,
  input: CreateTransactionInput,
) {
  const categoryName =
    input.type === "income"
      ? "Ingresos"
      : input.category ??
        "Otros";

  const category =
    await resolveCategory(
      userId,
      input.type,
      categoryName,
    );

  const [created] =
    await db
      .insert(
        transactions,
      )
      .values({
        userId,

        categoryId:
          category.id,

        type:
          input.type,

        description:
          input.description,

        amount:
          input.amount.toFixed(
            2,
          ),

        transactionDate:
          input.date ??
          getBogotaToday(),
      })
      .returning();

  return {
    id:
      String(
        created.id,
      ),

    description:
      created.description,

    amount:
      Number(
        created.amount,
      ),

    type:
      created.type,

    category:
      categoryName,

    date:
      created.transactionDate,
  };
}

export async function updateTransaction(
  userId: number,
  input: UpdateTransactionInput,
) {
  const [existing] =
    await db
      .select({
        id:
          transactions.id,
      })
      .from(
        transactions,
      )
      .where(
        and(
          eq(
            transactions.id,
            input.id,
          ),

          eq(
            transactions.userId,
            userId,
          ),
        ),
      )
      .limit(1);

  if (!existing) {
    return null;
  }

  const categoryName =
    input.type === "income"
      ? "Ingresos"
      : input.category ??
        "Otros";

  const category =
    await resolveCategory(
      userId,
      input.type,
      categoryName,
    );

  const [updated] =
    await db
      .update(
        transactions,
      )
      .set({
        description:
          input.description,

        amount:
          input.amount.toFixed(
            2,
          ),

        type:
          input.type,

        categoryId:
          category.id,

        transactionDate:
          input.date,

        updatedAt:
          new Date(),
      })
      .where(
        and(
          eq(
            transactions.id,
            input.id,
          ),

          eq(
            transactions.userId,
            userId,
          ),
        ),
      )
      .returning();

  if (!updated) {
    return null;
  }

  return {
    id:
      String(
        updated.id,
      ),

    description:
      updated.description,

    amount:
      Number(
        updated.amount,
      ),

    type:
      updated.type,

    category:
      categoryName,

    date:
      updated.transactionDate,
  };
}

export async function deleteTransaction(
  userId: number,
  id: number,
) {
  const deleted =
    await db
      .delete(
        transactions,
      )
      .where(
        and(
          eq(
            transactions.id,
            id,
          ),

          eq(
            transactions.userId,
            userId,
          ),
        ),
      )
      .returning({
        id:
          transactions.id,
      });

  return (
    deleted.length >
    0
  );
}