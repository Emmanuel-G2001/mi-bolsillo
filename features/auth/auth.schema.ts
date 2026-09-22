import { z } from "zod";

export const loginCredentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Correo inválido.")
    .max(254),

  password: z
    .string()
    .min(1, "Escribe tu contraseña.")
    .max(72, "La contraseña es demasiado larga."),
});

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Escribe tu nombre.")
      .max(80, "El nombre es demasiado largo."),

    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Correo inválido.")
      .max(254),

    password: z
      .string()
      .min(10, "Usa al menos 10 caracteres.")
      .max(72, "La contraseña es demasiado larga.")
      .regex(
        /[a-z]/,
        "Incluye al menos una letra minúscula.",
      )
      .regex(
        /[A-Z]/,
        "Incluye al menos una letra mayúscula.",
      )
      .regex(
        /\d/,
        "Incluye al menos un número.",
      ),

    confirmPassword: z.string(),

    website: z
      .string()
      .max(0)
      .optional(),
  })
  .refine(
    (data) =>
      data.password ===
      data.confirmPassword,
    {
      message:
        "Las contraseñas no coinciden.",
      path: ["confirmPassword"],
    },
  );

export type RegisterInput = z.infer<
  typeof registerSchema
>;