// /public/js/pages/calendario.js (com fallback a partir de contracts)
// Mantém IDs/classes existentes e comportamento atual.
// Correção: no fallback, usa o índice do weeklySchedule como weekday quando não houver campo weekday/day/dia.

import { requireAuth, bindAuthUI } from "../app.auth.js";
import { listBookings, listRooms, listProfessionals } from "../app.db.js";
import { initCalendarGrid } from "../ui/calendar-grid.js";
import { listContractsForRange } from "../app.db.fallback.js"; // util de fallback

await requireAuth({ redirectTo: './login.html' });
bindAuthUI();

const els = {
  container: document.getElementById("calendar-grid")       || document.getElementById("grid"),
  msg:       document.getElementById("calendar-msg")        || document.getElementById("status"),
  room:      document.getElementById("filter-room")         || document.getElementById("roomSel"),
  prof:      document.getElementById("filter-professional") || document.getElementById("professionalSel"),
  week:      document.getElementById("week-start")          || document.getElementById("weekStart"),
  btnPrev:   document.getElementById("week-prev")           || document.getElementById("btnPrev"),
  btnNext:   document.getElementById("week-next")           || document.getElementById("btnNext"),
  btnToday:  document.getElementById("week-today")          || document.getElementById("btnToday"),
};

function setMsg(t){ if (els.msg) els.msg.textContent = t || ''; }

// ---------- Utils ----------
const fmtISO = (d) => d.toISOString().slice(0,10);
const monday = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay();                 // 0=Dom..6=Sáb
  const delta = (wd === 0) ? -6 : (1 - wd); // força segunda-feira
  x.setDate(x.getDate() + delta);
  x.setHours(0,0,0,0);
  return x;
};
const addDays = (d, n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };

const WEEKDAYS = {
  0:0,1:1,2:2,3:3,4:4,5:5,6:6,
  "dom":0,"domingo":0,"sun":0,"sunday":0,
  "seg":1,"segunda":1,"mon":1,"monday":1,
  "ter":2,"terça":2,"tue":2,"tuesday":2,
  "qua":3,"quarta":3,"wed":3,"wednesday":3,
  "qui":4,"quinta":4,"thu":4,"thursday":4,
  "sex":5,"sexta":5,"fri":5,"friday":5,
  "sab":6,"sáb":6,"sábado":6,"sat":6,"saturday":6
};

function toWeekdayIndex(v){
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return (v>=0 && v<=6) ? v : null;
  const key = String(v).toLowerCase();
  if (key in WEEKDAYS) return WEEKDAYS[key];
  // números como '1'..'7' (seg=1..dom=7) comuns em planilhas
  const n = parseInt(key,10);
  if (!isNaN(n)) return (n===7) ? 0 : (n>=1 && n<=6 ? n : null);
  return null;
}

function hhmmToDate(baseDate, hhmm){
  const [h,m] = (hhmm||"00:00").split(":").map(x=>parseInt(x,10));
  const d = new Date(baseDate);
  d.setHours(h||0, m||0, 0, 0);
  return d;
}

function within(dateISO, startISO, endISO){
  return !(endISO < dateISO || startISO > dateISO);
}

const baseFromInput = () => (els.week?.value ? new Date(els.week.value) : new Date());

// ---------- Filtros ----------
async function loadFilters(){
  try {
    if (els.room) {
      const rooms = await listRooms();
      els.room.innerHTML = '<option value="">(todas)</option>'
        + rooms.map(r => `<option value="${r.id}">${r.name||r.id}</option>`).join('');
    }
    if (els.prof) {
      const pros = await listProfessionals();
      els.prof.innerHTML = '<option value="">(todos)</option>'
        + pros.map(p => `<option value="${p.id}">${p.name||p.id}</option>`).join('');
    }
  } catch (e) {
    console.error(e);
  }
}

// ---------- Carga + Render ----------
async function loadAndRender(baseDate){
  const start = monday(baseDate || new Date());
  const end   = addDays(start, 7);
  const startISO = fmtISO(start);
  const endISO   = fmtISO(addDays(end,-1)); // última data inclusiva

  const roomId = els.room?.value || null;
  const professionalId = els.prof?.value || null;

  setMsg("Carregando...");
  try{
    // 1) Tenta via bookings (fonte oficial)
    let rows = await listBookings({ roomId, professionalId, from: start, to: end });
    let items = rows.map(r => ({
      start: (r.startAt && r.startAt.toDate) ? r.startAt.toDate() : (r.startAt ? new Date(r.startAt) : null),
      end:   (r.endAt && r.endAt.toDate) ? r.endAt.toDate() : (r.endAt ? new Date(r.endAt) : null)
    })).filter(x => x.start && x.end);

    // 2) Fallback: se não há bookings, computa a partir de contracts
    if (!items.length){
      const contracts = await listContractsForRange(startISO, endISO);
      const paint = [];
      for (const c of contracts){
        const cStartISO = c.startDate || "0000-01-01";
        const cEndISO   = c.endDate || "9999-12-31";

        const weekly = Array.isArray(c.weeklySchedule) ? c.weeklySchedule : [];
        // CORREÇÃO: se não houver weekday, usa o índice do array (0=Seg..6=Dom)
        weekly.forEach((dayCfg, idx) => {
          const wd = toWeekdayIndex(dayCfg.weekday ?? dayCfg.day ?? dayCfg.dia ?? idx);
          if (wd === null) return;

          const dateOfWeek = addDays(start, wd); // segunda + wd
          const dateISO = fmtISO(dateOfWeek);
          if (!within(dateISO, cStartISO, cEndISO)) return;

          const ranges = Array.isArray(dayCfg.ranges) ? dayCfg.ranges : [];
          for (const r of ranges){
            const s = hhmmToDate(dateOfWeek, r.start || r.inicio || r.de);
            const e = hhmmToDate(dateOfWeek, r.end   || r.fim    || r.ate);
            if (e > s) paint.push({
              start: s, end: e,
              roomId: c.roomId || null,
              professionalId: c.professionalId || null,
              title: c.title || "Contrato"
            });
          }
        });
      }
      items = paint;
    }

    // Pinta na grid semanal existente
    initCalendarGrid(els.container || "#calendar-grid", { items });
    setMsg(items.length ? '' : 'Sem reservas na semana selecionada.');
  } catch (e) {
    console.error(e);
    setMsg('Erro ao carregar calendário.');
  }
}

// ---------- Bootstrap ----------
(async function init(){
  await loadFilters();

  // default = segunda-feira da semana atual
  if (els.week) els.week.value = fmtISO(monday(new Date()));
  loadAndRender(baseFromInput());

  // Listeners
  els.room?.addEventListener("change", ()=> loadAndRender(baseFromInput()));
  els.prof?.addEventListener("change", ()=> loadAndRender(baseFromInput()));

  els.btnToday?.addEventListener("click", (e)=>{
    e.preventDefault();
    const today = new Date();
    if (els.week) els.week.value = fmtISO(monday(today));
    loadAndRender(today);
  });

  els.btnPrev?.addEventListener("click", (e)=>{
    e.preventDefault();
    const cur = baseFromInput();
    const prev = addDays(cur, -7);
    if (els.week) els.week.value = fmtISO(monday(prev));
    loadAndRender(prev);
  });

  els.btnNext?.addEventListener("click", (e)=>{
    e.preventDefault();
    const cur = baseFromInput();
    const next = addDays(cur, +7);
    if (els.week) els.week.value = fmtISO(monday(next));
    loadAndRender(next);
  });
})();