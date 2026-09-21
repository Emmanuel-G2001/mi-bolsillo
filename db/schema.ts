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
} from "drizzle-orm/pg-core";

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
});

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
});

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