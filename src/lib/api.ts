import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  doc,
  where,
} from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import type { AuditLog, Booking, Contract, Professional, Receivable, Room } from "@/types";

export async function listCollection<T>(name: string, max = 200): Promise<T[]> {
  const snap = await getDocs(query(collection(db, name), limit(max)));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);
}

export async function listRooms() {
  return listCollection<Room>("rooms");
}

export async function saveRoom(input: { id?: string; name: string; active?: boolean; serviceType?: string }) {
  const payload = {
    name: input.name.trim(),
    active: input.active ?? true,
    serviceType: input.serviceType || "clinic",
    updatedAt: serverTimestamp(),
  };
  if (input.id) {
    await setDoc(doc(db, "rooms", input.id), payload, { merge: true });
    return input.id;
  }
  const ref = await addDoc(collection(db, "rooms"), { ...payload, createdAt: serverTimestamp() });
  return ref.id;
}

export async function listProfessionals() {
  return listCollection<Professional>("professionals");
}

export async function saveProfessional(input: {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  active?: boolean;
  serviceType?: string;
}) {
  const payload = {
    name: input.name.trim(),
    fullName: input.name.trim(),
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    active: input.active ?? true,
    serviceType: input.serviceType || "clinic",
    updatedAt: serverTimestamp(),
  };
  if (input.id) {
    await setDoc(doc(db, "professionals", input.id), payload, { merge: true });
    return input.id;
  }
  const ref = await addDoc(collection(db, "professionals"), { ...payload, createdAt: serverTimestamp() });
  return ref.id;
}

export async function listContracts() {
  const snap = await getDocs(query(collection(db, "contracts"), orderBy("updatedAt", "desc"), limit(100)));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Contract);
}

export async function listBookings() {
  const snap = await getDocs(query(collection(db, "bookings"), orderBy("startAt", "asc"), limit(200)));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Booking);
}

export async function listReceivables(status?: Receivable["status"]) {
  const base = collection(db, "receivables");
  const q = status
    ? query(base, where("status", "==", status), orderBy("dueDate", "asc"), limit(200))
    : query(base, orderBy("dueDate", "asc"), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Receivable);
}

export async function listAuditLogs() {
  const snap = await getDocs(query(collection(db, "audit_logs"), orderBy("createdAt", "desc"), limit(80)));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as AuditLog);
}

export const callCreateOrUpdateContract = httpsCallable(functions, "createOrUpdateContract");
export const callActivateContract = httpsCallable(functions, "activateContract");
export const callCloseOrCancelContract = httpsCallable(functions, "closeOrCancelContract");
export const callGenerateContractBookings = httpsCallable(functions, "generateContractBookings");
export const callGenerateContractReceivables = httpsCallable(functions, "generateContractReceivables");
export const callApplyContractValueAdjustment = httpsCallable(functions, "applyContractValueAdjustment");
export const callRecordPayment = httpsCallable(functions, "recordPayment");
export const callRevertPayment = httpsCallable(functions, "revertPayment");
export const callIssueReceipt = httpsCallable(functions, "issueReceipt");
export const callCancelReceipt = httpsCallable(functions, "cancelReceipt");
