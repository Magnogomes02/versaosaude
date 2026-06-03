import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentReference, Query, SetOptions, UpdateData } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  addDays,
  calculateLateCharges,
  createReceiptAuthenticationCode,
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
type ReceivableStatus = "open" | "partial" | "paid" | "overdue" | "cancelled";

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
  const value = role.data()?.role;
  if (value !== "owner" && value !== "gestor") {
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

function isReceivableStatus(value: unknown): value is ReceivableStatus {
  return value === "open" || value === "partial" || value === "paid" || value === "overdue" || value === "cancelled";
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
    lateFeeEnabled: data.lateFeeEnabled === true,
    lateFeeFixedAmount: asNumber(data.lateFeeFixedAmount),
    lateFeePercent: asNumber(data.lateFeePercent),
    interestEnabled: data.interestEnabled === true,
    interestDailyPercent: asNumber(data.interestDailyPercent),
    graceDays: asNumber(data.graceDays),
    notificationDaysBeforeDue: Array.isArray(data.notificationDaysBeforeDue) ? data.notificationDaysBeforeDue.map((v) => asNumber(v)).filter((v) => v > 0) : [7],
    notificationDaysAfterDue: Array.isArray(data.notificationDaysAfterDue) ? data.notificationDaysAfterDue.map((v) => asNumber(v)).filter((v) => v > 0) : [5, 15],
  };
}

function receiptSigningSecret() {
  return process.env.RECEIPT_SIGNING_SECRET
    ?? process.env.GCLOUD_PROJECT
    ?? "versaosaude-local-dev";
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

async function cancelBookingsAndResolveConflicts(input: {
  contractId: string;
  cutoffDate: Date;
  cancelReason: string;
}) {
  const snap = await db.collection("bookings")
    .where("contractId", "==", input.contractId)
    .where("startAt", ">=", Timestamp.fromDate(input.cutoffDate))
    .get();
  const writer = new BatchWriter();
  const otherBookingIds = new Set<string>();
  let cancelledBookings = 0;
  let cancelledConflicts = 0;
  for (const booking of snap.docs) {
    const row = booking.data();
    if (row.status !== "active" && row.status !== "conflict") continue;
    await writer.update(booking.ref, {
      status: "cancelled",
      cancelReason: input.cancelReason,
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    cancelledBookings++;
    const conflictsA = await db.collection("booking_conflicts").where("bookingIdA", "==", booking.id).get();
    const conflictsB = await db.collection("booking_conflicts").where("bookingIdB", "==", booking.id).get();
    for (const conflict of [...conflictsA.docs, ...conflictsB.docs]) {
      const conflictData = conflict.data();
      if (conflictData.status !== "pending") continue;
      const otherId = conflictData.bookingIdA === booking.id ? asString(conflictData.bookingIdB) : asString(conflictData.bookingIdA);
      if (otherId) otherBookingIds.add(otherId);
      await writer.update(conflict.ref, {
        status: "cancelled",
        cancelReason: input.cancelReason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      cancelledConflicts++;
    }
  }
  await writer.flush();

  const repairWriter = new BatchWriter();
  let reactivatedBookings = 0;
  for (const bookingId of otherBookingIds) {
    const booking = await db.doc(`bookings/${bookingId}`).get();
    if (!booking.exists || booking.data()?.status !== "conflict") continue;
    const conflictsA = await db.collection("booking_conflicts").where("bookingIdA", "==", bookingId).get();
    const conflictsB = await db.collection("booking_conflicts").where("bookingIdB", "==", bookingId).get();
    const hasPending = [...conflictsA.docs, ...conflictsB.docs].some((doc) => doc.data().status === "pending");
    if (!hasPending) {
      await repairWriter.update(booking.ref, { status: "active", updatedAt: FieldValue.serverTimestamp() });
      reactivatedBookings++;
    }
  }
  await repairWriter.flush();
  return { cancelledBookings, cancelledConflicts, reactivatedBookings };
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
  const contract = await getContract(contractId);
  const today = toDateOnly(new Date());
  const effectiveDate = asString(data.effectiveDate, today);
  const bookingCutoffDate = asString(data.cancellationBookingCutoff, effectiveDate);
  const receivableCutoffMonth = startOfMonth(asString(data.cancellationReceivableCutoffMonth, effectiveDate));
  const closeFinancialAction = asString(data.closeFinancialAction, mode === "closed" ? "cancel_unpaid" : "cancel_unpaid");
  const penaltyAmount = asNumber(data.penaltyAmount);

  const receivables = await db.collection("receivables").where("contractId", "==", contractId).get();
  const hasFinancialHistory = receivables.docs.some((doc) => {
    const row = doc.data();
    return Number(row.amountPaid || 0) > 0 || row.status === "paid";
  });
  const receipts = await db.collection("receivable_receipts").where("contractId", "==", contractId).limit(1).get();
  const bookingResult = await cancelBookingsAndResolveConflicts({
    contractId,
    cutoffDate: dateAtTime(bookingCutoffDate, "00:00"),
    cancelReason: mode,
  });
  const writer = new BatchWriter();
  await writer.update(db.doc(`contracts/${contractId}`), {
    status: mode,
    closedReason: mode === "closed" ? reason : null,
    cancellationReason: mode === "cancelled" ? reason : null,
    closedAt: mode === "closed" ? FieldValue.serverTimestamp() : null,
    cancelledAt: mode === "cancelled" ? FieldValue.serverTimestamp() : null,
    closedBy: mode === "closed" ? request.auth?.uid ?? null : null,
    cancelledBy: mode === "cancelled" ? request.auth?.uid ?? null : null,
    effectiveCloseDate: mode === "closed" ? effectiveDate : null,
    cancellationEffectiveDate: mode === "cancelled" ? effectiveDate : null,
    cancellationBookingCutoff: bookingCutoffDate,
    cancellationReceivableCutoffMonth: receivableCutoffMonth,
    closeFinancialAction,
    penaltyAmount,
    updatedAt: FieldValue.serverTimestamp(),
    deletionProtected: hasFinancialHistory || !receipts.empty,
  });
  let cancelledReceivables = 0;
  let lossAmount = 0;
  let keptReceivables = 0;
  for (const doc of receivables.docs) {
    const row = doc.data();
    if (asString(row.referenceMonth) < receivableCutoffMonth) continue;
    if (row.status === "paid" || Number(row.amountPaid || 0) > 0) {
      keptReceivables++;
      continue;
    }
    if (closeFinancialAction === "keep_all") {
      keptReceivables++;
      continue;
    }
    await writer.update(doc.ref, {
      status: "cancelled",
      cancelReason: mode,
      cancellationReason: reason,
      lossAmount: asNumber(row.amountDue),
      updatedAt: FieldValue.serverTimestamp(),
    });
    cancelledReceivables++;
    lossAmount += asNumber(row.amountDue);
    await audit(request.auth?.uid, "receivable.cancel", "receivable", doc.id, {
      contractId,
      reason,
      statusBefore: row.status,
      statusAfter: "cancelled",
      amountDue: row.amountDue,
    });
  }
  let penaltyReceivableId: string | null = null;
  if (penaltyAmount > 0) {
    const ref = db.collection("receivables").doc(`${contractId}_penalty_${Date.now()}`);
    penaltyReceivableId = ref.id;
    await writer.set(ref, {
      kind: "penalty",
      type: "cancellation_fee",
      description: "Multa contratual",
      contractId,
      bookingId: null,
      professionalId: contract.professionalId,
      professionalName: contract.professionalName ?? null,
      roomId: null,
      roomName: "Multa contratual",
      referenceMonth: receivableCutoffMonth,
      dueDate: effectiveDate,
      amountDue: penaltyAmount,
      amountPaid: 0,
      status: effectiveDate < today ? "overdue" : "open",
      serviceType: contract.serviceType ?? DEFAULT_SERVICE_TYPE,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.flush();
  await audit(request.auth?.uid, mode === "cancelled" ? "contract.cancel" : "contract.close", "contract", contractId, {
    mode,
    reason,
    hasFinancialHistory,
    effectiveDate,
    bookingCutoffDate,
    receivableCutoffMonth,
    closeFinancialAction,
    penaltyAmount,
    penaltyReceivableId,
    cancelledReceivables,
    keptReceivables,
    lossAmount,
    ...bookingResult,
  });
  if (bookingResult.cancelledBookings) {
    await audit(request.auth?.uid, "booking.cancel.future", "contract", contractId, bookingResult);
  }
  return {
    mode,
    hasFinancialHistory,
    ...bookingResult,
    cancelledReceivables,
    keptReceivables,
    lossAmount,
    penaltyReceivableId,
  };
});

export const applyContractValueAdjustment = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const contractId = asString(data.contractId);
  const effectiveMonth = startOfMonth(asString(data.effectiveReferenceMonth, asString(data.effectiveMonth)));
  const newMonthlyValue = asNumber(data.newMonthlyValue);
  const reason = asString(data.reason);
  if (!contractId || !effectiveMonth || newMonthlyValue <= 0 || !reason) throw new HttpsError("invalid-argument", "Dados de reajuste invalidos.");
  const contract = await getContract(contractId);
  const snap = await db.collection("receivables").where("contractId", "==", contractId).get();
  const writer = new BatchWriter();
  let updated = 0;
  const affectedReceivables: string[] = [];
  const today = toDateOnly(new Date());
  for (const doc of snap.docs) {
    const row = doc.data();
    if (shouldUpdateFutureReceivable({
      referenceMonth: asString(row.referenceMonth),
      effectiveMonth,
      status: row.status,
      amountPaid: asNumber(row.amountPaid),
    })) {
      const previousAmountDue = asNumber(row.amountDue);
      const previousStatus = row.status;
      const nextStatus = resolveReceivableStatus({
        amountDue: newMonthlyValue,
        amountPaid: asNumber(row.amountPaid),
        dueDate: asString(row.dueDate),
        today,
        currentStatus: isReceivableStatus(row.status) ? row.status : "open",
      });
      await writer.update(doc.ref, {
        amountDue: newMonthlyValue,
        status: nextStatus,
        adjustedAt: FieldValue.serverTimestamp(),
        adjustmentReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await audit(request.auth?.uid, "receivable.adjust", "receivable", doc.id, {
        contractId,
        amountDueBefore: previousAmountDue,
        amountDueAfter: newMonthlyValue,
        statusBefore: previousStatus,
        statusAfter: nextStatus,
        reason,
      });
      affectedReceivables.push(doc.id);
      updated++;
    }
  }
  await writer.update(db.doc(`contracts/${contractId}`), { monthlyValue: newMonthlyValue, updatedAt: FieldValue.serverTimestamp() });
  const adjustmentRef = db.collection("contract_adjustments").doc();
  await writer.set(adjustmentRef, {
    contractId,
    previousMonthlyValue: asNumber(contract.monthlyValue),
    newMonthlyValue,
    effectiveReferenceMonth: effectiveMonth,
    affectedReceivablesCount: updated,
    affectedReceivables,
    reason,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: request.auth?.uid ?? null,
  });
  await writer.flush();
  await audit(request.auth?.uid, "contract.adjustment", "contract", contractId, {
    effectiveReferenceMonth: effectiveMonth,
    previousMonthlyValue: asNumber(contract.monthlyValue),
    newMonthlyValue,
    affectedCount: updated,
    reason,
  });
  return { updated, adjustmentId: adjustmentRef.id };
});

export const recordPayment = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const receivableId = asString(data.receivableId);
  const paymentInput = asDict(data.paymentInput);
  const baseAmount = asNumber(paymentInput.baseAmount, asNumber(paymentInput.amount));
  const paidAt = asString(paymentInput.paidAt) || new Date().toISOString();
  if (!receivableId || baseAmount <= 0) throw new HttpsError("invalid-argument", "Pagamento invalido.");
  const settings = await getSystemSettings();
  const paymentRef = db.collection("receivable_payments").doc();
  let updatedReceivable: Dict = {};
  await db.runTransaction(async (tx) => {
    const recRef = db.doc(`receivables/${receivableId}`);
    const rec = await tx.get(recRef);
    if (!rec.exists) throw new HttpsError("not-found", "Recebivel nao encontrado.");
    const row = rec.data()!;
    if (row.status === "cancelled") throw new HttpsError("failed-precondition", "Recebivel cancelado.");
    if (row.status === "paid") throw new HttpsError("failed-precondition", "Recebivel ja pago.");
    const suggestedCharges = calculateLateCharges({
      amountDue: asNumber(row.amountDue),
      dueDate: asString(row.dueDate),
      paidAt,
      settings,
    });
    const lateFeeAmount = asNumber(paymentInput.lateFeeAmount, suggestedCharges.lateFeeAmount);
    const interestAmount = asNumber(paymentInput.interestAmount, suggestedCharges.interestAmount);
    const discountAmount = asNumber(paymentInput.discountAmount);
    const totalPaid = Math.max(0, baseAmount + lateFeeAmount + interestAmount - discountAmount);
    const amountPaid = asNumber(row.amountPaid) + totalPaid;
    const status = resolveReceivableStatus({
      amountDue: asNumber(row.amountDue),
      amountPaid,
      dueDate: asString(row.dueDate),
      today: toDateOnly(new Date()),
      currentStatus: row.status,
    });
    const previous = {
      amountPaid: asNumber(row.amountPaid),
      status: isReceivableStatus(row.status) ? row.status : "open",
    };
    tx.set(paymentRef, {
      receivableId,
      contractId: row.contractId ?? null,
      bookingId: row.bookingId ?? null,
      professionalId: row.professionalId,
      amount: totalPaid,
      baseAmount,
      lateFeeAmount,
      interestAmount,
      discountAmount,
      totalPaid,
      suggestedLateFeeAmount: suggestedCharges.lateFeeAmount,
      suggestedInterestAmount: suggestedCharges.interestAmount,
      daysLate: suggestedCharges.daysLate,
      paidAt,
      paymentMethod: asString(paymentInput.paymentMethod, asString(paymentInput.method, "PIX")),
      notes: asString(paymentInput.notes) || null,
      status: "active",
      receiptId: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth?.uid ?? null,
    });
    updatedReceivable = {
      id: receivableId,
      ...row,
      amountPaid,
      status,
      lastPaidAt: paidAt,
    };
    tx.update(recRef, {
      amountPaid,
      status,
      lastPaidAt: paidAt,
      lastPaymentId: paymentRef.id,
      totalLateFees: asNumber(row.totalLateFees) + lateFeeAmount,
      totalInterest: asNumber(row.totalInterest) + interestAmount,
      totalDiscounts: asNumber(row.totalDiscounts) + discountAmount,
      updatedAt: FieldValue.serverTimestamp(),
    });
    updatedReceivable = { ...updatedReceivable, previous };
  });
  const previous = asDict(updatedReceivable.previous);
  await audit(request.auth?.uid, "payment.record", "receivable", receivableId, {
    paymentId: paymentRef.id,
    amount: asNumber(updatedReceivable.amountPaid) - asNumber(previous.amountPaid),
    amountPaidBefore: previous.amountPaid,
    amountPaidAfter: updatedReceivable.amountPaid,
    statusBefore: previous.status,
    statusAfter: updatedReceivable.status,
  });
  if (updatedReceivable.status === "partial") {
    await audit(request.auth?.uid, "payment.partial", "receivable", receivableId, { paymentId: paymentRef.id });
  }
  delete updatedReceivable.previous;
  return { paymentId: paymentRef.id, receivable: updatedReceivable };
});

export const revertPayment = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const paymentId = asString(data.paymentId);
  const reason = asString(data.reason);
  if (!paymentId || !reason) throw new HttpsError("invalid-argument", "paymentId e reason sao obrigatorios.");
  const settings = await getSystemSettings();
  let receivableId = "";
  let updatedReceivable: Dict = {};
  let previous: Dict = {};
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
    const nextStatus = resolveReceivableStatus({
      amountDue: asNumber(row.amountDue),
      amountPaid,
      dueDate: asString(row.dueDate),
      today,
      lastRevertedAt: today,
      graceDaysAfterRevert: settings.overdueGraceDaysAfterRevert,
    });
    previous = {
      amountPaid: asNumber(row.amountPaid),
      status: row.status,
    };
    tx.update(paymentRef, { status: "reverted", revertedAt: FieldValue.serverTimestamp(), revertReason: reason, revertedBy: request.auth?.uid ?? null });
    tx.update(recRef, {
      amountPaid,
      status: nextStatus,
      lastRevertedAt: today,
      totalLateFees: Math.max(0, asNumber(row.totalLateFees) - asNumber(pay.lateFeeAmount)),
      totalInterest: Math.max(0, asNumber(row.totalInterest) - asNumber(pay.interestAmount)),
      totalDiscounts: Math.max(0, asNumber(row.totalDiscounts) - asNumber(pay.discountAmount)),
      updatedAt: FieldValue.serverTimestamp(),
    });
    updatedReceivable = { id: receivableId, ...row, amountPaid, status: nextStatus, lastRevertedAt: today };
  });
  const receipts = await db.collection("receivable_receipts").where("paymentId", "==", paymentId).where("status", "==", "issued").get();
  const writer = new BatchWriter();
  for (const doc of receipts.docs) {
    await writer.update(doc.ref, {
      status: "invalidated",
      invalidatedAt: FieldValue.serverTimestamp(),
      invalidationReason: reason,
      invalidatedBy: request.auth?.uid ?? null,
      visibleInvalidation: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.flush();
  await audit(request.auth?.uid, "payment.revert", "receivable", receivableId, {
    paymentId,
    reason,
    invalidatedReceipts: receipts.size,
    amountPaidBefore: previous.amountPaid,
    amountPaidAfter: updatedReceivable.amountPaid,
    statusBefore: previous.status,
    statusAfter: updatedReceivable.status,
  });
  if (receipts.size) {
    await audit(request.auth?.uid, "receipt.invalidate", "payment", paymentId, { receivableId, reason, invalidatedReceipts: receipts.size });
  }
  return { receivableId, receivable: updatedReceivable, invalidatedReceipts: receipts.size };
});

export const issueReceipt = onCall({ region: REGION }, async (request) => {
  await assertGestor(request.auth?.uid);
  const data = asDict(request.data);
  const paymentId = asString(data.paymentId);
  if (!paymentId) throw new HttpsError("invalid-argument", "paymentId e obrigatorio.");
  const paymentSnap = await db.doc(`receivable_payments/${paymentId}`).get();
  if (!paymentSnap.exists || paymentSnap.data()?.status !== "active") {
    throw new HttpsError("failed-precondition", "Pagamento ativo nao encontrado.");
  }
  const payment = paymentSnap.data()!;
  if (payment.receiptId) throw new HttpsError("already-exists", "Este pagamento ja possui recibo.");
  const receivableId = asString(payment.receivableId);
  const rec = await db.doc(`receivables/${receivableId}`).get();
  if (!rec.exists) throw new HttpsError("not-found", "Recebivel nao encontrado.");
  const row = rec.data()!;
  const existing = await db.collection("receivable_receipts").where("paymentId", "==", paymentId).where("status", "==", "issued").limit(1).get();
  if (!existing.empty) throw new HttpsError("already-exists", "Ja existe recibo ativo para este pagamento.");
  const professional = await db.doc(`professionals/${asString(row.professionalId)}`).get();
  const ref = db.collection("receivable_receipts").doc();
  const receiptNumber = `REC-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${ref.id.slice(0, 6).toUpperCase()}`;
  const authenticationCode = createReceiptAuthenticationCode(receiptSigningSecret(), {
    receiptId: ref.id,
    receiptNumber,
    receivableId,
    contractId: row.contractId ?? null,
    professionalId: asString(row.professionalId),
    referenceMonth: asString(row.referenceMonth),
    amountDue: asNumber(row.amountDue),
    amountPaid: asNumber(payment.amount),
  });
  const remainingBalance = Math.max(0, asNumber(row.amountDue) - asNumber(row.amountPaid));
  await ref.set({
    receivableId,
    paymentId,
    contractId: row.contractId ?? null,
    bookingId: row.bookingId ?? null,
    professionalId: row.professionalId,
    professionalName: row.professionalName ?? professional.data()?.name ?? professional.data()?.fullName ?? null,
    professionalSnapshot: {
      id: row.professionalId,
      name: row.professionalName ?? professional.data()?.name ?? professional.data()?.fullName ?? null,
      email: professional.data()?.email ?? null,
    },
    clinicSnapshot: {
      name: "Versao Saude",
      serviceType: row.serviceType ?? DEFAULT_SERVICE_TYPE,
    },
    roomId: row.roomId ?? null,
    roomName: row.roomName ?? null,
    referenceMonth: row.referenceMonth,
    dueDate: row.dueDate,
    amountDue: row.amountDue,
    amountPaid: payment.amount,
    amountPaidAccumulated: row.amountPaid,
    remainingBalance,
    baseAmount: payment.baseAmount ?? payment.amount,
    lateFeeAmount: payment.lateFeeAmount ?? 0,
    interestAmount: payment.interestAmount ?? 0,
    discountAmount: payment.discountAmount ?? 0,
    paymentMethod: payment.paymentMethod ?? payment.method ?? null,
    paidAt: payment.paidAt ?? null,
    notes: payment.notes ?? null,
    serviceType: row.serviceType ?? DEFAULT_SERVICE_TYPE,
    receiptNumber,
    authenticationCode,
    signatureVersion: "hmac-sha256-v1",
    status: "issued",
    visibleInvalidation: false,
    issuedAt: FieldValue.serverTimestamp(),
    issuedBy: request.auth?.uid ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await paymentSnap.ref.update({ receiptId: ref.id, updatedAt: FieldValue.serverTimestamp() });
  await audit(request.auth?.uid, "receipt.issue", "payment", paymentId, { receiptId: ref.id, receivableId, receiptNumber });
  return { receiptId: ref.id, receiptNumber, authenticationCode };
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
    cancelledBy: request.auth?.uid ?? null,
    cancelReason: reason,
    visibleInvalidation: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await audit(request.auth?.uid, "receipt.cancel", "receipt", receiptId, { reason });
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
  const settings = await getSystemSettings();
  const today = toDateOnly(new Date());
  const targets = [
    ...settings.notificationDaysBeforeDue.map((days) => ({ dueDate: addDays(today, days), stage: `${days}_days_before` })),
    { dueDate: today, stage: "due_today" },
    ...settings.notificationDaysAfterDue.map((days) => ({ dueDate: addDays(today, -days), stage: `${days}_days_after` })),
  ];
  const writer = new BatchWriter();
  let queued = 0;
  for (const { dueDate, stage } of targets) {
    const snap = await db.collection("receivables").where("dueDate", "==", dueDate).where("status", "in", ["open", "partial", "overdue"]).get();
    for (const doc of snap.docs) {
      const row = doc.data();
      const ref = db.collection("notification_queue").doc(`${doc.id}_${stage}_${today}`);
      await writer.set(ref, {
        channel: "email",
        recipient: row.professionalEmail ?? row.professionalId,
        subject: row.dueDate === today ? "Vencimento hoje" : row.dueDate < today ? "Pagamento em atraso" : "Vencimento proximo",
        message: `Recebivel ${doc.id} vence em ${row.dueDate}.`,
        stage,
        status: "pending",
        receivableId: doc.id,
        contractId: row.contractId ?? null,
        professionalId: row.professionalId ?? null,
        dueDate: row.dueDate,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      queued++;
    }
  }
  await writer.flush();
  await audit(undefined, "notification.enqueue", "notification_queue", null, { queued, date: today });
});

export const processNotificationQueue = onSchedule({ region: REGION, schedule: "every day 08:10", timeZone: "America/Sao_Paulo" }, async () => {
  const settingsSnap = await db.doc("preferences/system").get();
  const notifications = asDict(settingsSnap.data()?.notifications);
  const realDeliveryEnabled = asDict(notifications.email).enabled === true
    || asDict(notifications.whatsapp).enabled === true
    || asDict(notifications.telegram).enabled === true;
  const snap = await db.collection("notification_queue").where("status", "==", "pending").limit(200).get();
  const writer = new BatchWriter();
  let processed = 0;
  for (const doc of snap.docs) {
    await writer.update(doc.ref, {
      status: realDeliveryEnabled ? "ready" : "logged",
      processedAt: FieldValue.serverTimestamp(),
      processingMode: realDeliveryEnabled ? "provider_required" : "test_logged",
      updatedAt: FieldValue.serverTimestamp(),
    });
    processed++;
  }
  await writer.flush();
  await audit(undefined, "notification.process", "notification_queue", null, { processed, realDeliveryEnabled });
});
