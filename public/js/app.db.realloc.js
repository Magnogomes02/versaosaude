// Camada complementar de DB para Realocação (não renomeia nada existente).
import { db } from "./app.firebase.js";
import {
  getDoc, doc, query, where, collection, getDocs,
  runTransaction, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const toTs = (d) => (d instanceof Timestamp ? d : Timestamp.fromDate(d));

export async function getBookingById(id){
  const snap = await getDoc(doc(db, "bookings", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Checa conflitos:
 * - Consulta por roomId (apenas) para evitar índice composto.
 * - Filtra no cliente: overlap => (endAt > newStart && startAt < newEnd)
 * - Ignora a própria reserva (ignoreId).
 */
export async function findConflicts(roomId, newStart, newEnd, ignoreId){
  const q = query(collection(db, "bookings"), where("roomId", "==", roomId));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  return rows.filter(r => {
    if (ignoreId && r.id === ignoreId) return false;
    const startAt = r.startAt?.toDate ? r.startAt.toDate() : new Date(r.startAt);
    const endAt   = r.endAt?.toDate ? r.endAt.toDate()   : new Date(r.endAt);
    return endAt > newStart && startAt < newEnd;
  });
}

/**
 * Realocação transacional (lado cliente):
 * - Cria novo booking (copia contractId, professionalId; muda roomId, startAt, endAt; source="reallocation"; reallocatedFrom)
 * - Atualiza original para status:"moved" e reallocatedTo
 * - Auditoria em /audit_logs com type:"reallocation", reason, byUserId
 */
export async function reallocateBooking({ bookingId, newRoomId, newStartAt, newEndAt, byUserId, reason }){
  const origRef  = doc(db, "bookings", bookingId);
  const newRef   = doc(collection(db, "bookings"));
  const auditRef = doc(collection(db, "audit_logs"));

  await runTransaction(db, async (tx) => {
    const origSnap = await tx.get(origRef);
    if (!origSnap.exists()) throw new Error("Reserva original não encontrada.");
    const orig = origSnap.data();

    // 1) Novo booking
    const newBooking = {
      contractId: orig.contractId || null,
      professionalId: orig.professionalId || null,
      roomId: newRoomId,
      startAt: toTs(newStartAt),
      endAt: toTs(newEndAt),
      status: "scheduled",
      source: "reallocation",          // campo novo (opcional)
      reallocatedFrom: bookingId,      // campo novo (opcional)
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    tx.set(newRef, newBooking);

    // 2) Atualiza original
    tx.update(origRef, {
      status: "moved",
      reallocatedTo: newRef.id,        // campo novo (opcional)
      updatedAt: serverTimestamp()
    });

    // 3) Auditoria
    tx.set(auditRef, {
      type: "reallocation",
      at: serverTimestamp(),
      byUserId: byUserId || null,
      reason: reason || null,
      data: {
        fromBookingId: bookingId,
        toBookingId: newRef.id,
        fromRoomId: orig.roomId || null,
        toRoomId: newRoomId,
        fromStartAt: orig.startAt || null,
        fromEndAt: orig.endAt || null,
        toStartAt: toTs(newStartAt),
        toEndAt: toTs(newEndAt),
        contractId: orig.contractId || null,
        professionalId: orig.professionalId || null
      }
    });
  });

  return newRef.id;
}