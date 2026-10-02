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
// Tabs (gid) of the production-date Google Sheet used when the local server cannot discover them
const PROD_DATES_FALLBACK_GIDS = ['2120309268', '949143801', '272068191', '1138800161', '193456236', '700419488', '1634563504', '749124766', '483699239', '69576872', '508816796', '940032116', '109541778', '499581033'];
const STORAGE_PROD_DATES_SHEET_KEY = 'PDPLAN_PROD_DATES_SHEET_URL';
export const DEFAULT_PROD_DATES_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1MwvA8HPTStZiESym9cPWxPuRb6q72wZk3hxKkJJXwgg/edit';
export const DEFAULT_STATUS_OVERVIEW_FILENAME = 'AUTO';
const STATUS_OVERVIEW_AUTO_MIGRATION_KEY = 'pdplan_so_auto_v1';
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
    this.tempDebounceTimer = null;
    this.hasUnsavedChanges = false;
    this.isSavingToCloud = false;
    // โหมดผู้ใช้งาน: 'view' (ดูแผน - default) หรือ 'plan' (วางแผน)
    // ทุกครั้งที่เปิดใช้งานใหม่จะเริ่มต้นเป็น 'view' (ดูแผน) เป็นค่าเริ่มต้น
    this.userMode = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_USER_MODE_KEY) : null) || 'view';
    
    // In-memory local cache for Status Overview (.xlsx) and Plan+Mat BOM for instant performance
    this._overviewCache = null;
    this._materialsCache = null;
    
    this.initUI();
    this.startMaterialToIssueWatcher();
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
    this.resolveStatusOverviewFilenameLight();
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
    this.updateStatusBadge();
    if (mode === 'plan') {
      this.showToast('✏️ สลับเป็นโหมด "EDIT" (ทำงานใน Temp Folder ของ Windows/macOS • กดปุ่ม 💾 Save เพื่อบันทึกขึ้น Cloud)', 'success');
      if (this.state && typeof this.state.buildPlanPayload === 'function') {
        if (typeof this.state.saveWorkOrdersToFile === 'function') this.state.saveWorkOrdersToFile(false);
        this.saveToTemp(this.state.buildPlanPayload(false), true, false);
      }
    } else {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      if (this.tempDebounceTimer) {
        clearTimeout(this.tempDebounceTimer);
        this.tempDebounceTimer = null;
      }
      this.showToast('👁️ สลับเป็นโหมด "VIEW ONLY" (ดูแผนอย่างเดียว)', 'info');
    }
  }

  initUserModeUI() {
    this.userModeWrapper = document.getElementById('user-mode-wrapper');
    this.btnUserMode = document.getElementById('btn-user-mode');
    this.btnEditModeSave = document.getElementById('btn-edit-mode-save');
    this.userModeMenu = document.getElementById('user-mode-menu');
    this.userModeOptionView = document.getElementById('user-mode-option-view');
    this.userModeOptionPlan = document.getElementById('user-mode-option-plan');

    // Header button: force-reload the newest Status Overview file
    const btnReloadOverview = document.getElementById('btn-reload-status-overview');
    if (btnReloadOverview) {
      btnReloadOverview.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btnReloadOverview.disabled) return;
        btnReloadOverview.disabled = true;
        const prevText = btnReloadOverview.textContent;
        btnReloadOverview.textContent = '⏳';
        try {
          await this.fetchPlanMaterials(true);
          this.showToast(`🔄 โหลด Status Overview ล่าสุดแล้ว${this.resolvedOverviewName ? `: ${this.resolvedOverviewName}` : ''}`);
        } catch (err) {
          this.showToast(`⚠️ โหลด Status Overview ไม่สำเร็จ: ${err.message || err}`, 'error');
        } finally {
          btnReloadOverview.textContent = prevText;
          btnReloadOverview.disabled = false;
        }
      });
    }

    if (this.btnEditModeSave) {
      this.btnEditModeSave.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.saveTempToCloud();
      });
    }

    let pwBox = document.getElementById('user-mode-password-box');
    if (!pwBox && this.userModeMenu) {
      pwBox = document.createElement('div');
      pwBox.id = 'user-mode-password-box';
      pwBox.className = 'hidden';
      pwBox.style.cssText = 'margin-top: 6px; padding: 10px; border-radius: 8px; background: rgba(22, 163, 74, 0.08); border: 1px solid rgba(34, 197, 94, 0.35);';
      pwBox.innerHTML = `
        <div style="font-size: 10.5px; font-weight: 700; color: #16a34a; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
          <span>🔑 กรอก Password เพื่อเปิดโหมด EDIT</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <input id="user-mode-password-input" type="password" inputmode="numeric" placeholder="Password" autocomplete="off" style="flex: 1; min-width: 0; padding: 5px 8px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-glass, #cbd5e1); background: var(--bg-darker, #ffffff); color: var(--text-primary, #0f172a); outline: none; font-family: monospace; letter-spacing: 2px;" />
          <button id="btn-user-mode-password-submit" type="button" style="padding: 5px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: none; background: #16a34a; color: #ffffff; cursor: pointer; white-space: nowrap;">ตกลง</button>
        </div>
        <div id="user-mode-password-error" class="hidden" style="color: #ef4444; font-size: 10px; font-weight: 600; margin-top: 5px;">
          ❌ รหัสผ่านไม่ถูกต้อง
        </div>
      `;
      this.userModeMenu.appendChild(pwBox);
    }

    const pwInput = document.getElementById('user-mode-password-input');
    const pwSubmit = document.getElementById('btn-user-mode-password-submit');
    const pwError = document.getElementById('user-mode-password-error');

    const resetPwBox = () => {
      if (pwBox) pwBox.classList.add('hidden');
      if (pwInput) {
        pwInput.value = '';
        pwInput.style.borderColor = 'var(--border-glass, #cbd5e1)';
      }
      if (pwError) pwError.classList.add('hidden');
    };

    const verifyPw = () => {
      if (!pwInput) return;
      const expectedPw = (localStorage.getItem('PDPLAN_EDIT_PASSWORD') || '1122').trim();
      if (pwInput.value.trim() === expectedPw) {
        resetPwBox();
        this.setUserMode('plan');
        if (this.userModeMenu) this.userModeMenu.classList.add('hidden');
        if (this.btnUserMode) this.btnUserMode.classList.remove('menu-open');
      } else {
        if (pwError) pwError.classList.remove('hidden');
        pwInput.style.borderColor = '#ef4444';
        pwInput.focus();
        pwInput.select();
        this.showToast('❌ รหัสผ่านไม่ถูกต้อง', 'error');
      }
    };

    if (pwBox) {
      pwBox.addEventListener('click', (e) => e.stopPropagation());
    }
    if (pwSubmit) {
      pwSubmit.addEventListener('click', (e) => {
        e.stopPropagation();
        verifyPw();
      });
    }
    if (pwInput) {
      pwInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          verifyPw();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          resetPwBox();
        }
      });
      pwInput.addEventListener('input', () => {
        if (pwError) pwError.classList.add('hidden');
        pwInput.style.borderColor = 'var(--border-glass, #cbd5e1)';
      });
    }

    if (this.btnUserMode && this.userModeMenu) {
      this.btnUserMode.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // ปิดเมนู Option อื่นๆ ก่อนเปิด
        const displayOptionsPanel = document.getElementById('display-options-panel');
        if (displayOptionsPanel) displayOptionsPanel.classList.add('hidden');

        const willOpen = this.userModeMenu.classList.contains('hidden');
        if (willOpen) {
          resetPwBox();
          this.userModeMenu.classList.remove('hidden');
          this.btnUserMode.classList.add('menu-open');
        } else {
          resetPwBox();
          this.userModeMenu.classList.add('hidden');
          this.btnUserMode.classList.remove('menu-open');
        }
      });

      document.addEventListener('click', (e) => {
        if (this.userModeMenu && !this.userModeMenu.classList.contains('hidden')) {
          if (this.userModeWrapper && !this.userModeWrapper.contains(e.target)) {
            resetPwBox();
            this.userModeMenu.classList.add('hidden');
            this.btnUserMode?.classList.remove('menu-open');
          }
        }
      });
    }

    if (this.userModeOptionView) {
      this.userModeOptionView.addEventListener('click', (e) => {
        e.stopPropagation();
        resetPwBox();
        this.setUserMode('view');
        if (this.userModeMenu) this.userModeMenu.classList.add('hidden');
        if (this.btnUserMode) this.btnUserMode.classList.remove('menu-open');
      });
    }

    if (this.userModeOptionPlan) {
      this.userModeOptionPlan.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.getUserMode() === 'plan') {
          resetPwBox();
          if (this.userModeMenu) this.userModeMenu.classList.add('hidden');
          if (this.btnUserMode) this.btnUserMode.classList.remove('menu-open');
          return;
        }
        if (pwBox) pwBox.classList.remove('hidden');
        if (pwError) pwError.classList.add('hidden');
        if (pwInput) {
          pwInput.value = '';
          pwInput.style.borderColor = '#16a34a';
          setTimeout(() => pwInput.focus(), 20);
        }
      });
    }

    this.updateUserModeUI();
  }

  updateUserModeUI() {
    const isPlan = this.getUserMode() === 'plan';
    const btnUserMode = this.btnUserMode || document.getElementById('btn-user-mode');
    const btnEditSave = this.btnEditModeSave || document.getElementById('btn-edit-mode-save');
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
        btnUserMode.title = 'โหมดผู้ใช้งาน: EDIT (ทำงานใน Temp Folder ของ Windows/macOS • กดปุ่ม Save เพื่อบันทึกขึ้น Cloud) - คลิกเพื่อสลับโหมด';
      } else {
        btnUserMode.classList.remove('mode-plan');
        btnUserMode.classList.add('mode-view');
        btnUserMode.title = 'โหมดผู้ใช้งาน: VIEW ONLY (ดูแผนอย่างเดียว) - คลิกเพื่อสลับโหมด';
      }
    }

    if (btnEditSave) {
      if (isPlan) {
        btnEditSave.classList.remove('hidden');
        btnEditSave.style.display = 'inline-flex';
      } else {
        btnEditSave.classList.add('hidden');
        btnEditSave.style.display = 'none';
      }
    }

    if (userModeIcon) {
      userModeIcon.textContent = isPlan ? '✏️' : '👁️';
    }
    if (userModeText) {
      userModeText.textContent = isPlan ? 'EDIT' : 'VIEW ONLY';
    }

    if (optView && optPlan) {
      optView.classList.toggle('active', !isPlan);
      optPlan.classList.toggle('active', isPlan);
    }
    if (checkView && checkPlan) {
      checkView.classList.toggle('hidden', isPlan);
      checkPlan.classList.toggle('hidden', !isPlan);
    }

    this.updateSaveButtonUI();
  }

  updateSaveButtonUI() {
    const btn = this.btnEditModeSave || document.getElementById('btn-edit-mode-save');
    const icon = document.getElementById('edit-save-icon');
    const text = document.getElementById('edit-save-text');
    const dot = document.getElementById('edit-save-dirty-dot');
    if (!btn) return;
    if (this.isSavingToCloud) {
      btn.disabled = true;
      btn.style.opacity = '0.85';
      if (icon) icon.textContent = '⏳';
      if (text) text.textContent = 'Saving...';
      if (dot) dot.style.display = 'none';
    } else if (this.hasUnsavedChanges) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.background = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
      btn.style.boxShadow = '0 2px 10px rgba(37, 99, 235, 0.45)';
      if (icon) icon.textContent = '💾';
      if (text) text.textContent = 'Save*';
      if (dot) dot.style.display = 'inline-block';
      btn.title = 'มีการแก้ไขใน Temp Folder (Windows/macOS) ที่ยังไม่ได้บันทึกขึ้น Cloud — คลิกเพื่อ Save ลง Cloud';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.background = 'linear-gradient(135deg, #0284c7, #0369a1)';
      btn.style.boxShadow = '0 2px 6px rgba(2, 132, 199, 0.25)';
      if (icon) icon.textContent = '💾';
      if (text) text.textContent = 'Save';
      if (dot) dot.style.display = 'none';
      btn.title = 'บันทึกข้อมูลจาก Temp Folder (Windows/macOS) ขึ้น Cloud (Google Drive)';
    }
  }

  initAppLifecycle() {
    if (typeof window === 'undefined') return;

    const handleAutoSaveToTemp = () => {
      // ถ้าอยู่ในโหมดดูแผน (view mode) ห้ามบันทึกใดๆ ทั้งสิ้น
      if (!this.state || this.getUserMode() !== 'plan') return;
      const payload = this.state.buildPlanPayload(false);
      // ระหว่างอยู่ในโหมด EDIT บันทึกลง Temp Folder + Local Cache เท่านั้น (จะขึ้น Cloud เมื่อกดปุ่ม Save)
      this.saveToTemp(payload, true, false);
    };

    window.addEventListener('beforeunload', () => handleAutoSaveToTemp());
    window.addEventListener('pagehide', () => handleAutoSaveToTemp());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        handleAutoSaveToTemp();
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

  getProdDatesSheetUrl() {
    return localStorage.getItem(STORAGE_PROD_DATES_SHEET_KEY) || DEFAULT_PROD_DATES_SHEET_URL;
  }

  setProdDatesSheetUrl(url) {
    const trimmed = (url || '').trim();
    if (trimmed && trimmed !== DEFAULT_PROD_DATES_SHEET_URL) localStorage.setItem(STORAGE_PROD_DATES_SHEET_KEY, trimmed);
    else localStorage.removeItem(STORAGE_PROD_DATES_SHEET_KEY);
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
    if (/^[a-zA-Z]:[\\/]/.test(str) || str.startsWith('./') || str.startsWith('../') || str.startsWith('~/') || str.startsWith('/') || str.includes('\\')) {
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
    try {
      // One-time: drop a previously pinned file name so AUTO (newest file) takes over
      if (!localStorage.getItem(STATUS_OVERVIEW_AUTO_MIGRATION_KEY)) {
        localStorage.setItem(STATUS_OVERVIEW_AUTO_MIGRATION_KEY, '1');
        localStorage.removeItem(STORAGE_STATUS_OVERVIEW_FILE_KEY);
      }
    } catch (e) {}
    return localStorage.getItem(STORAGE_STATUS_OVERVIEW_FILE_KEY) || DEFAULT_STATUS_OVERVIEW_FILENAME;
  }

  isStatusOverviewAuto() {
    return String(this.getStatusOverviewFilename() || '').trim().toUpperCase() === 'AUTO';
  }

  noteResolvedOverview(name) {
    if (!name || name.toUpperCase() === 'AUTO') return;
    this.resolvedOverviewName = name;
    const badge = document.getElementById('badge-status-overview-file');
    if (badge) badge.textContent = this.isStatusOverviewAuto() ? `AUTO → ${name}` : name;
    const headerName = document.getElementById('header-status-overview-name');
    if (headerName) headerName.textContent = name;
  }

  // Resolves which Status Overview file is actually active (mainly for the "AUTO" setting,
  // which picks the newest "*Status Overview*.xlsx") without downloading the whole file:
  // checks the local dev API's file listing first, then the Google Apps Script cloud endpoint.
  async resolveStatusOverviewFilenameLight() {
    const configured = this.getStatusOverviewFilename();
    if (!this.isStatusOverviewAuto()) {
      this.noteResolvedOverview(configured);
      return configured;
    }
    const isLocalDev = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.port === '5173'
    );
    if (isLocalDev) {
      for (const url of ['/pirom_pdplan/api/check-storage-status?statusFilename=AUTO', '/api/check-storage-status?statusFilename=AUTO']) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const json = await res.json();
            const name = json?.files?.statusOverview?.exists ? json.files.statusOverview.name : null;
            if (name) { this.noteResolvedOverview(name); return name; }
          }
        } catch (e) { /* try next candidate */ }
      }
    }
    const endpoint = this.getEndpointUrl();
    if (endpoint && endpoint.startsWith('http') && !endpoint.includes('drive.google.com/drive/folders')) {
      try {
        const sep = endpoint.includes('?') ? '&' : '?';
        const res = await fetch(`${endpoint}${sep}action=check-cloud-status&t=${Date.now()}`);
        if (res.ok) {
          const json = await res.json();
          const name = json?.files?.statusOverview?.exists ? json.files.statusOverview.name : null;
          if (name) { this.noteResolvedOverview(name); return name; }
        }
      } catch (e) { /* cloud endpoint unreachable, leave unresolved */ }
    }
    return null;
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
    const isEditMode = this.getUserMode() === 'plan';

    badges.forEach(badge => {
      if (this.syncStatus === 'syncing') {
        badge.className = 'sync-pill syncing';
        badge.innerHTML = `<span class="spin">⏳</span> กำลังซิงค์...`;
        badge.title = 'กำลังเชื่อมต่อและซิงค์ข้อมูลกับ Cloud Storage';
      } else if (this.syncStatus === 'error') {
        badge.className = 'sync-pill error';
        badge.innerHTML = `⚠️ ซิงค์ล้มเหลว`;
        badge.title = 'ไม่สามารถเชื่อมต่อ Cloud ได้ ระบบกำลังใช้ข้อมูลใน Temp Folder / Local Cache';
      } else if (isEditMode && this.hasUnsavedChanges) {
        badge.className = 'sync-pill local';
        badge.innerHTML = `📂 Temp Working (รอ Save)`;
        badge.title = 'กำลังทำงานใน Temp Folder (Windows/macOS) — กดปุ่ม 💾 Save ด้านบนเพื่อบันทึกขึ้น Cloud';
      } else if (hasEndpoint) {
        badge.className = 'sync-pill success';
        const timeStr = this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
        const modeStr = isEditMode ? ' (Temp Ready)' : (this.autoSync ? '' : ' (Manual)');
        badge.innerHTML = `☁️ Google Drive${modeStr} ${timeStr ? '(' + timeStr + ')' : ''}`;
        badge.title = isEditMode
          ? `โหมด EDIT: ทำงานใน Temp Folder (Windows/macOS) • กดปุ่ม Save เพื่อบันทึกขึ้น Cloud (ซิงค์ล่าสุด: ${this.lastSyncTime || 'ยังไม่มี'})`
          : `เชื่อมต่อ Google Drive เรียบร้อย (ซิงค์ล่าสุด: ${this.lastSyncTime || 'ยังไม่มี'})`;
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
    // EDIT mode refreshes after the plan payload is applied (so the update summary can diff against the loaded jobs)
    if (this.getUserMode() !== 'plan') this.fetchPlanMaterials();

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
          if (this.getUserMode() === 'plan' || !this.state.planMaterials || Object.keys(this.state.planMaterials).length === 0) {
            this.fetchPlanMaterials(this.getUserMode() === 'plan');
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
              this.fetchPlanMaterials(this.getUserMode() === 'plan');
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
        this.fetchPlanMaterials(this.getUserMode() === 'plan');
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
   * ระหว่างทำงานในโหมด EDIT จะบันทึกข้อมูลลงใน Temp Folder ของ OS (Windows: %TEMP%\pirom_pdplan / macOS: $TMPDIR/pirom_pdplan)
   * และ LocalStorage Cache เท่านั้น โดยยังไม่ส่งขึ้น Cloud จนกว่าจะกดปุ่ม Save
   */
  saveToTemp(payload, immediate = false, markDirty = true) {
    if (this.getUserMode() !== 'plan') return;
    if (this.state && this.state._isLoadingData && markDirty) return;

    // 1. บันทึกลง LocalStorage Cache ทันที
    let localBodyStr = '';
    try {
      const localCopy = { ...payload };
      delete localCopy.planMaterials;
      delete localCopy.dwgToPdMap;
      delete localCopy.pdOpStatusMap;
      delete localCopy._includeMaterials;
      localBodyStr = JSON.stringify(localCopy);
      if (localBodyStr.length < 4 * 1024 * 1024) {
        localStorage.setItem(STORAGE_CACHE_KEY, localBodyStr);
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

    if (markDirty && (!this.state || !this.state._isLoadingData)) {
      this.hasUnsavedChanges = true;
      this.updateSaveButtonUI();
      this.updateStatusBadge();
    }

    // 2. ส่งไปเก็บใน OS Temp Folder (Windows %TEMP%\pirom_pdplan / macOS $TMPDIR/pirom_pdplan) ผ่าน /api/plan?tempOnly=1
    const isLocalDev = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.port === '5173'
    );
    if (!isLocalDev) return;

    const sendTempWrite = () => {
      const bodyToWrite = localBodyStr || JSON.stringify(payload || {});
      const candidateUrls = ['/pirom_pdplan/api/plan?tempOnly=1', '/api/plan?tempOnly=1'];
      for (const tempUrl of candidateUrls) {
        try {
          fetch(tempUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyToWrite,
            keepalive: immediate && bodyToWrite.length < 60000
          }).catch(() => {});
          break;
        } catch (e) {}
      }
    };

    if (this.tempDebounceTimer) {
      clearTimeout(this.tempDebounceTimer);
      this.tempDebounceTimer = null;
    }

    if (immediate) {
      sendTempWrite();
    } else {
      this.tempDebounceTimer = setTimeout(() => {
        sendTempWrite();
      }, 350);
    }
  }

  /**
   * กดปุ่ม 💾 Save ในโหมด EDIT เพื่อนำข้อมูลที่ทำงานอยู่ใน Temp Folder บันทึกขึ้น Cloud (Google Drive)
   */
  async saveTempToCloud() {
    if (this.isSavingToCloud) return;
    if (!this.state || typeof this.state.buildPlanPayload !== 'function') return;

    this.isSavingToCloud = true;
    this.updateSaveButtonUI();

    try {
      // 1. บันทึก Work Orders (pd.md) ลงไฟล์หลัก
      if (typeof this.state.saveWorkOrdersToFile === 'function') {
        this.state.saveWorkOrdersToFile(true);
      }

      // 2. สร้าง Payload ล่าสุดและ Commit จาก Temp ขึ้น Cloud + Google Drive
      const payload = this.state.buildPlanPayload(false);
      await this.executePush(payload, false);

      this.hasUnsavedChanges = false;
      this.isSavingToCloud = false;
      this.updateSaveButtonUI();
      this.updateStatusBadge();

      // แสดงสถานะ Saved บนปุ่มชั่วคราว
      const icon = document.getElementById('edit-save-icon');
      const text = document.getElementById('edit-save-text');
      if (icon) icon.textContent = '✅';
      if (text) text.textContent = 'Saved!';
      setTimeout(() => {
        if (!this.isSavingToCloud) this.updateSaveButtonUI();
      }, 1800);

      const jobCount = (this.state.scheduledJobs || []).length;
      const wcCount = Object.keys(this.state.workCenters || {}).length;
      const completedCount = Object.keys(this.state.completedPdHistory || {}).length;
      this.showToast(`☁️ บันทึกข้อมูลจาก Temp Folder ขึ้น Cloud สำเร็จ! (Plan ${jobCount} Tasks, ${wcCount} เครื่อง, Completed ${completedCount} รายการ)`, 'success');
    } catch (err) {
      this.isSavingToCloud = false;
      this.updateSaveButtonUI();
      this.showToast(`⚠️ บันทึกขึ้น Cloud ไม่สำเร็จ: ${err.message || err}`, 'error');
    }
  }

  /**
   * ส่งข้อมูล Plan:
   * - ระหว่างทำงานปกติในโหมด EDIT (allowViewMode = false): จะบันทึกไว้ใน Temp Folder (Windows/macOS) + Local Cache เท่านั้น
   * - เมื่อกดปุ่ม Save หรือสั่ง Cloud Save โดยตรง (allowViewMode = true): จะบันทึกจาก Temp ขึ้น Cloud (Google Drive)
   */
  pushToCloud(payload, immediate = false, isClosing = false, allowViewMode = false) {
    // ถ้าอยู่ในโหมดดูแผน (view) และไม่ใช่การกดปุ่มบันทึก Cloud Save โดยตรง (allowViewMode) ให้งดการบันทึกทุกช่องทาง
    if (this.getUserMode() !== 'plan' && !allowViewMode) return;

    // ระหว่างทำงานในโหมด EDIT (ที่ยังไม่ได้กดปุ่ม Save / allowViewMode === false) ให้เก็บลง Temp Folder เท่านั้น
    if (!allowViewMode) {
      return this.saveToTemp(payload, immediate || isClosing, true);
    }

    // กรณีกดปุ่ม Save เพื่อ Commit ขึ้น Cloud
    this.saveToTemp(payload, true, false);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    return this.executePush(payload, isClosing);
  }

  async executePush(payload, isClosing = false) {
    const endpoint = this.getEndpointUrl();

    // 1. ถ้าอยู่ Localhost หรือ Dev Server ให้ส่งไปที่ local API ด้วย (พร้อม commitCloud=1 เพื่อบันทึกลง Temp + Project + Google Drive Desktop)
    const isLocalDev = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.port === '5173'
    );

    const localBodyObj = { ...payload };
    if (!localBodyObj._includeMaterials) {
      delete localBodyObj.planMaterials;
      delete localBodyObj.dwgToPdMap;
      delete localBodyObj.pdOpStatusMap;
    }
    delete localBodyObj._includeMaterials;
    const localBodyStr = JSON.stringify(localBodyObj);

    // Best Practice: Cloud (Google Drive) stores only lightweight Plan.json (~200-400KB); 14MB plan_materials_cache.json stays on Temp Local Disk + IndexedDB
    const cloudBodyObj = { ...localBodyObj };
    delete cloudBodyObj.planMaterials;
    delete cloudBodyObj.dwgToPdMap;
    delete cloudBodyObj.pdOpStatusMap;
    const cloudBodyStr = JSON.stringify(cloudBodyObj);
    const useKeepalive = isClosing && cloudBodyStr.length < 60000;

    if (isLocalDev) {
      const candidateUrls = ['/pirom_pdplan/api/plan', '/api/plan'];
      for (const localApiUrl of candidateUrls) {
        try {
          const targetUrl = isClosing ? `${localApiUrl}?commitCloud=1&forwardCloud=1` : `${localApiUrl}?commitCloud=1`;
          if (useKeepalive && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([cloudBodyStr], { type: 'application/json' });
            navigator.sendBeacon(targetUrl, blob);
          } else {
            fetch(targetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: localBodyStr,
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
      this.hasUnsavedChanges = false;
      this.updateSaveButtonUI();
      this.updateStatusBadge();
      this.updateModalValues();
      return;
    }

    if (useKeepalive && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([cloudBodyStr], { type: 'text/plain;charset=utf-8' });
        navigator.sendBeacon(endpoint, blob);
        return;
      } catch (e) {}
    }

    if (!isClosing) {
      this.syncStatus = 'syncing';
      this.updateStatusBadge();
    }

    try {
      // ส่ง POST ไปยัง Google Apps Script (เฉพาะข้อมูล Plan ที่เบา ไม่รวม plan_materials_cache.json)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain ป้องกัน preflight CORS issue ใน Google Apps Script
        body: cloudBodyStr,
        keepalive: useKeepalive
      });

      if (res.ok) {
        this.recordSyncSuccess(cloudBodyObj);
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
      throw err;
    }
  }

  recordSyncSuccess(payload) {
    this.syncStatus = 'success';
    this.hasUnsavedChanges = false;
    this.lastSyncTime = new Date().toISOString();
    localStorage.setItem(STORAGE_LAST_SYNC_KEY, this.lastSyncTime);
    this.updateSaveButtonUI();
    this.updateStatusBadge();
  }

  applyPayloadToState(data) {
    if (!data || !this.state) return;

    this.state._isLoadingData = true;
    try {
      // Backlog: on a machine with the local server, pd.md (/api/pd) stays the source of truth and the
      // payload only fills an empty backlog; on hosted pages (GitHub Pages) the payload is the only source.
      if (Array.isArray(data.workOrders) && data.workOrders.length > 0) {
        const isLocalHost = typeof window !== 'undefined' && (
          window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ||
          window.location.hostname.startsWith('192.168.') || window.location.port === '5173'
        );
        if (!isLocalHost || !this.state.workOrders || this.state.workOrders.length === 0) {
          this.state.workOrders = data.workOrders;
        }
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
      if (data.pdOpStatusMap) this.state.pdOpStatusMap = data.pdOpStatusMap;
      if (typeof this.state.cascadeCompletedPdsToChildren === 'function') {
        this.state.cascadeCompletedPdsToChildren();
      }
      if (typeof this.state.syncOverviewStatusToJobs === 'function') {
        this.state.syncOverviewStatusToJobs();
      }

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
  async savePlanMaterialsToCache(planMaterials, dwgToPdMap = {}, filename = '', pdOpStatusMap = null, materialInventory = null) {
    if (!planMaterials || Object.keys(planMaterials).length === 0) return false;
    const cachedAt = Date.now();
    const resolvedOpStatusMap = pdOpStatusMap || this.state?.pdOpStatusMap || {};
    const resolvedInventory = materialInventory || this.state?.materialInventory || {};
    this._materialsCache = {
      planMaterials,
      dwgToPdMap: dwgToPdMap || {},
      pdOpStatusMap: resolvedOpStatusMap,
      materialInventory: resolvedInventory,
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
          pdOpStatusMap: resolvedOpStatusMap,
          materialInventory: resolvedInventory,
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
    if (
      this._materialsCache &&
      this._materialsCache.planMaterials &&
      Object.keys(this._materialsCache.planMaterials).length > 0 &&
      this._materialsCache.pdOpStatusMap &&
      Object.keys(this._materialsCache.pdOpStatusMap).length > 0
    ) {
      return this._materialsCache;
    }

    try {
      const db = await this.openCacheDB();
      return new Promise((resolve) => {
        const tx = db.transaction('ExcelStore', 'readonly');
        const store = tx.objectStore('ExcelStore');
        const req = store.get('planMaterialsCache');
        tx.oncomplete = () => {
          if (
            req.result &&
            req.result.planMaterials &&
            Object.keys(req.result.planMaterials).length > 0 &&
            req.result.pdOpStatusMap &&
            Object.keys(req.result.pdOpStatusMap).length > 0
          ) {
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
    const noUpload = typeof options === 'object' ? Boolean(options.noUpload) : false;
    const filename = this.getStatusOverviewFilename();

    // 1. ถ้าไม่สั่ง force ให้ดึงจาก Local Cache ทันที (โหมด AUTO ต้องเช็คไฟล์ใหม่สุดจาก server เสมอ)
    if (!force && !this.isStatusOverviewAuto()) {
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
            this.noteResolvedOverview(fn);
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
              this.noteResolvedOverview(fetchedResult.filename);
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
        if (fetchedResult.source !== 'cloud' && !noUpload) {
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
  // Connection check for the "Setting Location" modal: asks the local server (/api/check-storage-status)
  // about every data file / folder and paints the status pills. scope: all | drive | dwg | overview | endpoint
  async runStorageConnectionCheck(scope = 'all') {
    const $ = (id) => document.getElementById(id);
    const setPill = (el, status, text, title = '') => {
      if (!el) return;
      el.textContent = text;
      el.title = title;
      const tone = {
        ok: ['rgba(16, 185, 129, 0.14)', '#059669', 'rgba(16, 185, 129, 0.35)'],
        warn: ['rgba(245, 158, 11, 0.15)', '#d97706', 'rgba(245, 158, 11, 0.35)'],
        err: ['rgba(239, 68, 68, 0.14)', '#dc2626', 'rgba(239, 68, 68, 0.35)'],
        info: ['rgba(2, 132, 199, 0.12)', '#0284c7', 'rgba(2, 132, 199, 0.3)']
      }[status] || ['rgba(0,0,0,0.05)', 'var(--text-secondary)', 'transparent'];
      el.style.background = tone[0];
      el.style.color = tone[1];
      el.style.border = `1px solid ${tone[2]}`;
      el.style.fontWeight = '700';
    };
    const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };
    const filePill = (el, info, label) => {
      if (!info || !info.exists) { setPill(el, 'err', '❌ ไม่พบไฟล์', `${label}: ไม่พบไฟล์ในโฟลเดอร์ Drive หรือในเครื่อง`); return false; }
      const where = info.inGoogleDrive ? 'Drive' : (info.inTempLocalDisk ? 'Temp' : 'เครื่อง');
      setPill(el, 'ok', `✅ ${where} · ${info.sizeMB >= 1 ? info.sizeMB + ' MB' : info.sizeKB + ' KB'} · ${fmtDate(info.updatedAt)}`, info.path || info.name);
      return true;
    };

    const btnAll = $('btn-check-all-storage');
    const origHtml = btnAll ? btnAll.innerHTML : '';
    if (scope === 'all' && btnAll) {
      btnAll.disabled = true;
      btnAll.innerHTML = '<span>⏳</span><span>กำลังตรวจสอบ...</span>';
    }
    const pills = ['conn-status-plan', 'conn-status-machine', 'conn-status-completed', 'conn-status-overview', 'conn-status-dwg'].map($);
    if (scope === 'all') pills.forEach(el => setPill(el, 'info', '⏳ กำลังตรวจสอบ...'));

    const driveUrl = ($('input-drive-folder-url')?.value || '').trim();
    const dwgVal = ($('input-dwg-folder-url')?.value || '').trim() || this.getDwgFolderUrl();
    const statusFn = ($('input-status-overview-filename')?.value || '').trim() || 'AUTO';
    const endpointUrl = ($('input-sync-endpoint')?.value || '').trim() || this.getEndpointUrl();
    const isLocalDwg = this.isDwgLocationLocal(dwgVal);

    let report = null;
    try {
      const params = new URLSearchParams({
        statusFilename: statusFn,
        dwgDir: isLocalDwg ? dwgVal : '',
        driveUrl,
        dwgUrl: isLocalDwg ? '' : dwgVal,
        endpointUrl
      });
      for (const api of ['/pirom_pdplan/api/check-storage-status', '/api/check-storage-status']) {
        try {
          const res = await fetch(`${api}?${params.toString()}`, { cache: 'no-store' });
          if (res.ok) { report = await res.json(); break; }
        } catch (e) { /* try next */ }
      }
    } catch (e) { /* handled below */ }

    // No local server (e.g. the GitHub Pages site): ask the Google Apps Script Cloud API instead
    if (!report && endpointUrl.startsWith('http') && !endpointUrl.includes('drive.google.com/drive/folders')) {
      try {
        const sep = endpointUrl.includes('?') ? '&' : '?';
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        const res = await fetch(`${endpointUrl}${sep}action=check-cloud-status&statusFilename=${encodeURIComponent(statusFn)}&dwgFolderId=${encodeURIComponent(isLocalDwg ? DEFAULT_DWG_FOLDER_ID : (dwgVal.match(/folders\/([a-zA-Z0-9_-]+)/)?.[1] || (/^[a-zA-Z0-9_-]{20,}$/.test(dwgVal) ? dwgVal : DEFAULT_DWG_FOLDER_ID)))}&t=${Date.now()}`, { signal: ctrl.signal });
        clearTimeout(timer);
        const cj = res.ok ? await res.json() : null;
        if (cj && cj.status === 'success') {
          const withDrive = (info) => (info && info.exists) ? { ...info, inGoogleDrive: true } : { exists: false };
          const cf = cj.files || {};
          const dwgF = cj.dwgFolder || {};
          report = {
            fromCloud: true,
            gdriveDesktop: { mounted: false },
            cloudApi: { configured: true, ok: true, message: `Cloud API ตอบกลับ (โฟลเดอร์ ${cj.folderName || ''})` },
            files: {
              planJson: withDrive(cf.planJson),
              machineSettings: withDrive(cf.machineSettings),
              completedPds: withDrive(cf.completedPds),
              statusOverview: withDrive(cf.statusOverview)
            },
            dwgStorage: { exists: Boolean(dwgF.exists), inGoogleDrive: true, pdfCount: null, subfolders: dwgF.subfolders || [], activePath: dwgF.folderName || '' }
          };
        }
      } catch (e) { /* cloud unreachable too */ }
    }

    if (scope === 'all' && btnAll) { btnAll.disabled = false; btnAll.innerHTML = origHtml; }

    if (!report) {
      pills.forEach(el => setPill(el, 'err', '❌ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
      setPill($('badge-drive-conn-status'), 'err', '❌ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      this.showToast('⚠️ ตรวจสอบไม่ได้: ไม่พบเซิร์ฟเวอร์ในเครื่องและเชื่อมต่อ Cloud API ไม่ได้ (ตรวจสอบ Web App Sync API URL)', 'error');
      return null;
    }

    const f = report.files || {};
    const results = {
      plan: filePill($('conn-status-plan'), f.planJson, 'Plan.json'),
      machine: filePill($('conn-status-machine'), f.machineSettings, 'machine_settings.json'),
      completed: filePill($('conn-status-completed'), f.completedPds, 'completed_pds.json'),
      overview: filePill($('conn-status-overview'), f.statusOverview, 'Status Overview')
    };
    const dwg = report.dwgStorage || {};
    results.dwg = Boolean(dwg.exists);
    if (dwg.exists) setPill($('conn-status-dwg'), 'ok', `✅ ${dwg.inGoogleDrive ? 'Drive' : 'เครื่อง'} · ${dwg.pdfCount != null ? dwg.pdfCount + ' PDF' : (dwg.subfolders || []).length + ' โฟลเดอร์ย่อย'}`, dwg.activePath || '');
    else setPill($('conn-status-dwg'), 'warn', '⚠️ ไม่พบโฟลเดอร์ DWG', 'ตั้งค่าโฟลเดอร์ DWG ให้ถูกต้อง');

    const mounted = report.gdriveDesktop && report.gdriveDesktop.mounted;
    const cloud = report.cloudApi || {};
    setPill($('badge-drive-conn-status'), mounted ? 'ok' : (cloud.ok ? 'ok' : 'warn'),
      mounted ? '✅ Drive G: เชื่อมต่อแล้ว' : (cloud.ok ? '✅ เชื่อมต่อผ่าน Cloud API' : '⚠️ ไม่พบ Drive G: (ใช้ไฟล์ในเครื่อง)'),
      report.gdriveDesktop?.path || '');
    const epBadge = $('badge-endpoint-conn-status');
    if (epBadge) {
      if (!cloud.configured) setPill(epBadge, 'warn', '⚠️ ยังไม่ได้ตั้งค่า', cloud.message || '');
      else setPill(epBadge, cloud.ok ? 'ok' : 'err', cloud.ok ? '✅ เชื่อมต่อ Cloud API ได้' : '❌ เชื่อมต่อ Cloud API ไม่ได้', cloud.message || '');
    }
    if (f.statusOverview?.exists) this.noteResolvedOverview(f.statusOverview.name);

    const okCount = Object.values(results).filter(Boolean).length;
    const total = Object.keys(results).length;
    const box = $('storage-connection-summary-box');
    if (box && scope === 'all') {
      box.style.display = 'block';
      box.textContent = (report.fromCloud ? '☁️ ตรวจผ่าน Cloud API (ไม่มีเซิร์ฟเวอร์ในเครื่อง) · ' : '') + (okCount === total
        ? `✅ ตรวจสอบเรียบร้อย: พบข้อมูลครบทั้ง ${total} รายการ`
        : `⚠️ พบข้อมูล ${okCount} จาก ${total} รายการ — ตรวจสอบรายการที่ขึ้น ❌/⚠️`);
    }
    if (scope !== 'all') {
      this.showToast(mounted || cloud.ok ? '✅ ตรวจสอบการเชื่อมต่อเรียบร้อย' : '⚠️ ตรวจสอบแล้ว: ดูสถานะที่ป้ายด้านข้าง', mounted || cloud.ok ? 'success' : 'info');
    }
    return report;
  }

  // Planned production date per "PD|Material" from the shared Google Sheet (via the local dev server).
  // Returns true when the data changed.
  // Browser-side fallback used when the local server API is unavailable (e.g. GitHub Pages):
  // reads each known tab through Google's gviz CSV endpoint (CORS-enabled for link-shared sheets).
  async fetchProductionDatesFromBrowser(sheetUrl) {
    const idMatch = String(sheetUrl || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(sheetUrl || '').match(/^([a-zA-Z0-9_-]{20,})$/);
    if (!idMatch) return null;
    const sheetId = idMatch[1];
    const parseCsv = (text) => {
      const rows = [];
      let row = [], field = '', inQ = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
          if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
          else if (c === '"') inQ = false;
          else field += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
      }
      if (field !== '' || row.length) { row.push(field); rows.push(row); }
      return rows;
    };
    const dates = {};
    const usedTabs = [];
    await Promise.all(PROD_DATES_FALLBACK_GIDS.map(async (gid) => {
      try {
        const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);
        if (!res.ok) return;
        const rows = parseCsv(await res.text());
        const header = (rows[0] || []).map(h => String(h || '').trim());
        const iPd = header.indexOf('Production Order');
        let iMat = header.indexOf('Item');
        if (iMat < 0) iMat = header.indexOf('Material No.');
        const iDate = header.findIndex(h => h.replace(/\s+/g, '') === 'วันที่ที่จะผลิต');
        if (iPd < 0 || iMat < 0 || iDate < 0) return;
        let n = 0;
        rows.slice(1).forEach(r => {
          const pd = String(r[iPd] || '').trim();
          const mat = String(r[iMat] || '').trim();
          const m = String(r[iDate] || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!pd || !mat || !m) return;
          const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
          const key = `${pd}|${mat}`;
          if (!dates[key] || iso < dates[key]) dates[key] = iso;
          n++;
        });
        usedTabs.push({ name: String(gid), rows: n });
      } catch (e) { /* skip tab */ }
    }));
    if (Object.keys(dates).length === 0) return null;
    return { status: 'success', sheetId, count: Object.keys(dates).length, tabs: usedTabs, dates };
  }

  async fetchProductionDates(force = false, sheetUrlOverride = null) {
    if (typeof window === 'undefined') return false;
    const sheetUrl = (sheetUrlOverride || this.getProdDatesSheetUrl()).trim();
    let json = null;
    try {
      const params = new URLSearchParams();
      params.set('sheetUrl', sheetUrl);
      if (force) params.set('force', '1');
      const res = await fetch(`/pirom_pdplan/api/production-dates?${params.toString()}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.status === 'success' && body.dates) json = body;
      else if (body && body.status === 'error') this._lastProdDatesResult = body; // e.g. invalid link: no fallback
      if (!json && body && body.status === 'error' && res.status === 400) return false;
    } catch (e) { /* no local server: fall back to the browser */ }
    if (!json) {
      try { json = await this.fetchProductionDatesFromBrowser(sheetUrl); } catch (e) { json = null; }
    }
    if (!json) {
      if (!this._lastProdDatesResult || this._lastProdDatesResult.status === 'success') {
        this._lastProdDatesResult = { status: 'error', message: 'เชื่อมต่อ Google Sheet ไม่ได้' };
      }
      return false;
    }
    this._lastProdDatesResult = json;
    const changed = JSON.stringify(this.state.productionDates || {}) !== JSON.stringify(json.dates);
    this.state.productionDates = json.dates;
    if (changed) window.dispatchEvent(new CustomEvent('plan-materials-updated'));
    return changed;
  }

  async syncProductionDates() {
    const changed = await this.fetchProductionDates(true);
    try { await this.syncAllocationDates(false); } catch (e) { /* inventory refresh is best-effort */ }
    return changed;
  }

  // Detects a new / newer Status Overview file (local server or, on hosted pages, the Cloud API) and
  // reloads Plan + Mat from it automatically, so Mat. readiness never keeps showing stale cached data.
  async checkStatusOverviewUpdate() {
    if (typeof window === 'undefined' || this._soChecking) return;
    this._soChecking = true;
    const KEY = 'chaken_status_overview_stamp';
    try {
      const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ||
        window.location.hostname.startsWith('192.168.') || window.location.port === '5173';
      const statusFn = this.getStatusOverviewFilename() || 'AUTO';
      let info = null;
      if (isLocalDev) {
        try {
          const res = await fetch(`/pirom_pdplan/api/check-storage-status?statusFilename=${encodeURIComponent(statusFn)}`, { cache: 'no-store' });
          if (res.ok) info = (await res.json())?.files?.statusOverview || null;
        } catch (e) { /* server not reachable */ }
      }
      const endpoint = this.getEndpointUrl();
      if (!info && endpoint && endpoint.startsWith('http') && !endpoint.includes('drive.google.com/drive/folders')) {
        try {
          const sep = endpoint.includes('?') ? '&' : '?';
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 25000);
          const res = await fetch(`${endpoint}${sep}action=check-cloud-status&statusFilename=${encodeURIComponent(statusFn)}&t=${Date.now()}`, { signal: ctrl.signal });
          clearTimeout(timer);
          const cj = res.ok ? await res.json() : null;
          if (cj && cj.status === 'success') info = cj.files?.statusOverview || null;
        } catch (e) { /* cloud not reachable */ }
      }
      if (!info || !info.exists || !info.updatedAt) return;
      const stamp = `${info.name}|${info.updatedAt}`;
      const seen = localStorage.getItem(KEY);
      if (seen === stamp) return;
      await this.fetchPlanMaterials(true);
      localStorage.setItem(KEY, stamp);
      if (seen) this.showToast(`🔄 พบไฟล์ ${info.name} ใหม่ อัปเดตข้อมูล Mat. เรียบร้อย`, 'success');
    } catch (e) {
      console.warn('Status Overview auto-refresh failed:', e);
    } finally {
      this._soChecking = false;
    }
  }

  // Local-dev only: polls the server for the mtime of "Material to issue.xlsx"; when a newer file
  // shows up, Allocation Date / Inventory on Hand are re-read from it automatically.
  startMaterialToIssueWatcher(intervalMs = 60000) {
    if (typeof window === 'undefined' || this._mtiWatcher) return;
    // Planned production dates (Google Sheet): initial load, then refresh every 2 minutes (works on any host)
    if (!this._prodDatesTimer) {
      setTimeout(() => this.fetchProductionDates(), 2500);
      this._prodDatesTimer = setInterval(() => this.fetchProductionDates(), 120000);
    }
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') || window.location.port === '5173';
    // Status Overview freshness: every minute against the local server, every 5 minutes against the Cloud API
    if (!this._soTimer) {
      setTimeout(() => this.checkStatusOverviewUpdate(), 6000);
      this._soTimer = setInterval(() => this.checkStatusOverviewUpdate(), isLocalDev ? 60000 : 300000);
    }
    if (!isLocalDev) return;
    const KEY = 'chaken_mat_to_issue_mtime';
    const check = async () => {
      if (this._mtiChecking) return;
      this._mtiChecking = true;
      try {
        const res = await fetch('/pirom_pdplan/api/check-storage-status?statusFilename=AUTO');
        if (!res.ok) return;
        const info = (await res.json())?.files?.materialToIssue;
        if (!info || !info.exists || !info.updatedAt) return;
        const seen = localStorage.getItem(KEY);
        if (seen === info.updatedAt) return;
        if (!this.state.planMaterials || Object.keys(this.state.planMaterials).length === 0) return; // loaded later with fresh data anyway
        const count = await this.syncAllocationDates(false);
        if (count !== null) {
          localStorage.setItem(KEY, info.updatedAt);
          if (seen) this.showToast('🔄 พบไฟล์ Material to issue.xlsx ใหม่ อัปเดต Allocation Date เรียบร้อย', 'success');
          window.dispatchEvent(new CustomEvent('plan-materials-updated'));
        }
      } catch (e) { /* server unreachable, retry next tick */ }
      finally { this._mtiChecking = false; }
    };
    setTimeout(check, 8000);
    this._mtiWatcher = setInterval(check, intervalMs);

  }

  // Re-reads Allocation Date (+ Inventory on Hand) from "Material to issue.xlsx" via the server-side
  // sync script and merges only those fields into the already-loaded Plan + Mat data.
  // Returns the number of Plan+Mat rows that now carry an Allocation Date (or null if unavailable).
  async syncAllocationDates(force = true) {
    const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/pirom_pdplan/';
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const filename = this.getStatusOverviewFilename();
    const urls = [
      `${cleanBase}/api/plan-materials?filename=${encodeURIComponent(filename)}${force ? '&force=1' : ''}`,
      `${cleanBase}/plan_materials_cache.json`
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (!res.ok) continue;
        const json = await res.json();
        const fresh = json && (json.planMaterials || (json.data && json.data.planMaterials));
        if (!fresh) continue;
        const freshInv = json.materialInventory || (json.data && json.data.materialInventory);
        if (!this.state.planMaterials || Object.keys(this.state.planMaterials).length === 0) {
          this.state.planMaterials = fresh;
        } else {
          Object.entries(this.state.planMaterials).forEach(([pdId, rows]) => {
            if (!Array.isArray(rows)) return;
            const freshRows = Array.isArray(fresh[pdId]) ? fresh[pdId] : [];
            rows.forEach(r => {
              const f = freshRows.find(x => Number(x.stepNum) === Number(r.stepNum) && x.mat === r.mat);
              if (f && f.allocationDate) r.allocationDate = f.allocationDate;
              else delete r.allocationDate;
            });
          });
        }
        if (freshInv) this.state.materialInventory = freshInv;
        await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, filename, this.state.pdOpStatusMap, this.state.materialInventory);
        return Object.values(this.state.planMaterials).flat().filter(r => r && r.allocationDate).length;
      } catch (e) {
        // try next source
      }
    }
    return null;
  }

  async fetchPlanMaterials(force = false) {
    if (
      !force &&
      this.state.planMaterials &&
      Object.keys(this.state.planMaterials).length > 0 &&
      this.state.pdOpStatusMap &&
      Object.keys(this.state.pdOpStatusMap).length > 0
    ) {
      return this.state.planMaterials;
    }
    if (this._fetchPlanMaterialsPromise && (!force || this._fetchPlanMaterialsIsForce)) {
      return this._fetchPlanMaterialsPromise;
    }

    this._fetchPlanMaterialsIsForce = force;
    this._fetchPlanMaterialsPromise = (async () => {
      const filename = this.getStatusOverviewFilename();

      // 0. Forced refresh: parse the selected/newest Status Overview directly (only the Plan + Mat sheet)
      if (force) {
        try {
          const overview = await this.fetchStatusOverview({ force: true, silent: true, noUpload: true });
          if (overview && overview.arrayBuffer && typeof XLSX !== 'undefined' &&
              this.state.workflowController && typeof this.state.workflowController.parseAndStoreMaterials === 'function') {
            const bytes = new Uint8Array(overview.arrayBuffer);
            const isMatSheet = (name) => {
              const n = (name || '').trim().toLowerCase();
              return n === 'plan + mat' || n === 'plan+mat' || (n.includes('plan') && n.includes('mat'));
            };
            const matSheetName = XLSX.read(bytes, { type: 'array', bookSheets: true }).SheetNames.find(isMatSheet);
            if (matSheetName) {
              const workbook = XLSX.read(bytes, { type: 'array', sheets: matSheetName });
              const matRaw2D = XLSX.utils.sheet_to_json(workbook.Sheets[matSheetName], { header: 1, defval: '' });
              let cachedBefore = null;
              if (!this.state.planMaterials || Object.keys(this.state.planMaterials).length === 0) {
                try { cachedBefore = await this.getPlanMaterialsFromCache(); } catch (e) {}
              }
              const before = this.snapshotOverviewState(cachedBefore);
              this.state.workflowController.parseAndStoreMaterials(matRaw2D);
              this.updateAssemblyTreeAfterMaterials();
              await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, overview.filename || filename, this.state.pdOpStatusMap, this.state.materialInventory);
              this.reportOverviewUpdate(before, overview.filename || filename);
              return this.state.planMaterials;
            }
          }
        } catch (err) {
          console.warn('Direct parse of Status Overview failed, using cache:', err);
        }
      }

      // 1. ตรวจสอบจาก Local Cache ใน IndexedDB ก่อนเสมอ (เร็วระดับ ms ไม่ต้อง parse 17MB)
      if (!force) {
        const cachedMaterials = await this.getPlanMaterialsFromCache();
        if (cachedMaterials && cachedMaterials.planMaterials && Object.keys(cachedMaterials.planMaterials).length > 0) {
          this.state.planMaterials = cachedMaterials.planMaterials;
          if (cachedMaterials.dwgToPdMap) this.state.dwgToPdMap = cachedMaterials.dwgToPdMap;
          if (cachedMaterials.pdOpStatusMap) this.state.pdOpStatusMap = cachedMaterials.pdOpStatusMap;
          if (cachedMaterials.materialInventory) this.state.materialInventory = cachedMaterials.materialInventory;
          this.updateAssemblyTreeAfterMaterials();
          if (cachedMaterials.filename && cachedMaterials.filename.toUpperCase() !== 'AUTO') this.noteResolvedOverview(cachedMaterials.filename);
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
              if (json.pdOpStatusMap) this.state.pdOpStatusMap = json.pdOpStatusMap;
              if (json.materialInventory) this.state.materialInventory = json.materialInventory;
              this.updateAssemblyTreeAfterMaterials();
              // บันทึกลง Local Cache (IndexedDB) ทันที — ไม่ส่งไฟล์ 14MB ขึ้น Cloud เพื่อประสิทธิภาพสูงสุด
              await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, filename, this.state.pdOpStatusMap, this.state.materialInventory);
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
              if (json.data.pdOpStatusMap) this.state.pdOpStatusMap = json.data.pdOpStatusMap;
              if (json.data.materialInventory) this.state.materialInventory = json.data.materialInventory;
              this.updateAssemblyTreeAfterMaterials();
              // บันทึก Local Cache ทันที
              await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, filename, this.state.pdOpStatusMap, this.state.materialInventory);
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
            // บันทึกแคช Local (IndexedDB + Temp Local Disk) ทันที
            await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, filename, this.state.pdOpStatusMap);
            if (this.getUserMode() === 'plan') {
              this.pushToCloud(this.state.buildPlanPayload(false), true);
            }
            this.showToast(`💾 บันทึก Plan + Mat (${Object.keys(this.state.planMaterials).length} รายการ) ลง Local Cache เรียบร้อย`, 'success');
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
      // Backlog cards / open popups re-read Mat. status from the freshly loaded data
      if (res && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('plan-materials-updated'));
      return res;
    } finally {
      this._fetchPlanMaterialsPromise = null;
    }
  }

  snapshotOverviewState(cached = null) {
    const jobStatus = new Map();
    for (const job of this.state.scheduledJobs || []) jobStatus.set(job, String(job.opStatus || ''));
    const erpDone = new Set((this.state.scheduledJobs || []).filter(j => j.erpCompleted));
    const mats = new Map();
    const inMemory = this.state.planMaterials && Object.keys(this.state.planMaterials).length > 0;
    const baseMaterials = inMemory ? this.state.planMaterials : (cached && cached.planMaterials) || {};
    const baseline = inMemory ? { source: 'memory' } : (cached ? { source: 'cache', cachedAt: cached.cachedAt, filename: cached.filename } : null);
    for (const [pdId, list] of Object.entries(baseMaterials)) {
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        mats.set(`${pdId}|${m.stepNum}|${m.mat}`, {
          actualQty: m.actualQty, toIssue: m.toIssue, operStatus: m.operStatus || '', orderStatus: m.orderStatus || ''
        });
      }
    }
    return { jobStatus, mats, baseline, erpDone };
  }

  buildOverviewUpdateSummary(before, filename) {
    const planPds = new Set();
    const opChanges = [];
    for (const [job, oldStatus] of before.jobStatus) {
      const pdId = job.woId || job.id;
      planPds.add(pdId);
      const newStatus = String(job.opStatus || '');
      if (newStatus !== oldStatus) {
        opChanges.push({ pdId, step: job.stepNum, wc: job.machine, from: oldStatus || '-', to: newStatus || '-' });
      }
    }
    let barsHidden = 0;
    let barsRestored = 0;
    for (const job of before.jobStatus.keys()) {
      if (job.erpCompleted && !before.erpDone.has(job)) barsHidden++;
      else if (!job.erpCompleted && before.erpDone.has(job)) barsRestored++;
    }
    const transitions = {};
    for (const c of opChanges) {
      const key = `${c.from} → ${c.to}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
    const changedPds = new Set(opChanges.map(c => c.pdId));
    const inFile = (pdId) => (this.state.pdOpStatusMap && this.state.pdOpStatusMap[pdId]) || (this.state.planMaterials && this.state.planMaterials[pdId]);
    const missingPds = [...planPds].filter(pdId => !inFile(pdId));

    const newMats = new Map();
    for (const [pdId, list] of Object.entries(this.state.planMaterials || {})) {
      if (!Array.isArray(list)) continue;
      for (const m of list) newMats.set(`${pdId}|${m.stepNum}|${m.mat}`, m);
    }
    const hadBaseline = before.mats.size > 0;
    const matChanges = [];
    let matAdded = 0;
    let matRemoved = 0;
    let matIssued = 0;
    let matWaiting = 0;
    if (hadBaseline) {
      for (const [key, m] of newMats) {
        const old = before.mats.get(key);
        if (!old) { matAdded++; continue; }
        if (old.actualQty !== m.actualQty || old.toIssue !== m.toIssue || old.orderStatus !== (m.orderStatus || '')) {
          const [pdId, step, mat] = key.split('|');
          matChanges.push({ pdId, step, mat, old, now: m });
          if ((old.toIssue || 0) > 0 && (m.toIssue || 0) === 0) matIssued++;
          else if ((old.toIssue || 0) === 0 && (m.toIssue || 0) > 0) matWaiting++;
        }
      }
      for (const key of before.mats.keys()) if (!newMats.has(key)) matRemoved++;
    }
    return {
      filename,
      time: new Date(),
      pdInPlan: planPds.size,
      jobCount: before.jobStatus.size,
      opChanges,
      barsHidden,
      barsRestored,
      transitions,
      changedPds: changedPds.size,
      missingPds,
      matPdCount: Object.keys(this.state.planMaterials || {}).length,
      matRowCount: newMats.size,
      hadBaseline,
      matChanges,
      matAdded,
      matRemoved,
      matIssued,
      matWaiting,
      baseline: before.baseline
    };
  }

  reportOverviewUpdate(before, filename) {
    let summary;
    try {
      summary = this.buildOverviewUpdateSummary(before, filename);
    } catch (err) {
      console.warn('Failed to build Status Overview update summary:', err);
      this.showToast(`🔄 อัปเดตข้อมูล Production Order จากไฟล์ ${filename || ''} แล้ว`, 'info');
      return;
    }
    this.lastOverviewUpdateSummary = summary;
    const hasChange = summary.opChanges.length > 0 || summary.barsHidden > 0 || summary.barsRestored > 0 || summary.matChanges.length > 0 || summary.matAdded > 0 || summary.matRemoved > 0;
    if (!hasChange) {
      this.showToast(`🔄 อัปเดตจาก ${filename}: ไม่มี Operation/Mat ที่เปลี่ยนแปลง (${summary.pdInPlan} PD ในแผน)`, 'info');
      return;
    }
    this.showOverviewUpdateSummary(summary);
  }

  showOverviewUpdateSummary(summary) {
    document.getElementById('overview-update-summary-modal')?.remove();
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const MAX_ROWS = 60;
    const transitionRows = Object.entries(summary.transitions)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>${esc(k)}</span><strong>${n}</strong></div>`)
      .join('') || '<div style="color:#64748b;">ไม่มี</div>';
    const opRows = summary.opChanges.slice(0, MAX_ROWS)
      .map(c => `<tr><td>${esc(c.pdId)}</td><td>${esc(c.step)}</td><td>${esc(c.wc)}</td><td>${esc(c.from)}</td><td>${esc(c.to)}</td></tr>`)
      .join('');
    const opMore = summary.opChanges.length > MAX_ROWS ? `<div style="color:#64748b;margin-top:4px;">… และอีก ${summary.opChanges.length - MAX_ROWS} รายการ</div>` : '';
    const fmtNum = (v) => (typeof v === 'number' ? Number(v.toFixed(2)) : v);
    const cell = (a, b) => (a === b ? esc(fmtNum(b)) : `${esc(fmtNum(a))} → <strong>${esc(fmtNum(b))}</strong>`);
    const matRows = summary.matChanges.slice(0, MAX_ROWS)
      .map(c => `<tr><td>${esc(c.pdId)}</td><td>${esc(c.step)}</td><td>${esc(c.mat)}</td><td>${cell(c.old.actualQty, c.now.actualQty)}</td><td>${cell(c.old.toIssue, c.now.toIssue)}</td><td>${cell(c.old.orderStatus || '-', c.now.orderStatus || '-')}</td></tr>`)
      .join('');
    const matMore = summary.matChanges.length > MAX_ROWS ? `<div style="color:#64748b;margin-top:4px;">… และอีก ${summary.matChanges.length - MAX_ROWS} รายการ</div>` : '';
    const missing = summary.missingPds.length
      ? `<div style="margin-top:10px;"><strong>PD ในแผนที่ไม่พบในไฟล์ใหม่ (${summary.missingPds.length}):</strong> <span style="color:#64748b;">${esc(summary.missingPds.slice(0, 20).join(', '))}${summary.missingPds.length > 20 ? ' …' : ''}</span></div>`
      : '';
    const baselineNote = summary.baseline && summary.baseline.source === 'cache'
      ? `เทียบกับข้อมูล Mat. ที่บันทึกไว้เมื่อ ${esc(summary.baseline.cachedAt ? new Date(summary.baseline.cachedAt).toLocaleString('th-TH') : '-')} (ไฟล์ ${esc(summary.baseline.filename || '-')})`
      : 'เทียบกับข้อมูล Mat. ก่อนหน้าในหน่วยความจำ';
    const matBlock = summary.hadBaseline
      ? `<div style="margin-top:12px;"><strong>Mat. เปลี่ยนแปลง:</strong> ${summary.matChanges.length} รายการ · เพิ่มใหม่ ${summary.matAdded} · หายไป ${summary.matRemoved}</div>
         <div style="color:#64748b;font-size:11.5px;">${baselineNote}</div>
         ${(summary.matIssued || summary.matWaiting) ? `<div style="margin:6px 0;padding:6px 8px;background:#f8fafc;border-radius:6px;">
           <div style="display:flex;justify-content:space-between;"><span>รอเบิก → จ่ายครบแล้ว (To Issue เป็น 0)</span><strong>${summary.matIssued}</strong></div>
           <div style="display:flex;justify-content:space-between;"><span>จ่ายครบแล้ว → รอเบิกอีกครั้ง</span><strong>${summary.matWaiting}</strong></div></div>` : ''}
         ${matRows ? `<div style="overflow:auto;max-height:220px;margin-top:4px;"><table class="ovs-table"><thead><tr><th>PD</th><th>Op</th><th>Mat.</th><th>Actual Qty</th><th>To Issue</th><th>Order Status</th></tr></thead><tbody>${matRows}</tbody></table></div>${matMore}` : '<div style="margin-top:4px;color:#64748b;">ไม่มี Mat. ที่ Actual Qty / To Issue / Order Status เปลี่ยน</div>'}`
      : `<div style="margin-top:12px;color:#64748b;">Mat.: โหลดข้อมูลใหม่ ${summary.matRowCount} รายการ ใน ${summary.matPdCount} PD (ยังไม่มีข้อมูล Mat. เดิมที่บันทึกไว้ให้เทียบ — ครั้งถัดไปจะเทียบให้)</div>`;

    const overlay = document.createElement('div');
    overlay.id = 'overview-update-summary-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <style>
        #overview-update-summary-modal .ovs-table{width:100%;border-collapse:collapse;font-size:11.5px;}
        #overview-update-summary-modal .ovs-table th,#overview-update-summary-modal .ovs-table td{border-bottom:1px solid rgba(0,0,0,0.08);padding:3px 6px;text-align:left;white-space:nowrap;}
        #overview-update-summary-modal .ovs-table th{position:sticky;top:0;background:#f1f5f9;}
      </style>
      <div style="background:#fff;color:#0f172a;border-radius:10px;max-width:720px;width:100%;max-height:88vh;overflow:auto;padding:16px 18px;box-shadow:0 20px 50px rgba(0,0,0,0.3);font-size:12.5px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="font-size:15px;font-weight:700;">🔄 สรุปผลการอัปเดตจาก Status Overview</div>
          <button type="button" id="btn-close-overview-summary" style="border:none;background:transparent;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="color:#64748b;margin:2px 0 10px;font-family:monospace;">${esc(summary.filename)} · ${esc(summary.time.toLocaleString('th-TH'))}</div>
        <div><strong>Operation ที่เปลี่ยน status:</strong> ${summary.opChanges.length} จาก ${summary.jobCount} งานในแผน · ${summary.changedPds} PD (จาก ${summary.pdInPlan} PD ในแผน)</div>
        <div style="margin:6px 0;padding:6px 8px;background:#f8fafc;border-radius:6px;">${transitionRows}</div>
        ${(summary.barsHidden || summary.barsRestored) ? `<div style="margin:6px 0;">🫥 Task bar บน board: <strong>ซ่อน ${summary.barsHidden}</strong> step ที่ ERP แจ้งว่าเสร็จแล้ว${summary.barsRestored ? ` · <strong>แสดงกลับ ${summary.barsRestored}</strong> step` : ''}</div>` : ''}
        ${opRows ? `<div style="overflow:auto;max-height:220px;"><table class="ovs-table"><thead><tr><th>PD</th><th>Op</th><th>WC</th><th>เดิม</th><th>ใหม่</th></tr></thead><tbody>${opRows}</tbody></table></div>${opMore}` : ''}
        ${matBlock}
        ${missing}
        <div style="text-align:right;margin-top:12px;"><button type="button" id="btn-ok-overview-summary" style="padding:6px 16px;border:none;border-radius:6px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer;">ปิด</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#btn-close-overview-summary').addEventListener('click', close);
    overlay.querySelector('#btn-ok-overview-summary').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  updateAssemblyTreeAfterMaterials() {
    if (
      (!this.state.pdOpStatusMap || Object.keys(this.state.pdOpStatusMap).length === 0) &&
      ((this.state.dwgToPdMap && Object.keys(this.state.dwgToPdMap).length > 0) ||
       (this.state.planMaterials && Object.keys(this.state.planMaterials).length > 0))
    ) {
      const map = this.state.pdOpStatusMap || {};
      if (this.state.dwgToPdMap) {
        for (const info of Object.values(this.state.dwgToPdMap)) {
          if (!info || !info.pdId || !Array.isArray(info.operations)) continue;
          const entry = map[info.pdId] || (map[info.pdId] = {});
          for (const op of info.operations) {
            const st = String(op.status || '').trim();
            if (!st) continue;
            if (op.stepNum) entry[String(op.stepNum)] = st;
            if (op.machine) {
              const prev = entry[op.machine];
              if (!prev || prev.toLowerCase() === 'completed') entry[op.machine] = st;
            }
          }
        }
      }
      if (this.state.planMaterials) {
        for (const [pdId, mats] of Object.entries(this.state.planMaterials)) {
          if (!Array.isArray(mats)) continue;
          const entry = map[pdId] || (map[pdId] = {});
          for (const m of mats) {
            const st = String(m.operStatus || '').trim();
            if (!st) continue;
            const sKey = String(m.stepNum || 10);
            if (!entry[sKey]) entry[sKey] = st;
            if (m.wc && !entry[m.wc]) entry[m.wc] = st;
          }
        }
      }
      this.state.pdOpStatusMap = map;
    }
    if (typeof this.state.cascadeCompletedPdsToChildren === 'function') {
      this.state.cascadeCompletedPdsToChildren();
    }
    if (typeof this.state.syncOverviewStatusToJobs === 'function') {
      this.state.syncOverviewStatusToJobs();
    }
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

    // Connection-check buttons in the Setting Location modal
    [
      ['btn-check-all-storage', 'all'],
      ['btn-test-drive-folder', 'drive'],
      ['btn-test-dwg-folder', 'dwg'],
      ['btn-test-status-overview', 'overview'],
      ['btn-test-sync-endpoint', 'endpoint']
    ].forEach(([id, scope]) => {
      document.getElementById(id)?.addEventListener('click', () => this.runStorageConnectionCheck(scope));
    });

    const setProdDatesBadge = (text, ok) => {
      const badge = document.getElementById('badge-prod-dates-sheet');
      if (!badge) return;
      badge.textContent = text;
      badge.style.color = ok ? '#059669' : '#dc2626';
      badge.style.background = ok ? 'rgba(16, 185, 129, 0.15)' : 'rgba(220, 38, 38, 0.12)';
    };
    const testProdDatesSheet = async (url) => {
      setProdDatesBadge('⏳ กำลังเช็ค...', true);
      await this.fetchProductionDates(true, url);
      const r = this._lastProdDatesResult;
      if (r && r.status === 'success') {
        setProdDatesBadge(`✅ ${r.count} รายการ จาก ${r.tabs.length} Tab`, true);
        return true;
      }
      setProdDatesBadge(`❌ ${(r && r.message) || 'เชื่อมต่อไม่ได้'}`, false);
      return false;
    };
    document.getElementById('btn-test-prod-dates-sheet')?.addEventListener('click', () => {
      const val = document.getElementById('input-prod-dates-sheet-url')?.value.trim() || this.getProdDatesSheetUrl();
      testProdDatesSheet(val);
    });
    document.getElementById('btn-save-prod-dates-sheet')?.addEventListener('click', async () => {
      const input = document.getElementById('input-prod-dates-sheet-url');
      const val = (input?.value || '').trim() || DEFAULT_PROD_DATES_SHEET_URL;
      const ok = await testProdDatesSheet(val);
      if (!ok) {
        this.showToast('⚠️ ยังไม่บันทึก: อ่านข้อมูลจากลิงก์นี้ไม่ได้ (ตรวจสอบลิงก์และสิทธิ์การเข้าถึง)', 'error');
        return;
      }
      this.setProdDatesSheetUrl(val);
      this.showToast('💾 บันทึกลิงก์ไฟล์ ตรวจสอบรายการแมทและ STD ที่ใช้ผลิต เรียบร้อย', 'success');
    });
    document.getElementById('btn-reset-prod-dates-sheet')?.addEventListener('click', async () => {
      this.setProdDatesSheetUrl(DEFAULT_PROD_DATES_SHEET_URL);
      const input = document.getElementById('input-prod-dates-sheet-url');
      if (input) input.value = DEFAULT_PROD_DATES_SHEET_URL;
      await testProdDatesSheet(DEFAULT_PROD_DATES_SHEET_URL);
      this.showToast('↺ รีเซ็ตเป็นลิงก์เริ่มต้น', 'info');
    });
    document.getElementById('btn-open-prod-dates-sheet')?.addEventListener('click', () => {
      const val = document.getElementById('input-prod-dates-sheet-url')?.value.trim() || this.getProdDatesSheetUrl();
      window.open(val, '_blank', 'noopener');
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
      this.showToast('↺ รีเซ็ตเป็น AUTO (ใช้ไฟล์ใหม่สุดในโฟลเดอร์)', 'info');
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
        let parsedChosenFile = false;
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
              this.updateAssemblyTreeAfterMaterials();
              parsedChosenFile = true;
              await this.savePlanMaterialsToCache(this.state.planMaterials, this.state.dwgToPdMap, file.name, this.state.pdOpStatusMap);
            }
          } catch (err) {
            console.warn('Error parsing chosen status overview file:', err);
          }
        }
        // Do not re-fetch from server/cache after a successful local parse: stale data would overwrite the chosen file
        if (!parsedChosenFile) this.fetchPlanMaterials(true);

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
          delete localCopy.pdOpStatusMap;
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
    const inputProdSheet = document.getElementById('input-prod-dates-sheet-url');
    if (inputProdSheet) inputProdSheet.value = this.getProdDatesSheetUrl();
    const badgeStatusFile = document.getElementById('badge-status-overview-file');
    if (badgeStatusFile) {
      badgeStatusFile.textContent = this.isStatusOverviewAuto() && this.resolvedOverviewName
        ? `AUTO → ${this.resolvedOverviewName}`
        : currentStatusFile;
    }

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
    delete parsed.planMaterials;
    delete parsed.dwgToPdMap;
    delete parsed.pdOpStatusMap;

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
