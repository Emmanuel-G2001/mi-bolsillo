import { z } from "zod";

/*
 * PostgreSQL numeric(14, 2)
 *
 * Máximo:
 * 999.999.999.999,99
 */
const MAX_MONEY =
  999_999_999_999.99;

/*
 * =========================================================
 * CAMPOS COMUNES
 * =========================================================
 */

const positiveMoneySchema =
  z.coerce
    .number()
    .finite()
    .positive(
      "El valor debe ser mayor a cero.",
    )
    .max(
      MAX_MONEY,
      "El valor es demasiado grande.",
    );

const nonNegativeMoneySchema =
  z.coerce
    .number()
    .finite()
    .min(
      0,
      "El valor no puede ser negativo.",
    )
    .max(
      MAX_MONEY,
      "El valor es demasiado grande.",
    );

const idSchema =
  z.coerce
    .number()
    .int()
    .positive(
      "El ID debe ser válido.",
    );

const monthSchema =
  z
    .string()
    .regex(
      /^\d{4}-(0[1-9]|1[0-2])$/,
      "Mes inválido.",
    );

const dateSchema =
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "Fecha inválida.",
    )
    .refine(
      (value) => {
        const [
          year,
          month,
          day,
        ] = value
          .split("-")
          .map(Number);

        const date =
          new Date(
            Date.UTC(
              year,
              month - 1,
              day,
            ),
          );

        return (
          date.getUTCFullYear() ===
            year &&
          date.getUTCMonth() ===
            month - 1 &&
          date.getUTCDate() ===
            day
        );
      },
      {
        message:
          "La fecha no existe.",
      },
    );

const transactionTypeSchema =
  z.enum([
    "income",
    "expense",
  ]);

const descriptionSchema =
  z
    .string()
    .trim()
    .min(
      1,
      "La descripción es obligatoria.",
    )
    .max(
      160,
      "La descripción es demasiado larga.",
    );

const categorySchema =
  z
    .string()
    .trim()
    .min(
      1,
      "La categoría es obligatoria.",
    )
    .max(
      80,
      "La categoría es demasiado larga.",
    );

const goalNameSchema =
  z
    .string()
    .trim()
    .min(
      1,
      "El nombre de la meta es obligatorio.",
    )
    .max(
      120,
      "El nombre de la meta es demasiado largo.",
    );

/*
 * =========================================================
 * GET
 *
 * /api/finance?month=2026-09
 * =========================================================
 */

export const financeMonthQuerySchema =
  z
    .object({
      month:
        monthSchema.optional(),
    })
    .strict();

/*
 * =========================================================
 * POST — CREAR MOVIMIENTO
 * =========================================================
 */

export const createTransactionSchema =
  z
    .object({
      kind:
        z.literal(
          "transaction",
        ),

      description:
        descriptionSchema,

      amount:
        positiveMoneySchema,

      type:
        transactionTypeSchema,

      category:
        categorySchema.optional(),

      /*
       * Opcional para conservar el
       * comportamiento anterior:
       * si no llega se usa hoy.
       */
      date:
        dateSchema.optional(),
    })
    .strict();

/*
 * =========================================================
 * POST — CREAR META
 * =========================================================
 */

export const createGoalSchema =
  z
    .object({
      kind:
        z.literal(
          "goal",
        ),

      name:
        goalNameSchema,

      target:
        positiveMoneySchema,

      current:
        nonNegativeMoneySchema
          .default(0),
    })
    .strict();

/*
 * =========================================================
 * POST GENERAL
 * =========================================================
 */

export const financePostSchema =
  z.discriminatedUnion(
    "kind",
    [
      createTransactionSchema,
      createGoalSchema,
    ],
  );

/*
 * =========================================================
 * PATCH — EDITAR MOVIMIENTO
 * =========================================================
 */

export const updateTransactionSchema =
  z
    .object({
      kind:
        z.literal(
          "transaction",
        ),

      id:
        idSchema,

      description:
        descriptionSchema,

      amount:
        positiveMoneySchema,

      type:
        transactionTypeSchema,

      category:
        categorySchema.optional(),

      date:
        dateSchema,
    })
    .strict();

/*
 * =========================================================
 * PATCH — ABONAR A META
 * =========================================================
 */

export const contributeGoalSchema =
  z
    .object({
      kind:
        z.literal(
          "goal",
        ),

      id:
        idSchema,

      amount:
        positiveMoneySchema,
    })
    .strict();

/*
 * =========================================================
 * PATCH — PRESUPUESTO
 *
 * El frontend actualmente envía:
 *
 * {
 *   amount,
 *   month
 * }
 *
 * sin "kind".
 * =========================================================
 */

export const updateBudgetSchema =
  z
    .object({
      kind:
        z
          .undefined()
          .optional(),

      amount:
        positiveMoneySchema,

      month:
        monthSchema.optional(),
    })
    .strict();

/*
 * =========================================================
 * PATCH GENERAL
 * =========================================================
 */

export const financePatchSchema =
  z.union([
    updateTransactionSchema,
    contributeGoalSchema,
    updateBudgetSchema,
  ]);

/*
 * =========================================================
 * DELETE
 *
 * ?kind=transaction&id=1
 * ?kind=goal&id=2
 * =========================================================
 */

export const financeDeleteQuerySchema =
  z
    .object({
      kind:
        z.enum([
          "transaction",
          "goal",
        ]),

      id:
        idSchema,
    })
    .strict();