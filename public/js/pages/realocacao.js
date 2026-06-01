// Página de Realocação (lado cliente) — sem renomear coleções/campos já existentes.
import { requireAuth, bindAuthUI } from "../app.auth.js";
import { listRooms, listProfessionals } from "../app.db.js";
import { getBookingById, findConflicts, reallocateBooking } from "../app.db.realloc.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

await requireAuth({ redirectTo: './login.html' });
bindAuthUI();

const $ = (s) => document.querySelector(s);
const fmt2 = (n) => String(n).padStart(2, "0");
const fmtISO = (d) => d.toISOString().slice(0,10);
const monday = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay(); // 0-dom..6-sab
  const delta = wd === 0 ? -6 : (1 - wd);
  x.setDate(x.getDate() + delta);
  x.setHours(0,0,0,0);
  return x;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const toDateTime = (dateISO, hhmm) => {
  const [h,m] = (hhmm||"00:00").split(":").map(v=>parseInt(v,10)||0);
  const d = new Date(dateISO + "T00:00:00");
  d.setHours(h,m,0,0);
  return d;
};

const els = {
  week: $('#week-start'),
  btnPrev: $('#week-prev'),
  btnNext: $('#week-next'),
  btnToday: $('#week-today'),
  filterRoom: $('#filter-room'),
  filterProf: $('#filter-professional'),
  listMsg: $('#list-msg'),
  tbody: $('#tbody-bookings'),
  status: $('#status'),
  conflicts: $('#conflicts'),
  // selecionada
  selId: $('#sel-id'),
  selContract: $('#sel-contract'),
  selProf: $('#sel-prof'),
  selRoom: $('#sel-room'),
  selStart: $('#sel-start'),
  selEnd: $('#sel-end'),
  // destino
  destRoom: $('#dest-room'),
  destDate: $('#dest-date'),
  destStart: $('#dest-start'),
  destEnd: $('#dest-end'),
  reason: $('#reason'),
  form: $('#form-realloc'),
  btnCheck: $('#btnCheck'),
  btnReallocate: $('#btnReallocate'),
};

let CACHED_ROOMS = [];
let CACHED_PROS  = [];
let CURRENT_WEEK = monday(new Date());
let CURRENT_BOOKINGS = [];

function setStatus(t){ if (els.status) els.status.textContent = t || ''; }
function setListMsg(t){ if (els.listMsg) els.listMsg.textContent = t || ''; }
function setConflicts(html){ if (els.conflicts) els.conflicts.innerHTML = html || ''; }

function nameOf(arr, id){
  const x = arr.find(r => r.id === id);
  return x?.name || x?.nome || id || '';
}

async function loadFilters(){
  CACHED_ROOMS = await listRooms();
  CACHED_PROS  = await listProfessionals();

  els.filterRoom.innerHTML = '<option value="">(todas)</option>' +
    CACHED_ROOMS.map(r => `<option value="${r.id}">${nameOf(CACHED_ROOMS, r.id)}</option>`).join('');

  els.filterProf.innerHTML = '<option value="">(todos)</option>' +
    CACHED_PROS.map(p => `<option value="${p.id}">${nameOf(CACHED_PROS, p.id)}</option>`).join('');

  // selects de destino
  els.destRoom.innerHTML = CACHED_ROOMS.map(r => `<option value="${r.id}">${nameOf(CACHED_ROOMS, r.id)}</option>`).join('');
}

function renderTable(rows){
  if (!rows.length){
    els.tbody.innerHTML = '';
    setListMsg('Sem reservas nesta semana.');
    return;
  }
  setListMsg('');

  els.tbody.innerHTML = rows.map(r => {
    const start = r.startAt?.toDate ? r.startAt.toDate() : new Date(r.startAt);
    const end   = r.endAt?.toDate ? r.endAt.toDate()   : new Date(r.endAt);
    const dISO = fmtISO(start);
    const hhmi = fmt2(start.getHours()) + ':' + fmt2(start.getMinutes());
    const hhme = fmt2(end.getHours())   + ':' + fmt2(end.getMinutes());
    const room = nameOf(CACHED_ROOMS, r.roomId);
    const prof = nameOf(CACHED_PROS, r.professionalId);
    return `
      <tr>
        <td><input type="radio" name="sel" value="${r.id}" /></td>
        <td>${dISO}</td>
        <td>${hhmi}–${hhme}</td>
        <td>${room}</td>
        <td>${prof}</td>
        <td>${r.status || ''}</td>
      </tr>
    `;
  }).join('');

  els.tbody.querySelectorAll('input[type=radio][name=sel]').forEach(rad => {
    rad.addEventListener('change', async (e)=>{
      const id = e.target.value;
      const data = CURRENT_BOOKINGS.find(b => b.id === id) || await getBookingById(id);
      if (!data) return;
      fillSelected(data);
      els.btnReallocate.disabled = false;
    });
  });
}

function fillSelected(b){
  const start = b.startAt?.toDate ? b.startAt.toDate() : new Date(b.startAt);
  const end   = b.endAt?.toDate ? b.endAt.toDate()   : new Date(b.endAt);
  els.selId.value = b.id;
  els.selContract.value = b.contractId || '';
  els.selProf.value = nameOf(CACHED_PROS, b.professionalId) || b.professionalId || '';
  els.selRoom.value = nameOf(CACHED_ROOMS, b.roomId) || b.roomId || '';
  els.selStart.value = fmtISO(start) + ' ' + fmt2(start.getHours()) + ':' + fmt2(start.getMinutes());
  els.selEnd.value   = fmtISO(end)   + ' ' + fmt2(end.getHours())   + ':' + fmt2(end.getMinutes());

  // defaults do destino
  els.destRoom.value  = b.roomId || '';
  els.destDate.value  = fmtISO(start);
  els.destStart.value = fmt2(start.getHours()) + ':' + fmt2(start.getMinutes());
  els.destEnd.value   = fmt2(end.getHours())   + ':' + fmt2(end.getMinutes());
}

async function loadWeek(){
  setStatus('Carregando...');
  setConflicts('');
  els.btnReallocate.disabled = true;

  const from = monday(CURRENT_WEEK);
  const to   = addDays(from, 7);

  // Estratégia simples: consultar por sala e filtrar cliente por janela e profissional.
  const roomFilter = els.filterRoom.value || null;
  const roomsToFetch = roomFilter ? [roomFilter] : CACHED_ROOMS.map(r => r.id);

  const rows = [];
  for (const rid of roomsToFetch){
    const part = await findConflicts(rid, from, to, null); // retorna *todos* que tocam a janela
    for (const b of part){
      const start = b.startAt?.toDate ? b.startAt.toDate() : new Date(b.startAt);
      const end   = b.endAt?.toDate ? b.endAt.toDate()   : new Date(b.endAt);
      if (!(end > from && start < to)) continue; // garante ser desta semana
      if (els.filterProf.value && b.professionalId !== els.filterProf.value) continue;
      rows.push(b);
    }
  }

  // Unifica e ordena
  const map = new Map();
  for (const b of rows) map.set(b.id, b);
  CURRENT_BOOKINGS = Array.from(map.values()).sort((a,b)=>(a.startAt?.seconds||0)-(b.startAt?.seconds||0));

  renderTable(CURRENT_BOOKINGS);
  setStatus('');
}

function baseFromInput(){ return els.week?.value ? new Date(els.week.value) : new Date(); }

// Navegação de semana
(function initWeek(){
  CURRENT_WEEK = monday(new Date());
  if (els.week) els.week.value = fmtISO(CURRENT_WEEK);

  els.btnToday?.addEventListener('click', (e)=>{
    e.preventDefault();
    CURRENT_WEEK = monday(new Date());
    if (els.week) els.week.value = fmtISO(CURRENT_WEEK);
    loadWeek();
  });
  els.btnPrev?.addEventListener('click', (e)=>{
    e.preventDefault();
    CURRENT_WEEK = addDays(baseFromInput(), -7);
    if (els.week) els.week.value = fmtISO(monday(CURRENT_WEEK));
    loadWeek();
  });
  els.btnNext?.addEventListener('click', (e)=>{
    e.preventDefault();
    CURRENT_WEEK = addDays(baseFromInput(), +7);
    if (els.week) els.week.value = fmtISO(monday(CURRENT_WEEK));
    loadWeek();
  });
})();

// Checar conflito para o destino escolhido
els.btnCheck?.addEventListener('click', async ()=>{
  try {
    setStatus('Checando conflitos...');
    setConflicts('');
    const id = els.selId.value;
    if (!id) { setStatus('Selecione uma reserva.'); return; }

    const roomId  = els.destRoom.value;
    const dateISO = els.destDate.value;
    const startAt = toDateTime(dateISO, els.destStart.value);
    const endAt   = toDateTime(dateISO, els.destEnd.value);
    if (!(roomId && dateISO && endAt > startAt)){
      setStatus('Preencha destino válido (sala/data/horário).');
      return;
    }

    const clashes = await findConflicts(roomId, startAt, endAt, id);
    if (clashes.length){
      setStatus('Conflito detectado.');
      const html = '<strong>Conflitos:</strong><ul>' + clashes.slice(0,10).map(c => {
        const s = c.startAt?.toDate ? c.startAt.toDate() : new Date(c.startAt);
        const e = c.endAt?.toDate ? c.endAt.toDate()   : new Date(c.endAt);
        return `<li>${fmtISO(s)} ${fmt2(s.getHours())}:${fmt2(s.getMinutes())}–${fmt2(e.getHours())}:${fmt2(e.getMinutes())} (Sala ${c.roomId})</li>`;
      }).join('') + '</ul>';
      setConflicts(html);
      els.btnReallocate.disabled = true;
    } else {
      setStatus('Sem conflito — pode realocar.');
      setConflicts('');
      els.btnReallocate.disabled = false;
    }
  } catch (err) {
    console.error(err);
    setStatus('Erro ao checar conflitos.');
  }
});

// Realocação transacional
els.form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  try {
    const id = els.selId.value;
    if (!id) { setStatus('Selecione uma reserva.'); return; }

    const roomId  = els.destRoom.value;
    const dateISO = els.destDate.value;
    const startAt = toDateTime(dateISO, els.destStart.value);
    const endAt   = toDateTime(dateISO, els.destEnd.value);
    if (!(roomId && dateISO && endAt > startAt)){
      setStatus('Preencha destino válido (sala/data/horário).');
      return;
    }

    // Checagem rápida final
    const clashes = await findConflicts(roomId, startAt, endAt, id);
    if (clashes.length){
      setStatus('Conflito detectado — ajuste o horário/sala.');
      return;
    }

    const uid = getAuth().currentUser?.uid || null;
    const reason = els.reason.value || null;

    setStatus('Realocando...');
    await reallocateBooking({
      bookingId: id,
      newRoomId: roomId,
      newStartAt: startAt,
      newEndAt: endAt,
      byUserId: uid,
      reason
    });

    setStatus('Realocado com sucesso.');
    await loadWeek(); // atualiza listagem
  } catch (err) {
    console.error(err);
    setStatus(err?.message || 'Erro ao realocar.');
  }
});

// Bootstrap
(async function init(){
  await loadFilters();
  await loadWeek();
})();