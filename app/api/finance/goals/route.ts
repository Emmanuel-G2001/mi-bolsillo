import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { GoalLedgerError, readGoalLedger, writeGoalOperation } from "@/features/finance/goal-ledger.service";
import { toMoneyCents } from "@/features/finance/finance.money";
import { getCurrentUser } from "@/lib/auth/current-user";

const id = z.number().int().positive().max(2147483647);
const operationId = z.uuid().transform(value => value.toLowerCase());
const base = { goalId: id, operationId };
const reason = z.string().trim().min(1).max(240);
const amount = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).transform(toMoneyCents).refine(value => value > BigInt(0));
const mutation = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("fund"), amount }),
  z.strictObject({ ...base, kind: z.literal("release"), amount, reason }),
  z.strictObject({ ...base, kind: z.literal("transfer"), amount, destinationGoalId: id, reason }),
  z.strictObject({ ...base, kind: z.literal("archive") }),
  z.strictObject({ ...base, kind: z.literal("restore") }),
  z.strictObject({ ...base, kind: z.literal("close") }),
  z.strictObject({ ...base, kind: z.literal("reverse"), originalOperationId: operationId, reason }),
]);
const queryId = z.string().regex(/^\d{1,10}$/).transform(Number).pipe(id);

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof GoalLedgerError) return response({ error: error.message }, error.status);
  return response({ error: "No fue posible procesar la operación de la meta." }, 500);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return response({ error: "Inicia sesión para consultar las metas." }, 401);
  const goalId = request.nextUrl.searchParams.get("goalId");
  const before = request.nextUrl.searchParams.get("before");
  const legacyBefore = request.nextUrl.searchParams.get("legacyBefore");
  const parsed = z.object({ goalId: queryId.nullable(), before: operationId.nullable(), legacyBefore: queryId.nullable() })
    .safeParse({ goalId, before, legacyBefore });
  if (!parsed.success || ((before !== null || legacyBefore !== null) && goalId === null)) {
    return response({ error: "La meta o el cursor no son válidos." }, 400);
  }
  try {
    return response(await readGoalLedger(user.id, parsed.data.goalId ?? undefined, parsed.data.before ?? undefined,
      parsed.data.legacyBefore ?? undefined));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return response({ error: "Solicitud no permitida." }, 403);
  const user = await getCurrentUser();
  if (!user) return response({ error: "Inicia sesión para gestionar las metas." }, 401);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return response({ error: "Se requiere una solicitud JSON." }, 415);
  }
  const parsed = mutation.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Revisa los datos de la operación." }, 400);
  try {
    return response(await writeGoalOperation(user.id, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}
