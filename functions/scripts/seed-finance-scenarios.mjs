import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "./admin-init.mjs";

initAdmin();
const db = getFirestore();

const collectionsToReset = [
  "rooms",
  "professionals",
  "contracts",
  "contract_schedules",
  "bookings",
  "booking_conflicts",
  "receivables",
  "receivable_payments",
  "receivable_receipts",
  "contract_adjustments",
  "notification_queue",
];

async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  const batches = [];
  let batch = db.batch();
  let count = 0;
  snap.docs.forEach((doc) => {
    batch.delete(doc.ref);
    count += 1;
    if (count % 450 === 0) {
      batches.push(batch.commit());
      batch = db.batch();
    }
  });
  batches.push(batch.commit());
  await Promise.all(batches);
  return snap.size;
}

function ts(date, time = "09:00") {
  return Timestamp.fromDate(new Date(`${date}T${time}:00-03:00`));
}

console.log("Este script apaga dados de teste das colecoes operacionais. Nao apaga Auth, owner, profiles nem user_roles.");
for (const collectionName of collectionsToReset) {
  const deleted = await deleteCollection(collectionName);
  console.log(`${collectionName}: ${deleted} documentos removidos`);
}

await db.doc("preferences/system").set({
  bookingHorizonDays: 90,
  indefiniteContractMonths: 12,
  overdueGraceDaysAfterRevert: 3,
  lateFeeEnabled: true,
  lateFeePercent: 2,
  interestEnabled: true,
  interestDailyPercent: 0.033,
  graceDays: 3,
  notificationDaysBeforeDue: [7],
  notificationDaysAfterDue: [5, 15],
  defaultPaymentMethods: ["PIX", "Dinheiro", "Cartao", "Transferencia", "Boleto"],
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

const batch = db.batch();
const professionals = [
  ["prof-ana", "Dra. Ana Teste"],
  ["prof-bruno", "Dr. Bruno Teste"],
  ["prof-carla", "Dra. Carla Multi-Sala"],
];
professionals.forEach(([id, name]) => batch.set(db.doc(`professionals/${id}`), {
  name,
  fullName: name,
  email: `${id}@teste.local`,
  active: true,
  serviceType: "clinic",
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
}));

["Sala 01", "Sala 02", "Sala 03", "Sala Multiuso"].forEach((name, index) => batch.set(db.doc(`rooms/room-${index + 1}`), {
  name,
  active: true,
  serviceType: "clinic",
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
}));

const contracts = [
  ["contract-active", "prof-ana", "Dra. Ana Teste", 1000, "active"],
  ["contract-partial", "prof-bruno", "Dr. Bruno Teste", 1000, "active"],
  ["contract-multisala", "prof-carla", "Dra. Carla Multi-Sala", 1800, "active"],
  ["contract-cancelled", "prof-ana", "Dra. Ana Teste", 900, "cancelled"],
];
contracts.forEach(([id, professionalId, professionalName, monthlyValue, status]) => batch.set(db.doc(`contracts/${id}`), {
  professionalId,
  professionalName,
  startDate: "2026-01-01",
  endDate: null,
  monthlyValue,
  dueDay: 5,
  status,
  serviceType: "clinic",
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
}));

batch.set(db.doc("contract_schedules/sched-active-1"), { contractId: "contract-active", weekday: 1, roomId: "room-1", startTime: "08:00", endTime: "10:00", createdAt: FieldValue.serverTimestamp() });
batch.set(db.doc("contract_schedules/sched-multi-1"), { contractId: "contract-multisala", weekday: 2, roomId: "room-1", startTime: "08:00", endTime: "10:00", createdAt: FieldValue.serverTimestamp() });
batch.set(db.doc("contract_schedules/sched-multi-2"), { contractId: "contract-multisala", weekday: 4, roomId: "room-2", startTime: "08:00", endTime: "10:00", createdAt: FieldValue.serverTimestamp() });

const receivables = [
  ["rec-open", "contract-active", "prof-ana", "Dra. Ana Teste", "2026-06-01", "2026-06-30", 1000, 0, "open", "Sala 01", "contract"],
  ["rec-partial", "contract-partial", "prof-bruno", "Dr. Bruno Teste", "2026-06-01", "2026-06-05", 1000, 500, "partial", "Sala 02", "contract"],
  ["rec-paid", "contract-active", "prof-ana", "Dra. Ana Teste", "2026-05-01", "2026-05-05", 1000, 1000, "paid", "Sala 01", "contract"],
  ["rec-overdue", "contract-active", "prof-ana", "Dra. Ana Teste", "2026-04-01", "2026-04-05", 1000, 0, "overdue", "Sala 01", "contract"],
  ["rec-loss", "contract-cancelled", "prof-ana", "Dra. Ana Teste", "2026-07-01", "2026-07-05", 900, 0, "cancelled", "Sala 01", "contract"],
  ["rec-penalty", "contract-cancelled", "prof-ana", "Dra. Ana Teste", "2026-07-01", "2026-07-05", 250, 0, "open", "Multa contratual", "penalty"],
  ["rec-multisala", "contract-multisala", "prof-carla", "Dra. Carla Multi-Sala", "2026-06-01", "2026-06-05", 1800, 0, "open", "Sala 01, Sala 02", "contract"],
];
receivables.forEach(([id, contractId, professionalId, professionalName, referenceMonth, dueDate, amountDue, amountPaid, status, roomName, kind]) => batch.set(db.doc(`receivables/${id}`), {
  kind,
  contractId,
  bookingId: null,
  professionalId,
  professionalName,
  roomId: null,
  roomName,
  referenceMonth,
  dueDate,
  amountDue,
  amountPaid,
  status,
  serviceType: "clinic",
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
}));

batch.set(db.doc("receivable_payments/payment-partial-1"), {
  receivableId: "rec-partial",
  contractId: "contract-partial",
  professionalId: "prof-bruno",
  amount: 500,
  baseAmount: 500,
  totalPaid: 500,
  paidAt: "2026-06-03T10:00:00.000Z",
  paymentMethod: "PIX",
  status: "active",
  receiptId: null,
  createdAt: FieldValue.serverTimestamp(),
});

batch.set(db.doc("bookings/booking-future-1"), { contractId: "contract-active", professionalId: "prof-ana", roomId: "room-1", startAt: ts("2026-06-10"), endAt: ts("2026-06-10", "10:00"), status: "active", source: "contract", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
batch.set(db.doc("bookings/booking-paid-single"), { contractId: null, professionalId: "prof-bruno", roomId: "room-3", startAt: ts("2026-06-15"), endAt: ts("2026-06-15", "10:00"), status: "active", source: "single", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

batch.set(db.doc("notification_queue/notif-7-days"), { receivableId: "rec-open", status: "pending", stage: "7_days_before", channel: "email", createdAt: FieldValue.serverTimestamp() });
batch.set(db.doc("notification_queue/notif-overdue-15"), { receivableId: "rec-overdue", status: "pending", stage: "15_days_after", channel: "email", createdAt: FieldValue.serverTimestamp() });

await batch.commit();
console.log("Cenarios financeiros de teste criados.");
