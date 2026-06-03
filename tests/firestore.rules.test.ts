import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-versaosaude-rules";
let testEnv: RulesTestEnvironment;

function firestoreAs(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "user_roles/owner-1"), { role: "owner" });
    await setDoc(doc(db, "user_roles/gestor-1"), { role: "gestor" });
    await setDoc(doc(db, "user_roles/viewer-1"), { role: "visualizador" });
    await setDoc(doc(db, "user_roles/prof-user-1"), { role: "profissional" });
    await setDoc(doc(db, "profiles/prof-user-1"), { professionalId: "prof-1" });
    await setDoc(doc(db, "professionals/prof-1"), { name: "Dra. Ana", active: true });
    await setDoc(doc(db, "professionals/prof-2"), { name: "Dr. Bruno", active: true });
    await setDoc(doc(db, "rooms/room-1"), { name: "Sala 1", active: true });
    await setDoc(doc(db, "contracts/contract-1"), { professionalId: "prof-1", status: "active" });
    await setDoc(doc(db, "contracts/contract-2"), { professionalId: "prof-2", status: "active" });
    await setDoc(doc(db, "bookings/booking-1"), { professionalId: "prof-1", roomId: "room-1", status: "active" });
    await setDoc(doc(db, "receivables/rec-1"), {
      professionalId: "prof-1",
      amountDue: 1000,
      amountPaid: 0,
      status: "open",
    });
    await setDoc(doc(db, "receivables/rec-2"), {
      professionalId: "prof-2",
      amountDue: 900,
      amountPaid: 0,
      status: "open",
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve("firestore.rules"), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBaseData();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("firestore.rules", () => {
  it("permite que gestor mantenha catalogos basicos", async () => {
    const db = firestoreAs("gestor-1");
    await assertSucceeds(setDoc(doc(db, "rooms/new-room"), { name: "Sala nova", active: true }));
    await assertSucceeds(setDoc(doc(db, "professionals/new-prof"), { name: "Novo profissional", active: true }));
    await assertSucceeds(setDoc(doc(db, "preferences/system"), { bookingHorizonDays: 90 }, { merge: true }));
  });

  it("trata owner como administrador sem liberar escrita nos dominios protegidos", async () => {
    const db = firestoreAs("owner-1");
    await assertSucceeds(setDoc(doc(db, "rooms/owner-room"), { name: "Sala owner", active: true }));
    await assertSucceeds(setDoc(doc(db, "preferences/system"), { bookingHorizonDays: 120 }, { merge: true }));
    await assertFails(setDoc(doc(db, "contracts/owner-contract"), { professionalId: "prof-1" }));
    await assertFails(setDoc(doc(db, "receivable_receipts/owner-receipt"), { receivableId: "rec-1", status: "issued" }));
  });

  it("bloqueia escrita de catalogo para visualizador", async () => {
    const db = firestoreAs("viewer-1");
    await assertFails(setDoc(doc(db, "rooms/new-room"), { name: "Sala indevida" }));
    await assertFails(setDoc(doc(db, "professionals/new-prof"), { name: "Prof indevido" }));
  });

  it("bloqueia escrita direta nos dominios protegidos mesmo para gestor", async () => {
    const db = firestoreAs("gestor-1");
    await assertFails(setDoc(doc(db, "contracts/new-contract"), { professionalId: "prof-1" }));
    await assertFails(updateDoc(doc(db, "bookings/booking-1"), { status: "cancelled" }));
    await assertFails(updateDoc(doc(db, "receivables/rec-1"), { amountPaid: 1000, status: "paid" }));
    await assertFails(setDoc(doc(db, "receivable_payments/pay-1"), { receivableId: "rec-1", amount: 1000 }));
    await assertFails(setDoc(doc(db, "receivable_receipts/receipt-1"), { receivableId: "rec-1", status: "issued" }));
  });

  it("limita profissional aos proprios contratos e recebiveis", async () => {
    const db = firestoreAs("prof-user-1");
    const ownContract = await assertSucceeds(getDoc(doc(db, "contracts/contract-1")));
    const ownReceivable = await assertSucceeds(getDoc(doc(db, "receivables/rec-1")));
    expect(ownContract.exists()).toBe(true);
    expect(ownReceivable.exists()).toBe(true);

    await assertFails(getDoc(doc(db, "contracts/contract-2")));
    await assertFails(getDoc(doc(db, "receivables/rec-2")));
  });

  it("impede criacao direta de auditoria e fila de notificacao pelo client", async () => {
    const db = firestoreAs("gestor-1");
    await assertFails(setDoc(doc(db, "audit_logs/log-1"), { action: "manual" }));
    await assertFails(setDoc(doc(db, "notification_queue/notif-1"), { status: "pending" }));
    await assertFails(deleteDoc(doc(db, "audit_logs/log-1")));
  });
});
