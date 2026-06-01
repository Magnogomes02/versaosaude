// /public/js/pages/preferencias.js
import { requireAuth, bindAuthUI } from '../app.auth.js';
import { getSettings, saveSettings } from '../app.db.js';

await requireAuth();  // redireciona para login se não autenticado
bindAuthUI();

const $ = (s) => document.querySelector(s);
const must = (el, sel) => { if (!el) throw new Error(`Elemento não encontrado: ${sel}`); return el; };

// Campos esperados (IDs no HTML) – com tolerância a nomes antigos/novos
const elTZ       = must($('#tz'),          '#tz');                         // <select>
const elExpand   = must($('#expandDays'),  '#expandDays');                 // <input type="number">
const elStart    = must($('#bizStart'),    '#bizStart');                   // <input type="time">
const elEnd      = must($('#bizEnd'),      '#bizEnd');                     // <input type="time">
const elDST      = must($('#dst'),         '#dst');                        // <input type="checkbox">
const elEmail    = must($('#notifEmail') || $('#email'), '#notifEmail');   // <input type="checkbox">
const elTelegram = must($('#notifTelegram') || $('#telegram'), '#notifTelegram'); // <input type="checkbox">
const elStatus   = must($('#status'),      '#status');                     // <span> / <div>
const elBtnSave  = $('#btnSave');
const elBtnExpand= $('#btnExpandWindow') || $('#btnExpand');

function setStatus(t){ elStatus.textContent = t || ''; }

function coalesceSettings(s){
  return {
    timezone: s?.timezone || 'America/Recife',
    dstEnabled: !!s?.dstEnabled,
    bookingWindowDays: Number(s?.bookingWindowDays ?? 60),
    bizStart: s?.bizStart || '07:00',
    bizEnd: s?.bizEnd || '21:00',
    notifications: {
      email: !!s?.notifications?.email,
      telegram: !!s?.notifications?.telegram
    }
  };
}

async function load() {
  try {
    setStatus('Carregando...');
    const s = coalesceSettings(await getSettings());

    elTZ.value      = s.timezone;
    elExpand.value  = s.bookingWindowDays;
    elStart.value   = s.bizStart;
    elEnd.value     = s.bizEnd;
    elDST.checked   = s.dstEnabled;
    elEmail.checked = s.notifications.email;
    elTelegram.checked = s.notifications.telegram;

    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('Falha ao carregar preferências.');
  }
}

async function save() {
  try {
    setStatus('Salvando...');
    const patch = {
      timezone: elTZ.value || 'America/Recife',
      bookingWindowDays: Number(elExpand.value || 60),
      bizStart: elStart.value || '07:00',
      bizEnd: elEnd.value || '21:00',
      dstEnabled: !!elDST.checked,
      notifications: {
        email: !!elEmail.checked,
        telegram: !!elTelegram.checked
      }
    };
    await saveSettings(patch);
    setStatus('Salvo.');
  } catch (err) {
    console.error(err);
    setStatus('Erro ao salvar.');
  }
}

if (elBtnSave)   elBtnSave.addEventListener('click', (e) => { e.preventDefault(); save(); });
if (elBtnExpand) elBtnExpand.addEventListener('click', (e) => { e.preventDefault(); /* implementar depois */ });

await load();
