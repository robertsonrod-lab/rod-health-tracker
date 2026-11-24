'use strict';
/* Health Tracker — offline PWA. All data lives in localStorage on this device. */
const KEY = 'healthTracker.v1';
const THEME_KEY = 'healthTracker.theme';
const TZ = 'Australia/Melbourne';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KJ = 4.184;
const ACTIVITY = {
  sedentary: ['Sedentary (desk, little exercise)', 1.2],
  light: ['Light (1–3 days a week)', 1.375],
  moderate: ['Moderate (3–5 days a week)', 1.55],
  very: ['Very active (6–7 days a week)', 1.725],
  extra: ['Extra active (physical job + training)', 1.9],
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const r2 = n => Math.round(n * 100) / 100;
const kg = n => (Math.round(n * 100) / 100).toString();
const signed = n => (n > 0.0001 ? '+' : n < -0.0001 ? '−' : '±') + Math.abs(n).toFixed(2);
const fmtN = n => Math.round(n).toLocaleString('en-AU');

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d, wd: DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}
function fmtDate(iso, withYear) {
  if (!iso) return '';
  const p = dParts(iso);
  return `${p.wd} ${p.d} ${MONTHS[p.m - 1]}${withYear || p.y !== Number(todayISO().slice(0, 4)) ? ' ' + p.y : ''}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const t = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/* ---------- State ---------- */
function emptyState() {
  return {
    version: 1,
    settings: { goal: null, height: null, age: null, sex: 'male', activity: 'light', calMin: 1900, calMax: 2100, protein: 150, bandLow: null, bandHigh: null },
    weights: [], food: [], dayNotes: {}, peptides: [], doses: [], schedule: [], health: [], profile: [],
  };
}
function normalise(s) {
  const base = emptyState();
  const out = Object.assign(base, s || {});
  out.settings = Object.assign(emptyState().settings, (s && s.settings) || {});
  for (const k of ['weights', 'food', 'peptides', 'doses', 'schedule', 'health', 'profile']) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.dayNotes || typeof out.dayNotes !== 'object') out.dayNotes = {};
  for (const k of ['weights', 'food', 'peptides', 'doses', 'health', 'profile']) out[k].forEach(x => { if (!x.id) x.id = uid(); });
  return out;
}
let S;
try { S = normalise(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { S = emptyState(); }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
  catch (e) { toast('Could not save: phone storage is full. Remove some meal photos or export and erase.'); return false; }
}
const isEmpty = () => !S.weights.length && !S.food.length && !S.doses.length && !S.health.length && !S.peptides.length;
const sortedWeights = () => S.weights.slice().sort((a, b) => a.date.localeCompare(b.date));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
function metric(v, l, d, tone) {
  return `<div class="metric ${tone || ''}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div>${d ? `<div class="d">${esc(d)}</div>` : ''}</div>`;
}

/* ---------- Theme ---------- */
function applyTheme() {
  const t = localStorage.getItem(THEME_KEY);
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
$('#themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  localStorage.setItem(THEME_KEY, cur === 'dark' ? 'light' : 'dark'); applyTheme(); renderAll();
});
applyTheme();

/* ---------- Tabs ---------- */
function showTab(name) {
  $$('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  window.scrollTo(0, 0);
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

/* ---------- Banner ---------- */
function renderBanner() {
  $('#banner').innerHTML = isEmpty()
    ? `<div class="card callout"><b>No data yet.</b> If Health Bot sent you a data file, tap <b>Import data</b> to load your history. Or just start adding entries.<div class="row" style="margin-top:8px"><button class="btn primary" type="button" data-import>Import data</button></div></div>`
    : '';
}
document.addEventListener('click', e => { if (e.target.closest('[data-import]')) $('#importFile').click(); });

/* ========== WEIGHT ========== */
let wRange = '14';
let wEditId = null;
function weightSummary(ws, entry) {
  // Deltas for a just-saved entry.
  const i = ws.findIndex(w => w.id === entry.id);
  const prev = i > 0 ? ws[i - 1] : null;
  const mondays = ws.filter(w => dParts(w.date).wd === 'Mon' && w.date < entry.date);
  const lastMon = mondays[mondays.length - 1];
  const priorMin = Math.min(...ws.filter(w => w.id !== entry.id).map(w => w.kg));
  const parts = [`Saved ${kg(entry.kg)} kg for ${fmtDate(entry.date)}.`];
  if (prev) parts.push(`${signed(entry.kg - prev.kg)} kg vs ${fmtDate(prev.date)} (${kg(prev.kg)}).`);
  if (lastMon) parts.push(`${signed(entry.kg - lastMon.kg)} kg vs last Monday (${fmtDate(lastMon.date)}).`);
  const g = S.settings.goal;
  if (g) parts.push(entry.kg > g ? `${kg(entry.kg - g)} kg to ${g}.` : `At or below your ${g} kg goal!`);
  if (Number.isFinite(priorMin) && entry.kg < priorMin) parts.push('🎉 New low!');
  return parts.join(' ');
}
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN; }

function renderWeight() {
  const ws = sortedWeights();
  const g = S.settings.goal;
  const m = $('#wMetrics');
  if (!ws.length) {
    m.innerHTML = metric('—', 'Latest', 'Add your first weight below') + metric(g ? g + ' kg' : '—', 'Goal');
    $('#wChart').innerHTML = '<p class="hint">Your chart appears after the first reading.</p>';
    $('#wTrend').innerHTML = '<h2>Trend</h2><p class="hint">Not enough readings yet.</p>';
    $('#wMondays').innerHTML = '<p class="hint">No Monday readings yet.</p>';
    $('#wTable').innerHTML = '<p class="hint">No readings yet.</p>';
    return;
  }
  const latest = ws[ws.length - 1], first = ws[0];
  const low = ws.reduce((a, b) => (b.kg < a.kg ? b : a));
  const peak = ws.reduce((a, b) => (b.kg > a.kg ? b : a));
  const lost = first.kg - latest.kg;
  m.innerHTML =
    metric(kg(latest.kg) + ' kg', 'Latest', fmtDate(latest.date)) +
    metric(g ? (latest.kg > g ? kg(latest.kg - g) + ' kg' : 'Reached!') : 'Set goal', g ? `To goal (${g} kg)` : 'Goal (More tab)', '', g && latest.kg <= g ? 'good' : '') +
    metric(kg(low.kg) + ' kg', 'Lowest', fmtDate(low.date), 'good') +
    metric((lost >= 0 ? '' : '+') + kg(Math.abs(lost)) + ' kg', lost >= 0 ? 'Total lost' : 'Total gained', `From ${kg(first.kg)} on ${fmtDate(first.date)}`, lost > 0 ? 'good' : lost < 0 ? 'warn' : '');

  // Chart
  let pts = ws;
  if (wRange !== 'all') { const cut = addDays(latest.date, -Number(wRange) + 1); pts = ws.filter(w => w.date >= cut); }
  $('#wChart').innerHTML = weightChart(pts, low);

  // Trend
  const last7 = ws.filter(w => w.date > addDays(latest.date, -7)).map(w => w.kg);
  const prev7 = ws.filter(w => w.date <= addDays(latest.date, -7) && w.date > addDays(latest.date, -14)).map(w => w.kg);
  const a1 = avg(last7), a0 = avg(prev7);
  const prev = ws.length > 1 ? ws[ws.length - 2] : null;
  const mons = ws.filter(w => dParts(w.date).wd === 'Mon');
  const lines = [];
  if (prev) lines.push(`Since the previous reading (${fmtDate(prev.date)}): <b class="${latest.kg < prev.kg ? 'down' : latest.kg > prev.kg ? 'up' : ''}">${signed(latest.kg - prev.kg)} kg</b>.`);
  if (Number.isFinite(a1)) lines.push(`7-day average (${fmtDate(addDays(latest.date, -6))}–${fmtDate(latest.date)}): <b>${a1.toFixed(2)} kg</b>${Number.isFinite(a0) ? `, <span class="${a1 < a0 ? 'down' : 'up'}">${signed(a1 - a0)}</span> vs ${a0.toFixed(2)} the week before` : ''}.`);
  if (mons.length >= 2) { const a = mons[mons.length - 2], b = mons[mons.length - 1]; lines.push(`Monday to Monday (${fmtDate(a.date)} → ${fmtDate(b.date)}): <b class="${b.kg < a.kg ? 'down' : 'up'}">${signed(b.kg - a.kg)} kg</b>.`); }
  if (peak.kg > latest.kg) lines.push(`You're ${kg(peak.kg - latest.kg)} kg below the ${kg(peak.kg)} peak (${fmtDate(peak.date)}).`);
  $('#wTrend').innerHTML = `<h2>Trend</h2>${lines.map(l => `<p style="margin:4px 0">${l}</p>`).join('')}`;

  // Mondays
  $('#wMondays').innerHTML = mons.length ? `<table><tr><th>Monday</th><th class="n">kg</th><th class="n">Change</th></tr>${mons.map((w, i) => {
    const ch = i ? w.kg - mons[i - 1].kg : null;
    return `<tr><td>${fmtDate(w.date)}</td><td class="n">${kg(w.kg)}</td><td class="n ${ch === null ? '' : ch < 0 ? 'down' : ch > 0 ? 'up' : ''}">${ch === null ? 'Start' : signed(ch)}</td></tr>`;
  }).reverse().join('')}</table>` : '<p class="hint">No Monday readings yet.</p>';

  // All readings
  $('#wTable').innerHTML = `<table><tr><th>Date</th><th class="n">kg</th><th class="n">Change</th><th></th></tr>${ws.map((w, i) => {
    const ch = i ? w.kg - ws[i - 1].kg : null;
    const isLow = w.id === low.id;
    return `<tr><td>${fmtDate(w.date)}</td><td class="n ${isLow ? 'low' : ''}">${kg(w.kg)}${isLow ? ' (low)' : ''}</td><td class="n ${ch === null ? '' : ch < 0 ? 'down' : ch > 0 ? 'up' : ''}">${ch === null ? 'Start' : signed(ch)}</td>
      <td class="n"><button class="btn sm" data-wedit="${w.id}">Edit</button> <button class="btn sm danger" data-wdel="${w.id}">✕</button></td></tr>`;
  }).reverse().join('')}</table>`;
}

function weightChart(pts, low) {
  const g = S.settings.goal, bl = num(S.settings.bandLow), bh = num(S.settings.bandHigh);
  const vals = pts.map(p => p.kg);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (g) { lo = Math.min(lo, g); hi = Math.max(hi, g); }
  if (Number.isFinite(bl) && Number.isFinite(bh) && wRange === 'all') lo = Math.min(lo, bl);
  lo = Math.floor((lo - 0.4) * 2) / 2; hi = Math.ceil((hi + 0.4) * 2) / 2;
  const W = 360, H = 230, L = 34, R = 10, T = 12, B = 54;
  const n = pts.length;
  const x = i => n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1);
  const y = v => T + ((hi - v) * (H - T - B)) / (hi - lo);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight chart">`;
  // grid
  const step = hi - lo > 4 ? 1 : 0.5;
  for (let v = lo; v <= hi + 1e-9; v += step) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--border)" stroke-width="1"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  if (Number.isFinite(bl) && Number.isFinite(bh) && bh > lo) {
    const top = y(Math.min(bh, hi)), bot = y(Math.max(bl, lo));
    if (bot > top) s += `<rect x="${L}" y="${top}" width="${W - L - R}" height="${bot - top}" style="fill:var(--band)" opacity=".25"/>`;
  }
  if (g) s += `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" style="stroke:var(--goal)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - R}" y="${y(g) - 4}" text-anchor="end" style="fill:var(--goal)">Goal ${g}</text>`;
  s += `<polyline fill="none" style="stroke:var(--accent)" stroke-width="2" stroke-linejoin="round" points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ')}"/>`;
  const labelEvery = Math.max(1, Math.ceil(n / 12));
  pts.forEach((p, i) => {
    const isLow = low && p.id === low.id;
    s += `<circle cx="${x(i)}" cy="${y(p.kg)}" r="${isLow ? 4.5 : 3}" style="fill:${isLow ? 'var(--good)' : 'var(--accent)'}"><title>${fmtDate(p.date)}: ${kg(p.kg)} kg</title></circle>`;
    if (n <= 16) s += `<text x="${x(i)}" y="${y(p.kg) - 7}" text-anchor="middle" style="fill:var(--text)" font-size="9">${kg(p.kg)}</text>`;
    if (i % labelEvery === 0 || i === n - 1) {
      const dp = dParts(p.date);
      s += `<text transform="translate(${x(i)},${H - B + 10}) rotate(-50)" text-anchor="end" font-size="9">${dp.wd} ${dp.d} ${MONTHS[dp.m - 1]}</text>`;
    }
  });
  return s + '</svg>';
}

$('#wRange').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  wRange = b.dataset.r; $$('#wRange button').forEach(x => x.classList.toggle('on', x === b)); renderWeight();
});
function resetWeightForm() {
  wEditId = null; const f = $('#wForm'); f.reset(); f.date.value = todayISO();
  $('#wFormTitle').textContent = 'Add weight'; $('[data-cancel]', f).hidden = true;
}
$('#wForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, date = f.date.value, v = num(f.kg.value);
  if (!date || !Number.isFinite(v)) return;
  let entry;
  if (wEditId) {
    entry = S.weights.find(w => w.id === wEditId);
    S.weights = S.weights.filter(w => w.id === wEditId || w.date !== date); // a moved entry replaces that day
    entry.date = date; entry.kg = r2(v);
  } else {
    entry = S.weights.find(w => w.date === date);
    if (entry) entry.kg = r2(v); else { entry = { id: uid(), date, kg: r2(v) }; S.weights.push(entry); }
  }
  if (!save()) return;
  const msg = weightSummary(sortedWeights(), entry);
  resetWeightForm(); renderAll();
  $('#wResult').textContent = msg; toast('Weight saved');
});
$('#wForm [data-cancel]').addEventListener('click', resetWeightForm);
$('#wTable').addEventListener('click', e => {
  const ed = e.target.closest('[data-wedit]'), del = e.target.closest('[data-wdel]');
  if (ed) {
    const w = S.weights.find(x => x.id === ed.dataset.wedit); if (!w) return;
    wEditId = w.id; const f = $('#wForm'); f.date.value = w.date; f.kg.value = w.kg;
    $('#wFormTitle').textContent = 'Edit weight'; $('[data-cancel]', f).hidden = false; f.scrollIntoView({ behavior: 'smooth' });
  }
  if (del) {
    const w = S.weights.find(x => x.id === del.dataset.wdel);
    if (w && confirm(`Delete ${kg(w.kg)} kg on ${fmtDate(w.date)}?`)) { S.weights = S.weights.filter(x => x !== w); save(); renderAll(); }
  }
});

/* ========== FOOD ========== */
let fEditId = null, fPhotoData = null, fPhotoFile = null;
function dayFood(date) { return S.food.filter(f => f.date === date); }
function dayTotals(date) {
  const items = dayFood(date);
  const withCal = items.filter(i => Number.isFinite(i.cal));
  const note = S.dayNotes[date];
  let cal = withCal.reduce((a, i) => a + i.cal, 0);
  let est = withCal.some(i => i.source !== 'label');
  let fromNote = false;
  if (!withCal.length && note && Number.isFinite(note.totalCal)) { cal = note.totalCal; est = note.source !== 'label'; fromNote = true; }
  const protItems = items.filter(i => Number.isFinite(i.protein));
  return { items, cal, est, fromNote, hasCal: withCal.length > 0 || fromNote, protein: protItems.reduce((a, i) => a + i.protein, 0), hasProtein: protItems.length > 0 };
}
function foodDates() {
  const set = new Set(S.food.map(f => f.date).concat(Object.keys(S.dayNotes)));
  return Array.from(set).sort().reverse();
}
function renderFood() {
  const dayEl = $('#fDay'); if (!dayEl.value) dayEl.value = todayISO();
  const date = dayEl.value, t = dayTotals(date), st = S.settings;
  const lo = num(st.calMin), hi = num(st.calMax), pt = num(st.protein);
  let left = '—';
  if (t.hasCal && Number.isFinite(lo) && Number.isFinite(hi)) {
    const a = lo - t.cal, b = hi - t.cal;
    left = b < 0 ? `${fmtN(-b)} over` : a <= 0 ? `0–${fmtN(b)}` : `${fmtN(a)}–${fmtN(b)}`;
  }
  $('#fMetrics').innerHTML =
    metric(t.hasCal ? fmtN(t.cal) + ' cal' : 'None yet', t.est ? 'Day total (includes estimates)' : 'Day total', t.hasCal ? fmtN(t.cal * KJ) + ' kJ' : '') +
    metric(left, `Left to ${fmtN(lo)}–${fmtN(hi)} cal`, Number.isFinite(lo) ? `${fmtN(lo * KJ)}–${fmtN(hi * KJ)} kJ` : '', left.includes('over') ? 'warn' : '') +
    metric(t.hasProtein ? Math.round(t.protein) + ' g' : '—', `Protein vs ${Number.isFinite(pt) ? pt : '?'} g`, t.hasProtein && Number.isFinite(pt) ? (pt - t.protein > 0 ? `${Math.round(pt - t.protein)} g to go` : 'Target hit') : '', t.hasProtein && t.protein >= pt ? 'good' : '');
  $('#fList').innerHTML = t.items.length ? t.items.map(i => `
    <div class="item">${i.photo ? `<img class="thumb" src="${i.photo}" alt="Meal photo">` : ''}
      <div class="grow"><div><b>${esc(i.item)}</b></div>
        <div class="sub">${Number.isFinite(i.cal) ? `${fmtN(i.cal)} cal · ${fmtN(i.cal * KJ)} kJ` : 'cal not recorded'}${Number.isFinite(i.protein) ? ` · ${i.protein} g protein` : ''}
          ${i.source === 'label' ? '<span class="tag">label</span>' : i.source === 'estimate' ? '<span class="tag est">estimate</span>' : '<span class="tag">not recorded</span>'}</div>
        <div class="row" style="margin-top:4px"><button class="btn sm" data-fedit="${i.id}">Edit</button>${i.photo ? `<button class="btn sm" data-fshare="${i.id}">Send photo to Health Bot</button>` : ''}<button class="btn sm danger" data-fdel="${i.id}">Delete</button></div>
      </div></div>`).join('') : '<p class="hint">Nothing logged for this day.</p>';
  const note = S.dayNotes[date];
  $('#fNote').textContent = note && note.note ? note.note : '';
  const dates = foodDates().slice(0, 21);
  $('#fDays').innerHTML = dates.length ? `<table><tr><th>Day</th><th class="n">cal</th><th class="n">kJ</th><th class="n">Protein</th></tr>${dates.map(d => {
    const x = dayTotals(d);
    return `<tr data-fday="${d}" style="cursor:pointer"><td>${fmtDate(d)}</td><td class="n">${x.hasCal ? fmtN(x.cal) + (x.est ? '*' : '') : '—'}</td><td class="n">${x.hasCal ? fmtN(x.cal * KJ) : '—'}</td><td class="n">${x.hasProtein ? Math.round(x.protein) + ' g' : '—'}</td></tr>`;
  }).join('')}</table><p class="hint">* includes estimates. Tap a day to open it.</p>` : '<p class="hint">No food logged yet.</p>';
}
$('#fDay').addEventListener('change', () => { $('#fForm').date.value = $('#fDay').value; renderFood(); });
$('#fDays').addEventListener('click', e => { const r = e.target.closest('[data-fday]'); if (r) { $('#fDay').value = r.dataset.fday; $('#fForm').date.value = r.dataset.fday; renderFood(); window.scrollTo(0, 0); } });
// cal <-> kJ helper
$('#fForm').cal.addEventListener('input', e => { const v = num(e.target.value); $('#fForm').kj.value = Number.isFinite(v) ? Math.round(v * KJ) : ''; });
$('#fForm').kj.addEventListener('input', e => { const v = num(e.target.value); $('#fForm').cal.value = Number.isFinite(v) ? Math.round(v / KJ) : ''; });

function compressImage(file, max = 480, q = 0.6) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}
function setPhoto(data, file) {
  fPhotoData = data; fPhotoFile = file || null;
  const th = $('#fThumb'); th.hidden = !data; if (data) th.src = data;
  $('#fPhotoClear').hidden = !data; $('#fPhotoHint').hidden = !data;
  $('#fShareBtn').hidden = !data;
  $('#fPhotoBtn').textContent = data ? '📷 Change photo' : '📷 Add meal photo';
}
$('#fPhotoBtn').addEventListener('click', () => $('#fPhoto').click());
$('#fPhoto').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  try {
    setPhoto(await compressImage(file), file);
    const f = $('#fForm'); if (!f.item.value) f.item.value = 'Meal (photo)';
    f.source.value = 'estimate';
    toast('Photo added. Type the calories, or send it to Health Bot for an estimate.');
  } catch (err) { toast(err.message); }
  e.target.value = '';
});
$('#fPhotoClear').addEventListener('click', () => setPhoto(null));
function dataURLtoFile(d, name) {
  const [h, b] = d.split(','); const mime = h.match(/:(.*?);/)[1]; const bin = atob(b);
  const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}
async function sharePhoto(file, label) {
  const text = `Health Bot, please estimate the calories and protein for this meal${label ? ' (' + label + ')' : ''}.`;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  toast('Sharing isn\'t available here. Save the photo and send it to Health Bot in chat.');
}
$('#fShareBtn').addEventListener('click', () => {
  if (!fPhotoData) return;
  sharePhoto(fPhotoFile || dataURLtoFile(fPhotoData, 'meal.jpg'), $('#fForm').item.value);
});
function resetFoodForm() {
  fEditId = null; const f = $('#fForm'); f.reset(); f.date.value = $('#fDay').value || todayISO(); f.source.value = 'label';
  setPhoto(null); $('#fFormTitle').textContent = 'Add food'; $('[data-cancel]', f).hidden = true;
}
$('#fForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const cal = num(f.cal.value), protein = num(f.protein.value);
  const rec = { date: f.date.value, item: f.item.value.trim(), cal: Number.isFinite(cal) ? Math.round(cal) : null, protein: Number.isFinite(protein) ? r2(protein) : null, source: f.source.value, photo: fPhotoData || null };
  if (!rec.item || !rec.date) return;
  if (rec.cal === null) rec.source = rec.source === 'label' ? 'not recorded' : rec.source;
  if (fEditId) Object.assign(S.food.find(x => x.id === fEditId), rec); else S.food.push(Object.assign({ id: uid() }, rec));
  if (!save()) return;
  $('#fDay').value = rec.date;
  const t = dayTotals(rec.date);
  resetFoodForm(); renderAll();
  toast(`Saved. ${t.hasCal ? 'Day total ' + fmtN(t.cal) + ' cal (' + fmtN(t.cal * KJ) + ' kJ).' : ''}`);
});
$('#fForm [data-cancel]').addEventListener('click', resetFoodForm);
$('#fList').addEventListener('click', e => {
  const ed = e.target.closest('[data-fedit]'), del = e.target.closest('[data-fdel]'), sh = e.target.closest('[data-fshare]');
  if (ed) {
    const i = S.food.find(x => x.id === ed.dataset.fedit); if (!i) return;
    fEditId = i.id; const f = $('#fForm');
    f.item.value = i.item; f.cal.value = Number.isFinite(i.cal) ? i.cal : ''; f.kj.value = Number.isFinite(i.cal) ? Math.round(i.cal * KJ) : '';
    f.protein.value = Number.isFinite(i.protein) ? i.protein : ''; f.source.value = i.source === 'label' ? 'label' : 'estimate'; f.date.value = i.date;
    setPhoto(i.photo || null); $('#fFormTitle').textContent = 'Edit food'; $('[data-cancel]', f).hidden = false; f.scrollIntoView({ behavior: 'smooth' });
  }
  if (del) { const i = S.food.find(x => x.id === del.dataset.fdel); if (i && confirm(`Delete "${i.item}"?`)) { S.food = S.food.filter(x => x !== i); save(); renderAll(); } }
  if (sh) { const i = S.food.find(x => x.id === sh.dataset.fshare); if (i && i.photo) sharePhoto(dataURLtoFile(i.photo, 'meal.jpg'), i.item); }
});

/* ========== DEFICIT ========== */
function weightOn(iso) {
  const ws = sortedWeights().filter(w => w.date <= iso);
  return ws.length ? ws[ws.length - 1].kg : (sortedWeights()[0] || {}).kg;
}
function renderDeficit() {
  const f = $('#dForm'), st = S.settings;
  if (!f.act.options.length) f.act.innerHTML = Object.entries(ACTIVITY).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('');
  if (!f.dataset.init) {
    const ws = sortedWeights();
    f.wt.value = ws.length ? ws[ws.length - 1].kg : '';
    f.ht.value = st.height ?? ''; f.age.value = st.age ?? ''; f.sex.value = st.sex || 'male'; f.act.value = st.activity || 'light';
    f.goal.value = st.goal ?? '';
    const t = dayTotals(todayISO());
    f.intake.value = t.hasCal ? Math.round(t.cal) : (Number.isFinite(num(st.calMin)) ? Math.round((num(st.calMin) + num(st.calMax)) / 2) : 2000);
    f.dataset.init = '1';
  }
  const W = num(f.wt.value), H = num(f.ht.value), A = num(f.age.value), I = num(f.intake.value), G = num(f.goal.value);
  const factor = ACTIVITY[f.act.value][1];
  const ready = Number.isFinite(W) && Number.isFinite(H) && Number.isFinite(A) && A >= 15 && A <= 100 && Number.isFinite(I);
  const bmrFor = w => 10 * w + 6.25 * H - 5 * A + (f.sex.value === 'male' ? 5 : -161);
  if (!ready) {
    $('#dOut').innerHTML = `<div class="callout warn">${!Number.isFinite(A) ? 'Enter your age' : 'Fill in weight, height, age (15–100) and intake'} to see BMR, TDEE, deficit and the projected date.</div>`;
    $('#dDays').innerHTML = '<p class="hint">Needs the inputs above.</p>';
    return;
  }
  const bmr = bmrFor(W), tdee = bmr * factor, def = tdee - I, perWk = def * 7 / 7700;
  let goalTxt = 'Not on track', tone = 'warn';
  if (Number.isFinite(G) && W <= G) { goalTxt = 'Already there'; tone = 'good'; }
  else if (Number.isFinite(G) && def > 0) {
    const days = Math.ceil((W - G) * 7700 / def);
    goalTxt = fmtDate(addDays(todayISO(), days), true); tone = 'good';
  } else if (!Number.isFinite(G)) goalTxt = 'Set a goal';
  $('#dOut').innerHTML = `<div class="metrics">
    ${metric(fmtN(bmr) + ' cal', 'BMR (Mifflin-St Jeor)', fmtN(bmr * KJ) + ' kJ')}
    ${metric(fmtN(tdee) + ' cal', 'TDEE', fmtN(tdee * KJ) + ' kJ')}
    ${metric(fmtN(def) + ' cal', 'Daily deficit', fmtN(def * KJ) + ' kJ', def > 0 ? 'good' : 'warn')}
    ${metric(fmtN(def * 7) + ' cal', 'Weekly deficit')}
    ${metric(perWk.toFixed(2) + ' kg', 'Projected per week', '7,700 cal per kg')}
    ${metric(goalTxt, Number.isFinite(G) ? `Estimated date at ${G} kg` : 'Goal date', '', tone)}
  </div><p class="hint">Estimates only. Real loss varies with water, glycogen and adherence.</p>`;
  const days = foodDates().filter(d => dayTotals(d).hasCal).slice(0, 30);
  $('#dDays').innerHTML = days.length ? `<table><tr><th>Day</th><th class="n">Intake</th><th class="n">TDEE</th><th class="n">Deficit</th></tr>${days.map(d => {
    const t = dayTotals(d), w = weightOn(d) ?? W, td = bmrFor(w) * factor, x = td - t.cal;
    return `<tr><td>${fmtDate(d)}</td><td class="n">${fmtN(t.cal)}${t.est ? '*' : ''}</td><td class="n">${fmtN(td)}</td><td class="n ${x > 0 ? 'down' : 'up'}">${fmtN(x)}</td></tr>`;
  }).join('')}</table><p class="hint">Uses that day's weight (or the last reading before it). Logged days may be partial, so these are estimates. * includes estimates.</p>` : '<p class="hint">No days with calories logged yet.</p>';
}
$('#dForm').addEventListener('input', e => {
  const f = $('#dForm'), st = S.settings;
  const map = { ht: 'height', age: 'age', goal: 'goal' };
  if (map[e.target.name]) { const v = num(e.target.value); st[map[e.target.name]] = Number.isFinite(v) ? v : null; save(); }
  if (e.target.name === 'sex') { st.sex = f.sex.value; save(); }
  if (e.target.name === 'act') { st.activity = f.act.value; save(); }
  renderDeficit();
  if (e.target.name === 'goal') renderWeight();
});
$('#dForm').addEventListener('submit', e => e.preventDefault());

/* ========== PEPTIDES ========== */
let pSel = null, pEditId = null, pPepEditId = null;
function curPep() { return S.peptides.find(p => p.id === pSel) || S.peptides[0] || null; }
function scheduleStatus(p) {
  const today = todayISO();
  const doses = S.doses.filter(d => d.peptideId === p.id);
  const sched = S.schedule.filter(s => s.peptideId === p.id).sort((a, b) => a.date.localeCompare(b.date));
  let nextFound = false;
  return sched.map((s, i) => {
    const done = doses.some(d => Math.abs(daysBetween(s.date, d.date)) <= 1 && d.mg >= s.mg - 1e-9);
    let status = done ? 'done' : s.date < today ? 'missed' : 'planned';
    if (!done && s.date >= today && !nextFound) { status = 'next'; nextFound = true; }
    return Object.assign({ week: i + 1, status }, s);
  });
}
function renderPeptides() {
  const sel = $('#pSel'), p = curPep();
  sel.innerHTML = S.peptides.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('') || '<option value="">No peptides yet</option>';
  if (p) { pSel = p.id; sel.value = p.id; }
  $('#pEditBtn').hidden = !p;
  if (!p) {
    $('#pInfo').innerHTML = '<p class="hint">Add a peptide (name and vial concentration) to start logging doses.</p>';
    $('#pForm').hidden = true; $('#pDoses').innerHTML = ''; $('#pSched').innerHTML = '<p class="hint">No schedule.</p>';
    return;
  }
  $('#pForm').hidden = false;
  const doses = S.doses.filter(d => d.peptideId === p.id).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  const sched = scheduleStatus(p), next = sched.find(s => s.status === 'next');
  $('#pInfo').innerHTML = `<table>
    <tr><th>Vial</th><td>${esc(p.vial || p.mgPerMl + ' mg/mL')}</td></tr>
    <tr><th>Plan</th><td>${esc(p.plan || '—')}</td></tr>
    <tr><th>Doses logged</th><td>${doses.length}${doses[0] ? ` · last ${fmtDate(doses[0].date)} (${doses[0].mg} mg)` : ''}</td></tr>
    ${next ? `<tr><th>Next dose</th><td><b>${fmtDate(next.date)}</b> · ${next.mg} mg = ${r2(next.mg / p.mgPerMl)} mL = ${Math.round(next.mg / p.mgPerMl * 100)} units (week ${next.week})</td></tr>` : ''}
  </table>`;
  $('#pDoses').innerHTML = doses.length ? `<table><tr><th>Date</th><th class="n">Dose</th><th class="n">mL</th><th class="n">Units</th><th>Note</th><th></th></tr>${doses.map(d => `
    <tr><td>${fmtDate(d.date)}${d.time ? ' ' + esc(d.time) : ''}</td><td class="n">${d.mg} mg</td><td class="n">${r2(d.mg / p.mgPerMl)}</td><td class="n">${Math.round(d.mg / p.mgPerMl * 100)}</td><td>${esc(d.note || '')}</td>
    <td class="n"><button class="btn sm" data-pedit="${d.id}">Edit</button> <button class="btn sm danger" data-pdel="${d.id}">✕</button></td></tr>`).join('')}</table>` : '<p class="hint">No doses logged yet.</p>';
  $('#pSched').innerHTML = sched.length ? `<table><tr><th>Wk</th><th>Date</th><th class="n">Dose</th><th class="n">mL</th><th class="n">Units</th><th>Status</th></tr>${sched.map(s => `
    <tr><td>${s.week}</td><td>${fmtDate(s.date)}</td><td class="n">${s.mg} mg</td><td class="n">${r2(s.mg / p.mgPerMl)}</td><td class="n">${Math.round(s.mg / p.mgPerMl * 100)}</td>
    <td><span class="tag ${s.status}">${{ done: 'Done', missed: 'Missed', next: 'Next', planned: 'Planned' }[s.status]}</span></td></tr>`).join('')}</table>
    <p class="hint">A scheduled dose counts as done if you logged at least that amount within a day of it.</p>` : '<p class="hint">No schedule yet. Build one below.</p>';
  updateDosePreview();
}
function updateDosePreview() {
  const f = $('#pForm'), p = curPep(); if (!p) return;
  const mg = num(f.dose.value) / (f.unit.value === 'mcg' ? 1000 : 1);
  $('#pPreview').textContent = Number.isFinite(mg) && mg > 0 ? `${r2(mg)} mg at ${p.mgPerMl} mg/mL = ${Math.round(mg / p.mgPerMl * 1000) / 1000} mL = ${(mg / p.mgPerMl * 100).toFixed(1)} units on a U-100 syringe.` : '';
}
$('#pForm').addEventListener('input', updateDosePreview);
$('#pSel').addEventListener('change', e => { pSel = e.target.value; resetDoseForm(); renderPeptides(); });
function resetDoseForm() {
  pEditId = null; const f = $('#pForm'); f.reset(); f.date.value = todayISO();
  const p = curPep();
  if (p) { const n = scheduleStatus(p).find(s => s.status === 'next'); if (n) f.dose.value = n.mg; }
  $('#pFormTitle').textContent = 'Log a dose'; $('[data-cancel]', f).hidden = true;
}
$('#pForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, p = curPep(); if (!p) return;
  const mg = num(f.dose.value) / (f.unit.value === 'mcg' ? 1000 : 1);
  if (!Number.isFinite(mg) || mg <= 0) return;
  const rec = { peptideId: p.id, date: f.date.value, time: f.time.value || '', mg: Math.round(mg * 10000) / 10000, note: f.note.value.trim() };
  if (pEditId) Object.assign(S.doses.find(d => d.id === pEditId), rec); else S.doses.push(Object.assign({ id: uid() }, rec));
  if (!save()) return;
  resetDoseForm(); renderAll(); toast(`Logged ${rec.mg} mg ${p.name} on ${fmtDate(rec.date)}`);
});
$('#pForm [data-cancel]').addEventListener('click', resetDoseForm);
$('#pDoses').addEventListener('click', e => {
  const ed = e.target.closest('[data-pedit]'), del = e.target.closest('[data-pdel]');
  if (ed) {
    const d = S.doses.find(x => x.id === ed.dataset.pedit); if (!d) return;
    pEditId = d.id; const f = $('#pForm'); f.date.value = d.date; f.time.value = d.time || ''; f.dose.value = d.mg; f.unit.value = 'mg'; f.note.value = d.note || '';
    $('#pFormTitle').textContent = 'Edit dose'; $('[data-cancel]', f).hidden = false; updateDosePreview(); f.scrollIntoView({ behavior: 'smooth' });
  }
  if (del) { const d = S.doses.find(x => x.id === del.dataset.pdel); if (d && confirm(`Delete the ${d.mg} mg dose on ${fmtDate(d.date)}?`)) { S.doses = S.doses.filter(x => x !== d); save(); renderAll(); } }
});
function openPepForm(p) {
  pPepEditId = p ? p.id : null; const f = $('#pPepForm'); f.hidden = false; f.reset();
  $('#pPepTitle').textContent = p ? 'Edit peptide' : 'New peptide'; $('#pPepDel').hidden = !p;
  if (p) { f.name.value = p.name; f.mgPerMl.value = p.mgPerMl; f.vial.value = p.vial || ''; f.plan.value = p.plan || ''; }
  f.scrollIntoView({ behavior: 'smooth' });
}
$('#pNewBtn').addEventListener('click', () => openPepForm(null));
$('#pEditBtn').addEventListener('click', () => openPepForm(curPep()));
$('#pPepForm [data-cancel]').addEventListener('click', () => { $('#pPepForm').hidden = true; });
$('#pPepForm').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target;
  const rec = { name: f.name.value.trim(), mgPerMl: num(f.mgPerMl.value), vial: f.vial.value.trim(), plan: f.plan.value.trim() };
  if (!rec.name || !(rec.mgPerMl > 0)) return;
  if (pPepEditId) Object.assign(S.peptides.find(p => p.id === pPepEditId), rec);
  else { const p = Object.assign({ id: uid() }, rec); S.peptides.push(p); pSel = p.id; }
  save(); f.hidden = true; resetDoseForm(); renderAll();
});
$('#pPepDel').addEventListener('click', () => {
  const p = S.peptides.find(x => x.id === pPepEditId); if (!p) return;
  if (!confirm(`Delete ${p.name} and all its logged doses and schedule?`)) return;
  S.peptides = S.peptides.filter(x => x !== p); S.doses = S.doses.filter(d => d.peptideId !== p.id); S.schedule = S.schedule.filter(s => s.peptideId !== p.id);
  pSel = null; save(); $('#pPepForm').hidden = true; renderAll();
});
$('#pSchedForm').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, p = curPep(); if (!p) return;
  const every = Math.max(1, Math.round(num(f.every.value))), n1 = Math.round(num(f.n1.value)), n2 = Math.round(num(f.n2.value)) || 0;
  const mg1 = num(f.mg1.value), mg2 = num(f.mg2.value);
  if (!f.start.value || !(n1 > 0) || !(mg1 > 0)) return;
  if (S.schedule.some(s => s.peptideId === p.id) && !confirm(`Replace the existing ${p.name} schedule?`)) return;
  const out = [];
  for (let i = 0; i < n1; i++) out.push({ peptideId: p.id, date: addDays(f.start.value, i * every), mg: mg1 });
  if (n2 > 0 && mg2 > 0) for (let i = 0; i < n2; i++) out.push({ peptideId: p.id, date: addDays(f.start.value, (n1 + i) * every), mg: mg2 });
  S.schedule = S.schedule.filter(s => s.peptideId !== p.id).concat(out); save(); renderAll(); toast('Schedule saved');
});

/* ========== SYRINGE ========== */
function renderSyringe() {
  const f = $('#sForm');
  const presets = [];
  S.peptides.forEach(p => {
    const mgs = Array.from(new Set(S.schedule.filter(s => s.peptideId === p.id).map(s => s.mg))).sort((a, b) => a - b);
    (mgs.length ? mgs : [1]).forEach(mg => presets.push({ label: `${p.name} ${mg} mg`, vial: p.mgPerMl, mg }));
  });
  $('#sPresets').innerHTML = presets.map((p, i) => `<button type="button" class="btn sm" data-preset="${i}">${esc(p.label)}</button>`).join('');
  $('#sPresets').onclick = e => { const b = e.target.closest('[data-preset]'); if (!b) return; const p = presets[b.dataset.preset]; f.vialMg.value = p.vial; f.water.value = 1; f.dose.value = p.mg; f.unit.value = 'mg'; calcSyringe(); };
  calcSyringe();
}
function calcSyringe() {
  const f = $('#sForm');
  const vialMg = num(f.vialMg.value), water = num(f.water.value), cap = Number(f.syr.value);
  const doseMg = num(f.dose.value) / (f.unit.value === 'mcg' ? 1000 : 1);
  const conc = vialMg / water, vol = doseMg / conc, units = vol * 100, perVial = vialMg / doseMg;
  const ok = Number.isFinite(conc) && conc > 0 && Number.isFinite(vol) && vol > 0;
  if (!ok) { $('#sMetrics').innerHTML = ''; $('#sDraw').innerHTML = '<p class="hint">Enter the vial amount, water and dose.</p>'; $('#sWarn').innerHTML = ''; return; }
  $('#sMetrics').innerHTML = metric(r2(conc) + ' mg/mL', 'Concentration') + metric((Math.round(vol * 1000) / 1000) + ' mL', 'Volume to draw') +
    metric(units.toFixed(1) + ' units', 'On U-100 syringe', '', units > cap || units < 2 ? 'warn' : '') + metric(Number.isFinite(perVial) ? String(Math.floor(perVial + 1e-9)) : '—', 'Doses per vial');
  $('#sDraw').innerHTML = `<div class="syr">${syringeSVG(cap, units)}</div>`;
  $('#sWarn').innerHTML = units > cap ? `<div class="callout bad">That's ${units.toFixed(1)} units, more than this syringe holds (${cap}). Use a bigger syringe or split the dose.</div>`
    : units < 2 ? '<div class="callout warn">Under 2 units is hard to measure accurately. Consider adding more water to dilute the vial.</div>' : '';
}
function syringeSVG(cap, units) {
  const x0 = 40, len = 270, y = 34, h = 36, fillU = Math.max(0, Math.min(units, cap)), fw = fillU / cap * len, over = units > cap;
  const minor = cap <= 30 ? 1 : 2, major = cap <= 30 ? 5 : 10;
  let s = `<svg viewBox="0 0 350 120" role="img" aria-label="Syringe filled to ${fillU.toFixed(1)} of ${cap} units">`;
  s += `<rect x="6" y="${y + h / 2 - 1.5}" width="${x0 - 6}" height="3" style="fill:var(--muted)"/>`; // needle
  s += `<rect x="${x0 - 6}" y="${y + 8}" width="6" height="${h - 16}" style="fill:var(--muted)"/>`; // hub
  s += `<rect x="${x0}" y="${y}" width="${len}" height="${h}" rx="4" style="fill:var(--card);stroke:var(--text)" stroke-width="1.2"/>`;
  s += `<rect x="${x0}" y="${y + 1}" width="${fw}" height="${h - 2}" style="fill:${over ? 'var(--bad)' : 'var(--accent2)'}" opacity=".55"/>`;
  for (let u = 0; u <= cap; u += minor) {
    const x = x0 + u / cap * len, isMaj = u % major === 0;
    s += `<line x1="${x}" x2="${x}" y1="${y}" y2="${y + (isMaj ? 14 : 7)}" style="stroke:var(--text)" stroke-width="${isMaj ? 1.2 : 0.6}"/>`;
    if (isMaj) s += `<text x="${x}" y="${y + h + 14}" font-size="10" text-anchor="middle" style="fill:var(--muted)">${u}</text>`;
  }
  s += `<rect x="${x0 + fw - 3}" y="${y - 3}" width="6" height="${h + 6}" rx="1" style="fill:var(--text)"/>`; // plunger seal
  s += `<rect x="${x0 + fw + 3}" y="${y + h / 2 - 2}" width="${Math.max(0, len - fw) + 18}" height="4" style="fill:var(--muted)"/>`; // rod
  s += `<rect x="${x0 + len + 18}" y="${y - 6}" width="7" height="${h + 12}" rx="2" style="fill:var(--muted)"/>`; // thumb rest
  s += `<text x="${x0}" y="${y - 12}" font-size="13" font-weight="700" style="fill:var(--text)">${over ? `Over capacity: ${units.toFixed(1)} units needed` : `Draw to ${fillU.toFixed(1)} units (${(fillU / 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} mL)`}</text>`;
  return s + '</svg>';
}
$('#sForm').addEventListener('input', calcSyringe);
$('#sForm').addEventListener('change', calcSyringe);
$('#sForm').addEventListener('submit', e => e.preventDefault());

/* ========== MORE: health log, profile, targets, backup ========== */
let hEditId = null;
function renderMore() {
  const hs = S.health.slice().sort((a, b) => b.date.localeCompare(a.date));
  $('#hList').innerHTML = hs.length ? hs.map(h => `<div class="item"><div class="grow"><div class="sub">${fmtDate(h.date)}</div><div>${esc(h.text)}</div>
    <div class="row" style="margin-top:4px"><button class="btn sm" data-hedit="${h.id}">Edit</button><button class="btn sm danger" data-hdel="${h.id}">Delete</button></div></div></div>`).join('') : '<p class="hint">No entries yet.</p>';
  $('#profList').innerHTML = S.profile.length ? `<table>${S.profile.map(p => `<tr><th>${esc(p.label)}</th><td>${esc(p.value)}</td><td class="n"><button class="btn sm danger" data-profdel="${p.id}">✕</button></td></tr>`).join('')}</table>` : '<p class="hint">No profile items.</p>';
  const f = $('#setForm'), st = S.settings;
  for (const k of ['goal', 'protein', 'calMin', 'calMax', 'bandLow', 'bandHigh']) if (document.activeElement !== f[k]) f[k].value = st[k] ?? '';
  const bytes = (localStorage.getItem(KEY) || '').length;
  $('#storageInfo').textContent = `Using about ${(bytes / 1024).toFixed(0)} KB of this phone's app storage (roughly 5,000 KB available). Meal photos take the most space.`;
}
function resetHealthForm() { hEditId = null; const f = $('#hForm'); f.reset(); f.date.value = todayISO(); $('#hFormTitle').textContent = 'Add log entry'; $('[data-cancel]', f).hidden = true; }
$('#hForm').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, rec = { date: f.date.value, text: f.text.value.trim() };
  if (!rec.text) return;
  if (hEditId) Object.assign(S.health.find(h => h.id === hEditId), rec); else S.health.push(Object.assign({ id: uid() }, rec));
  save(); resetHealthForm(); renderAll(); toast('Entry saved');
});
$('#hForm [data-cancel]').addEventListener('click', resetHealthForm);
$('#hList').addEventListener('click', e => {
  const ed = e.target.closest('[data-hedit]'), del = e.target.closest('[data-hdel]');
  if (ed) { const h = S.health.find(x => x.id === ed.dataset.hedit); if (!h) return; hEditId = h.id; const f = $('#hForm'); f.date.value = h.date; f.text.value = h.text; $('#hFormTitle').textContent = 'Edit entry'; $('[data-cancel]', f).hidden = false; f.scrollIntoView({ behavior: 'smooth' }); }
  if (del) { const h = S.health.find(x => x.id === del.dataset.hdel); if (h && confirm('Delete this entry?')) { S.health = S.health.filter(x => x !== h); save(); renderAll(); } }
});
$('#profForm').addEventListener('submit', e => { e.preventDefault(); const f = e.target; S.profile.push({ id: uid(), label: f.label.value.trim(), value: f.value.value.trim() }); save(); f.reset(); renderAll(); });
$('#profList').addEventListener('click', e => { const d = e.target.closest('[data-profdel]'); if (d && confirm('Delete this profile item?')) { S.profile = S.profile.filter(p => p.id !== d.dataset.profdel); save(); renderAll(); } });
$('#setForm').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target;
  for (const k of ['goal', 'protein', 'calMin', 'calMax', 'bandLow', 'bandHigh']) { const v = num(f[k].value); S.settings[k] = Number.isFinite(v) ? v : null; }
  save(); $('#dForm').dataset.init = ''; renderAll(); toast('Targets saved');
});

$('#exportBtn').addEventListener('click', async () => {
  const name = `health-tracker-backup-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (err) { if (err && err.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
function mergeById(a, b) { const m = new Map(a.map(x => [x.id, x])); b.forEach(x => m.set(x.id, x)); return Array.from(m.values()); }
function importData(obj) {
  if (!obj || typeof obj !== 'object' || !['weights', 'food', 'doses', 'peptides', 'health'].some(k => Array.isArray(obj[k]))) throw new Error('That file is not a Health Tracker data file.');
  const inc = normalise(obj);
  if (isEmpty() || confirm('Replace everything on this phone with the imported file?\n\nOK = replace all\nCancel = merge (imported entries win on the same day)')) { S = inc; }
  else {
    const byDate = new Map(S.weights.map(w => [w.date, w])); inc.weights.forEach(w => byDate.set(w.date, w)); S.weights = Array.from(byDate.values());
    for (const k of ['food', 'peptides', 'doses', 'health', 'profile']) S[k] = mergeById(S[k], inc[k]);
    const sk = new Set(S.schedule.map(s => s.peptideId + s.date)); inc.schedule.forEach(s => { if (!sk.has(s.peptideId + s.date)) S.schedule.push(s); });
    S.dayNotes = Object.assign({}, S.dayNotes, inc.dayNotes);
    for (const [k, v] of Object.entries(inc.settings)) if (v !== null && v !== undefined && (S.settings[k] === null || S.settings[k] === undefined)) S.settings[k] = v;
  }
}
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  try {
    importData(JSON.parse(await file.text()));
    if (save()) { pSel = null; $('#dForm').dataset.init = ''; renderAll(); resetForms(); toast(`Imported: ${S.weights.length} weights, ${S.food.length} food items, ${S.doses.length} doses.`); }
  } catch (err) { toast(err.message || 'Could not read that file.'); }
  e.target.value = '';
});
$('#wipeBtn').addEventListener('click', () => {
  if (!confirm('Erase ALL data stored in this app on this phone? Export a backup first if you want to keep it.')) return;
  if (!confirm('Really erase everything? This cannot be undone.')) return;
  S = emptyState(); save(); $('#dForm').dataset.init = ''; renderAll(); resetForms(); toast('All data erased');
});

/* ---------- Boot ---------- */
function renderAll() { renderBanner(); renderWeight(); renderFood(); renderDeficit(); renderPeptides(); renderSyringe(); renderMore(); }
function resetForms() { resetWeightForm(); resetFoodForm(); resetDoseForm(); resetHealthForm(); }
$('#fDay').value = todayISO();
renderAll(); resetForms(); renderPeptides();
{ const h = location.hash.slice(1).replace(/[^a-z]/g, ''); showTab(h && document.getElementById('tab-' + h) ? h : 'weight'); }
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
