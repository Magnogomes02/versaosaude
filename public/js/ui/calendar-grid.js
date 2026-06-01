// /public/js/ui/calendar-grid.js (unificado: seleção + pintura de reservas)
// Mantém API antiga (CalendarGrid com getSelections) e expõe initCalendarGrid(items) para pintar reservas.
const WEEKDAYS_PT = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];

function toMinutes(hhmm) { const [h,m] = hhmm.split(':').map(Number); return h*60+m; }
function plusMinutes(hhmm, delta) { const t = toMinutes(hhmm)+delta; const h=Math.floor(t/60), m=t%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
function timesRange(start='07:00', end='21:00', step=30){
  const out=[]; let cur=start;
  while (toMinutes(cur) < toMinutes(end)) { out.push(cur); cur=plusMinutes(cur, step); }
  out.push(end);
  return out;
}
function toDate(v){ if (!v) return null; if (v?.toDate) return v.toDate(); if (v instanceof Date) return v; return new Date(v); }

export class CalendarGrid {
  constructor(containerSelector, opts={}){
    this.el = typeof containerSelector==='string' ? document.querySelector(containerSelector) : containerSelector;
    const d = (v,def)=> (v ?? def);
    this.start = d(opts.start,'07:00');
    this.end   = d(opts.end,  '21:00');
    this.stepMin = d(opts.stepMin, 30);
    this.weekdays = d(opts.weekdays, WEEKDAYS_PT);
    this.state = new Map(); // wd -> Set(hh:mm)
    if (!this.el) throw new Error('CalendarGrid: container não encontrado.');
    this.render();
  }

  render(){
    const hours = timesRange(this.start,this.end,this.stepMin);
    const root = this.el;
    root.innerHTML='';
    // Cabeçalho
    const header = document.createElement('div');
    header.className='grid-header row';
    header.appendChild(document.createElement('div')); // canto
    for (let wd=0; wd<7; wd++){
      const h = document.createElement('div');
      h.className='day'; h.textContent = this.weekdays[wd];
      header.appendChild(h);
    }
    root.appendChild(header);

    // Linhas de horas
    for (let i=0; i<hours.length-1; i++){
      const row = document.createElement('div');
      row.className='row hour';
      const lbl = document.createElement('div');
      lbl.className='time'; lbl.textContent = hours[i];
      row.appendChild(lbl);

      for (let wd=0; wd<7; wd++){
        const slot = document.createElement('button');
        slot.type='button'; slot.className='slot';
        slot.dataset.wd = String(wd);
        slot.dataset.t  = hours[i];
        slot.addEventListener('click', ()=> this.toggle(slot));
        row.appendChild(slot);
      }
      root.appendChild(row);
    }
  }

  toggle(slot){
    const wd = parseInt(slot.dataset.wd,10);
    const t  = slot.dataset.t;
    const set = this.state.get(wd) ?? new Set();
    if (set.has(t)) { set.delete(t); slot.classList.remove('slot--sel'); }
    else            { set.add(t);     slot.classList.add('slot--sel'); }
    this.state.set(wd, set);
  }

  clearSelections(){
    this.state.clear();
    this.el.querySelectorAll('.slot.slot--sel').forEach(btn=>btn.classList.remove('slot--sel'));
  }

  /** Carrega seleções no formato [{weekday, ranges:[{start,end}]}] */
  loadSelections(selections=[]){
    this.clearSelections();
    for (const s of selections){
      const wd = s.weekday;
      for (const r of s.ranges ?? []){
        let cur = r.start;
        while (toMinutes(cur) < toMinutes(r.end)){
          const btn = this.el.querySelector(`.slot[data-wd="${wd}"][data-t="${cur}"]`);
          if (btn) this.toggle(btn);
          cur = plusMinutes(cur, this.stepMin);
        }
      }
    }
  }

  /** Retorna [{weekday, ranges:[{start,end}]}] agrupado */
  getSelections(){
    const out = [];
    for (const [wd, set] of this.state){
      const arr = Array.from(set).sort((a,b)=>toMinutes(a)-toMinutes(b));
      if (arr.length===0) continue;
      const ranges=[];
      let rangeStart = arr[0], prev = arr[0];
      for (let i=1;i<arr.length;i++){
        const expected = plusMinutes(prev, this.stepMin);
        if (arr[i] !== expected){
          ranges.push({ start: rangeStart, end: plusMinutes(prev, this.stepMin) });
          rangeStart = arr[i];
        }
        prev = arr[i];
      }
      ranges.push({ start: rangeStart, end: plusMinutes(prev, this.stepMin) });
      out.push({ weekday: parseInt(wd,10), ranges });
    }
    return out.sort((a,b)=>a.weekday-b.weekday);
  }
}

/** Pinta reservas existentes na grade com classe .slot--sel (visualização) */
export function initCalendarGrid(container, { items=[] } = {}){
  const root = (typeof container==='string') ? document.querySelector(container) : container;
  if (!root) return;
  // Caso a grade ainda não tenha sido renderizada por CalendarGrid, crie slots "virtuais" por hora/weekday:
  if (!root.querySelector('.slot')) {
    const grid = new CalendarGrid(root, {});
    // grid já renderiza slots; seguimos para pintura
  }
  function* slotsInRange(startDate, endDate, stepMin=30){
    const s = toDate(startDate), e = toDate(endDate);
    if (!(s instanceof Date) || isNaN(s) || !(e instanceof Date) || isNaN(e)) return;
    const jsDay = s.getDay();              // 0..6 (Dom..Sáb)
    const weekday = (jsDay === 0) ? 6 : jsDay - 1; // 0=Seg
    const round = (d)=>{ const c=new Date(d); c.setSeconds(0,0); const m=c.getMinutes(); c.setMinutes(m - (m%30)); return c; };
    let cur = round(s);
    while (cur < e){
      const hh = String(cur.getHours()).padStart(2,'0');
      const mm = String(cur.getMinutes()).padStart(2,'0');
      yield { weekday, hhmm: `${hh}:${mm}` };
      cur = new Date(cur.getTime() + stepMin*60000);
    }
  }
  items.forEach(it => {
    const s = toDate(it.start), e = toDate(it.end);
    for (const {weekday, hhmm} of slotsInRange(s,e)){
      const btn = root.querySelector(`.slot[data-wd="${weekday}"][data-t="${hhmm}"]`);
      if (btn) btn.classList.add('slot--sel');
    }
  });
  return true;
}
