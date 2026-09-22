"use server";

import {
  AuthError,
} from "next-auth";

import {
  signIn,
} from "@/auth";

import {
  registerSchema,
} from "@/features/auth/auth.schema";

import {
  createUser,
} from "@/features/auth/auth.service";

import {
  getRateLimitKey,
  isRateLimited,
  recordRateLimitEvent,
} from "@/lib/security/rate-limit";

export type RegisterState = {
  error?: string;

  fieldErrors?: Partial<
    Record<
      | "name"
      | "email"
      | "password"
      | "confirmPassword",
      string[]
    >
  >;
};

export async function registerAction(
  previousState:
    RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  void previousState;

  const parsed =
    registerSchema.safeParse(
      {
        name:
          formData.get(
            "name",
          ),

        email:
          formData.get(
            "email",
          ),

        password:
          formData.get(
            "password",
          ),

        confirmPassword:
          formData.get(
            "confirmPassword",
          ),

        website:
          formData.get(
            "website",
          ) ?? "",
      },
    );

  if (!parsed.success) {
    const flattened =
      parsed.error.flatten();

    return {
      error:
        "Revisa los datos del formulario.",

      fieldErrors:
        flattened.fieldErrors,
    };
  }

  const rateLimitKey =
    await getRateLimitKey(
      "register",
    );

  const limited =
    await isRateLimited(
      "register",
      rateLimitKey,
    );

  if (limited) {
    return {
      error:
        "Se han realizado demasiados registros desde esta conexión. Intenta nuevamente más tarde.",
    };
  }

  /*
   * Registramos el intento antes
   * de consultar si existe el
   * correo para evitar abuso
   * de enumeración.
   */
  await recordRateLimitEvent(
    "register",
    rateLimitKey,
  );

  const result =
    await createUser({
      name:
        parsed.data.name,

      email:
        parsed.data.email,

      password:
        parsed.data
          .password,
    });

  if (!result.ok) {
    if (
      result.reason ===
      "email_in_use"
    ) {
      /*
       * No confirmamos directamente
       * que el correo existe.
       */
      return {
        error:
          "No pudimos crear una cuenta con esos datos. Si ya tienes una cuenta, intenta iniciar sesión.",
      };
    }

    return {
      error:
        "No pudimos crear tu cuenta. Intenta nuevamente.",
    };
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
      return {
        error:
          "Tu cuenta fue creada, pero no pudimos iniciar sesión automáticamente. Intenta ingresar desde el login.",
      };
    }

    throw error;
  }

  return {};
}