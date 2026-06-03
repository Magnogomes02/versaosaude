export type ReceivableStatus = "open" | "partial" | "paid" | "overdue" | "cancelled";

export interface MonthReceivable {
  referenceMonth: string;
  dueDate: string;
  amountDue: number;
}

export interface PaymentSummary {
  amountDue: number;
  amountPaid: number;
  dueDate: string;
  today: string;
  currentStatus?: ReceivableStatus;
  lastRevertedAt?: string | null;
  graceDaysAfterRevert?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDays(value: string, days: number) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

export function addMonths(value: string, months: number) {
  const date = parseDateOnly(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  return toDateOnly(date);
}

export function startOfMonth(value: string) {
  const date = parseDateOnly(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function clampDueDay(day: number) {
  return Math.min(28, Math.max(1, Math.trunc(day || 5)));
}

export function dueDateForMonth(referenceMonth: string, dueDay: number) {
  return `${referenceMonth.slice(0, 8)}${String(clampDueDay(dueDay)).padStart(2, "0")}`;
}

export function generateMonthlyReceivables(input: {
  startDate: string;
  endDate?: string | null;
  monthlyValue: number;
  dueDay: number;
  horizonMonths: number;
  today: string;
}): MonthReceivable[] {
  if (!input.monthlyValue || input.monthlyValue <= 0) return [];
  const firstMonth = startOfMonth(input.startDate);
  const lastMonth = input.endDate
    ? startOfMonth(input.endDate)
    : startOfMonth(addMonths(input.today, Math.max(1, input.horizonMonths)));
  const rows: MonthReceivable[] = [];
  for (let month = firstMonth; month <= lastMonth; month = startOfMonth(addMonths(month, 1))) {
    rows.push({
      referenceMonth: month,
      dueDate: dueDateForMonth(month, input.dueDay),
      amountDue: Number(input.monthlyValue),
    });
  }
  return rows;
}

export function resolveReceivableStatus(input: PaymentSummary): ReceivableStatus {
  if (input.currentStatus === "cancelled") return "cancelled";
  if (input.amountPaid >= input.amountDue && input.amountDue > 0) return "paid";
  if (input.lastRevertedAt && input.graceDaysAfterRevert) {
    const daysSinceRevert = (parseDateOnly(input.today).getTime() - parseDateOnly(input.lastRevertedAt).getTime()) / MS_PER_DAY;
    if (daysSinceRevert < input.graceDaysAfterRevert) {
      return input.amountPaid > 0 ? "partial" : "open";
    }
  }
  if (input.dueDate < input.today) return "overdue";
  if (input.amountPaid > 0) return "partial";
  return "open";
}

export function shouldUpdateFutureReceivable(input: {
  referenceMonth: string;
  effectiveMonth: string;
  status: ReceivableStatus;
  amountPaid: number;
}) {
  return input.referenceMonth >= startOfMonth(input.effectiveMonth)
    && input.status !== "paid"
    && input.status !== "cancelled"
    && Number(input.amountPaid || 0) <= 0;
}
