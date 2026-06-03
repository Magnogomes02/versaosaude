import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "./admin-init.mjs";

initAdmin();

const firestore = getFirestore();

await firestore.doc("preferences/system").set({
  bookingHorizonDays: 90,
  indefiniteContractMonths: 12,
  alertDaysBeforeHorizonEnds: 20,
  overdueGraceDaysAfterRevert: 3,
  lateFeeEnabled: true,
  lateFeeFixedAmount: 0,
  lateFeePercent: 2,
  interestEnabled: true,
  interestMonthlyPercent: 1,
  interestDailyPercent: 0.033,
  graceDays: 3,
  defaultPaymentMethods: ["PIX", "Dinheiro", "Cartao", "Transferencia", "Boleto"],
  notificationDaysBeforeDue: [7],
  notificationDaysAfterDue: [5, 15],
  notifications: {
    email: { enabled: false },
    whatsapp: { enabled: false },
    telegram: { enabled: false },
  },
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

console.log("Preferencias financeiras e operacionais configuradas em preferences/system.");
