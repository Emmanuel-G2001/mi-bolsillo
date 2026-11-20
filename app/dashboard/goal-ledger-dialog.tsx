import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from "react";

import { formatCopCents, formatMoneyCents, toMoneyCents } from "@/features/finance/finance.money";

import styles from "./goal-ledger-dialog.module.css";

type GoalAction = "fund" | "release" | "transfer" | "archive" | "restore" | "close" | "reverse";

type Props = {
  initialGoalId?: string;
  initialAction?: GoalAction;
  operationKeys: RefObject<Map<string, string>>;
  onClose: () => void;
  onMutation: () => void;
};

type LedgerGoal = {
  id: string | number;
  name: string;
  current: string;
  target: string;
  initial: string | null;
  reserved: string;
  unverified: string;
  status: "active" | "archived" | "closed";
};

type HistoryEntry = {
  operationId: string;
  kind: string;
  goalId: string | number;
  destinationGoalId: string | number | null;
  amount: string | null;
  reason: string | null;
  economicDate: string;
  reversed: boolean;
};

type LedgerResponse = { goals: LedgerGoal[] };
type GoalHistoryResponse = {
  goal: LedgerGoal;
  history: HistoryEntry[];
  legacy: { id: number; amount: string; economicDate: string }[];
  nextCursor: string | null;
  legacyNextCursor: number | null;
};
const reversibleKinds = new Set(["fund", "release", "transfer"]);
type Operation = {
  kind: GoalAction;
  goalId: number;
  amount?: string;
  reason?: string;
  destinationGoalId?: number;
  originalOperationId?: string;
};

const endpoint = "/api/finance/goals";
const zero = BigInt(0);
const operationIdPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const labels: Record<string, string> = {
  fund: "Abonar",
  release: "Liberar fondos",
  transfer: "Transferir",
  archive: "Archivar",
  restore: "Restaurar",
  close: "Cerrar meta",
  reverse: "Revertir",
  reclassify: "Reclasificación",
};

const actionDescriptions: Record<GoalAction, string> = {
  fund: "El aporte aumenta el progreso y reduce tu saldo disponible.",
  release: "Los fondos liberados vuelven al disponible sin registrarse como ingreso.",
  transfer: "La reserva cambia de meta y tu saldo disponible se mantiene.",
  archive: "Esta meta saldrá de la lista activa y conservará su progreso y fondos.",
  restore: "Esta meta volverá a la lista activa con su progreso e historial.",
  close: "La meta se cerrará y su historial quedará disponible para consulta.",
  reverse: "Se registrará un asiento que compensa la operación elegida.",
};

function money(input: string | bigint) {
  return formatCopCents(typeof input === "bigint" ? input : toMoneyCents(input));
}

function operationDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function failure(status: number) {
  if (status === 401) return "Tu sesión venció. Inicia sesión para continuar.";
  if (status === 404) return "La meta o la operación solicitada no está disponible.";
  if (status === 409) return "La operación no es compatible con el estado actual de la meta. Revisa sus fondos y vuelve a intentarlo.";
  return "No pudimos completar la solicitud. Vuelve a intentarlo.";
}

async function pendingStorageKey(goalId: number, fingerprint: string) {
  const bytes = new TextEncoder().encode(fingerprint);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const encoded = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `mi-bolsillo:goal-operation:v1:${goalId}:${encoded}`;
}

export default function GoalLedgerDialog({ initialGoalId, initialAction, operationKeys, onClose, onMutation }: Props) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const requestBusy = useRef(false);
  const [goalId, setGoalId] = useState(initialGoalId ?? "");
  const [action, setAction] = useState<GoalAction | null>(initialAction ?? null);
  const [original, setOriginal] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<Operation | null>(null);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [history, setHistory] = useState<GoalHistoryResponse | null>(null);
  const [before, setBefore] = useState<string>();
  const [legacyBefore, setLegacyBefore] = useState<number>();
  const phaseHeading = useRef<HTMLHeadingElement>(null);
  const titleHeading = useRef<HTMLHeadingElement>(null);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const current = dialog.current;
    const previous = document.activeElement;
    if (!current) return;
    current.showModal();
    return () => {
      current.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(failure(response.status));
      const content: LedgerResponse = await response.json();
      if (controller.signal.aborted) return;
      setData(content);
      setCatalogState("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setCatalogState("error");
    });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!goalId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ goalId });
    if (before) params.set("before", before);
    if (legacyBefore !== undefined) params.set("legacyBefore", String(legacyBefore));
    void fetch(`${endpoint}?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(failure(response.status));
      const content: GoalHistoryResponse = await response.json();
      if (controller.signal.aborted) return;
      setHistory(content);
      setHistoryState("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setHistoryState("error");
    });
    return () => controller.abort();
  }, [goalId, reload, before, legacyBefore]);

  const phase = confirmation ? "confirmation" : action;
  useEffect(() => {
    if (catalogState === "ready") {
      (phase ? phaseHeading : titleHeading).current?.focus({ preventScroll: true });
    }
  }, [phase, catalogState]);

  const goals = data?.goals ?? [];
  const goal = goals.find((item) => String(item.id) === goalId);
  const reserved = goal ? toMoneyCents(goal.reserved) : zero;
  const remaining = goal ? toMoneyCents(goal.target) - toMoneyCents(goal.current) : zero;
  const destinations = goals.filter((item) => String(item.id) !== goalId && item.status === "active"
    && toMoneyCents(item.current) < toMoneyCents(item.target));
  const destination = destinations.find((item) => String(item.id) === destinationId);
  const freeAtDestination = destination ? toMoneyCents(destination.target) - toMoneyCents(destination.current) : zero;
  const amountNeeded = action === "fund" || action === "release" || action === "transfer";
  const reasonNeeded = action === "release" || action === "transfer" || action === "reverse";
  const maximum = action === "fund" ? remaining : action === "transfer" && freeAtDestination < reserved ? freeAtDestination : reserved;
  const displayedGoals = initialGoalId ? goals : goals.filter((item) => item.status !== "active");
  const originalEntry = history?.history.find((entry) => entry.operationId === original);

  function chooseAction(next: GoalAction | null, originalOperationId = "") {
    setAction(next);
    setOriginal(originalOperationId);
    setDestinationId("");
    setAmount("");
    setReason("");
    setConfirmation(null);
    setError("");
    setSuccess("");
  }

  function refresh() {
    setCatalogState("loading");
    setHistoryState("loading");
    setBefore(undefined);
    setLegacyBefore(undefined);
    setReload((current) => current + 1);
  }

  function plan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !goal || requestBusy.current) return;
    setError("");
    const operation: Operation = { kind: action, goalId: Number(goal.id) };
    if (action === "transfer") {
      if (!destination) {
        setError("Selecciona una meta de destino.");
        return;
      }
      operation.destinationGoalId = Number(destination.id);
    }
    if (amountNeeded) {
      const decimal = amount.trim().replace(",", ".");
      const cents = /^\d{1,12}(\.\d{1,2})?$/.test(decimal) ? toMoneyCents(decimal) : zero;
      if (cents <= zero || cents > maximum) {
        setError(`Escribe un importe en COP con hasta dos decimales, entre 0,01 y ${money(maximum)}.`);
        return;
      }
      operation.amount = formatMoneyCents(cents);
    }
    if (reasonNeeded && !reason.trim()) {
      setError("Escribe el motivo de la operación.");
      return;
    }
    if (reason.trim()) operation.reason = reason.trim();
    if (action === "reverse") operation.originalOperationId = original;
    setConfirmation(operation);
  }

  async function execute() {
    if (!confirmation || requestBusy.current) return;
    requestBusy.current = true;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify(confirmation);
    try {
      let storageKey: string | undefined;
      let storedOperationId: string | null = null;
      try {
        storageKey = await pendingStorageKey(confirmation.goalId, fingerprint);
        storedOperationId = sessionStorage.getItem(storageKey);
      } catch {
        // Storage may be disabled; keep the key in the mounted dashboard.
      }
      const operationId = operationKeys.current.get(fingerprint)
        ?? (storedOperationId && operationIdPattern.test(storedOperationId) ? storedOperationId : crypto.randomUUID());
      operationKeys.current.set(fingerprint, operationId);
      if (storageKey) {
        try {
          sessionStorage.setItem(storageKey, operationId);
        } catch {
          // The mounted dashboard still retains the key.
        }
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...confirmation, operationId }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error : failure(response.status);
        setError(message);
        return;
      }
      operationKeys.current.delete(fingerprint);
      if (storageKey) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          // The acknowledged operation already completed.
        }
      }
      chooseAction(null);
      if (!initialGoalId && confirmation.kind === "restore") {
        setGoalId("");
        setHistory(null);
      }
      setSuccess("Operación registrada.");
      refresh();
      onMutation();
    } catch {
      setError("No se pudo confirmar el resultado. Reintenta para comprobar la misma operación.");
    } finally {
      requestBusy.current = false;
      setBusy(false);
    }
  }

  function dismiss() {
    if (!requestBusy.current) onClose();
  }

  return (
    <dialog
      ref={dialog}
      className={`finance-modal ${styles.dialog}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId} ref={titleHeading} tabIndex={-1}>{goal?.name ?? (initialGoalId ? "Gestionar meta" : "Metas archivadas y cerradas")}</h2>
          {goal?.status === "closed" && <p>Meta cerrada</p>}
          {goal?.status === "archived" && <p>Meta archivada</p>}
        </div>
        <button type="button" aria-label="Cerrar diálogo" disabled={busy} onClick={dismiss}>×</button>
      </div>

      {catalogState === "loading" && <p role="status" className={styles.status}>Cargando metas…</p>}
      {catalogState === "error" && (
        <div role="alert" className={styles.status}>
          No pudimos cargar tus metas. <button type="button" className="text-button" onClick={refresh}>Reintentar</button>
        </div>
      )}

      {!initialGoalId && catalogState === "ready" && (displayedGoals.length ? (
        <div className="form-grid">
          <label>
            <span>Meta</span>
            <select value={goalId} disabled={busy} onChange={(event) => {
              setGoalId(event.currentTarget.value);
              setHistory(null);
              setBefore(undefined);
              setLegacyBefore(undefined);
              setHistoryState("loading");
              chooseAction(null);
            }}>
              <option value="">Selecciona una meta</option>
              {displayedGoals.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === "closed" ? " · Cerrada" : ""}</option>)}
            </select>
          </label>
        </div>
      ) : <p className={styles.status}>Todavía no tienes metas archivadas ni cerradas.</p>)}

      {catalogState === "ready" && initialGoalId && !goal && <p role="alert">La meta no está disponible.</p>}
      {goal && catalogState === "ready" && (
        <>
          <dl className={styles.status}>
            <div><dt>Progreso</dt><dd>{money(goal.current)} de {money(goal.target)}</dd></div>
            <div><dt>Ahorro inicial</dt><dd>{goal.initial === null ? "Sin importe confirmado" : money(goal.initial)}</dd></div>
            <div><dt>Reserva que puedes usar</dt><dd>{money(reserved)}</dd></div>
            {toMoneyCents(goal.unverified) !== zero && <div><dt>Historial por verificar</dt><dd>{money(goal.unverified)}</dd></div>}
          </dl>

          {!action && goal.status !== "closed" && (
            <div className={styles.actions}>
              {goal.status === "archived" ? (
                <button type="button" className="text-button" onClick={() => chooseAction("restore")}>Restaurar</button>
              ) : (
                <>
                  <button type="button" className="text-button" disabled={remaining <= zero} onClick={() => chooseAction("fund")}>Abonar</button>
                  <button type="button" className="text-button" disabled={reserved <= zero} onClick={() => chooseAction("release")}>Liberar fondos</button>
                  <button type="button" className="text-button" disabled={reserved <= zero || !destinations.length} onClick={() => chooseAction("transfer")}>Transferir</button>
                  <button type="button" className="text-button" onClick={() => chooseAction("archive")}>Archivar</button>
                  <button type="button" className="text-button" disabled={reserved !== zero || toMoneyCents(goal.unverified) !== zero} onClick={() => chooseAction("close")}>Cerrar meta</button>
                </>
              )}
            </div>
          )}

          {action && !confirmation && (
            <form className="form-grid" onSubmit={plan}>
              <h3 ref={phaseHeading} tabIndex={-1}>{labels[action]}</h3>
              <p>{actionDescriptions[action]}</p>
              {action === "transfer" && (
                <label>
                  <span>Meta de destino</span>
                  <select required value={destinationId} onChange={(event) => setDestinationId(event.currentTarget.value)}>
                    <option value="">Selecciona una meta activa</option>
                    {destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              )}
              {amountNeeded && (
                <div>
                  <label>
                    <span>
                      Importe en COP · {action === "transfer" && !destination
                        ? "selecciona el destino para ver el máximo"
                        : `máximo ${money(maximum)}`}
                    </span>
                    <input name="amount" type="text" inputMode="decimal" value={amount} required onChange={(event) => setAmount(event.currentTarget.value)} />
                  </label>
                  {action !== "fund" && maximum > zero && (
                    <button type="button" className="text-button" onClick={() => setAmount(formatMoneyCents(maximum))}>
                      Usar el máximo
                    </button>
                  )}
                </div>
              )}
              {action === "reverse" && originalEntry && (
                <p>
                  {labels[originalEntry.kind]} · {operationDate(originalEntry.economicDate)}
                  {originalEntry.amount !== null && ` · ${money(originalEntry.amount)}`}
                </p>
              )}
              {reasonNeeded && (
                <label>
                  <span>Motivo</span>
                  <input name="reason" maxLength={240} value={reason} required onChange={(event) => setReason(event.currentTarget.value)} />
                </label>
              )}
              <button type="submit" className="modal-primary">Revisar operación</button>
              <button type="button" className="text-button" onClick={() => chooseAction(null)}>Cancelar</button>
            </form>
          )}

          {confirmation && (
            <div className="form-grid">
              <h3 ref={phaseHeading} tabIndex={-1}>Confirmar · {labels[confirmation.kind]}</h3>
              <p>{actionDescriptions[confirmation.kind]}</p>
              {confirmation.amount && <p><strong>{money(confirmation.amount)}</strong></p>}
              {confirmation.destinationGoalId && <p>Destino · {destination?.name}</p>}
              {confirmation.reason && <p>Motivo · {confirmation.reason}</p>}
              <button type="button" className="modal-primary" disabled={busy} onClick={() => void execute()}>
                {busy ? "Guardando…" : "Confirmar operación"}
              </button>
              <button type="button" className="text-button" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Volver</button>
            </div>
          )}

          <h3 className={styles.status}>Historial de operaciones</h3>
          {historyState === "loading" && <p role="status" className={styles.status}>Cargando historial…</p>}
          {historyState === "error" && (
            <div role="alert" className={styles.status}>
              No pudimos cargar el historial. <button type="button" className="text-button" disabled={busy} onClick={refresh}>Reintentar</button>
            </div>
          )}
          {historyState === "ready" && history?.goal.id === goal.id && (history.history.length ? (
            <ul className={styles.history}>
              {history.history.map((entry) => (
                <li key={entry.operationId}>
                  <p><strong>{labels[entry.kind] ?? "Operación"}</strong> · {operationDate(entry.economicDate)}{entry.amount !== null ? ` · ${money(entry.amount)}` : ""}</p>
                  {entry.destinationGoalId !== null && (
                    <p>{goals.find((item) => item.id === entry.goalId)?.name ?? "Origen"} → {goals.find((item) => item.id === entry.destinationGoalId)?.name ?? "Destino"}</p>
                  )}
                  {entry.reason && <p>{entry.reason}</p>}
                  {!action && reversibleKinds.has(entry.kind) && !entry.reversed && entry.goalId === goal.id && goal.status === "active" && (
                    <button type="button" className="text-button" onClick={() => chooseAction("reverse", entry.operationId)}>Revertir operación</button>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className={styles.status}>Todavía no hay operaciones en el diario de esta meta.</p>)}
          {historyState === "ready" && history?.goal.id === goal.id && (
            <>
              {history.nextCursor && (
                <button type="button" className="text-button" disabled={busy} onClick={() => {
                  setHistoryState("loading");
                  setBefore(history.nextCursor ?? undefined);
                }}>Ver operaciones anteriores</button>
              )}
              {before && (
                <button type="button" className="text-button" disabled={busy} onClick={() => {
                  setHistoryState("loading");
                  setBefore(undefined);
                }}>Volver a las más recientes</button>
              )}
              {history.legacy.length > 0 && (
                <>
                  <h3 className={styles.status}>Aportes del sistema anterior</h3>
                  <ul className={styles.history}>
                    {history.legacy.map((entry) => <li key={entry.id}>{operationDate(entry.economicDate)} · {money(entry.amount)}</li>)}
                  </ul>
                </>
              )}
              {history.legacyNextCursor != null && (
                <button type="button" className="text-button" disabled={busy} onClick={() => {
                  setHistoryState("loading");
                  setLegacyBefore(history.legacyNextCursor ?? undefined);
                }}>Ver aportes anteriores</button>
              )}
              {legacyBefore !== undefined && (
                <button type="button" className="text-button" disabled={busy} onClick={() => {
                  setHistoryState("loading");
                  setLegacyBefore(undefined);
                }}>Volver a los aportes más recientes</button>
              )}
            </>
          )}
        </>
      )}
      {success && <p role="status" className={styles.status}>{success}</p>}
      {error && <p role="alert" className={styles.status}>{error}</p>}
    </dialog>
  );
}
