// ============================================================
//  BCA Registry Taksin — Google Sheets Sync  (sync.js)  v3
//  Loaded by index.html via <script src="sync.js"></script>
//
//  SAFE VERSION: this file contains NO web address and NO passcode.
//  Each device types them once with the "⚙️ เชื่อมต่อ" button;
//  the browser remembers them (localStorage) on that device only.
// ============================================================

// ── Configuration ────────────────────────────────────────────
const STORAGE_KEY = 'bca_registry_taksin_v1';   // same key as the offline file → old data still found
const URL_KEY     = 'bca_script_url';
const PASS_KEY    = 'bca_script_key';
let APPS_SCRIPT_URL = '';
let APPS_SCRIPT_KEY = '';
try {
  APPS_SCRIPT_URL = localStorage.getItem(URL_KEY)  || '';
  APPS_SCRIPT_KEY = localStorage.getItem(PASS_KEY) || '';
} catch (e) {}

// ── App state (shared with index.html) ───────────────────────
let records      = [];
let currentId    = null;
let isDirty      = false;
let isOnline     = false;
let _loadingData = false;
let pendingUpload = [];        // local records that Sheets does not have yet (or has older)

// ── Ask for URL + passcode (button "⚙️ เชื่อมต่อ") ───────────
function promptForURL() {
  const url = prompt(
    '📋 วาง Apps Script Web App URL\n' +
    '(Google Apps Script → Deploy → Manage deployments → Web app URL)\n\n' +
    'ต้องขึ้นต้น https://script.google.com/macros/s/ และลงท้าย /exec',
    APPS_SCRIPT_URL);
  if (url === null) return false;                      // pressed Cancel
  const u = url.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(u)) {
    showToast('❌ URL ไม่ถูกต้อง', 'var(--accent)');
    return false;
  }
  const key = prompt('🔑 ใส่รหัสผ่าน (Passcode) ที่ตั้งไว้ใน Apps Script', APPS_SCRIPT_KEY);
  if (key === null) return false;
  APPS_SCRIPT_URL = u;
  APPS_SCRIPT_KEY = key.trim();
  try {
    localStorage.setItem(URL_KEY,  APPS_SCRIPT_URL);
    localStorage.setItem(PASS_KEY, APPS_SCRIPT_KEY);
  } catch (e) {}
  return true;
}

// ── small helpers ────────────────────────────────────────────
function _parse(text) {
  try { return JSON.parse(text.trim().replace(/^﻿/, '')); }
  catch (e) { throw new Error('ตอบกลับไม่ใช่ JSON: ' + text.slice(0, 60)); }
}
async function _post(body, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 20000);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', redirect: 'follow', signal: controller.signal,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ...body, key: APPS_SCRIPT_KEY })
    });
    const data = _parse(await res.text());
    if (data.status === 'error') throw new Error(data.error);
    return data;
  } finally { clearTimeout(timer); }
}

// ── LOAD from Google Sheets and MERGE with this device ───────
// Never throws away local data: a record that exists only here,
// or is newer here, is kept and queued in pendingUpload.
async function loadFromSheets() {
  setBadge('loading', '⟳ กำลังโหลด…');
  pendingUpload = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(
      APPS_SCRIPT_URL + '?action=getAll&key=' + encodeURIComponent(APPS_SCRIPT_KEY) + '&t=' + Date.now(),
      { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    const data = _parse(await res.text());
    if (data.status === 'error') throw new Error(data.error);

    const remote = (data.records || [])
      .filter(r => r._id || r.id)
      .map(r => {
        const id = Number(r._id || r.id) || String(r._id || r.id);
        return migrateRecord({
          ...r, id, _id: id,
          _created:  r._created  || new Date().toISOString(),
          _modified: r._modified || r._created || new Date().toISOString(),
          _version:  Number(r._version) || 1
        });
      });

    const merged = new Map(remote.map(r => [String(r.id), r]));
    records.forEach(local => {
      const k = String(local.id), r = merged.get(k);
      if (!r || (local._modified || '') > (r._modified || '')) {
        merged.set(k, local);
        pendingUpload.push(local);
      }
    });
    records = Array.from(merged.values());

    saveLocalCache();
    isOnline = true;
    setBadge('ok', `⬤ ออนไลน์ — ${records.length} ผู้ป่วย`);
    return true;

  } catch (err) {
    console.warn('Sheets load failed:', err.message);
    isOnline = false;
    let reason = err.name === 'AbortError' ? 'timeout' : err.message.slice(0, 40);
    if (/passcode|รหัส|unauthor/i.test(err.message)) reason = 'รหัสผ่านไม่ถูกต้อง';
    setBadge('warn', `⚠️ ออฟไลน์ (${reason}) — ในเครื่อง ${records.length} ราย`);
    return false;
  }
}

// ── Offer to upload what only this device has ────────────────
async function offerUploadPending() {
  if (!pendingUpload.length || !isOnline) return;
  const n = pendingUpload.length;
  if (!confirm(`พบข้อมูลในเครื่องนี้ ${n} ราย ที่ยังไม่อยู่ใน Google Sheets (หรือใหม่กว่า)\n\n` +
               `อัปโหลดขึ้น Google Sheets ตอนนี้หรือไม่?\n(ข้อมูลผู้ป่วยจะถูกส่งออกนอกเครื่อง)`)) {
    showToast(`ยังไม่อัปโหลด ${n} ราย — กด ↻ Sync เมื่อพร้อม`, 'var(--gold)');
    return;
  }
  let ok = 0;
  for (let i = 0; i < n; i++) {
    setBadge('loading', `⟳ อัปโหลด ${i + 1}/${n}…`);
    if (await saveToSheets(pendingUpload[i])) ok++;
  }
  pendingUpload = [];
  setBadge(ok === n ? 'ok' : 'warn', `⬤ ออนไลน์ — ${records.length} ผู้ป่วย`);
  showToast(ok === n ? `✅ อัปโหลดครบ ${ok} ราย` : `⚠️ อัปโหลดสำเร็จ ${ok}/${n} ราย — กด ↻ Sync ซ้ำ`,
            ok === n ? 'var(--teal)' : 'var(--gold)');
}

// ── SAVE one record ──────────────────────────────────────────
async function saveToSheets(record) {
  if (!APPS_SCRIPT_URL) return false;
  try {
    await _post({ action: 'save', record: { ...record, _id: String(record.id) } }, 25000);
    return true;
  } catch (err) { console.warn('Sheets save failed:', err.message); return false; }
}

// ── DELETE one record ────────────────────────────────────────
async function deleteFromSheets(id) {
  if (!APPS_SCRIPT_URL) return false;
  try { await _post({ action: 'delete', id: String(id) }); return true; }
  catch (err) { console.warn('Sheets delete failed:', err.message); return false; }
}

// ── Local copy in this browser ───────────────────────────────
function saveLocalCache() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
  catch (e) { showToast('⚠️ บันทึกในเบราว์เซอร์ไม่ได้ — กด Backup ทันที', 'var(--accent)'); }
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
function saveToStorage() { saveLocalCache(); }
