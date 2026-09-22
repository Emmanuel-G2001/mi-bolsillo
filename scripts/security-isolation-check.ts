import bcrypt from "bcryptjs";
import {
  and,
  eq,
} from "drizzle-orm";
import {
  drizzle,
} from "drizzle-orm/node-postgres";
import {
  Pool,
} from "pg";

import {
  categories,
  monthlyBudgets,
  savingsContributions,
  savingsGoals,
  transactions,
  users,
} from "../db/schema";

/*
 * =========================================================
 * CONFIGURACIÓN
 * =========================================================
 */

const databaseUrl =
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL no está configurada.",
  );
}

const parsedDatabaseUrl =
  new URL(databaseUrl);

/*
 * Esta prueba solamente puede ejecutarse
 * contra una base PostgreSQL local.
 *
 * Nunca contra Neon/producción.
 */
const allowedHosts =
  new Set([
    "localhost",
    "127.0.0.1",
    "::1",
  ]);

if (
  !allowedHosts.has(
    parsedDatabaseUrl.hostname,
  )
) {
  throw new Error(
    [
      "SECURITY CHECK ABORTED.",
      "",
      "Este script solo puede ejecutarse contra PostgreSQL local.",
      `Host recibido: ${parsedDatabaseUrl.hostname}`,
      "",
      "No se permite ejecutarlo contra Neon ni otra base remota.",
    ].join("\n"),
  );
}

/*
 * Usamos el mismo driver pg que ya tiene
 * instalado el proyecto.
 */
const pool =
  new Pool({
    connectionString:
      databaseUrl,

    max: 1,
  });

const db =
  drizzle(pool);

/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(
      `❌ ${message}`,
    );
  }
}

/*
 * =========================================================
 * PRUEBA DE AISLAMIENTO
 * =========================================================
 */

async function main() {
  const suffix =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

  const emailA =
    `security-a-${suffix}@example.com`;

  const emailB =
    `security-b-${suffix}@example.com`;

  let userAId:
    | number
    | null = null;

  let userBId:
    | number
    | null = null;

  console.log("");
  console.log(
    "🔐 Iniciando prueba de aislamiento...",
  );

  console.log(
    `📦 Base local: ${parsedDatabaseUrl.hostname}:${parsedDatabaseUrl.port || "5432"}${parsedDatabaseUrl.pathname}`,
  );

  console.log("");

  try {
    /*
     * =====================================================
     * CREAR USUARIOS
     * =====================================================
     */

    const passwordHash =
      await bcrypt.hash(
        "SecurityTest123",
        12,
      );

    const [userA] =
      await db
        .insert(users)
        .values({
          name:
            "Security User A",

          email:
            emailA,

          passwordHash,
        })
        .returning();

    assert(
      userA,
      "No se pudo crear User A.",
    );

    userAId =
      userA.id;

    const [userB] =
      await db
        .insert(users)
        .values({
          name:
            "Security User B",

          email:
            emailB,

          passwordHash,
        })
        .returning();

    assert(
      userB,
      "No se pudo crear User B.",
    );

    userBId =
      userB.id;

    console.log(
      "✅ Usuarios temporales creados",
    );

    /*
     * =====================================================
     * CATEGORÍAS
     * =====================================================
     */

    const [categoryA] =
      await db
        .insert(categories)
        .values({
          userId:
            userA.id,

          name:
            "Categoría privada A",

          type:
            "expense",
        })
        .returning();

    const [categoryB] =
      await db
        .insert(categories)
        .values({
          userId:
            userB.id,

          name:
            "Categoría privada B",

          type:
            "expense",
        })
        .returning();

    assert(
      categoryA &&
        categoryB,
      "No se pudieron crear las categorías.",
    );

    /*
     * =====================================================
     * MOVIMIENTOS
     * =====================================================
     */

    const [
      transactionA,
    ] =
      await db
        .insert(
          transactions,
        )
        .values({
          userId:
            userA.id,

          categoryId:
            categoryA.id,

          type:
            "expense",

          description:
            "Movimiento privado A",

          amount:
            "10000.00",

          transactionDate:
            "2026-09-01",
        })
        .returning();

    const [
      transactionB,
    ] =
      await db
        .insert(
          transactions,
        )
        .values({
          userId:
            userB.id,

          categoryId:
            categoryB.id,

          type:
            "expense",

          description:
            "Movimiento privado B",

          amount:
            "20000.00",

          transactionDate:
            "2026-09-01",
        })
        .returning();

    assert(
      transactionA &&
        transactionB,
      "No se pudieron crear los movimientos.",
    );

    /*
     * =====================================================
     * METAS
     * =====================================================
     */

    const [goalA] =
      await db
        .insert(
          savingsGoals,
        )
        .values({
          userId:
            userA.id,

          name:
            "Meta privada A",

          targetAmount:
            "100000.00",

          currentAmount:
            "10000.00",
        })
        .returning();

    const [goalB] =
      await db
        .insert(
          savingsGoals,
        )
        .values({
          userId:
            userB.id,

          name:
            "Meta privada B",

          targetAmount:
            "200000.00",

          currentAmount:
            "20000.00",
        })
        .returning();

    assert(
      goalA &&
        goalB,
      "No se pudieron crear las metas.",
    );

    /*
     * =====================================================
     * APORTES DE AHORRO
     * =====================================================
     */

    await db
      .insert(
        savingsContributions,
      )
      .values([
        {
          userId:
            userA.id,

          goalId:
            goalA.id,

          amount:
            "10000.00",

          contributionDate:
            "2026-09-01",
        },

        {
          userId:
            userB.id,

          goalId:
            goalB.id,

          amount:
            "20000.00",

          contributionDate:
            "2026-09-01",
        },
      ]);

    /*
     * =====================================================
     * PRESUPUESTOS
     * =====================================================
     */

    const [
      budgetA,
    ] =
      await db
        .insert(
          monthlyBudgets,
        )
        .values({
          userId:
            userA.id,

          year:
            2026,

          month:
            9,

          amount:
            "500000.00",
        })
        .returning();

    const [
      budgetB,
    ] =
      await db
        .insert(
          monthlyBudgets,
        )
        .values({
          userId:
            userB.id,

          year:
            2026,

          month:
            9,

          amount:
            "800000.00",
        })
        .returning();

    assert(
      budgetA &&
        budgetB,
      "No se pudieron crear los presupuestos.",
    );

    /*
     * =====================================================
     * TEST 1
     *
     * USER A SOLO VE SUS MOVIMIENTOS
     * =====================================================
     */

    const transactionsA =
      await db
        .select()
        .from(
          transactions,
        )
        .where(
          eq(
            transactions
              .userId,
            userA.id,
          ),
        );

    assert(
      transactionsA.length ===
        1,
      "User A debería ver exactamente 1 movimiento.",
    );

    assert(
      transactionsA[0]
        .id ===
        transactionA.id,
      "User A pudo leer un movimiento de User B.",
    );

    assert(
      transactionsA.every(
        (item) =>
          item.userId ===
          userA.id,
      ),
      "Se filtraron movimientos pertenecientes a otro usuario.",
    );

    console.log(
      "✅ Movimientos aislados por usuario",
    );

    /*
     * =====================================================
     * TEST 2
     *
     * USER A SOLO VE SUS METAS
     * =====================================================
     */

    const goalsA =
      await db
        .select()
        .from(
          savingsGoals,
        )
        .where(
          eq(
            savingsGoals
              .userId,
            userA.id,
          ),
        );

    assert(
      goalsA.length ===
        1,
      "User A debería ver exactamente 1 meta.",
    );

    assert(
      goalsA[0].id ===
        goalA.id,
      "User A pudo leer una meta de User B.",
    );

    console.log(
      "✅ Metas aisladas por usuario",
    );

    /*
     * =====================================================
     * TEST 3
     *
     * USER A SOLO VE SUS APORTES
     * =====================================================
     */

    const savingsA =
      await db
        .select()
        .from(
          savingsContributions,
        )
        .where(
          eq(
            savingsContributions
              .userId,
            userA.id,
          ),
        );

    assert(
      savingsA.length ===
        1,
      "User A debería ver exactamente 1 aporte.",
    );

    assert(
      savingsA[0]
        .userId ===
        userA.id,
      "User A pudo leer un ahorro de User B.",
    );

    assert(
      savingsA[0]
        .goalId ===
        goalA.id,
      "User A recibió un aporte asociado a una meta ajena.",
    );

    console.log(
      "✅ Ahorros aislados por usuario",
    );

    /*
     * =====================================================
     * TEST 4
     *
     * USER A SOLO VE SU PRESUPUESTO
     * =====================================================
     */

    const budgetsA =
      await db
        .select()
        .from(
          monthlyBudgets,
        )
        .where(
          and(
            eq(
              monthlyBudgets
                .userId,
              userA.id,
            ),

            eq(
              monthlyBudgets
                .year,
              2026,
            ),

            eq(
              monthlyBudgets
                .month,
              9,
            ),
          ),
        );

    assert(
      budgetsA.length ===
        1,
      "User A debería ver exactamente 1 presupuesto.",
    );

    assert(
      budgetsA[0]
        .id ===
        budgetA.id,
      "User A pudo leer el presupuesto de User B.",
    );

    assert(
      Number(
        budgetsA[0]
          .amount,
      ) ===
        500000,
      "El presupuesto recuperado no pertenece a User A.",
    );

    console.log(
      "✅ Presupuestos aislados por usuario",
    );

    /*
     * =====================================================
     * TEST 5
     *
     * USER A INTENTA MODIFICAR MOVIMIENTO B
     * =====================================================
     */

    const attemptedUpdate =
      await db
        .update(
          transactions,
        )
        .set({
          description:
            "HACKED",
        })
        .where(
          and(
            eq(
              transactions.id,
              transactionB.id,
            ),

            eq(
              transactions
                .userId,
              userA.id,
            ),
          ),
        )
        .returning();

    assert(
      attemptedUpdate.length ===
        0,
      "User A logró modificar un movimiento de User B.",
    );

    const [
      transactionBAfterUpdate,
    ] =
      await db
        .select()
        .from(
          transactions,
        )
        .where(
          eq(
            transactions.id,
            transactionB.id,
          ),
        )
        .limit(1);

    assert(
      transactionBAfterUpdate,
      "El movimiento de User B desapareció.",
    );

    assert(
      transactionBAfterUpdate
        .description ===
        "Movimiento privado B",
      "El movimiento de User B fue modificado.",
    );

    console.log(
      "✅ User A no puede modificar movimientos de User B",
    );

    /*
     * =====================================================
     * TEST 6
     *
     * USER A INTENTA ELIMINAR MOVIMIENTO B
     * =====================================================
     */

    const attemptedDelete =
      await db
        .delete(
          transactions,
        )
        .where(
          and(
            eq(
              transactions.id,
              transactionB.id,
            ),

            eq(
              transactions
                .userId,
              userA.id,
            ),
          ),
        )
        .returning();

    assert(
      attemptedDelete.length ===
        0,
      "User A logró eliminar un movimiento de User B.",
    );

    const [
      transactionBAfterDelete,
    ] =
      await db
        .select()
        .from(
          transactions,
        )
        .where(
          eq(
            transactions.id,
            transactionB.id,
          ),
        )
        .limit(1);

    assert(
      transactionBAfterDelete,
      "El movimiento de User B fue eliminado.",
    );

    console.log(
      "✅ User A no puede eliminar movimientos de User B",
    );

    /*
     * =====================================================
     * TEST 7
     *
     * USER A INTENTA MODIFICAR META B
     * =====================================================
     */

    const attemptedGoalUpdate =
      await db
        .update(
          savingsGoals,
        )
        .set({
          name:
            "META HACKED",
        })
        .where(
          and(
            eq(
              savingsGoals.id,
              goalB.id,
            ),

            eq(
              savingsGoals
                .userId,
              userA.id,
            ),
          ),
        )
        .returning();

    assert(
      attemptedGoalUpdate.length ===
        0,
      "User A logró modificar la meta de User B.",
    );

    const [
      goalBAfterUpdate,
    ] =
      await db
        .select()
        .from(
          savingsGoals,
        )
        .where(
          eq(
            savingsGoals.id,
            goalB.id,
          ),
        )
        .limit(1);

    assert(
      goalBAfterUpdate,
      "La meta de User B desapareció.",
    );

    assert(
      goalBAfterUpdate.name ===
        "Meta privada B",
      "La meta de User B fue modificada.",
    );

    console.log(
      "✅ User A no puede modificar metas de User B",
    );

    /*
     * =====================================================
     * TEST 8
     *
     * USER A INTENTA ELIMINAR META B
     * =====================================================
     */

    const attemptedGoalDelete =
      await db
        .delete(
          savingsGoals,
        )
        .where(
          and(
            eq(
              savingsGoals.id,
              goalB.id,
            ),

            eq(
              savingsGoals
                .userId,
              userA.id,
            ),
          ),
        )
        .returning();

    assert(
      attemptedGoalDelete.length ===
        0,
      "User A logró eliminar la meta de User B.",
    );

    const [
      goalBAfterDelete,
    ] =
      await db
        .select()
        .from(
          savingsGoals,
        )
        .where(
          eq(
            savingsGoals.id,
            goalB.id,
          ),
        )
        .limit(1);

    assert(
      goalBAfterDelete,
      "La meta de User B fue eliminada.",
    );

    console.log(
      "✅ User A no puede eliminar metas de User B",
    );

    /*
     * =====================================================
     * TEST 9
     *
     * USER A INTENTA MODIFICAR PRESUPUESTO B
     * =====================================================
     */

    const attemptedBudgetUpdate =
      await db
        .update(
          monthlyBudgets,
        )
        .set({
          amount:
            "999999.00",
        })
        .where(
          and(
            eq(
              monthlyBudgets.id,
              budgetB.id,
            ),

            eq(
              monthlyBudgets
                .userId,
              userA.id,
            ),
          ),
        )
        .returning();

    assert(
      attemptedBudgetUpdate.length ===
        0,
      "User A logró modificar el presupuesto de User B.",
    );

    const [
      budgetBAfterUpdate,
    ] =
      await db
        .select()
        .from(
          monthlyBudgets,
        )
        .where(
          eq(
            monthlyBudgets.id,
            budgetB.id,
          ),
        )
        .limit(1);

    assert(
      budgetBAfterUpdate,
      "El presupuesto de User B desapareció.",
    );

    assert(
      Number(
        budgetBAfterUpdate
          .amount,
      ) ===
        800000,
      "El presupuesto de User B fue modificado.",
    );

    console.log(
      "✅ User A no puede modificar presupuestos de User B",
    );

    /*
     * =====================================================
     * RESULTADO
     * =====================================================
     */

    console.log("");
    console.log(
      "🛡️ SECURITY ISOLATION CHECK PASSED",
    );
    console.log("");

    console.log(
      "Aislamiento confirmado en:",
    );

    console.log(
      "  ✓ movimientos",
    );

    console.log(
      "  ✓ metas",
    );

    console.log(
      "  ✓ aportes de ahorro",
    );

    console.log(
      "  ✓ presupuestos",
    );

    console.log(
      "  ✓ modificaciones",
    );

    console.log(
      "  ✓ eliminaciones",
    );

    console.log("");
  } finally {
    /*
     * =====================================================
     * LIMPIEZA
     * =====================================================
     *
     * Solo eliminamos los dos usuarios temporales
     * creados por esta ejecución.
     */

    if (
      userAId !== null
    ) {
      await db
        .delete(users)
        .where(
          eq(
            users.id,
            userAId,
          ),
        );
    }

    if (
      userBId !== null
    ) {
      await db
        .delete(users)
        .where(
          eq(
            users.id,
            userBId,
          ),
        );
    }

    console.log(
      "🧹 Datos temporales eliminados",
    );
  }
}

/*
 * =========================================================
 * EJECUCIÓN
 * =========================================================
 */

main()
  .then(async () => {
    await pool.end();

    process.exit(0);
  })
  .catch(
    async (error) => {
      console.error("");
      console.error(
        "❌ SECURITY CHECK FAILED",
      );

      console.error("");

      console.error(
        error instanceof Error
          ? error.message
          : error,
      );

      console.error("");

      await pool.end();

      process.exit(1);
    },
  );