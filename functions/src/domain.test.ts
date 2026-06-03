import { describe, expect, it } from "vitest";
import {
  createReceiptAuthenticationCode,
  generateMonthlyReceivables,
  resolveReceivableStatus,
  shouldUpdateFutureReceivable,
} from "./domain.js";

describe("financial domain", () => {
  it("generates receivables for an open-ended contract through the horizon", () => {
    const rows = generateMonthlyReceivables({
      startDate: "2026-01-15",
      monthlyValue: 1200,
      dueDay: 31,
      horizonMonths: 2,
      today: "2026-01-20",
    });
    expect(rows).toEqual([
      { referenceMonth: "2026-01-01", dueDate: "2026-01-28", amountDue: 1200 },
      { referenceMonth: "2026-02-01", dueDate: "2026-02-28", amountDue: 1200 },
      { referenceMonth: "2026-03-01", dueDate: "2026-03-28", amountDue: 1200 },
    ]);
  });

  it("keeps partial payments open until the amount due is fully paid", () => {
    expect(resolveReceivableStatus({
      amountDue: 1000,
      amountPaid: 500,
      dueDate: "2026-06-20",
      today: "2026-06-10",
    })).toBe("partial");
    expect(resolveReceivableStatus({
      amountDue: 1000,
      amountPaid: 1000,
      dueDate: "2026-06-20",
      today: "2026-06-10",
    })).toBe("paid");
  });

  it("respects grace days after a reverted payment before marking overdue", () => {
    expect(resolveReceivableStatus({
      amountDue: 1000,
      amountPaid: 0,
      dueDate: "2026-05-10",
      today: "2026-06-03",
      lastRevertedAt: "2026-06-02",
      graceDaysAfterRevert: 3,
    })).toBe("open");
  });

  it("only updates unpaid future receivables during a value adjustment", () => {
    expect(shouldUpdateFutureReceivable({
      referenceMonth: "2026-05-01",
      effectiveMonth: "2026-05-01",
      status: "open",
      amountPaid: 0,
    })).toBe(true);
    expect(shouldUpdateFutureReceivable({
      referenceMonth: "2026-05-01",
      effectiveMonth: "2026-05-01",
      status: "paid",
      amountPaid: 1200,
    })).toBe(false);
  });

  it("signs receipt authentication codes with stable HMAC input", () => {
    const payload = {
      receiptId: "receipt-1",
      receiptNumber: "REC-20260603120000-ABC123",
      receivableId: "receivable-1",
      contractId: "contract-1",
      professionalId: "professional-1",
      referenceMonth: "2026-06-01",
      amountDue: 1200,
      amountPaid: 1200,
    };
    const code = createReceiptAuthenticationCode("secret-a", payload);
    expect(code).toMatch(/^REC-AUTH-V1-[A-F0-9]{32}$/);
    expect(createReceiptAuthenticationCode("secret-a", payload)).toBe(code);
    expect(createReceiptAuthenticationCode("secret-b", payload)).not.toBe(code);
    expect(createReceiptAuthenticationCode("secret-a", { ...payload, amountPaid: 1100 })).not.toBe(code);
  });
});
