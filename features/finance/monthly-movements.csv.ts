import { formatMoneyCents, toMoneyCents } from "./finance.money";

export const MAX_MONTHLY_EXPORT_ROWS = 10_000;

type MovementCsvRow = {
  date: string;
  type: "income" | "expense";
  category: string | null;
  description: string;
  amount: string;
};

const formulaPrefix = /^[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]*[=+\-@＝＋－＠\t\r\n]/u;

function csvText(value: string) {
  const safeText = formulaPrefix.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safeText)
    ? `"${safeText.replaceAll('"', '""')}"`
    : safeText;
}

export function renderMonthlyMovementsCsv(rows: readonly MovementCsvRow[]) {
  if (rows.length > MAX_MONTHLY_EXPORT_ROWS) return null;

  const records = ["\uFEFFFecha;Tipo;Categoría;Descripción;Importe"];
  for (const row of rows) {
    records.push([
      row.date,
      row.type,
      csvText(row.category ?? ""),
      csvText(row.description),
      formatMoneyCents(toMoneyCents(row.amount)).replace(".", ","),
    ].join(";"));
  }

  return `${records.join("\r\n")}\r\n`;
}
