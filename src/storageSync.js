// ==============================================================================
// CHAKEN Planing v1.0 - Storage Location & Cloud Sync Manager
// ==============================================================================
// Manages syncing of Plan data (completed PDs, schedules, settings)
// across GitHub Pages, Localhost, and Google Drive (via Google Apps Script).
// ==============================================================================

export const DEFAULT_DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1Yt8drFmq0END9fAEWUy0No6sZ76H1dtA?lfhs=2';
export const DEFAULT_DRIVE_FOLDER_ID = '1Yt8drFmq0END9fAEWUy0No6sZ76H1dtA';
export const DEFAULT_DWG_FOLDER_URL = 'https://drive.google.com/drive/folders/1M-QDPilC7Nn-YW_5YxLQITUS6ZOYEyFm';
export const DEFAULT_DWG_FOLDER_ID = '1M-QDPilC7Nn-YW_5YxLQITUS6ZOYEyFm';
export const DEFAULT_SYNC_ENDPOINT_URL = 'https://script.google.com/macros/s/AKfycbzLDxqPOnJAC8aRVyr8-_oNLWLdXEbSvJqbGSh-5W-zFVo_cwdVhsQPISjUUF3NSpJJFg/exec';

const STORAGE_ENDPOINT_KEY = 'PDPLAN_STORAGE_ENDPOINT';
const STORAGE_CACHE_KEY = 'pdplan_cached_plan';
const STORAGE_LAST_SYNC_KEY = 'PDPLAN_LAST_SYNC_TIME';
const STORAGE_AUTO_SYNC_KEY = 'PDPLAN_AUTO_SYNC';
const STORAGE_USER_MODE_KEY = 'PDPLAN_USER_MODE';
const STORAGE_DWG_FOLDER_KEY = 'PDPLAN_DWG_FOLDER_URL';
export const DEFAULT_STATUS_OVERVIEW_FILENAME = 'LN Status Overview.xlsx';
const STORAGE_STATUS_OVERVIEW_FILE_KEY = 'PDPLAN_STATUS_OVERVIEW_FILENAME';

export class StorageSyncManager {
  constructor(state) {
    this.state = state;
    if (typeof window !== 'undefined') {
      window.storageSyncManager = this;
      window.openStorageLocationModal = () => this.openSyncModal();
      window.openDwgPdfViewer = (dwgNo) => this.openDwgPdfViewer(dwgNo);
    }
    this.endpointUrl = localStorage.getItem(STORAGE_ENDPOINT_KEY) || DEFAULT_SYNC_ENDPOINT_URL;
    this.autoSync = localStorage.getItem(STORAGE_AUTO_SYNC_KEY) !== 'false';
    this.lastSyncTime = localStorage.getItem(STORAGE_LAST_SYNC_KEY) || null;
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'success' | 'error' | 'local_only'
    this.debounceTimer = null;
    // โหมดผู้ใช้งาน: 'view' (ดูแผน - default) หรือ 'plan' (วางแผน)
    // ทุกครั้งที่เปิดใช้งานใหม่จะเริ่มต้นเป็น 'view' (ดูแผน) เป็นค่าเริ่มต้น
    this.userMode = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_USER_MODE_KEY) : null) || 'view';
    
    // In-memory local cache for Status Overview (.xlsx) and Plan+Mat BOM for instant performance
    this._overviewCache = null;
    this._materialsCache = null;
    
    this.initUI();
  }

  initUI() {
    this.btnSync = document.getElementById('btn-storage-sync');
    this.btnHeaderSync = document.getElementById('btn-header-storage-sync');
    this.statusBadge = document.getElementById('sync-status-badge');
    this.headerStatusBadge = document.getElementById('header-sync-status-badge');
    
    if (this.btnSync) {
      this.btnSync.addEventListener('click', (e) => {
        this.openSyncModal();
      });
    }

    if (this.btnHeaderSync) {
      this.btnHeaderSync.addEventListener('click', (e) => {
        const panel = document.getElementById('display-options-panel');
        if (panel) panel.classList.add('hidden');
        this.openSyncModal();
      });
    }
    
    this.initModalEventListeners();
    this.initDwgPdfModalListeners();
    this.initUserModeUI();
    this.initAppLifecycle();
    this.updateStatusBadge();
  }

  getUserMode() {
    return this.userMode || 'view';
  }

  setUserMode(mode) {
    if (mode !== 'view' && mode !== 'plan') mode = 'view';
    this.userMode = mode;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(STORAGE_USER_MODE_KEY, mode);
      }
      localStorage.setItem(STORAGE_USER_MODE_KEY, mode);
    } catch (e) {}
    this.updateUserModeUI();
    if (mode === 'plan') {
      this.showToast('✏️ สลับเป็น "โหมดวางแผน" (วางแผนลง Board หรือปิด App จะ Auto Save ลง Google Drive ที่เดียวกับ LN Overview)', 'success');
      if (this.state && typeof this.state.buildPlanPayload === 'function') {
        if (typeof this.state.saveWorkOrdersToFile === 'function') this.state.saveWorkOrdersToFile();
        this.pushToCloud(this.state.buildPlanPayload(false), true);
      }
    } else {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.showToast('👁️ สลับเป็น "โหมดดูแผน" (Load เมื่อเปิด App แต่ไม่ Save เมื่อวางแผนหรือปิด App)', 'info');
    }
  }

  initUserModeUI() {
    this.userModeWrapper = document.getElementById('user-mode-wrapper');
    this.btnUserMode = document.getElementById('btn-user-mode');
    this.userModeMenu = document.getElementById('user-mode-menu');
    this.userModeOptionView = document.getElementById('user-mode-option-view');
    this.userModeOptionPlan = document.getElementById('user-mode-option-plan');

    if (this.btnUserMode && this.userModeMenu) {
      this.btnUserMode.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // ปิดเมนู Option อื่นๆ ก่อนเปิด
        const displayOptionsPanel = document.getElementById('display-options-panel');
        if (displayOptionsPanel) displayOptionsPanel.classList.add('hidden');

        const willOpen = this.userModeMenu.classList.contains('hidden');
        if (willOpen) {
          this.userModeMenu.classList.remove('hidden');
          this.btnUserMode.classList.add('menu-open');
        } else {
          this.userModeMenu.classList.add('hidden');
          this.btnUserMode.classList.remove('menu-open');
        }
      });

      document.addEventListener('click', (e) => {
        if (this.userModeMenu && !this.userModeMenu.classList.contains('hidden')) {
          if (this.userModeWrapper && !this.userModeWrapper.contains(e.target)) {
            this.userModeMenu.classList.add('hidden');
            this.btnUserMode?.classList.remove('menu-open');
          }
        }
      });
    }

    if (this.userModeOptionView) {
      this.userModeOptionView.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setUserMode('view');
        if (this.userModeMenu) this.userModeMenu.classList.add('hidden');
        if (this.btnUserMode) this.btnUserMode.classList.remove('menu-open');
      });
    }

    if (this.userModeOptionPlan) {
      this.userModeOptionPlan.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setUserMode('plan');
        if (this.userModeMenu) this.userModeMenu.classList.add('hidden');
        if (this.btnUserMode) this.btnUserMode.classList.remove('menu-open');
      });
    }

    this.updateUserModeUI();
  }

  updateUserModeUI() {
    const isPlan = this.getUserMode() === 'plan';
    const btnUserMode = this.btnUserMode || document.getElementById('btn-user-mode');
    const userModeIcon = document.getElementById('user-mode-icon');
    const userModeText = document.getElementById('user-mode-text');
    const optView = this.userModeOptionView || document.getElementById('user-mode-option-view');
    const optPlan = this.userModeOptionPlan || document.getElementById('user-mode-option-plan');
    const checkView = document.getElementById('check-user-mode-view');
    const checkPlan = document.getElementById('check-user-mode-plan');

    if (btnUserMode) {
      if (isPlan) {
        btnUserMode.classList.remove('mode-view');
        btnUserMode.classList.add('mode-plan');
        btnUserMode.title = 'โหมดผู้ใช้งาน: วางแผน (วางแผนลง Board & ปิด App จะ Save ลง Google Drive) - คลิกเพื่อสลับโหมด';
      } else {
        btnUserMode.classList.remove('mode-plan');
        btnUserMode.classList.add('mode-view');
        btnUserMode.title = 'โหมดผู้ใช้งาน: ดูแผน (Load เปิด App / ไม่ Save เมื่อวางแผนหรือปิด App) - คลิกเพื่อสลับโหมด';
      }
    }

    if (userModeIcon) {
      userModeIcon.textContent = isPlan ? '✏️' : '👁️';
    }
    if (userModeText) {
      userModeText.textContent = isPlan ? 'วางแผน' : 'ดูแผน';
    }

    if (optView && optPlan) {
      optView.classList.toggle('active', !isPlan);
      optPlan.classList.toggle('active', isPlan);
    }
    if (checkView && checkPlan) {
      checkView.classList.toggle('hidden', isPlan);
      checkPlan.classList.toggle('hidden', !isPlan);
    }
  }

  initAppLifecycle() {
    if (typeof window === 'undefined') return;

    const handleAutoSave = () => {
      // ถ้าอยู่ในโหมดดูแผน (view mode) ห้ามบันทึกใดๆ ทั้งสิ้นตอนออกจาก Web App
      if (!this.state || this.getUserMode() !== 'plan') return;
      const payload = this.state.buildPlanPayload(false);

      // บันทึก Local Cache ทันที (เฉพาะเมื่ออยู่ในโหมดวางแผน และขนาดไม่เกินโควต้า 4MB)
      try {
        const payloadStr = JSON.stringify(payload);
        if (payloadStr.length < 4 * 1024 * 1024) {
          localStorage.setItem(STORAGE_CACHE_KEY, payloadStr);
        }
        if (payload.workCenters) {
          localStorage.setItem('pdplan_machine_settings', JSON.stringify({
            workCenters: payload.workCenters,
            workCenterOrder: payload.workCenterOrder || []
          }));
        }
        if (payload.completedPdHistory) {
          localStorage.setItem('pdplan_completed_pds', JSON.stringify(payload.completedPdHistory));
        }
      } catch (e) {}

      // ส่งข้อมูลขึ้น Cloud & Server ทันทีด้วย sendBeacon / keepalive (เฉพาะเมื่อเปิด Auto-Sync และอยู่ในโหมดวางแผน)
      if (this.autoSync) {
        this.executePush(payload, true);
      }
    };

    window.addEventListener('beforeunload', () => handleAutoSave());
    window.addEventListener('pagehide', () => handleAutoSave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        handleAutoSave();
      }
    });
  }

  isAutoSyncEnabled() {
    return this.autoSync !== false;
  }

  setAutoSyncEnabled(enabled) {
    this.autoSync = Boolean(enabled);
    localStorage.setItem(STORAGE_AUTO_SYNC_KEY, this.autoSync ? 'true' : 'false');
    const toggle = document.getElementById('toggle-cloud-sync');
    if (toggle && toggle.checked !== this.autoSync) {
      toggle.checked = this.autoSync;
    }
    this.updateStatusBadge();
    if (this.autoSync) {
      this.showToast('⚡ เปิดการ Sync ข้อมูล Cloud (Load เปิด app / Save ปิด App)', 'success');
    } else {
      this.showToast('⏸️ ปิดการ Sync ข้อมูล Cloud (ไม่โหลด/ไม่บันทึกอัตโนมัติ)', 'info');
    }
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

  getDwgFolderUrl() {
    return localStorage.getItem(STORAGE_DWG_FOLDER_KEY) || DEFAULT_DWG_FOLDER_URL;
  }

  setDwgFolderUrl(url) {
    const trimmed = (url || '').trim();
    if (trimmed) {
      localStorage.setItem(STORAGE_DWG_FOLDER_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_DWG_FOLDER_KEY);
    }
  }

  isDwgLocationLocal(val = this.getDwgFolderUrl()) {
    const str = (val || '').trim();
    if (!str) return false;
    if (/^https?:\/\//i.test(str)) return false;
    if (/^[a-zA-Z]:[\\/]/.test(str) || str.startsWith('./') || str.startsWith('../') || str.startsWith('/') || str.includes('\\')) {
      return true;
    }
    // If it looks like a raw Google Drive folder ID (25+ alphanumeric/dash/underscore chars without slashes)
    if (/^[a-zA-Z0-9_-]{20,}$/.test(str)) return false;
    return true;
  }

  getDwgFolderId() {
    const val = this.getDwgFolderUrl();
    if (this.isDwgLocationLocal(val)) return DEFAULT_DWG_FOLDER_ID;
    const match = val.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(val.trim())) return val.trim();
    return DEFAULT_DWG_FOLDER_ID;
  }

  getDwgLocalDir() {
    const val = this.getDwgFolderUrl();
    return this.isDwgLocationLocal(val) ? val.trim() : '';
  }

  getStatusOverviewFilename() {
    return localStorage.getItem(STORAGE_STATUS_OVERVIEW_FILE_KEY) || DEFAULT_STATUS_OVERVIEW_FILENAME;
  }

  setStatusOverviewFilename(filename) {
    const trimmed = (filename || '').trim();
    if (trimmed) {
      localStorage.setItem(STORAGE_STATUS_OVERVIEW_FILE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_STATUS_OVERVIEW_FILE_KEY);
    }
    this.updateModalValues();
    const customFileName = document.getElementById('custom-file-name');
    if (customFileName && trimmed) {
      customFileName.textContent = trimmed;
    }
  }

  updateStatusBadge() {
    const badges = [
      this.statusBadge || document.getElementById('sync-status-badge'),
      this.headerStatusBadge || document.getElementById('header-sync-status-badge')
    ].filter(Boolean);
    if (badges.length === 0) return;
    
    const hasEndpoint = Boolean(this.getEndpointUrl());
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    badges.forEach(badge => {
      if (this.syncStatus === 'syncing') {
        badge.className = 'sync-pill syncing';
        badge.innerHTML = `<span class="spin">⏳</span> กำลังซิงค์...`;
        badge.title = 'กำลังเชื่อมต่อและซิงค์ข้อมูลกับ Cloud Storage';
      } else if (this.syncStatus === 'error') {
        badge.className = 'sync-pill error';
        badge.innerHTML = `⚠️ ซิงค์ล้มเหลว`;
        badge.title = 'ไม่สามารถเชื่อมต่อ Cloud ได้ ระบบกำลังใช้ข้อมูลใน Local Cache';
      } else if (hasEndpoint) {
        badge.className = 'sync-pill success';
        const timeStr = this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
        const modeStr = this.autoSync ? '' : ' (Manual)';
        badge.innerHTML = `☁️ Google Drive${modeStr} ${timeStr ? '(' + timeStr + ')' : ''}`;
        badge.title = this.autoSync
          ? `เชื่อมต่อ Google Drive เรียบร้อย (Auto-Sync เปิดอยู่: ซิงค์ล่าสุด: ${this.lastSyncTime || 'ยังไม่มี'})`
          : `เชื่อมต่อ Google Drive (Auto-Sync ปิดอยู่: โหลด/บันทึกด้วยตนเอง)`;
      } else if (isLocalhost) {
        badge.className = 'sync-pill local';
        badge.innerHTML = `💻 Local Plan.json`;
        badge.title = 'เชื่อมต่อไฟล์ Plan.json ในเครื่อง (Local Dev Server)';
      } else {
        badge.className = 'sync-pill offline';
        badge.innerHTML = `💾 Local Cache`;
        badge.title = 'บันทึกในแคชของเบราว์เซอร์ (คลิกเพื่อตั้งค่าเชื่อมต่อ Google Drive)';
      }
    });
  }

  /**
   * ดึงข้อมูล Plan จาก Cloud (Google Drive / Endpoint) หรือ Local Cache
   */
  async pullFromCloud(silent = false) {
    // ซิงค์ค่า URL จากช่องกรอกหากผู้ใช้วาง URL ไว้แต่ยังไม่ได้กดปุ่มบันทึก URL
    const inputEndpoint = document.getElementById('input-sync-endpoint');
    if (inputEndpoint && inputEndpoint.value.trim() && inputEndpoint.value.trim() !== this.getEndpointUrl()) {
      this.setEndpointUrl(inputEndpoint.value.trim());
    }

    const endpoint = this.getEndpointUrl();
    this.syncStatus = 'syncing';
    this.updateStatusBadge();
    this.fetchPlanMaterials();

    // 1. ตรวจสอบกรณีผู้ใช้นำลิงก์ Google Drive Folder ธรรมดามาวางแทน Web App URL
    if (endpoint && endpoint.includes('drive.google.com')) {
      this.syncStatus = 'error';
      this.updateStatusBadge();
      this.updateModalValues();
      if (!silent) {
        this.showToast('⚠️ URL ที่ระบุเป็น Google Drive Link ไม่ใช่ Web App Sync API URL (ดูวิธีสร้าง Web App จาก Google Apps Script ด้านล่าง)', 'error');
        document.getElementById('input-sync-endpoint')?.focus();
      }
      return false;
    }

    // 2. หากมี Cloud Endpoint ให้ดึงจาก Cloud (Google Apps Script Web App)
    // ถ้า silent = true (เปิดแอปอัตโนมัติ) และปิด autoSync ไว้ จะข้ามการดึงจาก Cloud ไปยัง Local Server / Local Cache แทน
    if (endpoint && (!silent || this.autoSync)) {
      try {
        if (!silent) {
          this.showToast('☁️ กำลังเชื่อมต่อและดึงข้อมูลจาก Cloud...', 'info');
        }

        const fetchUrl = endpoint.includes('?') ? `${endpoint}&t=${Date.now()}` : `${endpoint}?t=${Date.now()}`;
        const response = await fetch(fetchUrl, {
          method: 'GET',
          redirect: 'follow',
          cache: 'no-cache'
        });

        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
        }

        const rawText = await response.text();
        if (!rawText || !rawText.trim()) {
          throw new Error('ไม่ได้รับข้อมูลตอบกลับจาก Cloud Endpoint');
        }

        // ตรวจสอบกรณี Google redirect ไปหน้า Sign-in (เนื่องจาก deploy ไม่ได้เลือก Anyone)
        if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
          throw new Error('Google Apps Script ส่งคืนหน้า Login (กรุณาตั้งค่า Deploy -> "ผู้ที่มีสิทธิ์เข้าถึง" ให้เป็น "ทุกคน (Anyone)")');
        }

        let resJson;
        try {
          resJson = JSON.parse(rawText);
        } catch (parseErr) {
          throw new Error('ข้อมูลจาก Cloud ไม่ใช่รูปแบบ JSON: ' + parseErr.message);
        }

        if (resJson && resJson.status === 'error') {
          throw new Error(resJson.message || 'Google Apps Script ส่งคืนสถานะ error');
        }

        const payloadData = resJson.data || resJson;

        const hasContent = payloadData && (
          (Array.isArray(payloadData.scheduledJobs) && payloadData.scheduledJobs.length > 0) ||
          (payloadData.completedPdHistory && Object.keys(payloadData.completedPdHistory).length > 0) ||
          (payloadData.workCenters && Object.keys(payloadData.workCenters).length > 0) ||
          Boolean(payloadData.scheduledJobs)
        );

        if (hasContent) {
          this.applyPayloadToState(payloadData);
          this.recordSyncSuccess(payloadData);
          this.updateModalValues();
          const wcCount = Object.keys(this.state.workCenters || {}).length;
          const jobCount = (this.state.scheduledJobs || []).length;
          const completedCount = Object.keys(this.state.completedPdHistory || {}).length;
          if (!silent) {
            this.showToast(`✅ ดึงข้อมูลล่าสุดจาก Cloud สำเร็จ: Plan (${jobCount} Tasks), machine_settings (${wcCount} เครื่อง), completed_pds (${completedCount} รายการ)`, 'success');
          } else {
            this.showToast(`☁️ โหลด Plan, Machine Settings (${wcCount} เครื่อง) และ Completed PDs (${completedCount} รายการ) จาก Cloud เรียบร้อย`, 'info');
          }
          if (!this.state.planMaterials || Object.keys(this.state.planMaterials).length === 0) {
            this.fetchPlanMaterials();
          }
          return true;
        } else {
          throw new Error('ไม่พบข้อมูลแผนงานใน Google Drive โฟลเดอร์เป้าหมาย');
        }
      } catch (err) {
        console.warn('Could not pull from Cloud Endpoint:', err);
        this.syncStatus = 'error';
        this.updateStatusBadge();
        this.updateModalValues();
        if (!silent) this.showToast(`⚠️ ดึงข้อมูล Cloud ไม่สำเร็จ: ${err.message}`, 'error');
      }
    }

    // 3. หากไม่มี Endpoint หรือดึงไม่ผ่านใน Localhost ให้ลองดึงจาก Server ไฟล์ Plan.json ในเครื่อง
    const isLocalDev = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.port === '5173'
    );

    if (isLocalDev) {
      const candidateUrls = ['/pirom_pdplan/api/plan', '/api/plan'];
      for (const url of candidateUrls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data && (data.scheduledJobs || data.completedPdHistory || data.workCenters)) {
              this.applyPayloadToState(data);
              this.syncStatus = 'success';
              this.updateStatusBadge();
              this.updateModalValues();
              if (!silent) {
                const jobCount = (this.state.scheduledJobs || []).length;
                const wcCount = Object.keys(this.state.workCenters || {}).length;
                const completedCount = Object.keys(this.state.completedPdHistory || {}).length;
                this.showToast(`✅ โหลดข้อมูลจากไฟล์ Plan.json, machine_settings.json (${wcCount} เครื่อง) และ completed_pds.json (${completedCount} รายการ) ในเครื่องสำเร็จ`, 'success');
              }
              this.fetchPlanMaterials();
              return true;
            }
          }
        } catch (e) {
          console.warn(`Local ${url} not reachable:`, e);
        }
      }
    }

    // 4. Fallback: โหลดจาก LocalStorage Cache
    const cached = localStorage.getItem(STORAGE_CACHE_KEY);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        this.applyPayloadToState(data);
        this.syncStatus = endpoint ? 'error' : 'local_only';
        this.updateStatusBadge();
        this.updateModalValues();
        if (!silent) {
          const jobCount = (this.state.scheduledJobs || []).length;
          const wcCount = Object.keys(this.state.workCenters || {}).length;
          const completedCount = Object.keys(this.state.completedPdHistory || {}).length;
          this.showToast(`💾 โหลดข้อมูลจาก Local Cache: Plan (${jobCount} Tasks), machine_settings (${wcCount} เครื่อง), completed_pds (${completedCount} รายการ)`, 'info');
        }
        return true;
      } catch (e) {
        console.error('Error reading cached plan:', e);
      }
    }

    // 5. หากไม่มีทั้ง Cloud Endpoint, Local /api/plan, และ Local Cache
    this.syncStatus = endpoint ? 'error' : 'local_only';
    this.updateStatusBadge();
    this.updateModalValues();
    if (!silent) {
      if (!endpoint) {
        this.showToast('⚠️ ยังไม่ได้ระบุ Web App Sync API URL (กรุณานำ URL จาก Google Apps Script มาวางในช่องด้านบน)', 'error');
        document.getElementById('input-sync-endpoint')?.focus();
      } else {
        this.showToast('❌ ไม่พบข้อมูลสำหรับโหลด', 'error');
      }
    }
    return false;
  }

  /**
   * ส่งข้อมูล Plan ขึ้น Cloud (Google Drive / Endpoint) และบันทึกแคช
   * ในโหมดวางแผน (plan mode) จะบันทึกทั้ง Local Cache และอัปโหลดขึ้น Cloud
   * ในโหมดดูแผน (view mode) จะบันทึกเฉพาะใน Local Cache เท่านั้น (ยกเว้นผู้ใช้สั่ง Cloud Save โดยตรง allowViewMode = true)
   */
  pushToCloud(payload, immediate = false, isClosing = false, allowViewMode = false) {
    // ถ้าอยู่ในโหมดดูแผน (view) และไม่ใช่การกดปุ่มบันทึก Cloud Save โดยตรง (allowViewMode) ให้งดการบันทึกทุกช่องทาง
    if (this.getUserMode() !== 'plan' && !allowViewMode) return;

    // บันทึก Local Cache ทันทีเมื่ออยู่ในโหมดวางแผน
    try {
      const localCopy = { ...payload };
      delete localCopy.planMaterials;
      delete localCopy.dwgToPdMap;
      delete localCopy._includeMaterials;
      const payloadStr = JSON.stringify(localCopy);
      if (payloadStr.length < 4 * 1024 * 1024) {
        localStorage.setItem(STORAGE_CACHE_KEY, payloadStr);
      }
      if (payload && payload.workCenters) {
        localStorage.setItem('pdplan_machine_settings', JSON.stringify({
          workCenters: payload.workCenters,
          workCenterOrder: payload.workCenterOrder || []
        }));
      }
      if (payload && payload.completedPdHistory) {
        localStorage.setItem('pdplan_completed_pds', JSON.stringify(payload.completedPdHistory));
      }
    } catch (e) {
      console.warn('Failed to save to localStorage cache:', e);
    }

    if (!this.autoSync && !immediate && !isClosing && !allowViewMode) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (immediate || isClosing || allowViewMode) {
      return this.executePush(payload, isClosing);
    }

    const delay = 600; // Debounce 0.6 วินาที
    this.debounceTimer = setTimeout(() => {
      this.executePush(payload, false);
    }, delay);
  }

  async executePush(payload, isClosing = false) {
    const endpoint = this.getEndpointUrl();

    // 1. ถ้าอยู่ Localhost หรือ Dev Server ให้ส่งไปที่ local API ด้วย (ซึ่งจะบันทึกลง Google Drive Desktop โฟลเดอร์เดียวกับ LN Status Overview)
    const isLocalDev = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.port === '5173'
    );

    const pushBodyObj = { ...payload };
    if (!pushBodyObj._includeMaterials) {
      delete pushBodyObj.planMaterials;
      delete pushBodyObj.dwgToPdMap;
    }
    delete pushBodyObj._includeMaterials;
    const bodyStr = JSON.stringify(pushBodyObj);
    const useKeepalive = isClosing && bodyStr.length < 60000;

    if (isLocalDev) {
      const candidateUrls = ['/pirom_pdplan/api/plan', '/api/plan'];
      for (const localApiUrl of candidateUrls) {
        try {
          const targetUrl = isClosing ? `${localApiUrl}?forwardCloud=1` : localApiUrl;
          if (useKeepalive && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([bodyStr], { type: 'application/json' });
            navigator.sendBeacon(targetUrl, blob);
          } else {
            fetch(targetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: bodyStr,
              keepalive: useKeepalive
            }).catch(err => console.warn(`Local ${localApiUrl} push failed:`, err));
          }
          break;
        } catch (e) {}
      }
    }

    // 2. ถ้ามี Cloud Endpoint ส่งไปยัง Google Drive โฟลเดอร์เดียวกับ LN Status Overview
    if (!endpoint) {
      this.syncStatus = 'local_only';
      this.updateStatusBadge();
      this.updateModalValues();
      return;
    }

    if (useKeepalive && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([bodyStr], { type: 'text/plain;charset=utf-8' });
        navigator.sendBeacon(endpoint, blob);
        return;
      } catch (e) {}
    }

    if (!isClosing) {
      this.syncStatus = 'syncing';
      this.updateStatusBadge();
    }

    try {
      // ส่ง POST ไปยัง Google Apps Script
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain ป้องกัน preflight CORS issue ใน Google Apps Script
        body: bodyStr,
        keepalive: useKeepalive
      });

      if (res.ok) {
        this.recordSyncSuccess(pushBodyObj);
        this.updateModalValues();
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('Cloud sync push error:', err);
      if (!isClosing) {
        this.syncStatus = 'error';
        this.updateStatusBadge();
        this.updateModalValues();
      }
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

    this.state._isLoadingData = true;
    try {
      if (Array.isArray(data.workOrders) && data.workOrders.length > 0) {
        this.state.workOrders = data.workOrders;
      }
      if (Array.isArray(data.scheduledJobs)) this.state.scheduledJobs = data.scheduledJobs;
      if (data.nests) this.state.nests = data.nests;
      if (data.assemblyLinks) this.state.assemblyLinks = data.assemblyLinks;
      if (data.lockedProjects) this.state.lockedProjects = data.lockedProjects;
      if (data.priorityColors) this.state.priorityColors = data.priorityColors;
      if (data.projectColors) this.state.projectColors = data.projectColors;
      if (data.customerColors) this.state.customerColors = data.customerColors;
      if (data.workCenters) {
        if (this.state && typeof this.state.sanitizeWorkCenters === 'function') {
          data.workCenters = this.state.sanitizeWorkCenters(data.workCenters);
        }
        this.state.workCenters = data.workCenters;
        try {
          localStorage.setItem('pdplan_machine_settings', JSON.stringify({
            workCenters: data.workCenters,
            workCenterOrder: data.workCenterOrder || this.state.workCenterOrder
          }));
        } catch (e) {}
      }
      if (data.workCenterOrder) this.state.workCenterOrder = data.workCenterOrder;
      if (data.timelineOffset !== undefined) this.state.timelineOffset = data.timelineOffset;
      if (data.activeScale) this.state.activeScale = data.activeScale;
      if (data.completedPdHistory) {
        if (Array.isArray(data.completedPdHistory)) {
          const obj = {};
          data.completedPdHistory.forEach(item => {
            const id = typeof item === 'string' ? item : (item.id || item.woId || item.pdId);
            if (id) obj[id] = true;
          });
          this.state.completedPdHistory = obj;
        } else if (typeof data.completedPdHistory === 'object') {
          this.state.completedPdHistory = data.completedPdHistory;
        }
        try {
          localStorage.setItem('pdplan_completed_pds', JSON.stringify(this.state.completedPdHistory));
        } catch (e) {}
      }
      if (data.favoritePDs) this.state.favoritePDs = data.favoritePDs;
      if (data.removedStepHistory) this.state.removedStepHistory = data.removedStepHistory;
      if (data.planMaterials) this.state.planMaterials = data.planMaterials;
      if (data.dwgToPdMap) this.state.dwgToPdMap = data.dwgToPdMap;

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
    } finally {
      this.state._isLoadingData = false;
    }
  }

  // ============================================================================
  // Local Cache (IndexedDB & Memory) for Status Overview & Plan Materials
  // ============================================================================

  openCacheDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB is not supported'));
      }
      const request = indexedDB.open('PDPlanExcelDB', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('ExcelStore')) {
          db.createObjectStore('ExcelStore');
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * บันทึกไฟล์ Status Overview (.xlsx) ลง Local Cache (IndexedDB & Memory) เพื่อความรวดเร็ว
   */
  async saveOverviewToCache(filename, arrayBuffer, metadata = {}) {
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return false;
    const cachedAt = Date.now();
    this._overviewCache = {
      filename,
      arrayBuffer,
      cachedAt,
      size: arrayBuffer.byteLength,
      ...metadata
    };

    try {
      const db = await this.openCacheDB();
      return new Promise((resolve) => {
        const tx = db.transaction('ExcelStore', 'readwrite');
        const store = tx.objectStore('ExcelStore');
        store.put(arrayBuffer, 'lastExcelBuffer');
        store.put(filename, 'lastExcelName');
        store.put(cachedAt, 'lastExcelCachedAt');
        store.put(arrayBuffer.byteLength, 'lastExcelSize');
        if (metadata.lastModified) {
          store.put(metadata.lastModified, 'lastExcelModified');
        }
        tx.oncomplete = () => {
          this.updateModalValues();
          resolve(true);
        };
        tx.onerror = () => resolve(false);
      });
    } catch (err) {
      console.warn('Failed to save Status Overview to IndexedDB cache:', err);
      return false;
    }
  }

  /**
   * ดึงไฟล์ Status Overview จาก Local Cache (Memory หรือ IndexedDB)
   */
  async getOverviewFromCache(expectedFilename = null) {
    // 1. ตรวจสอบ In-Memory Cache ก่อนเพื่อความเร็วสูงสุด 0ms
    if (this._overviewCache && this._overviewCache.arrayBuffer) {
      if (!expectedFilename || !this._overviewCache.filename || 
          this._overviewCache.filename.toLowerCase() === expectedFilename.toLowerCase()) {
        return {
          arrayBuffer: this._overviewCache.arrayBuffer,
          filename: this._overviewCache.filename || expectedFilename,
          cachedAt: this._overviewCache.cachedAt,
          size: this._overviewCache.size || this._overviewCache.arrayBuffer.byteLength,
          fromCache: true
        };
      }
    }

    // 2. ดึงจาก IndexedDB
    try {
      const db = await this.openCacheDB();
      return new Promise((resolve) => {
        const tx = db.transaction('ExcelStore', 'readonly');
        const store = tx.objectStore('ExcelStore');
        const reqBuffer = store.get('lastExcelBuffer');
        const reqName = store.get('lastExcelName');
        const reqCachedAt = store.get('lastExcelCachedAt');
        const reqModified = store.get('lastExcelModified');
        const reqSize = store.get('lastExcelSize');

        tx.oncomplete = () => {
          const buffer = reqBuffer.result;
          const fn = reqName.result;
          if (buffer && buffer.byteLength > 0) {
            this._overviewCache = {
              arrayBuffer: buffer,
              filename: fn,
              cachedAt: reqCachedAt.result || Date.now(),
              lastModified: reqModified.result || null,
              size: reqSize.result || buffer.byteLength
            };
            resolve({
              arrayBuffer: buffer,
              filename: fn || expectedFilename,
              cachedAt: reqCachedAt.result || Date.now(),
              lastModified: reqModified.result || null,
              size: buffer.byteLength,
              fromCache: true
            });
          } else {
            resolve(null);
          }
        };
        tx.onerror = () => resolve(null);
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * บันทึกข้อมูลวัสดุ BOM Plan + Mat ที่ประมวลผลแล้วลง Local Cache
   */
  async savePlanMaterialsToCache(planMaterials, dwgToPdMap = {}, filename = '') {
    if (!planMaterials || Object.keys(planMaterials).length === 0) return false;
    const cachedAt = Date.now();
    this._materialsCache = {
      planMaterials,
      dwgToPdMap: dwgToPdMap || {},
      cachedAt,
      filename: filename || this.getStatusOverviewFilename()
    };

    try {
      const db = await this.openCacheDB();
      return new Promise((resolve) => {
        const tx = db.transaction('ExcelStore', 'readwrite');
        const store = tx.objectStore('ExcelStore');
        store.put({
          planMaterials,
          dwgToPdMap: dwgToPdMap || {},
          cachedAt,
          filename: filename || this.getStatusOverviewFilename()
        }, 'planMaterialsCache');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (err) {
      console.warn('savePlanMaterialsToCache error:', err);
      return false;
    }
  }

  /**
   * ดึงข้อมูลวัสดุ BOM Plan + Mat จาก Local Cache
   */
  async getPlanMaterialsFromCache() {
    if (this._materialsCache && this._materialsCache.planMaterials && Object.keys(this._materialsCache.planMaterials).length > 0) {
      return this._materialsCache;
    }

    try {
      const db = await this.openCacheDB();
      return new Promise((resolve) => {
        const tx = db.transaction('ExcelStore', 'readonly');
        const store = tx.objectStore('ExcelStore');
        const req = store.get('planMaterialsCache');
        tx.oncomplete = () => {
          if (req.result && req.result.planMaterials && Object.keys(req.result.planMaterials).length > 0) {
            this._materialsCache = req.result;
            resolve(req.result);
          } else {
            resolve(null);
          }
        };
        tx.onerror = () => resolve(null);
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * ล้าง Local Cache ของ Status Overview และ Plan Materials
   */
  async clearOverviewLocalCache() {
    this._overviewCache = null;
    this._materialsCache = null;
    try {
      const db = await this.openCacheDB();
      return new Promise((resolve) => {
        const tx = db.transaction('ExcelStore', 'readwrite');
        const store = tx.objectStore('ExcelStore');
        store.delete('lastExcelBuffer');
        store.delete('lastExcelName');
        store.delete('lastExcelCachedAt');
        store.delete('lastExcelModified');
        store.delete('lastExcelSize');
        store.delete('planMaterialsCache');
        tx.oncomplete = () => {
          this.updateModalValues();
          resolve(true);
        };
        tx.onerror = () => resolve(false);
      });
    } catch (err) {
      return false;
    }
  }

  /**
   * อัปโหลดไฟล์ Status Overview ขึ้น Google Drive (เฉพาะโหมดวางแผน)
   */
  async uploadStatusOverviewToCloud(filename, arrayBuffer) {
    if (this.getUserMode() !== 'plan') return false;
    const endpoint = this.getEndpointUrl();
    if (!endpoint) return false;

    try {
      let binary = '';
      const bytes = new Uint8Array(arrayBuffer);
      const len = bytes.byteLength;
      const chunkSize = 0x8000;
      for (let i = 0; i < len; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
      }
      const b64 = btoa(binary);

      const payload = {
        action: 'upload-status-overview',
        statusOverviewFilename: filename,
        statusOverviewBase64: b64
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (err) {
      console.warn('Error uploading status overview to Cloud:', err);
      return false;
    }
  }

  /**
   * ดึงไฟล์ Status Overview (เช่น LN Status Overview.xlsx)
   * โดยดึงจาก Local Cache ก่อนเพื่อความเร็วสูงสุด
   * หากอยู่ในโหมดวางแผน จะอัปโหลด/ซิงค์ข้อมูลเก็บไว้ใน Cloud
   */
  async fetchStatusOverview(options = {}) {
    const force = typeof options === 'boolean' ? options : Boolean(options.force);
    const silent = typeof options === 'object' ? Boolean(options.silent) : false;
    const filename = this.getStatusOverviewFilename();

    // 1. ถ้าไม่สั่ง force ให้ดึงจาก Local Cache ทันที เพื่อความเร็วสูงสุด (0ms - 10ms)
    if (!force) {
      const cached = await this.getOverviewFromCache(filename);
      if (cached && cached.arrayBuffer) {
        if (!silent) {
          const sizeMb = (cached.arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
          const timeStr = cached.cachedAt ? new Date(cached.cachedAt).toLocaleTimeString('th-TH') : '';
          console.log(`[StatusOverview] Loaded from Local Cache (${sizeMb} MB, ${cached.filename}${timeStr ? ' at ' + timeStr : ''})`);
        }
        return cached;
      }
    }

    // 2. ถ้าไม่มีแคช หรือสั่ง force=true ให้ดึงจาก Local Dev Server หรือ Google Drive
    if (!silent) {
      this.showToast(`⏳ กำลังดึงไฟล์ Status Overview (${filename})...`, 'info');
    }

    let fetchedResult = null;

    const isLocalDev = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.port === '5173'
    );

    if (isLocalDev) {
      const candidateUrls = [
        `/pirom_pdplan/api/status-overview?filename=${encodeURIComponent(filename)}`,
        `/api/status-overview?filename=${encodeURIComponent(filename)}`
      ];
      for (const url of candidateUrls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const buffer = await res.arrayBuffer();
            let fn = filename;
            const xfn = res.headers.get('X-Filename');
            if (xfn) {
              try { fn = decodeURIComponent(xfn); } catch(e) {}
            }
            fetchedResult = { arrayBuffer: buffer, filename: fn, source: 'local_server' };
            break;
          }
        } catch (err) {
          console.warn(`Local ${url} not reachable:`, err);
        }
      }
    }

    // 3. ถ้าดึงจาก Local Dev Server ไม่ได้ หรืออยู่นอกเครื่อง ให้ดึงจาก Cloud Endpoint (Google Apps Script)
    if (!fetchedResult) {
      const endpoint = this.getEndpointUrl();
      if (endpoint) {
        try {
          const fetchUrl = endpoint.includes('?') 
            ? `${endpoint}&action=status-overview&filename=${encodeURIComponent(filename)}&t=${Date.now()}` 
            : `${endpoint}?action=status-overview&filename=${encodeURIComponent(filename)}&t=${Date.now()}`;
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
              fetchedResult = {
                arrayBuffer: bytes.buffer,
                filename: json.filename || filename,
                lastModified: json.lastModified,
                source: 'cloud'
              };
            }
          }
        } catch (err) {
          console.warn('Google Drive status-overview fetch error:', err);
        }
      }
    }

    // 4. เมื่อดึงข้อมูลสำเร็จ: บันทึกลง Local Cache ทันที เพื่อความเร็วในการใช้งานครั้งต่อไป
    if (fetchedResult && fetchedResult.arrayBuffer) {
      await this.saveOverviewToCache(fetchedResult.filename, fetchedResult.arrayBuffer, {
        lastModified: fetchedResult.lastModified
      });

      // ซิงค์กับ workflowController หากมี
      if (this.state.workflowController && typeof this.state.workflowController.saveExcelToDB === 'function') {
        try {
          await this.state.workflowController.saveExcelToDB(fetchedResult.filename, fetchedResult.arrayBuffer);
        } catch(e) {}
      }

      // ถ้าอยู่ใน "โหมดวางแผน" ค่อย Up ข้อมูลเก็บไว้ใน Cloud
      const isPlanMode = this.getUserMode() === 'plan';
      if (isPlanMode) {
        // ในโหมดวางแผน: อัปเดตข้อมูลขึ้น Cloud (หากไฟล์ดึงมาจาก Local Dev Server หรือผู้ใช้เลือกใหม่)
        if (fetchedResult.source !== 'cloud') {
          this.uploadStatusOverviewToCloud(fetchedResult.filename, fetchedResult.arrayBuffer);
        }
        if (!silent) {
          this.showToast(`☁️ [โหมดวางแผน] แคช "${fetchedResult.filename}" ในเครื่อง และซิงค์กับ Cloud เรียบร้อย`, 'success');
        }
      } else {
        if (!silent) {
          this.showToast(`💾 [โหมดดูแผน] บันทึกแคช "${fetchedResult.filename}" ในเครื่อง (Local) เรียบร้อย (ไม่บันทึกขึ้น Cloud)`, 'info');
        }
      }

      return fetchedResult;
    }

    // 5. Fallback: หากดึงจาก Server/Cloud ไม่ได้ ให้โหลดจาก IndexedDB เดิมที่เคยมี
    const fallbackCached = await this.getOverviewFromCache();
    if (fallbackCached && fallbackCached.arrayBuffer) {
      if (!silent) {
        this.showToast(`💾 โหลดไฟล์ "${fallbackCached.filename}" จาก Local Cache ในเครื่อง`, 'info');
      }
      return fallbackCached;
    }

    return null;
  }

  /**
   * ดึงข้อมูล Plan + Mat และ Drawing Map จาก /api/plan-materials, plan_materials_cache.json
   * หรืออ่านตรงจาก Sheet "Plan + Mat" ในไฟล์ Status Overview
   * มีระบบ Local Cache เพื่อความรวดเร็ว และหากอยู่ในโหมดวางแผนจะ Up ข้อมูลขึ้น Cloud
   */
  async fetchPlanMaterials(force = false) {
    if (!force && this.state.planMaterials && Object.keys(this.state.planMaterials).length > 0) {
      return this.state.planMaterials;
    }
    if (this._fetchPlanMaterialsPromise && !force) {
      return this._fetchPlanMaterialsPromise;
    }

    this._fetchPlanMaterialsPromise = (async () => {
      const filename = this.getStatusOverviewFilename();

      // 1. ตรวจสอบจาก Local Cache ใน IndexedDB ก่อนเสมอ (เร็วระดับ ms ไม่ต้อง parse 17MB)
      if (!force) {
        const cachedMaterials = await this.getPlanMaterialsFromCache();
        if (cachedMaterials && cachedMaterials.planMaterials && Object.keys(cachedMaterials.planMaterials).length > 0) {
          this.state.planMaterials = cachedMaterials.planMaterials;
          if (cachedMaterials.dwgToPdMap) this.state.dwgToPdMap = cachedMaterials.dwgToPdMap;
          this.updateAssemblyTreeAfterMaterials();
          console.log(`[PlanMaterials] Loaded ${Object.keys(cachedMaterials.planMaterials).length} PDs from Local Cache`);
          return this.state.planMaterials;
        }
      }

      const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/pirom_pdplan/';
      const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

      const candidateUrls = [
        `${cleanBase}/api/plan-materials?filename=${encodeURIComponent(filename)}${force ? '&force=1' : ''}`,
        `/api/plan-materials?filename=${encodeURIComponent(filename)}${force ? '&force=1' : ''}`,
        `${cleanBase}/plan_materials_cache.json`,
        `./plan_materials_cache.json`,
        `/pirom_pdplan/plan_materials_cache.json`,
        `/plan_materials_cache.json`,
        'plan_materials_cache.json',
        `${cleanBase}/api/plan`,
        `/api/plan`,
        `${cleanBase}/Plan.json`,
        `./Plan.json`,
        '/pirom_pdplan/Plan.json',
        '/Plan.json',
        'Plan.json'
      ];

      for (const url of candidateUrls) {
        try {
          const res = await fetch(url, { cache: force ? 'reload' : 'default' });
          if (res.ok) {
            const json = await res.json();
            if (json && json.planMaterials && Object.keys(json.planMaterials).length > 0) {
              this.state.planMaterials = json.planMaterials;
              if (json.dwgToPdMap) this.state.dwgToPdMap = json.dwgToPdMap;
              this.updateAssemblyTreeAfterMaterials();
              // บันทึกลง Local Cache ทันที
              await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, filename);
              // ถ้าอยู่ในโหมดวางแผน ค่อย Up ข้อมูลเก็บไว้ใน Cloud
              if (this.getUserMode() === 'plan') {
                this.pushToCloud(this.state.buildPlanPayload(), true);
              }
              return this.state.planMaterials;
            }
          }
        } catch (e) {
          // silently continue to next candidate
        }
      }

      // 2. ตรวจสอบจาก Cloud Endpoint (Google Apps Script)
      const endpoint = this.getEndpointUrl();
      if (endpoint) {
        try {
          const cloudUrl = endpoint.includes('?') 
            ? `${endpoint}&action=plan-materials&filename=${encodeURIComponent(filename)}&t=${Date.now()}` 
            : `${endpoint}?action=plan-materials&filename=${encodeURIComponent(filename)}&t=${Date.now()}`;
          const res = await fetch(cloudUrl);
          if (res.ok) {
            const json = await res.json();
            if (json.status === 'success' && json.data && json.data.planMaterials) {
              this.state.planMaterials = json.data.planMaterials;
              if (json.data.dwgToPdMap) this.state.dwgToPdMap = json.data.dwgToPdMap;
              this.updateAssemblyTreeAfterMaterials();
              // บันทึก Local Cache ทันที
              await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, filename);
              return this.state.planMaterials;
            }
          }
        } catch (e) {
          console.warn('Google Drive plan-materials fetch error:', e);
        }
      }

      // 3. Fallback: ดึงไฟล์ Status Overview (จาก Local Cache หรือ Google Drive) แล้ว Parse Sheet Plan + Mat ตรงๆ ด้วย SheetJS
      try {
        const overview = await this.fetchStatusOverview({ force });
        if (overview && overview.arrayBuffer && typeof XLSX !== 'undefined') {
          const workbook = XLSX.read(new Uint8Array(overview.arrayBuffer), { type: 'array' });
          const matSheetName = workbook.SheetNames.find(name => {
            const n = (name || '').trim().toLowerCase();
            return n === 'plan + mat' || n === 'plan+mat' || (n.includes('plan') && n.includes('mat'));
          });
          if (matSheetName && this.state.workflowController && typeof this.state.workflowController.parseAndStoreMaterials === 'function') {
            const matWorksheet = workbook.Sheets[matSheetName];
            const matRaw2D = XLSX.utils.sheet_to_json(matWorksheet, { header: 1, defval: '' });
            this.state.workflowController.parseAndStoreMaterials(matRaw2D);
            this.updateAssemblyTreeAfterMaterials();
            // บันทึกแคช Local ทันที
            await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, filename);
            // ถ้าอยู่ในโหมดวางแผน ค่อย Up ข้อมูลเก็บไว้ใน Cloud
            if (this.getUserMode() === 'plan') {
              this.pushToCloud(this.state.buildPlanPayload(), true);
              this.showToast(`☁️ [โหมดวางแผน] ซิงค์ Plan + Mat (${Object.keys(this.state.planMaterials).length} รายการ) ขึ้น Cloud สำเร็จ`, 'success');
            } else {
              this.showToast(`💾 [โหมดดูแผน] บันทึก Plan + Mat (${Object.keys(this.state.planMaterials).length} รายการ) ลง Local Cache สำเร็จ`, 'info');
            }
            return this.state.planMaterials;
          }
        }
      } catch (err) {
        console.warn('Fallback direct parse of Status Overview Plan+mat failed:', err);
      }

      return null;
    })();

    try {
      const res = await this._fetchPlanMaterialsPromise;
      return res;
    } finally {
      this._fetchPlanMaterialsPromise = null;
    }
  }

  updateAssemblyTreeAfterMaterials() {
    if (this.state.assemblyTree) {
      if (typeof this.state.assemblyTree.invalidateCache === 'function') {
        this.state.assemblyTree.invalidateCache();
      }
      if (typeof this.state.assemblyTree.getAllAssemblies === 'function') {
        this.state.assemblyTree.allAssemblies = this.state.assemblyTree.getAllAssemblies();
      }
      if (this.state.assemblyTree.bomModal && !this.state.assemblyTree.bomModal.classList.contains('hidden') && this.state.assemblyTree.bomActivePdId) {
        this.state.assemblyTree.bomCachedItems = this.state.assemblyTree.collectBomItems(this.state.assemblyTree.bomActivePdId);
        this.state.assemblyTree.renderBomTable();
      }
    }
    if (typeof this.state.notify === 'function') {
      this.state.notify();
    }
  }

  exportBackupJson() {
    const payload = this.state.buildPlanPayload();
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Plan.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('💾 บันทึกไฟล์ Plan.json (Local Save) สำเร็จ', 'success');
  }

  exportMachineSettingsJson() {
    const payload = {
      updatedAt: new Date().toISOString(),
      workCenters: this.state.workCenters,
      workCenterOrder: this.state.workCenterOrder || Object.keys(this.state.workCenters || {})
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'machine_settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('💾 ดาวน์โหลดไฟล์ machine_settings.json เรียบร้อย', 'success');
  }

  exportCompletedPdsJson() {
    const payload = this.state.completedPdHistory || {};
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'completed_pds.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('💾 ดาวน์โหลดไฟล์ completed_pds.json เรียบร้อย', 'success');
  }

  importBackupJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data && (data.scheduledJobs || data.completedPdHistory || data.workCenters)) {
          this.applyPayloadToState(data);
          this.pushToCloud(this.state.buildPlanPayload(), true);
          this.showToast(`✅ กู้คืนข้อมูลจากไฟล์ "${file.name}" สำเร็จ`, 'success');
        } else if (Array.isArray(data) || (typeof data === 'object' && !data.scheduledJobs)) {
          this.applyPayloadToState({ completedPdHistory: data });
          this.pushToCloud(this.state.buildPlanPayload(), true);
          this.showToast(`✅ นำเข้าข้อมูลจาก "${file.name}" สำเร็จ`, 'success');
        } else {
          this.showToast('❌ รูปแบบไฟล์ไม่ถูกต้อง', 'error');
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

  initModalEventListeners() {
    const modal = document.getElementById('storage-sync-modal');
    if (!modal) return;

    document.getElementById('btn-close-sync-modal')?.addEventListener('click', () => {
      this.closeSyncModal();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeSyncModal();
    });

    document.getElementById('btn-save-drive-folder')?.addEventListener('click', () => {
      const input = document.getElementById('input-drive-folder-url');
      if (input) {
        this.setDriveFolderUrl(input.value);
        this.updateModalValues();
        this.showToast('💾 บันทึก Google Drive Folder Location เรียบร้อย', 'success');
      }
    });

    document.getElementById('btn-reset-drive-folder')?.addEventListener('click', () => {
      this.setDriveFolderUrl(DEFAULT_DRIVE_FOLDER_URL);
      this.updateModalValues();
      this.showToast('↺ รีเซ็ตโฟลเดอร์ Google Drive เป็นค่าเริ่มต้น', 'info');
    });

    const inputDwgFolder = document.getElementById('input-dwg-folder-url');
    inputDwgFolder?.addEventListener('input', () => {
      const val = inputDwgFolder.value.trim() || DEFAULT_DWG_FOLDER_URL;
      const linkDwg = document.getElementById('link-open-dwg-folder');
      if (linkDwg && !this.isDwgLocationLocal(val)) {
        const m = val.match(/folders\/([a-zA-Z0-9_-]+)/);
        const fid = m ? m[1] : DEFAULT_DWG_FOLDER_ID;
        linkDwg.href = val.startsWith('http') ? val : `https://drive.google.com/drive/folders/${fid}`;
      }
    });

    document.getElementById('link-open-dwg-folder')?.addEventListener('click', async (e) => {
      const rawVal = (inputDwgFolder && inputDwgFolder.value.trim()) ? inputDwgFolder.value.trim() : this.getDwgFolderUrl();
      this.setDwgFolderUrl(rawVal);
      this.updateModalValues();
      if (this.isDwgLocationLocal(rawVal)) {
        e.preventDefault();
        try {
          const res = await fetch(`./api/open-dwg-folder?dir=${encodeURIComponent(rawVal)}`);
          const data = await res.json();
          if (res.ok && data.status === 'success') {
            this.showToast(`📂 เปิดโฟลเดอร์ในเครื่องแล้ว: ${data.openedPath || rawVal}`, 'success');
          } else {
            this.showToast(`⚠️ ${data.message || 'ไม่สามารถเปิดโฟลเดอร์ในเครื่องได้'}`, 'error');
          }
        } catch (err) {
          this.showToast(`⚠️ ไม่สามารถเปิดโฟลเดอร์ในเครื่องได้: ${rawVal}`, 'error');
        }
      }
    });

    document.getElementById('btn-browse-dwg-folder')?.addEventListener('click', async () => {
      this.showToast('📂 กรุณาเลือกโฟลเดอร์เก็บไฟล์ DWG จากหน้าต่างที่แสดงขึ้นมา...', 'info');
      try {
        const res = await fetch('./api/browse-dwg-folder');
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success' && data.folderPath) {
            this.setDwgFolderUrl(data.folderPath);
            this.updateModalValues();
            this.showToast(`💾 เลือกและบันทึกโฟลเดอร์ DWG เรียบร้อย: ${data.folderPath}`, 'success');
          }
        }
      } catch (err) {
        console.warn('Browse DWG folder failed:', err);
      }
    });

    document.getElementById('btn-save-dwg-folder')?.addEventListener('click', () => {
      const input = document.getElementById('input-dwg-folder-url');
      if (input) {
        const val = input.value.trim() || DEFAULT_DWG_FOLDER_URL;
        this.setDwgFolderUrl(val);
        this.updateModalValues();
        this.showToast('💾 บันทึกตำแหน่งเก็บไฟล์ DWG / Drawing PDF เรียบร้อย', 'success');
      }
    });

    document.getElementById('btn-reset-dwg-folder')?.addEventListener('click', () => {
      this.setDwgFolderUrl(DEFAULT_DWG_FOLDER_URL);
      this.updateModalValues();
      this.showToast('↺ รีเซ็ตตำแหน่งเก็บไฟล์ DWG เป็นค่าเริ่มต้น', 'info');
    });

    document.getElementById('btn-copy-dwg-folder-link')?.addEventListener('click', () => {
      const url = (inputDwgFolder && inputDwgFolder.value.trim()) ? inputDwgFolder.value.trim() : this.getDwgFolderUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('📋 คัดลอกตำแหน่งเก็บไฟล์ DWG เรียบร้อย: ' + url, 'success');
        }).catch(() => {
          prompt('คัดลอกตำแหน่งเก็บไฟล์ DWG:', url);
        });
      } else {
        prompt('คัดลอกตำแหน่งเก็บไฟล์ DWG:', url);
      }
    });

    document.getElementById('btn-save-status-overview-file')?.addEventListener('click', () => {
      const input = document.getElementById('input-status-overview-filename');
      if (input && input.value.trim()) {
        const fn = input.value.trim();
        this.setStatusOverviewFilename(fn);
        this.showToast(`💾 บันทึกชื่อไฟล์ Status Overview: ${fn}`, 'success');
        this.fetchPlanMaterials(true);
      }
    });

    document.getElementById('btn-reset-status-overview-file')?.addEventListener('click', () => {
      this.setStatusOverviewFilename(DEFAULT_STATUS_OVERVIEW_FILENAME);
      this.showToast(`↺ รีเซ็ตชื่อไฟล์เป็น ${DEFAULT_STATUS_OVERVIEW_FILENAME}`, 'info');
      this.fetchPlanMaterials(true);
    });

    document.getElementById('btn-browse-status-overview-file')?.addEventListener('click', () => {
      document.getElementById('input-file-status-overview-hidden')?.click();
    });

    const hiddenFileInput = document.getElementById('input-file-status-overview-hidden');
    hiddenFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      this.setStatusOverviewFilename(file.name);
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const buffer = evt.target.result;
        // 1. บันทึก Local Cache ทันทีเพื่อความรวดเร็ว
        await this.saveOverviewToCache(file.name, buffer);
        if (this.state.workflowController && typeof this.state.workflowController.saveExcelToDB === 'function') {
          await this.state.workflowController.saveExcelToDB(file.name, buffer);
        }
        if (typeof XLSX !== 'undefined') {
          try {
            const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
            const matSheetName = workbook.SheetNames.find(name => {
              const n = (name || '').trim().toLowerCase();
              return n === 'plan + mat' || n === 'plan+mat' || (n.includes('plan') && n.includes('mat'));
            });
            if (matSheetName && this.state.workflowController) {
              const matSheet = workbook.Sheets[matSheetName];
              const matRaw = XLSX.utils.sheet_to_json(matSheet, { header: 1, defval: '' });
              this.state.workflowController.parseAndStoreMaterials(matRaw);
              await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, file.name);
            }
          } catch (err) {
            console.warn('Error parsing chosen status overview file:', err);
          }
        }
        this.fetchPlanMaterials(true);

        // 2. ถ้าอยู่ในโหมดวางแผน ค่อย Up ข้อมูลเก็บไว้ใน cloud
        if (this.getUserMode() === 'plan') {
          const payload = this.state.buildPlanPayload();
          await this.pushToCloud(payload, true);
          this.uploadStatusOverviewToCloud(file.name, buffer);
          this.showToast(`☁️ [โหมดวางแผน] แคช "${file.name}" ในเครื่อง และอัปโหลดขึ้น Cloud เรียบร้อย`, 'success');
        } else {
          this.showToast(`💾 [โหมดดูแผน] แคช "${file.name}" ลงในเครื่อง (Local Cache) เรียบร้อย (ไม่มีการส่งขึ้น Cloud)`, 'info');
        }
        this.updateModalValues();
      };
      reader.readAsArrayBuffer(file);
    });

    // ปุ่มรีเฟรชดึงไฟล์และ BOM ใหม่จาก Cloud / Dev Server เพื่ออัปเดตแคช
    document.getElementById('btn-force-reload-status-overview')?.addEventListener('click', async () => {
      this.showToast('🔄 กำลังดึงไฟล์และ BOM ใหม่จาก Cloud/Server...', 'info');
      try {
        await this.fetchStatusOverview({ force: true });
        await this.fetchPlanMaterials(true);
        this.showToast('✅ ดึงไฟล์ใหม่และอัปเดตแคชในเครื่องเรียบร้อย', 'success');
      } catch (err) {
        this.showToast('⚠️ ไม่สามารถดึงไฟล์ใหม่ได้: ' + err.message, 'error');
      }
      this.updateModalValues();
    });

    document.getElementById('btn-save-sync-endpoint')?.addEventListener('click', () => {
      const input = document.getElementById('input-sync-endpoint');
      if (input) {
        this.setEndpointUrl(input.value);
        this.showToast('💾 บันทึก Cloud Sync URL เรียบร้อย', 'success');
        this.pullFromCloud(false);
      }
    });

    document.getElementById('btn-modal-cloud-save')?.addEventListener('click', async () => {
      const inputEndpoint = document.getElementById('input-sync-endpoint');
      if (inputEndpoint && inputEndpoint.value.trim() && inputEndpoint.value.trim() !== this.getEndpointUrl()) {
        this.setEndpointUrl(inputEndpoint.value.trim());
      }
      const endpoint = this.getEndpointUrl();
      const payload = this.state.buildPlanPayload();
      const wcCount = Object.keys(this.state?.workCenters || {}).length;
      const completedCount = Object.keys(this.state?.completedPdHistory || {}).length;

      const btn = document.getElementById('btn-modal-cloud-save');
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.7';
      }

      try {
        await this.pushToCloud(payload, true, false, true);
        if (endpoint) {
          this.showToast(`☁️ Cloud Save: บันทึก Plan.json, machine_settings.json (${wcCount} เครื่อง) และ completed_pds.json (${completedCount} รายการ) ขึ้น Cloud สำเร็จ`, 'success');
        } else {
          this.showToast(`💾 บันทึก Plan.json, machine_settings.json (${wcCount} เครื่อง) และ completed_pds.json (${completedCount} รายการ) ลง Local Cache และเครื่องเรียบร้อย`, 'info');
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      }
    });

    document.getElementById('btn-modal-local-save')?.addEventListener('click', () => {
      const payload = this.state.buildPlanPayload();
      try {
        const localCopy = { ...payload };
        if (localCopy.planMaterials && Object.keys(localCopy.planMaterials).length > 20) {
          delete localCopy.planMaterials;
          delete localCopy.dwgToPdMap;
        }
        localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(localCopy));
      } catch (e) {}
      this.exportBackupJson();
      const wcCount = Object.keys(this.state?.workCenters || {}).length;
      const completedCount = Object.keys(this.state?.completedPdHistory || {}).length;
      this.showToast(`💾 Local Save: บันทึก Plan.json, machine_settings.json (${wcCount} เครื่อง) และ completed_pds.json (${completedCount} รายการ) สำเร็จ`, 'success');
    });

    const btnCloudPull = document.getElementById('btn-modal-cloud-pull');
    btnCloudPull?.addEventListener('click', async () => {
      const inputEndpoint = document.getElementById('input-sync-endpoint');
      if (inputEndpoint && inputEndpoint.value.trim() && inputEndpoint.value.trim() !== this.getEndpointUrl()) {
        this.setEndpointUrl(inputEndpoint.value.trim());
      }

      const originalHtml = btnCloudPull.innerHTML;
      btnCloudPull.disabled = true;
      btnCloudPull.style.opacity = '0.7';
      btnCloudPull.innerHTML = `<span>⏳ กำลังดึงข้อมูล...</span>`;

      try {
        await this.pullFromCloud(false);
      } catch (err) {
        console.error('Error on Cloud Load:', err);
      } finally {
        btnCloudPull.disabled = false;
        btnCloudPull.style.opacity = '1';
        btnCloudPull.innerHTML = originalHtml;
      }
    });

    // Backwards compatibility bindings
    document.getElementById('btn-modal-push-sync')?.addEventListener('click', () => {
      const payload = this.state.buildPlanPayload();
      this.pushToCloud(payload, true, false, true);
      this.showToast('☁️ กำลังส่งข้อมูลขึ้น Cloud...', 'info');
    });

    document.getElementById('btn-modal-pull-sync')?.addEventListener('click', () => {
      this.pullFromCloud(false);
    });

    document.getElementById('btn-export-machine-json')?.addEventListener('click', () => {
      this.exportMachineSettingsJson();
    });

    document.getElementById('btn-export-completed-json')?.addEventListener('click', () => {
      this.exportCompletedPdsJson();
    });

    document.getElementById('btn-export-backup')?.addEventListener('click', () => {
      this.exportBackupJson();
    });

    document.getElementById('input-import-backup')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.importBackupJson(file);
    });

    document.getElementById('btn-hero-copy-link')?.addEventListener('click', () => {
      const url = this.getDriveFolderUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('📋 คัดลอกลิงก์เรียบร้อย: ' + url, 'success');
        }).catch(() => {
          prompt('คัดลอกลิงก์ Google Drive:', url);
        });
      } else {
        prompt('คัดลอกลิงก์ Google Drive:', url);
      }
    });

    document.getElementById('btn-copy-gas-code')?.addEventListener('click', () => {
      const code = this.generateGasCode();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
          this.showToast('📋 คัดลอกโค้ด Apps Script เรียบร้อยแล้ว', 'success');
        }).catch(() => this.fallbackCopyText(code));
      } else {
        this.fallbackCopyText(code);
      }
    });
  }

  initDwgPdfModalListeners() {
    const btnOpenDwgPdf = document.getElementById('btn-open-dwg-pdf');
    const dwgModal = document.getElementById('dwg-pdf-modal');
    const dwgWindow = document.getElementById('dwg-pdf-window');
    const dwgHeader = document.getElementById('dwg-pdf-modal-header');
    const btnCloseDwg = document.getElementById('btn-close-dwg-pdf-modal');
    const btnFullscreenDwg = document.getElementById('btn-dwg-pdf-fullscreen');
    const iframe = document.getElementById('dwg-pdf-iframe');
    const loadingEl = document.getElementById('dwg-pdf-loading');

    if (btnOpenDwgPdf) {
      btnOpenDwgPdf.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dwgInput = document.getElementById('edit-pd-dwgno');
        const dwgNo = (dwgInput?.value || '').trim();
        if (!dwgNo) {
          this.showToast('⚠️ กรุณาระบุรหัส Drawing No. ก่อนเปิดดูแบบ PDF', 'error');
          return;
        }
        this.openDwgPdfViewer(dwgNo);
      });
    }

    const closeDwgModal = () => {
      if (!dwgModal) return;
      dwgModal.classList.add('hidden');
      dwgModal.style.display = 'none';
      if (iframe) iframe.src = '';
    };

    btnCloseDwg?.addEventListener('click', closeDwgModal);
    dwgModal?.addEventListener('click', (e) => {
      if (e.target === dwgModal) closeDwgModal();
    });

    if (iframe && loadingEl) {
      iframe.addEventListener('load', () => {
        if (iframe.src && iframe.src !== window.location.href) {
          loadingEl.style.display = 'none';
        }
      });
    }

    if (btnFullscreenDwg && dwgWindow) {
      let isFullscreen = false;
      btnFullscreenDwg.addEventListener('click', () => {
        isFullscreen = !isFullscreen;
        if (isFullscreen) {
          dwgWindow.style.width = '99vw';
          dwgWindow.style.maxWidth = '99vw';
          dwgWindow.style.height = '97vh';
          dwgWindow.style.transform = 'none';
        } else {
          dwgWindow.style.width = '1250px';
          dwgWindow.style.maxWidth = '95vw';
          dwgWindow.style.height = '90vh';
        }
      });
    }

    // Draggable header support
    if (dwgHeader && dwgWindow) {
      let dragging = false;
      let startX = 0, startY = 0, origX = 0, origY = 0;
      dwgHeader.addEventListener('mousedown', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        dragging = true;
        dwgHeader.style.cursor = 'grabbing';
        const match = (dwgWindow.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        origX = match ? parseFloat(match[1]) : 0;
        origY = match ? parseFloat(match[2]) : 0;
        startX = e.clientX;
        startY = e.clientY;
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        dwgWindow.style.transform = `translate(${origX + dx}px, ${origY + dy}px)`;
      });
      window.addEventListener('mouseup', () => {
        if (dragging) {
          dragging = false;
          dwgHeader.style.cursor = 'grab';
        }
      });
    }
  }

  async openDwgPdfViewer(dwgNo) {
    const cleanDwg = String(dwgNo || '').trim();
    if (!cleanDwg) {
      this.showToast('⚠️ ไม่พบรหัส Drawing No.', 'error');
      return;
    }
    if (typeof window !== 'undefined' && typeof window.openDwgPdf === 'function') {
      return window.openDwgPdf(cleanDwg);
    }
    const endpoint = this.getEndpointUrl();
    const driveFolderId = this.getDwgFolderId();
    const popupWin = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (endpoint) {
      try {
        const sep = endpoint.includes('?') ? '&' : '?';
        const cloudUrl = `${endpoint}${sep}action=find-dwg-pdf&dwgNo=${encodeURIComponent(cleanDwg)}&dwgFolderId=${encodeURIComponent(driveFolderId)}&_t=${Date.now()}`;
        const res = await fetch(cloudUrl, { method: 'GET', redirect: 'follow' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.status === 'success' && (data.fileId || data.viewUrl)) {
            const viewUrl = data.fileId ? `https://drive.google.com/file/d/${data.fileId}/view` : data.viewUrl;
            if (popupWin && !popupWin.closed) {
              popupWin.location.replace(viewUrl);
            } else {
              window.open(viewUrl, '_blank');
            }
            this.showToast(`☁️ เปิดไฟล์แบบจาก Google Drive: ${data.filename || data.fileName || cleanDwg}`, 'success');
            return;
          }
        }
      } catch (err) {
        console.warn('Cloud DWG PDF lookup failed:', err);
      }
    }
    if (popupWin && !popupWin.closed) {
      try { popupWin.close(); } catch (e) {}
    }
    this.showToast(`⚠️ ไม่พบไฟล์แบบ: ${cleanDwg}`, 'error');
  }

  fallbackCopyText(text) {
    const prevEl = document.getElementById('gas-code-preview');
    if (prevEl) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(prevEl);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        document.execCommand('copy');
        this.showToast('📋 คัดลอกโค้ด Apps Script เรียบร้อยแล้ว', 'success');
      } catch (e) {
        this.showToast('⚠️ กรุณากดเลือกข้อความและคัดลอกด้วยตนเอง', 'info');
      }
    }
  }

  openSyncModal() {
    let modal = document.getElementById('storage-sync-modal');
    if (!modal) return;
    this.updateModalValues();
    modal.classList.remove('hidden');
    this.showToast('📁 ที่เก็บไฟล์ข้อมูล: ' + this.getDriveFolderUrl(), 'info');
  }

  closeSyncModal() {
    const modal = document.getElementById('storage-sync-modal');
    if (modal) modal.classList.add('hidden');
  }

  updateModalValues() {
    const currentFolderUrl = this.getDriveFolderUrl();
    const currentFolderId = this.getDriveFolderId();
    const currentDwgUrl = this.getDwgFolderUrl();
    const isDwgLocal = this.isDwgLocationLocal(currentDwgUrl);
    const currentEndpoint = this.getEndpointUrl();
    const lastSyncDisplay = this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleString('th-TH') : 'ยังไม่มีการซิงค์';
    const completedCount = Object.keys(this.state?.completedPdHistory || {}).length;
    const scheduledCount = (this.state?.scheduledJobs || []).length;

    // Update Hero link card
    const displayDriveFolder = document.getElementById('display-drive-folder-link');
    if (displayDriveFolder) {
      displayDriveFolder.href = currentFolderUrl;
      displayDriveFolder.textContent = currentFolderUrl;
    }

    const heroOpenDrive = document.getElementById('btn-hero-open-drive');
    if (heroOpenDrive) {
      heroOpenDrive.href = currentFolderUrl;
    }

    const menuDirectLink = document.getElementById('menu-direct-drive-link');
    if (menuDirectLink) {
      menuDirectLink.href = currentFolderUrl;
    }

    const headerDirectLink = document.getElementById('header-direct-drive-link');
    if (headerDirectLink) {
      headerDirectLink.href = currentFolderUrl;
    }

    const statusTextEl = document.getElementById('sync-modal-status-text');
    if (statusTextEl) {
      statusTextEl.innerText = this.statusBadge ? this.statusBadge.innerText : 'พร้อมใช้งาน';
    }

    const lastSyncEl = document.getElementById('sync-modal-last-sync');
    if (lastSyncEl) lastSyncEl.innerText = lastSyncDisplay;

    const completedEl = document.getElementById('sync-modal-completed-count');
    if (completedEl) completedEl.innerText = `${completedCount} รายการ`;

    const scheduledEl = document.getElementById('sync-modal-scheduled-count');
    if (scheduledEl) scheduledEl.innerText = `${scheduledCount} Tasks`;

    const wcCount = Object.keys(this.state?.workCenters || {}).length;
    const wcEl = document.getElementById('sync-modal-wc-count');
    if (wcEl) wcEl.innerText = `${wcCount} เครื่อง`;

    const currentStatusFile = this.getStatusOverviewFilename();
    const inputStatusFile = document.getElementById('input-status-overview-filename');
    if (inputStatusFile) inputStatusFile.value = currentStatusFile;
    const badgeStatusFile = document.getElementById('badge-status-overview-file');
    if (badgeStatusFile) badgeStatusFile.textContent = currentStatusFile;

    // DWG Folder UI update
    const inputDwgFolder = document.getElementById('input-dwg-folder-url');
    if (inputDwgFolder) inputDwgFolder.value = currentDwgUrl;

    const badgeDwgType = document.getElementById('badge-dwg-location-type');
    if (badgeDwgType) {
      badgeDwgType.textContent = isDwgLocal ? `Local Path: ${currentDwgUrl}` : `Drive ID: ${this.getDwgFolderId()}`;
    }

    const linkDwgFolder = document.getElementById('link-open-dwg-folder');
    if (linkDwgFolder) {
      if (isDwgLocal) {
        linkDwgFolder.href = `https://drive.google.com/drive/folders/${DEFAULT_DWG_FOLDER_ID}`;
        linkDwgFolder.title = `พาธในเครื่อง: ${currentDwgUrl} (คลิกเพื่อเปิด Google Drive สำรอง)`;
      } else {
        const href = currentDwgUrl.startsWith('http')
          ? currentDwgUrl
          : `https://drive.google.com/drive/folders/${this.getDwgFolderId()}`;
        linkDwgFolder.href = href;
        linkDwgFolder.title = href;
      }
    }

    // Cache status badge
    const cacheBadge = document.getElementById('status-overview-cache-badge');
    if (cacheBadge) {
      if (this._overviewCache && this._overviewCache.arrayBuffer) {
        const sizeMb = (this._overviewCache.arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
        const timeStr = this._overviewCache.cachedAt ? new Date(this._overviewCache.cachedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
        cacheBadge.innerHTML = `⚡ แคชในเครื่อง: <strong>${sizeMb} MB</strong> (${timeStr ? 'เวลา ' + timeStr : 'พร้อมใช้งาน'})`;
        cacheBadge.style.color = 'var(--accent-teal)';
      } else {
        this.getOverviewFromCache(currentStatusFile).then(c => {
          if (c && c.arrayBuffer && cacheBadge) {
            const sizeMb = (c.arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
            const timeStr = c.cachedAt ? new Date(c.cachedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
            cacheBadge.innerHTML = `⚡ แคชในเครื่อง: <strong>${sizeMb} MB</strong> (${timeStr ? 'เวลา ' + timeStr : 'พร้อมใช้งาน'})`;
            cacheBadge.style.color = 'var(--accent-teal)';
          } else if (cacheBadge) {
            cacheBadge.innerHTML = `ℹ️ ยังไม่มีแคชในเครื่อง (จะดึงและแคชอัตโนมัติเมื่อใช้งาน)`;
            cacheBadge.style.color = 'var(--text-secondary)';
          }
        });
      }
    }

    const inputFolder = document.getElementById('input-drive-folder-url');
    if (inputFolder) inputFolder.value = currentFolderUrl;

    const linkFolder = document.getElementById('link-open-drive-folder');
    if (linkFolder) linkFolder.href = currentFolderUrl;

    const guideLink = document.getElementById('guide-drive-link');
    if (guideLink) guideLink.href = currentFolderUrl;

    const inputEndpoint = document.getElementById('input-sync-endpoint');
    if (inputEndpoint) inputEndpoint.value = currentEndpoint;

    const idLabel = document.getElementById('guide-folder-id-label');
    if (idLabel) idLabel.textContent = currentFolderId;

    const codePreview = document.getElementById('gas-code-preview');
    if (codePreview) codePreview.textContent = this.generateGasCode();
  }

  generateGasCode() {
    const fId = this.getDriveFolderId();
    const dwgId = this.getDwgFolderId();
    return `const TARGET_FOLDER_ID = '${fId}';
const TARGET_DWG_FOLDER_ID = '${dwgId}';
const TARGET_FILE_NAME = 'Plan.json';
const MACHINE_SETTINGS_FILE_NAME = 'machine_settings.json';
const COMPLETED_PDS_FILE_NAME = 'completed_pds.json';
const DEFAULT_STATUS_OVERVIEW_FILE_NAME = 'LN Status Overview.xlsx';

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

function doGet(e) {
  try {
    const folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
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

    if (e && e.parameter && (e.parameter.action === 'machine-settings' || e.parameter.file === 'machine-settings')) {
      const msData = readJsonFile(folder, MACHINE_SETTINGS_FILE_NAME);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        fileName: MACHINE_SETTINGS_FILE_NAME,
        data: msData || {}
      })).setMimeType(ContentService.MimeType.JSON);
    }

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
            if (cand.getName().toLowerCase().includes(fallbackSubstr.toLowerCase())) { f = cand; break; }
          }
        }
        if (!f) return { exists: false };
        const sz = f.getSize();
        return { exists: true, name: f.getName(), fileId: f.getId(), sizeBytes: sz, sizeKB: +(sz / 1024).toFixed(1), sizeMB: +(sz / (1024 * 1024)).toFixed(2), updatedAt: f.getLastUpdated().toISOString() };
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

    if (e && e.parameter && (e.parameter.action === 'find-dwg-pdf' || e.parameter.action === 'dwg-pdf')) {
      const dwgNo = e.parameter.dwgNo ? String(e.parameter.dwgNo).trim() : '';
      const targetDwgFolderId = (e.parameter.dwgFolderId && String(e.parameter.dwgFolderId).trim()) || TARGET_DWG_FOLDER_ID;
      if (dwgNo) {
        const lowerTarget = dwgNo.toLowerCase();
        const searchInFolder = function(fldr) {
          let exact = null, partial = null;
          const files = fldr.getFiles();
          while (files.hasNext()) {
            const f = files.next();
            const lowerName = f.getName().toLowerCase();
            if (!lowerName.endsWith('.pdf')) continue;
            const base = lowerName.slice(0, -4).trim();
            if (base === lowerTarget) { exact = f; break; }
            if (!partial && (base.indexOf(lowerTarget) === 0 || base.indexOf(lowerTarget) !== -1)) partial = f;
          }
          return exact || partial;
        };
        let foundFile = null;
        try {
          foundFile = searchInFolder(DriveApp.getFolderById(targetDwgFolderId));
        } catch (err) {}
        if (!foundFile) foundFile = searchInFolder(folder);
        if (foundFile) {
          const fId = foundFile.getId();
          return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            dwgNo: dwgNo,
            filename: foundFile.getName(),
            fileId: fId,
            previewUrl: 'https://drive.google.com/file/d/' + fId + '/preview',
            viewUrl: 'https://drive.google.com/file/d/' + fId + '/view',
            downloadUrl: 'https://drive.google.com/uc?export=download&id=' + fId
          })).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'ไม่พบไฟล์ PDF สำหรับรหัสแบบ: ' + dwgNo
      })).setMimeType(ContentService.MimeType.JSON);
    }

    let content = { scheduledJobs: [], nests: {}, completedPdHistory: {}, workCenters: {}, workCenterOrder: [] };
    let lastModified = null;

    const planFiles = folder.getFilesByName(TARGET_FILE_NAME);
    if (planFiles.hasNext()) {
      const file = planFiles.next();
      lastModified = file.getLastUpdated().toISOString();
      try {
        const parsed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
        if (parsed && typeof parsed === 'object') content = Object.assign(content, parsed);
      } catch (err) {}
    }

    const machineSettings = readJsonFile(folder, MACHINE_SETTINGS_FILE_NAME);
    if (machineSettings) {
      if (machineSettings.workCenters) content.workCenters = machineSettings.workCenters;
      if (machineSettings.workCenterOrder) content.workCenterOrder = machineSettings.workCenterOrder;
    }

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

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', folderId: TARGET_FOLDER_ID, fileName: TARGET_FILE_NAME, lastModified, data: content })).setMimeType(ContentService.MimeType.JSON);
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

    const targetFile = saveTextFile(folder, TARGET_FILE_NAME, JSON.stringify(parsed, null, 2), MimeType.PLAIN_TEXT);

    if (parsed.workCenters) {
      const machinePayload = {
        updatedAt: new Date().toISOString(),
        workCenters: parsed.workCenters,
        workCenterOrder: parsed.workCenterOrder || Object.keys(parsed.workCenters)
      };
      saveTextFile(folder, MACHINE_SETTINGS_FILE_NAME, JSON.stringify(machinePayload, null, 2), MimeType.PLAIN_TEXT);
    }

    if (parsed.completedPdHistory) {
      saveTextFile(folder, COMPLETED_PDS_FILE_NAME, JSON.stringify(parsed.completedPdHistory, null, 2), MimeType.PLAIN_TEXT);
    }

    if (parsed.planMaterials && Object.keys(parsed.planMaterials).length > 0) {
      saveTextFile(folder, 'plan_materials_cache.json', JSON.stringify({ planMaterials: parsed.planMaterials, dwgToPdMap: parsed.dwgToPdMap || {} }), MimeType.PLAIN_TEXT);
    }

    if (parsed.statusOverviewBase64) {
      const fn = parsed.statusOverviewFilename || 'LN Status Overview.xlsx';
      const decodedBytes = Utilities.base64Decode(parsed.statusOverviewBase64);
      const existingFiles = folder.getFilesByName(fn);
      if (existingFiles.hasNext()) {
        existingFiles.next().setContent(decodedBytes);
      } else {
        folder.createFile(Utilities.newBlob(decodedBytes, MimeType.MICROSOFT_EXCEL, fn));
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Plan.json, machine_settings.json, completed_pds.json saved', fileId: targetFile.getId() })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}`;
  }
}
