// app.js — Dashboard fetch + render logic

let currentTab = 'live';
let refreshTimer = null;
let summaryData = {};
let currentLeadsSort = "recent";

function setLeadsSort(sort) {
  currentLeadsSort = sort;
  const btnRecent = document.getElementById("leads-sort-recent");
  const btnHot = document.getElementById("leads-sort-hot");
  if (sort === "recent") {
    btnRecent.className = "bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition";
    btnHot.className = "bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold px-4 py-2 rounded-lg transition";
  } else {
    btnHot.className = "bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition";
    btnRecent.className = "bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold px-4 py-2 rounded-lg transition";
  }
  loadLeads();
}

const WEEKDAYS_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
function fmtDateTimeDay(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts.replace(' ','T'));
    const day = WEEKDAYS_HE[d.getDay()];
    const date = d.toLocaleDateString('he-IL');
    const time = d.toLocaleTimeString('he-IL', {hour: '2-digit', minute: '2-digit'});
    return `${date} · ${day} · ${time}`;
  } catch { return ts; }
}

function petChips(pets_detail, fallback_text) {
  if (pets_detail && pets_detail.length) {
    return pets_detail.map(p => {
      const speciesPart = p.species ? (' \u00B7 ' + p.species) : '';
      const insPart = p.insurance
        ? '<span class="ml-1 text-indigo-300 font-semibold">\uD83D\uDEE1 ' + p.insurance + '</span>'
        : '';
      const breedAttr = p.breed ? ' title="' + p.breed + '"' : '';
      return '<span class="inline-block text-xs px-2 py-0.5 rounded-md bg-gray-700 text-gray-100 ml-1 mb-0.5"' + breedAttr + '>' +
             p.name + speciesPart + insPart + '</span>';
    }).join('');
  }
  return fallback_text || '\u2014';
}

function petSummaryLine(pets_detail) {
  if (!pets_detail || !pets_detail.length) return '';
  return pets_detail.map(p => {
    const ins = p.insurance ? ' (' + p.insurance + ')' : '';
    return p.name + (p.species ? ' \u00B7 ' + p.species : '') + ins;
  }).join(' | ');
}


// ---- Utilities ----

function showLoading(show) {
  const dot = document.getElementById('loading-dot');
  if (show) dot.classList.remove('hidden');
  else dot.classList.add('hidden');
}

function updateRefreshTime() {
  const el = document.getElementById('last-refresh');
  if (el) el.textContent = 'עדכון אחרון: ' + new Date().toLocaleTimeString('he-IL');
}

async function apiFetch(url) {
  showLoading(true);
  try {
    const res = await fetch(url);
    if (res.status === 401) { window.location.href = '/login'; return null; }
    return await res.json();
  } catch (e) {
    console.error('fetch error', url, e);
    return null;
  } finally {
    showLoading(false);
    updateRefreshTime();
  }
}


function voicemailBadge(suspected) {
  if (!suspected) return '';
  return '<span class="inline-block bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full ml-1" title="שיחה שנענתה בפחות מ-49 שניות — חשד לתא קולי / הודעה אוטומטית / ניתוק מהיר">\ud83d\udceb חשד</span>';
}

function statusBadge(status) {
  if (status === 'Answered') return '<span class="bg-green-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">נענה</span>';
  if (status === 'Busy') return '<span class="bg-yellow-500 text-black text-xs px-2 py-0.5 rounded-full font-bold">תפוס</span>';
  return '<span class="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">לא נענה</span>';
}

function fmtDuration(sec) {
  if (!sec) return '—';
  if (sec < 60) return sec + 'ש';
  return Math.floor(sec/60) + 'ד ' + (sec%60) + 'ש';
}

function fmtDate(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'});
  } catch { return ts; }
}

function fmtDateShort(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    return d.toLocaleDateString('he-IL');
  } catch { return ts; }
}

// ---- Summary Cards ----

async function loadSummaryCards() {
  const [today, week, month] = await Promise.all([
    apiFetch('/api/summary?days=1'),
    apiFetch('/api/summary?days=7'),
    apiFetch('/api/summary?days=30'),
  ]);
  summaryData = { today, week, month };

  function missedColor(pct) {
    if (pct >= 30) return 'text-red-400';
    if (pct >= 20) return 'text-yellow-400';
    return 'text-green-400';
  }

  function card(label, data) {
    if (!data) return `<div class="bg-gray-800 rounded-xl p-4"><p class="text-gray-400">${label}</p><p class="text-gray-500">שגיאה</p></div>`;
    const pct = data.missed_pct || 0;
    const col = missedColor(pct);
    const vm = data.voicemail_suspect || 0;
    const incl = data.missed_incl_vm || 0;
    const inclPct = data.missed_pct_incl_vm || 0;
    const vmLine = vm > 0 ? `<p class="text-xs text-amber-400">\ud83d\udceb ${vm} חשד תא קולי → סך הכל ${incl} (${inclPct}%)</p>` : '';
    return `
    <div class="bg-gray-800 border border-gray-700 rounded-xl p-5 flex flex-col gap-1">
      <p class="text-gray-400 text-sm font-medium">${label}</p>
      <p class="text-3xl font-bold text-white">${data.total.toLocaleString()}</p>
      <p class="text-sm ${col} font-semibold">${pct}% לא נענו</p>
      <p class="text-xs text-gray-500">${data.lost} אבודות</p>
      ${vmLine}
    </div>`;
  }

  document.getElementById('summary-cards').innerHTML =
    card('היום', today) + card('השבוע', week) + card('החודש', month);
}

// ---- Tab switching ----

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('border-indigo-500', 'text-indigo-300');
    btn.classList.add('border-transparent', 'text-gray-400');
  });
  const active = document.getElementById('tab-' + tab);
  if (active) {
    active.classList.add('border-indigo-500', 'text-indigo-300');
    active.classList.remove('border-transparent', 'text-gray-400');
  }
  ['live','missed','leads','heatmap','settings'].forEach(t => {
    const el = document.getElementById('tab-' + t + '-content');
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  loadTab(tab);
}

function loadTab(tab) {
  if (tab === 'live') loadLive();
  else if (tab === 'missed') loadMissed();
  else if (tab === 'leads') loadLeads();
  else if (tab === 'heatmap') loadHeatmap();
  else if (tab === 'settings') loadSettings();
}

// ---- Live Tab ----

async function loadLive() {
  const data = await apiFetch('/api/today-live');
  if (!data) return;
  const tbody = document.getElementById('live-table-body');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">אין שיחות היום עדיין</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(row => {
    const isM = row.status !== 'Answered';
    const bg = isM ? 'bg-rose-950/30' : '';
    const client = row.client || {};
    return `<tr class="hover:bg-gray-800/50 cursor-pointer ${bg}" onclick="openHistory('${row.from_num}')">
      <td class="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">${fmtDate(row.ts)}</td>
      <td class="px-4 py-3 font-mono text-sm text-indigo-300">${row.from_num}</td>
      <td class="px-4 py-3">${statusBadge(row.status)}${voicemailBadge(row.suspected_voicemail)}</td>
      <td class="px-4 py-3 text-white">${client.name || '<span class="text-gray-500">לא ידוע</span>'}</td>
      <td class="px-4 py-3 text-xs">${petChips(client.pets_detail, client.pets)}</td>
      <td class="px-4 py-3 text-gray-400 text-xs">${client.last_visit ? fmtDateShort(client.last_visit) : '—'}</td>
      <td class="px-4 py-3 text-gray-400 text-xs">${fmtDuration(row.total_sec)}</td>
    </tr>`;
  }).join('');
}

// ---- Missed Tab ----

function dateOffsetStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function countSummary(rows) {
  if (!rows || !rows.length) return '0';
  let strict = 0, vm = 0;
  for (const r of rows) {
    strict += r.strict_missed || 0;
    vm += r.voicemail_count || 0;
  }
  return `${strict}-${strict + vm}`;
}

function setCount(elId, rows) {
  const el = document.getElementById(elId);
  if (el) el.textContent = countSummary(rows);
}

async function loadMissed() {
  const d0 = dateOffsetStr(0);  // today
  const d1 = dateOffsetStr(1);  // yesterday
  const d2 = dateOffsetStr(2);  // day before
  const d3 = dateOffsetStr(3);  // 3 days ago

  const [today, day1, day2, day3, rg3d, week, month] = await Promise.all([
    apiFetch(`/api/missed/top?include_suspect=1&limit=500&date_from=${d0}&date_to=${d0}`),
    apiFetch(`/api/missed/top?include_suspect=1&limit=500&date_from=${d1}&date_to=${d1}`),
    apiFetch(`/api/missed/top?include_suspect=1&limit=500&date_from=${d2}&date_to=${d2}`),
    apiFetch(`/api/missed/top?include_suspect=1&limit=500&date_from=${d3}&date_to=${d3}`),
    apiFetch('/api/missed/top?days=3&include_suspect=1&limit=500'),
    apiFetch('/api/missed/top?days=7&include_suspect=1'),
    apiFetch('/api/missed/top?days=30&include_suspect=1'),
  ]);

  renderMissedList('missed-today-list', today);
  renderMissedList('missed-d1-list', day1);
  renderMissedList('missed-d2-list', day2);
  renderMissedList('missed-d3-list', day3);
  renderMissedList('missed-3d-list', rg3d);
  renderMissedList('missed-week-list', week);
  renderMissedList('missed-month-list', month);

  setCount('missed-today-count', today);
  setCount('missed-d1-count', day1);
  setCount('missed-d2-count', day2);
  setCount('missed-d3-count', day3);
  setCount('missed-3d-count', rg3d);
  setCount('missed-week-count', week);
  setCount('missed-month-count', month);
}

function renderMissedList(containerId, data) {
  const el = document.getElementById(containerId);
  if (!data || !data.length) { el.innerHTML = '<p class="text-gray-500 text-sm">אין נתונים</p>'; return; }
  el.innerHTML = data.map((row, i) => {
    const client = row.client || {};
    const name = client.name || '<span class="text-gray-400 text-xs">לא ידוע</span>';
    return `<div class="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-700/50 transition" onclick="openHistory('${row.from_num}')">
      <span class="text-gray-500 font-bold text-sm w-6 text-center">${i+1}</span>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-white">${name}</p>
        <p class="text-gray-400 text-xs font-mono">${row.from_num}</p>
        ${client.pets_detail && client.pets_detail.length ? `<p class="text-xs mt-1">${petChips(client.pets_detail, client.pets)}</p>` : ''}
        ${client.last_visit ? `<p class="text-gray-500 text-xs">ביקור: ${fmtDateShort(client.last_visit)}</p>` : ''}
      </div>
      <div class="flex flex-col items-end gap-1">
        <span class="bg-red-700 text-white text-xs font-bold rounded-full px-2.5 py-1" title="סך שיחות שלא נענו + חשד תא קולי">${row.miss_count}</span>
        ${row.voicemail_count > 0 ? `<span class="text-amber-400 text-[10px]" title="מתוכן חשד תא קולי">\ud83d\udceb ${row.voicemail_count}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ---- Leads Tab ----

async function loadLeads() {
  const data = await apiFetch('/api/leads?days=30&sort=' + currentLeadsSort);
  const tbody = document.getElementById('leads-table-body');
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-500">אין לידים חדשים</td></tr>';
    return;
  }
  tbody.innerHTML = data.map((row, i) => `
    <tr class="hover:bg-gray-800/50 cursor-pointer" onclick="openHistory('${row.from_num}')">
      <td class="px-4 py-3 text-gray-500 text-sm">${i+1}</td>
      <td class="px-4 py-3 font-mono text-indigo-300">${row.from_num}</td>
      <td class="px-4 py-3 text-center"><span class="bg-red-700 text-white text-xs font-bold rounded-full px-2.5 py-1">${row.miss_count}</span></td>
      <td class="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">${fmtDateTimeDay(row.first_seen)}</td>
      <td class="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">${fmtDateTimeDay(row.last_seen)}</td>
    </tr>`).join('');
}

// ---- Heatmap Tab ----

const DAYS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const DAYS_FULL = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

async function loadHeatmap() {
  const data = await apiFetch('/api/heatmap?days=30');
  if (!data) return;
  const grid = data.grid; // [7][24]

  // Find max for color scaling
  let maxVal = 0;
  for (let wd = 0; wd < 7; wd++)
    for (let h = 0; h < 24; h++)
      if (grid[wd][h] > maxVal) maxVal = grid[wd][h];

  function cellColor(val) {
    if (!val) return 'bg-gray-800 text-gray-700';
    const ratio = val / (maxVal || 1);
    if (ratio > 0.8) return 'bg-indigo-500 text-white';
    if (ratio > 0.6) return 'bg-indigo-600 text-white';
    if (ratio > 0.4) return 'bg-indigo-700 text-indigo-200';
    if (ratio > 0.2) return 'bg-indigo-800 text-indigo-300';
    return 'bg-indigo-900/60 text-indigo-400';
  }

  const hours = Array.from({length:14}, (_,i) => i+7); // 7:00–20:00

  let html = '<div class="inline-block">';
  html += '<div class="flex gap-1 mb-1">';
  html += '<div class="w-10"></div>'; // spacer for day labels
  hours.forEach(h => {
    html += `<div class="heatmap-cell flex items-center justify-center text-gray-500 text-xs font-mono">${h}:00</div>`;
  });
  html += '</div>';

  for (let wd = 0; wd < 7; wd++) {
    html += '<div class="flex gap-1 mb-1 items-center">';
    html += `<div class="w-10 text-xs text-gray-400 font-bold text-right pl-1">${DAYS_HE[wd]}</div>`;
    hours.forEach(h => {
      const val = grid[wd][h] || 0;
      html += `<div class="heatmap-cell rounded flex items-center justify-center text-xs font-bold ${cellColor(val)} cursor-default" title="${DAYS_FULL[wd]} ${h}:00 — ${val} שיחות">${val || ''}</div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  document.getElementById('heatmap-container').innerHTML = html;
}

// ---- Client History Modal ----

async function openHistory(phone) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-title').textContent = phone;
  document.getElementById('modal-subtitle').textContent = 'טוען היסטוריה...';
  document.getElementById('modal-content').innerHTML = '<p class="text-gray-500 text-center py-6">טוען...</p>';

  const data = await apiFetch('/api/client-history?phone=' + encodeURIComponent(phone));
  if (!data) return;

  const client = data.client || {};
  let subtitle = '';
  if (client.name) subtitle = client.name;
  const petsLine = petSummaryLine(client.pets_detail) || client.pets || '';
  if (petsLine) subtitle += (subtitle ? ' | ' : '') + petsLine;
  if (client.last_visit) subtitle += (subtitle ? ' | ביקור: ' : 'ביקור: ') + fmtDateShort(client.last_visit);
  document.getElementById('modal-subtitle').textContent = subtitle || 'לא ידוע במערכת';

  const calls = data.calls || [];
  if (!calls.length) {
    document.getElementById('modal-content').innerHTML = '<p class="text-gray-500 text-center py-6">אין שיחות</p>';
    return;
  }

  document.getElementById('modal-content').innerHTML = `
    <div class="space-y-2">
      ${calls.map(c => `
        <div class="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2.5 gap-3 ${c.status !== 'Answered' ? 'border-r-2 border-red-600' : ''}">
          <span class="text-xs text-gray-400 whitespace-nowrap">${fmtDate(c.ts)}</span>
          <span>${statusBadge(c.status)}</span>
          <span class="text-xs text-gray-400">${fmtDuration(c.total_sec)}</span>
        </div>`).join('')}
    </div>`;
}

function closeModal(event) {
  if (event.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.add('hidden');
  }
}


// ---- Settings Tab ----

async function loadSettings() {
  const data = await apiFetch('/api/settings');
  if (!data) return;

  // Text fields
  ['report_recipients', 'template_warm_open', 'template_overnight_long', 'template_overnight_morning'].forEach(key => {
    const el = document.getElementById('setting-' + key);
    if (el && data[key] !== undefined) el.value = data[key];
  });

  // Day of week select (read-only, just populate)
  const dow = document.getElementById('setting-report_day_of_week');
  if (dow && data['report_day_of_week'] !== undefined) {
    dow.value = data['report_day_of_week'];
  }

  // Hour (read-only)
  const hr = document.getElementById('setting-report_hour');
  if (hr && data['report_hour'] !== undefined) hr.value = data['report_hour'];

  // Enabled checkbox
  const cb = document.getElementById('setting-report_enabled');
  if (cb && data['report_enabled'] !== undefined) {
    cb.checked = data['report_enabled'].toLowerCase() === 'true';
  }
}

async function saveSettings() {
  const payload = {};

  ['report_recipients', 'template_warm_open', 'template_overnight_long', 'template_overnight_morning'].forEach(key => {
    const el = document.getElementById('setting-' + key);
    if (el) payload[key] = el.value;
  });

  const cb = document.getElementById('setting-report_enabled');
  if (cb) payload['report_enabled'] = cb.checked ? 'true' : 'false';

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });

  if (res.status === 401) { window.location.href = '/login'; return; }

  const data = await res.json();
  if (data && data.ok) {
    showToast();
  } else {
    alert('Error saving settings');
  }
}

function showToast() {
  const toast = document.getElementById('settings-toast');
  if (!toast) return;
  toast.classList.remove('hidden');
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.transition = 'opacity 0.5s';
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.classList.add('hidden');
      toast.style.opacity = '1';
      toast.style.transition = '';
    }, 500);
  }, 2500);
}


// ---- Auto-refresh ----

function refreshAll() {
  loadSummaryCards();
  loadTab(currentTab);
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, 120000);
}

// ---- Init ----

function init() {
  loadSummaryCards();
  // Activate tab from URL hash if present
  const hash = window.location.hash.replace('#', '');
  const validTabs = ['live','missed','leads','heatmap','settings'];
  if (hash && validTabs.includes(hash)) {
    switchTab(hash);
  } else {
    loadLive();
  }
  startAutoRefresh();
}
// Script is at end of body; DOM ready enough to call directly
init();
