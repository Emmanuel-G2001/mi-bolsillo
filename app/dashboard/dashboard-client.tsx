"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Home,
  LogOut,
  Pencil,
  PiggyBank,
  Plus,
  ShoppingBag,
  Target,
  Trash2,
  TrendingUp,
  Utensils,
  WalletCards,
  Zap,
} from "lucide-react";

import {
  formatCopCents,
  formatMoneyCents,
  parseFinanceDashboardJson,
  toMoneyCents,
} from "@/features/finance/finance.money";

import FinancialAnalytics from "./financial-analytics";
import MonthlyInsights from "./monthly-insights";

type Transaction = {
  id: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  date: string;
};

type Goal = {
  id: string;
  name: string;
  current: number;
  target: number;
};

type FinanceResponse = {
  userName: string;
  month: string;

  previousBalance: string;
  savings: string;

  transactions: Transaction[];
  goals: Goal[];
  budget: number;
};

const emptyTransactions: Transaction[] = [];

const categoryColors: Record<string, string> = {
  Vivienda: "#6d5dfc",
  Alimentación: "#f59e0b",
  Servicios: "#06b6d4",
  Comida: "#f97316",
  Transporte: "#10b981",
  Compras: "#ec4899",
  Otros: "#94a3b8",
};

const expenseCategories = [
  "Vivienda",
  "Alimentación",
  "Servicios",
  "Comida",
  "Transporte",
  "Compras",
  "Otros",
];

function money(value: number | bigint) {
  return formatCopCents(typeof value === "bigint" ? value : toMoneyCents(value));
}

function wholePercent(part: bigint, total: bigint) {
  return total === BigInt(0)
    ? "0"
    : String((part * BigInt(100) + total / BigInt(2)) / total);
}

function chartPercent(part: bigint, total: bigint) {
  if (total <= BigInt(0)) return "0";
  return formatMoneyCents((part < total ? part : total) * BigInt(10000) / total);
}

function getBogotaMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find(
    (part) => part.type === "year",
  )?.value;

  const month = parts.find(
    (part) => part.type === "month",
  )?.value;

  return `${year}-${month}`;
}

function getBogotaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
  }).format(new Date());
}

function changeMonth(
  value: string,
  direction: number,
) {
  const [year, month] = value
    .split("-")
    .map(Number);

  const date = new Date(
    year,
    month - 1 + direction,
    1,
  );

  return `${date.getFullYear()}-${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}`;
}

function formatMonth(value: string) {
  const [year, month] = value
    .split("-")
    .map(Number);

  return new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
  }).format(
    new Date(year, month - 1, 1),
  );
}

function categoryIcon(category: string) {
  const props = {
    size: 18,
    strokeWidth: 2,
  };

  if (category === "Vivienda") {
    return <Home {...props} />;
  }

  if (category === "Alimentación") {
    return <ShoppingBag {...props} />;
  }

  if (category === "Servicios") {
    return <Zap {...props} />;
  }

  if (category === "Comida") {
    return <Utensils {...props} />;
  }

  return <CircleDollarSign {...props} />;
}

export default function DashboardClient({
  logoutAction,
}: {
  logoutAction: () => Promise<void>;
}) {
  const requestId = useRef(0);
  const isCurrentRequest = useCallback((id: number) => id === requestId.current, []);
  const analyticsMutationId = useRef(0);
  const [analyticsMutation, setAnalyticsMutation] = useState(0);
  const isCurrentAnalyticsMutation = useCallback(
    (id: number) => id === analyticsMutationId.current,
    [],
  );
  const [financeRequest, setFinanceRequest] = useState(() => ({
    id: 0,
    month: getBogotaMonth(),
  }));
  const [finance, setFinance] = useState<FinanceResponse | null>(null);
  const [financeStatus, setFinanceStatus] = useState<{
    id: number;
    error: string | null;
  } | null>(null);

  const { month: selectedMonth } = financeRequest;
  const loading = financeStatus?.id !== financeRequest.id;
  const financeError = loading ? null : financeStatus?.error;
  const monthlyFinance = finance?.month === selectedMonth ? finance : null;
  const transactions = monthlyFinance?.transactions ?? emptyTransactions;
  const budget = monthlyFinance?.budget ?? 0;
  const budgetCents = toMoneyCents(budget);
  const savingsCents = toMoneyCents(monthlyFinance?.savings ?? "0");
  const previousBalanceCents = toMoneyCents(
    monthlyFinance?.previousBalance ?? "0",
  );
  const goals = finance?.goals ?? [];
  const userName = finance?.userName;

  const [
    transactionOpen,
    setTransactionOpen,
  ] = useState(false);

  const [goalOpen, setGoalOpen] =
    useState(false);

  const [
    budgetOpen,
    setBudgetOpen,
  ] = useState(false);
  const budgetSubmissionId = useRef(0);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const [
    contributionGoal,
    setContributionGoal,
  ] = useState<Goal | null>(null);

  const remainingGoalCents = contributionGoal
    ? toMoneyCents(contributionGoal.target) - toMoneyCents(contributionGoal.current)
    : BigInt(0);

  const [
    editingTransaction,
    setEditingTransaction,
  ] = useState<Transaction | null>(
    null,
  );

  const [formType, setFormType] =
    useState<"income" | "expense">(
      "expense",
    );

  const [
    editTransactionType,
    setEditTransactionType,
  ] = useState<
    "income" | "expense"
  >("expense");

  function requestFinance(direction = 0) {
    if (direction) {
      ++budgetSubmissionId.current;
      setBudgetError(null);
    }

    // Invalidate the old GET immediately, before the next effect runs.
    const id = ++requestId.current;
    setFinanceRequest((current) => ({
      id,
      month: direction ? changeMonth(current.month, direction) : current.month,
    }));
  }

  function refreshAfterMutation() {
    setAnalyticsMutation(++analyticsMutationId.current);
    requestFinance();
  }

  useEffect(() => {
    const { id, month } = financeRequest;
    const controller = new AbortController();
    const isCurrent = () =>
      isCurrentRequest(id) && !controller.signal.aborted;

    async function loadFinance() {
      try {
        const response = await fetch(
          `/api/finance?month=${encodeURIComponent(month)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!isCurrent()) {
          return;
        }

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error("No fue posible cargar tus datos.");
        }

        const data = parseFinanceDashboardJson(
          await response.text(),
        ) as FinanceResponse;
        if (isCurrent()) {
          setFinance(data);
          setFinanceStatus({ id, error: null });
        }
      } catch {
        if (isCurrent()) {
          setFinanceStatus({
            id,
            error: "No fue posible cargar tus datos.",
          });
        }
      }
    }

    if (isCurrent()) {
      void loadFinance();
    }
    return () => controller.abort();
  }, [financeRequest, isCurrentRequest]);

  /*
   * RESUMEN DEL MES
   *
   * Saldo disponible:
   *
   * saldo anterior
   * + ingresos del mes
   * - gastos del mes
   * - ahorro del mes
   */
  const summary = useMemo(() => {
    const zero = BigInt(0);
    let income = zero;
    let expense = zero;
    const categories = new Map<string, bigint>();

    for (const item of transactions) {
      const amount = toMoneyCents(item.amount);

      if (item.type === "income") {
        income += amount;
      } else {
        expense += amount;
        categories.set(item.category, (categories.get(item.category) ?? zero) + amount);
      }
    }

    const balance = previousBalanceCents + income - expense - savingsCents;

    return {
      income,
      expense,
      savings: savingsCents,
      balance,
      remainingBudget: budgetCents > expense ? budgetCents - expense : BigInt(0),
      categories: Array.from(categories).sort(([, a], [, b]) => {
        if (a === b) return 0;
        return a > b ? -1 : 1;
      }),
    };
  }, [
    budgetCents,
    transactions,
    previousBalanceCents,
    savingsCents,
  ]);

  const donutBackground =
    useMemo(() => {
      if (
        !summary.expense ||
        !summary.categories.length
      ) {
        return "#eef0f4";
      }

      let accumulated = BigInt(0);

      const sections =
        summary.categories.map(
          ([category, value]) => {
            const start = chartPercent(accumulated, summary.expense);

            accumulated += value;

            const end = chartPercent(accumulated, summary.expense);

            return `${
              categoryColors[
                category
              ] ||
              categoryColors.Otros
            } ${start}% ${end}%`;
          },
        );

      return `conic-gradient(${sections.join(
        ",",
      )})`;
    }, [summary]);

  /*
   * CREAR MOVIMIENTO
   */
  async function addTransaction(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const data =
      new FormData(form);

    const amount = Number(
      data.get("amount"),
    );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return;
    }

    const response = await fetch(
      "/api/finance",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",
        },

        body: JSON.stringify({
          kind: "transaction",

          description: String(
            data.get(
              "description",
            ) || "Movimiento",
          ),

          amount,

          type: formType,

          category:
            formType === "income"
              ? "Ingresos"
              : String(
                  data.get(
                    "category",
                  ) || "Otros",
                ),

          date: String(
            data.get("date"),
          ),
        }),
      },
    );

    if (!response.ok) {
      return;
    }

    if (form.isConnected) {
      form.reset();
      setTransactionOpen(false);
    }

    refreshAfterMutation();
  }

  /*
   * EDITAR MOVIMIENTO
   */
  function openEditTransaction(
    transaction: Transaction,
  ) {
    setEditingTransaction(
      transaction,
    );

    setEditTransactionType(
      transaction.type,
    );
  }

  async function updateTransaction(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!editingTransaction) {
      return;
    }

    const form =
      event.currentTarget;

    const data =
      new FormData(form);

    const amount = Number(
      data.get("amount"),
    );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return;
    }

    const response = await fetch(
      "/api/finance",
      {
        method: "PATCH",

        headers: {
          "content-type":
            "application/json",
        },

        body: JSON.stringify({
          kind: "transaction",

          id:
            editingTransaction.id,

          description: String(
            data.get(
              "description",
            ) || "",
          ),

          amount,

          type:
            editTransactionType,

          category:
            editTransactionType ===
            "income"
              ? "Ingresos"
              : String(
                  data.get(
                    "category",
                  ) || "Otros",
                ),

          date: String(
            data.get("date"),
          ),
        }),
      },
    );

    if (!response.ok) {
      return;
    }

    if (form.isConnected) {
      setEditingTransaction(null);
    }

    /*
     * Recargamos porque editar un
     * movimiento histórico puede cambiar
     * también el saldo acumulado.
     */
    refreshAfterMutation();
  }

  /*
   * CREAR META
   */
  async function addGoal(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const data =
      new FormData(form);

    const target = Number(
      data.get("target"),
    );

    const current = Number(
      data.get("current") || 0,
    );

    if (
      !Number.isFinite(target) ||
      target <= 0
    ) {
      return;
    }

    const response = await fetch(
      "/api/finance",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",
        },

        body: JSON.stringify({
          kind: "goal",

          name: String(
            data.get("name") ||
              "Nueva meta",
          ),

          current,

          target,
        }),
      },
    );

    if (!response.ok) {
      return;
    }

    if (form.isConnected) {
      form.reset();
      setGoalOpen(false);
    }

    refreshAfterMutation();
  }

  /*
   * PRESUPUESTO
   */
  function closeBudget() {
    ++budgetSubmissionId.current;
    setBudgetOpen(false);
  }

  async function updateBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = Number(data.get("amount"));

    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const submissionId = ++budgetSubmissionId.current;
    const isCurrent = () =>
      form.isConnected && submissionId === budgetSubmissionId.current;
    const fallbackError = "No fue posible guardar el presupuesto.";
    setBudgetError(null);

    try {
      const response = await fetch("/api/finance", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, month: selectedMonth }),
      });

      if (!response.ok) {
        const result = response.status === 400 ? await response.json() : null;
        if (isCurrent()) {
          setBudgetError(typeof result?.error === "string" ? result.error : fallbackError);
        }
        return;
      }

      if (isCurrent()) {
        closeBudget();
      }

      refreshAfterMutation();
    } catch {
      if (isCurrent()) {
        setBudgetError(fallbackError);
      }
    }
  }

  /*
   * ABONAR A META
   */
  async function contributeToGoal(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!contributionGoal) {
      return;
    }

    const form =
      event.currentTarget;

    const data =
      new FormData(form);

    const amount = Number(
      data.get("amount"),
    );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return;
    }

    const response = await fetch(
      "/api/finance",
      {
        method: "PATCH",

        headers: {
          "content-type":
            "application/json",
        },

        body: JSON.stringify({
          kind: "goal",
          id: contributionGoal.id,
          amount,
        }),
      },
    );

    if (!response.ok) {
      return;
    }

    if (form.isConnected) {
      setContributionGoal(null);
    }

    /*
     * Recargamos todo el resumen porque
     * un abono modifica tanto la meta
     * como el ahorro y el saldo disponible.
     */
    refreshAfterMutation();
  }

  /*
   * ELIMINAR
   */
  async function removeItem(
    kind:
      | "transaction"
      | "goal",
    id: string,
  ) {
    const response = await fetch(
      `/api/finance?kind=${kind}&id=${encodeURIComponent(
        id,
      )}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      return;
    }

    /*
     * Recargar es importante porque borrar
     * un movimiento antiguo puede alterar
     * el saldo acumulado.
     */
    refreshAfterMutation();
  }

  const currentMonth =
    getBogotaMonth();

  const transactionDefaultDate =
    selectedMonth === currentMonth
      ? getBogotaToday()
      : `${selectedMonth}-01`;

  return (
    <main className="finance-page">
      {/* HEADER */}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <WalletCards
              size={21}
            />
          </span>

          <span>
            Mi Bolsillo
          </span>
        </div>

        <div className="month-picker">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() =>
              requestFinance(-1)
            }
          >
            <ChevronLeft
              size={17}
            />
          </button>

          <span>
            {formatMonth(
              selectedMonth,
            )}
          </span>

          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() =>
              requestFinance(1)
            }
          >
            <ChevronRight
              size={17}
            />
          </button>
        </div>

        <form action={logoutAction}>
          <button
            className="logout-button"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut
              size={18}
            />
          </button>
        </form>
      </header>

      <div className="dashboard-shell">
        {/* BIENVENIDA */}

        <section className="welcome-row">
          <div>
            <p className="eyebrow">
              TU RESUMEN DEL MES
            </p>

            <h1>
              Hola,{" "}
              {userName ||
                "Emmanuel"}{" "}
              <span>👋</span>
            </h1>

            <p className="subtle">
              Tus finanzas van por
              buen camino.
            </p>

            <div className="mt-4 flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm lg:hidden">
              <button
                type="button"
                aria-label="Mes anterior"
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
                onClick={() =>
                  requestFinance(-1)
                }
              >
                <ChevronLeft
                  size={17}
                />
              </button>

              <span className="min-w-[140px] text-center text-sm font-semibold capitalize text-slate-700">
                {formatMonth(
                  selectedMonth,
                )}
              </span>

              <button
                type="button"
                aria-label="Mes siguiente"
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
                onClick={() =>
                  requestFinance(1)
                }
              >
                <ChevronRight
                  size={17}
                />
              </button>
            </div>
          </div>

          <button
            className="primary-action"
            type="button"
            onClick={() =>
              setTransactionOpen(
                true,
              )
            }
          >
            <Plus
              size={18}
            />

            <span>
              Nuevo movimiento
            </span>
          </button>
        </section>

        <MonthlyInsights
          request={financeRequest}
          isCurrentRequest={isCurrentRequest}
          onRetry={requestFinance}
        />

        {financeError ? (
          <div className="panel">
            <p role="alert">
              {monthlyFinance
                ? financeError
                : "Los datos de este mes no están disponibles."}
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => requestFinance()}
            >
              Reintentar
            </button>
          </div>
        ) : !monthlyFinance && (
          <p className="subtle" role="status">Cargando los datos del mes…</p>
        )}

        <div hidden={!monthlyFinance}>
        {/* RESUMEN */}

        <section className="summary-grid">
          <article className="balance-card">
            <div className="card-top">
              <span>
                Saldo disponible
              </span>

              <span className="icon-pill white">
                <WalletCards
                  size={19}
                />
              </span>
            </div>

            <strong>
              {loading
                ? "..."
                : money(
                    summary.balance,
                  )}
            </strong>

            <p>
              <TrendingUp
                size={15}
              />

              {previousBalanceCents !== BigInt(0)
                ? `Saldo anterior: ${money(
                    previousBalanceCents,
                  )}`
                : "Ingresos menos gastos y ahorro acumulados"}
            </p>
          </article>

          <article className="metric-card">
            <div className="card-top">
              <span>
                Ingresos
              </span>

              <span className="icon-pill mint">
                <ArrowDownLeft
                  size={19}
                />
              </span>
            </div>

            <strong>
              {loading
                ? "..."
                : money(
                    summary.income,
                  )}
            </strong>

            <p className="positive">
              Recibido este mes
            </p>
          </article>

          <article className="metric-card">
            <div className="card-top">
              <span>
                Gastos
              </span>

              <span className="icon-pill coral">
                <ArrowUpRight
                  size={19}
                />
              </span>
            </div>

            <strong>
              {loading
                ? "..."
                : money(
                    summary.expense,
                  )}
            </strong>

            <p>
              {wholePercent(summary.expense, summary.income)}
              % de tus ingresos
            </p>
          </article>

          <article className="metric-card">
            <div className="card-top">
              <span>
                Ahorrado
              </span>

              <span className="icon-pill mint">
                <PiggyBank
                  size={19}
                />
              </span>
            </div>

            <strong>
              {loading
                ? "..."
                : money(
                    summary.savings,
                  )}
            </strong>

            <p className="positive">
              {summary.income
                ? `${wholePercent(summary.savings, summary.income)}% de tus ingresos`
                : "Ahorrado este mes"}
            </p>
          </article>

          <article className="metric-card">
            <div className="card-top">
              <span>
                Presupuesto
              </span>

              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setBudgetError(null);
                  setBudgetOpen(true);
                }}
              >
                Editar
              </button>
            </div>

            <strong>
              {money(summary.remainingBudget)}
            </strong>

            <div className="progress-track budget-progress">
              <div
                style={{
                  width: `${chartPercent(summary.expense, budgetCents)}%`,
                }}
              />
            </div>

            <p>
              {budget
                ? `${money(
                    budget,
                  )} planeados`
                : "Configura tu presupuesto"}
            </p>
          </article>
        </section>

        {/* GRÁFICA Y METAS */}

        <section className="content-grid">
          <article className="panel spending-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">
                  DISTRIBUCIÓN
                </p>

                <h2>
                  ¿En qué se fue tu
                  dinero?
                </h2>
              </div>

              <span className="total-label">
                {money(
                  summary.expense,
                )}
              </span>
            </div>

            {summary.categories
              .length ? (
              <div className="spending-content">
                <div
                  className="donut"
                  style={{
                    background:
                      donutBackground,
                  }}
                >
                  <div>
                    <span>
                      Gastado
                    </span>

                    <strong>
                      {formatCopCents(summary.expense, "short")}
                    </strong>
                  </div>
                </div>

                <div className="category-list">
                  {summary.categories.map(
                    ([
                      category,
                      value,
                    ]) => (
                      <div
                        className="category-row"
                        key={
                          category
                        }
                      >
                        <span
                          className="category-dot"
                          style={{
                            background:
                              categoryColors[
                                category
                              ] ||
                              categoryColors.Otros,
                          }}
                        />

                        <span>
                          {category}
                        </span>

                        <strong>
                          {money(
                            value,
                          )}
                        </strong>

                        <small>
                          {wholePercent(value, summary.expense)}
                          %
                        </small>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                Aún no tienes gastos
                registrados.
              </div>
            )}
          </article>

          <article
            className="panel goal-panel"
            id="metas"
          >
            <div className="panel-head">
              <div>
                <p className="eyebrow">
                  AHORRO
                </p>

                <h2>
                  Tus metas
                </h2>
              </div>

              <button
                className="round-button"
                type="button"
                aria-label="Crear meta"
                onClick={() =>
                  setGoalOpen(
                    true,
                  )
                }
              >
                <Plus
                  size={18}
                />
              </button>
            </div>

            <div className="goals-list">
              {goals.map(
                (goal) => {
                  const percent =
                    Math.min(
                      Math.round(
                        (goal.current /
                          goal.target) *
                          100,
                      ),
                      100,
                    );

                  return (
                    <div
                      className="goal-item"
                      key={
                        goal.id
                      }
                    >
                      <div className="goal-icon">
                        <PiggyBank
                          size={23}
                        />
                      </div>

                      <div className="goal-copy">
                        <div>
                          <strong>
                            {goal.name}
                          </strong>

                          <span>
                            {percent}%
                          </span>
                        </div>

                        <div className="progress-track goal-progress">
                          <div
                            style={{
                              width: `${percent}%`,
                            }}
                          />
                        </div>

                        <div className="goal-bottom">
                          <p>
                            {money(
                              goal.current,
                            )}{" "}
                            <span>
                              de{" "}
                              {money(
                                goal.target,
                              )}
                            </span>
                          </p>

                          {goal.current < goal.target ? (
                            <button
                              type="button"
                              className="goal-contribute"
                              onClick={() =>
                                setContributionGoal(
                                  goal,
                                )
                              }
                            >
                              + Abonar
                            </button>
                          ) : (
                            <span className="goal-completed">
                              ✓
                              Completada
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="delete-goal"
                        aria-label={`Eliminar ${goal.name}`}
                        onClick={() =>
                          removeItem(
                            "goal",
                            goal.id,
                          )
                        }
                      >
                        <Trash2
                          size={15}
                        />
                      </button>
                    </div>
                  );
                },
              )}
            </div>

            {!goals.length && (
              <div className="empty-goals">
                Todavía no tienes
                metas de ahorro.
              </div>
            )}

            <div className="saving-tip">
              <Target
                size={19}
              />

              <p>
                <strong>
                  Pequeños pasos
                  cuentan
                </strong>

                <br />

                Separa una parte de
                cada ingreso para
                acercarte a tus
                metas.
              </p>
            </div>
          </article>
        </section>

        {/* MOVIMIENTOS */}

        <section className="panel transactions-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">
                ACTIVIDAD
              </p>

              <h2>
                Movimientos
                recientes
              </h2>
            </div>
          </div>

          <div className="transaction-list">
            {transactions
              .slice(0, 7)
              .map((item) => {
                const transactionColor =
                  categoryColors[
                    item.category
                  ] ||
                  (item.type ===
                  "income"
                    ? "#10b981"
                    : "#64748b");

                return (
                  <div
                    className="transaction"
                    key={item.id}
                  >
                    <span
                      className="transaction-icon"
                      style={{
                        color:
                          transactionColor,

                        background: `${transactionColor}16`,
                      }}
                    >
                      {item.type ===
                      "income" ? (
                        <ArrowDownLeft
                          size={18}
                        />
                      ) : (
                        categoryIcon(
                          item.category,
                        )
                      )}
                    </span>

                    <div className="transaction-copy">
                      <strong>
                        {
                          item.description
                        }
                      </strong>

                      <span>
                        {
                          item.category
                        }{" "}
                        ·{" "}
                        {new Date(
                          `${item.date}T12:00:00`,
                        ).toLocaleDateString(
                          "es-CO",
                          {
                            day: "numeric",
                            month:
                              "short",
                          },
                        )}
                      </span>
                    </div>

                    <strong
                      className={
                        item.type ===
                        "income"
                          ? "amount income"
                          : "amount"
                      }
                    >
                      {item.type ===
                      "income"
                        ? "+"
                        : "−"}

                      {money(
                        item.amount,
                      )}
                    </strong>

                    <div className="transaction-actions">
                      <button
                        type="button"
                        className="edit-transaction"
                        aria-label={`Editar ${item.description}`}
                        onClick={() =>
                          openEditTransaction(
                            item,
                          )
                        }
                      >
                        <Pencil
                          size={15}
                        />
                      </button>

                      <button
                        type="button"
                        className="delete-transaction"
                        aria-label={`Eliminar ${item.description}`}
                        onClick={() =>
                          removeItem(
                            "transaction",
                            item.id,
                          )
                        }
                      >
                        <Trash2
                          size={16}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>

          {!loading &&
            !financeError &&
            !transactions.length && (
              <div className="empty-state">
                Tu lista está vacía.
                Registra tu primer
                movimiento.
              </div>
            )}
        </section>
        </div>

        <FinancialAnalytics
          initialMonth={selectedMonth}
          mutationId={analyticsMutation}
          isCurrentMutation={isCurrentAnalyticsMutation}
        />
      </div>

      {/* MOBILE NAV */}

      <nav
        className="mobile-nav"
        aria-label="Navegación principal"
      >
        <a
          className="active"
          href="#"
        >
          <Home
            size={20}
          />

          <span>
            Inicio
          </span>
        </a>

        <button
          type="button"
          aria-label="Nuevo movimiento"
          onClick={() =>
            setTransactionOpen(
              true,
            )
          }
        >
          <Plus
            size={23}
          />
        </button>

        <a href="#metas">
          <Target
            size={20}
          />

          <span>
            Metas
          </span>
        </a>
      </nav>

      {/* NUEVO MOVIMIENTO */}

      {transactionOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() =>
            setTransactionOpen(
              false,
            )
          }
        >
          <div
            className="finance-modal"
            onMouseDown={(
              event,
            ) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <h2>
                  Registrar
                  movimiento
                </h2>

                <p>
                  Añade un ingreso
                  o un gasto.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setTransactionOpen(
                    false,
                  )
                }
              >
                ×
              </button>
            </div>

            <form
              onSubmit={
                addTransaction
              }
              className="form-grid"
            >
              <div className="type-switch">
                <button
                  type="button"
                  className={
                    formType ===
                    "expense"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setFormType(
                      "expense",
                    )
                  }
                >
                  Gasto
                </button>

                <button
                  type="button"
                  className={
                    formType ===
                    "income"
                      ? "active income"
                      : ""
                  }
                  onClick={() =>
                    setFormType(
                      "income",
                    )
                  }
                >
                  Ingreso
                </button>
              </div>

              <label>
                <span>
                  Descripción
                </span>

                <input
                  name="description"
                  placeholder="Ej. Mercado"
                  required
                />
              </label>

              <label>
                <span>
                  Valor
                </span>

                <div className="money-input">
                  <span>
                    $
                  </span>

                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="150000"
                    required
                  />
                </div>
              </label>

              <label>
                <span>
                  Fecha
                </span>

                <input
                  name="date"
                  type="date"
                  defaultValue={
                    transactionDefaultDate
                  }
                  required
                />
              </label>

              {formType ===
                "expense" && (
                <label>
                  <span>
                    Categoría
                  </span>

                  <select
                    name="category"
                    defaultValue="Alimentación"
                  >
                    {expenseCategories.map(
                      (
                        category,
                      ) => (
                        <option
                          key={
                            category
                          }
                          value={
                            category
                          }
                        >
                          {
                            category
                          }
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}

              <button
                type="submit"
                className="modal-primary"
              >
                Guardar movimiento
              </button>
            </form>
          </div>
        </div>
      )}

      {/* EDITAR MOVIMIENTO */}

      {editingTransaction && (
        <div
          className="modal-backdrop"
          onMouseDown={() =>
            setEditingTransaction(
              null,
            )
          }
        >
          <div
            className="finance-modal"
            onMouseDown={(
              event,
            ) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <h2>
                  Editar movimiento
                </h2>

                <p>
                  Corrige los datos
                  del movimiento.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setEditingTransaction(
                    null,
                  )
                }
              >
                ×
              </button>
            </div>

            <form
              onSubmit={
                updateTransaction
              }
              className="form-grid"
            >
              <div className="type-switch">
                <button
                  type="button"
                  className={
                    editTransactionType ===
                    "expense"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setEditTransactionType(
                      "expense",
                    )
                  }
                >
                  Gasto
                </button>

                <button
                  type="button"
                  className={
                    editTransactionType ===
                    "income"
                      ? "active income"
                      : ""
                  }
                  onClick={() =>
                    setEditTransactionType(
                      "income",
                    )
                  }
                >
                  Ingreso
                </button>
              </div>

              <label>
                <span>
                  Descripción
                </span>

                <input
                  name="description"
                  defaultValue={
                    editingTransaction.description
                  }
                  required
                />
              </label>

              <label>
                <span>
                  Valor
                </span>

                <div className="money-input">
                  <span>
                    $
                  </span>

                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue={
                      editingTransaction.amount
                    }
                    required
                  />
                </div>
              </label>

              <label>
                <span>
                  Fecha
                </span>

                <input
                  name="date"
                  type="date"
                  defaultValue={
                    editingTransaction.date
                  }
                  required
                />
              </label>

              {editTransactionType ===
                "expense" && (
                <label>
                  <span>
                    Categoría
                  </span>

                  <select
                    name="category"
                    defaultValue={
                      editingTransaction.type ===
                      "expense"
                        ? editingTransaction.category
                        : "Otros"
                    }
                  >
                    {expenseCategories.map(
                      (
                        category,
                      ) => (
                        <option
                          key={
                            category
                          }
                          value={
                            category
                          }
                        >
                          {
                            category
                          }
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}

              <button
                type="submit"
                className="modal-primary"
              >
                Guardar cambios
              </button>
            </form>
          </div>
        </div>
      )}

      {/* NUEVA META */}

      {goalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() =>
            setGoalOpen(false)
          }
        >
          <div
            className="finance-modal"
            onMouseDown={(
              event,
            ) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <h2>
                  Nueva meta de
                  ahorro
                </h2>

                <p>
                  Define cuánto
                  dinero quieres
                  reunir.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setGoalOpen(
                    false,
                  )
                }
              >
                ×
              </button>
            </div>

            <form
              onSubmit={
                addGoal
              }
              className="form-grid"
            >
              <label>
                <span>
                  Nombre
                </span>

                <input
                  name="name"
                  placeholder="Ej. Viaje"
                  required
                />
              </label>

              <label>
                <span>
                  Valor objetivo
                </span>

                <div className="money-input">
                  <span>
                    $
                  </span>

                  <input
                    name="target"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="5000000"
                    required
                  />
                </div>
              </label>

              <label>
                <span>
                  Dinero que ya tienes ahorrado
                </span>

                <div className="money-input">
                  <span>
                    $
                  </span>

                  <input
                    name="current"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue="0"
                    aria-describedby="new-goal-initial-savings-help"
                  />
                </div>
              </label>

              <p id="new-goal-initial-savings-help" className="-mt-2 text-sm text-slate-600">
                Este dinero suma al progreso de la meta sin descontarse de tu saldo disponible.
                Los aportes que hagas después sí se descuentan.
              </p>

              <button
                type="submit"
                className="modal-primary"
              >
                Crear meta
              </button>
            </form>
          </div>
        </div>
      )}

      {/* PRESUPUESTO */}

      {budgetOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={closeBudget}
        >
          <div
            className="finance-modal"
            onMouseDown={(
              event,
            ) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <h2>
                  Presupuesto mensual
                </h2>

                <p>
                  Define cuánto
                  planeas gastar en{" "}
                  {formatMonth(
                    selectedMonth,
                  )}
                  .
                </p>
              </div>

              <button
                type="button"
                onClick={closeBudget}
              >
                ×
              </button>
            </div>

            <form
              key={selectedMonth}
              onSubmit={
                updateBudget
              }
              className="form-grid"
            >
              <label>
                <span>
                  Presupuesto
                </span>

                <div className="money-input">
                  <span>
                    $
                  </span>

                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue={
                      budget > 0
                        ? budget
                        : ""
                    }
                    placeholder="2000000"
                    autoFocus
                    required
                  />
                </div>
              </label>

              {budget > 0 && (
                <div className="modal-info">
                  <span>
                    Presupuesto
                    actual
                  </span>

                  <strong>
                    {money(
                      budget,
                    )}
                  </strong>
                </div>
              )}

              {budgetError && (
                <p className="text-sm text-red-700" role="alert">
                  {budgetError}
                </p>
              )}

              <button
                type="submit"
                className="modal-primary"
              >
                Guardar presupuesto
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ABONAR A META */}

      {contributionGoal && (
        <div
          className="modal-backdrop"
          onMouseDown={() =>
            setContributionGoal(
              null,
            )
          }
        >
          <div
            className="finance-modal"
            onMouseDown={(
              event,
            ) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <h2>
                  Abonar a tu meta
                </h2>

                <p>
                  Sigue avanzando
                  hacia{" "}
                  <strong>
                    {
                      contributionGoal.name
                    }
                  </strong>
                  .
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setContributionGoal(
                    null,
                  )
                }
              >
                ×
              </button>
            </div>

            <div className="contribution-summary">
              <div>
                <span>
                  Ahorrado
                </span>

                <strong>
                  {money(
                    contributionGoal.current,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Objetivo
                </span>

                <strong>
                  {money(
                    contributionGoal.target,
                  )}
                </strong>
              </div>
            </div>

            <div className="progress-track contribution-progress">
              <div
                style={{
                  width: `${Math.min(
                    (contributionGoal.current /
                      contributionGoal.target) *
                      100,
                    100,
                  )}%`,
                }}
              />
            </div>

            <p className="remaining-goal">
              Te faltan{" "}
              <strong>
                {money(remainingGoalCents)}
              </strong>
            </p>

            <form
              onSubmit={
                contributeToGoal
              }
              className="form-grid contribution-form"
            >
              <label>
                <span>
                  ¿Cuánto quieres
                  abonar?
                </span>

                <div className="money-input">
                  <span>
                    $
                  </span>

                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max={formatMoneyCents(remainingGoalCents)}
                    step="0.01"
                    placeholder="500000"
                    autoFocus
                    required
                  />
                </div>
              </label>

              <button
                type="submit"
                className="modal-primary"
              >
                Agregar al ahorro
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
