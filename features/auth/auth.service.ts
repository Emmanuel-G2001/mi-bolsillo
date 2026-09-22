import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

type CreateUserInput = {
  name: string;
  email: string;
  password: string;
};

type CreateUserResult =
  | {
      ok: true;
      user: {
        id: number;
        name: string;
        email: string;
      };
    }
  | {
      ok: false;
      reason:
        | "email_in_use"
        | "unknown";
    };

function isUniqueViolation(
  error: unknown,
) {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  if (
    "code" in error &&
    String(
      (
        error as {
          code?: unknown;
        }
      ).code,
    ) === "23505"
  ) {
    return true;
  }

  if ("cause" in error) {
    return isUniqueViolation(
      (
        error as {
          cause?: unknown;
        }
      ).cause,
    );
  }

  return false;
}

export async function createUser(
  input: CreateUserInput,
): Promise<CreateUserResult> {
  const name =
    input.name.trim();

  const email =
    input.email
      .trim()
      .toLowerCase();

  const [existingUser] =
    await db
      .select({
        id: users.id,
      })
      .from(users)
      .where(
        eq(
          users.email,
          email,
        ),
      )
      .limit(1);

  if (existingUser) {
    return {
      ok: false,
      reason: "email_in_use",
    };
  }

  const passwordHash =
    await bcrypt.hash(
      input.password,
      12,
    );

  try {
    const [createdUser] =
      await db
        .insert(users)
        .values({
          name,
          email,
          passwordHash,
        })
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
        });

    return {
      ok: true,
      user: createdUser,
    };
  } catch (error) {
    if (
      isUniqueViolation(
        error,
      )
    ) {
      return {
        ok: false,
        reason:
          "email_in_use",
      };
    }

    console.error(
      "Error creating user:",
      error instanceof Error
        ? error.message
        : "unknown_error",
    );

    return {
      ok: false,
      reason: "unknown",
    };
  }
}