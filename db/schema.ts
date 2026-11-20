import {
  pgEnum,
  pgTable,
  serial,
  varchar,
  timestamp,
  date,
  numeric,
  text,
  integer,
  index,
  check,
  foreignKey,
  jsonb,
  primaryKey,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),

  name: varchar("name", { length: 100 }).notNull(),

  email: varchar("email", { length: 255 })
    .notNull()
    .unique(),

  passwordHash: text("password_hash").notNull(),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),

  userId: integer("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
    }),

  name: varchar("name", { length: 100 }).notNull(),

  type: transactionTypeEnum("type").notNull(),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),

  userId: integer("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
    }),

  categoryId: integer("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),

  type: transactionTypeEnum("type").notNull(),

  description: varchar("description", {
    length: 255,
  }).notNull(),

  amount: numeric("amount", {
    precision: 14,
    scale: 2,
  }).notNull(),

  transactionDate: date("transaction_date").notNull(),

  notes: text("notes"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const savingsGoals = pgTable("savings_goals", {
  id: serial("id").primaryKey(),

  userId: integer("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
    }),

  name: varchar("name", {
    length: 150,
  }).notNull(),

  targetAmount: numeric("target_amount", {
    precision: 14,
    scale: 2,
  }).notNull(),

  currentAmount: numeric("current_amount", {
    precision: 14,
    scale: 2,
  })
    .default("0")
    .notNull(),

  initialAmount: numeric("initial_amount", { precision: 14, scale: 2 }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),

  targetDate: date("target_date"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
}, (table) => [
  unique("savings_goals_owner_id_unique").on(table.userId, table.id),
  check("savings_goals_initial_range", sql`${table.initialAmount} >= 0 AND ${table.initialAmount} <= ${table.targetAmount}`),
]);

export const savingsContributions = pgTable("savings_contributions", {
  id: serial("id").primaryKey(),

  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  goalId: integer("goal_id").references(() => savingsGoals.id, {
    onDelete: "set null",
  }),

  amount: numeric("amount", {
    precision: 14,
    scale: 2,
  }).notNull(),

  contributionDate: date("contribution_date").notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("savings_contributions_owner_goal_id_unique").on(table.userId, table.goalId, table.id),
]);

export const savingsGoalOperations = pgTable("savings_goal_operations", {
  userId: integer("user_id").notNull(),
  operationId: uuid("operation_id").notNull(),
  kind: text("kind", { enum: ["fund", "release", "transfer", "archive", "restore", "close", "reclassify", "reverse"] }).notNull(),
  goalId: integer("goal_id").notNull(),
  destinationGoalId: integer("destination_goal_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  reason: varchar("reason", { length: 300 }),
  economicDate: date("economic_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  originalOperationId: uuid("original_operation_id"),
  legacyContributionId: integer("legacy_contribution_id"),
  requestHash: text("request_hash").notNull(),
  result: jsonb("result").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.operationId] }),
  foreignKey({ name: "goal_operations_owner_goal_fk", columns: [table.userId, table.goalId], foreignColumns: [savingsGoals.userId, savingsGoals.id] }),
  foreignKey({ name: "goal_operations_owner_destination_fk", columns: [table.userId, table.destinationGoalId], foreignColumns: [savingsGoals.userId, savingsGoals.id] }),
  foreignKey({ name: "goal_operations_owner_original_fk", columns: [table.userId, table.originalOperationId], foreignColumns: [table.userId, table.operationId] }),
  foreignKey({ name: "goal_operations_owner_legacy_fk", columns: [table.userId, table.goalId, table.legacyContributionId], foreignColumns: [savingsContributions.userId, savingsContributions.goalId, savingsContributions.id] }),
  uniqueIndex("goal_operations_reversal_unique").on(table.userId, table.originalOperationId).where(sql`${table.kind} = 'reverse'`),
  index("goal_operations_owner_date_idx").on(table.userId, table.economicDate),
  index("goal_operations_owner_goal_idx").on(table.userId, table.goalId, table.createdAt),
  index("goal_operations_owner_destination_idx").on(table.userId, table.destinationGoalId, table.createdAt),
  index("goal_operations_owner_legacy_idx").on(table.userId, table.legacyContributionId).where(sql`${table.kind} = 'reclassify'`),
  check("goal_operations_kind_valid", sql`${table.kind} IN ('fund','release','transfer','archive','restore','close','reclassify','reverse')`),
  check("goal_operations_amount_valid", sql`
    CASE WHEN ${table.kind} IN ('fund','release','transfer','reclassify')
      THEN ${table.amount} IS NOT NULL AND ${table.amount} > 0
      WHEN ${table.kind} = 'reverse' THEN ${table.amount} IS NULL OR ${table.amount} > 0
      ELSE ${table.amount} IS NULL END`),
  check("goal_operations_destination_valid", sql`
    CASE WHEN ${table.kind} = 'transfer' THEN ${table.destinationGoalId} IS NOT NULL AND ${table.destinationGoalId} <> ${table.goalId}
      WHEN ${table.kind} = 'reverse' THEN ${table.destinationGoalId} IS NULL OR ${table.destinationGoalId} <> ${table.goalId}
      ELSE ${table.destinationGoalId} IS NULL END`),
  check("goal_operations_original_valid", sql`(${table.kind} = 'reverse') = (${table.originalOperationId} IS NOT NULL) AND ${table.originalOperationId} IS DISTINCT FROM ${table.operationId}`),
  check("goal_operations_legacy_valid", sql`(${table.kind} = 'reclassify') = (${table.legacyContributionId} IS NOT NULL)`),
]);

export const monthlyBudgets = pgTable("monthly_budgets", {
  id: serial("id").primaryKey(),

  userId: integer("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
    }),

  year: integer("year").notNull(),

  month: integer("month").notNull(),

  amount: numeric("amount", {
    precision: 14,
    scale: 2,
  }).notNull(),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const authRateLimitEvents =
  pgTable(
    "auth_rate_limit_events",
    {
      id: serial("id")
        .primaryKey(),

      /*
       * Nunca guardamos IP ni correo
       * directamente.
       *
       * Guardamos un HMAC SHA-256.
       */
      keyHash: varchar(
        "key_hash",
        {
          length: 64,
        },
      ).notNull(),

      action: varchar(
        "action",
        {
          length: 20,
        },
      ).notNull(),

      createdAt: timestamp(
        "created_at",
        {
          withTimezone: true,
        },
      )
        .defaultNow()
        .notNull(),
    },

    (table) => [
      index(
        "auth_rate_limit_lookup_idx",
      ).on(
        table.keyHash,
        table.action,
        table.createdAt,
      ),
    ],
  );
