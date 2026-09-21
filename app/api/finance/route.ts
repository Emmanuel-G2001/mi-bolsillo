import { NextRequest, NextResponse } from "next/server";
import {
  and,
  desc,
  eq,
  gte,
  lt,
  sql,
} from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import {
  categories,
  monthlyBudgets,
  savingsGoals,
  savingsContributions,
  transactions,
  users,
} from "@/db/schema";

async function getCurrentUser() {
  const session = await auth();

  if (!session?.user?.email) {
    return null;
  }

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  return user ?? null;
}

function getMonthInfo(monthValue?: string | null) {
  if (monthValue && /^\d{4}-\d{2}$/.test(monthValue)) {
    const [year, month] = monthValue.split("-").map(Number);

    if (month >= 1 && month <= 12) {
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;

      return {
        year,
        month,
        value: monthValue,
        start: `${year}-${String(month).padStart(2, "0")}-01`,
        end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
      };
    }
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = Number(
    parts.find((part) => part.type === "year")?.value,
  );

  const month = Number(
    parts.find((part) => part.type === "month")?.value,
  );

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    year,
    month,
    value: `${year}-${String(month).padStart(2, "0")}`,
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

async function resolveCategory(
  userId: number,
  type: "income" | "expense",
  categoryName: string,
) {
  let [category] = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        eq(categories.name, categoryName),
        eq(categories.type, type),
      ),
    )
    .limit(1);

  if (!category) {
    [category] = await db
      .insert(categories)
      .values({
        userId,
        name: categoryName,
        type,
      })
      .returning();
  }

  return category;
}

/*
 * GET
 *
 * Dashboard financiero del mes seleccionado.
 *
 * previousBalance representa todo lo que quedó
 * de los meses anteriores:
 *
 * ingresos anteriores
 * - gastos anteriores
 * - ahorros anteriores
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const monthInfo = getMonthInfo(
    request.nextUrl.searchParams.get("month"),
  );

  /*
   * INGRESOS Y GASTOS DE TODOS LOS MESES ANTERIORES
   */
  const [previousSummary] = await db
    .select({
      income: sql<string>`
        COALESCE(
          SUM(
            CASE
              WHEN ${transactions.type} = 'income'
              THEN ${transactions.amount}
              ELSE 0
            END
          ),
          0
        )
      `,

      expense: sql<string>`
        COALESCE(
          SUM(
            CASE
              WHEN ${transactions.type} = 'expense'
              THEN ${transactions.amount}
              ELSE 0
            END
          ),
          0
        )
      `,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, user.id),
        lt(
          transactions.transactionDate,
          monthInfo.start,
        ),
      ),
    );

  /*
   * AHORRO DE TODOS LOS MESES ANTERIORES
   */
  const [previousSavingsSummary] = await db
    .select({
      amount: sql<string>`
        COALESCE(
          SUM(${savingsContributions.amount}),
          0
        )
      `,
    })
    .from(savingsContributions)
    .where(
      and(
        eq(savingsContributions.userId, user.id),
        lt(
          savingsContributions.contributionDate,
          monthInfo.start,
        ),
      ),
    );

  /*
   * AHORRO DEL MES SELECCIONADO
   */
  const [monthSavingsSummary] = await db
    .select({
      amount: sql<string>`
        COALESCE(
          SUM(${savingsContributions.amount}),
          0
        )
      `,
    })
    .from(savingsContributions)
    .where(
      and(
        eq(savingsContributions.userId, user.id),
        gte(
          savingsContributions.contributionDate,
          monthInfo.start,
        ),
        lt(
          savingsContributions.contributionDate,
          monthInfo.end,
        ),
      ),
    );

  const previousIncome = Number(
    previousSummary?.income ?? 0,
  );

  const previousExpense = Number(
    previousSummary?.expense ?? 0,
  );

  const previousSavings = Number(
    previousSavingsSummary?.amount ?? 0,
  );

  const monthSavings = Number(
    monthSavingsSummary?.amount ?? 0,
  );

  /*
   * SALDO DISPONIBLE QUE VIENE DE MESES ANTERIORES
   */
  const previousBalance =
    previousIncome -
    previousExpense -
    previousSavings;

  /*
   * MOVIMIENTOS DEL MES SELECCIONADO
   */
  const transactionRows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      amount: transactions.amount,
      type: transactions.type,
      date: transactions.transactionDate,
      category: categories.name,
    })
    .from(transactions)
    .leftJoin(
      categories,
      eq(transactions.categoryId, categories.id),
    )
    .where(
      and(
        eq(transactions.userId, user.id),
        gte(
          transactions.transactionDate,
          monthInfo.start,
        ),
        lt(
          transactions.transactionDate,
          monthInfo.end,
        ),
      ),
    )
    .orderBy(
      desc(transactions.transactionDate),
      desc(transactions.id),
    );

  /*
   * METAS DE AHORRO
   *
   * Las metas no dependen del mes.
   */
  const goalRows = await db
    .select()
    .from(savingsGoals)
    .where(
      eq(savingsGoals.userId, user.id),
    )
    .orderBy(
      desc(savingsGoals.id),
    );

  /*
   * PRESUPUESTO DEL MES
   */
  const [budgetRow] = await db
    .select()
    .from(monthlyBudgets)
    .where(
      and(
        eq(monthlyBudgets.userId, user.id),
        eq(
          monthlyBudgets.year,
          monthInfo.year,
        ),
        eq(
          monthlyBudgets.month,
          monthInfo.month,
        ),
      ),
    )
    .limit(1);

  return NextResponse.json({
    userName: user.name,
    month: monthInfo.value,

    /*
     * Saldo que viene acumulado
     * de meses anteriores.
     */
    previousBalance,

    /*
     * Total ahorrado únicamente
     * durante el mes seleccionado.
     */
    savings: monthSavings,

    transactions: transactionRows.map(
      (item) => ({
        id: String(item.id),
        description: item.description,
        amount: Number(item.amount),
        type: item.type,

        category:
          item.category ??
          (
            item.type === "income"
              ? "Ingresos"
              : "Otros"
          ),

        date: item.date,
      }),
    ),

    goals: goalRows.map((goal) => ({
      id: String(goal.id),
      name: goal.name,
      current: Number(
        goal.currentAmount,
      ),
      target: Number(
        goal.targetAmount,
      ),
    })),

    budget: Number(
      budgetRow?.amount ?? 0,
    ),
  });
}

/*
 * POST
 *
 * Crear:
 *
 * - movimiento
 * - meta de ahorro
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const body = await request.json();

  /*
   * CREAR MOVIMIENTO
   */
  if (body.kind === "transaction") {
    const type: "income" | "expense" =
      body.type === "income"
        ? "income"
        : "expense";

    const description = String(
      body.description ?? "",
    ).trim();

    const amount = Number(
      body.amount,
    );

    const today = new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "America/Bogota",
      },
    ).format(new Date());

    const transactionDate = String(
      body.date || today,
    );

    if (
      !description ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        transactionDate,
      )
    ) {
      return NextResponse.json(
        {
          error: "Datos inválidos",
        },
        {
          status: 400,
        },
      );
    }

    const categoryName =
      type === "income"
        ? "Ingresos"
        : String(
            body.category || "Otros",
          );

    const category =
      await resolveCategory(
        user.id,
        type,
        categoryName,
      );

    const [created] = await db
      .insert(transactions)
      .values({
        userId: user.id,
        categoryId: category.id,
        type,
        description,
        amount: amount.toFixed(2),
        transactionDate,
      })
      .returning();

    return NextResponse.json({
      id: String(created.id),
      description: created.description,
      amount: Number(created.amount),
      type: created.type,
      category: categoryName,
      date: created.transactionDate,
    });
  }

  /*
   * CREAR META DE AHORRO
   */
  if (body.kind === "goal") {
    const name = String(
      body.name ?? "",
    ).trim();

    const target = Number(
      body.target,
    );

    const current = Number(
      body.current ?? 0,
    );

    if (
      !name ||
      !Number.isFinite(target) ||
      target <= 0 ||
      !Number.isFinite(current) ||
      current < 0
    ) {
      return NextResponse.json(
        {
          error: "Datos inválidos",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * No permitimos que el ahorro inicial
     * supere la meta.
     */
    const currentAmount = Math.min(
      current,
      target,
    );

    const today =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "America/Bogota",
        },
      ).format(new Date());

    /*
     * Creamos la meta y, si tiene
     * un ahorro inicial, registramos
     * ese aporte dentro de la misma
     * transacción SQL.
     */
    const created =
      await db.transaction(
        async (tx) => {
          const [goal] = await tx
            .insert(savingsGoals)
            .values({
              userId: user.id,
              name,
              targetAmount:
                target.toFixed(2),
              currentAmount:
                currentAmount.toFixed(2),
            })
            .returning();

          /*
           * Si la meta comienza con dinero
           * ya ahorrado, este dinero también
           * debe reducir el saldo disponible.
           */
          if (currentAmount > 0) {
            await tx
              .insert(
                savingsContributions,
              )
              .values({
                userId: user.id,
                goalId: goal.id,
                amount:
                  currentAmount.toFixed(2),
                contributionDate: today,
              });
          }

          return goal;
        },
      );

    return NextResponse.json({
      id: String(created.id),
      name: created.name,
      current: Number(
        created.currentAmount,
      ),
      target: Number(
        created.targetAmount,
      ),
    });
  }

  return NextResponse.json(
    {
      error: "Operación inválida",
    },
    {
      status: 400,
    },
  );
}

/*
 * PATCH
 *
 * - editar movimiento
 * - abonar a meta
 * - actualizar presupuesto
 */
export async function PATCH(
  request: NextRequest,
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const body = await request.json();

  /*
   * EDITAR MOVIMIENTO
   */
  if (body.kind === "transaction") {
    const transactionId = Number(
      body.id,
    );

    const amount = Number(
      body.amount,
    );

    const type: "income" | "expense" =
      body.type === "income"
        ? "income"
        : "expense";

    const description = String(
      body.description ?? "",
    ).trim();

    const transactionDate = String(
      body.date ?? "",
    );

    if (
      !Number.isInteger(
        transactionId,
      ) ||
      !description ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        transactionDate,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Datos del movimiento inválidos",
        },
        {
          status: 400,
        },
      );
    }

    const [existingTransaction] =
      await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(
              transactions.id,
              transactionId,
            ),
            eq(
              transactions.userId,
              user.id,
            ),
          ),
        )
        .limit(1);

    if (!existingTransaction) {
      return NextResponse.json(
        {
          error:
            "Movimiento no encontrado",
        },
        {
          status: 404,
        },
      );
    }

    const categoryName =
      type === "income"
        ? "Ingresos"
        : String(
            body.category || "Otros",
          );

    const category =
      await resolveCategory(
        user.id,
        type,
        categoryName,
      );

    const [updated] = await db
      .update(transactions)
      .set({
        description,
        amount: amount.toFixed(2),
        type,
        categoryId: category.id,
        transactionDate,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(
            transactions.id,
            transactionId,
          ),
          eq(
            transactions.userId,
            user.id,
          ),
        ),
      )
      .returning();

    return NextResponse.json({
      id: String(updated.id),
      description:
        updated.description,
      amount: Number(
        updated.amount,
      ),
      type: updated.type,
      category: categoryName,
      date:
        updated.transactionDate,
    });
  }

  /*
   * ABONAR A META
   *
   * Cada abono:
   *
   * 1. incrementa currentAmount
   * 2. crea savingsContribution
   * 3. se descontará del saldo
   *    disponible del mes correspondiente
   */
  if (body.kind === "goal") {
    const id = Number(
      body.id,
    );

    const contribution = Number(
      body.amount,
    );

    if (
      !Number.isInteger(id) ||
      !Number.isFinite(
        contribution,
      ) ||
      contribution <= 0
    ) {
      return NextResponse.json(
        {
          error: "Abono inválido.",
        },
        {
          status: 400,
        },
      );
    }

    const [goal] = await db
      .select()
      .from(savingsGoals)
      .where(
        and(
          eq(
            savingsGoals.id,
            id,
          ),
          eq(
            savingsGoals.userId,
            user.id,
          ),
        ),
      )
      .limit(1);

    if (!goal) {
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

    const current = Number(
      goal.currentAmount,
    );

    const target = Number(
      goal.targetAmount,
    );

    const remaining = Math.max(
      target - current,
      0,
    );

    if (remaining <= 0) {
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

    /*
     * Si intenta abonar más dinero
     * del que falta para completar
     * la meta, solo se aplica lo necesario.
     */
    const appliedAmount = Math.min(
      contribution,
      remaining,
    );

    const today =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "America/Bogota",
        },
      ).format(new Date());

    await db.transaction(
      async (tx) => {
        /*
         * Actualizar acumulado de la meta.
         */
        await tx
          .update(savingsGoals)
          .set({
            currentAmount: String(
              current +
                appliedAmount,
            ),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(
                savingsGoals.id,
                id,
              ),
              eq(
                savingsGoals.userId,
                user.id,
              ),
            ),
          );

        /*
         * Registrar el movimiento
         * de ahorro con su fecha.
         */
        await tx
          .insert(
            savingsContributions,
          )
          .values({
            userId: user.id,
            goalId: goal.id,
            amount:
              appliedAmount.toFixed(
                2,
              ),
            contributionDate:
              today,
          });
      },
    );

    return NextResponse.json({
      ok: true,
      appliedAmount,
    });
  }

  /*
   * ACTUALIZAR PRESUPUESTO
   */
  const amount = Number(
    body.amount,
  );

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "Presupuesto inválido",
      },
      {
        status: 400,
      },
    );
  }

  const monthInfo =
    getMonthInfo(
      body.month,
    );

  const [existing] = await db
    .select()
    .from(monthlyBudgets)
    .where(
      and(
        eq(
          monthlyBudgets.userId,
          user.id,
        ),
        eq(
          monthlyBudgets.year,
          monthInfo.year,
        ),
        eq(
          monthlyBudgets.month,
          monthInfo.month,
        ),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(monthlyBudgets)
      .set({
        amount:
          amount.toFixed(2),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(
            monthlyBudgets.id,
            existing.id,
          ),
          eq(
            monthlyBudgets.userId,
            user.id,
          ),
        ),
      );
  } else {
    await db
      .insert(monthlyBudgets)
      .values({
        userId: user.id,
        year: monthInfo.year,
        month: monthInfo.month,
        amount:
          amount.toFixed(2),
      });
  }

  return NextResponse.json({
    amount,
  });
}

/*
 * DELETE
 *
 * Eliminar movimiento o meta
 */
export async function DELETE(
  request: NextRequest,
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const kind =
    request.nextUrl.searchParams.get(
      "kind",
    );

  const id = Number(
    request.nextUrl.searchParams.get(
      "id",
    ),
  );

  if (!Number.isInteger(id)) {
    return NextResponse.json(
      {
        error: "ID inválido",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * ELIMINAR MOVIMIENTO
   */
  if (kind === "transaction") {
    await db
      .delete(transactions)
      .where(
        and(
          eq(
            transactions.id,
            id,
          ),
          eq(
            transactions.userId,
            user.id,
          ),
        ),
      );

    return NextResponse.json({
      success: true,
    });
  }

  /*
   * ELIMINAR META
   */
 if (kind === "goal") {
  const [goal] = await db
    .select({
      id: savingsGoals.id,
    })
    .from(savingsGoals)
    .where(
      and(
        eq(savingsGoals.id, id),
        eq(savingsGoals.userId, user.id),
      ),
    )
    .limit(1);

  if (!goal) {
    return NextResponse.json(
      {
        error: "Meta no encontrada",
      },
      {
        status: 404,
      },
    );
  }

  await db.transaction(async (tx) => {
    /*
     * Primero eliminamos todos los aportes
     * asociados a esta meta.
     *
     * Así dejan de descontarse del saldo.
     */
    await tx
      .delete(savingsContributions)
      .where(
        and(
          eq(
            savingsContributions.goalId,
            id,
          ),
          eq(
            savingsContributions.userId,
            user.id,
          ),
        ),
      );

    /*
     * Luego eliminamos la meta.
     */
    await tx
      .delete(savingsGoals)
      .where(
        and(
          eq(savingsGoals.id, id),
          eq(savingsGoals.userId, user.id),
        ),
      );
  });

  return NextResponse.json({
    success: true,
  });
}
  return NextResponse.json(
    {
      error:
        "Operación inválida",
    },
    {
      status: 400,
    },
  );
}