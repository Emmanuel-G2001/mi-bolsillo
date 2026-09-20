"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export async function loginAction(
  previousState: string | undefined,
  formData: FormData,
) {
  try {
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    await signIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return "Correo o contraseña incorrectos.";
      }

      return "No pudimos iniciar sesión. Intenta nuevamente.";
    }

    throw error;
  }
}