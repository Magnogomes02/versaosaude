// /public/js/app.db.js
// Camada fina de acesso ao Firestore (client-side).
// Mantém nomes existentes. Preferências em `preferences/system` para compat.

import { db } from "./app.firebase.js";
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, orderBy, limit,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ---------- Utils ----------
const toDate = (v) => (v?.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v)));
const toTimestamp = (v) => (v instanceof Timestamp ? v
  : (v?.toDate ? Timestamp.fromDate(v.toDate())
  : Timestamp.fromDate(toDate(v))));

// ---------- Settings (compat) ----------
export async function getSettings() {
  // Doc único com defaults simples
  const ref = doc(db, "preferences", "system"); // compat com index.html atual
  const snap = await getDoc(ref);
  const defaults = {
    timezone: "America/Recife",
    dstEnabled: false,
    bookingWindowDays: 60,
    bizStart: "07:00",
    bizEnd: "21:00",
    notifications: { email: false, telegram: false }
  };
  return snap.exists() ? { id: ref.id, ...defaults, ...snap.data() } : { id: ref.id, ...defaults };
}

export async function saveSettings(patch) {
  const ref = doc(db, "preferences", "system"); // compat
  await setDoc(ref, { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

// ---------- Catálogos ----------
export async function listRooms() {
  const base = collection(db, "rooms");
  const q = query(base, orderBy("name"), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function listProfessionals() {
  const base = collection(db, "professionals");
  const q = query(base, orderBy("name"), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------- Contratos ----------
export async function addContract(data) {
  // Mantém a lógica da versão anterior: strings de data e weeklySchedule
  const payload = {
    professionalId: data.professionalId || null,
    roomId: data.roomId || null,
    startDate: data.startDate || null,    // string ISO (yyyy-mm-dd)
    endDate: data.endDate || null,        // string ISO
    weeklySchedule: Array.isArray(data.weeklySchedule) ? data.weeklySchedule : [],
    allowOverlap: (data.allowOverlap === undefined) ? true : !!data.allowOverlap,
    status: data.status || "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const ref = await addDoc(collection(db, "contracts"), payload);
  return ref.id;
}

// ---------- Bookings (leitura simples para o calendário) ----------
export async function listBookings({ roomId=null, professionalId=null, from=null, to=null } = {}) {
  const base = collection(db, "bookings");
  let q = base;

  const filters = [];
  if (roomId) filters.push(where("roomId", "==", roomId));
  if (professionalId) filters.push(where("professionalId", "==", professionalId));
  if (from) filters.push(where("startAt", ">=", toTimestamp(from)));
  if (to)   filters.push(where("startAt", "<", toTimestamp(to)));

  if (filters.length) {
    // Firebase não permite encadear diretamente um array, fazemos redução
    // simples (para <= 10 filtros).
    q = query(base, ...filters);
  }

  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
