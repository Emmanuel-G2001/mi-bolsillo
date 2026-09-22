import {
  createHmac,
} from "node:crypto";

import {
  headers,
} from "next/headers";

import {
  and,
  eq,
  gte,
  lt,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  authRateLimitEvents,
} from "@/db/schema";

export type RateLimitAction =
  | "login"
  | "register";

const RATE_LIMITS = {
  login: {
    maxAttempts: 5,
    windowMs:
      15 * 60 * 1000,
  },

  register: {
    maxAttempts: 5,
    windowMs:
      60 * 60 * 1000,
  },
} satisfies Record<
  RateLimitAction,
  {
    maxAttempts: number;
    windowMs: number;
  }
>;

async function getClientIp() {
  const requestHeaders =
    await headers();

  /*
   * Vercel normalmente envía:
   *
   * x-forwarded-for:
   * client, proxy...
   */
  const forwardedFor =
    requestHeaders.get(
      "x-forwarded-for",
    );

  if (forwardedFor) {
    const [firstIp] =
      forwardedFor.split(",");

    if (firstIp?.trim()) {
      return firstIp.trim();
    }
  }

  const realIp =
    requestHeaders.get(
      "x-real-ip",
    );

  if (realIp) {
    return realIp.trim();
  }

  /*
   * Para desarrollo local.
   */
  return "local";
}

function createIdentifierHash(
  value: string,
) {
  const secret =
    process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error(
      "AUTH_SECRET is required for rate limiting.",
    );
  }

  return createHmac(
    "sha256",
    secret,
  )
    .update(value)
    .digest("hex");
}

export async function getRateLimitKey(
  action: RateLimitAction,
  email?: string,
) {
  const ip =
    await getClientIp();

  /*
   * Login:
   * IP + email.
   *
   * De esta forma una IP no
   * bloquea automáticamente
   * todas las cuentas.
   */
  if (action === "login") {
    const normalizedEmail =
      String(email ?? "")
        .trim()
        .toLowerCase();

    return createIdentifierHash(
      `login:${ip}:${normalizedEmail}`,
    );
  }

  /*
   * Registro:
   * limitamos principalmente por IP.
   */
  return createIdentifierHash(
    `register:${ip}`,
  );
}

export async function isRateLimited(
  action: RateLimitAction,
  keyHash: string,
) {
  const config =
    RATE_LIMITS[action];

  const since =
    new Date(
      Date.now() -
        config.windowMs,
    );

  const [result] =
    await db
      .select({
        total: sql<number>`
          count(*)::int
        `,
      })
      .from(
        authRateLimitEvents,
      )
      .where(
        and(
          eq(
            authRateLimitEvents
              .keyHash,
            keyHash,
          ),
          eq(
            authRateLimitEvents
              .action,
            action,
          ),
          gte(
            authRateLimitEvents
              .createdAt,
            since,
          ),
        ),
      );

  return (
    Number(
      result?.total ?? 0,
    ) >= config.maxAttempts
  );
}

export async function recordRateLimitEvent(
  action: RateLimitAction,
  keyHash: string,
) {
  /*
   * Eliminamos eventos antiguos
   * para que la tabla no crezca
   * indefinidamente.
   */
  const cleanupBefore =
    new Date(
      Date.now() -
        24 *
          60 *
          60 *
          1000,
    );

  await db
    .delete(
      authRateLimitEvents,
    )
    .where(
      and(
        eq(
          authRateLimitEvents
            .keyHash,
          keyHash,
        ),
        eq(
          authRateLimitEvents
            .action,
          action,
        ),
        lt(
          authRateLimitEvents
            .createdAt,
          cleanupBefore,
        ),
      ),
    );

  await db
    .insert(
      authRateLimitEvents,
    )
    .values({
      keyHash,
      action,
    });
}

export async function clearRateLimitEvents(
  action: RateLimitAction,
  keyHash: string,
) {
  await db
    .delete(authRateLimitEvents)
    .where(
      and(
        eq(
          authRateLimitEvents.keyHash,
          keyHash,
        ),
        eq(
          authRateLimitEvents.action,
          action,
        ),
      ),
    );
}