// PATCH ADD-ON: fallback de calendário a partir de contracts
// Acrescenta utilitário sem renomear nada existente.

import { db } from "./app.firebase.js";
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Retorna todos os contratos e filtra por interseção de datas (ISO yyyy-mm-dd)
export async function listContractsForRange(fromISO, toISO) {
  const snap = await getDocs(collection(db, "contracts"));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const from = fromISO;
  const to = toISO;
  // Mantemos contratos ativos com interseção no período consultado
  return rows.filter(c => {
    const s = c.startDate || "0000-01-01";
    const e = c.endDate || "9999-12-31";
    if (c.status && c.status !== "active") return false;
    return !(e < from || s > to);
  });
}
