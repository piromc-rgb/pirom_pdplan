/**
 * ==============================================================================
 * CHAKEN Planing Pro - Google Drive Cloud Sync Service (Google Apps Script)
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
const TARGET_FILE_NAME = 'Plan.json';

/**
 * จัดการคำขอแบบ GET (ดึงข้อมูล Plan.json ล่าสุด)
 */
function doGet(e) {
  try {
    const folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    const files = folder.getFilesByName(TARGET_FILE_NAME);
    
    let content = { scheduledJobs: [], nests: {}, completedPdHistory: {} };
    let lastModified = null;
    
    if (files.hasNext()) {
      const file = files.next();
      lastModified = file.getLastUpdated().toISOString();
      const rawText = file.getBlob().getDataAsString('UTF-8');
      try {
        content = JSON.parse(rawText);
      } catch (err) {
        content = { raw: rawText, error: 'JSON parse warning' };
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
 * จัดการคำขอแบบ POST (บันทึก / ปรับปรุงข้อมูล Plan.json)
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
    
    const formattedContent = JSON.stringify(parsedJson, null, 2);
    const files = folder.getFilesByName(TARGET_FILE_NAME);
    let targetFile;
    
    if (files.hasNext()) {
      // เขียนทับไฟล์เดิม
      targetFile = files.next();
      targetFile.setContent(formattedContent);
    } else {
      // สร้างไฟล์ใหม่
      targetFile = folder.createFile(TARGET_FILE_NAME, formattedContent, MimeType.PLAIN_TEXT);
    }
    
    const responsePayload = {
      status: 'success',
      message: 'Plan.json updated successfully in Google Drive',
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
