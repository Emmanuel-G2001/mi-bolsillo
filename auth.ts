import bcrypt from "bcryptjs";
import {
  eq,
} from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import {
  authConfig,
} from "@/auth.config";
import { db } from "@/db";
import {
  users,
} from "@/db/schema";
import {
  loginCredentialsSchema,
} from "@/features/auth/auth.schema";

export const {
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      credentials: {
        email: {
          label:
            "Correo",
          type:
            "email",
        },

        password: {
          label:
            "Contraseña",
          type:
            "password",
        },
      },

      async authorize(
        credentials,
      ) {
        /*
         * Validamos también
         * del lado servidor.
         */
        const parsed =
          loginCredentialsSchema
            .safeParse(
              credentials,
            );

        if (
          !parsed.success
        ) {
          return null;
        }

        const email =
          parsed.data.email
            .toLowerCase();

        const [user] =
          await db
            .select({
              id:
                users.id,

              name:
                users.name,

              email:
                users.email,

              passwordHash:
                users.passwordHash,
            })
            .from(users)
            .where(
              eq(
                users.email,
                email,
              ),
            )
            .limit(1);

        if (!user) {
          return null;
        }

        const passwordMatches =
          await bcrypt.compare(
            parsed.data
              .password,
            user.passwordHash,
          );

        if (
          !passwordMatches
        ) {
          return null;
        }

        return {
          id: String(
            user.id,
          ),

          name:
            user.name,

          email:
            user.email,
        };
      },
    }),
  ],
});