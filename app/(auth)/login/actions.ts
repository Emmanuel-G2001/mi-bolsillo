"use server";

import {
  AuthError,
} from "next-auth";

import {
  signIn,
} from "@/auth";

import {
  loginCredentialsSchema,
} from "@/features/auth/auth.schema";

import {
  getRateLimitKey,
  isRateLimited,
  recordRateLimitEvent,
} from "@/lib/security/rate-limit";

export async function loginAction(
  previousState:
    | string
    | undefined,
  formData: FormData,
) {
  void previousState;

  const parsed =
    loginCredentialsSchema
      .safeParse({
        email:
          formData.get(
            "email",
          ),

        password:
          formData.get(
            "password",
          ),
      });

  if (!parsed.success) {
    return "Ingresa un correo y una contraseña válidos.";
  }

  /*
   * La clave se genera usando
   * IP + correo normalizado.
   *
   * Ni IP ni email quedan
   * almacenados en la tabla.
   */
  const rateLimitKey =
    await getRateLimitKey(
      "login",
      parsed.data.email,
    );

  const limited =
    await isRateLimited(
      "login",
      rateLimitKey,
    );

  if (limited) {
    return "Demasiados intentos. Espera unos minutos antes de intentar nuevamente.";
  }

  try {
    await signIn(
      "credentials",
      {
        email:
          parsed.data.email,

        password:
          parsed.data
            .password,

        redirectTo:
          "/dashboard",
      },
    );
  } catch (error) {
    if (
      error instanceof
      AuthError
    ) {
      if (
        error.type ===
        "CredentialsSignin"
      ) {
        /*
         * Solo contamos como
         * intento cuando las
         * credenciales fallan.
         */
        await recordRateLimitEvent(
          "login",
          rateLimitKey,
        );

        /*
         * No revelamos si fue
         * email o contraseña.
         */
        return "Correo o contraseña incorrectos.";
      }

      return "No pudimos iniciar sesión. Intenta nuevamente.";
    }

    /*
     * El redirect exitoso de
     * Auth.js también utiliza
     * una excepción interna.
     */
    throw error;
  }
}