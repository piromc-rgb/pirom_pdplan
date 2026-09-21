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
const STORAGE_USER_MODE_KEY = 'PDPLAN_USER_MODE';

export class StorageSyncManager {
  constructor(state) {
    this.state = state;
    if (typeof window !== 'undefined') {
      window.storageSyncManager = this;
      window.openStorageLocationModal = () => this.openSyncModal();
    }
    this.endpointUrl = localStorage.getItem(STORAGE_ENDPOINT_KEY) || '';
    this.autoSync = localStorage.getItem(STORAGE_AUTO_SYNC_KEY) !== 'false';
    this.lastSyncTime = localStorage.getItem(STORAGE_LAST_SYNC_KEY) || null;
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'success' | 'error' | 'local_only'
    this.debounceTimer = null;
    // โหมดผู้ใช้งาน: 'view' (ดูแผน - default) หรือ 'plan' (วางแผน)
    // ทุกครั้งที่เปิดใช้งานใหม่จะเริ่มต้นเป็น 'view' (ดูแผน) เป็นค่าเริ่มต้น
    this.userMode = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_USER_MODE_KEY) : null) || 'view';
    
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
      this.showToast('✏️ สลับเป็น "โหมดวางแผน" (Load เมื่อเปิด App และ Auto Save เมื่อปิด App)', 'success');
    } else {
      this.showToast('👁️ สลับเป็น "โหมดดูแผน" (Load เมื่อเปิด App แต่ไม่ Save เมื่อปิด App)', 'info');
    }
  }

  initUserModeUI() {
    this.btnUserMode = document.getElementById('btn-user-mode');
    this.userModeMenu = document.getElementById('user-mode-menu');
    this.userModeOptionView = document.getElementById('user-mode-option-view');
    this.userModeOptionPlan = document.getElementById('user-mode-option-plan');

    if (this.btnUserMode && this.userModeMenu) {
      this.btnUserMode.addEventListener('click', (e) => {
        e.stopPropagation();
        this.userModeMenu.classList.toggle('hidden');
        this.btnUserMode.classList.toggle('menu-open', !this.userModeMenu.classList.contains('hidden'));
      });

      document.addEventListener('click', (e) => {
        if (this.userModeMenu && !this.userModeMenu.classList.contains('hidden') &&
            !this.userModeMenu.contains(e.target) &&
            e.target !== this.btnUserMode) {
          this.userModeMenu.classList.add('hidden');
          this.btnUserMode.classList.remove('menu-open');
        }
      });
    }

    if (this.userModeOptionView) {
      this.userModeOptionView.addEventListener('click', () => {
        this.setUserMode('view');
        if (this.userModeMenu) this.userModeMenu.classList.add('hidden');
        if (this.btnUserMode) this.btnUserMode.classList.remove('menu-open');
      });
    }

    if (this.userModeOptionPlan) {
      this.userModeOptionPlan.addEventListener('click', () => {
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
        btnUserMode.title = 'โหมดผู้ใช้งาน: วางแผน (Load เปิด App / Save ปิด App) - คลิกเพื่อสลับโหมด';
      } else {
        btnUserMode.classList.remove('mode-plan');
        btnUserMode.classList.add('mode-view');
        btnUserMode.title = 'โหมดผู้ใช้งาน: ดูแผน (Load เปิด App / ไม่ Save ปิด App) - คลิกเพื่อสลับโหมด';
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
      if (!this.state) return;
      const payload = this.state.buildPlanPayload();

      // บันทึก Local Cache ทันที
      try {
        localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(payload));
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

      // ส่งข้อมูลขึ้น Cloud & Server ทันทีด้วย keepalive: true (เฉพาะเมื่อเปิด Auto-Sync และอยู่ในโหมดวางแผน)
      if (this.autoSync && this.getUserMode() === 'plan') {
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
   */
  pushToCloud(payload, immediate = false, isClosing = false) {
    // บันทึก Local Cache ทันทีเสมอ ป้องกันข้อมูลสูญหาย
    try {
      localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(payload));
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

    if (!this.autoSync && !immediate && !isClosing) return;

    // ถ้าอยู่ในโหมดดูแผน (view) และไม่ใช่การกดปุ่มบันทึกโดยตรง (immediate) ให้งด Auto-push ขึ้น Cloud / Server
    if (this.getUserMode() !== 'plan' && !immediate) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (immediate || isClosing) {
      return this.executePush(payload, isClosing);
    }

    const delay = 2000; // Debounce 2 วินาที
    this.debounceTimer = setTimeout(() => {
      this.executePush(payload, false);
    }, delay);
  }

  async executePush(payload, isClosing = false) {
    const endpoint = this.getEndpointUrl();

    // 1. ถ้าอยู่ Localhost หรือ Dev Server ให้ส่งไปที่ local API ด้วย
    const isLocalDev = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.port === '5173'
    );

    if (isLocalDev) {
      const candidateUrls = ['/pirom_pdplan/api/plan', '/api/plan'];
      for (const localApiUrl of candidateUrls) {
        try {
          fetch(localApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: isClosing
          }).catch(err => console.warn(`Local ${localApiUrl} push failed:`, err));
          break;
        } catch (e) {}
      }
    }

    // 2. ถ้ามี Cloud Endpoint ส่งไปยัง Google Drive
    if (!endpoint) {
      this.syncStatus = 'local_only';
      this.updateStatusBadge();
      this.updateModalValues();
      return;
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
        body: JSON.stringify(payload),
        keepalive: isClosing
      });

      if (res.ok) {
        this.recordSyncSuccess(payload);
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
        await this.pushToCloud(payload, true);
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
      this.pushToCloud(payload, true);
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
      this.pushToCloud(payload, true);
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
    return `const TARGET_FOLDER_ID = '${fId}';
const TARGET_FILE_NAME = 'Plan.json';
const MACHINE_SETTINGS_FILE_NAME = 'machine_settings.json';
const COMPLETED_PDS_FILE_NAME = 'completed_pds.json';

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

    if (e && e.parameter && (e.parameter.action === 'machine-settings' || e.parameter.file === 'machine-settings')) {
      const msData = readJsonFile(folder, MACHINE_SETTINGS_FILE_NAME);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        fileName: MACHINE_SETTINGS_FILE_NAME,
        data: msData || {}
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

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Plan.json, machine_settings.json, completed_pds.json saved', fileId: targetFile.getId() })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}`;
  }
}
