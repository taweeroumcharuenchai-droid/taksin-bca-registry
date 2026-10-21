// ============================================================
//  BCA Registry Taksin — Google Sheets Sync  (sync.js)
//  Loaded by index.html via <script src="sync.js"></script>
//  Apps Script URL is baked in — no popup needed.
// ============================================================

// ── Configuration ────────────────────────────────────────────
let APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz12VTj3-dMPVvgXeNm60dkuHwMBRZph6hCgr6icWL3GnpdlE4tY9PRphY_Bwhy1E41/exec';
const STORAGE_KEY   = 'bca_registry_taksin_v1';

// ── App state (shared with index.html) ───────────────────────
let records      = [];
let currentId    = null;
let isDirty      = false;
let isOnline     = false;
let _loadingData = false;

// ── URL helper (kept for manual override, rarely needed) ─────
function promptForURL() {
  const url = prompt(
    '📋 กรุณาใส่ Apps Script Web App URL\n' +
    '(ได้จาก Google Apps Script > Deploy > Manage deployments)\n\n' +
    'ตัวอย่าง: https://script.google.com/macros/s/AKfy.../exec',
    APPS_SCRIPT_URL);
  if (url && url.trim().startsWith('https://script.google.com')) {
    APPS_SCRIPT_URL = url.trim();
    localStorage.setItem('bca_script_url', APPS_SCRIPT_URL);
    return true;
  } else if (url !== null) {
    showToast('❌ URL ไม่ถูกต้อง', 'var(--accent)');
  }
  return false;
}

// ── LOAD all records from Google Sheets ──────────────────────
async function loadFromSheets() {
  setBadge('loading', '⟳ กำลังโหลด…');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(APPS_SCRIPT_URL + '?t=' + Date.now(), {
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    const text = await res.text();
    let data;
    try { data = JSON.parse(text.trim().replace(/^﻿/, '')); }
    catch (e) { throw new Error('Response not JSON: ' + text.slice(0, 80)); }

    if (data.status === 'error') throw new Error(data.error);

    records = (data.records || []).map(r => {
      const id = Number(r._id || r.id) || String(r._id || r.id || Date.now());
      return migrateRecord({
        ...r, id, _id: id,
        _created:  r._created  || new Date().toISOString(),
        _modified: r._modified || r._created || new Date().toISOString(),
        _version:  Number(r._version) || 1
      });
    });

    saveLocalCache();
    isOnline = true;
    setBadge('ok', `⬤ ออนไลน์ — ${records.length} ผู้ป่วย`);
    return true;

  } catch (err) {
    console.warn('Sheets load failed:', err.message);
    isOnline = false;
    loadLocalCache();
    const reason = err.name === 'AbortError' ? 'timeout' : err.message.slice(0, 30);
    setBadge('warn', `⚠️ ออฟไลน์ (${reason}) — cache ${records.length} ราย`);
    return false;
  }
}

// ── SAVE one record to Google Sheets ─────────────────────────
async function saveToSheets(record) {
  if (!APPS_SCRIPT_URL) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'save', record: { ...record, _id: String(record.id) } })
    });
    clearTimeout(timeout);

    const text = await res.text();
    const data = JSON.parse(text.trim().replace(/^﻿/, ''));
    if (data.status === 'error') throw new Error(data.error);
    return true;

  } catch (err) {
    console.warn('Sheets save failed:', err.message);
    return false;
  }
}

// ── DELETE one record from Google Sheets ─────────────────────
async function deleteFromSheets(id) {
  if (!APPS_SCRIPT_URL) return false;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'delete', id: String(id) })
    });
    const d = JSON.parse((await res.text()).trim().replace(/^﻿/, ''));
    return d.status !== 'error';
  } catch (e) {
    return false;
  }
}

// ── Local cache (offline backup in browser) ──────────────────
function saveLocalCache() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch (e) {}
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      records = JSON.parse(raw).map(r => migrateRecord({ ...r }));
      records.forEach(r => {
        if (!r._created)  r._created  = new Date().toISOString();
        if (!r._modified) r._modified = r._created;
        if (!r._version)  r._version  = 1;
      });
    }
  } catch (e) { records = []; }
}

// Alias used inside index.html
function saveToStorage() { saveLocalCache(); }

// ── Status badge ─────────────────────────────────────────────
function setBadge(state, text) {
  const b = document.getElementById('storage-badge');
  if (!b) return;
  b.textContent = text;
  b.className = 'storage-badge ' + (state === 'ok' ? 'storage-ok' : 'storage-warn');
}

function updateStorageBadge(ok, msg) {
  setBadge(ok ? 'ok' : 'warn',
    ok ? `⬤ บันทึกแล้ว ${records.length} ราย` : `⚠️ ${msg || 'error'}`);
}

function checkStorageAvailable() {
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    return true;
  } catch (e) { return false; }
}
