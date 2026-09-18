// ==============================================================================
// CHAKEN Planing Pro - Storage Location & Cloud Sync Manager
// ==============================================================================
// Manages syncing of Plan data (completed PDs, schedules, settings)
// across GitHub Pages, Localhost, and Google Drive (via Google Apps Script).
// ==============================================================================

export const DEFAULT_DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1Yt8drFmq0END9fAEWUy0No6sZ76H1dtA?lfhs=2';
export const DEFAULT_DRIVE_FOLDER_ID = '1Yt8drFmq0END9fAEWUy0No6sZ76H1dtA';

const STORAGE_ENDPOINT_KEY = 'PDPLAN_STORAGE_ENDPOINT';
const STORAGE_CACHE_KEY = 'pdplan_cached_plan';
const STORAGE_LAST_SYNC_KEY = 'PDPLAN_LAST_SYNC_TIME';
const STORAGE_AUTO_SYNC_KEY = 'PDPLAN_AUTO_SYNC';

export class StorageSyncManager {
  constructor(state) {
    this.state = state;
    this.endpointUrl = localStorage.getItem(STORAGE_ENDPOINT_KEY) || '';
    this.autoSync = localStorage.getItem(STORAGE_AUTO_SYNC_KEY) !== 'false';
    this.lastSyncTime = localStorage.getItem(STORAGE_LAST_SYNC_KEY) || null;
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'success' | 'error' | 'local_only'
    this.debounceTimer = null;
    
    this.initUI();
  }

  initUI() {
    this.btnSync = document.getElementById('btn-storage-sync');
    this.statusBadge = document.getElementById('sync-status-badge');
    
    if (this.btnSync) {
      this.btnSync.addEventListener('click', () => this.openSyncModal());
    }
    
    this.updateStatusBadge();
  }

  getEndpointUrl() {
    return this.endpointUrl ? this.endpointUrl.trim() : '';
  }

  setEndpointUrl(url) {
    this.endpointUrl = (url || '').trim();
    if (this.endpointUrl) {
      localStorage.setItem(STORAGE_ENDPOINT_KEY, this.endpointUrl);
    } else {
      localStorage.removeItem(STORAGE_ENDPOINT_KEY);
    }
    this.updateStatusBadge();
  }

  getDriveFolderUrl() {
    return localStorage.getItem('PDPLAN_DRIVE_FOLDER_URL') || DEFAULT_DRIVE_FOLDER_URL;
  }

  setDriveFolderUrl(url) {
    const trimmed = (url || '').trim();
    if (trimmed) {
      localStorage.setItem('PDPLAN_DRIVE_FOLDER_URL', trimmed);
    } else {
      localStorage.removeItem('PDPLAN_DRIVE_FOLDER_URL');
    }
  }

  getDriveFolderId() {
    const url = this.getDriveFolderUrl();
    const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : DEFAULT_DRIVE_FOLDER_ID;
  }

  updateStatusBadge() {
    if (!this.statusBadge) return;
    
    const hasEndpoint = Boolean(this.getEndpointUrl());
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (this.syncStatus === 'syncing') {
      this.statusBadge.className = 'sync-pill syncing';
      this.statusBadge.innerHTML = `<span class="spin">⏳</span> กำลังซิงค์...`;
      this.statusBadge.title = 'กำลังเชื่อมต่อและซิงค์ข้อมูลกับ Cloud Storage';
    } else if (this.syncStatus === 'error') {
      this.statusBadge.className = 'sync-pill error';
      this.statusBadge.innerHTML = `⚠️ ซิงค์ล้มเหลว`;
      this.statusBadge.title = 'ไม่สามารถเชื่อมต่อ Cloud ได้ ระบบกำลังใช้ข้อมูลใน Local Cache';
    } else if (hasEndpoint) {
      this.statusBadge.className = 'sync-pill success';
      const timeStr = this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
      this.statusBadge.innerHTML = `☁️ Google Drive ${timeStr ? '(' + timeStr + ')' : ''}`;
      this.statusBadge.title = `เชื่อมต่อ Google Drive เรียบร้อย (ซิงค์ล่าสุด: ${this.lastSyncTime || 'ยังไม่มี'})`;
    } else if (isLocalhost) {
      this.statusBadge.className = 'sync-pill local';
      this.statusBadge.innerHTML = `💻 Local Plan.json`;
      this.statusBadge.title = 'เชื่อมต่อไฟล์ Plan.json ในเครื่อง (Local Dev Server)';
    } else {
      this.statusBadge.className = 'sync-pill offline';
      this.statusBadge.innerHTML = `💾 Local Cache`;
      this.statusBadge.title = 'บันทึกในแคชของเบราว์เซอร์ (คลิกเพื่อตั้งค่าเชื่อมต่อ Google Drive)';
    }
  }

  /**
   * ดึงข้อมูล Plan จาก Cloud (Google Drive / Endpoint) หรือ Local Cache
   */
  async pullFromCloud(silent = false) {
    const endpoint = this.getEndpointUrl();
    this.syncStatus = 'syncing';
    this.updateStatusBadge();

    // 1. หากมี Cloud Endpoint ให้ดึงจาก Cloud
    if (endpoint) {
      try {
        const fetchUrl = endpoint.includes('?') ? `${endpoint}&t=${Date.now()}` : `${endpoint}?t=${Date.now()}`;
        const response = await fetch(fetchUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
        }

        const resJson = await response.json();
        const payloadData = resJson.data || resJson;

        if (payloadData && (payloadData.scheduledJobs || payloadData.completedPdHistory)) {
          this.applyPayloadToState(payloadData);
          this.recordSyncSuccess(payloadData);
          if (!silent) this.showToast('✅ ดึงข้อมูลล่าสุดจาก Google Drive สำเร็จ', 'success');
          return true;
        } else {
          throw new Error('โครงสร้างข้อมูลใน Cloud ไม่ถูกต้อง');
        }
      } catch (err) {
        console.warn('Could not pull from Cloud Endpoint:', err);
        this.syncStatus = 'error';
        this.updateStatusBadge();
        if (!silent) this.showToast(`⚠️ ดึงข้อมูล Cloud ไม่สำเร็จ: ${err.message}`, 'error');
      }
    }

    // 2. หากไม่มี Endpoint หรือดึงไม่ผ่านใน Localhost ให้ลอง /api/plan
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      try {
        const res = await fetch('/api/plan');
        if (res.ok) {
          const data = await res.json();
          if (data && (data.scheduledJobs || data.completedPdHistory)) {
            this.applyPayloadToState(data);
            this.syncStatus = 'success';
            this.updateStatusBadge();
            return true;
          }
        }
      } catch (e) {
        console.warn('Local /api/plan not reachable:', e);
      }
    }

    // 3. Fallback: โหลดจาก LocalStorage Cache
    const cached = localStorage.getItem(STORAGE_CACHE_KEY);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        this.applyPayloadToState(data);
        this.syncStatus = endpoint ? 'error' : 'local_only';
        this.updateStatusBadge();
        return true;
      } catch (e) {
        console.error('Error reading cached plan:', e);
      }
    }

    this.syncStatus = endpoint ? 'error' : 'local_only';
    this.updateStatusBadge();
    return false;
  }

  /**
   * ส่งข้อมูล Plan ขึ้น Cloud (Google Drive / Endpoint) และบันทึกแคช
   */
  pushToCloud(payload, immediate = false) {
    // บันทึก Local Cache ทันทีเสมอ ป้องกันข้อมูลสูญหาย
    try {
      localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('Failed to save to localStorage cache:', e);
    }

    if (!this.autoSync && !immediate) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const delay = immediate ? 0 : 2000; // Debounce 2 วินาที
    this.debounceTimer = setTimeout(() => {
      this.executePush(payload);
    }, delay);
  }

  async executePush(payload) {
    const endpoint = this.getEndpointUrl();

    // 1. ถ้าอยู่ Localhost ส่งไปที่ /api/plan ด้วย
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      try {
        fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(err => console.warn('Local /api/plan push failed:', err));
      } catch (e) {}
    }

    // 2. ถ้ามี Cloud Endpoint ส่งไปยัง Google Drive
    if (!endpoint) {
      this.syncStatus = 'local_only';
      this.updateStatusBadge();
      return;
    }

    this.syncStatus = 'syncing';
    this.updateStatusBadge();

    try {
      // ส่ง POST ไปยัง Google Apps Script
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain ป้องกัน preflight CORS issue ใน Google Apps Script
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        this.recordSyncSuccess(payload);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('Cloud sync push error:', err);
      this.syncStatus = 'error';
      this.updateStatusBadge();
    }
  }

  recordSyncSuccess(payload) {
    this.syncStatus = 'success';
    this.lastSyncTime = new Date().toISOString();
    localStorage.setItem(STORAGE_LAST_SYNC_KEY, this.lastSyncTime);
    this.updateStatusBadge();
  }

  applyPayloadToState(data) {
    if (!data || !this.state) return;

    if (Array.isArray(data.scheduledJobs)) this.state.scheduledJobs = data.scheduledJobs;
    if (data.nests) this.state.nests = data.nests;
    if (data.assemblyLinks) this.state.assemblyLinks = data.assemblyLinks;
    if (data.lockedProjects) this.state.lockedProjects = data.lockedProjects;
    if (data.priorityColors) this.state.priorityColors = data.priorityColors;
    if (data.projectColors) this.state.projectColors = data.projectColors;
    if (data.customerColors) this.state.customerColors = data.customerColors;
    if (data.workCenters) this.state.workCenters = data.workCenters;
    if (data.workCenterOrder) this.state.workCenterOrder = data.workCenterOrder;
    if (data.timelineOffset !== undefined) this.state.timelineOffset = data.timelineOffset;
    if (data.activeScale) this.state.activeScale = data.activeScale;
    if (data.completedPdHistory) this.state.completedPdHistory = data.completedPdHistory;
    if (data.favoritePDs) this.state.favoritePDs = data.favoritePDs;
    if (data.removedStepHistory) this.state.removedStepHistory = data.removedStepHistory;

    // กรอง PD ที่ผลิตจริงเสร็จแล้ว และขั้นตอนที่ถูกลบออก
    this.state.scheduledJobs = this.state.scheduledJobs.filter(
      j => !this.state.isPdInCompletedHistory(j.woId) && !this.state.isStepIdentityRemoved(j.woId, j.machine, j.stepName || j.name)
    );
    this.state.workOrders = this.state.workOrders.filter(wo => !this.state.isPdInCompletedHistory(wo.id));
    this.state.workOrders.forEach(wo => {
      wo.steps = wo.steps.filter(step => !this.state.isStepIdentityRemoved(wo.id, step.machine, step.name));
    });
    this.state.deduplicateAllWorkOrders();

    if (this.state.ganttController && this.state.scheduledJobs.length > 0) {
      this.state.ganttController.fitTasks(this.state.scheduledJobs);
    }
    this.state.notify();
  }

  /**
   * ดึงไฟล์ LN Status Overview.xls จาก Local Dev Server หรือ Google Drive
   */
  async fetchStatusOverview() {
    // 1. ถ้าอยู่ Local Dev Server ดึงผ่าน /api/status-overview
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      try {
        const res = await fetch('/api/status-overview');
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          let filename = 'LN Status Overview.xls';
          const xfn = res.headers.get('X-Filename');
          if (xfn) {
            try { filename = decodeURIComponent(xfn); } catch(e) {}
          }
          return { arrayBuffer: buffer, filename };
        }
      } catch (err) {
        console.warn('Local /api/status-overview not reachable:', err);
      }
    }

    // 2. ถ้ามี Google Apps Script Endpoint ดึงผ่าน Cloud Endpoint
    const endpoint = this.getEndpointUrl();
    if (endpoint) {
      try {
        const fetchUrl = endpoint.includes('?') ? `${endpoint}&action=status-overview&t=${Date.now()}` : `${endpoint}?action=status-overview&t=${Date.now()}`;
        const res = await fetch(fetchUrl);
        if (res.ok) {
          const json = await res.json();
          if (json.status === 'success' && json.base64) {
            const binaryStr = atob(json.base64);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            return {
              arrayBuffer: bytes.buffer,
              filename: json.filename || 'LN Status Overview.xls'
            };
          }
        }
      } catch (err) {
        console.warn('Google Drive status-overview fetch error:', err);
      }
    }

    return null;
  }

  exportBackupJson() {
    const payload = this.state.buildPlanPayload();
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Plan_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('📥 ดาวน์โหลดไฟล์ Plan_backup.json สำเร็จ', 'success');
  }

  importBackupJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data && (data.scheduledJobs || data.completedPdHistory)) {
          this.applyPayloadToState(data);
          this.pushToCloud(data, true);
          this.showToast(`✅ กู้คืนข้อมูลจากไฟล์ "${file.name}" สำเร็จ`, 'success');
        } else {
          this.showToast('❌ รูปแบบไฟล์ไม่ถูกต้อง ขาด scheduledJobs หรือ completedPdHistory', 'error');
        }
      } catch (err) {
        this.showToast('❌ ไม่สามารถอ่านไฟล์ JSON ได้: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `sync-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  openSyncModal() {
    let modal = document.getElementById('storage-sync-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'storage-sync-modal';
      modal.className = 'modal-backdrop';
      document.body.appendChild(modal);
    }

    const currentUrl = this.getEndpointUrl();
    const currentFolderUrl = this.getDriveFolderUrl();
    const currentFolderId = this.getDriveFolderId();
    const lastSyncDisplay = this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleString('th-TH') : 'ยังไม่มีการซิงค์';
    const completedCount = Object.keys(this.state.completedPdHistory || {}).length;
    const scheduledCount = (this.state.scheduledJobs || []).length;

    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 700px; width: 95%; max-height: 90vh; overflow-y: auto; padding: 22px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 12px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">📁</span>
            <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--accent-teal);">Setting Location Keep Data File (ตั้งค่าที่เก็บไฟล์ข้อมูล)</h3>
          </div>
          <button id="btn-close-sync-modal" style="background: none; border: none; font-size: 18px; color: var(--text-secondary); cursor: pointer; padding: 4px 8px;">✕</button>
        </div>

        <!-- Summary Status Box -->
        <div style="background: rgba(2, 132, 199, 0.06); border: 1px solid rgba(2, 132, 199, 0.25); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; font-size: 11.5px;">
            <div>
              <span style="color: var(--text-secondary);">สถานะการเชื่อมต่อ:</span>
              <div style="font-weight: bold; margin-top: 2px;">${this.statusBadge ? this.statusBadge.innerText : 'พร้อมใช้งาน'}</div>
            </div>
            <div>
              <span style="color: var(--text-secondary);">ซิงค์ล่าสุด:</span>
              <div style="font-weight: bold; margin-top: 2px;">${lastSyncDisplay}</div>
            </div>
            <div>
              <span style="color: var(--text-secondary);">PD ผลิตเสร็จแล้ว:</span>
              <div style="font-weight: bold; color: var(--accent-green); margin-top: 2px;">${completedCount} รายการ</div>
            </div>
            <div>
              <span style="color: var(--text-secondary);">งานที่วางแผนอยู่:</span>
              <div style="font-weight: bold; color: var(--accent-teal); margin-top: 2px;">${scheduledCount} Tasks</div>
            </div>
          </div>
        </div>

        <!-- Data Files Overview -->
        <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--border-glass); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 11px;">
          <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">📂 รายการไฟล์ข้อมูลที่เชื่อมต่อกับโฟลเดอร์นี้:</div>
          <div style="display: flex; flex-direction: column; gap: 4px; color: var(--text-secondary);">
            <div>• <strong style="color: var(--text-primary);">Plan.json:</strong> เก็บแผนงานบน Gantt, PD ที่ complete (${completedCount} รายการ), และ Machine Settings</div>
            <div>• <strong style="color: var(--text-primary);">LN Status Overview.xls:</strong> ข้อมูล Status Overview สำหรับนำเข้า Backlog (อ่านจาก Sheet: <strong>data</strong>)</div>
          </div>
        </div>

        <!-- Setting Location: Target Google Drive Folder -->
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label for="input-drive-folder-url" style="font-size: 12px; font-weight: 700; color: var(--text-primary);">
              📁 Google Drive Folder Location (โฟลเดอร์จัดเก็บข้อมูล):
            </label>
            <a id="link-open-drive-folder" href="${currentFolderUrl}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: var(--accent-teal); text-decoration: none; font-weight: 600;">
              🔗 เปิดโฟลเดอร์ใน Drive ↗
            </a>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="url" id="input-drive-folder-url" value="${currentFolderUrl}" placeholder="https://drive.google.com/drive/folders/..." style="flex: 1; padding: 8px 12px; font-size: 11px; font-family: monospace; border: 1px solid var(--border-glass); border-radius: 6px; background: rgba(255,255,255,0.8); color: var(--text-primary);">
            <button id="btn-save-drive-folder" class="btn btn-glowing" style="padding: 6px 14px; font-size: 11px; border-radius: 6px; white-space: nowrap;">
              💾 บันทึก Folder
            </button>
            <button id="btn-reset-drive-folder" class="btn" title="รีเซ็ตเป็นโฟลเดอร์เริ่มต้น" style="padding: 6px 10px; font-size: 11px; border: 1px solid var(--border-glass); border-radius: 6px; background: rgba(0,0,0,0.04); color: var(--text-secondary); white-space: nowrap;">
              ↺ เริ่มต้น
            </button>
          </div>
          <div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">
            * สามารถเปลี่ยนโฟลเดอร์ Google Drive สำหรับจัดเก็บและซิงค์ข้อมูลได้ตามต้องการ
          </div>
        </div>

        <!-- Endpoint URL Input -->
        <div style="margin-bottom: 16px;">
          <label for="input-sync-endpoint" style="display: block; font-size: 12px; font-weight: 700; margin-bottom: 4px; color: var(--text-primary);">
            🔗 Web App Sync API URL (Google Apps Script):
          </label>
          <div style="display: flex; gap: 8px;">
            <input type="url" id="input-sync-endpoint" value="${currentUrl}" placeholder="https://script.google.com/macros/s/.../exec" style="flex: 1; padding: 8px 12px; font-size: 11.5px; font-family: monospace; border: 1px solid var(--border-glass); border-radius: 6px; background: rgba(255,255,255,0.8); color: var(--text-primary);">
            <button id="btn-save-sync-endpoint" class="btn btn-glowing" style="padding: 6px 14px; font-size: 11.5px; border-radius: 6px; white-space: nowrap;">
              💾 บันทึก URL
            </button>
          </div>
          <div style="font-size: 10.5px; color: var(--text-secondary); margin-top: 4px;">
            * นำ Web App URL ที่ได้จากการ Deploy สคริปต์ในโฟลเดอร์ Google Drive มาวางที่นี่เพื่อให้ GitHub Pages อ่าน-เขียน Plan.json อัตโนมัติ
          </div>
        </div>

        <!-- Quick Sync Action Buttons -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px;">
          <button id="btn-modal-pull-sync" class="btn" style="padding: 10px; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(2, 132, 199, 0.1); border: 1.5px solid var(--accent-teal); color: var(--accent-teal); border-radius: 8px; cursor: pointer;">
            <span>🔄 ดึงข้อมูลล่าสุด (Pull from Cloud)</span>
          </button>
          <button id="btn-modal-push-sync" class="btn" style="padding: 10px; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(22, 163, 74, 0.1); border: 1.5px solid var(--accent-green, #16a34a); color: var(--accent-green, #16a34a); border-radius: 8px; cursor: pointer;">
            <span>☁️ บันทึกขึ้น Cloud ทันที (Push)</span>
          </button>
        </div>

        <!-- Backup & Restore from local file -->
        <div style="border-top: 1px solid var(--border-glass); padding-top: 14px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 700; margin-bottom: 8px;">💾 สำรองและกู้คืนไฟล์ข้อมูลในเครื่อง (Offline Backup):</div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button id="btn-export-backup" class="btn" style="flex: 1; padding: 7px 12px; font-size: 11px; background: rgba(255,255,255,0.06); border: 1px solid var(--border-glass); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
              📥 ดาวน์โหลด Plan_backup.json
            </button>
            <label class="btn" style="flex: 1; padding: 7px 12px; font-size: 11px; background: rgba(255,255,255,0.06); border: 1px solid var(--border-glass); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; text-align: center;">
              📂 กู้คืนจากไฟล์ Plan.json
              <input type="file" id="input-import-backup" accept=".json" style="display: none;">
            </label>
          </div>
        </div>

        <!-- Guide & Code Snippet Accordion -->
        <details style="border-top: 1px solid var(--border-glass); padding-top: 12px; font-size: 11.5px;">
          <summary style="cursor: pointer; font-weight: 700; color: var(--accent-teal); user-select: none;">
            ℹ️ วิธีติดตั้ง Google Apps Script สำหรับเชื่อมต่อโฟลเดอร์ Google Drive (คลิกเพื่อดู)
          </summary>
          <div style="margin-top: 10px; line-height: 1.6; color: var(--text-secondary);">
            <ol style="padding-left: 18px; margin-bottom: 10px;">
              <li>เปิดโฟลเดอร์ Google Drive: <a id="guide-drive-link" href="${currentFolderUrl}" target="_blank" style="color: var(--accent-teal);">คลิกที่นี่</a></li>
              <li>สร้างไฟล์ Google Apps Script ใหม่ (หรือเข้า <a href="https://script.google.com" target="_blank" style="color: var(--accent-teal);">script.google.com</a>)</li>
              <li>นำโค้ดในกรอบด้านล่างไปวางแทนที่โค้ดเดิมทั้งหมด แล้วกดบันทึก</li>
              <li>กด <strong>ทำให้ใช้งานได้ (Deploy)</strong> &gt; <strong>การทำให้ใช้งานได้ใหม่ (New deployment)</strong></li>
              <li>เลือกประเภท <strong>เว็บแอป (Web app)</strong> โดยตั้งค่า:
                <ul>
                  <li>ดำเนินการในฐานะ: <strong>ฉัน (Me)</strong></li>
                  <li>ผู้ที่มีสิทธิ์เข้าถึง: <strong>ทุกคน (Anyone)</strong></li>
                </ul>
              </li>
              <li>คัดลอก Web App URL ที่ได้ มาวางในช่องด้านบน แล้วกดบันทึก URL</li>
            </ol>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-weight: bold; color: var(--text-primary);">สคริปต์ Google Apps Script (Folder ID: <span id="guide-folder-id-label">${currentFolderId}</span>):</span>
              <button id="btn-copy-gas-code" class="btn btn-action-small" style="font-size: 10px; padding: 2px 8px; border-radius: 4px;">
                📋 คัดลอกโค้ดทั้งหมด
              </button>
            </div>
            <pre id="gas-code-preview" style="background: rgba(0,0,0,0.06); padding: 10px; border-radius: 6px; font-size: 10px; font-family: monospace; max-height: 140px; overflow-y: auto; border: 1px solid var(--border-glass); white-space: pre-wrap;"></pre>
          </div>
        </details>
      </div>
    `;

    // Bind modal events
    document.getElementById('btn-close-sync-modal')?.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });

    const updateGasCodePreview = () => {
      const fId = this.getDriveFolderId();
      const code = `const TARGET_FOLDER_ID = '${fId}';
const TARGET_FILE_NAME = 'Plan.json';

function doGet(e) {
  try {
    const folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    if (e && e.parameter && (e.parameter.action === 'status-overview' || e.parameter.file === 'status-overview')) {
      const allFiles = folder.getFiles();
      let overviewFile = null;
      while (allFiles.hasNext()) {
        const f = allFiles.next();
        const fname = f.getName();
        if (fname.includes('LN Status Overview') || fname.includes('Status Overview')) {
          overviewFile = f;
          break;
        }
      }
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
    const files = folder.getFilesByName(TARGET_FILE_NAME);
    let content = { scheduledJobs: [], nests: {}, completedPdHistory: {} };
    let lastModified = null;
    if (files.hasNext()) {
      const file = files.next();
      lastModified = file.getLastUpdated().toISOString();
      content = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', lastModified, data: content })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    const postData = e.postData.contents;
    const parsed = JSON.parse(postData);
    delete parsed.formattedRows;
    const formatted = JSON.stringify(parsed, null, 2);
    const files = folder.getFilesByName(TARGET_FILE_NAME);
    let targetFile;
    if (files.hasNext()) {
      targetFile = files.next();
      targetFile.setContent(formatted);
    } else {
      targetFile = folder.createFile(TARGET_FILE_NAME, formatted, MimeType.PLAIN_TEXT);
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Plan.json saved', fileId: targetFile.getId() })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}`;
      const prevEl = document.getElementById('gas-code-preview');
      if (prevEl) prevEl.textContent = code;
      const idLbl = document.getElementById('guide-folder-id-label');
      if (idLbl) idLbl.textContent = fId;
      return code;
    };

    updateGasCodePreview();

    document.getElementById('btn-save-drive-folder')?.addEventListener('click', () => {
      const val = document.getElementById('input-drive-folder-url').value;
      this.setDriveFolderUrl(val);
      const newUrl = this.getDriveFolderUrl();
      document.getElementById('link-open-drive-folder').href = newUrl;
      const guideLink = document.getElementById('guide-drive-link');
      if (guideLink) guideLink.href = newUrl;
      updateGasCodePreview();
      this.showToast('💾 บันทึก Google Drive Folder Location เรียบร้อย', 'success');
    });

    document.getElementById('btn-reset-drive-folder')?.addEventListener('click', () => {
      this.setDriveFolderUrl(DEFAULT_DRIVE_FOLDER_URL);
      document.getElementById('input-drive-folder-url').value = DEFAULT_DRIVE_FOLDER_URL;
      document.getElementById('link-open-drive-folder').href = DEFAULT_DRIVE_FOLDER_URL;
      const guideLink = document.getElementById('guide-drive-link');
      if (guideLink) guideLink.href = DEFAULT_DRIVE_FOLDER_URL;
      updateGasCodePreview();
      this.showToast('↺ รีเซ็ตโฟลเดอร์ Google Drive เป็นค่าเริ่มต้น', 'info');
    });

    document.getElementById('btn-save-sync-endpoint')?.addEventListener('click', () => {
      const val = document.getElementById('input-sync-endpoint').value;
      this.setEndpointUrl(val);
      this.showToast('💾 บันทึก Cloud Sync URL เรียบร้อย', 'success');
      this.pullFromCloud(false);
    });

    document.getElementById('btn-modal-pull-sync')?.addEventListener('click', () => {
      this.pullFromCloud(false);
    });

    document.getElementById('btn-modal-push-sync')?.addEventListener('click', () => {
      const payload = this.state.buildPlanPayload();
      this.pushToCloud(payload, true);
      this.showToast('☁️ กำลังส่งข้อมูลขึ้น Cloud...', 'info');
    });

    document.getElementById('btn-export-backup')?.addEventListener('click', () => {
      this.exportBackupJson();
    });

    document.getElementById('input-import-backup')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.importBackupJson(file);
    });

    document.getElementById('btn-copy-gas-code')?.addEventListener('click', () => {
      const code = updateGasCodePreview();
      navigator.clipboard.writeText(code).then(() => {
        this.showToast('📋 คัดลอกโค้ด Apps Script เรียบร้อยแล้ว', 'success');
      });
    });
  }
}
