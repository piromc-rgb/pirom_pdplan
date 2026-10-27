/**
 * ==============================================================================
 * CHAKEN Planing V1.1B - Google Drive Cloud Sync Service (Google Apps Script)
 * ==============================================================================
 * 
 * วัตถุประสงค์:
 * ใช้เป็น Web App API สำหรับอ่านและบันทึกไฟล์ Plan.json ใน Google Drive โดยอัตโนมัติ
 * เพื่อให้ Web App บน GitHub Pages (https://piromc-rgb.github.io/pirom_pdplan/)
 * สามารถกู้คืนแผนงาน (Restore) และบันทึกข้อมูลล่าสุด (Save / Auto-Sync) ได้อย่างปลอดภัย
 * 
 * โฟลเดอร์เป้าหมาย:
 * https://drive.google.com/drive/folders/1Yt8drFmq0END9fAEWUy0No6sZ76H1dtA
 * Folder ID: 1Yt8drFmq0END9fAEWUy0No6sZ76H1dtA
 * 
 * ------------------------------------------------------------------------------
 * วิธีติดตั้ง (ทำเพียงครั้งเดียว ภายใน 2 นาที):
 * ------------------------------------------------------------------------------
 * 1. เปิด Google Drive เข้าไปในโฟลเดอร์ด้านบน หรือเปิด https://script.google.com
 * 2. กดปุ่ม "สร้างโครงการใหม่" (New Project)
 * 3. ลบโค้ดเดิมทั้งหมดออก แล้ววางโค้ดไฟล์นี้ลงไปแทน
 * 4. กดบันทึก (Ctrl+S หรือ Cmd+S)
 * 5. กดปุ่มสีน้ำเงินมุมขวาบน "ทำให้ใช้งานได้" (Deploy) -> "การทำให้ใช้งานได้ใหม่" (New deployment)
 * 6. เลือกประเภท: "เว็บแอป" (Web app)
 *    - คำอธิบาย: CHAKEN Plan Sync API
 *    - ดำเนินการในฐานะ: "ฉัน" (Me)
 *    - ผู้ที่มีสิทธิ์เข้าถึง: "ทุกคน" (Anyone)  <--- สำคัญมาก! เพื่อให้ GitHub Pages ยิงเชื่อมต่อได้
 * 7. กด "ทำให้ใช้งานได้" (Deploy) แล้วอนุญาตสิทธิ์เข้าถึงโฟลเดอร์ Google Drive
 * 8. คัดลอก "URL ของเว็บแอป" (Web App URL ที่ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec)
 * 9. นำ URL มาวางในปุ่ม "☁️ ที่เก็บข้อมูล (Cloud Sync)" บนหน้าเว็บของระบบ เป็นอันเสร็จสิ้น!
 * ==============================================================================
 */

// โฟลเดอร์เป้าหมายใน Google Drive
const TARGET_FOLDER_ID = '1Yt8drFmq0END9fAEWUy0No6sZ76H1dtA';
const TARGET_DWG_FOLDER_ID = '1M-QDPilC7Nn-YW_5YxLQITUS6ZOYEyFm';
const TARGET_FILE_NAME = 'Plan.json';
const MACHINE_SETTINGS_FILE_NAME = 'machine_settings.json';
const COMPLETED_PDS_FILE_NAME = 'completed_pds.json';

/**
 * ฟังก์ชันช่วยสร้างหรืออัปเดตไฟล์ข้อความในโฟลเดอร์
 */
function saveTextFile(folder, filename, textContent, mimeType) {
  const files = folder.getFilesByName(filename);
  if (files.hasNext()) {
    const file = files.next();
    file.setContent(textContent);
    return file;
  } else {
    return folder.createFile(filename, textContent, mimeType || MimeType.PLAIN_TEXT);
  }
}

/**
 * ฟังก์ชันช่วยอ่านไฟล์ JSON จากโฟลเดอร์
 */
function readJsonFile(folder, filename) {
  const files = folder.getFilesByName(filename);
  if (files.hasNext()) {
    try {
      const rawText = files.next().getBlob().getDataAsString('UTF-8');
      return JSON.parse(rawText);
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * หาไฟล์ Status Overview (.xlsx/.xls) ที่ใหม่ที่สุดในโฟลเดอร์ (ใช้เมื่อชื่อไฟล์เป็น AUTO หรือว่าง)
 */
function isAutoStatusName_(name) {
  const n = String(name || '').trim().toLowerCase();
  return n === '' || n === 'auto';
}

function findLatestStatusOverviewFile_(folder) {
  const all = folder.getFiles();
  let best = null;
  while (all.hasNext()) {
    const f = all.next();
    const fname = f.getName();
    if (fname.indexOf('~$') === 0) continue;
    if (!/status\s*overview/i.test(fname) || !/\.xlsx?$/i.test(fname)) continue;
    if (!best || f.getLastUpdated().getTime() > best.getLastUpdated().getTime()) best = f;
  }
  return best;
}

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

/**
 * จัดการคำขอแบบ GET (ดึงข้อมูล Plan.json, machine_settings.json, completed_pds.json, LN Status Overview)
 */
function doGet(e) {
  try {
    const dwgToolResponse = handleDwgToolAction_(e);
    if (dwgToolResponse) return dwgToolResponse;
    const folder = DriveApp.getFolderById(TARGET_FOLDER_ID);

    // 1. ดึงไฟล์ Status Overview (Excel)
    if (e && e.parameter && (e.parameter.action === 'status-overview' || e.parameter.file === 'status-overview')) {
      const targetName = e.parameter.filename ? e.parameter.filename.trim() : '';
      const allFiles = folder.getFiles();
      let overviewFile = null;
      let fallbackFile = null;
      if (isAutoStatusName_(targetName)) {
        overviewFile = findLatestStatusOverviewFile_(folder);
      }
      while (!overviewFile && allFiles.hasNext()) {
        const f = allFiles.next();
        const fname = f.getName();
        if (targetName && (fname === targetName || fname.toLowerCase() === targetName.toLowerCase())) {
          overviewFile = f;
          break;
        }
        if (targetName && fname.toLowerCase().includes(targetName.toLowerCase())) {
          overviewFile = f;
          break;
        }
        if (fname.includes('LN Status Overview') || fname.includes('Status Overview')) {
          fallbackFile = f;
        }
      }
      overviewFile = overviewFile || fallbackFile;
      if (overviewFile) {
        const b64 = Utilities.base64Encode(overviewFile.getBlob().getBytes());
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          filename: overviewFile.getName(),
          lastModified: overviewFile.getLastUpdated().toISOString(),
          base64: b64
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'No Status Overview file found in Google Drive folder'
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 2. ดึงไฟล์ plan_materials_cache.json (Plan + Mat) จาก Google Drive
    if (e && e.parameter && (e.parameter.action === 'plan-materials' || e.parameter.file === 'plan-materials')) {
      const pmData = readJsonFile(folder, 'plan_materials_cache.json');
      if (pmData) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          fileName: 'plan_materials_cache.json',
          data: pmData
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 3. ดึงไฟล์ machine_settings.json โดยตรง (ถ้ามี parameter action=machine-settings)
    if (e && e.parameter && (e.parameter.action === 'machine-settings' || e.parameter.file === 'machine-settings')) {
      const msData = readJsonFile(folder, MACHINE_SETTINGS_FILE_NAME);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        fileName: MACHINE_SETTINGS_FILE_NAME,
        data: msData || {}
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3.5 ตรวจสอบสถานะไฟล์ทั้งหมดและโฟลเดอร์ DWG บน Google Drive Cloud โดยตรง (สำหรับเครื่องที่ไม่มี Drive G:)
    if (e && e.parameter && e.parameter.action === 'check-cloud-status') {
      const statusFnRaw = (e.parameter.statusFilename || 'AUTO').trim();
      const latestOverviewFile = isAutoStatusName_(statusFnRaw) ? findLatestStatusOverviewFile_(folder) : null;
      const statusFn = latestOverviewFile ? latestOverviewFile.getName() : (isAutoStatusName_(statusFnRaw) ? 'LN Status Overview.xlsx' : statusFnRaw);
      const customDwgFolderId = (e.parameter.dwgFolderId && String(e.parameter.dwgFolderId).trim()) || TARGET_DWG_FOLDER_ID;
      const inspectDriveFile = (fname, fallbackSubstr) => {
        const iter = folder.getFilesByName(fname);
        let f = iter.hasNext() ? iter.next() : null;
        if (!f && fallbackSubstr) {
          const all = folder.getFiles();
          while (all.hasNext()) {
            const cand = all.next();
            if (cand.getName().toLowerCase().includes(fallbackSubstr.toLowerCase())) {
              f = cand;
              break;
            }
          }
        }
        if (!f) return { exists: false };
        const sz = f.getSize();
        return {
          exists: true,
          name: f.getName(),
          fileId: f.getId(),
          sizeBytes: sz,
          sizeKB: +(sz / 1024).toFixed(1),
          sizeMB: +(sz / (1024 * 1024)).toFixed(2),
          updatedAt: f.getLastUpdated().toISOString()
        };
      };
      let dwgInfo = { exists: false, folderId: customDwgFolderId, subfolders: [] };
      let df = null;
      try {
        df = DriveApp.getFolderById(customDwgFolderId);
      } catch (err) {}
      if (!df && customDwgFolderId !== TARGET_DWG_FOLDER_ID) {
        try { df = DriveApp.getFolderById(TARGET_DWG_FOLDER_ID); } catch (err) {}
      }
      if (!df) {
        try {
          const subFolders = folder.getFolders();
          while (subFolders.hasNext()) {
            const sf = subFolders.next();
            if (sf.getName().toLowerCase().includes('dwg')) { df = sf; break; }
          }
        } catch (err) {}
      }
      if (df) {
        const subs = [];
        const subIter = df.getFolders();
        while (subIter.hasNext()) subs.push(subIter.next().getName());
        dwgInfo = { exists: true, folderId: df.getId(), folderName: df.getName(), subfolders: subs };
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        source: 'google_drive_cloud',
        folderId: TARGET_FOLDER_ID,
        folderName: folder.getName(),
        files: {
          planJson: inspectDriveFile(TARGET_FILE_NAME),
          machineSettings: inspectDriveFile(MACHINE_SETTINGS_FILE_NAME),
          completedPds: inspectDriveFile(COMPLETED_PDS_FILE_NAME),
          statusOverview: inspectDriveFile(statusFn, 'Status Overview'),
          planMaterialsCache: inspectDriveFile('plan_materials_cache.json')
        },
        dwgFolder: dwgInfo
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. ค้นหาไฟล์ PDF ของ Dwg No ในโฟลเดอร์ dwg และโฟลเดอร์ย่อยทั้งหมด
    if (e && e.parameter && (e.parameter.action === 'find-dwg-pdf' || e.parameter.action === 'dwg-pdf')) {
      const dwgNo = e.parameter.dwgNo ? e.parameter.dwgNo.trim() : '';
      const customDwgFolderId = (e.parameter.dwgFolderId && String(e.parameter.dwgFolderId).trim()) || TARGET_DWG_FOLDER_ID;
      if (!dwgNo) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'ไม่ได้ระบุรหัสแบบ (Dwg No)'
        })).setMimeType(ContentService.MimeType.JSON);
      }

      const cleanKey = dwgNo.replace(/[-_\s.]/g, '').toUpperCase();
      let matchedFile = null;

      const visitedFolders = {};
      function searchFolder(f) {
        if (matchedFile || !f) return;
        const fid = f.getId();
        if (visitedFolders[fid]) return;
        visitedFolders[fid] = true;
        const files = f.getFiles();
        while (files.hasNext()) {
          const file = files.next();
          const name = file.getName();
          if (name.toLowerCase().endsWith('.pdf')) {
            const cleanName = name.replace(/[-_\s.]/g, '').toUpperCase();
            if (cleanName.includes(cleanKey)) {
              matchedFile = file;
              return;
            }
          }
        }
        const subs = f.getFolders();
        while (subs.hasNext()) {
          searchFolder(subs.next());
          if (matchedFile) return;
        }
      }

      // 1. ค้นหาในโฟลเดอร์ DWG ที่ตั้งค่าไว้ (customDwgFolderId หรือ TARGET_DWG_FOLDER_ID) ก่อน
      try {
        const directDwgFolder = DriveApp.getFolderById(customDwgFolderId);
        if (directDwgFolder) searchFolder(directDwgFolder);
      } catch (err) {}

      if (!matchedFile && customDwgFolderId !== TARGET_DWG_FOLDER_ID) {
        try {
          const defaultDwgFolder = DriveApp.getFolderById(TARGET_DWG_FOLDER_ID);
          if (defaultDwgFolder) searchFolder(defaultDwgFolder);
        } catch (err) {}
      }

      // 2. ค้นหาในโฟลเดอร์ย่อย dwg ของ root folder
      if (!matchedFile) {
        try {
          const allSubFolders = folder.getFolders();
          while (allSubFolders.hasNext()) {
            const sf = allSubFolders.next();
            const sName = sf.getName().toLowerCase();
            if (sName === 'dwg' || sName.includes('dwg')) {
              searchFolder(sf);
              if (matchedFile) break;
            }
          }
        } catch (err) {}
      }

      // 3. ค้นหาใน root folder เอง
      if (!matchedFile) {
        searchFolder(folder);
      }

      // 4. ถ้ายังไม่พบ ให้ค้นหาไฟล์ PDF ทั่วทั้ง Google Drive ด้วย DriveApp searchFiles
      if (!matchedFile) {
        try {
          const prefix = cleanKey.length >= 7 ? cleanKey.slice(0, 7) : cleanKey;
          const searchIter = DriveApp.searchFiles("mimeType = 'application/pdf' and trashed = false and title contains '" + prefix + "'");
          while (searchIter.hasNext()) {
            const f = searchIter.next();
            const cleanName = f.getName().replace(/[-_\s.]/g, '').toUpperCase();
            if (cleanName.includes(cleanKey)) {
              matchedFile = f;
              break;
            }
          }
        } catch (err) {}
      }

      if (matchedFile) {
        const fId = matchedFile.getId();
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          fileId: fId,
          fileName: matchedFile.getName(),
          filename: matchedFile.getName(),
          fileUrl: matchedFile.getUrl(),
          previewUrl: 'https://drive.google.com/file/d/' + fId + '/preview',
          viewUrl: 'https://drive.google.com/file/d/' + fId + '/view?usp=drivesdk',
          downloadUrl: 'https://drive.google.com/uc?export=download&id=' + fId
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'not_found',
          message: 'ไม่พบ file แบบ'
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 3. ดึงข้อมูลรวม (Plan.json รวมกับ machine_settings.json และ completed_pds.json)
    let content = { scheduledJobs: [], nests: {}, completedPdHistory: {}, workCenters: {}, workCenterOrder: [] };
    let lastModified = null;

    // อ่าน Plan.json
    const planFiles = folder.getFilesByName(TARGET_FILE_NAME);
    if (planFiles.hasNext()) {
      const file = planFiles.next();
      lastModified = file.getLastUpdated().toISOString();
      try {
        const parsed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
        if (parsed && typeof parsed === 'object') {
          content = Object.assign(content, parsed);
        }
      } catch (err) {
        // ignore parse error
      }
    }

    // อ่าน machine_settings.json เพื่อรวมค่าการตั้งค่าเครื่องจักรล่าสุด
    const machineSettings = readJsonFile(folder, MACHINE_SETTINGS_FILE_NAME);
    if (machineSettings) {
      if (machineSettings.workCenters) content.workCenters = machineSettings.workCenters;
      if (machineSettings.workCenterOrder) content.workCenterOrder = machineSettings.workCenterOrder;
    }

    // อ่าน completed_pds.json เพื่อรวมรายการ PD ที่เสร็จแล้ว
    const completedPds = readJsonFile(folder, COMPLETED_PDS_FILE_NAME);
    if (completedPds) {
      if (Array.isArray(completedPds)) {
        content.completedPdHistory = content.completedPdHistory || {};
        completedPds.forEach(item => {
          const id = typeof item === 'string' ? item : (item.id || item.woId || item.pdId);
          if (id) content.completedPdHistory[id] = true;
        });
      } else if (typeof completedPds === 'object') {
        content.completedPdHistory = Object.assign(content.completedPdHistory || {}, completedPds);
      }
    }

    const responsePayload = {
      status: 'success',
      folderId: TARGET_FOLDER_ID,
      fileName: TARGET_FILE_NAME,
      lastModified: lastModified,
      data: content
    };

    return ContentService
      .createTextOutput(JSON.stringify(responsePayload))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'error',
        message: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * จัดการคำขอแบบ POST (บันทึกข้อมูล Plan.json พร้อมแยก machine_settings.json และ completed_pds.json)
 */
function doPost(e) {
  try {
    const folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    let postData = '';

    if (e && e.postData && e.postData.contents) {
      postData = e.postData.contents;
    }

    if (!postData) {
      throw new Error('No data received in payload');
    }

    // ตรวจสอบความถูกต้องของ JSON
    let parsedJson;
    try {
      parsedJson = JSON.parse(postData);
    } catch (err) {
      throw new Error('Invalid JSON format: ' + err.message);
    }

    // ลบ formattedRows หากมี เพื่อประหยัดพื้นที่จัดเก็บ
    if (parsedJson && parsedJson.formattedRows) {
      delete parsedJson.formattedRows;
    }

    // 1. บันทึกไฟล์ Plan.json (แผนงานรวมทั้งหมด)
    const formattedContent = JSON.stringify(parsedJson, null, 2);
    const targetFile = saveTextFile(folder, TARGET_FILE_NAME, formattedContent, MimeType.PLAIN_TEXT);

    // 2. แยกบันทึกไฟล์ machine_settings.json (ข้อมูลตั้งค่าเครื่องจักร)
    if (parsedJson.workCenters) {
      const machinePayload = {
        updatedAt: new Date().toISOString(),
        workCenters: parsedJson.workCenters,
        workCenterOrder: parsedJson.workCenterOrder || Object.keys(parsedJson.workCenters)
      };
      saveTextFile(folder, MACHINE_SETTINGS_FILE_NAME, JSON.stringify(machinePayload, null, 2), MimeType.PLAIN_TEXT);
    }

    // 3. แยกบันทึกไฟล์ completed_pds.json (ข้อมูล PD ที่ผลิตเสร็จ)
    if (parsedJson.completedPdHistory) {
      saveTextFile(folder, COMPLETED_PDS_FILE_NAME, JSON.stringify(parsedJson.completedPdHistory, null, 2), MimeType.PLAIN_TEXT);
    }

    const responsePayload = {
      status: 'success',
      message: 'Plan.json, machine_settings.json, and completed_pds.json updated successfully in Google Drive',
      fileId: targetFile.getId(),
      lastModified: targetFile.getLastUpdated().toISOString(),
      sizeBytes: targetFile.getSize()
    };

    return ContentService
      .createTextOutput(JSON.stringify(responsePayload))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'error',
        message: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
