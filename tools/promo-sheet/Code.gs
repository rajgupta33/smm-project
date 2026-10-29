/**
 * Promo sheet bridge for the SMM panel's reseller marketing.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as:      Me
 *   Who has access:  Anyone
 *
 * Then put the /exec URL in the BACKEND environment as PROMO_SHEET_SCRIPT_URL
 * and this key as PROMO_SHEET_SECRET_KEY. Only the panel backend ever calls
 * this script: resellers talk to the panel API and never see the sheet, the
 * URL or this key.
 *
 * Works with ANY spreadsheet your Google account can edit - the admin pastes
 * the sheet link when creating a campaign in the panel.
 */

// Change this to your own private password and set the same value as
// PROMO_SHEET_SECRET_KEY in the backend environment.
const SECRET_KEY = 'CHANGE-ME-to-a-private-key';

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (SECRET_KEY.indexOf('CHANGE-ME') === 0) throw new Error('Set SECRET_KEY in the Apps Script first');
    if (p.key !== SECRET_KEY) throw new Error('Invalid key');
    let out;
    switch (p.action) {
      case 'ping': out = { ok: true }; break;
      case 'tabs': out = tabs_(p); break;
      case 'rows': out = rows_(p); break;
      case 'mark': out = mark_(p); break;
      default: throw new Error('Unknown action');
    }
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet_(p) {
  const ss = SpreadsheetApp.openById(p.id);
  const sh = p.tab ? ss.getSheetByName(p.tab) : ss.getSheets()[0];
  if (!sh) throw new Error('Tab not found: ' + p.tab);
  return sh;
}

function colNum_(c) {
  c = String(c || '').trim().toUpperCase();
  if (!c) return 0;
  let n = 0;
  for (let i = 0; i < c.length; i++) {
    const k = c.charCodeAt(i) - 64;
    if (k < 1 || k > 26) throw new Error('Bad column: ' + c);
    n = n * 26 + k;
  }
  return n;
}

function tabs_(p) {
  const ss = SpreadsheetApp.openById(p.id);
  return { ok: true, title: ss.getName(), tabs: ss.getSheets().map(s => s.getName()) };
}

/**
 * cols = "name,number,link,status" column letters (in that order).
 * Returns rows[i] = [name, number, link, status] for sheet row i+1.
 */
function rows_(p) {
  const sh = sheet_(p);
  const cols = String(p.cols || '').split(',').map(colNum_);
  const LINK = 2;
  const last = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const out = [];
  for (let i = 0; i < last; i++) out.push(cols.map(() => ''));
  if (!last) return { ok: true, rows: out };

  cols.forEach((c, j) => {
    if (!c || c > lastCol) return;
    const rng = sh.getRange(1, c, last, 1);
    const disp = rng.getDisplayValues();
    let rich = null, forms = null;
    if (j === LINK) { rich = rng.getRichTextValues(); forms = rng.getFormulas(); }
    for (let i = 0; i < last; i++) {
      let v = String(disp[i][0] || '').trim();
      if (j === LINK && !/^(https?|whatsapp|intent):/i.test(v)) {
        // Cell shows text but holds a hyperlink (chip or =HYPERLINK formula)
        const url = rich[i][0] && rich[i][0].getLinkUrl();
        const m = String(forms[i][0] || '').match(/HYPERLINK\(\s*"([^"]+)"/i);
        v = url || (m && m[1]) || v;
      }
      out[i][j] = v;
    }
  });
  return { ok: true, rows: out };
}

/**
 * Writes the status cell. Without force=1 an already-filled cell is left
 * untouched (returns already:true) so a row is never marked twice.
 */
function mark_(p) {
  const row = parseInt(p.row, 10);
  if (!(row >= 1)) throw new Error('Bad row');
  const col = colNum_(p.col);
  if (!col) throw new Error('Status column missing');
  const sh = sheet_(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cell = sh.getRange(row, col);
    const existing = cell.getDisplayValue();
    if (existing && p.force !== '1') return { ok: true, already: true, value: existing };
    const value = p.value != null
      ? String(p.value)
      : 'Sent ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy HH:mm');
    cell.setValue(value);
    SpreadsheetApp.flush();
    return { ok: true, already: false, value: value };
  } finally {
    lock.releaseLock();
  }
}
