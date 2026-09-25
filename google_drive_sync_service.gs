/**
 * ==============================================================================
 * CHAKEN Planing V1.01 - Google Drive Cloud Sync Service (Google Apps Script)
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
const TARGET_DWG_FOLDER_ID = '17w0vlhgTfMW18p2H0LRq2aB1fOSHEdvg';
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
 * จัดการคำขอแบบ GET (ดึงข้อมูล Plan.json, machine_settings.json, completed_pds.json, LN Status Overview)
 */
function doGet(e) {
  try {
    const folder = DriveApp.getFolderById(TARGET_FOLDER_ID);

    // 1. ดึงไฟล์ Status Overview (Excel)
    if (e && e.parameter && (e.parameter.action === 'status-overview' || e.parameter.file === 'status-overview')) {
      const targetName = e.parameter.filename ? e.parameter.filename.trim() : '';
      const allFiles = folder.getFiles();
      let overviewFile = null;
      let fallbackFile = null;
      while (allFiles.hasNext()) {
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
      const statusFn = (e.parameter.statusFilename || 'LN Status Overview.xlsx').trim();
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
      try {
        const df = DriveApp.getFolderById(customDwgFolderId);
        if (df) {
          const subs = [];
          const subIter = df.getFolders();
          while (subIter.hasNext()) subs.push(subIter.next().getName());
          dwgInfo = { exists: true, folderId: df.getId(), folderName: df.getName(), subfolders: subs };
        }
      } catch (err) {}
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
