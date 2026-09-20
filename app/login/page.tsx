import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-4 text-4xl">💰</div>

          <h1 className="text-3xl font-bold tracking-tight text-zinc-950">
            Mi Bolsillo
          </h1>

          <p className="mt-2 text-zinc-500">
            Controla tus gastos, ingresos y ahorros.
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h2 className="mb-6 text-xl font-semibold">
            Iniciar sesión
          </h2>

          <LoginForm />
        </div>
      </div>
    </main>
  );
}