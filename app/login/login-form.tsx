"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  PiggyBank,
  TrendingUp,
  WalletCards,
} from "lucide-react";

export default function LoginForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (!result || result.error) {
        setError("Correo o contraseña incorrectos.");
        setLoading(false);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("No pudimos iniciar sesión. Intenta nuevamente.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb] lg:grid lg:grid-cols-2">
      {/* LADO IZQUIERDO */}
      <section className="relative hidden overflow-hidden bg-[#6842d9] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-white/10" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <WalletCards size={23} />
          </div>

          <div>
            <p className="text-xl font-bold">Mi Bolsillo</p>
            <p className="text-sm text-white/70">Finanzas personales</p>
          </div>
        </div>

        <div className="relative z-10 max-w-lg">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white/90">
            <PiggyBank size={17} />
            Controla mejor tu dinero
          </div>

          <h1 className="text-5xl font-bold leading-[1.1]">
            Tus finanzas,
            <br />
            más claras.
          </h1>

          <p className="mt-6 max-w-md text-lg leading-8 text-white/75">
            Lleva el control de tus ingresos, gastos, presupuestos y metas de
            ahorro desde un solo lugar.
          </p>

          <div className="mt-10 grid max-w-md grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur">
              <TrendingUp className="mb-4" size={24} />
              <p className="font-semibold">Control mensual</p>
              <p className="mt-1 text-sm text-white/65">
                Visualiza cómo se mueve tu dinero.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur">
              <PiggyBank className="mb-4" size={24} />
              <p className="font-semibold">Metas de ahorro</p>
              <p className="mt-1 text-sm text-white/65">
                Sigue el progreso de tus objetivos.
              </p>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-sm text-white/50">
          Mi Bolsillo · Tu información financiera en un solo lugar
        </p>
      </section>

      {/* LOGIN */}
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[430px]">
          {/* Logo móvil */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#6842d9] text-white">
              <WalletCards size={23} />
            </div>

            <div>
              <p className="text-xl font-bold text-[#22202a]">Mi Bolsillo</p>
              <p className="text-xs text-[#8d8998]">Finanzas personales</p>
            </div>
          </div>

          <div className="mb-8">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eee9ff] text-[#6842d9]">
              <LockKeyhole size={26} />
            </div>

            <h2 className="text-3xl font-bold tracking-tight text-[#22202a]">
              Bienvenido de nuevo
            </h2>

            <p className="mt-2 text-[15px] leading-6 text-[#817d8b]">
              Ingresa a tu cuenta para continuar administrando tus finanzas.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-semibold text-[#3d3946]"
              >
                Correo electrónico
              </label>

              <div className="relative">
                <Mail
                  size={19}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[#aaa5b3]"
                />

                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@correo.com"
                  className="h-14 w-full rounded-2xl border border-[#e5e2ea] bg-white pl-12 pr-4 text-[15px] text-[#28252e] outline-none transition placeholder:text-[#b6b2bd] focus:border-[#6842d9] focus:ring-4 focus:ring-[#6842d9]/10"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-semibold text-[#3d3946]"
              >
                Contraseña
              </label>

              <div className="relative">
                <LockKeyhole
                  size={19}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[#aaa5b3]"
                />

                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Tu contraseña"
                  className="h-14 w-full rounded-2xl border border-[#e5e2ea] bg-white pl-12 pr-12 text-[15px] text-[#28252e] outline-none transition placeholder:text-[#b6b2bd] focus:border-[#6842d9] focus:ring-4 focus:ring-[#6842d9]/10"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#aaa5b3] transition hover:text-[#6842d9]"
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#6842d9] font-semibold text-white shadow-lg shadow-[#6842d9]/20 transition hover:bg-[#5935c7] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                "Ingresando..."
              ) : (
                <>
                  Ingresar
                  <ArrowRight size={19} />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 border-t border-[#ebe8ef] pt-6 text-center">
            <p className="text-sm text-[#96919e]">
              Acceso privado · Mi Bolsillo
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}