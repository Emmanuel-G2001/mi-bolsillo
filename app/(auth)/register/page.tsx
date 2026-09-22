"use client";

import Link from "next/link";
import {
  useActionState,
} from "react";
import {
  useFormStatus,
} from "react-dom";
import {
  LockKeyhole,
  Mail,
  UserRound,
  WalletCards,
} from "lucide-react";

import {
  registerAction,
  type RegisterState,
} from "./actions";

const initialState:
  RegisterState = {};

function RegisterButton() {
  const { pending } =
    useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="
        mt-2
        h-12
        w-full
        rounded-2xl
        bg-[#5b4df5]
        px-4
        font-bold
        text-white
        shadow-lg
        shadow-indigo-200
        transition
        hover:bg-[#5042e7]
        disabled:cursor-not-allowed
        disabled:opacity-60
      "
    >
      {pending
        ? "Creando cuenta..."
        : "Crear cuenta"}
    </button>
  );
}

function FieldError({
  messages,
}: {
  messages?: string[];
}) {
  if (
    !messages?.length
  ) {
    return null;
  }

  return (
    <span className="text-xs font-medium text-red-600">
      {messages[0]}
    </span>
  );
}

export default function RegisterPage() {
  const [
    state,
    formAction,
  ] = useActionState(
    registerAction,
    initialState,
  );

  return (
    <main className="min-h-screen bg-[#f4f6fb] px-5 py-8">
      <div
        className="
          mx-auto
          grid
          min-h-[calc(100vh-4rem)]
          max-w-5xl
          overflow-hidden
          rounded-[30px]
          border
          border-slate-200
          bg-white
          shadow-2xl
          shadow-slate-200/70
          md:grid-cols-[1.05fr_1fr]
        "
      >
        <section
          className="
            hidden
            bg-gradient-to-br
            from-[#6758ff]
            to-[#4f40dc]
            p-12
            text-white
            md:flex
            md:flex-col
            md:justify-between
          "
        >
          <div className="flex items-center gap-3 font-extrabold">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15">
              <WalletCards
                size={23}
              />
            </span>

            Mi Bolsillo
          </div>

          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-white/70">
              Empieza desde
              hoy
            </p>

            <h1 className="max-w-md text-4xl font-extrabold leading-tight tracking-tight">
              Dale un lugar
              claro a cada
              peso.
            </h1>

            <p className="mt-5 max-w-md text-base leading-7 text-white/75">
              Registra tus
              movimientos,
              presupuestos y
              metas de ahorro.
            </p>
          </div>

          <p className="text-sm text-white/60">
            Tus datos son
            privados para tu
            cuenta.
          </p>
        </section>

        <section className="flex items-center justify-center p-7 sm:p-10 md:p-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 md:hidden">
              <div className="flex items-center gap-3 text-lg font-extrabold text-slate-900">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#5b4df5] text-white">
                  <WalletCards
                    size={21}
                  />
                </span>

                Mi Bolsillo
              </div>
            </div>

            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#7569ef]">
              Nueva cuenta
            </p>

            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
              Crea tu cuenta
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Tus movimientos
              quedarán
              asociados
              únicamente a tu
              usuario.
            </p>

            <form
              action={
                formAction
              }
              className="mt-7 grid gap-4"
            >
              {/* Honeypot */}
              <input
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
              />

              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">
                  Nombre
                </span>

                <div className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-[#7569ff] focus-within:ring-4 focus-within:ring-indigo-50">
                  <UserRound
                    size={18}
                    className="text-slate-400"
                  />

                  <input
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    maxLength={
                      80
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="Tu nombre"
                  />
                </div>

                <FieldError
                  messages={
                    state
                      .fieldErrors
                      ?.name
                  }
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">
                  Correo
                </span>

                <div className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-[#7569ff] focus-within:ring-4 focus-within:ring-indigo-50">
                  <Mail
                    size={18}
                    className="text-slate-400"
                  />

                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={
                      254
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="tu@correo.com"
                  />
                </div>

                <FieldError
                  messages={
                    state
                      .fieldErrors
                      ?.email
                  }
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">
                  Contraseña
                </span>

                <div className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-[#7569ff] focus-within:ring-4 focus-within:ring-indigo-50">
                  <LockKeyhole
                    size={18}
                    className="text-slate-400"
                  />

                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={
                      10
                    }
                    maxLength={
                      72
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="Mínimo 10 caracteres"
                  />
                </div>

                <FieldError
                  messages={
                    state
                      .fieldErrors
                      ?.password
                  }
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">
                  Confirmar
                  contraseña
                </span>

                <div className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-[#7569ff] focus-within:ring-4 focus-within:ring-indigo-50">
                  <LockKeyhole
                    size={18}
                    className="text-slate-400"
                  />

                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    maxLength={
                      72
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="Repite tu contraseña"
                  />
                </div>

                <FieldError
                  messages={
                    state
                      .fieldErrors
                      ?.confirmPassword
                  }
                />
              </label>

              {state.error ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600"
                >
                  {
                    state.error
                  }
                </div>
              ) : null}

              <p className="text-xs leading-5 text-slate-500">
                Usa mínimo 10
                caracteres con
                mayúscula,
                minúscula y
                número.
              </p>

              <RegisterButton />
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              ¿Ya tienes una
              cuenta?{" "}
              <Link
                href="/login"
                className="font-bold text-[#5b4df5] hover:underline"
              >
                Iniciar sesión
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}