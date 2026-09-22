import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  upsertBudget,
} from "@/features/finance/budgets.service";

import {
  getFinanceDashboard,
} from "@/features/finance/finance-dashboard.service";

import {
  contributeToGoal,
  createGoal,
  deleteGoal,
} from "@/features/finance/goals.service";

import {
  financeDeleteQuerySchema,
  financeMonthQuerySchema,
  financePatchSchema,
  financePostSchema,
} from "@/features/finance/finance.schema";

import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "@/features/finance/transactions.service";

import {
  getCurrentUser,
} from "@/lib/auth/current-user";

/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

async function readJson(
  request: NextRequest,
): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/*
 * =========================================================
 * GET
 * =========================================================
 */

export async function GET(
  request: NextRequest,
) {
  const user =
    await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error:
          "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const parsed =
    financeMonthQuerySchema
      .safeParse({
        month:
          request
            .nextUrl
            .searchParams
            .get(
              "month",
            ) ??
          undefined,
      });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Mes inválido.",
      },
      {
        status: 400,
      },
    );
  }

  const dashboard =
    await getFinanceDashboard(
      {
        id:
          user.id,

        name:
          user.name,
      },

      parsed.data.month,
    );

  return NextResponse.json(
    dashboard,
  );
}

/*
 * =========================================================
 * POST
 *
 * - movimiento
 * - meta
 * =========================================================
 */

export async function POST(
  request: NextRequest,
) {
  const user =
    await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error:
          "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const rawBody =
    await readJson(
      request,
    );

  const parsed =
    financePostSchema
      .safeParse(
        rawBody,
      );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Datos inválidos.",
      },
      {
        status: 400,
      },
    );
  }

  const body =
    parsed.data;

  /*
   * CREAR MOVIMIENTO
   */
  if (
    body.kind ===
    "transaction"
  ) {
    const created =
      await createTransaction(
        user.id,
        {
          description:
            body.description,

          amount:
            body.amount,

          type:
            body.type,

          category:
            body.category,

          date:
            body.date,
        },
      );

    return NextResponse.json(
      created,
    );
  }

  /*
   * CREAR META
   */
  if (
    body.kind ===
    "goal"
  ) {
    const created =
      await createGoal(
        user.id,
        {
          name:
            body.name,

          target:
            body.target,

          current:
            body.current,
        },
      );

    return NextResponse.json(
      created,
    );
  }

  return NextResponse.json(
    {
      error:
        "Operación inválida.",
    },
    {
      status: 400,
    },
  );
}

/*
 * =========================================================
 * PATCH
 *
 * - editar movimiento
 * - abonar a meta
 * - presupuesto
 * =========================================================
 */

export async function PATCH(
  request: NextRequest,
) {
  const user =
    await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error:
          "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const rawBody =
    await readJson(
      request,
    );

  const parsed =
    financePatchSchema
      .safeParse(
        rawBody,
      );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Datos inválidos.",
      },
      {
        status: 400,
      },
    );
  }

  const body =
    parsed.data;

  /*
   * EDITAR MOVIMIENTO
   */
  if (
    body.kind ===
    "transaction"
  ) {
    const updated =
      await updateTransaction(
        user.id,
        {
          id:
            body.id,

          description:
            body.description,

          amount:
            body.amount,

          type:
            body.type,

          category:
            body.category,

          date:
            body.date,
        },
      );

    if (!updated) {
      return NextResponse.json(
        {
          error:
            "Movimiento no encontrado.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json(
      updated,
    );
  }

  /*
   * ABONAR A META
   */
  if (
    body.kind ===
    "goal"
  ) {
    const result =
      await contributeToGoal(
        user.id,
        body.id,
        body.amount,
      );

    if (
      result.status ===
      "not_found"
    ) {
      return NextResponse.json(
        {
          error:
            "Meta no encontrada.",
        },
        {
          status: 404,
        },
      );
    }

    if (
      result.status ===
      "completed"
    ) {
      return NextResponse.json(
        {
          error:
            "La meta ya está completada.",
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json({
      ok: true,

      appliedAmount:
        result.appliedAmount,

      goal:
        result.goal,
    });
  }

  /*
   * PRESUPUESTO
   *
   * Es el único PATCH que actualmente
   * llega sin "kind".
   */
  const result =
    await upsertBudget(
      user.id,
      body.amount,
      body.month,
    );

  return NextResponse.json(
    result,
  );
}

/*
 * =========================================================
 * DELETE
 *
 * - movimiento
 * - meta
 * =========================================================
 */

export async function DELETE(
  request: NextRequest,
) {
  const user =
    await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error:
          "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const parsed =
    financeDeleteQuerySchema
      .safeParse({
        kind:
          request
            .nextUrl
            .searchParams
            .get(
              "kind",
            ),

        id:
          request
            .nextUrl
            .searchParams
            .get(
              "id",
            ),
      });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Operación inválida.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    kind,
    id,
  } =
    parsed.data;

  /*
   * ELIMINAR MOVIMIENTO
   */
  if (
    kind ===
    "transaction"
  ) {
    const deleted =
      await deleteTransaction(
        user.id,
        id,
      );

    if (!deleted) {
      return NextResponse.json(
        {
          error:
            "Movimiento no encontrado.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
    });
  }

  /*
   * ELIMINAR META
   */
  if (
    kind ===
    "goal"
  ) {
    const deleted =
      await deleteGoal(
        user.id,
        id,
      );

    if (!deleted) {
      return NextResponse.json(
        {
          error:
            "Meta no encontrada.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
    });
  }

  return NextResponse.json(
    {
      error:
        "Operación inválida.",
    },
    {
      status: 400,
    },
  );
}