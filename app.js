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
    weights: [], food: [], foods: [], dayNotes: {}, peptides: [], doses: [], schedule: [], health: [], profile: [], importedCodes: [],
  };
}
function normalise(s) {
  const base = emptyState();
  const out = Object.assign(base, s || {});
  out.settings = Object.assign(emptyState().settings, (s && s.settings) || {});
  for (const k of ['weights', 'food', 'foods', 'peptides', 'doses', 'schedule', 'health', 'profile', 'importedCodes']) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.dayNotes || typeof out.dayNotes !== 'object') out.dayNotes = {};
  for (const k of ['weights', 'food', 'foods', 'peptides', 'doses', 'health', 'profile']) out[k].forEach(x => { if (!x.id) x.id = uid(); });
  out.foods.forEach(fd => {
    if (!fd.basis) fd.basis = 'serving';
    if (!fd.unit) fd.unit = 'g';
    if (!(Number(fd.servingSize) > 0)) fd.servingSize = fd.basis === '100' ? 100 : 1;
  });
  return out;
}
let S;
try { S = normalise(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { S = emptyState(); }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
  catch (e) { toast('Could not save: phone storage is full. Remove some meal photos or export and erase.'); return false; }
}
const isEmpty = () => !S.weights.length && !S.food.length && !S.foods.length && !S.doses.length && !S.health.length && !S.peptides.length;
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
let fSel = null, mfEditId = null, mfFromBuiltin = false;
let lastPhotoFile = null;
let BUILTIN_FOODS = [];
let builtinsReady = false;
const SKIP_FOOD_NAMES = new Set(['meal photo', 'meal (photo)', 'meal', 'photo meal', 'meal (photo estimate)']);

function foodKey(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function unitLabel(u) { return u === 'piece' ? 'piece' : (u || ''); }
function nowTime() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}
function normaliseFoodDef(fd) {
  if (!fd || typeof fd !== 'object') return fd;
  if (!fd.basis) fd.basis = 'serving';
  if (!fd.unit) fd.unit = fd.basis === 'unit' ? 'piece' : 'g';
  if (!(Number(fd.servingSize) > 0)) fd.servingSize = fd.basis === '100' ? 100 : 1;
  if (fd.aka && !Array.isArray(fd.aka)) fd.aka = [];
  return fd;
}
function catalogKeys(fd) {
  const keys = [foodKey(fd.name)];
  for (const a of fd.aka || []) { const k = foodKey(a); if (k) keys.push(k); }
  return keys;
}
function foodMatches(fd, raw) {
  const k = foodKey(raw);
  return !!k && catalogKeys(fd).includes(k);
}
function basisAmount(fd) {
  if (fd.basis === '100') return 100;
  if (fd.basis === 'unit') return 1;
  return Number(fd.servingSize) > 0 ? Number(fd.servingSize) : 1;
}
function defaultAmount(fd) {
  const sv = Number(fd.servingSize) > 0 ? Number(fd.servingSize) : (fd.basis === '100' ? 100 : 1);
  if (fd.basis === 'serving') return { amt: 1, unit: 'serving' };
  return { amt: sv, unit: fd.unit || 'g' };
}
function scaleFood(fd, amt, unit) {
  const sv = Number(fd.servingSize) > 0 ? Number(fd.servingSize) : 1;
  const qtyInUnit = unit === 'serving' ? amt * sv : amt;
  const base = basisAmount(fd);
  const factor = (Number.isFinite(qtyInUnit) && base > 0) ? qtyInUnit / base : NaN;
  const sc = v => (Number.isFinite(v) && Number.isFinite(factor) ? v * factor : null);
  return { cal: sc(fd.cal), protein: sc(fd.protein), fat: sc(fd.fat), carbs: sc(fd.carbs), factor };
}
function foodSummary(fd) {
  const per = fd.basis === '100' ? `per 100 ${unitLabel(fd.unit)}`
    : fd.basis === 'unit' ? `per ${unitLabel(fd.unit)}`
    : `per serve (${r2(fd.servingSize)} ${unitLabel(fd.unit)})`;
  const bits = [Number.isFinite(fd.cal) ? `${fmtN(fd.cal)} cal / ${fmtN(fd.cal * KJ)} kJ ${per}` : `cal ? ${per}`];
  if (Number.isFinite(fd.protein)) bits.push(`${r2(fd.protein)} g protein`);
  if (Number.isFinite(fd.fat)) bits.push(`${r2(fd.fat)} g fat`);
  if (Number.isFinite(fd.carbs)) bits.push(`${r2(fd.carbs)} g carbs`);
  return bits.join(' · ');
}
function isPersonalFood(fd) { return !!(fd && S.foods.some(x => x.id === fd.id)); }
function allCatalog() {
  const mine = S.foods.map(normaliseFoodDef);
  const mineKeys = new Set();
  mine.forEach(f => catalogKeys(f).forEach(k => mineKeys.add(k)));
  const extras = BUILTIN_FOODS.filter(f => !catalogKeys(f).some(k => mineKeys.has(k)));
  return { mine, builtins: extras, all: mine.concat(extras) };
}
function foodByName(n) {
  const k = foodKey(n);
  if (!k) return null;
  return S.foods.map(normaliseFoodDef).find(f => foodMatches(f, n))
    || BUILTIN_FOODS.find(f => foodMatches(f, n))
    || null;
}
function foodById(id) {
  if (!id) return null;
  return S.foods.map(normaliseFoodDef).find(f => f.id === id) || BUILTIN_FOODS.find(f => f.id === id) || null;
}
function knownFoodKeys() {
  const s = new Set();
  S.foods.forEach(f => catalogKeys(normaliseFoodDef(f)).forEach(k => s.add(k)));
  BUILTIN_FOODS.forEach(f => catalogKeys(f).forEach(k => s.add(k)));
  return s;
}
function migrateFoodsFromLog() {
  const known = knownFoodKeys();
  const groups = new Map();
  for (const i of S.food) {
    const k = foodKey(i.item);
    if (!k || SKIP_FOOD_NAMES.has(k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  let added = 0;
  for (const [k, items] of groups) {
    if (known.has(k)) continue;
    const withCal = items.filter(i => Number.isFinite(i.cal));
    const withQty = withCal.filter(i => Number.isFinite(i.qty) && i.qty > 0);
    const pick = withQty[withQty.length - 1] || withCal[withCal.length - 1] || items[items.length - 1];
    const name = String(pick.item || '').trim();
    if (!name) continue;
    let servingSize = 1, unit = 'piece', basis = 'serving';
    let cal = Number.isFinite(pick.cal) ? pick.cal : null;
    let protein = Number.isFinite(pick.protein) ? pick.protein : null;
    if (Number.isFinite(pick.basisCal) && Number.isFinite(pick.basisQty) && pick.basisQty > 0) {
      cal = pick.basisCal;
      protein = Number.isFinite(pick.basisProtein) ? pick.basisProtein : null;
      servingSize = pick.basisQty;
      unit = pick.basisUnit && pick.basisUnit !== 'serving' ? pick.basisUnit : (pick.qtyUnit && pick.qtyUnit !== 'serving' ? pick.qtyUnit : 'g');
      basis = (unit === 'g' || unit === 'ml') && pick.basisQty === 100 ? '100' : (unit === 'piece' && pick.basisQty === 1 ? 'unit' : 'serving');
    } else if (Number.isFinite(pick.qty) && pick.qty > 0) {
      servingSize = pick.qty;
      unit = pick.qtyUnit && pick.qtyUnit !== 'serving' ? pick.qtyUnit : 'piece';
      basis = 'serving';
    }
    const rec = normaliseFoodDef({
      id: uid(), name, servingSize, unit, basis, cal, protein, fat: null, carbs: null,
      source: pick.source === 'label' ? 'label' : 'estimate', fromLog: true,
    });
    S.foods.push(rec);
    known.add(k);
    added++;
  }
  if (added) save();
  return added;
}
async function loadBuiltins() {
  if (builtinsReady) return BUILTIN_FOODS;
  try {
    const r = await fetch('foods.json', { cache: 'no-cache' });
    const data = r.ok ? await r.json() : [];
    BUILTIN_FOODS = (Array.isArray(data) ? data : []).map(x => normaliseFoodDef(Object.assign({ builtin: true }, x)));
  } catch (e) { BUILTIN_FOODS = []; }
  builtinsReady = true;
  return BUILTIN_FOODS;
}

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
function qtyLabel(i) {
  if (!Number.isFinite(i.qty)) return '';
  const u = i.qtyUnit === 'serving' ? (i.qty === 1 ? 'serve' : 'serves') : (i.qtyUnit || '');
  return `${r2(i.qty)} ${esc(u)} · `;
}
function sourceTag(src) {
  if (src === 'label') return '<span class="tag">label</span>';
  if (src === 'typical') return '<span class="tag">typical</span>';
  if (src === 'estimate') return '<span class="tag est">estimate</span>';
  return '<span class="tag">not recorded</span>';
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
      <div class="grow"><div><b>${esc(i.item)}</b>${i.pending ? ' <span class="tag pending">awaiting estimate</span>' : ''}${i.time ? ` <span class="sub">${esc(i.time)}</span>` : ''}</div>
        <div class="sub">${qtyLabel(i)}${Number.isFinite(i.cal) ? `${fmtN(i.cal)} cal · ${fmtN(i.cal * KJ)} kJ` : i.pending ? 'calories pending' : 'cal not recorded'}${Number.isFinite(i.protein) ? ` · ${i.protein} g protein` : ''}
          ${sourceTag(i.source)}</div>
        <div class="row" style="margin-top:4px"><button class="btn sm" data-fedit="${i.id}">Edit</button>${i.photo ? `<button class="btn sm" data-fshare="${i.id}">Send photo to Health Bot</button>` : ''}<button class="btn sm danger" data-fdel="${i.id}">Delete</button></div>
      </div></div>`).join('') : '<p class="hint">Nothing logged for this day.</p>';
  renderFoodExtras();
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
$('#fForm').cal.addEventListener('input', e => { const v = num(e.target.value); $('#fForm').kj.value = Number.isFinite(v) ? Math.round(v * KJ) : ''; updateLiveCal(); });
$('#fForm').kj.addEventListener('input', e => { const v = num(e.target.value); $('#fForm').cal.value = Number.isFinite(v) ? Math.round(v / KJ) : ''; updateLiveCal(); });

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

function hideSuggest() { const el = $('#fSuggest'); if (el) el.hidden = true; }
function suggestFoods(q) {
  const k = foodKey(q);
  if (k.length < 2) return [];
  const { all } = allCatalog();
  const scored = [];
  for (const fd of all) {
    let score = 0;
    for (const n of [fd.name, ...(fd.aka || [])]) {
      const nk = foodKey(n);
      if (nk === k) score = Math.max(score, 3);
      else if (nk.startsWith(k)) score = Math.max(score, 2);
      else if (nk.includes(k)) score = Math.max(score, 1);
    }
    if (score) scored.push({ fd, score, personal: isPersonalFood(fd) });
  }
  scored.sort((a, b) => b.score - a.score || (b.personal - a.personal) || a.fd.name.localeCompare(b.fd.name));
  return scored.slice(0, 12);
}
function renderSuggest() {
  const box = $('#fSuggest'), q = $('#fForm').item.value;
  if (!box) return;
  const hits = suggestFoods(q);
  if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = hits.map((h, i) => `<button type="button" data-sugg="${esc(h.fd.id)}" class="${i === 0 ? 'active' : ''}"><b>${esc(h.fd.name)}</b> ${h.personal ? '<span class="tag">mine</span>' : '<span class="tag">typical</span>'}<div class="sub">${esc(foodSummary(h.fd))}</div></button>`).join('');
  box.hidden = false;
}
function selectFood(fd, fill = true) {
  const f = $('#fForm'); fSel = fd; mfFromBuiltin = !isPersonalFood(fd);
  if (fill && f.item.value !== fd.name) f.item.value = fd.name;
  const serveOpt = `<option value="serving">serves (${r2(fd.servingSize)} ${unitLabel(fd.unit)} each)</option>`;
  const unitOpt = fd.unit !== 'piece' || fd.basis !== 'unit' ? `<option value="${fd.unit}">${unitLabel(fd.unit)}</option>` : `<option value="piece">piece</option>`;
  f.amtUnit.innerHTML = (fd.basis === 'serving' ? serveOpt + (fd.unit !== 'piece' ? `<option value="${fd.unit}">${fd.unit}</option>` : '') : unitOpt + serveOpt);
  const d = defaultAmount(fd);
  f.amt.value = d.amt;
  f.amtUnit.value = d.unit;
  f.calMode.value = fd.basis === '100' ? '100' : fd.basis === 'unit' ? 'unit' : 'serving';
  $('#fCustomiseBtn').hidden = isPersonalFood(fd);
  hideSuggest();
  if (fill) fillFromFood();
  else updateFoodHint();
  updateSaveRow();
  updateLiveCal();
}
function fillFromFood() {
  if (!fSel) return;
  const f = $('#fForm'), amt = num(f.amt.value);
  if (!Number.isFinite(amt)) return;
  const v = scaleFood(fSel, amt, f.amtUnit.value);
  f.cal.value = Number.isFinite(v.cal) ? Math.round(v.cal) : '';
  f.kj.value = Number.isFinite(v.cal) ? Math.round(v.cal * KJ) : '';
  f.protein.value = Number.isFinite(v.protein) ? r2(v.protein) : '';
  f.source.value = fSel.source === 'label' ? 'label' : 'estimate';
  updateFoodHint();
  updateLiveCal();
}
function updateFoodHint() {
  const el = $('#fFoodHint');
  if (!el) return;
  if (fSel) el.textContent = `${isPersonalFood(fSel) ? 'From My foods' : 'Typical values'}: ${foodSummary(fSel)}. Change the amount to scale calories. You can still adjust the numbers.`;
  else {
    const f = $('#fForm');
    const mode = f.calMode.value;
    el.textContent = mode === 'total'
      ? 'Type the total calories you ate. Amount is optional, and is stored so you can change it later.'
      : 'Enter the label value (e.g. 250 cal per 100 g) and how much you ate. The total updates below.';
  }
}
function updateLiveCal() {
  const el = $('#fLiveCal'), f = $('#fForm');
  if (!el) return;
  const amt = num(f.amt.value);
  if (fSel && Number.isFinite(amt)) {
    const v = scaleFood(fSel, amt, f.amtUnit.value);
    if (Number.isFinite(v.cal)) {
      el.textContent = `${r2(amt)} ${f.amtUnit.value === 'serving' ? (amt === 1 ? 'serve' : 'serves') : f.amtUnit.value} = ${fmtN(v.cal)} cal (${fmtN(v.cal * KJ)} kJ)${Number.isFinite(v.protein) ? `, ${r2(v.protein)} g protein` : ''}`;
      return;
    }
  }
  if (!fSel && f.calMode.value !== 'total' && Number.isFinite(amt) && amt > 0) {
    const v = manualScaled();
    if (v && Number.isFinite(v.cal)) {
      el.textContent = `${r2(amt)} ${f.amtUnit.value} = ${fmtN(v.cal)} cal (${fmtN(v.cal * KJ)} kJ)${Number.isFinite(v.protein) ? `, ${r2(v.protein)} g protein` : ''}`;
      return;
    }
  }
  el.textContent = '';
}
function manualScaled() {
  const f = $('#fForm'), mode = f.calMode.value, amt = num(f.amt.value);
  const cal = num(f.cal.value), protein = num(f.protein.value);
  if (mode === 'total' || !Number.isFinite(amt) || amt <= 0) return { cal: Number.isFinite(cal) ? cal : null, protein: Number.isFinite(protein) ? protein : null, factor: 1, labelCal: cal, labelProtein: protein, base: amt, unit: f.amtUnit.value };
  let base = mode === '100' ? 100 : mode === 'unit' ? 1 : (num(f.svSize && f.svSize.value) > 0 ? num(f.svSize.value) : 1);
  // When calories-are is "per serve" and unit is not serving, treat the entered cal as per 1 of that unit if no serve size given.
  if (mode === 'serving' && f.amtUnit.value !== 'serving' && !(num(f.svSize && f.svSize.value) > 0)) base = 1;
  const qty = f.amtUnit.value === 'serving' && mode === '100' ? amt * 100 : amt;
  const factor = qty / base;
  return {
    cal: Number.isFinite(cal) ? cal * factor : null,
    protein: Number.isFinite(protein) ? protein * factor : null,
    factor, labelCal: cal, labelProtein: protein, base, unit: mode === '100' ? (f.amtUnit.value === 'ml' ? 'ml' : 'g') : f.amtUnit.value,
  };
}
function updateSaveRow() {
  const f = $('#fForm');
  $('#fSaveRow').hidden = !!fSel || !!fEditId || !f.item.value.trim();
  $('#fCustomiseBtn').hidden = !fSel || isPersonalFood(fSel);
}

function resetFoodForm() {
  fEditId = null; const f = $('#fForm'); f.reset(); f.date.value = $('#fDay').value || todayISO(); f.source.value = 'label';
  f.calMode.value = 'total'; f.amtUnit.innerHTML = '<option value="g">g</option><option value="ml">ml</option><option value="piece">piece</option><option value="serving">serves</option>';
  f.amt.value = ''; f.amtUnit.value = 'g';
  setPhoto(null); $('#fFormTitle').textContent = 'Add food'; $('[data-cancel]', f).hidden = true;
  fSel = null; mfFromBuiltin = false; $('#fCustomiseBtn').hidden = true; $('#fSaveFields').hidden = true;
  hideSuggest(); updateSaveRow(); updateFoodHint(); updateLiveCal();
}
$('#fForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const amt = num(f.amt.value);
  let cal = num(f.cal.value), protein = num(f.protein.value);
  let basisCal = null, basisProtein = null, basisQty = null, basisUnit = null;
  if (fSel && Number.isFinite(amt)) {
    const v = scaleFood(fSel, amt, f.amtUnit.value);
    if (Number.isFinite(v.cal) && f.calMode.value !== 'total') {
      // fields already hold computed totals from fillFromFood; use the field if the user overrode them
    }
    cal = Number.isFinite(cal) ? cal : v.cal;
    protein = Number.isFinite(protein) ? protein : v.protein;
    basisCal = fSel.cal; basisProtein = fSel.protein; basisQty = basisAmount(fSel); basisUnit = fSel.unit;
  } else if (f.calMode.value !== 'total' && Number.isFinite(amt)) {
    const v = manualScaled();
    cal = v.cal; protein = v.protein;
    basisCal = v.labelCal; basisProtein = v.labelProtein; basisQty = v.base; basisUnit = v.unit;
  } else if (Number.isFinite(amt) && Number.isFinite(cal)) {
    basisCal = cal; basisProtein = Number.isFinite(protein) ? protein : null; basisQty = amt; basisUnit = f.amtUnit.value;
  }
  const rec = { date: f.date.value, item: f.item.value.trim(), cal: Number.isFinite(cal) ? Math.round(cal) : null, protein: Number.isFinite(protein) ? r2(protein) : null, source: f.source.value, photo: fPhotoData || null };
  if (!rec.item || !rec.date) return;
  if (rec.cal === null) rec.source = rec.source === 'label' ? 'not recorded' : rec.source;
  rec.pending = rec.cal === null && !!rec.photo;
  if (Number.isFinite(amt) && amt > 0) { rec.qty = amt; rec.qtyUnit = f.amtUnit.value; } else { rec.qty = null; rec.qtyUnit = null; }
  rec.foodId = fSel ? fSel.id : null;
  rec.basisCal = Number.isFinite(basisCal) ? basisCal : null;
  rec.basisProtein = Number.isFinite(basisProtein) ? basisProtein : null;
  rec.basisQty = Number.isFinite(basisQty) ? basisQty : null;
  rec.basisUnit = basisUnit || null;
  let savedFood = '';
  if (!fSel && !fEditId && f.saveFood.checked && rec.cal !== null) {
    const sv = num(f.svSize.value) > 0 ? num(f.svSize.value) : (Number.isFinite(amt) && amt > 0 ? amt : 1);
    const nf = normaliseFoodDef({ id: uid(), name: rec.item, servingSize: sv, unit: f.svUnit.value, basis: 'serving', cal: rec.cal, protein: rec.protein, fat: null, carbs: null, source: rec.source === 'label' ? 'label' : 'estimate' });
    // If they entered per-basis values, store those instead.
    if (f.calMode.value !== 'total' && Number.isFinite(basisCal)) {
      nf.basis = f.calMode.value === '100' ? '100' : (f.calMode.value === 'unit' ? 'unit' : 'serving');
      nf.cal = basisCal; nf.protein = basisProtein; nf.servingSize = f.calMode.value === '100' ? sv : (f.calMode.value === 'unit' ? 1 : sv);
      nf.unit = f.svUnit.value || (f.amtUnit.value === 'serving' ? 'piece' : f.amtUnit.value);
    }
    S.foods.push(nf); rec.foodId = nf.id; savedFood = ' Added to My foods.';
  }
  if (fEditId) Object.assign(S.food.find(x => x.id === fEditId), rec); else S.food.push(Object.assign({ id: uid(), time: rec.date === todayISO() ? nowTime() : '' }, rec));
  if (!save()) return;
  migrateFoodsFromLog();
  $('#fDay').value = rec.date;
  const t = dayTotals(rec.date);
  resetFoodForm(); renderAll();
  toast(`Saved. ${t.hasCal ? 'Day total ' + fmtN(t.cal) + ' cal (' + fmtN(t.cal * KJ) + ' kJ).' : ''}${savedFood}`);
});
$('#fForm [data-cancel]').addEventListener('click', resetFoodForm);
$('#fList').addEventListener('click', e => {
  const ed = e.target.closest('[data-fedit]'), del = e.target.closest('[data-fdel]'), sh = e.target.closest('[data-fshare]');
  if (ed) {
    const i = S.food.find(x => x.id === ed.dataset.fedit); if (!i) return;
    fEditId = i.id; const f = $('#fForm');
    f.item.value = i.item; f.cal.value = Number.isFinite(i.cal) ? i.cal : ''; f.kj.value = Number.isFinite(i.cal) ? Math.round(i.cal * KJ) : '';
    f.protein.value = Number.isFinite(i.protein) ? i.protein : ''; f.source.value = i.source === 'label' ? 'label' : 'estimate'; f.date.value = i.date;
    setPhoto(i.photo || null);
    const lf = foodById(i.foodId) || (Number.isFinite(i.basisCal) && Number.isFinite(i.basisQty) ? normaliseFoodDef({
      id: i.foodId || 'adhoc', name: i.item, basis: (i.basisUnit === 'g' || i.basisUnit === 'ml') && i.basisQty === 100 ? '100' : (i.basisUnit === 'piece' && i.basisQty === 1 ? 'unit' : 'serving'),
      servingSize: i.basisQty, unit: i.basisUnit && i.basisUnit !== 'serving' ? i.basisUnit : 'g', cal: i.basisCal, protein: i.basisProtein, source: i.source,
    }) : null);
    if (lf) {
      selectFood(lf, false);
      if (Number.isFinite(i.qty)) { f.amt.value = i.qty; if (i.qtyUnit) f.amtUnit.value = i.qtyUnit; }
      // Keep the logged totals in the fields (user may have overridden). Changing amount will rescale from basis.
      f.cal.value = Number.isFinite(i.cal) ? i.cal : f.cal.value;
      f.kj.value = Number.isFinite(i.cal) ? Math.round(i.cal * KJ) : f.kj.value;
      f.protein.value = Number.isFinite(i.protein) ? i.protein : f.protein.value;
      updateFoodHint(); updateLiveCal();
    } else {
      fSel = null; f.calMode.value = 'total';
      if (Number.isFinite(i.qty)) { f.amt.value = i.qty; f.amtUnit.value = i.qtyUnit || 'g'; }
      updateSaveRow(); updateFoodHint(); updateLiveCal();
    }
    $('#fFormTitle').textContent = 'Edit food'; $('[data-cancel]', f).hidden = false; f.scrollIntoView({ behavior: 'smooth' });
  }
  if (del) { const i = S.food.find(x => x.id === del.dataset.fdel); if (i && confirm(`Delete "${i.item}"?`)) { S.food = S.food.filter(x => x !== i); save(); renderAll(); } }
  if (sh) { const i = S.food.find(x => x.id === sh.dataset.fshare); if (i && i.photo) sharePhoto(lastPhotoFile && lastPhotoFile.id === i.id ? lastPhotoFile.file : dataURLtoFile(i.photo, 'meal.jpg'), i.item); }
});

/* ========== MY FOODS (database) + suggestions ========== */
$('#fForm').item.addEventListener('input', e => {
  const fd = foodByName(e.target.value);
  if (fd && foodKey(fd.name) === foodKey(e.target.value) && fd !== fSel) selectFood(fd);
  else if (!fd && fSel && foodKey(e.target.value) !== foodKey(fSel.name)) { fSel = null; fSelClearPartial(); }
  updateSaveRow();
  renderSuggest();
});
$('#fForm').item.addEventListener('focus', () => { if (foodKey($('#fForm').item.value).length >= 2) renderSuggest(); });
$('#fForm').item.addEventListener('keydown', e => {
  if (e.key === 'Escape') { hideSuggest(); return; }
  const box = $('#fSuggest');
  if (box && !box.hidden && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Tab') && suggestFoods($('#fForm').item.value).length) {
    const first = $('[data-sugg]', box);
    if (first && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickSuggest(first.dataset.sugg); }
  }
});
document.addEventListener('click', e => { if (!e.target.closest('.suggest-wrap')) hideSuggest(); });
$('#fSuggest').addEventListener('click', e => {
  const b = e.target.closest('[data-sugg]'); if (b) pickSuggest(b.dataset.sugg);
});
function pickSuggest(id) {
  const fd = foodById(id); if (!fd) return;
  const f = $('#fForm'); f.item.value = fd.name; selectFood(fd); f.amt.focus();
}
function fSelClearPartial() {
  const f = $('#fForm');
  f.calMode.value = 'total';
  $('#fCustomiseBtn').hidden = true;
  updateFoodHint(); updateLiveCal();
}
$('#fForm').amt.addEventListener('input', () => { if (fSel) fillFromFood(); else updateLiveCal(); });
$('#fForm').amtUnit.addEventListener('change', e => {
  const f = $('#fForm'), a = num(f.amt.value);
  if (fSel && Number.isFinite(a)) {
    const sv = Number(fSel.servingSize) > 0 ? Number(fSel.servingSize) : 1;
    if (e.target.value === 'serving') f.amt.value = r2(a / sv);
    else if (f.amtUnit._prev === 'serving') f.amt.value = r2(a * sv);
  }
  f.amtUnit._prev = e.target.value;
  if (fSel) fillFromFood(); else updateLiveCal();
});
$('#fForm').calMode.addEventListener('change', () => { updateFoodHint(); updateLiveCal(); });
$('#fForm').saveFood.addEventListener('change', e => { $('#fSaveFields').hidden = !e.target.checked; });
$('#fCustomiseBtn').addEventListener('click', () => { if (fSel) openMfForm(fSel, { fromBuiltin: !isPersonalFood(fSel) }); });

function renderFoodExtras() {
  const { mine } = allCatalog();
  const foods = mine.slice().sort((a, b) => a.name.localeCompare(b.name));
  $('#mfList').innerHTML = foods.length ? foods.map(fd => `<div class="item"><div class="grow"><div><b>${esc(fd.name)}</b> ${sourceTag(fd.source)}</div>
    <div class="sub">${esc(foodSummary(fd))}</div>
    <div class="row" style="margin-top:4px"><button class="btn sm" type="button" data-mfuse="${fd.id}">Log it</button><button class="btn sm" type="button" data-mfedit="${fd.id}">Edit</button><button class="btn sm danger" type="button" data-mfdel="${fd.id}">Delete</button></div></div></div>`).join('')
    : '<p class="hint">No personal foods saved yet. Common foods still appear when you type in the add-food box.</p>';
  const pend = S.food.filter(i => i.pending);
  $('#pendingInfo').innerHTML = pend.length ? `<div class="callout warn">${pend.length} photo meal${pend.length > 1 ? 's' : ''} awaiting an estimate (${pend.map(p => fmtDate(p.date) + (p.time ? ' ' + esc(p.time) : '')).join(', ')}). Send the photo to Health Bot, then tap <b>Paste from Health Bot</b>.</div>` : '';
}
function openMfForm(fd, opts) {
  const fromBuiltin = !!(opts && opts.fromBuiltin) || (fd && !isPersonalFood(fd));
  mfEditId = fd && !fromBuiltin ? fd.id : null;
  mfFromBuiltin = fromBuiltin;
  const f = $('#mfForm'); f.reset(); f.hidden = false;
  $('#mfTitle').textContent = fromBuiltin ? 'Customise in My foods' : (fd ? 'Edit food' : 'Add to My foods');
  if (fd) {
    f.name.value = fd.name; f.svSize.value = fd.servingSize; f.svUnit.value = fd.unit; f.basis.value = fd.basis === '100' ? '100' : 'serving';
    f.cal.value = Number.isFinite(fd.cal) ? r2(fd.cal) : ''; f.kj.value = Number.isFinite(fd.cal) ? Math.round(fd.cal * KJ) : '';
    f.protein.value = fd.protein ?? ''; f.fat.value = fd.fat ?? ''; f.carbs.value = fd.carbs ?? ''; f.source.value = fd.source === 'typical' ? 'estimate' : (fd.source || 'label');
  }
  mfPreview(); f.scrollIntoView({ behavior: 'smooth' });
}
function mfValues() {
  const f = $('#mfForm'), sv = num(f.svSize.value), unit = f.svUnit.value, per100 = f.basis.value === '100';
  if (per100 && unit === 'piece') return { error: 'Per 100 g/ml needs a serving unit of g or ml.' };
  if (!(sv > 0)) return { error: 'Enter a serving size.' };
  const g = k => { const v = num(f[k].value); return Number.isFinite(v) ? Math.round(v * 100) / 100 : null; };
  // Store values as entered for the chosen basis (no longer converted to per-serve).
  return { name: f.name.value.trim(), servingSize: sv, unit, basis: per100 ? '100' : 'serving', cal: g('cal'), protein: g('protein'), fat: g('fat'), carbs: g('carbs'), source: f.source.value };
}
function mfPreview() {
  const v = mfValues();
  $('#mfPreview').textContent = v.error ? v.error : v.cal !== null ? `Will be saved as: ${foodSummary(v)}` : 'Enter calories or kJ.';
}
$('#mfForm').addEventListener('input', e => {
  const f = $('#mfForm');
  if (e.target.name === 'cal') { const v = num(f.cal.value); f.kj.value = Number.isFinite(v) ? Math.round(v * KJ) : ''; }
  if (e.target.name === 'kj') { const v = num(f.kj.value); f.cal.value = Number.isFinite(v) ? r2(v / KJ) : ''; }
  mfPreview();
});
$('#mfForm').addEventListener('change', mfPreview);
$('#mfForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = mfValues(); if (v.error) { toast(v.error); return; }
  if (!v.name || v.cal === null) { toast('Name and calories are needed.'); return; }
  const dupe = S.foods.find(x => foodKey(x.name) === foodKey(v.name));
  if (dupe && dupe.id !== mfEditId && !confirm(`"${dupe.name}" is already in My foods. Replace it?`)) return;
  if (mfEditId) Object.assign(S.foods.find(x => x.id === mfEditId), v);
  else if (dupe) Object.assign(dupe, v);
  else S.foods.push(Object.assign({ id: uid() }, v));
  if (!save()) return;
  $('#mfForm').hidden = true; mfEditId = null; mfFromBuiltin = false; renderAll(); toast(`Saved ${v.name} to My foods`);
});
$('#mfForm [data-cancel]').addEventListener('click', () => { $('#mfForm').hidden = true; mfEditId = null; mfFromBuiltin = false; });
$('#mfNewBtn').addEventListener('click', () => openMfForm(null));
$('#mfList').addEventListener('click', e => {
  const u = e.target.closest('[data-mfuse]'), ed = e.target.closest('[data-mfedit]'), del = e.target.closest('[data-mfdel]');
  if (u) { const fd = foodById(u.dataset.mfuse); if (!fd) return; resetFoodForm(); const f = $('#fForm'); f.item.value = fd.name; selectFood(fd); f.scrollIntoView({ behavior: 'smooth' }); f.amt.focus(); }
  if (ed) openMfForm(foodById(ed.dataset.mfedit));
  if (del) { const fd = S.foods.find(x => x.id === del.dataset.mfdel); if (fd && confirm(`Delete ${fd.name} from My foods? Logged entries stay.`)) { S.foods = S.foods.filter(x => x !== fd); save(); renderAll(); } }
});

/* ========== MEAL PHOTO -> PENDING MEAL ========== */
$('#mealPhotoBtn').addEventListener('click', () => $('#mealPhoto').click());
$('#mealPhoto').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const photo = await compressImage(file);
    const date = $('#fDay').value || todayISO();
    const entry = { id: uid(), mealId: uid(), date, time: date === todayISO() ? nowTime() : '', item: 'Meal photo', cal: null, protein: null, source: 'estimate', photo, pending: true };
    S.food.push(entry);
    if (!save()) { S.food.pop(); return; }
    lastPhotoFile = { id: entry.id, file };
    renderAll();
    toast('Photo meal saved, awaiting estimate. Tap "Send photo to Health Bot" on it.');
  } catch (err) { toast(err.message); }
});

/* ========== HEALTH BOT PASTE BRIDGE (HB1 codes) ==========
   Format: "HB1:" + base64url(UTF-8 JSON), JSON = {t:'meal', d:'YYYY-MM-DD', time?:'HH:MM',
     items:[{n, cal, p?, src?, q?, u?, per?, pu?}], note?}
   cal/p are for estimated amount q (default 1 serving). The token may appear anywhere in pasted text. */
function b64urlDecode(str) {
  let b = str.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
  const bin = atob(b), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function b64urlEncode(s) {
  const bytes = new TextEncoder().encode(s); let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makeHB(obj) { return 'HB1:' + b64urlEncode(JSON.stringify(obj)); }
function parseHB(text) {
  const m = String(text || '').match(/HB1:([A-Za-z0-9_-]+)/);
  if (!m) return { ok: false, error: 'No Health Bot code (starting HB1:) found in that text.' };
  let o;
  try { o = JSON.parse(b64urlDecode(m[1])); } catch (e) { return { ok: false, error: 'The HB1 code is damaged or incomplete. Copy the whole message again.' }; }
  if (!o || o.t !== 'meal') return { ok: false, error: 'Unknown code type.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.d || '')) return { ok: false, error: 'The code has no valid date.' };
  if (!Array.isArray(o.items) || !o.items.length) return { ok: false, error: 'The code has no food items.' };
  const items = [];
  const unitOk = u => ['g', 'ml', 'piece', 'serving'].includes(u);
  for (const it of o.items) {
    const cal = Number(it.cal), p = it.p === undefined || it.p === null ? null : Number(it.p);
    if (!it.n || !Number.isFinite(cal) || cal < 0 || (p !== null && !Number.isFinite(p))) return { ok: false, error: 'An item in the code is missing a name or calories.' };
    const q = it.q === undefined || it.q === null || it.q === '' ? null : Number(it.q);
    const per = it.per === undefined || it.per === null || it.per === '' ? null : Number(it.per);
    if (q !== null && (!Number.isFinite(q) || q <= 0)) return { ok: false, error: 'An item has an invalid quantity.' };
    if (per !== null && (!Number.isFinite(per) || per <= 0)) return { ok: false, error: 'An item has an invalid per-basis amount.' };
    items.push({
      n: String(it.n).slice(0, 120), cal: Math.round(cal), p: p === null ? null : r2(p), src: it.src === 'label' ? 'label' : 'estimate',
      q: q, u: unitOk(it.u) ? it.u : null, per: per, pu: unitOk(it.pu) ? it.pu : null,
    });
  }
  const time = /^\d{2}:\d{2}$/.test(o.time || '') ? o.time : '';
  return { ok: true, code: m[0], data: { d: o.d, time, items, note: o.note ? String(o.note).slice(0, 300) : '' } };
}
function itemDefaultQty(it) {
  return { qty: Number.isFinite(it.q) && it.q > 0 ? it.q : 1, unit: it.u || 'serving' };
}
function scaleHBItem(it) {
  const d = itemDefaultQty(it);
  const qty = Number.isFinite(it._qty) ? it._qty : d.qty;
  const unit = it._unit || d.unit;
  const factor = d.qty > 0 ? qty / d.qty : 1;
  return {
    item: it.n,
    cal: Math.round(it.cal * factor),
    protein: it.p === null ? null : r2(it.p * factor),
    source: it.src,
    qty, qtyUnit: unit,
    basisCal: it.cal, basisProtein: it.p, basisQty: d.qty, basisUnit: d.unit,
    fromHB: true, pending: false,
  };
}
function pendingCandidates(date) {
  const key = i => i.date + ' ' + (i.time || '') + ' ' + i.id;
  const pend = S.food.filter(i => i.pending);
  const same = pend.filter(i => i.date === date).sort((a, b) => key(b).localeCompare(key(a)));
  const other = pend.filter(i => i.date !== date).sort((a, b) => key(b).localeCompare(key(a)));
  return { same, other };
}
function codeSummary(d) {
  const recs = d.items.map(scaleHBItem);
  const cal = recs.reduce((a, i) => a + i.cal, 0), p = recs.reduce((a, i) => a + (i.protein || 0), 0);
  return { cal, p, recs, text: `${recs.length} item${recs.length > 1 ? 's' : ''}: ${recs.map(i => `${esc(i.item)} ${Number.isFinite(i.qty) ? r2(i.qty) + ' ' + esc(i.qtyUnit) + ' ' : ''}${fmtN(i.cal)} cal`).join(', ')} · total ${fmtN(cal)} cal (${fmtN(cal * KJ)} kJ), ${r2(p)} g protein` };
}
function applyCode(parsed, targetId) {
  const d = parsed.data, target = targetId ? S.food.find(i => i.id === targetId && i.pending) : null;
  const date = target ? target.date : d.d, mealId = (target && target.mealId) || uid();
  const time = d.time || (target && target.time) || '';
  const recs = d.items.map(it => Object.assign(scaleHBItem(it), { date, time, mealId }));
  if (d.note) recs[0].note = d.note;
  if (target) { Object.assign(target, recs[0]); recs.shift(); }
  recs.forEach(r => S.food.push(Object.assign({ id: uid(), photo: null }, r)));
  S.importedCodes = S.importedCodes.concat([parsed.code]).slice(-200);
  if (!save()) return;
  migrateFoodsFromLog();
  const sm = codeSummary(d), t = dayTotals(date), st = S.settings;
  const lo = num(st.calMin), hi = num(st.calMax);
  const left = Number.isFinite(hi) ? (t.cal > hi ? `${fmtN(t.cal - hi)} cal over the top of your target` : `${fmtN(Math.max(0, lo - t.cal))}–${fmtN(hi - t.cal)} cal left`) : '';
  $('#fDay').value = date; $('#pastePanel').hidden = true;
  renderAll(); showTab('food');
  $('#pasteResult').innerHTML = `<div class="callout">✅ Saved ${target ? 'to your photo meal' : 'as a new meal'} on ${fmtDate(date)}: ${sm.text}.<br>Day total now ${fmtN(t.cal)} cal (${fmtN(t.cal * KJ)} kJ)${t.hasProtein ? `, ${Math.round(t.protein)} g protein` : ''}${left ? '; ' + left : ''}.</div>`;
  toast(`Saved ${fmtN(sm.cal)} cal from Health Bot`);
}
let pasteParsed = null;
function fillPasteTarget(parsed) {
  const { same, other } = pendingCandidates(parsed.data.d);
  const nth = ['newest', '2nd newest', '3rd newest'];
  const opt = (i, k) => `<option value="${i.id}">Photo meal ${fmtDate(i.date)}${i.time ? ' ' + esc(i.time) : ''}${k !== null ? ' (' + (nth[k] || (k + 1) + 'th newest') + ')' : ''}</option>`;
  $('#pasteTarget').innerHTML = same.map((i, k) => opt(i, same.length > 1 ? k : null)).join('') + other.map(i => opt(i, null)).join('') + `<option value="">New meal on ${fmtDate(parsed.data.d)} (no photo)</option>`;
  $('#pasteTargetWrap').hidden = false;
}
function renderPasteItems(parsed) {
  const box = $('#pasteItems'); if (!box) return;
  box.innerHTML = parsed.data.items.map((it, i) => {
    const d = itemDefaultQty(it);
    if (!Number.isFinite(it._qty)) it._qty = d.qty;
    if (!it._unit) it._unit = d.unit;
    const rec = scaleHBItem(it);
    return `<div class="item paste-item"><div class="grow"><b>${esc(it.n)}</b><div class="sub">${fmtN(rec.cal)} cal (${fmtN(rec.cal * KJ)} kJ)${rec.protein != null ? ` · ${rec.protein} g protein` : ''} <span class="tag ${it.src === 'label' ? '' : 'est'}">${esc(it.src)}</span></div></div>
      <div class="qtybox grid2">
        <label>Amount<input type="number" data-pqty="${i}" value="${it._qty}" step="any" min="0" inputmode="decimal"></label>
        <label>Unit<select data-punit="${i}"><option value="${esc(it._unit)}" selected>${esc(it._unit)}</option>${['g','ml','piece','serving'].filter(u => u !== it._unit).map(u => `<option value="${u}">${u}</option>`).join('')}</select></label>
      </div></div>`;
  }).join('');
}
function showPasteParsed(parsed, warn) {
  pasteParsed = parsed;
  parsed.data.items.forEach(it => { const d = itemDefaultQty(it); if (!Number.isFinite(it._qty)) it._qty = d.qty; if (!it._unit) it._unit = d.unit; });
  $('#pastePreview').innerHTML = `<div class="callout ${warn ? 'warn' : ''}">${warn ? esc(warn) + '<br>' : ''}Meal on ${fmtDate(parsed.data.d)}${parsed.data.time ? ' at ' + esc(parsed.data.time) : ''}: <span id="pasteSummary">${codeSummary(parsed.data).text}</span>${parsed.data.note ? '<br>Note: ' + esc(parsed.data.note) : ''}. You can change the amounts before saving.</div>`;
  renderPasteItems(parsed);
  fillPasteTarget(parsed);
  $('#pasteSave').disabled = false;
}
function openPastePanel(text, msg) {
  const panel = $('#pastePanel'); panel.hidden = false; showTab('food');
  $('#pasteText').value = text || ''; pasteParsed = null; $('#pasteSave').disabled = true; $('#pasteTargetWrap').hidden = true;
  $('#pastePreview').innerHTML = msg ? `<div class="callout warn">${esc(msg)}</div>` : '';
  if ($('#pasteItems')) $('#pasteItems').innerHTML = '';
  panel.scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('#pasteText').focus(), 300);
}
function handleCode(parsed, rawText) {
  const { same, other } = pendingCandidates(parsed.data.d);
  if (S.importedCodes.includes(parsed.code)) {
    openPastePanel(rawText, null); showPasteParsed(parsed, 'This code was already imported once. Save again only if it is a different meal.'); return;
  }
  if (same.length === 1 && other.length === 0) return applyCode(parsed, same[0].id);
  if (same.length === 0 && other.length === 0) return applyCode(parsed, null);
  if (same.length === 1) return applyCode(parsed, same[0].id);
  openPastePanel(rawText, null); showPasteParsed(parsed, 'More than one photo meal is waiting for that day. Pick which one this estimate is for.');
}
$('#pasteBtn').addEventListener('click', async () => {
  $('#pasteResult').innerHTML = '';
  let text = '';
  try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
  const p = parseHB(text);
  if (p.ok) handleCode(p, text);
  else openPastePanel('', text ? p.error : 'Paste Health Bot\'s message below (long-press, then Paste).');
});
$('#pasteText').addEventListener('input', () => {
  const raw = $('#pasteText').value, p = parseHB(raw);
  if (!raw.trim()) { $('#pastePreview').innerHTML = ''; if ($('#pasteItems')) $('#pasteItems').innerHTML = ''; $('#pasteSave').disabled = true; return; }
  if (!p.ok) { pasteParsed = null; $('#pasteSave').disabled = true; $('#pasteTargetWrap').hidden = true; $('#pastePreview').innerHTML = `<div class="callout warn">${esc(p.error)}</div>`; if ($('#pasteItems')) $('#pasteItems').innerHTML = ''; return; }
  const { same, other } = pendingCandidates(p.data.d);
  const dup = S.importedCodes.includes(p.code);
  if (!dup && (same.length + other.length <= 1 || same.length === 1)) handleCode(p, raw);
  else showPasteParsed(p, dup ? 'This code was already imported once. Save again only if it is a different meal.' : 'More than one photo meal is waiting. Pick which one this estimate is for.');
});
function refreshPasteLive() {
  if (!pasteParsed) return;
  const items = pasteParsed.data.items;
  $$('#pasteItems .paste-item').forEach((el, i) => {
    if (!items[i]) return;
    const rec = scaleHBItem(items[i]);
    const sub = el.querySelector('.sub');
    if (sub) sub.innerHTML = `${fmtN(rec.cal)} cal (${fmtN(rec.cal * KJ)} kJ)${rec.protein != null ? ` · ${rec.protein} g protein` : ''} <span class="tag ${items[i].src === 'label' ? '' : 'est'}">${esc(items[i].src)}</span>`;
  });
  const sm = codeSummary(pasteParsed.data);
  const line = $('#pasteSummary');
  if (line) line.innerHTML = sm.text;
}
$('#pasteItems').addEventListener('input', e => {
  if (!pasteParsed) return;
  const q = e.target.closest('[data-pqty]'), u = e.target.closest('[data-punit]');
  if (q) { const i = +q.dataset.pqty, v = num(q.value); if (pasteParsed.data.items[i]) pasteParsed.data.items[i]._qty = Number.isFinite(v) ? v : NaN; }
  if (u) { const i = +u.dataset.punit; if (pasteParsed.data.items[i]) pasteParsed.data.items[i]._unit = u.value; }
  refreshPasteLive();
});
$('#pasteSave').addEventListener('click', () => { if (pasteParsed) applyCode(pasteParsed, $('#pasteTarget').value || null); });
$('#pasteCancel').addEventListener('click', () => { $('#pastePanel').hidden = true; pasteParsed = null; if ($('#pasteItems')) $('#pasteItems').innerHTML = ''; });
window.HB = { parseHB, makeHB };
window.HT = { scaleFood, foodByName, foodById, migrateFoodsFromLog, allCatalog, foodKey, defaultAmount, parseHB, makeHB, scaleHBItem, suggestFoods, get builtins() { return BUILTIN_FOODS; }, get state() { return S; } };

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
  if (!obj || typeof obj !== 'object' || !['weights', 'food', 'foods', 'doses', 'peptides', 'health'].some(k => Array.isArray(obj[k]))) throw new Error('That file is not a Health Tracker data file.');
  const inc = normalise(obj);
  if (isEmpty() || confirm('Replace everything on this phone with the imported file?\n\nOK = replace all\nCancel = merge (imported entries win on the same day)')) { S = inc; }
  else {
    const byDate = new Map(S.weights.map(w => [w.date, w])); inc.weights.forEach(w => byDate.set(w.date, w)); S.weights = Array.from(byDate.values());
    for (const k of ['food', 'foods', 'peptides', 'doses', 'health', 'profile']) S[k] = mergeById(S[k], inc[k]);
    S.importedCodes = Array.from(new Set(S.importedCodes.concat(inc.importedCodes))).slice(-200);
    const sk = new Set(S.schedule.map(s => s.peptideId + s.date)); inc.schedule.forEach(s => { if (!sk.has(s.peptideId + s.date)) S.schedule.push(s); });
    S.dayNotes = Object.assign({}, S.dayNotes, inc.dayNotes);
    for (const [k, v] of Object.entries(inc.settings)) if (v !== null && v !== undefined && (S.settings[k] === null || S.settings[k] === undefined)) S.settings[k] = v;
  }
}
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  try {
    importData(JSON.parse(await file.text()));
    if (save()) { pSel = null; $('#dForm').dataset.init = ''; migrateFoodsFromLog(); renderAll(); resetForms(); toast(`Imported: ${S.weights.length} weights, ${S.food.length} food items, ${S.foods.length} saved foods, ${S.doses.length} doses.`); }
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
function bootHash() {
  if (location.hash.startsWith('#import=')) {
    const raw = decodeURIComponent(location.hash.slice(8));
    history.replaceState(null, '', '#food'); showTab('food');
    const p = parseHB(raw);
    if (p.ok) handleCode(p, raw); else openPastePanel(raw, p.error);
  } else { const h = location.hash.slice(1).replace(/[^a-z]/g, ''); showTab(h && document.getElementById('tab-' + h) ? h : 'weight'); }
}
renderAll(); resetForms(); renderPeptides();
loadBuiltins().then(() => { migrateFoodsFromLog(); renderAll(); bootHash(); }).catch(() => bootHash());
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
