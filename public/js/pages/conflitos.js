// public/js/pages/conflitos.js
import { requireAuth } from "../app.auth.js";
import { listBookings, detectConflicts } from "../app.db.js";

const weekStartInput = document.getElementById("week-start");
const table = document.getElementById("conflicts-table-body");
const msg = document.getElementById("conflicts-msg");

async function renderConflicts() {
  const from = weekStartInput?.value || new Date().toISOString().slice(0,10);
  const start = new Date(from);
  const end = new Date(start.getTime() + 6*24*60*60*1000);
  const rows = await listBookings({ from: start.toISOString(), to: end.toISOString() });
  const conflicts = detectConflicts(rows);
  if (table) {
    table.innerHTML = conflicts.map(c => {
      const aS = c.a.start?.toDate ? c.a.start.toDate().toLocaleString() : String(c.a.start);
      const aE = c.a.end?.toDate ? c.a.end.toDate().toLocaleString() : String(c.a.end);
      const bS = c.b.start?.toDate ? c.b.start.toDate().toLocaleString() : String(c.b.start);
      const bE = c.b.end?.toDate ? c.b.end.toDate().toLocaleString() : String(c.b.end);
      return `<tr>
        <td>${c.roomId}</td>
        <td>${c.a.professionalId}</td>
        <td>${aS} → ${aE}</td>
        <td>${c.b.professionalId}</td>
        <td>${bS} → ${bE}</td>
      </tr>`;
    }).join("");
  }
}

requireAuth(async () => {
  await renderConflicts();
  weekStartInput?.addEventListener("change", renderConflicts);
});