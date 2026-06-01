// /public/js/pages/contratos.js (mantém IDs/chaves existentes)
import { requireAuth, bindAuthUI } from "../app.auth.js";
import { addContract } from "../app.db.js";
import { CalendarGrid } from "../ui/calendar-grid.js";

const $ = (sel) => document.querySelector(sel);
const status = (t) => { const el = $('#status'); if (el) el.textContent = t || ''; };

await requireAuth({ redirectTo: './login.html' });
bindAuthUI();

// Inicializa grade de seleção semanal (07:00–21:00, 30min)
const grid = new CalendarGrid('#grid', { start: '07:00', end: '21:00' });

function collectWeekly(){
  // CalendarGrid#getSelections() deve retornar array de {weekday, ranges:[{start,end}]}
  const out = [];
  const rows = grid.getSelections(); // API da grade
  for (const row of rows){
    const wd = row.weekday;
    for (const r of (row.ranges || [])){
      out.push({ weekday: wd, start: r.start, end: r.end });
    }
  }
  return out;
}

// Botão salvar
$('#btnSalvar')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  try {
    status('Publicando...');
    const professionalId = $('#profId')?.value || null;
    const roomId         = $('#roomId')?.value || null;
    const startDate      = $('#startDate')?.value || null;
    const endDate        = $('#endDate')?.value || null;
    const weeklySchedule = collectWeekly();

    if (!professionalId || !roomId || !startDate || !endDate || weeklySchedule.length===0){
      status('Preencha todos os campos e selecione faixas na grade.');
      return;
    }

    await addContract({ professionalId, roomId, startDate, endDate, weeklySchedule });
    status('Contrato salvo. (Expansão em reservas será feita em etapa posterior)');
    // Opcional: limpar form/grade
    // grid.clearSelections();
    // $('#formContrato')?.reset();
  } catch (err) {
    console.error(err);
    status(err?.message || String(err));
  }
});

// Botão de pré-visualização (opcional; sem bloqueio)
$('#btnPreview')?.addEventListener('click', (e)=>{
  e.preventDefault();
  status('Pré-visualização de conflitos será implementada após a estabilização do fluxo principal.');
});
