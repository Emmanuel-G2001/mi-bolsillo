const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i;
const CENTS_PER_UNIT = BigInt(100);
const MAX_MONEY_CENTS = BigInt("99999999999999");
const MONEY_FIELDS = ["amount", "target", "current"] as const;
const DASHBOARD_MONEY_FIELDS = ["previousBalance", "savings"] as const;
const JSON_STRING_OR_NUMBER = /"(?:[^"\\]|\\.)*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function parseJsonPreservingMoneyFields(source: string, moneyFields: readonly string[]): unknown {
  // Validate with the native parser before matching tokens.
  const body: unknown = JSON.parse(source);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const fields = body as Record<string, unknown>;
  const numericMoneyFields = moneyFields.filter((field) => typeof fields[field] === "number");
  if (numericMoneyFields.length === 0) {
    return body;
  }

  // Match whole strings so digits inside keys or text stay untouched.
  const quoted = source.replace(JSON_STRING_OR_NUMBER, (token, numberToken?: string) =>
    numberToken === undefined ? token : `"${numberToken}"`,
  );
  const lexemes = JSON.parse(quoted) as Record<string, string>;
  for (const field of numericMoneyFields) {
    fields[field] = lexemes[field];
  }
  return body;
}

export function parseFinanceJson(source: string): unknown {
  return parseJsonPreservingMoneyFields(source, MONEY_FIELDS);
}

export function parseFinanceDashboardJson(source: string): unknown {
  return parseJsonPreservingMoneyFields(source, DASHBOARD_MONEY_FIELDS);
}

export function serializeFinanceDashboardJson<
  T extends { previousBalance: bigint; savings: bigint },
>(dashboard: T): string {
  const { previousBalance, savings, ...otherFields } = dashboard;
  const fieldsJson = JSON.stringify(otherFields).slice(1, -1);
  const moneyJson = `"previousBalance":${formatMoneyCents(previousBalance)},"savings":${formatMoneyCents(savings)}`;
  return fieldsJson ? `{${fieldsJson},${moneyJson}}` : `{${moneyJson}}`;
}

export function toMoneyCents(value: number | string): bigint {
  const match = DECIMAL_PATTERN.exec(String(value).trim());
  if (!match) {
    throw new RangeError("Importe decimal inválido.");
  }

  const [, sign, whole = "", trailingFraction, leadingFraction, exponent = "0"] = match;
  const fraction = trailingFraction ?? leadingFraction ?? "";
  const digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) {
    return BigInt(0);
  }

  const centsLength = digits.length - fraction.length + Number(exponent) + 2;
  if (centsLength < 0) {
    return BigInt(0);
  }

  // Keep only the digits through cents and use the next digit to round ties up.
  let cents = BigInt(digits.slice(0, centsLength).padEnd(centsLength, "0") || "0");
  if (digits[centsLength] >= "5") {
    cents += BigInt(1);
  }

  return sign === "-" ? -cents : cents;
}

export function formatMoneyCents(cents: bigint): string {
  const negative = cents < BigInt(0);
  const absolute = negative ? -cents : cents;
  const whole = absolute / CENTS_PER_UNIT;
  const fraction = String(absolute % CENTS_PER_UNIT).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

const copFormat = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
});
const shortCopFormat = new Intl.NumberFormat("es-CO", {
  minimumFractionDigits: 2,
});

export function formatCopCents(cents: bigint, style: "currency" | "short" = "currency"): string {
  const [whole, fraction] = formatMoneyCents(cents).split(".");
  const formatter = style === "short" ? shortCopFormat : copFormat;
  // Negative zero preserves the sign template for amounts between -1 and 0 COP.
  const parts = formatter.formatToParts(whole === "-0" ? -0 : BigInt(whole));
  const formatted = parts.map(({ type, value }) => {
    if (type === "fraction") return fraction === "00" ? "" : fraction;
    if (type === "decimal" && fraction === "00") return "";
    return value;
  }).join("");

  return `${style === "short" ? "$" : ""}${formatted}`;
}

export function moneyCentsToNumber(cents: bigint): number {
  return Number(formatMoneyCents(cents));
}

export function parseMoneyInput(
  value: unknown,
  amount: number,
  allowZero: boolean,
): bigint | null {
  const source = typeof value === "string" ? value.trim() : "";
  const decimal = DECIMAL_PATTERN.exec(source);
  const cents = toMoneyCents(decimal ? source : amount);
  const isExactZero = amount === 0 && (!decimal || !/[1-9]/.test(
    (decimal[2] ?? "") + (decimal[3] ?? decimal[4] ?? ""),
  ));

  if (cents > MAX_MONEY_CENTS || (cents <= BigInt(0) && !(allowZero && isExactZero))) {
    return null;
  }

  return cents;
}
