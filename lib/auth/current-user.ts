import "server-only";

import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";

export async function getCurrentUser() {
  const session = await auth();

  if (!session?.user?.email) {
    return null;
  }

  const email =
    session.user.email
      .trim()
      .toLowerCase();

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(
      eq(
        users.email,
        email,
      ),
    )
    .limit(1);

  return user ?? null;
}

export type CurrentUser =
  NonNullable<
    Awaited<
      ReturnType<
        typeof getCurrentUser
      >
    >
  >;