// /public/js/tools/migrate-contracts-to-bookings.js
// Executa no navegador após login gestor: abre a página e chama window.migrateContractsToBookings()
import { db } from "../app.firebase.js";
import {
  collection, getDocs, addDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

function parseISO(d){ return new Date(d+"T00:00:00"); }
function fmtISO(d){ return d.toISOString().slice(0,10); }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
const WEEKDAYS = { 0:0,1:1,2:2,3:3,4:4,5:5,6:6,"dom":0,"domingo":0,"seg":1,"segunda":1,"ter":2,"terça":2,"qua":3,"quarta":3,"qui":4,"quinta":4,"sex":5,"sexta":5,"sab":6,"sábado":6 };
function toWeekdayIndex(v){ if(typeof v==="number") return v; const k=String(v||"").toLowerCase(); return WEEKDAYS[k] ?? (k==="7"?0:null); }
function hhmmToDate(baseDate, hhmm){ const [h,m]=(hhmm||"00:00").split(":").map(n=>parseInt(n,10)||0); const d=new Date(baseDate); d.setHours(h,m,0,0); return d; }
function toTs(d){ return Timestamp.fromDate(d); }

export async function migrateContractsToBookings({days=60}={}){
  const now = new Date();
  const start = now; // hoje
  const end = addDays(start, days);

  const snap = await getDocs(collection(db, "contracts"));
  const contracts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  let created = 0;

  for (const c of contracts){
    const cStart = parseISO(c.startDate || "1900-01-01");
    const cEnd   = parseISO(c.endDate   || "2999-12-31");
    const rangeStart = cStart>start ? cStart : start;
    const rangeEnd   = cEnd<end ? cEnd : end;

    const weekly = Array.isArray(c.weeklySchedule) ? c.weeklySchedule : [];
    for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)){
      const wd = d.getDay(); // 0-dom..6-sab
      // procura config do dia
      const dayCfg = weekly.find(x => toWeekdayIndex(x.weekday ?? x.day ?? x.dia) === wd);
      if (!dayCfg) continue;
      const ranges = Array.isArray(dayCfg.ranges) ? dayCfg.ranges : [];
      for (const r of ranges){
        const s = hhmmToDate(d, r.start || r.inicio || r.de);
        const e = hhmmToDate(d, r.end   || r.fim    || r.ate);
        if (e <= s) continue;
        await addDoc(collection(db, "bookings"), {
          contractId: c.id,
          professionalId: c.professionalId || null,
          roomId: c.roomId || null,
          startAt: toTs(s),
          endAt: toTs(e),
          status: "scheduled",
          createdAt: serverTimestamp(),
          source: "contract"
        });
        created++;
      }
    }
  }
  return created;
}

// Exponibiliza no window para disparo pelo console
window.migrateContractsToBookings = migrateContractsToBookings;
console.log("Helper carregado. Rode: migrateContractsToBookings({days:60})");
