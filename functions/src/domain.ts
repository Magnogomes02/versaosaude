import { createHmac } from "node:crypto";

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

export interface ReceiptSignaturePayload {
  receiptId: string;
  receiptNumber: string;
  receivableId: string;
  contractId?: string | null;
  professionalId: string;
  referenceMonth: string;
  amountDue: number;
  amountPaid: number;
}

export interface LateChargeSettings {
  lateFeeEnabled?: boolean;
  lateFeeFixedAmount?: number;
  lateFeePercent?: number;
  interestEnabled?: boolean;
  interestDailyPercent?: number;
  graceDays?: number;
}

export interface LateChargeResult {
  daysLate: number;
  lateFeeAmount: number;
  interestAmount: number;
  suggestedTotal: number;
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
    && input.status !== "cancelled"
    && input.status !== "paid";
}

export function createReceiptAuthenticationCode(secret: string, payload: ReceiptSignaturePayload) {
  const canonical = [
    payload.receiptId,
    payload.receiptNumber,
    payload.receivableId,
    payload.contractId ?? "",
    payload.professionalId,
    payload.referenceMonth,
    payload.amountDue.toFixed(2),
    payload.amountPaid.toFixed(2),
  ].join("|");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex").slice(0, 32).toUpperCase();
  return `REC-AUTH-V1-${signature}`;
}

export function calculateLateCharges(input: {
  amountDue: number;
  dueDate: string;
  paidAt: string;
  settings: LateChargeSettings;
}): LateChargeResult {
  const due = parseDateOnly(input.dueDate);
  const paid = parseDateOnly(input.paidAt.slice(0, 10));
  const rawDaysLate = Math.floor((paid.getTime() - due.getTime()) / MS_PER_DAY);
  const daysLate = Math.max(0, rawDaysLate - Math.max(0, Math.trunc(input.settings.graceDays ?? 0)));
  if (daysLate <= 0) {
    return { daysLate: 0, lateFeeAmount: 0, interestAmount: 0, suggestedTotal: input.amountDue };
  }
  const percentFee = input.settings.lateFeeEnabled
    ? input.amountDue * Math.max(0, input.settings.lateFeePercent ?? 0) / 100
    : 0;
  const fixedFee = input.settings.lateFeeEnabled ? Math.max(0, input.settings.lateFeeFixedAmount ?? 0) : 0;
  const lateFeeAmount = Number(Math.max(fixedFee, percentFee).toFixed(2));
  const interestAmount = input.settings.interestEnabled
    ? Number((input.amountDue * Math.max(0, input.settings.interestDailyPercent ?? 0) / 100 * daysLate).toFixed(2))
    : 0;
  return {
    daysLate,
    lateFeeAmount,
    interestAmount,
    suggestedTotal: Number((input.amountDue + lateFeeAmount + interestAmount).toFixed(2)),
  };
}
