import "server-only";

import {
  and,
  eq,
  TransactionRollbackError,
} from "drizzle-orm";

import { db } from "@/db";
import {
  transactions,
} from "@/db/schema";

import {
  getBogotaToday,
  lockTransactionCategories,
  resolveCategory,
} from "@/features/finance/finance.utils";

import { formatMoneyCents } from "@/features/finance/finance.money";

type TransactionType =
  | "income"
  | "expense";

type CreateTransactionInput = {
  description: string;
  amount: bigint;
  type: TransactionType;
  category?: string;
  date?: string;
};

type UpdateTransactionInput = {
  id: number;
  description: string;
  amount: bigint;
  type: TransactionType;
  category?: string;
  date: string;
};

export async function createTransaction(
  userId: number,
  input: CreateTransactionInput,
) {
  const categoryName =
    input.type === "income" ? "Ingresos" : input.category ?? "Otros";

  return db.transaction(async (tx) => {
    await lockTransactionCategories(tx, userId, input.type);
    const category = await resolveCategory(tx, userId, input.type, categoryName);

    const [created] = await tx.insert(transactions)
      .values({
        userId,
        categoryId: category.id,
        type: input.type,
        description: input.description,
        amount: formatMoneyCents(input.amount),
        transactionDate: input.date ?? getBogotaToday(),
      })
      .returning();

    return {
      id: String(created.id),
      description: created.description,
      amount: Number(created.amount),
      type: created.type,
      category: categoryName,
      date: created.transactionDate,
    };
  }, { isolationLevel: "read committed" });
}

export async function updateTransaction(
  userId: number,
  input: UpdateTransactionInput,
) {
  const categoryName =
    input.type === "income" ? "Ingresos" : input.category ?? "Otros";
  const ownedTransaction = and(
    eq(transactions.id, input.id),
    eq(transactions.userId, userId),
  );

  try {
    return await db.transaction(async (tx) => {
      // Edits lock the destination category scope before the row. Deletes
      // lock only the row, and creates never lock an existing movement.
      await lockTransactionCategories(tx, userId, input.type);
      const [existing] = await tx.select({ id: transactions.id })
        .from(transactions)
        .where(ownedTransaction)
        .for("update");

      if (!existing) {
        return null;
      }

      const category = await resolveCategory(tx, userId, input.type, categoryName);
      const [updated] = await tx.update(transactions)
        .set({
          description: input.description,
          amount: formatMoneyCents(input.amount),
          type: input.type,
          categoryId: category.id,
          transactionDate: input.date,
          updatedAt: new Date(),
        })
        .where(ownedTransaction)
        .returning();

      if (!updated) {
        tx.rollback();
      }

      return {
        id: String(updated.id),
        description: updated.description,
        amount: Number(updated.amount),
        type: updated.type,
        category: categoryName,
        date: updated.transactionDate,
      };
    }, { isolationLevel: "read committed" });
  } catch (error) {
    if (error instanceof TransactionRollbackError) {
      return null;
    }

    throw error;
  }
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