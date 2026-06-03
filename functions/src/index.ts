import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentReference, Query, SetOptions, UpdateData } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  addDays,
  generateMonthlyReceivables,
  resolveReceivableStatus,
  shouldUpdateFutureReceivable,
  startOfMonth,
  toDateOnly,
} from "./domain.js";

admin.initializeApp();
const db = admin.firestore();

type Dict = Record<string, unknown>;
type ContractStatus = "draft" | "active" | "closed" | "cancelled";

const REGION = "us-central1";
const DEFAULT_SERVICE_TYPE = "clinic";
const MAX_BATCH_WRITES = 450;

function asDict(value: unknown): Dict {
  return value && typeof value === "object" ? value as Dict : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function assertGestor(uid?: string) {
  if (!uid) throw new HttpsError("unauthenticated", "Login obrigatorio.");
  const role = await db.doc(`user_roles/${uid}`).get();
  if (role.data()?.role !== "gestor") {
    throw new HttpsError("permission-denied", "Apenas gestores podem executar esta acao.");
  }
}

async function audit(uid: string | undefined, action: string, entityType: string, entityId: string | null, metadata: Dict = {}) {
  await db.collection("audit_logs").add({
    actorId: uid ?? null,
    action,
    entityType,
    entityId,
    metadata,
    createdAt: FieldValue.serverTimestamp(),
  });
}

class BatchWriter {
  private batch = db.batch();
  private pending = 0;

  async set(ref: DocumentReference<DocumentData>, data: DocumentData, options?: SetOptions) {
    if (options) this.batch.set(ref, data, options);
    else this.batch.set(ref, data);
    await this.bump();
  }

  async update(ref: DocumentReference<DocumentData>, data: UpdateData<DocumentData>) {
    this.batch.update(ref, data);
    await this.bump();
  }

  async delete(ref: DocumentReference<DocumentData>) {
    this.batch.delete(ref);
    await this.bump();
  }

  async flush() {
    if (!this.pending) return;
    await this.batch.commit();
    this.batch = db.batch();
    this.pending = 0;
  }

  private async bump() {
    this.pending += 1;
    if (this.pending >= MAX_BATCH_WRITES) await this.flush();
  }
}

async function getSystemSettings() {
  const snap = await db.doc("preferences/system").get();
  const data = snap.data() ?? {};
  return {
    bookingHorizonDays: asNumber(data.bookingHorizonDays, 90),
    indefiniteContractMonths: asNumber(data.indefiniteContractMonths, 12),
    overdueGraceDaysAfterRevert: asNumber(data.overdueGraceDaysAfterRevert, 3),
  };
}

async function deleteQuery(query: Query) {
  const snap = await query.get();
  const writer = new BatchWriter();
  for (const doc of snap.docs) {
    await writer.delete(doc.ref);
  }
  await writer.flush();
  return snap.size;
}

async function getContract(contractId: string) {
  const snap = await db.doc(`contracts/${contractId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Contrato nao encontrado.");
  return { id: snap.id, ...snap.data()! } as Dict & { id: string };
}

async function listContractSchedules(contractId: string) {
  const snap = await db.collection("contract_schedules").where("contractId", "==", contractId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Dict & { id: string });
}

async function resolveRoomForReceivable(contractId: string, contract: Dict) {
  if (typeof contract.roomId === "string" && contract.roomId) return { roomId: contract.roomId, roomName: null };
  const schedules = await listContractSchedules(contractId);
  const roomIds = Array.from(new Set(schedules.map((s) => asString(s.roomId)).filter(Boolean)));
  if (roomIds.length === 1) {
    const room = await db.doc(`rooms/${roomIds[0]}`).get();
    return { roomId: roomIds[0], roomName: asString(room.data()?.name) || null };
  }
  if (roomIds.length > 1) {
    const rooms = await Promise.all(roomIds.map((id) => db.doc(`rooms/${id}`).get()));
    return {
      roomId: null,
      roomName: rooms.map((room) => asString(room.data()?.name)).filter(Boolean).join(", "),
    };
  }
  return { roomId: null, roomName: null };
}

async function internalGenerateContractReceivables(contractId: string, horizonMonths?: number) {
  const settings = await getSystemSettings();
  const contract = await getContract(contractId);
  const today = toDateOnly(new Date());
  const room = await resolveRoomForReceivable(contractId, contract);
  const rows = generateMonthlyReceivables({
    startDate: asString(contract.startDate),
    endDate: asString(contract.endDate) || null,
    monthlyValue: asNumber(contract.monthlyValue),
    dueDay: asNumber(contract.dueDay, 5),
    horizonMonths: horizonMonths ?? settings.indefiniteContractMonths,
    today,
  });
  let created = 0;
  const writer = new BatchWriter();
  for (const row of rows) {
    const ref = db.doc(`receivables/${contractId}_${row.referenceMonth}`);
    const existing = await ref.get();
    if (existing.exists) continue;
    await writer.set(ref, {
      kind: "contract",
      contractId,
      bookingId: null,
      professionalId: contract.professionalId,
      roomId: room.roomId,
      roomName: room.roomName,
      referenceMonth: row.referenceMonth,
      dueDate: row.dueDate,
      amountDue: row.amountDue,
      amountPaid: 0,
      status: row.dueDate < today ? "overdue" : "open",
      serviceType: contract.serviceType ?? DEFAULT_SERVICE_TYPE,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    created++;
  }
  await writer.flush();
  return created;
}

function dateAtTime(dateOnly: string, time: string) {
  return new Date(`${dateOnly}T${time}:00-03:00`);
}

async function internalGenerateContractBookings(contractId: string, horizonDays?: number) {
  const settings = await getSystemSettings();
  const contract = await getContract(contractId);
  const schedules = await listContractSchedules(contractId);
  const from = asString(contract.startDate) > toDateOnly(new Date()) ? asString(contract.startDate) : toDateOnly(new Date());
  const limitDays = Math.max(1, Math.min(365, horizonDays ?? settings.bookingHorizonDays));
  const requestedTo = addDays(from, limitDays);
  const to = asString(contract.endDate) && asString(contract.endDate) < requestedTo ? asString(contract.endDate) : requestedTo;

  const old = await db.collection("bookings")
    .where("contractId", "==", contractId)
    .where("startAt", ">=", Timestamp.fromDate(new Date()))
    .get();
  const cancelWriter = new BatchWriter();
  let cancelledOld = 0;
  for (const doc of old.docs) {
    const status = doc.data().status;
    if (status === "active" || status === "conflict") {
      await cancelWriter.update(doc.ref, {
        status: "cancelled",
        cancelReason: "schedule_regenerated",
        updatedAt: FieldValue.serverTimestamp(),
      });
      cancelledOld++;
    }
  }
  await cancelWriter.flush();

  const createWriter = new BatchWriter();
  let created = 0;
  let conflictsRegistered = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T12:00:00-03:00`).getDay();
    for (const schedule of schedules) {
      if (asNumber(schedule.weekday) !== weekday) continue;
      const startAt = dateAtTime(day, asString(schedule.startTime));
      const endAt = dateAtTime(day, asString(schedule.endTime));
      if (endAt <= startAt) continue;
      const roomId = asString(schedule.roomId);
      const candidates = await db.collection("bookings")
        .where("roomId", "==", roomId)
        .where("status", "in", ["active", "conflict"])
        .where("startAt", "<", Timestamp.fromDate(endAt))
        .get();
      const overlaps = candidates.docs.filter((doc) => {
        const row = doc.data();
        if (row.contractId === contractId) return false;
        const otherEnd = row.endAt?.toDate?.() as Date | undefined;
        return otherEnd ? otherEnd > startAt : false;
      });
      const bookingRef = db.collection("bookings").doc();
      await createWriter.set(bookingRef, {
        contractId,
        professionalId: contract.professionalId,
        roomId,
        startAt: Timestamp.fromDate(startAt),
        endAt: Timestamp.fromDate(endAt),
        status: overlaps.length ? "conflict" : "active",
        source: "contract",
        serviceType: contract.serviceType ?? DEFAULT_SERVICE_TYPE,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      created++;
      for (const other of overlaps) {
        const conflictRef = db.collection("booking_conflicts").doc();
        await createWriter.set(conflictRef, {
          bookingIdA: bookingRef.id,
          bookingIdB: other.id,
          roomId,
          status: "pending",
          createdAt: FieldValue.serverTimestamp(),
        });
        await createWriter.update(other.ref, { status: "conflict", updatedAt: FieldValue.serverTimestamp() });
        conflictsRegistered++;
      }
    }
  }
  await createWriter.flush();
  return { created, conflictsRegistered, cancelledOld };
}

export const createOrUpdateContract = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const contractId = asString(data.contractId);
  const professionalId = asString(data.professionalId);
  if (!professionalId) throw new HttpsError("invalid-argument", "professionalId e obrigatorio.");
  const ref = contractId ? db.doc(`contracts/${contractId}`) : db.collection("contracts").doc();
  const existing = contractId ? await ref.get() : null;
  if (contractId && !existing?.exists) throw new HttpsError("not-found", "Contrato nao encontrado.");

  const professional = await db.doc(`professionals/${professionalId}`).get();
  const professionalName = asString(professional.data()?.name) || asString(professional.data()?.fullName);
  const professionalEmail = asString(professional.data()?.email) || null;
  const existingStatus = asString(existing?.data()?.status, "draft") as ContractStatus;
  const status = contractId ? existingStatus : "draft";
  const payload = {
    professionalId,
    professionalName,
    professionalEmail,
    startDate: asString(data.startDate),
    endDate: asString(data.endDate) || null,
    monthlyValue: asNumber(data.monthlyValue),
    dueDay: Math.min(28, Math.max(1, asNumber(data.dueDay, 5))),
    status,
    serviceType: asString(data.serviceType, DEFAULT_SERVICE_TYPE),
    notes: asString(data.notes) || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (contractId) await ref.set(payload, { merge: true });
  else await ref.set({ ...payload, createdAt: FieldValue.serverTimestamp() });

  await deleteQuery(db.collection("contract_schedules").where("contractId", "==", ref.id));
  const schedules = Array.isArray(data.schedules) ? data.schedules.map(asDict) : [];
  const scheduleWriter = new BatchWriter();
  for (const schedule of schedules) {
    const scheduleRef = db.collection("contract_schedules").doc();
    await scheduleWriter.set(scheduleRef, {
      contractId: ref.id,
      weekday: asNumber(schedule.weekday),
      roomId: asString(schedule.roomId),
      startTime: asString(schedule.startTime),
      endTime: asString(schedule.endTime),
      serviceType: asString(data.serviceType, DEFAULT_SERVICE_TYPE),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await scheduleWriter.flush();
  const regeneratedBookings = status === "active"
    ? await internalGenerateContractBookings(ref.id)
    : null;
  await audit(request.auth?.uid, contractId ? "contract.update" : "contract.create", "contract", ref.id, {
    schedules: schedules.length,
    status,
    regeneratedBookings,
  });
  return { contractId: ref.id, regeneratedBookings };
});

export const activateContract = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const contractId = asString(asDict(request.data).contractId);
  if (!contractId) throw new HttpsError("invalid-argument", "contractId e obrigatorio.");
  await db.doc(`contracts/${contractId}`).update({ status: "active", activatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  const receivablesCreated = await internalGenerateContractReceivables(contractId);
  const bookings = await internalGenerateContractBookings(contractId);
  await audit(request.auth?.uid, "contract.activate", "contract", contractId, { receivablesCreated, ...bookings });
  return { receivablesCreated, ...bookings };
});

export const generateContractReceivables = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const contractId = asString(data.contractId);
  const created = await internalGenerateContractReceivables(contractId, asNumber(data.horizonMonths, 12));
  await audit(request.auth?.uid, "contract.receivables_generate", "contract", contractId, { created });
  return { created };
});

export const generateContractBookings = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const contractId = asString(data.contractId);
  const result = await internalGenerateContractBookings(contractId, asNumber(data.horizonDays, 90));
  await audit(request.auth?.uid, "contract.bookings_generate", "contract", contractId, result);
  return result;
});

export const closeOrCancelContract = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const contractId = asString(data.contractId);
  const mode = asString(data.mode) === "cancelled" ? "cancelled" : "closed";
  const reason = asString(data.reason);
  if (!contractId || !reason) throw new HttpsError("invalid-argument", "contractId e reason sao obrigatorios.");

  const receivables = await db.collection("receivables").where("contractId", "==", contractId).get();
  const hasFinancialHistory = receivables.docs.some((doc) => {
    const row = doc.data();
    return Number(row.amountPaid || 0) > 0 || row.status === "paid";
  });
  const receipts = await db.collection("receivable_receipts").where("contractId", "==", contractId).limit(1).get();
  const futureBookings = await db.collection("bookings")
    .where("contractId", "==", contractId)
    .where("startAt", ">=", Timestamp.fromDate(new Date()))
    .get();
  const writer = new BatchWriter();
  await writer.update(db.doc(`contracts/${contractId}`), {
    status: mode,
    closedReason: reason,
    closedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deletionProtected: hasFinancialHistory || !receipts.empty,
  });
  for (const doc of futureBookings.docs) {
    const status = doc.data().status;
    if (status === "active" || status === "conflict") {
      await writer.update(doc.ref, { status: "cancelled", cancelReason: mode, updatedAt: FieldValue.serverTimestamp() });
    }
  }
  for (const doc of receivables.docs) {
    const row = doc.data();
    if (row.status !== "paid" && Number(row.amountPaid || 0) <= 0) {
      await writer.update(doc.ref, { status: "cancelled", cancelReason: mode, updatedAt: FieldValue.serverTimestamp() });
    }
  }
  await writer.flush();
  await audit(request.auth?.uid, "contract.soft_cancel", "contract", contractId, { mode, reason, hasFinancialHistory });
  return { mode, hasFinancialHistory, cancelledFutureBookings: futureBookings.size };
});

export const applyContractValueAdjustment = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const contractId = asString(data.contractId);
  const effectiveMonth = startOfMonth(asString(data.effectiveMonth));
  const newMonthlyValue = asNumber(data.newMonthlyValue);
  if (!contractId || !effectiveMonth || newMonthlyValue <= 0) throw new HttpsError("invalid-argument", "Dados de reajuste invalidos.");
  const snap = await db.collection("receivables").where("contractId", "==", contractId).get();
  const writer = new BatchWriter();
  let updated = 0;
  for (const doc of snap.docs) {
    const row = doc.data();
    if (shouldUpdateFutureReceivable({
      referenceMonth: asString(row.referenceMonth),
      effectiveMonth,
      status: row.status,
      amountPaid: asNumber(row.amountPaid),
    })) {
      await writer.update(doc.ref, { amountDue: newMonthlyValue, updatedAt: FieldValue.serverTimestamp() });
      updated++;
    }
  }
  await writer.update(db.doc(`contracts/${contractId}`), { monthlyValue: newMonthlyValue, updatedAt: FieldValue.serverTimestamp() });
  await writer.flush();
  await audit(request.auth?.uid, "contract.value_adjust", "contract", contractId, { effectiveMonth, newMonthlyValue, updated });
  return { updated };
});

export const recordPayment = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const receivableId = asString(data.receivableId);
  const paymentInput = asDict(data.paymentInput);
  const amount = asNumber(paymentInput.amount);
  if (!receivableId || amount <= 0) throw new HttpsError("invalid-argument", "Pagamento invalido.");
  const paymentRef = db.collection("receivable_payments").doc();
  await db.runTransaction(async (tx) => {
    const recRef = db.doc(`receivables/${receivableId}`);
    const rec = await tx.get(recRef);
    if (!rec.exists) throw new HttpsError("not-found", "Recebivel nao encontrado.");
    const row = rec.data()!;
    if (row.status === "cancelled") throw new HttpsError("failed-precondition", "Recebivel cancelado.");
    const amountPaid = asNumber(row.amountPaid) + amount;
    const status = resolveReceivableStatus({
      amountDue: asNumber(row.amountDue),
      amountPaid,
      dueDate: asString(row.dueDate),
      today: toDateOnly(new Date()),
      currentStatus: row.status,
    });
    tx.set(paymentRef, {
      receivableId,
      contractId: row.contractId ?? null,
      professionalId: row.professionalId,
      amount,
      paidAt: asString(paymentInput.paidAt) || new Date().toISOString(),
      method: asString(paymentInput.method, "PIX"),
      notes: asString(paymentInput.notes) || null,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth?.uid ?? null,
    });
    tx.update(recRef, {
      amountPaid,
      status,
      lastPaidAt: asString(paymentInput.paidAt) || new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await audit(request.auth?.uid, "receivable.payment_record", "receivable", receivableId, { paymentId: paymentRef.id, amount });
  return { paymentId: paymentRef.id };
});

export const revertPayment = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const paymentId = asString(data.paymentId);
  const reason = asString(data.reason);
  if (!paymentId || !reason) throw new HttpsError("invalid-argument", "paymentId e reason sao obrigatorios.");
  const settings = await getSystemSettings();
  let receivableId = "";
  await db.runTransaction(async (tx) => {
    const paymentRef = db.doc(`receivable_payments/${paymentId}`);
    const payment = await tx.get(paymentRef);
    if (!payment.exists || payment.data()?.status !== "active") throw new HttpsError("failed-precondition", "Pagamento nao ativo.");
    const pay = payment.data()!;
    receivableId = asString(pay.receivableId);
    const recRef = db.doc(`receivables/${receivableId}`);
    const rec = await tx.get(recRef);
    if (!rec.exists) throw new HttpsError("not-found", "Recebivel nao encontrado.");
    const row = rec.data()!;
    const amountPaid = Math.max(0, asNumber(row.amountPaid) - asNumber(pay.amount));
    const today = toDateOnly(new Date());
    tx.update(paymentRef, { status: "reverted", revertedAt: FieldValue.serverTimestamp(), revertReason: reason, revertedBy: request.auth?.uid ?? null });
    tx.update(recRef, {
      amountPaid,
      status: resolveReceivableStatus({
        amountDue: asNumber(row.amountDue),
        amountPaid,
        dueDate: asString(row.dueDate),
        today,
        lastRevertedAt: today,
        graceDaysAfterRevert: settings.overdueGraceDaysAfterRevert,
      }),
      lastRevertedAt: today,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const receipts = await db.collection("receivable_receipts").where("receivableId", "==", receivableId).where("status", "==", "issued").get();
  const writer = new BatchWriter();
  for (const doc of receipts.docs) {
    await writer.update(doc.ref, {
      status: "invalidated",
      invalidatedAt: FieldValue.serverTimestamp(),
      invalidationReason: reason,
      visibleInvalidation: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.flush();
  await audit(request.auth?.uid, "receivable.payment_revert", "receivable", receivableId, { paymentId, reason, invalidatedReceipts: receipts.size });
  return { receivableId, invalidatedReceipts: receipts.size };
});

export const issueReceipt = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const receivableId = asString(asDict(request.data).receivableId);
  const rec = await db.doc(`receivables/${receivableId}`).get();
  if (!rec.exists) throw new HttpsError("not-found", "Recebivel nao encontrado.");
  const row = rec.data()!;
  if (row.status !== "paid") throw new HttpsError("failed-precondition", "Recibo so pode ser emitido para recebivel pago.");
  const existing = await db.collection("receivable_receipts").where("receivableId", "==", receivableId).where("status", "==", "issued").limit(1).get();
  if (!existing.empty) throw new HttpsError("already-exists", "Ja existe recibo ativo para este recebivel.");
  const ref = db.collection("receivable_receipts").doc();
  const receiptNumber = `REC-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${ref.id.slice(0, 6).toUpperCase()}`;
  await ref.set({
    receivableId,
    contractId: row.contractId ?? null,
    professionalId: row.professionalId,
    professionalName: row.professionalName ?? null,
    roomId: row.roomId ?? null,
    roomName: row.roomName ?? null,
    referenceMonth: row.referenceMonth,
    dueDate: row.dueDate,
    amountDue: row.amountDue,
    amountPaid: row.amountPaid,
    receiptNumber,
    authenticationCode: `${ref.id}:${receiptNumber}`,
    status: "issued",
    visibleInvalidation: false,
    issuedAt: FieldValue.serverTimestamp(),
    issuedBy: request.auth?.uid ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await audit(request.auth?.uid, "receivable.receipt_issue", "receivable", receivableId, { receiptId: ref.id, receiptNumber });
  return { receiptId: ref.id, receiptNumber };
});

export const cancelReceipt = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const receiptId = asString(data.receiptId);
  const reason = asString(data.reason);
  if (!receiptId || !reason) throw new HttpsError("invalid-argument", "receiptId e reason sao obrigatorios.");
  await db.doc(`receivable_receipts/${receiptId}`).update({
    status: "cancelled",
    cancelledAt: FieldValue.serverTimestamp(),
    cancelReason: reason,
    visibleInvalidation: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await audit(request.auth?.uid, "receivable.receipt_cancel", "receipt", receiptId, { reason });
  return { receiptId };
});

export const markOverdueReceivables = onSchedule({ region: REGION, schedule: "every day 02:15", timeZone: "America/Sao_Paulo" }, async () => {
  const settings = await getSystemSettings();
  const today = toDateOnly(new Date());
  const snap = await db.collection("receivables").where("status", "in", ["open", "partial"]).get();
  const writer = new BatchWriter();
  let updated = 0;
  for (const doc of snap.docs) {
    const row = doc.data();
    const status = resolveReceivableStatus({
      amountDue: asNumber(row.amountDue),
      amountPaid: asNumber(row.amountPaid),
      dueDate: asString(row.dueDate),
      today,
      currentStatus: row.status,
      lastRevertedAt: asString(row.lastRevertedAt) || null,
      graceDaysAfterRevert: settings.overdueGraceDaysAfterRevert,
    });
    if (status !== row.status) {
      await writer.update(doc.ref, { status, updatedAt: FieldValue.serverTimestamp() });
      updated++;
    }
  }
  await writer.flush();
});

export const extendOpenEndedContracts = onSchedule({ region: REGION, schedule: "every month 1st 03:00", timeZone: "America/Sao_Paulo" }, async () => {
  const snap = await db.collection("contracts").where("status", "==", "active").where("endDate", "==", null).get();
  for (const doc of snap.docs) {
    await internalGenerateContractReceivables(doc.id);
    await internalGenerateContractBookings(doc.id);
  }
});

export const enqueueDueNotifications = onSchedule({ region: REGION, schedule: "every day 08:00", timeZone: "America/Sao_Paulo" }, async () => {
  const today = toDateOnly(new Date());
  const targets = [addDays(today, 7), today, addDays(today, -5)];
  const writer = new BatchWriter();
  let queued = 0;
  for (const dueDate of targets) {
    const snap = await db.collection("receivables").where("dueDate", "==", dueDate).where("status", "in", ["open", "partial", "overdue"]).get();
    for (const doc of snap.docs) {
      const row = doc.data();
      const ref = db.collection("notification_queue").doc(`${doc.id}_${today}`);
      await writer.set(ref, {
        channel: "email",
        recipient: row.professionalEmail ?? row.professionalId,
        subject: row.dueDate === today ? "Vencimento hoje" : row.dueDate < today ? "Pagamento em atraso" : "Vencimento proximo",
        message: `Recebivel ${doc.id} vence em ${row.dueDate}.`,
        status: "pending",
        receivableId: doc.id,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      queued++;
    }
  }
  await writer.flush();
});
