// Google Apps Script source for the "Drawing File Tools" (reindex / duplicate check / trash).
// It is appended to the Cloud Sync script (see generateGasCode() in storageSync.js and google_drive_sync_service.gs).
// Written with String.raw so regex backslashes survive; the code must not contain backticks or ${ }.
export const DWG_TOOLS_GAS = String.raw`
// ==============================================================================
// Drawing File Tools: reindex PDF drawings, find duplicates, trash old revisions
// File naming: "<description>_<DrawingCode>[_Rev.NN].pdf"  (no Rev suffix = original)
// ==============================================================================
const DWG_INDEX_FILE_NAME = 'dwg_index.json';
const DWG_INDEX_STATE_FILE_NAME = 'dwg_index_state.json';
const DWG_INDEX_TIME_BUDGET_MS = 200000;

function dwgJson_(obj) {
  obj.dwgTool = true;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Splits a PDF file name into the drawing code (key) and its revision number (-1 = no Rev suffix)
function dwgParseName_(fileName) {
  let base = String(fileName || '').replace(/\.pdf$/i, '');
  let rev = -1;
  let revText = '';
  const m = base.match(/[_\s-]*Rev[.\s_-]*([A-Za-z0-9]+)\s*$/i);
  if (m) {
    base = base.slice(0, m.index);
    revText = m[1];
    rev = /^\d+$/.test(revText) ? parseInt(revText, 10) : (revText.toUpperCase().charCodeAt(0) - 64);
  }
  const us = base.lastIndexOf('_');
  const code = (us >= 0 ? base.slice(us + 1) : base).replace(/\s+/g, '').toUpperCase();
  return { key: code, rev: rev, revText: revText };
}

function dwgCleanName_(name) {
  return String(name || '').replace(/[-_\s.]/g, '').toUpperCase();
}

// One resumable step of the reindex: walks folders breadth-first until the time budget is used up.
function dwgReindexStep_(rootFolderId, reset) {
  const root = DriveApp.getFolderById(TARGET_FOLDER_ID);
  let state = reset ? null : readJsonFile(root, DWG_INDEX_STATE_FILE_NAME);
  if (!state || !Array.isArray(state.queue)) {
    state = { queue: [rootFolderId], files: [], folders: 0, startedAt: new Date().toISOString() };
  }
  const t0 = Date.now();
  while (state.queue.length > 0 && Date.now() - t0 < DWG_INDEX_TIME_BUDGET_MS) {
    const fid = state.queue.pop();
    let f = null;
    try { f = DriveApp.getFolderById(fid); } catch (err) { f = null; }
    if (!f) continue;
    const folderName = f.getName();
    const files = f.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      if (!/\.pdf$/i.test(name)) continue;
      state.files.push({ id: file.getId(), n: name, f: folderName, m: file.getLastUpdated().getTime(), s: file.getSize() });
    }
    const subs = f.getFolders();
    while (subs.hasNext()) state.queue.push(subs.next().getId());
    state.folders++;
  }
  const done = state.queue.length === 0;
  if (done) {
    const index = { updatedAt: new Date().toISOString(), folders: state.folders, count: state.files.length, files: state.files };
    saveTextFile(root, DWG_INDEX_FILE_NAME, JSON.stringify(index), MimeType.PLAIN_TEXT);
    const old = root.getFilesByName(DWG_INDEX_STATE_FILE_NAME);
    while (old.hasNext()) old.next().setTrashed(true);
  } else {
    saveTextFile(root, DWG_INDEX_STATE_FILE_NAME, JSON.stringify(state), MimeType.PLAIN_TEXT);
  }
  return { status: 'success', done: done, folders: state.folders, files: state.files.length, remaining: state.queue.length };
}

function dwgLoadIndex_() {
  return readJsonFile(DriveApp.getFolderById(TARGET_FOLDER_ID), DWG_INDEX_FILE_NAME);
}

// Groups the indexed files by drawing code. Per group the newest Rev is kept (newest modified date breaks ties).
function dwgFindDuplicates_(index) {
  const groups = {};
  (index.files || []).forEach(function (f) {
    const p = dwgParseName_(f.n);
    if (!p.key) return;
    (groups[p.key] = groups[p.key] || []).push({ id: f.id, name: f.n, folder: f.f, modified: f.m, size: f.s, rev: p.rev, revText: p.revText });
  });
  const out = [];
  Object.keys(groups).forEach(function (key) {
    const list = groups[key];
    if (list.length < 2) return;
    list.sort(function (a, b) { return (b.rev - a.rev) || (b.modified - a.modified); });
    out.push({ key: key, keep: list[0], remove: list.slice(1) });
  });
  out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
  return out;
}

// Fast lookup of a drawing PDF through the index (newest Rev wins). Returns null when there is no index / no hit.
function dwgFindInIndex_(dwgNo) {
  const index = dwgLoadIndex_();
  if (!index || !Array.isArray(index.files)) return null;
  const cleanKey = dwgCleanName_(dwgNo);
  if (!cleanKey) return null;
  let best = null;
  index.files.forEach(function (f) {
    if (dwgCleanName_(f.n).indexOf(cleanKey) < 0) return;
    const p = dwgParseName_(f.n);
    const exact = dwgCleanName_(p.key) === cleanKey ? 1 : 0;
    if (!best || exact > best.exact || (exact === best.exact && (p.rev > best.rev || (p.rev === best.rev && f.m > best.m)))) {
      best = { id: f.id, name: f.n, exact: exact, rev: p.rev, m: f.m };
    }
  });
  return best;
}

function handleDwgToolAction_(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'dwg-reindex') {
    const rootId = (e.parameter.dwgFolderId && String(e.parameter.dwgFolderId).trim()) || TARGET_DWG_FOLDER_ID;
    return dwgJson_(dwgReindexStep_(rootId, e.parameter.reset === '1'));
  }
  if (action === 'dwg-duplicates') {
    const index = dwgLoadIndex_();
    if (!index) return dwgJson_({ status: 'error', code: 'no-index', message: 'ยังไม่มี dwg_index.json กรุณา Reindex ก่อน' });
    const groups = dwgFindDuplicates_(index);
    return dwgJson_({ status: 'success', indexUpdatedAt: index.updatedAt, totalFiles: index.count, groups: groups });
  }
  if (action === 'dwg-trash') {
    const index = dwgLoadIndex_();
    if (!index) return dwgJson_({ status: 'error', code: 'no-index', message: 'ยังไม่มี dwg_index.json กรุณา Reindex ก่อน' });
    const ids = String(e.parameter.ids || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const known = {};
    index.files.forEach(function (f) { known[f.id] = true; });
    const trashed = [];
    const failed = [];
    ids.forEach(function (id) {
      if (!known[id]) { failed.push(id); return; }
      try { DriveApp.getFileById(id).setTrashed(true); trashed.push(id); } catch (err) { failed.push(id); }
    });
    if (trashed.length > 0) {
      const gone = {};
      trashed.forEach(function (id) { gone[id] = true; });
      index.files = index.files.filter(function (f) { return !gone[f.id]; });
      index.count = index.files.length;
      index.updatedAt = new Date().toISOString();
      saveTextFile(DriveApp.getFolderById(TARGET_FOLDER_ID), DWG_INDEX_FILE_NAME, JSON.stringify(index), MimeType.PLAIN_TEXT);
    }
    return dwgJson_({ status: 'success', trashed: trashed, failed: failed });
  }
  // Fast path for the drawing PDF lookup: use the index when it has the drawing, otherwise fall through to the normal search
  if ((action === 'find-dwg-pdf' || action === 'dwg-pdf') && e.parameter.dwgNo) {
    try {
      const hit = dwgFindInIndex_(String(e.parameter.dwgNo).trim());
      if (hit) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          fileId: hit.id,
          fileName: hit.name,
          filename: hit.name,
          fileUrl: 'https://drive.google.com/file/d/' + hit.id + '/view',
          previewUrl: 'https://drive.google.com/file/d/' + hit.id + '/preview',
          viewUrl: 'https://drive.google.com/file/d/' + hit.id + '/view?usp=drivesdk',
          downloadUrl: 'https://drive.google.com/uc?export=download&id=' + hit.id,
          fromIndex: true
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } catch (err) { /* index unreadable - use the normal search */ }
  }
  return null;
}
`;
