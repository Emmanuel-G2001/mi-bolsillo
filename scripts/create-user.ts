import "dotenv/config";

import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";

import { users } from "../db/schema";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CREATE_USER_NAME: z.string().min(1),
  CREATE_USER_EMAIL: z.string().email(),
  CREATE_USER_PASSWORD: z.string().min(8),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Debes proporcionar CREATE_USER_NAME, CREATE_USER_EMAIL y CREATE_USER_PASSWORD.",
  );

  throw new Error("Variables necesarias para crear el usuario no configuradas.");
}

const {
  DATABASE_URL,
  CREATE_USER_NAME,
  CREATE_USER_EMAIL,
  CREATE_USER_PASSWORD,
} = parsed.data;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const db = drizzle(pool);

async function main() {
  const email = CREATE_USER_EMAIL.toLowerCase();

  const passwordHash = await bcrypt.hash(
    CREATE_USER_PASSWORD,
    12,
  );

  await db
    .insert(users)
    .values({
      name: CREATE_USER_NAME,
      email,
      passwordHash,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: CREATE_USER_NAME,
        passwordHash,
        updatedAt: new Date(),
      },
    });

  console.log(`✅ Usuario ${email} creado/actualizado correctamente.`);
}

main()
  .catch((error) => {
    console.error("❌ Error creando usuario:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });