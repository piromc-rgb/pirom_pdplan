import './style.css';
import { state } from './state.js';
import { Scheduler, getPriorityWeight } from './scheduler.js';
import { WorkflowController } from './workflow.js';
import { 
  GanttController, 
  isJobPriorityVisible, 
  isJobProjectVisible, 
  isJobCustomerVisible, 
  isJobPdRangeVisible 
} from './gantt.js';
import { ResourcesController } from './resources.js';
import { KioskController } from './kiosk.js';
import { DailyScheduleController } from './dailySchedule.js';
import { AssemblyTreeController, matchesAssemblyQuery } from './assemblyTree.js';
import { ContinuityAnalysisController } from './continuityAnalysis.js';
import { QcCheckController } from './qcCheck.js';
import { StorageSyncManager } from './storageSync.js';

function getBaseDate() {
  return new Date(2026, 5, 22, 8, 0, 0); // Fixed epoch: Mon June 22 2026 8:00
}

function getStartOfDayBase() {
  const bd = getBaseDate();
  return new Date(bd.getFullYear(), bd.getMonth(), bd.getDate(), 0, 0, 0);
}

function workingHourToDate(workingHour) {
  const baseDate = getBaseDate();
  const weeks = Math.floor(workingHour / 48);
  const remInWeek = workingHour - (weeks * 48); // Always non-negative (48h/week = 6 days * 8h)
  const days = Math.floor(remInWeek / 8);
  const hours = remInWeek - (days * 8);
  const calendarDays = weeks * 7 + days;
  
  // Shift: 8:00-12:00 (0-4h), Break: 12:00-13:00 (skip +1h), Afternoon: 13:00-17:00 (4-8h), OT: >17:00 (>8h)
  const clockHour = hours < 4.0 ? (8.0 + hours) : (9.0 + hours);
  const timeMs = baseDate.getTime() + calendarDays * 24 * 60 * 60 * 1000 + (clockHour - 8.0) * 60 * 60 * 1000;
  return new Date(timeMs);
}

function dateToWorkingHour(date) {
  const baseDate = getBaseDate();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDayBase = getStartOfDayBase();
  const startOfDayDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const diffDays = Math.floor((startOfDayDate - startOfDayBase) / dayMs);
  const weeks = Math.floor(diffDays / 7);
  const dayOfWeek = diffDays - (weeks * 7); // Always 0 to 6
  
  let workingDays = weeks * 6;
  if (dayOfWeek < 6) {
    workingDays += dayOfWeek;
  } else {
    workingDays += 5;
  }
  
  const hour = date.getHours() + date.getMinutes() / 60;
  let workHoursInDay = 0.0;
  if (dayOfWeek < 6) {
    if (hour < 8.0) {
      workHoursInDay = 0.0;
    } else if (hour < 12.0) {
      workHoursInDay = hour - 8.0;
    } else if (hour < 13.0) {
      workHoursInDay = 4.0; // Lunch break 12:00-13:00
    } else {
      workHoursInDay = hour - 9.0; // 13:00-17:00 and OT after 17:00
    }
  } else {
    workHoursInDay = 0.0;
  }
  return workingDays * 8.0 + workHoursInDay;
}

function formatWorkingHour(workingHour, scale = 'hr') {
  const d = workingHourToDate(workingHour);
  const hours = d.getHours();
  const mins = d.getMinutes();
  const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  
  if (scale === 'hr') {
    return timeStr;
  } else {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayName = days[d.getDay() === 0 ? 6 : d.getDay() - 1];
    
    if (scale === 'day') {
      return `${dayName} ${timeStr}`;
    } else {
      const baseDate = getBaseDate();
      const dayDiff = Math.floor((d - baseDate) / (24 * 60 * 60 * 1000));
      return `Day ${dayDiff + 1} ${timeStr}`;
    }
  }
}

class App {
  constructor() {
    this.initControllers();
    this.initGlobalEvents();
    this.renderKPIs();
    this.initHeaderDateTime();
    this.initWorkCenterSettings();
    this.initCompletedPdList();
    this.initGanttLabelColumnResize();
    this.initSidebarLeftResize();

    // Default Gantt view: Time Scale Fit (start day left-aligned)
    if (state.scheduledJobs && state.scheduledJobs.length > 0) {
      this.gantt.fitTasks(state.scheduledJobs);
    }
    
    // Initial Render
    this.renderAll();
  }

  initHeaderDateTime() {
    const headerDateTime = document.getElementById('header-datetime');
    if (headerDateTime) {
      const versionStr = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.2';
      const updateDateTime = () => {
        const now = new Date();
        const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        headerDateTime.textContent = now.toLocaleDateString('en-GB', options).replace(/,/g, '') + ` | V${versionStr}`;
        if (this.gantt) {
          this.gantt.drawDependencyLines();
        }
      };
      updateDateTime();
      setInterval(updateDateTime, 10000);

      // Keep updating header clock text every 1 second
      setInterval(() => {
        const now = new Date();
        const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        headerDateTime.textContent = now.toLocaleDateString('en-GB', options).replace(/,/g, '') + ` | V${versionStr}`;
      }, 1000);
    }
  }

  initControllers() {
    this.workflow = new WorkflowController(state);
    this.gantt = new GanttController(state);
    this.resources = new ResourcesController(state);
    this.kiosk = new KioskController(state);
    this.dailySchedule = new DailyScheduleController(state);
    this.assemblyTree = new AssemblyTreeController(state, this.gantt);
    state.assemblyTree = this.assemblyTree;
    window.assemblyTree = this.assemblyTree;
    this.continuityAnalysis = new ContinuityAnalysisController(state);
    this.qcCheck = new QcCheckController(state);
    this.storageSync = new StorageSyncManager(state);
    state.storageSync = this.storageSync;
    window.storageSyncManager = this.storageSync;
    this.storageSync.pullFromCloud(true);
    
    // Subscribe controllers to state changes
    state.subscribe(() => this.renderAll());
  }

  initWorkCenterSettings() {
    this.wcSettingsModal = document.getElementById('workcenter-settings-modal');
    this.btnOpenWcSettings = document.getElementById('btn-workcenter-settings');
    this.btnSidebarSetupWc = document.getElementById('btn-sidebar-setup-wc');
    this.btnCloseWcSettings = document.getElementById('btn-close-workcenter-settings');
    this.btnCancelWcSettings = document.getElementById('btn-cancel-workcenter-settings');
    this.btnSaveWcSettings = document.getElementById('btn-save-workcenter-settings');
    this.btnLoadWcConfigFile = document.getElementById('btn-load-workcenter-config-file');
    this.btnSaveWcConfigFile = document.getElementById('btn-save-workcenter-config-file');
    this.inputLoadWcConfigFile = document.getElementById('input-load-wc-config-file');
    this.wcConfigFilenameLabel = document.getElementById('wc-config-filename-label');
    this.btnAddWc = document.getElementById('btn-add-workcenter');
    this.wcSettingsList = document.getElementById('workcenter-settings-list');

    const WC_CONFIG_FILENAME_KEY = 'chaken_wc_config_filename';
    this.updateWcConfigFilenameLabel = (name) => {
      if (!this.wcConfigFilenameLabel) return;
      this.wcConfigFilenameLabel.textContent = name ? `Config: ${name}` : 'Config: (ค่าเริ่มต้นของระบบ)';
    };
    this.updateWcConfigFilenameLabel(localStorage.getItem(WC_CONFIG_FILENAME_KEY));

    const openSettings = () => {
      this.renderWcSettingsList(state.workCenters, state.workCenterOrder);
      this.wcSettingsModal.classList.remove('hidden');
    };

    if (this.btnOpenWcSettings) {
      this.btnOpenWcSettings.addEventListener('click', openSettings);
    }

    if (this.btnSidebarSetupWc) {
      this.btnSidebarSetupWc.addEventListener('click', openSettings);
    }

    if (this.btnCloseWcSettings) {
      this.btnCloseWcSettings.addEventListener('click', () => {
        this.wcSettingsModal.classList.add('hidden');
      });
    }

    if (this.btnCancelWcSettings) {
      this.btnCancelWcSettings.addEventListener('click', () => {
        this.wcSettingsModal.classList.add('hidden');
      });
    }

    // Reads and validates the editable table into { workCenters, workCenterOrder } -
    // shared by "Save Settings" (apply to the live plan) and "Save File" (export to disk).
    this.readWcSettingsFromTable = () => {
      const rows = this.wcSettingsList.querySelectorAll('tr');
      const newWorkCenters = {};
      const newOrder = [];
      let hasInvalid = false;

      rows.forEach(row => {
        const idInput = row.querySelector('.wc-id-input');
        const nameInput = row.querySelector('.wc-name-input');
        const capacityInput = row.querySelector('.wc-capacity-input');
        const workHoursInput = row.querySelector('.wc-workhours-input');
        const altInput = row.querySelector('.wc-alt-input');
        const transferInput = row.querySelector('.wc-transfer-input');
        const leadTimeInput = row.querySelector('.wc-leadtime-input');
        const colorSelect = row.querySelector('.wc-color-select');

        if (idInput && nameInput) {
          const id = idInput.value.trim();
          const name = nameInput.value.trim();
          const capacity = parseInt(capacityInput.value) || 1;
          const workHoursPerDay = workHoursInput ? (parseFloat(workHoursInput.value) || 8) : 8;
          const altMachines = altInput ? altInput.value.trim() : '';
          const transferMinutes = transferInput ? (parseFloat(transferInput.value) >= 0 ? parseFloat(transferInput.value) : 10) : 10;
          const leadTimeDays = leadTimeInput ? (parseFloat(leadTimeInput.value) || 0) : 0;
          const color = colorSelect.value;

          if (!id) {
            hasInvalid = true;
            return;
          }

          newWorkCenters[id] = {
            capacity,
            workHoursPerDay,
            color,
            name: name || id,
            altMachines,
            transferMinutes,
            leadTimeDays
          };
          newOrder.push(id);
        }
      });

      if (hasInvalid) {
        alert('กรุณากรอกรหัสเครื่องจักรให้ครบถ้วน');
        return null;
      }

      if (newOrder.length === 0) {
        alert('กรุณาเพิ่มเครื่องจักรอย่างน้อย 1 รายการ');
        return null;
      }

      return { workCenters: newWorkCenters, workCenterOrder: newOrder };
    };

    if (this.btnSaveWcSettings) {
      this.btnSaveWcSettings.addEventListener('click', () => {
        const result = this.readWcSettingsFromTable();
        if (!result) return;
        state.updateWorkCenters(result.workCenters, result.workCenterOrder);
        this.wcSettingsModal.classList.add('hidden');
        state.ganttController?.showToast('💾 บันทึกค่า Work Center Settings และซิงค์ขึ้น Cloud สำเร็จ', 'success');
      });
    }

    if (this.btnSaveWcConfigFile) {
      this.btnSaveWcConfigFile.addEventListener('click', () => {
        const result = this.readWcSettingsFromTable();
        if (!result) return;

        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const defaultName = `machine-settings-${stamp}.json`;
        const fileName = (prompt('ตั้งชื่อไฟล์ config:', defaultName) || '').trim() || defaultName;
        const finalName = fileName.toLowerCase().endsWith('.json') ? fileName : `${fileName}.json`;

        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        localStorage.setItem(WC_CONFIG_FILENAME_KEY, finalName);
        this.updateWcConfigFilenameLabel(finalName);
        state.ganttController?.showToast(`💾 บันทึกไฟล์ config: ${finalName}`);
      });
    }

    if (this.btnLoadWcConfigFile && this.inputLoadWcConfigFile) {
      this.btnLoadWcConfigFile.addEventListener('click', () => {
        this.inputLoadWcConfigFile.value = '';
        this.inputLoadWcConfigFile.click();
      });

      this.inputLoadWcConfigFile.addEventListener('change', () => {
        const file = this.inputLoadWcConfigFile.files && this.inputLoadWcConfigFile.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          let parsed;
          try {
            parsed = JSON.parse(reader.result);
          } catch (err) {
            alert('ไฟล์ config ไม่ถูกต้อง (ไม่ใช่ JSON ที่ถูกต้อง)');
            return;
          }

          if (!parsed || typeof parsed.workCenters !== 'object' || !Array.isArray(parsed.workCenterOrder)) {
            alert('ไฟล์ config ไม่ถูกต้อง (ต้องมี workCenters และ workCenterOrder)');
            return;
          }

          this.renderWcSettingsList(parsed.workCenters, parsed.workCenterOrder);
          localStorage.setItem(WC_CONFIG_FILENAME_KEY, file.name);
          this.updateWcConfigFilenameLabel(file.name);
          state.ganttController?.showToast(`📂 โหลดไฟล์ config: ${file.name} (กด Save Settings เพื่อนำไปใช้)`);
        };
        reader.readAsText(file);
      });
    }

    if (this.btnAddWc) {
      this.btnAddWc.addEventListener('click', () => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--border-glass)';

        const colors = [
          { value: 'var(--accent-teal)', label: 'Teal (Sky)' },
          { value: 'var(--accent-green)', label: 'Green' },
          { value: 'var(--accent-orange)', label: 'Orange' },
          { value: 'var(--accent-purple)', label: 'Purple' },
          { value: 'var(--accent-magenta)', label: 'Pink' },
          { value: 'var(--accent-cyan)', label: 'Cyan' },
          { value: 'var(--accent-red)', label: 'Red' }
        ];

        const optionsHtml = colors.map(c => `<option value="${c.value}">${c.label}</option>`).join('');

        row.innerHTML = `
          <td style="padding: 8px;">
            <input type="text" class="wc-id-input" value="" placeholder="e.g. DEA024" style="width: 90%; background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; font-weight: bold;">
          </td>
          <td style="padding: 8px;">
            <input type="text" class="wc-name-input" value="" placeholder="e.g. CNC VF4" style="width: 95%; background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px;">
          </td>
          <td style="padding: 8px; text-align: center;">
            <input type="number" class="wc-capacity-input" value="1" min="1" title="จำนวนเครื่องจักร" style="width: 45px; background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; text-align: center;">
          </td>
          <td style="padding: 8px; text-align: center;">
            <input type="number" class="wc-workhours-input" value="8" min="1" max="24" step="0.5" placeholder="8" title="ชั่วโมงการทำงานต่อวัน (ชม.)" style="width: 48px; background: var(--bg-darkest); color: var(--accent-yellow); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; text-align: center;">
          </td>
          <td style="padding: 8px; text-align: center;">
            <input type="text" class="wc-alt-input" value="" placeholder="e.g. DEA023" title="รหัสเครื่องจักรสำรอง/ช่วยงาน (คั่นด้วยจุลภาค)" style="width: 90%; background: var(--bg-darkest); color: var(--accent-teal); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px;">
          </td>
          <td style="padding: 8px; text-align: center;">
            <input type="number" class="wc-transfer-input" value="10" min="0" step="1" placeholder="10" title="เวลาในการย้ายงาน (นาที)" style="width: 50px; background: var(--bg-darkest); color: var(--accent-orange); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; text-align: center;">
          </td>
          <td style="padding: 8px; text-align: center;">
            <input type="number" class="wc-leadtime-input" value="0" min="0" step="0.5" placeholder="0" title="Lead Time เผื่อเวลาก่อนส่งต่อ (วัน)" style="width: 50px; background: var(--bg-darkest); color: var(--accent-cyan); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; text-align: center;">
          </td>
          <td style="padding: 8px; text-align: center;">
            <select class="wc-color-select" style="background: var(--bg-darkest); color: #000000; font-weight: 600; border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px;">
              ${optionsHtml}
            </select>
          </td>
          <td style="padding: 8px; text-align: center;">
            <button type="button" class="btn-remove-wc" style="background: none; border: none; color: var(--accent-red); font-size: 16px; cursor: pointer; font-weight: bold;">&times;</button>
          </td>
        `;

        row.querySelector('.btn-remove-wc').addEventListener('click', () => {
          row.remove();
        });

        this.wcSettingsList.prepend(row);
        const modalBody = this.wcSettingsModal?.querySelector('.modal-body');
        if (modalBody) {
          modalBody.scrollTop = 0;
        }
        row.querySelector('.wc-id-input')?.focus();
      });
    }

  }

  renderWcSettingsList(workCenters, order) {
    this.wcSettingsList.innerHTML = '';

    order.forEach(machine => {
      const wc = workCenters[machine] || { capacity: 1, workHoursPerDay: 8, color: 'var(--accent-teal)', name: machine, altMachines: '', transferMinutes: 10, leadTimeDays: 0 };
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid var(--border-glass)';

      const colors = [
        { value: 'var(--accent-teal)', label: 'Teal (Sky)' },
        { value: 'var(--accent-green)', label: 'Green' },
        { value: 'var(--accent-orange)', label: 'Orange' },
        { value: 'var(--accent-purple)', label: 'Purple' },
        { value: 'var(--accent-magenta)', label: 'Pink' },
        { value: 'var(--accent-cyan)', label: 'Cyan' },
        { value: 'var(--accent-red)', label: 'Red' }
      ];

      const optionsHtml = colors.map(c => `<option value="${c.value}" ${c.value === wc.color ? 'selected' : ''}>${c.label}</option>`).join('');

      row.innerHTML = `
        <td style="padding: 8px;">
          <input type="text" class="wc-id-input" value="${machine}" placeholder="e.g. DEA012" style="width: 90%; background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; font-weight: bold;">
        </td>
        <td style="padding: 8px;">
          <input type="text" class="wc-name-input" value="${wc.name || ''}" placeholder="e.g. CNC Laser" style="width: 95%; background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px;">
        </td>
        <td style="padding: 8px; text-align: center;">
          <input type="number" class="wc-capacity-input" value="${wc.capacity || 1}" min="1" title="จำนวนเครื่องจักร" style="width: 45px; background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; text-align: center;">
        </td>
        <td style="padding: 8px; text-align: center;">
          <input type="number" class="wc-workhours-input" value="${wc.workHoursPerDay !== undefined ? wc.workHoursPerDay : 8}" min="1" max="24" step="0.5" placeholder="8" title="ชั่วโมงการทำงานต่อวัน (ชม.)" style="width: 48px; background: var(--bg-darkest); color: var(--accent-yellow); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; text-align: center;">
        </td>
        <td style="padding: 8px; text-align: center;">
          <input type="text" class="wc-alt-input" value="${wc.altMachines || ''}" placeholder="e.g. DEA023" title="รหัสเครื่องจักรสำรอง/ช่วยงาน (คั่นด้วยจุลภาค)" style="width: 90%; background: var(--bg-darkest); color: var(--accent-teal); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px;">
        </td>
        <td style="padding: 8px; text-align: center;">
          <input type="number" class="wc-transfer-input" value="${wc.transferMinutes !== undefined ? wc.transferMinutes : 10}" min="0" step="1" placeholder="10" title="เวลาในการย้ายงาน (นาที)" style="width: 50px; background: var(--bg-darkest); color: var(--accent-orange); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; text-align: center;">
        </td>
        <td style="padding: 8px; text-align: center;">
          <input type="number" class="wc-leadtime-input" value="${wc.leadTimeDays !== undefined ? wc.leadTimeDays : 0}" min="0" step="0.5" placeholder="0" title="Lead Time เผื่อเวลาก่อนส่งต่อ (วัน)" style="width: 50px; background: var(--bg-darkest); color: var(--accent-cyan); border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px; text-align: center;">
        </td>
        <td style="padding: 8px; text-align: center;">
          <select class="wc-color-select" style="background: var(--bg-darkest); color: #000000; font-weight: 600; border: 1px solid var(--border-glass); padding: 5px; border-radius: 4px; font-size: 11px;">
            ${optionsHtml}
          </select>
        </td>
        <td style="padding: 8px; text-align: center;">
          <button type="button" class="btn-remove-wc" style="background: none; border: none; color: var(--accent-red); font-size: 16px; cursor: pointer; font-weight: bold;">&times;</button>
        </td>
      `;

      row.querySelector('.btn-remove-wc').addEventListener('click', () => {
        row.remove();
      });

      this.wcSettingsList.appendChild(row);
    });
  }

  initGanttLabelColumnResize() {
    const resizer = document.getElementById('gantt-label-col-resizer');
    if (!resizer) return;

    const STORAGE_KEY = 'chaken_gantt_label_col_width';
    const MIN_WIDTH = 90;
    const MAX_WIDTH = 400;

    const applyWidth = (px) => {
      document.documentElement.style.setProperty('--gantt-label-col-width', `${px}px`);
    };

    const savedWidth = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (savedWidth && savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) {
      applyWidth(savedWidth);
    }

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e) => {
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (e.clientX - startX)));
      applyWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const finalWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gantt-label-col-width'), 10);
      if (finalWidth) localStorage.setItem(STORAGE_KEY, finalWidth);
    };

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      const headerEl = document.getElementById('row-label-header');
      startWidth = headerEl ? headerEl.getBoundingClientRect().width : 140;
      resizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  initSidebarLeftResize() {
    const resizer = document.getElementById('sidebar-left-resizer');
    const sidebarEl = document.querySelector('.sidebar-left');
    if (!resizer || !sidebarEl) return;

    const STORAGE_KEY = 'chaken_sidebar_left_width';
    const MIN_WIDTH = 220;

    const getMaxWidth = () => Math.min(850, Math.floor(window.innerWidth * 0.65));

    const applyWidth = (px) => {
      document.documentElement.style.setProperty('--sidebar-left-width', `${px}px`);
    };

    const savedWidth = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (savedWidth && savedWidth >= MIN_WIDTH && savedWidth <= getMaxWidth()) {
      applyWidth(savedWidth);
    }

    let startX = 0;
    let startWidth = 0;
    let rafId = null;

    const onMouseMove = (e) => {
      const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
      const maxWidth = getMaxWidth();
      const newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + (clientX - startX)));
      applyWidth(newWidth);

      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          this.gantt?.drawDependencyLines?.();
          rafId = null;
        });
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onMouseMove);
      document.removeEventListener('touchend', onMouseUp);
      resizer.classList.remove('resizing');
      document.body.classList.remove('sidebar-left-resizing');

      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      this.gantt?.drawDependencyLines?.();
      window.dispatchEvent(new Event('resize'));

      const finalWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-left-width'), 10);
      if (finalWidth) {
        localStorage.setItem(STORAGE_KEY, finalWidth);
      }
    };

    const onStartDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
      startWidth = sidebarEl.getBoundingClientRect().width;
      resizer.classList.add('resizing');
      document.body.classList.add('sidebar-left-resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchmove', onMouseMove, { passive: false });
      document.addEventListener('touchend', onMouseUp);
    };

    resizer.addEventListener('mousedown', onStartDrag);
    resizer.addEventListener('touchstart', onStartDrag, { passive: false });

    // Double-click resets to default width (280px)
    resizer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyWidth(280);
      localStorage.setItem(STORAGE_KEY, 280);
      this.gantt?.drawDependencyLines?.();
      window.dispatchEvent(new Event('resize'));
    });
  }

  initCompletedPdList() {
    const modal = document.getElementById('completed-pd-list-modal');
    const btnOpen = document.getElementById('btn-view-completed-pd');
    const btnClose = document.getElementById('btn-close-completed-pd-list');
    const btnCloseFooter = document.getElementById('btn-close-completed-pd-list-footer');
    const listBody = document.getElementById('completed-pd-list-body');
    const emptyMsg = document.getElementById('completed-pd-list-empty-msg');
    const countEl = document.getElementById('completed-pd-list-count');
    if (!modal || !btnOpen || !listBody) return;

    const renderList = () => {
      const ids = Object.keys(state.completedPdHistory || {}).sort();
      listBody.innerHTML = '';
      emptyMsg.classList.toggle('hidden', ids.length > 0);
      if (countEl) countEl.textContent = ids.length;

      ids.forEach(pdId => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(22, 163, 74, 0.06); border: 1px solid var(--border-glass); border-left: 3px solid var(--accent-green, #16a34a); border-radius: 6px;';
        row.innerHTML = `
          <strong style="font-size: 12px; color: var(--text-primary);">${pdId}</strong>
          <button type="button" class="btn-unmark-completed-pd" data-pd-id="${pdId}" title="ยกเลิกสถานะผลิตเสร็จแล้ว - PD นี้จะกลับมารับการวางแผนได้อีกครั้ง (ต้อง Import กลับเข้า backlog เอง)" style="font-size: 9.5px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--accent-red); background: rgba(239, 68, 68, 0.08); color: var(--accent-red); cursor: pointer; font-weight: bold;">↩️ ยกเลิกสถานะ</button>
        `;
        listBody.appendChild(row);
      });

      listBody.querySelectorAll('.btn-unmark-completed-pd').forEach(btn => {
        btn.addEventListener('click', () => {
          const pdId = btn.getAttribute('data-pd-id');
          if (confirm(`ยกเลิกสถานะ "ผลิตเสร็จแล้ว" ของ ${pdId} ใช่หรือไม่?`)) {
            state.markPdCompletedHistory(pdId, false);
            renderList();
          }
        });
      });
    };

    btnOpen.addEventListener('click', () => {
      renderList();
      modal.classList.remove('hidden');
    });

    const close = () => modal.classList.add('hidden');
    if (btnClose) btnClose.addEventListener('click', close);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', close);
  }

  initGlobalEvents() {
    // 1. Scheduling Model Selector
    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
      modelSelect.addEventListener('change', (e) => {
        const selectedModel = e.target.value;
        state.schedulingModel = selectedModel;
        const spinTok = typeof window.showIosSpinner === 'function' ? window.showIosSpinner(420) : null;
        setTimeout(() => {
          try {
            state.recomputeSchedule();
          } finally {
            if (typeof window.hideIosSpinner === 'function') window.hideIosSpinner(spinTok);
          }
        }, 25);
      });
    }

    // 2. AI Optimize (APS) Button
    const btnAIOptimize = document.getElementById('btn-ai-optimize');
    if (btnAIOptimize) {
      btnAIOptimize.addEventListener('click', () => {
        this.showBacklogSelectionModal(btnAIOptimize);
      });
    }

    // 2a. Reschedule Button - re-run the scheduling pass over the whole board
    // (e.g. after editing Priority, Work Center settings, or Lock/Unlock
    // Project) without needing to change the time scale to trigger it.
    const btnReschedule = document.getElementById('btn-reschedule');
    if (btnReschedule) {
      btnReschedule.addEventListener('click', () => {
        if (!confirm('คำนวณแผนงานทั้งหมดใหม่ตาม Scheduling Model ปัจจุบันใช่หรือไม่?\n(ตำแหน่งงานที่ยังไม่ Completed ทั้งกระดานอาจเปลี่ยนแปลง)')) {
          return;
        }

        const origHtml = btnReschedule.innerHTML;
        const spinTok = typeof window.showIosSpinner === 'function' ? window.showIosSpinner(450) : null;
        btnReschedule.disabled = true;
        btnReschedule.style.opacity = '0.75';
        btnReschedule.style.pointerEvents = 'none';
        btnReschedule.innerHTML = `
          <span class="spin" style="margin-right: 4px; display: inline-block;">⏳</span>
          กำลังคำนวณ...
        `;

        setTimeout(() => {
          try {
            state.recomputeSchedule();
            if (this.gantt && typeof this.gantt.showToast === 'function') {
              this.gantt.showToast('✓ คำนวณแผนงานทั้งหมดใหม่เรียบร้อยแล้ว');
            }
          } catch (err) {
            console.error('Error during reschedule:', err);
            alert('เกิดข้อผิดพลาดในการคำนวณแผนงาน: ' + (err.message || err));
          } finally {
            btnReschedule.disabled = false;
            btnReschedule.style.opacity = '';
            btnReschedule.style.pointerEvents = '';
            btnReschedule.innerHTML = origHtml;
            if (typeof window.hideIosSpinner === 'function') window.hideIosSpinner(spinTok);
          }
        }, 50);
      });
    }

    // 2b. Show Late PDs Button
    const btnShowLatePDs = document.getElementById('btn-show-late-pds');
    if (btnShowLatePDs) {
      btnShowLatePDs.addEventListener('click', () => {
        this.showLateWOsListModal();
      });
    }
    // 2c. Gantt View Mode Selector
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const selectedMode = e.currentTarget.getAttribute('data-mode');
        state.setGanttMode(selectedMode);
      });
    });

    // 2d. Production Order List Button (Visible in PD mode)
    const btnPdOrderList = document.getElementById('btn-pd-order-list');
    if (btnPdOrderList) {
      btnPdOrderList.addEventListener('click', () => {
        this.showProductionOrderListModal();
      });
    }
    // 3. Time Scale Selector (Trading Chart Zoom)
    const scaleButtons = document.querySelectorAll('.scale-btn');
    scaleButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const selectedScale = e.currentTarget.getAttribute('data-scale');
        state.setActiveScale(selectedScale);
      });
    });

    const btnTimelineFit = document.getElementById('btn-timeline-fit');
    if (btnTimelineFit) {
      btnTimelineFit.addEventListener('click', () => {
        if (state.scheduledJobs && state.scheduledJobs.length > 0) {
          this.gantt.fitTasks(state.scheduledJobs);
        } else {
          alert('ไม่มีงานในบอร์ดเพื่อทำการปรับอัตโนมัติ / No scheduled jobs to fit.');
        }
      });
    }

    // 4. Backlog/Assembly (left sidebar) vs Resources (right sidebar) toggles.
    // Backlog and Assembly share the same left-panel space, so picking one puts
    // away the other (radio-button style). Resources lives in the separate right
    // sidebar and toggles independently - it can be open or closed at the same
    // time as either Backlog or Assembly.
    const btnTabBacklog = document.getElementById('btn-toggle-backlog-header');
    const btnTabAssembly = document.getElementById('btn-toggle-assembly-list-header');
    const btnTabResources = document.getElementById('btn-toggle-resources-header');
    const backlogTabContent = document.getElementById('backlog-tab-content');
    const assemblyListTabContent = document.getElementById('assembly-list-tab-content');
    const backlogHeaderTitle = document.getElementById('backlog-header-title');
    const assemblySearchInput = document.getElementById('assembly-list-search-input');
    const assemblySetListEl = document.getElementById('assembly-set-list');

    const renderAssemblySetList = (query) => {
      if (!assemblySetListEl || !this.assemblyTree) return;
      const all = this.assemblyTree.getAllAssemblies();
      const matches = all.filter(a => matchesAssemblyQuery(a.id, a.partName, query, a.dwgNo));

      if (matches.length === 0) {
        assemblySetListEl.innerHTML = '<div style="padding: 20px 10px; text-align: center; font-size: 11px; color: var(--text-secondary);">ไม่พบ Assembly Set ที่ตรงกับคำค้นหา</div>';
        return;
      }

      const maxDisplay = 60;
      const displayMatches = matches.slice(0, maxDisplay);

      let itemsHtml = displayMatches.map(a => {
        // "X/Y" = how many of this assembly's sub-PDs have actually started work
        // (Running/Setup/Paused/Completed) out of all its sub-PDs - PDs still just
        // waiting in the backlog or scheduled-but-not-started don't count towards X.
        const { progressed, total } = this.assemblyTree.getSubPdProgress(a.id);
        let progressColor = 'var(--text-secondary)';
        if (total > 0 && progressed === total) progressColor = 'var(--accent-green)';
        else if (progressed > 0) progressColor = 'var(--accent-orange)';
        const progressBadge = total > 0
          ? `<span style="font-size: 10px; font-weight: 800; color: ${progressColor}; flex-shrink: 0; margin-left: 6px;" title="PD ย่อยที่เริ่มงานแล้ว (Running/Setup/Paused/Completed) / PD ย่อยทั้งหมด">${progressed}/${total}</span>`
          : '';
        return `
        <div class="assembly-set-list-item" data-wo-id="${a.id}" style="padding: 8px 10px; margin-bottom: 6px; border: 1px solid var(--border-glass); border-radius: 6px; background: rgba(255,255,255,0.03); cursor: pointer; transition: background 0.2s;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 5px; overflow: hidden;">
              <div style="font-weight: bold; font-size: 11.5px; color: var(--accent-teal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${a.id}</div>
              ${a.dwgNo ? `<span style="font-size: 9.5px; color: var(--text-secondary); font-family: monospace; white-space: nowrap;">(${a.dwgNo})</span>` : ''}
            </div>
            ${progressBadge}
          </div>
          <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${a.partName}">${a.partName}</div>
        </div>
      `;
      }).join('');

      if (matches.length > maxDisplay) {
        itemsHtml += `
          <div style="padding: 10px 8px; text-align: center; font-size: 10.5px; color: var(--text-secondary); background: rgba(255,255,255,0.02); border-radius: 6px; margin-top: 4px; border: 1px dashed var(--border-glass);">
            + แสดง 60 จากทั้งหมด ${matches.length.toLocaleString()} รายการ<br><span style="font-size: 9.5px; opacity: 0.8;">(พิมพ์ในช่องค้นหาเพื่อเจาะจง)</span>
          </div>
        `;
      }

      assemblySetListEl.innerHTML = itemsHtml;

      assemblySetListEl.querySelectorAll('.assembly-set-list-item').forEach(item => {
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(0, 242, 254, 0.08)'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'rgba(255,255,255,0.03)'; });
        item.addEventListener('click', () => {
          const woId = item.getAttribute('data-wo-id');
          state.setGanttMode('assembly');
          if (this.assemblyTree) {
            this.assemblyTree.selectedWoId = woId;
            this.assemblyTree.collapsedNodes.clear();
            this.assemblyTree.render();
            this.assemblyTree.fitView();
          }
        });
      });
    };

    const setTabButtonActive = (btn, active) => {
      if (!btn) return;
      if (active) {
        btn.style.background = 'rgba(0, 242, 254, 0.1)';
        btn.style.borderColor = 'var(--accent-teal)';
        btn.style.color = 'var(--accent-teal)';
      } else {
        btn.style.background = 'rgba(255, 255, 255, 0.05)';
        btn.style.borderColor = 'var(--border-glass)';
        btn.style.color = 'var(--text-secondary)';
      }
    };

    let leftSidebarMode = 'backlog'; // 'backlog' | 'assembly' - exclusive with each other only

    const btnAddPd = document.getElementById('btn-add-pd');
    const btnImportExcel = document.getElementById('btn-import-excel');

    const applyLeftSidebarMode = () => {
      setTabButtonActive(btnTabBacklog, leftSidebarMode === 'backlog');
      setTabButtonActive(btnTabAssembly, leftSidebarMode === 'assembly');

      const showAssembly = leftSidebarMode === 'assembly';
      if (backlogTabContent) backlogTabContent.style.display = showAssembly ? 'none' : 'flex';
      if (assemblyListTabContent) {
        assemblyListTabContent.style.display = showAssembly ? 'flex' : 'none';
        assemblyListTabContent.classList.toggle('hidden', !showAssembly);
      }
      if (backlogHeaderTitle) {
        backlogHeaderTitle.textContent = showAssembly ? 'ASSEMBLY SET LIST' : `PD BACKLOG (${state.workOrders.length})`;
      }
      // "Add Production Order" / "Import from Excel" only make sense for the
      // Backlog itself, not while browsing the Assembly Set list.
      if (btnAddPd) btnAddPd.style.display = showAssembly ? 'none' : '';
      if (btnImportExcel) btnImportExcel.style.display = showAssembly ? 'none' : '';
      if (showAssembly) renderAssemblySetList(assemblySearchInput ? assemblySearchInput.value : '');

      // Force redraw Gantt to resize cards to the newly available planning board width
      this.gantt.render();
    };
    this.applyLeftSidebarMode = applyLeftSidebarMode;

    // Resources (right sidebar) is a plain independent show/hide toggle - it does
    // not touch the left sidebar's Backlog/Assembly mode at all.
    const toggleResourcesSidebar = () => {
      const mainLayout = document.querySelector('.main-layout');
      mainLayout.classList.toggle('hide-resources');
      setTabButtonActive(btnTabResources, !mainLayout.classList.contains('hide-resources'));
      this.gantt.render();
    };

    if (btnTabBacklog) {
      btnTabBacklog.addEventListener('click', () => { leftSidebarMode = 'backlog'; applyLeftSidebarMode(); });
    }
    if (btnTabAssembly) {
      btnTabAssembly.addEventListener('click', () => { leftSidebarMode = 'assembly'; applyLeftSidebarMode(); });
    }
    if (btnTabResources) {
      btnTabResources.addEventListener('click', toggleResourcesSidebar);
    }

    // Legacy entry points (Options dropdown, the ◀ collapse button)
    const btnToggleResources = document.getElementById('btn-toggle-resources');
    const btnHideSidebar = document.getElementById('btn-hide-sidebar');
    const btnToggleBacklog = document.getElementById('btn-toggle-backlog');
    const btnCollapseBacklogX = document.getElementById('btn-collapse-backlog-x');

    const toggleLeftSidebarCollapsed = () => {
      const mainLayout = document.querySelector('.main-layout');
      mainLayout.classList.toggle('hide-backlog');
      this.gantt.render();
    };

    if (btnToggleResources) btnToggleResources.addEventListener('click', toggleResourcesSidebar);
    if (btnHideSidebar) btnHideSidebar.addEventListener('click', toggleResourcesSidebar);
    if (btnToggleBacklog) btnToggleBacklog.addEventListener('click', toggleLeftSidebarCollapsed);
    if (btnCollapseBacklogX) btnCollapseBacklogX.addEventListener('click', toggleLeftSidebarCollapsed);

    if (assemblySearchInput) {
      assemblySearchInput.addEventListener('input', () => {
        renderAssemblySetList(assemblySearchInput.value);
      });
    }

    const chkAssemblyFollowFilters = document.getElementById('chk-assembly-follow-filters');
    if (chkAssemblyFollowFilters) {
      chkAssemblyFollowFilters.checked = state.assemblyListFollowsFilters !== false;
      chkAssemblyFollowFilters.addEventListener('change', () => {
        state.assemblyListFollowsFilters = chkAssemblyFollowFilters.checked;
        renderAssemblySetList(assemblySearchInput ? assemblySearchInput.value : '');
      });
    }

    applyLeftSidebarMode();
    // Sync the Resources tab button's highlight with the sidebar's actual initial
    // visibility (it starts visible - no "hide-resources" class in the markup).
    setTabButtonActive(btnTabResources, !document.querySelector('.main-layout')?.classList.contains('hide-resources'));

    // 5. Undo / Redo / Clear Board Buttons
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnClearBoard = document.getElementById('btn-clear-board');

    if (btnUndo) {
      btnUndo.addEventListener('click', () => {
        state.undo();
      });
    }

    if (btnRedo) {
      btnRedo.addEventListener('click', () => {
        state.redo();
      });
    }

    // Clear Board Modal elements
    const clearBoardModal = document.getElementById('clear-board-modal');
    const btnCloseClearBoard = document.getElementById('btn-close-clear-board');
    const btnCancelClearBoard = document.getElementById('btn-cancel-clear-board');
    const btnConfirmClearBoard = document.getElementById('btn-confirm-clear-board');

    if (btnClearBoard) {
      btnClearBoard.addEventListener('click', () => {
        if (clearBoardModal) {
          clearBoardModal.classList.remove('hidden');
        }
      });
    }

    const closeClearBoardModal = () => {
      if (clearBoardModal) {
        clearBoardModal.classList.add('hidden');
      }
    };

    if (btnCloseClearBoard) btnCloseClearBoard.addEventListener('click', closeClearBoardModal);
    if (btnCancelClearBoard) btnCancelClearBoard.addEventListener('click', closeClearBoardModal);

    if (btnConfirmClearBoard) {
      btnConfirmClearBoard.addEventListener('click', () => {
        const choiceEl = document.querySelector('input[name="clear-board-choice"]:checked');
        const choice = choiceEl ? choiceEl.value : 'backlog';
        state.clearBoard(choice);
        closeClearBoardModal();
      });
    }

    // 5.5 Export and Import Plan Buttons
    const btnExportPlan = document.getElementById('btn-export-plan');
    const btnImportPlan = document.getElementById('btn-import-plan');
    const inputImportPlan = document.getElementById('input-import-plan');

    if (btnExportPlan) {
      btnExportPlan.addEventListener('click', () => {
        const plan = {
          version: '1.0',
          timestamp: new Date().toISOString(),
          scheduledJobs: state.scheduledJobs,
          workOrders: state.workOrders,
          nests: state.nests,
          schedulingModel: state.schedulingModel,
          activeScale: state.activeScale,
          timelineOffset: state.timelineOffset
        };
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(plan, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        
        const now = new Date();
        const dateString = now.getFullYear() +
          (now.getMonth() + 1).toString().padStart(2, '0') +
          now.getDate().toString().padStart(2, '0') + "_" +
          now.getHours().toString().padStart(2, '0') +
          now.getMinutes().toString().padStart(2, '0');
        
        downloadAnchor.setAttribute("download", `production_plan_${dateString}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      });
    }

    if (btnImportPlan) {
      btnImportPlan.addEventListener('click', () => {
        if (inputImportPlan) {
          inputImportPlan.value = ''; // Reset file input
          inputImportPlan.click();
        }
      });
    }

    if (inputImportPlan) {
      inputImportPlan.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const planData = JSON.parse(event.target.result);
            if (!planData.scheduledJobs || !planData.workOrders) {
              alert("ไฟล์แผนการผลิตไม่ถูกต้อง กรุณาเลือกไฟล์ที่ถูกส่งออกจากระบบนี้");
              return;
            }
            state.importPlan(planData);
            alert("นำเข้าแผนการผลิตสำเร็จเรียบร้อยแล้ว!");
          } catch (err) {
            alert("ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ JSON ที่ถูกต้อง");
          }
        };
        reader.readAsText(file);
      });
    }

    // Export Assembly Parts Status to CSV
    const btnExportAssemblyCSV = document.getElementById('btn-export-assembly-csv');
    if (btnExportAssemblyCSV) {
      btnExportAssemblyCSV.addEventListener('click', () => {
        const modal = document.getElementById('assembly-parts-modal');
        const jobId = modal ? modal.dataset.jobId : null;
        if (!jobId) return;
        
        const job = state.scheduledJobs.find(j => j.id === jobId);
        if (!job) return;

        const links = state.assemblyLinks || [];
        const subPdIds = Array.from(new Set(links.filter(link => link.to === job.id).map(link => state.parseStepId(link.from).woId)));
        
        // First, calculate the max finish hour for each sub-PD
        const pdFinishHours = {};
        subPdIds.forEach(subPdId => {
          const scheduledSteps = state.scheduledJobs.filter(j => j.woId === subPdId);
          let maxFinish = 0;
          scheduledSteps.forEach(s => {
            const finish = s.startHour + s.estHours;
            if (finish > maxFinish) {
              maxFinish = finish;
            }
          });
          pdFinishHours[subPdId] = maxFinish;
        });

        // Find the pending sub-PD with the highest finish hour (slowest)
        let slowestPdId = null;
        let maxHour = -1;
        subPdIds.forEach(subPdId => {
          const backlogWO = state.workOrders.find(wo => wo.id === subPdId);
          const backlogStepsCount = backlogWO ? backlogWO.steps.length : 0;
          const scheduledSteps = state.scheduledJobs.filter(j => j.woId === subPdId);
          const totalSteps = scheduledSteps.length + backlogStepsCount;
          const completedSteps = scheduledSteps.filter(j => j.status === 'Completed').length;
          const isPending = completedSteps < totalSteps;
          
          if (isPending) {
            const finishHour = pdFinishHours[subPdId] || 0;
            if (finishHour > maxHour) {
              maxHour = finishHour;
              slowestPdId = subPdId;
            }
          }
        });

        // Sort subPdIds: put the slowest pending PD on top
        subPdIds.sort((a, b) => {
          if (a === slowestPdId) return -1;
          if (b === slowestPdId) return 1;
          return 0;
        });

        const csvRows = [
          ['Slowest Status', 'Production Order ID', 'Part Name', 'Qty', 'Readiness Status', 'Plan Finish DateTime', 'Step Details (Name: Status)']
        ];

        subPdIds.forEach(subPdId => {
          const backlogWO = state.workOrders.find(wo => wo.id === subPdId);
          const backlogSteps = backlogWO ? backlogWO.steps : [];
          const scheduledSteps = state.scheduledJobs.filter(j => j.woId === subPdId);
          
          const partName = backlogWO?.partName || scheduledSteps[0]?.partName || 'Unknown';
          const qty = backlogWO?.qty || scheduledSteps[0]?.qty || 0;
          
          const allSteps = [];
          scheduledSteps.forEach(s => {
            allSteps.push({
              name: s.machine || s.originalMachine,
              status: s.status,
              stepNum: s.stepNum
            });
          });
          backlogSteps.forEach(s => {
            allSteps.push({
              name: s.machine,
              status: s.status,
              stepNum: s.stepNum
            });
          });
          
          const getStepNum = (name) => {
            const sIdx = backlogSteps.findIndex(s => s.machine === name);
            if (sIdx !== -1) return backlogSteps[sIdx].stepNum;
            const jIdx = scheduledSteps.findIndex(j => j.machine === name);
            if (jIdx !== -1) return scheduledSteps[jIdx].stepNum;
            return 10;
          };
          allSteps.sort((a, b) => getStepNum(a.name) - getStepNum(b.name));

          const totalSteps = allSteps.length;
          const completedSteps = scheduledSteps.filter(j => j.status === 'Completed').length;
          const isPdPending = completedSteps < totalSteps;

          // Calculate planFinishDateStr for pending PD
          let planFinishDateStr = 'Completed';
          if (isPdPending) {
            const maxFinishHour = pdFinishHours[subPdId] || 0;
            if (maxFinishHour > 0) {
              const d = workingHourToDate(maxFinishHour);
              const day = d.getDate().toString().padStart(2, '0');
              const m = (d.getMonth() + 1).toString().padStart(2, '0');
              const y = d.getFullYear();
              const hh = d.getHours().toString().padStart(2, '0');
              const mm = d.getMinutes().toString().padStart(2, '0');
              planFinishDateStr = `${day}/${m}/${y} ${hh}:${mm}`;
            } else {
              planFinishDateStr = 'Not Scheduled';
            }
          }

          const slowestStatus = (subPdId === slowestPdId) ? 'Slowest' : '';
          const readinessStr = isPdPending ? 'Pending' : 'Completed';
          const stepsStr = allSteps.map(step => `${step.name}: ${step.status}`).join(' -> ');

          csvRows.push([
            slowestStatus,
            subPdId,
            partName,
            qty,
            readinessStr,
            planFinishDateStr,
            stepsStr
          ]);
        });

        // Convert to CSV
        const csvString = csvRows.map(row => row.map(cell => {
          const str = cell.toString().replace(/"/g, '""');
          return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
        }).join(',')).join('\n');

        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Assembly_Readiness_${job.woId || job.id}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    }

    // 5.6 Export to CSV (Excel / Google Sheets) with Options Modal
    const btnExportCSV = document.getElementById('btn-export-csv');
    const exportCSVModal = document.getElementById('export-csv-modal');
    const btnCloseExportCSV = document.getElementById('btn-close-export-csv');
    const btnCancelExportCSV = document.getElementById('btn-cancel-export-csv');
    const btnConfirmExportCSV = document.getElementById('btn-confirm-export-csv');
    const csvStatusFilter = document.getElementById('csv-status-filter');

    const closeExportCSVModal = () => {
      if (exportCSVModal) exportCSVModal.classList.add('hidden');
    };

    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', () => {
        if (exportCSVModal) exportCSVModal.classList.remove('hidden');
      });
    }

    if (btnCloseExportCSV) btnCloseExportCSV.addEventListener('click', closeExportCSVModal);
    if (btnCancelExportCSV) btnCancelExportCSV.addEventListener('click', closeExportCSVModal);

    if (btnConfirmExportCSV) {
      btnConfirmExportCSV.addEventListener('click', () => {
        // 1. Filter jobs by status
        let filteredJobs = [...state.scheduledJobs];
        const statusVal = csvStatusFilter ? csvStatusFilter.value : 'all';
        if (statusVal === 'completed') {
          filteredJobs = filteredJobs.filter(j => j.status === 'Completed');
        } else if (statusVal === 'fully-completed') {
          // Check if a Production Order is fully completed (all steps completed and none in backlog)
          const isPDFullyCompleted = (woId) => {
            const inBacklog = state.workOrders.some(wo => wo.id === woId);
            if (inBacklog) return false;
            const steps = state.scheduledJobs.filter(j => j.woId === woId || j.id === woId);
            if (steps.length === 0) return false;
            return steps.every(j => j.status === 'Completed');
          };
          filteredJobs = filteredJobs.filter(j => isPDFullyCompleted(j.woId || j.id));
        } else if (statusVal === 'scheduled') {
          filteredJobs = filteredJobs.filter(j => j.status !== 'Completed');
        }

        // 2. Sort/Group jobs by option
        const groupBy = document.querySelector('input[name="csv-group-by"]:checked').value;
        let sortedJobs = [];
        if (groupBy === 'pd') {
          // Group by Production Order (PD) - Sorted by stepNum
          sortedJobs = [...filteredJobs].sort((a, b) => {
            const aWoId = a.woId || a.id;
            const bWoId = b.woId || b.id;
            if (aWoId !== bWoId) {
              return aWoId.localeCompare(bWoId);
            }
            return a.stepNum - b.stepNum;
          });
        } else {
          // Group by Work Center
          sortedJobs = [...filteredJobs].sort((a, b) => {
            const aMachine = a.machine || "";
            const bMachine = b.machine || "";
            if (aMachine !== bMachine) {
              return aMachine.localeCompare(bMachine);
            }
            return a.startHour - b.startHour;
          });
        }

        // 3. Generate CSV Headers and Rows dynamically
        let headers = [];
        let rows = [];

        if (groupBy === 'summary') {
          // Headers as requested by user
          headers = [
            "Production Order ID",
            "Start Date (Step 1)",
            "Start Time (Step 1)",
            "Finish Date (Last Step)",
            "Finish Time (Last Step)",
            "Updated Target Date"
          ];

          // Group by Production Order ID
          const pdMap = new Map();
          filteredJobs.forEach(job => {
            const woId = job.woId || job.id;
            if (!pdMap.has(woId)) {
              pdMap.set(woId, []);
            }
            pdMap.get(woId).push(job);
          });

          // Generate one row per Production Order
          for (const [woId, jobs] of pdMap.entries()) {
            const sortedSteps = [...jobs].sort((a, b) => a.stepNum - b.stepNum);
            const firstStep = sortedSteps[0];
            const lastStep = sortedSteps[sortedSteps.length - 1];

            const dStart = state.workingHourToDate(firstStep.startHour);
            const dEnd = state.workingHourToDate(lastStep.startHour + lastStep.estHours);

            const startDateStr = dStart.toLocaleDateString('en-GB');
            const startTimeStr = dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const endDateStr = dEnd.toLocaleDateString('en-GB');
            const endTimeStr = dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            // Updated Target Date is the next day after the last step finishes at 17:00
            const nextDay = new Date(dEnd.getFullYear(), dEnd.getMonth(), dEnd.getDate() + 1, 17, 0, 0);
            const adjustedDueStr = nextDay.toLocaleDateString('en-GB');

            rows.push([
              woId,
              startDateStr,
              startTimeStr,
              endDateStr,
              endTimeStr,
              adjustedDueStr
            ]);
          }
        } else if (statusVal === 'fully-completed') {
          // Headers without Work Center, Step No, and Step Name
          headers = [
            "Start Date",
            "Start Time",
            "End Date",
            "End Time",
            "Production Order ID",
            "Part Name",
            "Qty",
            "Original Target Date",
            "Adjusted Target Date",
            "Status"
          ];

          // Group by Production Order ID
          const pdMap = new Map();
          sortedJobs.forEach(job => {
            const woId = job.woId || job.id;
            if (!pdMap.has(woId)) {
              pdMap.set(woId, []);
            }
            pdMap.get(woId).push(job);
          });

          // Generate one row per Production Order
          for (const [woId, jobs] of pdMap.entries()) {
            // Find overall start and end times
            const minStartHour = Math.min(...jobs.map(j => j.startHour));
            const maxFinishHour = Math.max(...jobs.map(j => j.startHour + j.estHours));

            const dStart = state.workingHourToDate(minStartHour);
            const dEnd = state.workingHourToDate(maxFinishHour);

            const startDateStr = dStart.toLocaleDateString('en-GB');
            const startTimeStr = dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const endDateStr = dEnd.toLocaleDateString('en-GB');
            const endTimeStr = dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            const repJob = jobs[0];

            const origDueHour = repJob.originalDueHour !== undefined ? repJob.originalDueHour : repJob.dueHour;
            const dOrigDue = state.workingHourToDate(origDueHour || 72.0);
            const origDueStr = dOrigDue.toLocaleDateString('en-GB');

            const dFinish = state.workingHourToDate(maxFinishHour);
            const nextDay = new Date(dFinish.getFullYear(), dFinish.getMonth(), dFinish.getDate() + 1, 17, 0, 0);
            const adjustedDueStr = nextDay.toLocaleDateString('en-GB');

            rows.push([
              startDateStr,
              startTimeStr,
              endDateStr,
              endTimeStr,
              woId,
              repJob.partName || "",
              repJob.qty || "",
              origDueStr,
              adjustedDueStr,
              "Completed"
            ]);
          }
        } else {
          // Standard Headers
          headers = [
            "Work Center",
            "Start Date",
            "Start Time",
            "End Date",
            "End Time",
            "Production Order ID",
            "Part Name",
            "Step No",
            "Step Name",
            "Qty",
            "Original Target Date",
            "Adjusted Target Date",
            "Status"
          ];

          // Standard: one row per scheduled step
          rows = sortedJobs.map(job => {
            const dStart = state.workingHourToDate(job.startHour);
            const dEnd = state.workingHourToDate(job.startHour + job.estHours);

            const startDateStr = dStart.toLocaleDateString('en-GB');
            const startTimeStr = dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const endDateStr = dEnd.toLocaleDateString('en-GB');
            const endTimeStr = dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            const origDueHour = job.originalDueHour !== undefined ? job.originalDueHour : job.dueHour;
            const dOrigDue = state.workingHourToDate(origDueHour || 72.0);
            const origDueStr = dOrigDue.toLocaleDateString('en-GB');

            const woId = job.woId || job.id;
            const siblingSteps = state.scheduledJobs.filter(j => j.woId === woId || j.id === woId);
            const maxFinishHour = siblingSteps.length > 0 
              ? Math.max(...siblingSteps.map(j => j.startHour + j.estHours))
              : (job.startHour + job.estHours);
            const dFinish = state.workingHourToDate(maxFinishHour);
            const nextDay = new Date(dFinish.getFullYear(), dFinish.getMonth(), dFinish.getDate() + 1, 17, 0, 0);
            const adjustedDueStr = nextDay.toLocaleDateString('en-GB');

            return [
              job.machine || "",
              startDateStr,
              startTimeStr,
              endDateStr,
              endTimeStr,
              job.woId || job.id || "",
              job.partName || "",
              job.stepNum ? `Step ${job.stepNum}` : "",
              job.stepName || "",
              job.qty || "",
              origDueStr,
              adjustedDueStr,
              job.status || ""
            ];
          });
        }

        // Convert to CSV string
        const csvContent = [
          headers.join(","),
          ...rows.map(row => row.map(val => {
            // Escape double quotes and wrap in quotes if contains comma or quote
            let cell = val.toString().replace(/"/g, '""');
            if (cell.includes(",") || cell.includes('"') || cell.includes('\n')) {
              cell = `"${cell}"`;
            }
            return cell;
          }).join(","))
        ].join("\n");

        // Create Blob with UTF-8 BOM to support Thai and special characters in Excel/Google Sheets
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        
        const dateStr = new Date().toISOString().slice(0, 10);
        link.setAttribute("download", `MIE_Trak_Production_Plan_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        closeExportCSVModal();
      });
    }

    // 6. Listen to history-changed event to toggle button states
    window.addEventListener('history-changed', (e) => {
      if (btnUndo) {
        btnUndo.disabled = !e.detail.canUndo;
      }
      if (btnRedo) {
        btnRedo.disabled = !e.detail.canRedo;
      }
    });

    // 7. Dropdown Action Menu
    const dropdownContainer = document.getElementById('board-actions-dropdown');
    if (dropdownContainer) {
      const trigger = dropdownContainer.querySelector('.dropdown-trigger');
      const menu = dropdownContainer.querySelector('.dropdown-menu');
      
      if (trigger && menu) {
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.classList.toggle('hidden');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
          if (!dropdownContainer.contains(e.target)) {
            menu.classList.add('hidden');
          }
        });

        // Close dropdown when a menu item is clicked
        menu.querySelectorAll('.dropdown-item').forEach(item => {
          item.addEventListener('click', () => {
            menu.classList.add('hidden');
          });
        });

        // Explicitly wire btn-storage-sync to open sync modal
        const btnStorageSync = document.getElementById('btn-storage-sync');
        if (btnStorageSync) {
          btnStorageSync.addEventListener('click', () => {
            menu.classList.add('hidden');
            this.storageSync?.openSyncModal();
          });
        }
        const checkShowAllWc = document.getElementById('check-show-all-wc');
        if (checkShowAllWc) {
          checkShowAllWc.checked = state.showAllWorkCenters;
          checkShowAllWc.addEventListener('change', () => {
            state.showAllWorkCenters = checkShowAllWc.checked;
            state.notify();
          });
        }
      }
    }

    // 7.1 Planning Tools Dropdown Menu
    const planningToolsDropdown = document.getElementById('planning-tools-dropdown');
    if (planningToolsDropdown) {
      const btnPlanningTools = document.getElementById('btn-planning-tools');
      const planningToolsMenu = document.getElementById('planning-tools-menu');
      if (btnPlanningTools && planningToolsMenu) {
        btnPlanningTools.addEventListener('click', (e) => {
          e.stopPropagation();
          planningToolsMenu.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
          if (!planningToolsDropdown.contains(e.target)) {
            planningToolsMenu.classList.add('hidden');
          }
        });
        planningToolsMenu.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', () => {
            planningToolsMenu.classList.add('hidden');
          });
        });
      }
    }

    // 8. Timeline Navigation Controls (◀, ▶, Today)
    const btnTimelinePrev = document.getElementById('btn-timeline-prev');
    const btnTimelineNext = document.getElementById('btn-timeline-next');
    const btnTimelineNow = document.getElementById('btn-timeline-now');

    const shiftTimeline = (direction) => {
      const scale = state.activeScale;
      let step = 8.0; // 1 working day in hours (8h)
      if (scale === 'day') {
        step = 48.0; // 1 working week (6 days * 8h)
      } else if (scale === 'week') {
        step = 192.0; // 4 working weeks
      } else if (scale === 'month') {
        step = 576.0; // 12 working weeks (3 months)
      }
      
      const currentOffset = state.timelineOffset || 0.0;
      const newOffset = currentOffset + direction * step;
      state.setTimelineOffset(newOffset);
    };

    if (btnTimelinePrev) {
      btnTimelinePrev.addEventListener('click', () => shiftTimeline(-1));
    }
    if (btnTimelineNext) {
      btnTimelineNext.addEventListener('click', () => shiftTimeline(1));
    }
    if (btnTimelineNow) {
      btnTimelineNow.addEventListener('click', () => {
        const now = new Date();
        const nowWorkingHour = dateToWorkingHour(now);
        const scale = state.activeScale;
        const config = state.getScaleConfig(scale);

        // Center the view by placing the current working hour at about 1/3 of the visible board width
        // so that the user sees some past hours and mostly future hours.
        const targetOffset = nowWorkingHour - config.totalHours / 3;
        const snap = config.snapHours;
        const snappedOffset = Math.round(targetOffset / snap) * snap;
        state.setTimelineOffset(snappedOffset);
      });
    }

    const btnTimelineGotoDate = document.getElementById('btn-timeline-goto-date');
    const timelineGotoDateInput = document.getElementById('timeline-goto-date-input');
    if (btnTimelineGotoDate && timelineGotoDateInput) {
      btnTimelineGotoDate.addEventListener('click', () => {
        timelineGotoDateInput.style.display = timelineGotoDateInput.style.display === 'none' ? 'inline-block' : 'none';
        if (timelineGotoDateInput.style.display !== 'none') {
          timelineGotoDateInput.focus();
          if (typeof timelineGotoDateInput.showPicker === 'function') {
            try { timelineGotoDateInput.showPicker(); } catch (e) {}
          }
        }
      });
      timelineGotoDateInput.addEventListener('change', () => {
        if (!timelineGotoDateInput.value) return;
        const [year, month, day] = timelineGotoDateInput.value.split('-').map(Number);
        const targetDate = new Date(year, month - 1, day, 8, 0, 0);
        const targetWorkingHour = state.dateToWorkingHour(targetDate);
        const scale = state.activeScale;
        const config = state.getScaleConfig(scale);

        const targetOffset = targetWorkingHour - config.totalHours / 3;
        const snap = config.snapHours;
        const snappedOffset = Math.round(targetOffset / snap) * snap;
        state.setTimelineOffset(snappedOffset);
        timelineGotoDateInput.style.display = 'none';
      });
    }

    // 9. Dr.Dainittei Quote Simulation Modal
    const dainitteiModal = document.getElementById('dainittei-modal');
    const btnCloseDainittei = document.getElementById('btn-close-dainittei');
    const btnCancelDainittei = document.getElementById('btn-cancel-dainittei');
    const btnConfirmDainittei = document.getElementById('btn-confirm-dainittei');
    const quoteInfoEl = document.getElementById('dainittei-quote-info');
    const chartEl = document.getElementById('dainittei-workload-chart');
    const recommendationEl = document.getElementById('dainittei-recommendation');

    window.addEventListener('simulate-quote', (e) => {
      const qid = e.detail.quoteId;
      this.activeSimulateQuoteId = qid;
      
      const impact = state.simulateQuoteImpact(qid);
      if (!impact) return;

      // Populate Quote Info
      quoteInfoEl.innerHTML = `
        <div class="dainittei-quote-summary">
          <div><strong>Quote ID:</strong> ${impact.quote.id}</div>
          <div><strong>ลูกค้า (Customer):</strong> ${impact.quote.customer}</div>
          <div><strong>แบบเครื่องจักร (Machine Component):</strong> ${impact.quote.partName}</div>
          <div><strong>จำนวน (Qty):</strong> ${impact.quote.qty} ชิ้น</div>
          <div><strong>ระดับความสำคัญ (Priority):</strong> ${impact.quote.priority}</div>
          <div><strong>ประมาณการรายรับ (Revenue):</strong> $${impact.quote.revenue.toLocaleString()}</div>
        </div>
      `;

      // Populate Workload Chart
      chartEl.innerHTML = '';
      Object.keys(state.workCenters).forEach(machine => {
        const before = impact.workloadsBefore[machine];
        const after = impact.workloadsAfter[machine];
        
        const row = document.createElement('div');
        row.className = 'dainittei-bar-row';
        row.innerHTML = `
          <span style="font-weight: 600;">${machine}</span>
          <div class="dainittei-bar-wrapper">
            <div style="display:flex; justify-content:space-between; font-size: 8px; color: var(--text-secondary);">
              <span>ภาระงานก่อนหน้า (Before): ${before}%</span>
              <span>ภาระงานถัดไป (After): ${after}%</span>
            </div>
            <div class="dainittei-bar-track" title="Before: ${before}%">
              <div class="dainittei-bar-fill before" style="width: ${Math.min(100, before)}%"></div>
            </div>
            <div class="dainittei-bar-track" title="After: ${after}%">
              <div class="dainittei-bar-fill ${after > 100 ? 'overload' : 'after'}" style="width: ${Math.min(100, after)}%"></div>
            </div>
          </div>
        `;
        chartEl.appendChild(row);
      });

      // Populate Recommendation
      let recommendationHTML = '';
      if (impact.bottlenecks.length > 0) {
        recommendationHTML = `
          <div style="display:flex; align-items:center; gap: 8px;">
            <span style="font-size: 16px;">⚠️</span>
            <div>
              <strong style="color: var(--accent-red);">คำเตือน: แผนกคอขวด (Overload Bottlenecks)</strong>
              <p style="margin: 4px 0 0 0; font-size: 11px;">แผนก <strong>${impact.bottlenecks.join(', ')}</strong> เกินกำลังผลิต (100%+)</p>
              <p style="margin: 2px 0 0 0; font-size: 10px; color: var(--text-secondary);">คำแนะนำ: อาจส่งผลให้การส่งงานประกอบล่วงเลยแผน หรือพิจารณาทำโอทีเครื่องจักร</p>
            </div>
          </div>
        `;
      } else {
        recommendationHTML = `
          <div style="display:flex; align-items:center; gap: 8px;">
            <span style="font-size: 16px; color: var(--accent-green);">✅</span>
            <div>
              <strong style="color: var(--accent-green);">กำลังผลิตเพียงพอ (Capacity Available)</strong>
              <p style="margin: 4px 0 0 0; font-size: 11px;">สามารถบรรจุงานผลิตเครื่องจักรนี้เข้าสู่ตารางการผลิตได้โดยไม่เกิดแผนกโอเวอร์โหลด</p>
            </div>
          </div>
        `;
      }

      const formattedFin = formatTime(impact.estFinishHour, state.activeScale);
      recommendationHTML += `
        <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; font-size: 11px;">
          <strong>คาดการณ์ประกอบเสร็จสิ้น (Est. Assembly Finish):</strong> ${formattedFin}
        </div>
      `;
      recommendationEl.innerHTML = recommendationHTML;

      // Show Modal
      dainitteiModal.classList.remove('hidden');
    });

    const closeDainittei = () => {
      dainitteiModal.classList.add('hidden');
      this.activeSimulateQuoteId = null;
    };

    if (btnCloseDainittei) btnCloseDainittei.addEventListener('click', closeDainittei);
    if (btnCancelDainittei) btnCancelDainittei.addEventListener('click', closeDainittei);

    if (btnConfirmDainittei) {
      btnConfirmDainittei.addEventListener('click', () => {
        if (this.activeSimulateQuoteId) {
          const newWO = state.convertQuote(this.activeSimulateQuoteId);
          if (newWO) {
            closeDainittei();
          }
        }
      });
    }

    // 10. Dr.Koutei Web Actual Mobile Modal
    const webactualModal = document.getElementById('webactual-modal');
    const btnCloseWebActual = document.getElementById('btn-close-webactual');
    const btnSaveWebActual = document.getElementById('btn-save-webactual');
    const webactualJobDetails = document.getElementById('webactual-job-details');
    const webactualStatus = document.getElementById('webactual-status');
    const webactualElapsed = document.getElementById('webactual-elapsed');
    const webactualScrap = document.getElementById('webactual-scrap');

    window.addEventListener('open-webactual', (e) => {
      const jid = e.detail.jobId;
      this.activeWebActualJobId = jid;

      const job = state.scheduledJobs.find(j => j.id === jid);
      if (!job) return;

      // Populate details
      const stepIndicator = job.stepNum ? `[ขั้นตอน ${job.stepNum}]` : '';
      const finishTime = formatTime(job.startHour + job.estHours, state.activeScale);

      webactualJobDetails.innerHTML = `
        <div style="font-weight: 700; color: #fff; font-size:12px;">${job.woId || job.id} ${stepIndicator}</div>
        <div style="font-size: 10px; color: var(--text-secondary); margin-top:2px;">Component: ${job.partName}</div>
        <div style="font-size: 10px; color: var(--text-secondary);">ลูกค้า: ${job.customer}</div>
        <div style="font-size: 10px; color: var(--text-secondary);">แผนกประกอบ (Work Center): ${job.machine}</div>
        <div style="display:flex; justify-content:space-between; font-size: 10px; color: var(--accent-teal); margin-top:5px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top:4px;">
          <span>แผนผลิต: ${job.estHours} ชม.</span>
          <span>คาดว่าเสร็จ: ${finishTime}</span>
        </div>
      `;

      // Set inputs
      webactualStatus.value = job.status || 'Scheduled';
      webactualElapsed.value = job.elapsedMinutes || 0;
      webactualScrap.value = job.scrapQty || 0;

      // Show Modal
      webactualModal.classList.remove('hidden');
    });

    const closeWebActual = () => {
      webactualModal.classList.add('hidden');
      this.activeWebActualJobId = null;
    };

    if (btnCloseWebActual) btnCloseWebActual.addEventListener('click', closeWebActual);

    if (btnSaveWebActual) {
      btnSaveWebActual.addEventListener('click', () => {
        if (this.activeWebActualJobId) {
          const status = webactualStatus.value;
          const elapsed = parseInt(webactualElapsed.value) || 0;
          const scrap = parseInt(webactualScrap.value) || 0;
          
          state.reportActualProgress(this.activeWebActualJobId, status, elapsed, 0, scrap);
          closeWebActual();
        }
      });
    }

    // 11. Light/Dark Theme Toggle
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const themeIconSun = btnThemeToggle?.querySelector('.theme-icon-sun');
    const themeIconMoon = btnThemeToggle?.querySelector('.theme-icon-moon');

    const setTheme = (isDark) => {
      if (isDark) {
        document.body.classList.add('dark-theme');
        themeIconSun?.classList.remove('hidden');
        themeIconMoon?.classList.add('hidden');
        localStorage.setItem('theme', 'dark');
      } else {
        document.body.classList.remove('dark-theme');
        themeIconSun?.classList.add('hidden');
        themeIconMoon?.classList.remove('hidden');
        localStorage.setItem('theme', 'light');
      }
    };

    // Load saved theme or default to light theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme === 'dark');

    if (btnThemeToggle) {
      btnThemeToggle.addEventListener('click', () => {
        const isCurrentlyDark = document.body.classList.contains('dark-theme');
        setTheme(!isCurrentlyDark);
      });
    }

    // 12. Display Options dropdown - dep lines / hide-unused-WC / priority
    // badge / merge bars / machine offload, each bound to a checkbox styled
    // as an iOS-style toggle switch instead of its own standalone button.
    const btnDisplayOptions = document.getElementById('btn-display-options');
    const displayOptionsPanel = document.getElementById('display-options-panel');
    if (btnDisplayOptions && displayOptionsPanel) {
      btnDisplayOptions.addEventListener('click', (e) => {
        e.stopPropagation();
        displayOptionsPanel.classList.toggle('hidden');
      });
      document.addEventListener('click', (e) => {
        if (!displayOptionsPanel.classList.contains('hidden') &&
            !displayOptionsPanel.contains(e.target) &&
            e.target !== btnDisplayOptions) {
          displayOptionsPanel.classList.add('hidden');
        }
      });
    }

    const toggleDepLines = document.getElementById('toggle-dep-lines');
    if (toggleDepLines) {
      toggleDepLines.checked = state.showDependencyLines !== false;
      toggleDepLines.addEventListener('change', () => {
        state.toggleDependencyLines();
        toggleDepLines.checked = state.showDependencyLines !== false;
      });
    }

    const toggleHideUnusedWc = document.getElementById('toggle-hide-unused-wc');
    const syncHideUnusedWcUI = () => {
      if (toggleHideUnusedWc) toggleHideUnusedWc.checked = !state.showAllWorkCenters;
      const checkShowAllWc = document.getElementById('check-show-all-wc');
      if (checkShowAllWc) checkShowAllWc.checked = state.showAllWorkCenters;
    };
    if (toggleHideUnusedWc) {
      syncHideUnusedWcUI();
      toggleHideUnusedWc.addEventListener('change', () => {
        state.showAllWorkCenters = !toggleHideUnusedWc.checked;
        syncHideUnusedWcUI();
        state.notify();
      });
    }

    const togglePriorityBadge = document.getElementById('toggle-priority-badge');
    if (togglePriorityBadge) {
      togglePriorityBadge.checked = state.showPriorityBadge !== false;
      togglePriorityBadge.addEventListener('change', () => {
        state.showPriorityBadge = togglePriorityBadge.checked;
        state.notify();
      });
    }

    const toggleMergeBars = document.getElementById('toggle-merge-bars');
    if (toggleMergeBars) {
      toggleMergeBars.checked = state.mergeBarsEnabled !== false;
      toggleMergeBars.addEventListener('change', () => {
        state.mergeBarsEnabled = toggleMergeBars.checked;
        state.notify();
      });
    }

    const toggleGanttLegend = document.getElementById('toggle-gantt-legend');
    const ganttLegendEl = document.getElementById('gantt-legend') || document.querySelector('.gantt-legend');
    const applyGanttLegendVisibility = (visible) => {
      state.showGanttLegend = Boolean(visible);
      if (toggleGanttLegend) toggleGanttLegend.checked = state.showGanttLegend;
      if (ganttLegendEl) {
        ganttLegendEl.classList.toggle('hidden', !state.showGanttLegend);
        ganttLegendEl.style.display = state.showGanttLegend ? 'flex' : 'none';
      }
      if (this.gantt && typeof this.gantt.drawDependencyLines === 'function') {
        requestAnimationFrame(() => this.gantt.drawDependencyLines());
      }
    };
    applyGanttLegendVisibility(Boolean(state.showGanttLegend));
    if (toggleGanttLegend) {
      toggleGanttLegend.addEventListener('change', () => {
        applyGanttLegendVisibility(toggleGanttLegend.checked);
      });
    }

    // Allows the scheduler to offload jobs onto a work center's configured
    // alt machine(s) when the original machine is busy.
    const toggleMachineOffload = document.getElementById('toggle-machine-offload');
    if (toggleMachineOffload) {
      toggleMachineOffload.checked = state.allowMachineOffload !== false;
      toggleMachineOffload.addEventListener('change', () => {
        state.allowMachineOffload = toggleMachineOffload.checked;
      });
    }

    // Groups identical items (same DWG No. / Part Name) together across different PDs
    // to run consecutively / concurrently on machines to reduce setup changeovers.
    const toggleGroupSameItem = document.getElementById('toggle-group-same-item');
    if (toggleGroupSameItem) {
      toggleGroupSameItem.checked = state.groupSameItem !== false;
      toggleGroupSameItem.addEventListener('change', () => {
        state.groupSameItem = toggleGroupSameItem.checked;
        state.savePlanToFile();
        if (toggleGroupSameItem.checked) {
          const panel = document.getElementById('display-options-panel');
          if (panel) panel.classList.add('hidden');
          this.showSameItemGroupingModal();
        }
      });
    }

    const btnViewGroupedItems = document.getElementById('btn-view-grouped-items');
    if (btnViewGroupedItems) {
      btnViewGroupedItems.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = document.getElementById('display-options-panel');
        if (panel) panel.classList.add('hidden');
        this.showSameItemGroupingModal();
      });
    }

    const toggleCloudSync = document.getElementById('toggle-cloud-sync');
    if (toggleCloudSync) {
      const isSyncEnabled = this.storageSync ? this.storageSync.isAutoSyncEnabled() : (localStorage.getItem('PDPLAN_AUTO_SYNC') !== 'false');
      toggleCloudSync.checked = isSyncEnabled;
      toggleCloudSync.addEventListener('change', () => {
        if (this.storageSync) {
          this.storageSync.setAutoSyncEnabled(toggleCloudSync.checked);
        } else {
          localStorage.setItem('PDPLAN_AUTO_SYNC', toggleCloudSync.checked ? 'true' : 'false');
        }
      });
    }

    // Quick access from Option dropdown to Data Storage Location & Machine Settings
    const btnHeaderStorageSync = document.getElementById('btn-header-storage-sync');
    if (btnHeaderStorageSync) {
      btnHeaderStorageSync.addEventListener('click', (e) => {
        e.stopPropagation();
        displayOptionsPanel?.classList.add('hidden');
        if (this.storageSync) {
          this.storageSync.openSyncModal();
        } else if (window.storageSyncManager) {
          window.storageSyncManager.openSyncModal();
        } else {
          document.getElementById('storage-sync-modal')?.classList.remove('hidden');
        }
      });
    }

    const btnHeaderMachineSettings = document.getElementById('btn-header-machine-settings');
    if (btnHeaderMachineSettings) {
      btnHeaderMachineSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        displayOptionsPanel?.classList.add('hidden');
        const btnWcSettings = document.getElementById('btn-workcenter-settings');
        if (btnWcSettings) {
          btnWcSettings.click();
        }
      });
    }

    // 12d. Work Mode: "วางแผน" (planning, normal drag/edit) vs "Work Center Terminal"
    // (clicking a task bar opens the MIE Shop Floor Kiosk Simulator - see kiosk.js)
    const btnToggleWorkMode = document.getElementById('btn-toggle-work-mode');
    const workModeText = document.getElementById('work-mode-text');

    const updateWorkModeButtonUI = () => {
      const isTerminal = state.workMode === 'terminal';
      if (btnToggleWorkMode) {
        if (isTerminal) {
          btnToggleWorkMode.style.background = 'rgba(0, 242, 254, 0.15)';
          btnToggleWorkMode.style.borderColor = 'var(--accent-teal)';
          btnToggleWorkMode.style.color = 'var(--accent-teal)';
          if (workModeText) workModeText.textContent = 'โหมด: Work Center Terminal';
        } else {
          btnToggleWorkMode.style.background = 'rgba(255, 255, 255, 0.05)';
          btnToggleWorkMode.style.borderColor = 'var(--border-glass)';
          btnToggleWorkMode.style.color = 'var(--text-secondary)';
          if (workModeText) workModeText.textContent = 'โหมด: วางแผน';
        }
      }
      // The kiosk drawer (and its toggle handle) only exists in Work Center
      // Terminal mode - hidden entirely in วางแผน (planning) mode, not just closed.
      const kioskDrawer = document.getElementById('kiosk-drawer');
      if (kioskDrawer) kioskDrawer.style.display = isTerminal ? '' : 'none';
      // Reclaim the bottom bar's reserved 40px too, so the board uses the full
      // viewport height. Also kill the CSS height transition first - .main-layout
      // is re-touched on every state.notify() (there are many during initial data
      // load), and each touch was restarting the 0.3s transition before it ever
      // finished, so it visually never left its starting height.
      const mainLayout = document.querySelector('.main-layout');
      if (mainLayout) {
        mainLayout.style.transition = 'none';
        if (isTerminal) {
          mainLayout.style.removeProperty('height');
        } else {
          mainLayout.style.setProperty('height', 'calc(100vh - 70px)', 'important');
        }
      }
    };

    if (btnToggleWorkMode) {
      btnToggleWorkMode.addEventListener('click', () => {
        state.workMode = state.workMode === 'terminal' ? 'planning' : 'terminal';
        updateWorkModeButtonUI();
        state.notify();
      });
    }

    // Keeps the Display Options toggles in sync when state changes from
    // elsewhere (e.g. loading a plan from file).
    const syncDisplayOptionsUI = () => {
      if (toggleDepLines) toggleDepLines.checked = state.showDependencyLines !== false;
      syncHideUnusedWcUI();
      if (togglePriorityBadge) togglePriorityBadge.checked = state.showPriorityBadge !== false;
      if (toggleMergeBars) toggleMergeBars.checked = state.mergeBarsEnabled !== false;
      if (toggleMachineOffload) toggleMachineOffload.checked = state.allowMachineOffload !== false;
      if (toggleGroupSameItem) toggleGroupSameItem.checked = state.groupSameItem !== false;
    };

    state.subscribe(() => {
      syncDisplayOptionsUI();
      updateWorkModeButtonUI();
    });
    syncDisplayOptionsUI();
    updateWorkModeButtonUI();

    // Dispatch initial history state to align button disabled states
    state.dispatchHistoryEvent();
  }

  showBacklogSelectionModal(button) {
    const unlockedBacklog = state.workOrders.filter(wo => !state.isProjectLocked(wo.project));
    const unlockedScheduled = state.scheduledJobs.filter(j => j.status !== 'Completed' && !state.isJobLocked(j));

    if (unlockedBacklog.length === 0 && unlockedScheduled.length === 0) {
      if (state.ganttController) {
        state.ganttController.showToast('🔒 ทุกโครงการถูกล็อคแผนงานไว้ ไม่สามารถปรับแผนด้วย AI ได้จนกว่าจะปลดล็อค');
      } else {
        alert('🔒 ทุกโครงการถูกล็อคแผนงานไว้ ไม่สามารถปรับแผนด้วย AI ได้จนกว่าจะปลดล็อค');
      }
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.zIndex = '300';

    // Calculate default date time: default to 8:00 AM tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);

    const year = tomorrow.getFullYear();
    const month = (tomorrow.getMonth() + 1).toString().padStart(2, '0');
    const day = tomorrow.getDate().toString().padStart(2, '0');
    const defaultDateTimeVal = `${year}-${month}-${day}T08:00`;

    let defaultDisplayDate = defaultDateTimeVal;
    try {
      const [dPart, tPart] = defaultDateTimeVal.split('T');
      const [yV, mV, dV] = dPart.split('-');
      defaultDisplayDate = `${dV}/${mV}/${yV} ${tPart} น.`;
    } catch (e) {
      defaultDisplayDate = defaultDateTimeVal;
    }

    const sortedWorkOrders = [...state.workOrders].sort((a, b) => {
      const pA = getPriorityWeight(a.priority);
      const pB = getPriorityWeight(b.priority);
      if (pA !== pB) return pA - pB;
      return a.id.localeCompare(b.id);
    });

    let backlogContentHTML = '';
    if (sortedWorkOrders.length > 0) {
      const rowsHTML = sortedWorkOrders.map(wo => {
        const stepsPreview = wo.steps.map(s => `[${s.stepNum}] ${(s.machine || 'Unknown').split(' ')[0]}`).join(' ➔ ');
        const priorityClass = (wo.priority || 'Normal').toLowerCase();
        const isLocked = state.isProjectLocked(wo.project);
        
        const lockBadge = isLocked 
          ? `<span style="font-size: 9px; color: #f59e0b; font-weight: bold; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 1px 4px; border-radius: 4px;" title="โครงการนี้ถูกล็อคแผนไว้ ไม่สามารถจัดแผน AI ได้">🔒 ล็อคโครงการ (${wo.project || 'General'})</span>`
          : '';

        return `
          <label style="display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: 6px; padding: 10px; margin-bottom: 8px; cursor: ${isLocked ? 'not-allowed' : 'pointer'}; opacity: ${isLocked ? '0.6' : '1'}; transition: background 0.2s;">
            <input type="checkbox" class="wo-select-checkbox" value="${wo.id}" ${isLocked ? 'disabled' : 'checked'} style="width: 16px; height: 16px; accent-color: var(--accent-teal);" />
            <div style="flex: 1; font-size: 11px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <strong>${wo.id}</strong>
                <div style="display: flex; align-items: center; gap: 6px;">
                  ${lockBadge}
                  <span class="priority-badge ${priorityClass}">${wo.priority}</span>
                </div>
              </div>
              <div style="color: var(--text-primary); font-weight: bold;">${wo.partName}</div>
              <div style="color: var(--text-secondary); font-size: 9px; margin-top: 2px;">Customer: ${wo.customer} | Project: ${wo.project || 'General'} | Qty: ${wo.qty}</div>
              <div style="color: var(--accent-teal); font-size: 9px; margin-top: 2px;">Route: ${stepsPreview}</div>
            </div>
          </label>
        `;
      }).join('');

      backlogContentHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 11px;">
          <span style="color: var(--text-secondary);">เลือกงานที่ต้องการให้ AI จัดสรรลงบอร์ดอัตโนมัติ:</span>
          <div style="display: flex; gap: 10px;">
            <span id="btn-select-all-wo" style="color: var(--accent-teal); cursor: pointer; font-weight: bold;">เลือกทั้งหมด</span>
            <span id="btn-deselect-all-wo" style="color: var(--accent-red); cursor: pointer; font-weight: bold;">ล้างทั้งหมด</span>
          </div>
        </div>
        <div class="backlog-selection-list">
          ${rowsHTML}
        </div>
      `;
    } else {
      backlogContentHTML = `
        <div style="background: rgba(0, 242, 254, 0.04); border: 1px solid rgba(0, 242, 254, 0.2); border-radius: 6px; padding: 12px; text-align: center; font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">
          ℹ️ ไม่มีงานค้างใน Backlog — ระบบ AI จะทำการจัดระเบียบและปรับสมดุลตารางงาน <strong>${state.scheduledJobs.length} รายการ</strong> บนกระดานตามเวลาที่กำหนด
        </div>
      `;
    }

    modal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 530px; width: 90%;">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 10px;">
          <h3 style="color: var(--accent-teal); margin: 0; display: flex; align-items: center; gap: 8px;">
            <span>🤖</span> เลือกงานสำหรับ AI Auto-Optimize (APS)
          </h3>
        </div>
        <div class="modal-body" style="max-height: 420px; overflow-y: auto; padding: 15px 5px 15px 0;">
          
          <!-- Mode Banner -->
          <div style="background: rgba(0, 242, 254, 0.04); border: 1px solid rgba(0, 242, 254, 0.2); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: bold; font-size: 11.5px; color: var(--accent-teal); margin-bottom: 2px;">
                ⚡ วางแผนผลิตอัตโนมัติ (Multi-PD Simulation Placement)
              </div>
              <div style="font-size: 9.5px; color: var(--text-secondary);">
                จัดสรรงานต่อเนื่องจากวันเวลาปัจจุบัน โดยหาช่วงเวลาว่างที่เร็วที่สุดของแต่ละเครื่องจักร
              </div>
            </div>
            <div style="font-size: 9.5px; color: var(--accent-green); background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: bold; white-space: nowrap;">
              ⏱️ ต่อเนื่องจากปัจจุบัน
            </div>
          </div>

          <!-- Strategy Option: Group Same Item -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-glass); border-radius: 8px; padding: 8px 12px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 600; font-size: 11px; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                <span>📦</span> Group Item เดียวกัน (Same-Item Continuity)
              </div>
              <div style="font-size: 9px; color: var(--text-secondary); margin-top: 1px;">
                จัดคิวผลิตชิ้นงานรหัสแบบ (DWG) เดียวกันให้ผลิตต่อเนื่องกัน ลดเวลา Setup/เปลี่ยนแม่พิมพ์
              </div>
            </div>
            <span class="ios-toggle">
              <input type="checkbox" id="modal-toggle-group-same-item" ${state.groupSameItem !== false ? 'checked' : ''}>
              <span class="ios-toggle-slider"></span>
            </span>
          </div>

          ${backlogContentHTML}
        </div>
        <div class="modal-footer" style="display: flex; gap: 10px; border-top: 1px solid var(--border-glass); padding-top: 12px; margin-top: 5px;">
          <button class="btn btn-secondary" id="btn-cancel-select" style="flex: 1; justify-content: center; background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 8px;">
            ยกเลิก (Cancel)
          </button>
          <button class="btn btn-glowing" id="btn-submit-select" style="flex: 1.5; justify-content: center; padding: 8px;">
            เริ่มจัดแผน AI (Run Optimize)
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const selectAllBtn = modal.querySelector('#btn-select-all-wo');
    const deselectAllBtn = modal.querySelector('#btn-deselect-all-wo');
    const checkboxes = modal.querySelectorAll('.wo-select-checkbox');

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        checkboxes.forEach(cb => {
          if (!cb.disabled) cb.checked = true;
        });
      });
    }

    if (deselectAllBtn) {
      deselectAllBtn.addEventListener('click', () => {
        checkboxes.forEach(cb => cb.checked = false);
      });
    }

    modal.querySelector('#btn-cancel-select').addEventListener('click', () => {
      modal.remove();
    });

    modal.querySelector('#btn-submit-select').addEventListener('click', () => {
      const selectedIds = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);

      const modalGroupSameItem = modal.querySelector('#modal-toggle-group-same-item');
      if (modalGroupSameItem) {
        state.groupSameItem = modalGroupSameItem.checked;
        state.savePlanToFile();
      }

      modal.remove();
      this.runAIOptimizationWithSelection(button, selectedIds);
    });
  }

  runAIOptimizationWithSelection(button, selectedWOIds) {
    button.disabled = true;

    // 1. Gather context data
    const originallyScheduledWOIds = new Set(state.scheduledJobs.map(j => j.woId).filter(Boolean));
    
    const now = new Date();
    const nowWorkingHour = state.dateToWorkingHour(now);
    
    const backlogToOptimize = state.workOrders.filter(wo => selectedWOIds.includes(wo.id));
    
    // Count total operations
    let totalBacklogOps = 0;
    backlogToOptimize.forEach(wo => {
      totalBacklogOps += (wo.steps && wo.steps.length) ? wo.steps.length : 1;
    });
    const lockedCount = Object.keys(state.lockedProjects || {}).filter(k => state.lockedProjects[k]).length;
    const workCenterCount = Object.keys(state.workCenters || {}).length;

    // Run AI scheduler engine in background starting strictly from nowWorkingHour
    console.log('[AI Auto] now:', now, 'nowWorkingHour:', nowWorkingHour, 'groupSameItem:', state.groupSameItem);
    const optimized = Scheduler.runAISimulation(
      backlogToOptimize,
      state.scheduledJobs,
      state.activeScale,
      nowWorkingHour,
      state.workCenters,
      state.lockedProjects,
      state.allowMachineOffload,
      state.groupSameItem
    );

    // Check late jobs
    const lateJobs = optimized.filter(job => {
      const finish = job.startHour + job.estHours;
      const due = state.getScaledDueHour(job);
      return due !== null && finish > due;
    });
    const lateJobsOnBoard = lateJobs.filter(job => originallyScheduledWOIds.has(job.woId || job.id));

    // 2. Create Live AI Status Log Popup
    const statusModal = document.createElement('div');
    statusModal.className = 'modal-overlay';
    statusModal.id = 'ai-optimizing-modal';
    statusModal.style.zIndex = '500';
    statusModal.style.background = 'rgba(10, 15, 29, 0.85)';
    statusModal.style.backdropFilter = 'blur(10px)';

    statusModal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 620px; width: 92%; max-height: 90vh; display: flex; flex-direction: column; border: 1px solid rgba(0, 242, 254, 0.35); box-shadow: 0 0 40px rgba(0, 242, 254, 0.2); padding: 22px; border-radius: 12px; animation: modal-scale-in 0.25s ease-out;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px; animation: spin 4s linear infinite; display: inline-block;">🤖</span>
            <div>
              <h3 style="color: var(--accent-teal); margin: 0; font-size: 16px; font-weight: 800; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
                APS AI Auto Optimization Engine
              </h3>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                กำลังวิเคราะห์และจัดแผนการผลิตอัตโนมัติ (Live Status Log)
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 6px; background: rgba(0,242,254,0.1); border: 1px solid rgba(0,242,254,0.3); border-radius: 20px; padding: 4px 10px;">
              <span id="ai-pulse-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #00f2fe; box-shadow: 0 0 8px #00f2fe; animation: pulse-flash 0.8s infinite alternate;"></span>
              <span style="font-size: 11px; font-weight: 800; color: var(--accent-teal);" id="ai-log-step-percent">0%</span>
            </div>
            <button type="button" id="btn-close-ai-status-x" style="background: none; border: none; font-size: 22px; line-height: 1; color: var(--text-secondary); cursor: pointer; padding: 0 4px; transition: color 0.2s;" title="ปิดและดำเนินการต่อ">&times;</button>
          </div>
        </div>

        <!-- Body -->
        <div style="overflow-y: auto; flex: 1; padding-right: 2px;">
          <!-- Progress Bar -->
          <div style="margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;">
              <span id="ai-current-activity" style="color: var(--text-primary); font-weight: 600;">🔍 เริ่มต้นระบบ AI Scheduling...</span>
              <span id="ai-step-indicator" style="color: var(--accent-teal); font-weight: 700;">Step 1/6</span>
            </div>
            <div style="height: 7px; background: rgba(255,255,255,0.06); border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
              <div id="ai-progress-bar-fill" style="height: 100%; width: 0%; background: linear-gradient(90deg, #00f2fe, #4facfe, #00c6ff); border-radius: 6px; transition: width 0.25s ease; box-shadow: 0 0 10px #00f2fe;"></div>
            </div>
          </div>

          <!-- Terminal Status Log Console -->
          <div style="margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 10.5px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 5px;">
                <span>📋</span> What is AI doing? (AI กำลังทำอะไร)
              </span>
              <span style="font-size: 9.5px; color: var(--text-secondary); font-family: monospace;">FINITE CAPACITY ENGINE</span>
            </div>
            <div id="ai-terminal-log-box" style="background: rgba(10, 15, 29, 0.95); border: 1px solid rgba(0, 242, 254, 0.2); border-radius: 8px; padding: 12px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 11px; line-height: 1.65; height: 185px; overflow-y: auto; color: #cbd5e1; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);">
              <!-- Dynamic logs -->
            </div>
          </div>

          <!-- Parameters Overview -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 8px; text-align: center;">
              <div style="font-size: 9px; color: var(--text-secondary);">ใบสั่งผลิตที่เลือก</div>
              <div style="font-size: 12px; font-weight: 800; color: var(--accent-teal); margin-top: 2px;">${selectedWOIds.length} ใบงาน (${totalBacklogOps} ขั้นตอน)</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 8px; text-align: center;">
              <div style="font-size: 9px; color: var(--text-secondary);">โหมดการจัดตาราง</div>
              <div style="font-size: 11px; font-weight: 800; color: var(--accent-green); margin-top: 2px;">SIMULATION PLACEMENT</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 8px; text-align: center;">
              <div style="font-size: 9px; color: var(--text-secondary);">โมเดลการคำนวณ</div>
              <div style="font-size: 11px; font-weight: 800; color: var(--accent-purple, #a855f7); margin-top: 2px;">Finite Capacity</div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-glass); padding-top: 14px; margin-top: 14px;">
          <div id="ai-status-footer-note" style="font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
            <span id="ai-status-footer-icon" style="display: inline-block; animation: spin 1.5s linear infinite;">⏳</span>
            <span id="ai-status-footer-text">กำลังประมวลผล... กรุณารอสักครู่</span>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <button type="button" class="btn btn-secondary" id="btn-cancel-ai-status" style="padding: 7px 14px; font-size: 11px; border-radius: 6px; cursor: pointer; background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass); color: var(--text-secondary);">
              ยกเลิก (Cancel)
            </button>
            <button type="button" class="btn btn-glowing" id="btn-proceed-ai-status" style="padding: 7px 18px; font-size: 11px; border-radius: 6px; cursor: pointer; background: linear-gradient(135deg, var(--accent-teal), #0284c7); border: none; color: #fff; font-weight: bold; box-shadow: var(--shadow-neon); display: flex; align-items: center; gap: 6px; transition: all 0.2s;">
              <span>ปิด / ดำเนินการต่อ ➔</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(statusModal);

    const logBox = statusModal.querySelector('#ai-terminal-log-box');
    const progressBar = statusModal.querySelector('#ai-progress-bar-fill');
    const percentEl = statusModal.querySelector('#ai-log-step-percent');
    const activityEl = statusModal.querySelector('#ai-current-activity');
    const stepEl = statusModal.querySelector('#ai-step-indicator');
    const footerIcon = statusModal.querySelector('#ai-status-footer-icon');
    const footerText = statusModal.querySelector('#ai-status-footer-text');
    const pulseDot = statusModal.querySelector('#ai-pulse-dot');
    const proceedBtn = statusModal.querySelector('#btn-proceed-ai-status');
    const closeXBtn = statusModal.querySelector('#btn-close-ai-status-x');
    const cancelBtn = statusModal.querySelector('#btn-cancel-ai-status');

    // Detect offloaded jobs (routed to helper / alternate machines)
    const offloadedJobs = optimized.filter(j => {
      return j.isOffloaded || (j.originalMachine && j.machine && j.originalMachine !== j.machine);
    });

    const nowStr = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const logEvents = [
      {
        delay: 100,
        pct: 15,
        step: 'Step 1/6',
        activity: '🔍 อ่านข้อมูลใบสั่งผลิตและ Routing Steps...',
        msg: '<span style="color:#38bdf8;">[INIT]</span> กำลังโหลด Work Orders ที่เลือก ' + selectedWOIds.length + ' รายการ (รวม ' + totalBacklogOps + ' Operation Steps)'
      },
      {
        delay: 450,
        pct: 35,
        step: 'Step 2/6',
        activity: '🔒 ตรวจสอบโครงการที่ถูกล็อค & ขีดความสามารถเครื่องจักร...',
        msg: '<span style="color:#a855f7;">[CONSTRAINTS]</span> สแกน ' + workCenterCount + ' Work Centers | ล็อคโครงการไว้ ' + lockedCount + ' โครงการ (คงเดิมไม่เคลื่อนย้าย)'
      },
      {
        delay: 850,
        pct: 55,
        step: 'Step 3/6',
        activity: '⚖️ วิเคราะห์ระดับความสำคัญ (Priority Tiers) และลำดับเวลา...',
        msg: '<span style="color:#fbbf24;">[PRIORITY]</span> เรียงลำดับงานตาม Priority Weight และเริ่มคำนวณต่อจากวันเวลาปัจจุบัน (' + nowStr + ')'
      },
      {
        delay: 1250,
        pct: 75,
        step: 'Step 4/6',
        activity: '⚙️ คำนวณตารางผลิตแบบ Finite Capacity และแก้ปัญหา Sequence...',
        msg: '<span style="color:#34d399;">[DISPATCH]</span> กำหนดช่วงเวลาทำงานบนเครื่องจักร ป้องกันการซ้อนทับ (0 Overlap) และรักษาระเบียบขั้นตอน (10 ➔ 20 ➔ 30)'
      },
      {
        delay: 1650,
        pct: 90,
        step: 'Step 5/6',
        activity: '⚡ ปรับสมดุลโหลดเครื่องจักร (Machine Leveling) & ดึงเครื่องช่วย...',
        msg: offloadedJobs.length > 0
          ? `<span style="color:#c084fc; font-weight:bold;">[OFFLOAD]</span> ดึงเครื่องจักรช่วย ${offloadedJobs.length} งาน: ` + offloadedJobs.map(j => `${j.woId || j.id} [${j.stepName || 'Step ' + j.stepNum}] ➔ ${state.getMachineDisplayName(j.machine)}`).join(', ')
          : '<span style="color:#f472b6;">[OPTIMIZE]</span> ปรับสมดุลโหลดเครื่องจักร Lasercut, Bending, CNC, Welding, Assembly, QC (เครื่องหลักรับได้พอดี)'
      },
      {
        delay: 2050,
        pct: 100,
        step: 'Step 6/6',
        activity: '✅ ประมวลผลเสร็จสมบูรณ์! พร้อมแสดงรายงาน...',
        msg: '<span style="color:#22c55e; font-weight:bold;">[SUCCESS]</span> จัดแผนงานเสร็จสมบูรณ์ ' + optimized.length + ' งาน (Makespan พร้อมแสดงผล)'
      }
    ];

    const timerIds = [];

    // Stream logs
    logEvents.forEach((item, index) => {
      const tId = setTimeout(() => {
        if (!statusModal.parentNode) return;
        progressBar.style.width = `${item.pct}%`;
        percentEl.textContent = `${item.pct}%`;
        activityEl.textContent = item.activity;
        stepEl.textContent = item.step;

        const timeStr = new Date().toLocaleTimeString('en-GB');
        const line = document.createElement('div');
        line.style.marginBottom = '4px';
        line.innerHTML = `<span style="color: #64748b; margin-right: 6px;">[${timeStr}]</span> ${item.msg}`;
        logBox.appendChild(line);
        logBox.scrollTop = logBox.scrollHeight;

        // When reached final step (100%), update footer and wait for user to click close/proceed
        if (index === logEvents.length - 1) {
          if (footerIcon) {
            footerIcon.style.animation = 'none';
            footerIcon.textContent = '✅';
          }
          if (footerText) {
            footerText.innerHTML = '<span style="color: var(--accent-green); font-weight: 600;">AI Engine ประมวลผลเสร็จสมบูรณ์แล้ว — กดปิดเพื่อดูผลลัพธ์และยืนยันแผน</span>';
          }
          if (pulseDot) {
            pulseDot.style.animation = 'none';
            pulseDot.style.background = '#22c55e';
            pulseDot.style.boxShadow = '0 0 8px #22c55e';
          }
          if (proceedBtn) {
            proceedBtn.innerHTML = '<span>ปิดและดำเนินการต่อ (Proceed) ➔</span>';
            proceedBtn.style.boxShadow = '0 0 20px rgba(0, 242, 254, 0.6)';
          }
        }
      }, item.delay);
      timerIds.push(tId);
    });

    // Handler to proceed to Result Modal
    const proceedToResult = () => {
      timerIds.forEach(t => clearTimeout(t));
      statusModal.remove();
      button.disabled = false;

      const applySchedule = (updateTargets = false) => {
        // Auto-register mock nested structures if AI built a Laser Nest
        optimized.forEach(job => {
          if (job.isNest && !state.nests[job.id]) {
            state.nests[job.id] = {
              id: job.id,
              name: `Laser Nest ${job.id.split('-')[1]}`,
              jobIds: ['PD0000303', 'PD0000304'],
              jobs: [
                { id: 'PD0000303', customer: 'Caterpillar', partName: 'Hydraulic Plate A', qty: 100, estHours: 2.0, priority: 'Normal' },
                { id: 'PD0000304', customer: 'John Deere', partName: 'Fender Plate B', qty: 120, estHours: 2.0, priority: 'Normal' }
              ],
              estHours: job.estHours,
              machine: 'Lasercut',
              startHour: job.startHour,
              status: 'Scheduled',
              elapsedMinutes: 0
            };
          }
        });

        // 1. Build fast lookup sets O(1)
        const scheduledWoIds = new Set();
        const nestedWoIds = new Set();
        optimized.forEach(o => {
          if (o.woId) scheduledWoIds.add(o.woId);
          scheduledWoIds.add(o.id);
          if (o.isNest && state.nests[o.id]?.jobIds) {
            state.nests[o.id].jobIds.forEach(id => nestedWoIds.add(id));
          }
        });
        const selectedWOSet = new Set(selectedWOIds);

        // Remove jobs from backlog that are now scheduled (only if they were selected!)
        state.workOrders = state.workOrders.filter(wo => {
          if (!selectedWOSet.has(wo.id)) return true;
          return !(scheduledWoIds.has(wo.id) || nestedWoIds.has(wo.id));
        });

        // If updateTargets is true, update dueHour of late jobs (only those originally on board)
        if (updateTargets && lateJobsOnBoard.length > 0) {
          const lateTargetMap = new Map();
          lateJobsOnBoard.forEach(job => {
            const finish = job.startHour + job.estHours;
            const targetWOId = job.woId || job.id;
            
            const dFinish = state.workingHourToDate(finish);
            const nextDay = new Date(dFinish.getFullYear(), dFinish.getMonth(), dFinish.getDate() + 1, 17, 0, 0);
            const newDueHour = state.dateToWorkingHour(nextDay);
            lateTargetMap.set(targetWOId, newDueHour);
          });

          // 1. Update in backlog workOrders
          state.workOrders.forEach(wo => {
            if (lateTargetMap.has(wo.id)) {
              if (wo.originalDueHour === undefined) {
                wo.originalDueHour = wo.dueHour;
              }
              wo.dueHour = lateTargetMap.get(wo.id);
            }
          });
          
          // 2. Update in optimized array directly so it is not overwritten!
          optimized.forEach(oj => {
            const tId = oj.woId || oj.id;
            if (lateTargetMap.has(tId)) {
              if (oj.originalDueHour === undefined) {
                oj.originalDueHour = oj.dueHour;
              }
              oj.dueHour = lateTargetMap.get(tId);
            }
          });
        }

        state.saveStateToHistory();
        state.scheduledJobs = optimized;
        
        // Force change model selector UI to Finite (since AI uses finite parameters)
        const modelSelect = document.getElementById('model-select');
        if (modelSelect) {
          modelSelect.value = 'finite';
          state.schedulingModel = 'finite';
        }

        // Adjust Gantt chart view to Fit all optimized tasks WITHOUT recomputing finite schedule
        if (this.gantt && optimized.length > 0) {
          this.gantt.fitTasks(optimized, false); // shouldRecompute = false
        }

        // Save plan to file so the new start dates and assignments persist!
        state.savePlanToFile();
        state.saveWorkOrdersToFile();

        state.notify();
      };

      this.showAIResultModal(optimized, lateJobsOnBoard, applySchedule, {
        selectedWOIds,
        selectedWOCount: selectedWOIds.length,
        totalOps: totalBacklogOps,
        lockedCount,
        offloadedJobs
      });
    };

    // Handler to cancel
    const cancelAIStatus = () => {
      timerIds.forEach(t => clearTimeout(t));
      statusModal.remove();
      button.disabled = false;
    };

    if (proceedBtn) proceedBtn.addEventListener('click', proceedToResult);
    if (closeXBtn) closeXBtn.addEventListener('click', proceedToResult);
    if (cancelBtn) cancelBtn.addEventListener('click', cancelAIStatus);
  }

  showAIResultModal(optimized, lateJobsOnBoard, applySchedule, aiContext = {}) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.zIndex = '300';

    let minStartHour = 0;
    let maxFinishHour = 0;

    if (aiContext.selectedWOIds && aiContext.selectedWOIds.length > 0) {
      const newJobs = optimized.filter(j => aiContext.selectedWOIds.includes(j.woId || j.id));
      console.log('[AI Auto Result] newJobs count:', newJobs.length);
      if (newJobs.length > 0) {
        minStartHour = Math.min(...newJobs.map(j => j.startHour));
        maxFinishHour = Math.max(...newJobs.map(j => j.startHour + j.estHours));
      }
    } else if (optimized.length > 0) {
      minStartHour = Math.min(...optimized.map(j => j.startHour));
      maxFinishHour = Math.max(...optimized.map(j => j.startHour + j.estHours));
    }

    console.log('[AI Auto Result] minStartHour:', minStartHour, 'maxFinishHour:', maxFinishHour);
    const dStart = state.workingHourToDate(minStartHour);
    const startDateStr = dStart.toLocaleDateString('en-GB') + ' ' + dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' น.';

    const dFinish = state.workingHourToDate(maxFinishHour);
    const finishDateStr = dFinish.toLocaleDateString('en-GB') + ' ' + dFinish.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' น.';

    const resultHTML = `
      <div style="background: rgba(0, 242, 254, 0.05); border: 1px solid var(--accent-teal); border-radius: 8px; padding: 14px; margin-bottom: 12px; text-align: center;">
        <div style="font-size: 15px; font-weight: bold; color: var(--accent-teal); margin-bottom: 10px;">🚀 จัดแผนงานอัตโนมัติ (Multi-PD Simulation Placement) สำเร็จ</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06); text-align: center;">
          <div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 2px;">📅 กำหนดเริ่มผลิต (Start Time):</div>
            <div style="font-size: 13.5px; font-weight: bold; color: var(--accent-teal); font-family: monospace;">${startDateStr}</div>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 2px;">🏁 กำหนดสิ้นสุด (Makespan):</div>
            <div style="font-size: 13.5px; font-weight: bold; color: var(--accent-green); font-family: monospace;">${finishDateStr}</div>
          </div>
        </div>
      </div>
    `;

    let warningHTML = '';
    if (lateJobsOnBoard.length > 0) {
      const uniqueLateWOs = [];
      const seenWO = new Set();
      lateJobsOnBoard.forEach(job => {
        if (job.woId && !seenWO.has(job.woId)) {
          seenWO.add(job.woId);
          uniqueLateWOs.push(job);
        }
      });

      const rowsHTML = uniqueLateWOs.map(job => {
        const woId = job.woId || job.id;
        const due = state.getScaledDueHour(job);
        const finish = job.startHour + job.estHours;
        const delay = Math.ceil((finish - due) / 9);
        return `
          <div style="display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; border-bottom: 1px dashed rgba(255,255,255,0.05);">
            <span style="color: var(--accent-red); font-weight: bold;">${woId}</span>
            <span style="color: var(--text-primary); font-family: monospace;">ล่าช้า ${delay} วัน</span>
          </div>
        `;
      }).join('');

      warningHTML = `
        <div style="background: rgba(255, 51, 51, 0.05); border: 1px solid var(--accent-red); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
          <div style="font-weight: bold; font-size: 11px; color: var(--accent-red); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
            <span>⚠️</span> คำเตือน: มีใบสั่งผลิต ${uniqueLateWOs.length} รายการที่ล่าช้ากว่าเป้าหมาย
          </div>
          <div style="max-height: 90px; overflow-y: auto;">
            ${rowsHTML}
          </div>
        </div>
      `;
    }

    // Offloaded (Alternate Machines) details
    const offloadedJobs = aiContext.offloadedJobs || [];
    let offloadSectionHTML = '';
    if (offloadedJobs.length > 0) {
      const offloadRows = offloadedJobs.map(j => {
        const dStart = state.workingHourToDate(j.startHour);
        const dEnd = state.workingHourToDate(j.startHour + j.estHours);
        const startStr = `${dStart.getDate()}/${dStart.getMonth() + 1}/${String(dStart.getFullYear()).slice(-2)} ${String(dStart.getHours()).padStart(2, '0')}:${String(dStart.getMinutes()).padStart(2, '0')}`;
        const endStr = `${dEnd.getDate()}/${dEnd.getMonth() + 1}/${String(dEnd.getFullYear()).slice(-2)} ${String(dEnd.getHours()).padStart(2, '0')}:${String(dEnd.getMinutes()).padStart(2, '0')}`;
        const origName = state.getMachineDisplayName(j.originalMachine);
        const helperName = state.getMachineDisplayName(j.machine);
        const woTitle = `${j.woId || j.id} ${j.partName ? '- ' + j.partName : ''} (Step ${j.stepNum || 10}: ${j.stepName || ''})`;

        return `
          <div style="background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; color: #fff; font-size: 11px;">${woTitle}</span>
              <span style="font-size: 10px; color: var(--accent-green); font-weight: 700; background: rgba(34, 197, 94, 0.15); padding: 1px 6px; border-radius: 3px; border: 1px solid rgba(34, 197, 94, 0.3);">${j.estHours} ชม.</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; font-size: 10.5px; margin-bottom: 4px;">
              <span style="color: var(--accent-red); background: rgba(239, 68, 68, 0.12); padding: 1px 6px; border-radius: 3px; border: 1px solid rgba(239, 68, 68, 0.3);">
                เครื่องหลัก: ${origName}
              </span>
              <span style="color: var(--text-secondary); font-weight: bold;">➔</span>
              <span style="color: #c084fc; font-weight: 700; background: rgba(168, 85, 247, 0.2); padding: 1px 6px; border-radius: 3px; border: 1px solid rgba(168, 85, 247, 0.4);">
                เครื่องจักรช่วย: ${helperName}
              </span>
            </div>
            <div style="font-size: 10px; color: var(--accent-teal); display: flex; align-items: center; gap: 4px; background: rgba(0, 242, 254, 0.05); padding: 3px 6px; border-radius: 4px;">
              <span>⏱️</span> <strong>เวลาที่ดึงไปช่วย:</strong> <span>${startStr} ถึง ${endStr} น.</span>
            </div>
          </div>
        `;
      }).join('');

      offloadSectionHTML = `
        <div style="background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
          <div style="font-weight: 800; font-size: 11.5px; color: var(--accent-purple, #c084fc); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <span style="display: flex; align-items: center; gap: 5px;">
              <span>🔀</span> การกระจายโหลดไปเครื่องจักรช่วย (${offloadedJobs.length} รายการ)
            </span>
            <span style="font-size: 9.5px; background: rgba(168, 85, 247, 0.25); color: #e9d5ff; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(168, 85, 247, 0.5);">
              Auto Offload Active
            </span>
          </div>
          <div style="max-height: 140px; overflow-y: auto;">
            ${offloadRows}
          </div>
        </div>
      `;
    } else {
      offloadSectionHTML = `
        <div style="background: rgba(34, 197, 94, 0.04); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 10.5px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
          <span>✅</span> <strong>การกระจายโหลด:</strong> เครื่องจักรหลักสามารถรองรับงานได้สมบูรณ์ ไม่จำเป็นต้องดึงเครื่องช่วย
        </div>
      `;
    }

    // Machine Hours breakdown
    const machineHours = {};
    optimized.forEach(j => {
      const m = j.machine || 'General';
      const est = (typeof j.estHours === 'number' && j.estHours > 0) ? j.estHours : 1.0;
      machineHours[m] = (machineHours[m] || 0) + est;
    });

    const machineListHTML = Object.entries(machineHours).map(([m, hrs]) => `
      <div style="display: flex; justify-content: space-between; font-size: 10.5px; padding: 2px 0;">
        <span style="color: var(--text-secondary);">${state.getMachineDisplayName(m)}:</span>
        <span style="font-weight: 700; color: var(--accent-teal);">${hrs.toFixed(1)} ชม.</span>
      </div>
    `).join('');

    modal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 540px; width: 92%; max-height: 90vh; display: flex; flex-direction: column;">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 10px;">
          <h3 style="color: var(--accent-teal); margin: 0; display: flex; align-items: center; gap: 8px; font-size: 16px;">
            <span>🤖</span> รายงานผลการจัดแผนงาน AI (APS Result)
          </h3>
        </div>
        <div class="modal-body" style="padding: 12px 0; overflow-y: auto; flex: 1;">
          ${resultHTML}
          ${warningHTML}
          ${offloadSectionHTML}

          <!-- AI What was done Breakdown Accordion -->
          <details open style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-glass); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
            <summary style="font-size: 11.5px; font-weight: 700; color: var(--accent-teal); cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px;">
              <span>💡</span> สิ่งที่ AI ได้ดำเนินการ (What AI did & Decisions)
            </summary>
            <div style="margin-top: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.6; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 8px;">
              <div style="margin-bottom: 4px;">• <strong>จำนวนงานทั้งหมด:</strong> จัดคิวงานลงกระดานสำเร็จ <span style="color: var(--text-primary); font-weight:bold;">${optimized.length} งาน</span> (จากที่เลือก ${aiContext.selectedWOCount || 0} ใบงาน)</div>
              <div style="margin-bottom: 4px;">• <strong>Finite Capacity:</strong> ป้องกันการชนกันของคิวงานบนเครื่องจักรเดียวกัน (Zero Machine Conflicts)</div>
              <div style="margin-bottom: 4px;">• <strong>Routing Sequence:</strong> ควบคุมลำดับขั้นตอนการผลิต (Step 10 ➔ 20 ➔ 30) ให้ต่อเนื่องสมบูรณ์</div>
              <div style="margin-bottom: 6px;">• <strong>Locked Projects:</strong> คงสภาพโครงการที่ถูกล็อค ${aiContext.lockedCount || 0} โครงการ ป้องกันการเลื่อนหลุดแผน</div>
              
              <div style="margin-top: 8px; background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="font-weight: bold; font-size: 10px; color: var(--text-primary); margin-bottom: 4px; text-transform: uppercase;">
                  ภาระงานบนเครื่องจักร (Workload Distribution):
                </div>
                ${machineListHTML}
              </div>
            </div>
          </details>

          <div style="font-size: 11px; color: var(--text-secondary); text-align: center; margin-top: 2px;">
            คุณต้องการบันทึกแผนงานนี้ลงในตารางหลักหรือไม่?
          </div>
        </div>
        <div class="modal-footer" style="display: flex; gap: 10px; border-top: 1px solid var(--border-glass); padding-top: 12px;">
          <button class="btn btn-secondary" id="btn-cancel-apply-ai" style="flex: 1; justify-content: center; background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 8px; cursor: pointer;">
            ยกเลิก (Cancel)
          </button>
          <button class="btn btn-glowing" id="btn-confirm-apply-ai" style="flex: 1.5; justify-content: center; padding: 8px; cursor: pointer;">
            ยืนยันบันทึกแผน (Apply Plan)
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#btn-cancel-apply-ai').addEventListener('click', () => {
      modal.remove();
    });

    modal.querySelector('#btn-confirm-apply-ai').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '⏳ กำลังบันทึกแผน...';
      btn.style.opacity = '0.7';

      setTimeout(() => {
        modal.remove();
        // 1. Apply schedule to board immediately
        try {
          applySchedule(lateJobsOnBoard.length > 0);
        } catch (err) {
          console.error('Error applying AI schedule:', err);
        }
      }, 30);
    });
  }

  setLeftSidebarAssemblyMode(isAssembly) {
    const backlogHeaderTitle = document.getElementById('backlog-header-title');
    const btnAddPd = document.getElementById('btn-add-pd');
    const btnImportExcel = document.getElementById('btn-import-excel');
    const btnViewCompletedPd = document.getElementById('btn-view-completed-pd');
    const sidebarFooter = document.querySelector('.sidebar-left .sidebar-footer');
    const backlogTabContent = document.getElementById('backlog-tab-content');
    const assemblyListTabContent = document.getElementById('assembly-list-tab-content');
    const assemblyTreeSidebarTab = document.getElementById('assembly-tree-sidebar-tab');
    const mainLayout = document.querySelector('.main-layout');

    if (isAssembly) {
      if (backlogHeaderTitle) backlogHeaderTitle.textContent = '🌿 โครงสร้างชุดประกอบ (TREE)';
      if (btnAddPd) btnAddPd.style.display = 'none';
      if (btnImportExcel) btnImportExcel.style.display = 'none';
      if (btnViewCompletedPd) btnViewCompletedPd.style.display = 'none';
      if (sidebarFooter) sidebarFooter.style.display = 'none';
      if (backlogTabContent) {
        backlogTabContent.classList.add('hidden');
        backlogTabContent.style.display = 'none';
      }
      if (assemblyListTabContent) {
        assemblyListTabContent.classList.add('hidden');
        assemblyListTabContent.style.display = 'none';
      }
      if (assemblyTreeSidebarTab) {
        assemblyTreeSidebarTab.classList.remove('hidden');
        assemblyTreeSidebarTab.style.display = 'flex';
      }
      // Ensure left sidebar is expanded so user sees the tree view immediately
      if (mainLayout && mainLayout.classList.contains('hide-backlog')) {
        mainLayout.classList.remove('hide-backlog');
      }
    } else {
      if (assemblyTreeSidebarTab) {
        assemblyTreeSidebarTab.classList.add('hidden');
        assemblyTreeSidebarTab.style.display = 'none';
      }
      if (sidebarFooter) sidebarFooter.style.display = '';
      if (typeof this.applyLeftSidebarMode === 'function') {
        this.applyLeftSidebarMode();
      } else {
        if (backlogHeaderTitle) backlogHeaderTitle.textContent = `PD BACKLOG (${state.workOrders.length})`;
        if (btnAddPd) btnAddPd.style.display = '';
        if (btnImportExcel) btnImportExcel.style.display = '';
        if (btnViewCompletedPd) btnViewCompletedPd.style.display = '';
        if (backlogTabContent) {
          backlogTabContent.classList.remove('hidden');
          backlogTabContent.style.display = 'flex';
        }
      }
    }
  }

  renderAll() {
    this.workflow.render();
    
    if (state.ganttMode === 'assembly') {
      if (this.assemblyTree) this.assemblyTree.show();
      this.setLeftSidebarAssemblyMode(true);
    } else {
      if (this.assemblyTree) this.assemblyTree.hide();
      this.setLeftSidebarAssemblyMode(false);
      this.gantt.render();
    }

    this.resources.render();
    this.kiosk.render();
    
    const checkShowAllWc = document.getElementById('check-show-all-wc');
    if (checkShowAllWc) {
      checkShowAllWc.checked = state.showAllWorkCenters;
    }
    
    // Sync scale buttons in UI
    const scaleButtons = document.querySelectorAll('.scale-btn');
    scaleButtons.forEach(btn => {
      if (btn.getAttribute('data-scale') === state.activeScale) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Sync mode buttons in UI
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach(btn => {
      if (btn.getAttribute('data-mode') === state.ganttMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Sync Production Order List button visibility (only in PD view)
    const btnPdOrderList = document.getElementById('btn-pd-order-list');
    if (btnPdOrderList) {
      if (state.ganttMode === 'pd') {
        btnPdOrderList.style.display = 'inline-flex';
        btnPdOrderList.classList.remove('hidden');
      } else {
        btnPdOrderList.style.display = 'none';
        btnPdOrderList.classList.add('hidden');
      }
    }

    this.renderKPIs();
  }

  renderKPIs() {
    // 1. On-Time Delivery calculation
    // Count active delays or late jobs
    const delayedCount = state.scheduledJobs.filter(j => j.status === 'Paused' || j.delayReason).length;
    const otd = Math.max(70, 96 - (delayedCount * 8));
    document.getElementById('metric-otd').textContent = `${otd}%`;
    document.getElementById('metric-otd').className = otd > 85 ? 'metric-value text-green' : 'metric-value text-orange';

    // 2. Average Shop OEE calculation
    const machineList = Object.keys(state.workCenters);
    const avgOee = Math.round(
      machineList.reduce((sum, mach) => sum + state.getMachineOEE(mach).oee, 0) / machineList.length
    );
    document.getElementById('metric-oee').textContent = `${avgOee}%`;
    document.getElementById('metric-oee').className = avgOee > 75 ? 'metric-value text-cyan' : 'metric-value text-orange';

    // 3. Active / Total count
    const runningCount = state.scheduledJobs.filter(j => j.status === 'Running').length;
    const totalCount = state.scheduledJobs.length;
    document.getElementById('metric-jobs-count').textContent = `${runningCount} / ${totalCount}`;

    // 4. Calculate unique late Work Orders
    const lateWOIds = new Set();
    state.scheduledJobs.forEach(job => {
      if (job.woId) {
        const lastStepNum = state.getLastStepNum(job.woId);
        if (job.stepNum === lastStepNum) {
          const scaledDueHour = state.getScaledDueHour(job);
          if (scaledDueHour !== null && (job.startHour + job.estHours) > scaledDueHour) {
            lateWOIds.add(job.woId);
          }
        }
      }
    });

    const lateCountEl = document.getElementById('metric-late-count');
    if (lateCountEl) {
      lateCountEl.textContent = lateWOIds.size;
      const cardEl = document.getElementById('btn-show-late-pds');
      if (cardEl) {
        if (lateWOIds.size > 0) {
          cardEl.style.borderColor = 'var(--accent-red)';
          cardEl.style.boxShadow = '0 0 12px rgba(255, 51, 51, 0.25)';
          cardEl.style.background = 'rgba(255, 51, 51, 0.03)';
        } else {
          cardEl.style.borderColor = '';
          cardEl.style.boxShadow = '';
          cardEl.style.background = '';
        }
      }
    }
  }

  showLateWOsListModal() {
    const lateWOs = [];
    const seen = new Set();

    state.scheduledJobs.forEach(job => {
      if (job.woId && !seen.has(job.woId)) {
        const lastStepNum = state.getLastStepNum(job.woId);
        if (job.stepNum === lastStepNum) {
          const scaledDueHour = state.getScaledDueHour(job);
          const finish = job.startHour + job.estHours;
          if (scaledDueHour !== null && finish > scaledDueHour) {
            seen.add(job.woId);
            lateWOs.push({ job, finish, due: scaledDueHour });
          }
        }
      }
    });

    if (lateWOs.length === 0) {
      alert("ยินดีด้วย! ไม่มีใบสั่งผลิตใดที่เสร็จล่าช้ากว่าเป้าหมายในขณะนี้");
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.zIndex = '300';

    const rowsHTML = lateWOs.map(({ job, finish, due }) => {
      const woId = job.woId || job.id;
      const delay = Math.ceil((finish - due) / 9);
      
      const dFinish = state.workingHourToDate(finish);
      const finishStr = dFinish.toLocaleDateString('en-GB') + ' ' + dFinish.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      
      const dDue = state.workingHourToDate(due);
      const dueStr = dDue.toLocaleDateString('en-GB');

      return `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: 6px; padding: 12px; margin-bottom: 8px; font-size: 11px;">
          <div style="display:flex; justify-content:space-between; margin-bottom: 4px; align-items: center;">
            <strong style="color: var(--accent-red); font-size:12px;">${woId}</strong>
            <span style="background: rgba(255, 51, 51, 0.15); color: var(--accent-red); font-weight:bold; padding: 2px 6px; border-radius: 4px;">ช้ากว่าแผน ${delay} วัน</span>
          </div>
          <div style="color: var(--text-primary); margin-bottom: 4px;">ชิ้นส่วน: <strong>${job.partName}</strong></div>
          <div style="color: var(--text-secondary); margin-bottom: 6px;">ลูกค้า: ${job.customer} | สถานีผลิตขั้นตอนสุดท้าย: ${job.machine}</div>
          
          <div style="display:flex; justify-content:space-between; border-top: 1px dashed rgba(255,255,255,0.05); padding-top:6px; margin-top:6px; align-items: center;">
            <div style="display:flex; flex-direction:column; gap: 2px;">
              <span>เป้าหมายเดิม (Target): <strong style="color: var(--text-primary);">${dueStr}</strong></span>
              <span>เสร็จจริงตามแผน (Finish): <strong style="color: var(--accent-orange);">${finishStr}</strong></span>
            </div>
            <button class="btn-action-small btn-update-single-target" data-wo-id="${woId}" data-finish="${finish}" style="background: rgba(0, 242, 254, 0.1); border: 1px solid var(--accent-teal); color: var(--accent-teal); padding: 4px 8px; border-radius: 4px; font-size: 9px; cursor: pointer; transition: all 0.2s;">
              ขยายเป้าเป็นวันถัดไป
            </button>
          </div>
        </div>
      `;
    }).join('');

    const maxDelay = Math.max(...lateWOs.map(({ finish, due }) => Math.ceil((finish - due) / 9)));

    let maxOverallFinishHour = 0;
    let minOverallStartHour = Infinity;
    state.scheduledJobs.forEach(job => {
      const finish = job.startHour + job.estHours;
      if (finish > maxOverallFinishHour) maxOverallFinishHour = finish;
      if (job.startHour < minOverallStartHour) minOverallStartHour = job.startHour;
    });
    if (minOverallStartHour === Infinity) minOverallStartHour = 0.0;

    const dFinishAll = state.workingHourToDate(maxOverallFinishHour);
    const dateAllStr = dFinishAll.toLocaleDateString('en-GB') + ' ' + dFinishAll.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const totalWorkingHours = maxOverallFinishHour - minOverallStartHour;
    const prodDays = Math.ceil(totalWorkingHours / 9);

    modal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 520px; width: 90%;">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 10px;">
          <h3 style="color: var(--accent-red); margin: 0; display: flex; align-items: center; gap: 8px;">
            <span>⚠️</span> ใบสั่งผลิตที่ล่าช้ากว่าเป้าหมาย (${lateWOs.length} รายการ)
          </h3>
        </div>
        <div class="modal-body" style="max-height: 400px; overflow-y: auto; padding: 15px 5px 15px 0;">
          <div style="font-size: 13px; font-weight: bold; color: var(--accent-orange); margin-bottom: 12px; border-bottom: 1px dashed var(--border-glass); padding-bottom: 8px; display: flex; flex-direction: column; gap: 4px;">
            <div>⚠️ ล่าช้ากว่าเป้าหมายมากสุด: <span style="color: var(--accent-red); font-size: 15px;">${maxDelay}</span> วัน</div>
            <div style="font-size: 11px; color: var(--accent-teal); font-weight: normal; margin-top: 2px;">
              📅 งานทั้งหมดจะเสร็จวันที่ <strong style="color: var(--text-primary); font-size: 12px;">${dateAllStr} น.</strong> &nbsp;•&nbsp; ใช้เวลาในการผลิต <strong style="color: var(--text-primary); font-size: 12px;">${prodDays}</strong> วัน
            </div>
          </div>
          <div class="late-wos-list">
            ${rowsHTML}
          </div>
        </div>
        <div class="modal-footer" style="border-top: 1px solid var(--border-glass); padding-top: 12px; margin-top: 5px; display:flex; justify-content: space-between; align-items: center;">
          <button class="btn" id="btn-extend-all-targets" style="background: rgba(0, 242, 254, 0.15); border: 1px solid var(--accent-teal); color: var(--text-primary); padding: 8px 16px; font-size: 11px; font-weight: bold; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
            ขยายเป้าหมายทั้งหมด
          </button>
          <button class="btn btn-secondary" id="btn-close-late-modal" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 8px 16px;">
            ปิด (Close)
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#btn-close-late-modal').addEventListener('click', () => {
      modal.remove();
    });

    const btnExtendAll = modal.querySelector('#btn-extend-all-targets');
    if (btnExtendAll) {
      btnExtendAll.addEventListener('click', () => {
        lateWOs.forEach(({ job, finish }) => {
          const woId = job.woId || job.id;
          const dFinish = state.workingHourToDate(finish);
          const nextDay = new Date(dFinish.getFullYear(), dFinish.getMonth(), dFinish.getDate() + 1, 17, 0, 0);
          const newDueHour = state.dateToWorkingHour(nextDay);
          state.updateWorkOrderDueHour(woId, newDueHour);
        });
        modal.remove();
        this.showLateWOsListModal();
      });
    }

    // Bind event listeners for single target update buttons
    modal.querySelectorAll('.btn-update-single-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const woId = e.currentTarget.getAttribute('data-wo-id');
        const finishVal = parseFloat(e.currentTarget.getAttribute('data-finish'));
        
        // Calculate next day at 17:00
        const dFinish = state.workingHourToDate(finishVal);
        const nextDay = new Date(dFinish.getFullYear(), dFinish.getMonth(), dFinish.getDate() + 1, 17, 0, 0);
        const newDueHour = state.dateToWorkingHour(nextDay);

        state.updateWorkOrderDueHour(woId, newDueHour);
        
        // Remove the row from modal or close and reopen
        modal.remove();
        // Reopen to show updated list!
        this.showLateWOsListModal();
      });
    });
  }

  showProductionOrderListModal() {
    // 1. Filter scheduledJobs according to current Board filters
    const scheduledJobs = (state.scheduledJobs || []).filter(job => {
      return isJobPriorityVisible(job, state) && 
             isJobProjectVisible(job, state) && 
             isJobCustomerVisible(job, state) && 
             isJobPdRangeVisible(job, state) && 
             state.activeWorkCenters[job.machine] !== false;
    });

    // 2. Group by Production Order ID (woId)
    const pdMap = new Map();
    scheduledJobs.forEach(job => {
      const woId = job.woId || job.id;
      if (!woId) return;
      if (!pdMap.has(woId)) {
        pdMap.set(woId, []);
      }
      pdMap.get(woId).push(job);
    });

    const backlogWoById = new Map((state.workOrders || []).map(w => [w.id, w]));

    // Helper to extract clean operation name (e.g. "DEA062 - ปรับแต่ง" -> "ปรับแต่ง")
    const extractCleanOp = (step) => {
      if (!step) return '';
      const rawOpName = (step.stepName || step.name || '').trim();
      const machCode = (step.machine || step.originalMachine || '').trim();
      const wcName = (state.workCenters[machCode]?.name || '').trim();

      const cleanStr = (str) => {
        if (!str) return '';
        let s = str.replace(/^\((.*)\)$/, '$1').trim();
        const m = s.match(/^[A-Za-z0-9_]+\s*[-–]\s*(.+)$/);
        if (m && m[1]) return m[1].trim();
        return s;
      };

      const cleanOp = cleanStr(rawOpName);
      const cleanWc = cleanStr(wcName);

      if (cleanOp && cleanOp !== machCode) return cleanOp;
      if (cleanWc && cleanWc !== machCode) return cleanWc;
      if (cleanOp) return cleanOp;
      if (rawOpName) return rawOpName;
      if (machCode) return machCode;
      return '';
    };

    // 3. Build array of Production Order items
    const rawItems = [];
    for (const [woId, jobs] of pdMap.entries()) {
      const backlogWO = backlogWoById.get(woId);
      const firstJob = jobs[0];

      const dwgNo = (firstJob?.dwgNo || backlogWO?.dwgNo || '').trim() || '-';
      const partName = (firstJob?.partName || backlogWO?.partName || '').trim() || '-';
      const qty = (typeof firstJob?.qty === 'number' && firstJob.qty > 0) ? firstJob.qty : (backlogWO?.qty || 1);
      const project = (firstJob?.project || backlogWO?.project || '').trim();
      const customer = (firstJob?.customer || backlogWO?.customer || '').trim();
      
      let soNo = (firstJob?.soNo || backlogWO?.soNo || '').trim();
      if (!soNo && project && /^SO/i.test(project)) {
        soNo = project;
      }

      // Find Operations across all steps of this PD
      const allSteps = [];
      const seenStepNums = new Set();
      jobs.forEach(j => {
        const sNum = typeof j.stepNum === 'number' ? j.stepNum : parseInt(j.stepNum, 10) || 0;
        allSteps.push({
          id: j.id,
          stepNum: sNum,
          stepName: (j.stepName || j.name || '').trim(),
          machine: (j.machine || j.originalMachine || '').trim(),
          status: j.status || 'Scheduled'
        });
        seenStepNums.add(sNum);
      });
      if (backlogWO && Array.isArray(backlogWO.steps)) {
        backlogWO.steps.forEach(s => {
          const sNum = typeof s.stepNum === 'number' ? s.stepNum : parseInt(s.stepNum, 10) || 0;
          if (!seenStepNums.has(sNum)) {
            allSteps.push({
              id: s.id,
              stepNum: sNum,
              stepName: (s.name || s.stepName || '').trim(),
              machine: (s.machine || '').trim(),
              status: s.status || 'Unscheduled'
            });
            seenStepNums.add(sNum);
          }
        });
      }

      allSteps.sort((a, b) => a.stepNum - b.stepNum);

      // Current Operation logic:
      // 1. Step currently 'Running' or 'Setup'
      // 2. Step currently 'Paused'
      // 3. First step that is NOT 'Completed'
      // 4. If all steps are Completed, the final step
      let currentIdx = allSteps.findIndex(s => s.status === 'Running' || s.status === 'Setup');
      if (currentIdx === -1) {
        currentIdx = allSteps.findIndex(s => s.status === 'Paused');
      }
      if (currentIdx === -1) {
        currentIdx = allSteps.findIndex(s => s.status !== 'Completed');
      }
      if (currentIdx === -1 && allSteps.length > 0) {
        currentIdx = allSteps.length - 1;
      }

      const doingStep = (currentIdx >= 0 && currentIdx < allSteps.length) ? allSteps[currentIdx] : null;
      const doingOp = extractCleanOp(doingStep);
      const doingStatus = doingStep ? (doingStep.status || '') : '';
      const remainingSteps = (currentIdx >= 0) ? allSteps.slice(currentIdx + 1) : [];

      rawItems.push({
        woId,
        dwgNo,
        partName,
        qty,
        project,
        customer,
        soNo,
        allSteps,
        doingOp,
        doingStatus,
        remainingSteps
      });
    }

    // Sort naturally by PD ID
    rawItems.sort((a, b) => a.woId.localeCompare(b.woId, undefined, { numeric: true, sensitivity: 'base' }));

    // 4. Determine number of Next columns (at least 6 Nexts as requested, or dynamic if more remain)
    const maxRemaining = Math.max(...rawItems.map(item => item.remainingSteps.length), 0);
    const numNextCols = Math.max(6, maxRemaining);

    // Populate Next step properties onto rawItems for sorting, search, and table rendering
    rawItems.forEach(item => {
      for (let i = 0; i < numNextCols; i++) {
        const nextStep = item.remainingSteps[i];
        item['nextOp_' + i] = nextStep ? extractCleanOp(nextStep) : '';
        item['nextStatus_' + i] = nextStep ? (nextStep.status || '') : '';
      }
    });

    // Extract summary header info
    const distinctSos = Array.from(new Set(rawItems.map(p => p.soNo).filter(Boolean)));
    const soNoDisplay = distinctSos.length > 0 ? distinctSos.join(', ') : '.......';

    const distinctProjects = Array.from(new Set(rawItems.map(p => p.project).filter(Boolean)));
    const projectDisplay = distinctProjects.length > 0 ? distinctProjects.join(', ') : '........';

    const distinctCustomers = Array.from(new Set(rawItems.map(p => p.customer).filter(Boolean)));
    const customerDisplay = distinctCustomers.length > 0 ? distinctCustomers.join(', ') : '..............';

    const pdFromDisplay = rawItems.length > 0 ? rawItems[0].woId : '..................';
    const pdToDisplay = rawItems.length > 0 ? rawItems[rawItems.length - 1].woId : '....................';

    // Create Modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay pd-order-list-modal-overlay';
    modal.style.zIndex = '350';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    let currentSort = { col: 'woId', asc: true };
    let searchQuery = '';

    modal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 1200px; width: 96%; max-height: 90vh; display: flex; flex-direction: column; padding: 20px; box-shadow: 0 15px 40px rgba(0,0,0,0.6); border: 1px solid var(--border-glass); border-radius: 12px;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 18px;">📋</span>
            <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--accent-teal); letter-spacing: 0.5px;">
              Production Order ที่คงเหลือใน line ผลิต
            </h3>
            <span id="pd-list-count-badge" style="font-size: 11px; background: rgba(0, 242, 254, 0.12); border: 1px solid var(--accent-teal); color: var(--accent-teal); padding: 2px 8px; border-radius: 12px; font-weight: 600;">
              ${rawItems.length} รายการ
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="btn-print-pd-list" class="btn btn-action-small" title="พิมพ์รายงาน" style="background: rgba(255, 255, 255, 0.08); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 5px 12px; font-size: 11px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: 600;">
              🖨️ พิมพ์
            </button>
            <button id="btn-export-pd-list-csv" class="btn btn-action-small" title="ส่งออกข้อมูลเป็น CSV" style="background: rgba(22, 163, 74, 0.15); border: 1px solid var(--accent-green, #16a34a); color: var(--accent-green, #16a34a); padding: 5px 12px; font-size: 11px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: 600;">
              📥 Export CSV
            </button>
            <button id="btn-close-pd-list" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 4px;" title="ปิด (Close)">
              ✕
            </button>
          </div>
        </div>

        <!-- Summary Header Box (Framed with clean spacing, no dashed line) -->
        <div class="pd-header-summary-box">
          <div class="pd-header-title">
            <span>Production Order ที่คงเหลือใน line ผลิต</span>
          </div>
          <div class="pd-header-grid">
            <div class="pd-header-item">
              <span class="pd-header-label">SO No:</span>
              <span class="pd-header-val accent">${soNoDisplay}</span>
            </div>
            <div class="pd-header-item">
              <span class="pd-header-label">Project:</span>
              <span class="pd-header-val">${projectDisplay}</span>
            </div>
            <div class="pd-header-item">
              <span class="pd-header-label">Customer:</span>
              <span class="pd-header-val">${customerDisplay}</span>
            </div>
            <div class="pd-header-item">
              <span class="pd-header-label">PD No:</span>
              <span class="pd-header-val accent mono">${pdFromDisplay} <span style="color: var(--text-secondary); font-weight: normal; margin: 0 4px;">to</span> ${pdToDisplay}</span>
            </div>
          </div>
        </div>

        <!-- Search & Filter Controls -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 10px; flex-wrap: wrap;">
          <input type="text" id="pd-order-list-search-input" placeholder="🔍 ค้นหา PD No, DWG, Part Name, หรือชื่อขั้นตอน Doing / Next..." style="flex: 1; min-width: 260px; max-width: 380px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 12px; font-size: 11.5px; color: var(--text-primary); outline: none;">
          <div style="font-size: 10.5px; color: var(--text-secondary);">
            💡 คลิกหัวตารางเพื่อเรียงลำดับ | คลิกเลขที่ PD เพื่อเปิดดูรายละเอียด
          </div>
        </div>

        <!-- Table Container -->
        <div style="flex: 1; overflow-x: auto; overflow-y: auto; border: 1px solid var(--border-glass); border-radius: 8px; background: rgba(0,0,0,0.2); min-height: 250px;">
          <table class="pd-order-list-table">
            <thead>
              <tr>
                <th class="sortable" data-col="woId" style="min-width: 120px;">PD No. <span class="sort-icon" data-col="woId">↕</span></th>
                <th class="sortable" data-col="dwgNo" style="min-width: 130px;">DWG No. <span class="sort-icon" data-col="dwgNo">↕</span></th>
                <th class="sortable" data-col="partName" style="min-width: 160px;">Part Name <span class="sort-icon" data-col="partName">↕</span></th>
                <th class="sortable" data-col="qty" style="min-width: 60px; text-align: center;">QTY <span class="sort-icon" data-col="qty">↕</span></th>
                <th class="sortable" data-col="doingOp" style="min-width: 100px; color: var(--accent-teal);" title="ขั้นตอนที่กำลังผลิตอยู่">Doing <span class="sort-icon" data-col="doingOp">↕</span></th>
                ${Array.from({ length: numNextCols }, (_, i) => `
                  <th class="sortable" data-col="nextOp_${i}" style="min-width: 90px; white-space: nowrap;" title="ขั้นตอนถัดไปลำดับที่ ${i + 1}">Next <span class="sort-icon" data-col="nextOp_${i}">↕</span></th>
                `).join('')}
              </tr>
            </thead>
            <tbody id="pd-list-table-body">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-glass); padding-top: 12px; margin-top: 12px;">
          <div id="pd-list-footer-stats" style="font-size: 11px; color: var(--text-secondary);">
            แสดงผลเฉพาะรายการที่กรองและแสดงอยู่บน Board
          </div>
          <button id="btn-close-pd-list-bottom" class="btn btn-secondary" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 6px 18px; border-radius: 6px; font-size: 11.5px; cursor: pointer;">
            ปิด (Close)
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const renderRows = () => {
      let filtered = rawItems;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = rawItems.filter(item => {
          if (item.woId.toLowerCase().includes(q)) return true;
          if (item.dwgNo.toLowerCase().includes(q)) return true;
          if (item.partName.toLowerCase().includes(q)) return true;
          if (String(item.qty).includes(q)) return true;
          if ((item.doingOp || '').toLowerCase().includes(q)) return true;
          for (let i = 0; i < numNextCols; i++) {
            if ((item['nextOp_' + i] || '').toLowerCase().includes(q)) return true;
          }
          return false;
        });
      }

      filtered.sort((a, b) => {
        let valA = a[currentSort.col];
        let valB = b[currentSort.col];
        if (currentSort.col === 'qty') {
          valA = Number(valA) || 0;
          valB = Number(valB) || 0;
          return currentSort.asc ? valA - valB : valB - valA;
        }
        valA = String(valA || '');
        valB = String(valB || '');
        const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        return currentSort.asc ? cmp : -cmp;
      });

      const totalFilteredQty = filtered.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

      const countBadge = modal.querySelector('#pd-list-count-badge');
      if (countBadge) {
        countBadge.textContent = `${filtered.length} รายการ (จำนวนผลิตรวม: ${totalFilteredQty.toLocaleString()} ชิ้น)`;
      }

      const statsEl = modal.querySelector('#pd-list-footer-stats');
      if (statsEl) {
        statsEl.textContent = `รายการที่แสดง: ${filtered.length} / ${rawItems.length} PD (ยอดผลิตรวม: ${totalFilteredQty.toLocaleString()} ชิ้น)`;
      }

      // Update sort indicators
      modal.querySelectorAll('.sort-icon').forEach(icon => {
        const col = icon.getAttribute('data-col');
        if (col === currentSort.col) {
          icon.textContent = currentSort.asc ? '▲' : '▼';
          icon.style.color = 'var(--accent-teal)';
        } else {
          icon.textContent = '↕';
          icon.style.color = 'var(--text-secondary)';
        }
      });

      const tbody = modal.querySelector('#pd-list-table-body');
      if (!tbody) return;

      const totalCols = 5 + numNextCols;
      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="${totalCols}" style="text-align: center; padding: 35px 20px; color: var(--text-secondary); font-size: 12px;">
              ${rawItems.length === 0 ? '⚠️ ไม่มีรายการ Production Order ที่ตรงกับตัวกรอง หรือไม่มีงานบน Board ในขณะนี้' : '🔍 ไม่พบข้อมูลที่ตรงกับคำค้นหา'}
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = filtered.map(item => `
        <tr>
          <td style="font-family: monospace; font-weight: 700; color: var(--accent-teal); cursor: pointer; text-decoration: underline; white-space: nowrap;" class="pd-no-link" data-wo-id="${item.woId}" title="คลิกเพื่อดูรายละเอียด Production Order: ${item.woId}">
            ${item.woId}
          </td>
          <td style="font-family: monospace; color: var(--text-secondary); font-weight: 500; white-space: nowrap;">${item.dwgNo}</td>
          <td style="font-weight: 600; color: var(--text-primary); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.partName}">${item.partName}</td>
          <td style="text-align: center; font-weight: 700; color: var(--text-primary);">${item.qty}</td>
          <td style="color: var(--accent-cyan); font-weight: 600; white-space: nowrap;">
            ${item.doingStatus === 'Running' || item.doingStatus === 'Setup' ? '<span style="color: #39ff14; font-weight: bold; margin-right: 4px;" title="Running">⚡</span>' : (item.doingStatus === 'Paused' ? '<span style="color: var(--accent-orange); margin-right: 4px;" title="Paused">⏸️</span>' : (item.doingStatus === 'Completed' ? '<span style="color: #4ade80; margin-right: 4px;" title="Completed">✓</span>' : ''))}${item.doingOp || '-'}
          </td>
          ${Array.from({ length: numNextCols }, (_, i) => {
            const opName = item['nextOp_' + i];
            if (!opName) {
              return `<td style="color: var(--text-secondary); text-align: center; opacity: 0.35;">-</td>`;
            }
            return `
              <td style="color: var(--text-primary); font-weight: 500; white-space: nowrap;">
                ${opName}
              </td>
            `;
          }).join('')}
        </tr>
      `).join('');

      // Add click handler to PD No. cells to open PD Plan Modal
      tbody.querySelectorAll('.pd-no-link').forEach(cell => {
        cell.addEventListener('click', (e) => {
          const woId = e.currentTarget.getAttribute('data-wo-id');
          if (woId && this.gantt && this.gantt.showPDPlanModal) {
            this.gantt.showPDPlanModal(woId);
          }
        });
      });
    };

    // Initial render of rows
    renderRows();

    // Search input event listener
    const searchInput = modal.querySelector('#pd-order-list-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = (e.target.value || '').trim();
        renderRows();
      });
    }

    // Column sort headers event listeners
    modal.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (currentSort.col === col) {
          currentSort.asc = !currentSort.asc;
        } else {
          currentSort.col = col;
          currentSort.asc = true;
        }
        renderRows();
      });
    });

    // Close listeners
    const closeModal = () => {
      document.removeEventListener('keydown', handleEsc);
      modal.remove();
    };

    const handleEsc = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleEsc);

    modal.querySelector('#btn-close-pd-list')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-close-pd-list-bottom')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Print Listener
    modal.querySelector('#btn-print-pd-list')?.addEventListener('click', () => {
      const printWin = window.open('', '_blank');
      if (!printWin) {
        alert('กรุณาอนุญาต Pop-up ในเบราว์เซอร์เพื่อเปิดหน้าต่างพิมพ์รายงาน');
        return;
      }

      const totalQtyAll = rawItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
      const printRowsHtml = rawItems.map(item => `
        <tr>
          <td style="border: 1px solid #333; padding: 6px 8px; font-family: monospace; font-weight: bold; white-space: nowrap;">${item.woId}</td>
          <td style="border: 1px solid #333; padding: 6px 8px; font-family: monospace; white-space: nowrap;">${item.dwgNo}</td>
          <td style="border: 1px solid #333; padding: 6px 8px;">${item.partName}</td>
          <td style="border: 1px solid #333; padding: 6px 8px; text-align: center; font-weight: bold;">${item.qty}</td>
          <td style="border: 1px solid #333; padding: 6px 8px; font-weight: bold; white-space: nowrap;">${item.doingOp || '-'}</td>
          ${Array.from({ length: numNextCols }, (_, i) => `
            <td style="border: 1px solid #333; padding: 6px 8px; white-space: nowrap;">${item['nextOp_' + i] || '-'}</td>
          `).join('')}
        </tr>
      `).join('');

      printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Production Order ที่คงเหลือใน line ผลิต</title>
          <style>
            body { font-family: 'Sarabun', 'Helvetica Neue', Arial, sans-serif; padding: 25px; color: #000; font-size: 12px; }
            .print-header-box { border: 1.5px solid #000; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; background: #fafafa; }
            .print-title { font-size: 15px; font-weight: bold; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #ccc; }
            .print-grid { display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 12px; }
            .print-item { display: inline-flex; gap: 6px; align-items: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
            th { background-color: #f2f2f2; border: 1px solid #333; padding: 6px 8px; text-align: left; font-weight: bold; }
            td { border: 1px solid #333; padding: 5px 8px; }
            .footer-info { margin-top: 15px; display: flex; justify-content: space-between; font-size: 11px; }
            @media print {
              body { padding: 0; }
              @page { size: A4 landscape; margin: 1cm; }
            }
          </style>
        </head>
        <body>
          <div class="print-header-box">
            <div class="print-title">Production Order ที่คงเหลือใน line ผลิต</div>
            <div class="print-grid">
              <div class="print-item"><strong>SO No:</strong> <span>${soNoDisplay}</span></div>
              <div class="print-item"><strong>Project:</strong> <span>${projectDisplay}</span></div>
              <div class="print-item"><strong>Customer:</strong> <span>${customerDisplay}</span></div>
              <div class="print-item"><strong>PD No:</strong> <span style="font-family: monospace; font-weight: bold;">${pdFromDisplay} to ${pdToDisplay}</span></div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 12%;">PD No.</th>
                <th style="width: 13%;">DWG No.</th>
                <th style="width: 20%;">Part Name</th>
                <th style="width: 5%; text-align: center;">QTY</th>
                <th style="text-align: left;">Doing</th>
                ${Array.from({ length: numNextCols }, () => `<th style="text-align: left; white-space: nowrap;">Next</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${printRowsHtml}
            </tbody>
            <tfoot>
              <tr>
                <th colspan="3" style="text-align: right; border: 1px solid #333; padding: 8px;">รวมทั้งหมด (${rawItems.length} รายการ):</th>
                <th style="text-align: center; border: 1px solid #333; padding: 8px;">${totalQtyAll.toLocaleString()}</th>
                <th colspan="${1 + numNextCols}" style="border: 1px solid #333; padding: 8px;"></th>
              </tr>
            </tfoot>
          </table>
          <div class="footer-info">
            <div>พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}</div>
            <div>CHAKEN Planing v1.0 - APS Scheduling</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
        </html>
      `);
      printWin.document.close();
    });

    // Export CSV Listener
    modal.querySelector('#btn-export-pd-list-csv')?.addEventListener('click', () => {
      const escapeCsv = (str) => {
        const s = String(str ?? '').replace(/"/g, '""');
        return `"${s}"`;
      };
      const csvHeader = [
        "PD No.", 
        "DWG No.", 
        "Part Name", 
        "QTY", 
        "Doing", 
        ...Array.from({ length: numNextCols }, (_, i) => `Next ${i + 1}`), 
        "SO No", 
        "Project", 
        "Customer"
      ];
      const csvRows = rawItems.map(item => [
        escapeCsv(item.woId),
        escapeCsv(item.dwgNo),
        escapeCsv(item.partName),
        escapeCsv(item.qty),
        escapeCsv(item.doingOp || '-'),
        ...Array.from({ length: numNextCols }, (_, i) => escapeCsv(item['nextOp_' + i] || '-')),
        escapeCsv(item.soNo),
        escapeCsv(item.project),
        escapeCsv(item.customer)
      ].join(','));

      const csvContent = "\uFEFF" + [
        `"Production Order ที่คงเหลือใน line ผลิต (SO No: ${soNoDisplay}, Project: ${projectDisplay}, Customer: ${customerDisplay}, PD No: ${pdFromDisplay} to ${pdToDisplay})"`,
        csvHeader.map(escapeCsv).join(','),
        ...csvRows
      ].join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Production_Order_Remaining_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }

  showSameItemGroupingModal() {
    const jobs = state.scheduledJobs || [];
    if (!jobs || jobs.length === 0) {
      alert('ยังไม่มีข้อมูลแผนงานบนบอร์ดขณะนี้');
      return;
    }

    const getItemKeyLocal = (j) => {
      if (!j) return '';
      const dwg = (j.dwgNo || '').trim();
      if (dwg) return dwg.toUpperCase();
      const part = (j.partName || j.name || '').trim();
      return part ? part.toUpperCase() : '';
    };

    // 1. Group jobs by machine, sorted by startHour
    const byMachine = {};
    jobs.forEach(j => {
      const m = j.machine || 'UNKNOWN';
      if (!byMachine[m]) byMachine[m] = [];
      byMachine[m].push(j);
    });

    Object.keys(byMachine).forEach(m => {
      byMachine[m].sort((a, b) => (a.startHour || 0) - (b.startHour || 0));
    });

    // 2. Identify consecutive runs of identical item across different PDs on each machine
    const rawGroups = [];
    Object.entries(byMachine).forEach(([machine, mJobs]) => {
      let current = null;
      for (let i = 0; i < mJobs.length; i++) {
        const job = mJobs[i];
        const key = getItemKeyLocal(job);
        if (!key) {
          if (current && current.pds.length > 1) rawGroups.push(current);
          current = null;
          continue;
        }

        if (current && current.itemKey === key) {
          const lastWo = current.jobs[current.jobs.length - 1].woId;
          if (lastWo !== job.woId) {
            if (!current.pds.includes(job.woId)) current.pds.push(job.woId);
            current.totalQty += (job.qty || 0);
          }
          current.jobs.push(job);
          current.endHour = Math.max(current.endHour, job.startHour + (job.estHours || 0));
        } else {
          if (current && current.pds.length > 1) rawGroups.push(current);
          current = {
            machine,
            machineName: state.workCenters[machine]?.name || machine,
            itemKey: key,
            dwgNo: (job.dwgNo || '').trim() || '-',
            partName: (job.partName || job.name || '').trim() || '-',
            stepName: (job.stepName || '').trim() || '-',
            stepNum: job.stepNum || 0,
            pds: [job.woId],
            jobs: [job],
            totalQty: job.qty || 0,
            startHour: job.startHour,
            endHour: job.startHour + (job.estHours || 0)
          };
        }
      }
      if (current && current.pds.length > 1) rawGroups.push(current);
    });

    if (rawGroups.length === 0) {
      alert('ไม่พบรายการที่จัดกลุ่ม Item เดียวกันในแผนงานขณะนี้');
      return;
    }

    // Format dates & calculate duration
    rawGroups.forEach((g, idx) => {
      g.id = idx + 1;
      const dStart = state.workingHourToDate(g.startHour);
      const dEnd = state.workingHourToDate(g.endHour);
      g.dStart = dStart;
      g.dEnd = dEnd;
      g.startDateStr = dStart.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + dStart.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      g.endDateStr = dEnd.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + dEnd.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      g.durationHours = Math.max(0.1, g.endHour - g.startHour).toFixed(1);

      const pdQtyMap = {};
      g.jobs.forEach(j => {
        if (!pdQtyMap[j.woId]) pdQtyMap[j.woId] = 0;
        if (pdQtyMap[j.woId] === 0) {
          pdQtyMap[j.woId] = j.qty || 0;
        }
      });
      g.pdDetails = g.pds.map(woId => ({ woId, qty: pdQtyMap[woId] || 0 }));
    });

    // Default sort by startHour ascending (earliest first)
    rawGroups.sort((a, b) => a.startHour - b.startHour);

    const totalGroups = rawGroups.length;
    const allPds = new Set();
    rawGroups.forEach(g => g.pds.forEach(p => allPds.add(p)));
    const totalUniquePds = allPds.size;
    const totalPieces = rawGroups.reduce((sum, g) => sum + g.totalQty, 0);

    const machineCounts = {};
    rawGroups.forEach(g => {
      machineCounts[g.machine] = (machineCounts[g.machine] || 0) + 1;
    });
    const distinctMachines = Object.keys(machineCounts).sort((a, b) => machineCounts[b] - machineCounts[a]);

    const existingModal = document.getElementById('same-item-grouping-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'same-item-grouping-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '360';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    let currentSort = 'start-asc';
    let searchQuery = '';
    let selectedMachine = 'all';

    modal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 1250px; width: 96%; max-height: 92vh; display: flex; flex-direction: column; padding: 22px; box-shadow: 0 15px 45px rgba(0,0,0,0.65); border: 1px solid var(--border-glass); border-radius: 12px;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-glass); padding-bottom: 14px; margin-bottom: 14px; gap: 12px; flex-wrap: wrap;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <span style="font-size: 20px;">🧩</span>
              <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: var(--text-primary); letter-spacing: 0.5px;">
                รายการที่จัดกลุ่ม Item เดียวกันในแผนปัจจุบัน (Same Item Grouping)
              </h3>
              <span id="group-modal-count-badge" style="font-size: 11px; background: rgba(0, 0, 0, 0.06); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 2px 10px; border-radius: 12px; font-weight: 700;">
                ${totalGroups} กลุ่ม
              </span>
            </div>
            <p style="margin: 4px 0 0 30px; font-size: 11px; color: var(--text-secondary);">
              แสดงรายการชิ้นงานประเภทเดียวกันที่จัดตารางให้ผลิตต่อเนื่องกันบนเครื่องจักร เพื่อประหยัดเวลา Setup / เปลี่ยนแม่พิมพ์
            </p>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="btn-export-group-csv" class="btn btn-action-small" title="ส่งออกข้อมูลรายการที่จัดกลุ่มเป็น CSV / Excel" style="background: rgba(22, 163, 74, 0.15); border: 1px solid var(--accent-green, #16a34a); color: var(--accent-green, #16a34a); padding: 5px 12px; font-size: 11px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 5px; font-weight: 600; transition: all 0.2s;">
              📥 Export CSV
            </button>
            <button id="btn-print-group-list" class="btn btn-action-small" title="พิมพ์รายงานสรุป" style="background: rgba(0, 0, 0, 0.05); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 5px 12px; font-size: 11px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 5px; font-weight: 600; transition: all 0.2s;">
              🖨️ พิมพ์
            </button>
            <button id="btn-close-group-modal" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 4px; transition: all 0.2s;" title="ปิด (Close)">
              ✕
            </button>
          </div>
        </div>

        <!-- KPI Stat Summary Banner -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px;">
          <div style="background: rgba(0, 0, 0, 0.03); border: 1px solid var(--border-glass); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 22px;">🏷️</span>
            <div>
              <div style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase;">กลุ่มผลิตต่อเนื่องทั้งหมด</div>
              <div style="font-size: 17px; font-weight: 800; color: var(--text-primary);">${totalGroups} กลุ่ม</div>
            </div>
          </div>
          <div style="background: rgba(0, 0, 0, 0.03); border: 1px solid var(--border-glass); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 22px;">📦</span>
            <div>
              <div style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase;">จำนวนใบสั่งผลิตที่รวมกลุ่ม</div>
              <div style="font-size: 17px; font-weight: 800; color: var(--text-primary);">${totalUniquePds} ใบสั่งผลิต (PDs)</div>
            </div>
          </div>
          <div style="background: rgba(0, 0, 0, 0.03); border: 1px solid var(--border-glass); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 22px;">⚙️</span>
            <div>
              <div style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase;">จำนวนชิ้นงานผลิตรวม</div>
              <div style="font-size: 17px; font-weight: 800; color: var(--text-primary);">${totalPieces.toLocaleString()} ชิ้น</div>
            </div>
          </div>
        </div>

        <!-- Controls: Filter & Search Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 300px; flex-wrap: wrap;">
            <input type="text" id="group-modal-search" placeholder="🔍 ค้นหา Drawing No, Part Name, PD, เครื่องจักร..." style="flex: 1; min-width: 220px; max-width: 380px; background: rgba(0, 0, 0, 0.04); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 12px; font-size: 11px; color: var(--text-primary); outline: none;">
            
            <select id="group-modal-machine-filter" style="background: var(--bg-darker, #ffffff); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 10px; font-size: 11px; color: var(--text-primary); cursor: pointer; outline: none;">
              <option value="all">ทุกเครื่องจักร (${totalGroups} กลุ่ม)</option>
              ${distinctMachines.map(m => {
                const name = state.workCenters[m]?.name || m;
                return `<option value="${m}">${m} - ${name} (${machineCounts[m]} กลุ่ม)</option>`;
              }).join('')}
            </select>

            <select id="group-modal-sort" style="background: var(--bg-darker, #ffffff); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 10px; font-size: 11px; color: var(--text-primary); cursor: pointer; outline: none;">
              <option value="start-asc">📅 วันที่เริ่มผลิต (เก่า ➔ ใหม่)</option>
              <option value="start-desc">📅 วันที่เริ่มผลิต (ใหม่ ➔ เก่า)</option>
              <option value="pds-desc">🔢 จำนวน PD ต่อกัน (มาก ➔ น้อย)</option>
              <option value="qty-desc">📦 จำนวนชิ้นงานรวม (มาก ➔ น้อย)</option>
              <option value="dwg-asc">🏷️ Drawing No. (A-Z)</option>
            </select>
          </div>

          <div style="font-size: 10.5px; color: var(--text-secondary);">
            💡 คลิกเลขที่ PD เพื่อเปิดดูรายละเอียดของ PD นั้น
          </div>
        </div>

        <!-- Table Container -->
        <div style="flex: 1; overflow-x: auto; overflow-y: auto; border: 1px solid var(--border-glass); border-radius: 8px; background: var(--bg-card); min-height: 250px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
            <thead>
              <tr style="background: rgba(0, 0, 0, 0.05); border-bottom: 2px solid var(--border-glass); color: var(--text-primary); position: sticky; top: 0; z-index: 10;">
                <th style="padding: 10px 8px; width: 45px; text-align: center; color: var(--text-primary); font-weight: 700;">#</th>
                <th style="padding: 10px 10px; min-width: 130px; color: var(--text-primary); font-weight: 700;">Drawing No.</th>
                <th style="padding: 10px 10px; min-width: 180px; color: var(--text-primary); font-weight: 700;">รายละเอียดชิ้นงาน (Part Name)</th>
                <th style="padding: 10px 10px; min-width: 130px; color: var(--text-primary); font-weight: 700;">เครื่องจักร / ขั้นตอน</th>
                <th style="padding: 10px 10px; min-width: 240px; color: var(--text-primary); font-weight: 700;">รายการ PD ที่ผลิตต่อกัน (จำนวนชิ้น)</th>
                <th style="padding: 10px 10px; width: 85px; text-align: right; color: var(--text-primary); font-weight: 700;">จำนวนรวม</th>
                <th style="padding: 10px 10px; min-width: 140px; color: var(--text-primary); font-weight: 700;">📅 วันที่เริ่มผลิต</th>
                <th style="padding: 10px 10px; min-width: 140px; color: var(--text-primary); font-weight: 700;">🏁 วันที่ผลิตเสร็จ</th>
                <th style="padding: 10px 8px; width: 75px; text-align: right; color: var(--text-primary); font-weight: 700;">ชม.ผลิต</th>
              </tr>
            </thead>
            <tbody id="group-modal-tbody">
              <!-- Dynamically populated -->
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 11px; color: var(--text-secondary);">
          <div id="group-modal-footer-info">กำลังแสดงผล...</div>
          <button id="btn-close-group-modal-footer" class="btn" style="padding: 6px 16px; font-size: 11px; border-radius: 6px; background: rgba(0, 0, 0, 0.05); border: 1px solid var(--border-glass); color: var(--text-primary); cursor: pointer;">
            ปิด (Close)
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    const tbody = modal.querySelector('#group-modal-tbody');
    const footerInfo = modal.querySelector('#group-modal-footer-info');

    const renderTable = () => {
      let filtered = [...rawGroups];

      if (selectedMachine !== 'all') {
        filtered = filtered.filter(g => g.machine === selectedMachine);
      }

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(g => 
          g.dwgNo.toLowerCase().includes(q) ||
          g.partName.toLowerCase().includes(q) ||
          g.machine.toLowerCase().includes(q) ||
          g.machineName.toLowerCase().includes(q) ||
          g.stepName.toLowerCase().includes(q) ||
          g.pds.some(p => p.toLowerCase().includes(q))
        );
      }

      if (currentSort === 'start-asc') {
        filtered.sort((a, b) => a.startHour - b.startHour);
      } else if (currentSort === 'start-desc') {
        filtered.sort((a, b) => b.startHour - a.startHour);
      } else if (currentSort === 'pds-desc') {
        filtered.sort((a, b) => b.pds.length - a.pds.length);
      } else if (currentSort === 'qty-desc') {
        filtered.sort((a, b) => b.totalQty - a.totalQty);
      } else if (currentSort === 'dwg-asc') {
        filtered.sort((a, b) => a.dwgNo.localeCompare(b.dwgNo));
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="9" style="padding: 30px; text-align: center; color: var(--text-secondary);">
              ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา
            </td>
          </tr>
        `;
        footerInfo.textContent = `แสดง 0 จากทั้งหมด ${totalGroups} กลุ่ม`;
        return;
      }

      tbody.innerHTML = filtered.map((g, idx) => `
        <tr style="border-bottom: 1px solid var(--border-glass); transition: background 0.15s;" onmouseover="this.style.background='rgba(0,0,0,0.03)'" onmouseout="this.style.background='transparent'">
          <td style="padding: 9px 8px; text-align: center; color: var(--text-secondary); font-weight: 600;">${idx + 1}</td>
          <td style="padding: 9px 10px; font-family: monospace; font-weight: 700; color: var(--text-primary);">${g.dwgNo}</td>
          <td style="padding: 9px 10px; color: var(--text-primary); font-weight: 600;">${g.partName}</td>
          <td style="padding: 9px 10px;">
            <div style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.05); border: 1px solid var(--border-glass); font-size: 11px; color: var(--text-primary);">
              <strong style="color: var(--text-primary);">${g.machine}</strong> <span style="color: var(--text-secondary);">(${g.stepName})</span>
            </div>
          </td>
          <td style="padding: 9px 10px;">
            <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
              ${g.pdDetails.map((pd, pIdx) => `
                ${pIdx > 0 ? '<span style="color: var(--text-secondary); font-weight: bold; opacity: 0.7;">➔</span>' : ''}
                <span class="group-pd-badge" data-wo-id="${pd.woId}" title="คลิกเพื่อเปิดดูรายละเอียด PD" style="display: inline-flex; align-items: center; gap: 4px; background: rgba(0, 0, 0, 0.04); border: 1px solid var(--border-glass); padding: 2px 7px; border-radius: 4px; font-family: monospace; font-size: 10.5px; cursor: pointer; transition: all 0.15s;">
                  <strong style="color: var(--text-primary);">${pd.woId}</strong>
                  <span style="color: var(--text-secondary); font-size: 10px; font-weight: 600;">(${pd.qty})</span>
                </span>
              `).join('')}
            </div>
          </td>
          <td style="padding: 9px 10px; text-align: right; font-weight: 700; color: var(--text-primary);">
            ${g.totalQty.toLocaleString()}
          </td>
          <td style="padding: 9px 10px; font-weight: 700; color: var(--text-primary); white-space: nowrap;">
            ${g.startDateStr}
          </td>
          <td style="padding: 9px 10px; color: var(--text-secondary); font-weight: 500; white-space: nowrap;">
            ${g.endDateStr}
          </td>
          <td style="padding: 9px 8px; text-align: right; color: var(--text-secondary); font-weight: 600;">
            ${g.durationHours}
          </td>
        </tr>
      `).join('');

      footerInfo.textContent = `แสดง ${filtered.length} จากทั้งหมด ${totalGroups} กลุ่ม (รวม ${filtered.reduce((sum, g) => sum + g.totalQty, 0).toLocaleString()} ชิ้น)`;

      tbody.querySelectorAll('.group-pd-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
          const woId = e.currentTarget.getAttribute('data-wo-id');
          if (woId && this.gantt && this.gantt.showPDPlanModal) {
            this.gantt.showPDPlanModal(woId);
          }
        });
      });
    };

    renderTable();

    const searchInput = modal.querySelector('#group-modal-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = (e.target.value || '').trim();
        renderTable();
      });
    }

    const machineFilter = modal.querySelector('#group-modal-machine-filter');
    if (machineFilter) {
      machineFilter.addEventListener('change', (e) => {
        selectedMachine = e.target.value;
        renderTable();
      });
    }

    const sortSelect = modal.querySelector('#group-modal-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderTable();
      });
    }

    modal.querySelector('#btn-export-group-csv')?.addEventListener('click', () => {
      const escapeCsv = (str) => `"${String(str ?? '').replace(/"/g, '""')}"`;
      const csvHeader = ['ลำดับ', 'Drawing No', 'รายละเอียดชิ้นงาน', 'รหัสเครื่องจักร', 'ชื่อเครื่องจักร', 'ขั้นตอน', 'รายการ PD ที่ผลิตต่อกัน', 'จำนวน PD', 'จำนวนรวม (ชิ้น)', 'วันที่เริ่มผลิต', 'วันที่ผลิตเสร็จ', 'ระยะเวลา (ชม.)'];
      const csvRows = rawGroups.map((g, idx) => [
        idx + 1,
        escapeCsv(g.dwgNo),
        escapeCsv(g.partName),
        escapeCsv(g.machine),
        escapeCsv(g.machineName),
        escapeCsv(g.stepName),
        escapeCsv(g.pds.join(' -> ')),
        g.pds.length,
        g.totalQty,
        escapeCsv(g.startDateStr),
        escapeCsv(g.endDateStr),
        g.durationHours
      ].join(','));

      const csvContent = '\uFEFF' + [
        escapeCsv(`รายการชิ้นงานที่จัดกลุ่ม Item เดียวกันในแผนปัจจุบัน (${totalGroups} กลุ่ม, รวม ${totalPieces} ชิ้น)`),
        csvHeader.map(escapeCsv).join(','),
        ...csvRows
      ].join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Grouped_Items_Plan_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    modal.querySelector('#btn-print-group-list')?.addEventListener('click', () => {
      window.print();
    });

    const closeModal = () => {
      modal.remove();
    };
    modal.querySelector('#btn-close-group-modal')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-close-group-modal-footer')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }
}

// Global 12-Spoke iOS Loading & Calculation Spinner Controller
(function initGlobalIosSpinner() {
  const activeSpinnerTokens = new Map();
  let spinnerTokenSeq = 0;

  const ensureIosSpinnerElement = () => {
    if (!document.getElementById('dwg-ios-spinner-style')) {
      const st = document.createElement('style');
      st.id = 'dwg-ios-spinner-style';
      st.textContent = `
        @keyframes dwgIosSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        #dwg-ios-spinner-overlay {
          position: fixed;
          inset: 0;
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          pointer-events: none;
        }
        #dwg-ios-spinner-svg {
          width: 72px;
          height: 72px;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          animation: dwgIosSpin 0.9s steps(12, end) infinite;
          filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.35)) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.75));
        }
      `;
      (document.head || document.documentElement).appendChild(st);
    }
    let overlay = document.getElementById('dwg-ios-spinner-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'dwg-ios-spinner-overlay';
      const opacities = [1, 0.10, 0.17, 0.25, 0.33, 0.41, 0.50, 0.58, 0.66, 0.75, 0.83, 0.92];
      const spokes = opacities.map((op, i) => {
        const deg = i * 30;
        return `<rect x="46" y="6" width="8" height="24" rx="4" ry="4" fill="#ffffff" fill-opacity="${op}" transform="rotate(${deg} 50 50)" />`;
      }).join('');
      overlay.innerHTML = `<svg id="dwg-ios-spinner-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${spokes}</svg>`;
      (document.body || document.documentElement).appendChild(overlay);
    } else if (overlay.parentNode !== document.body && document.body) {
      document.body.appendChild(overlay);
    }
    return overlay;
  };

  const syncIosSpinnerVisibility = () => {
    const overlay = document.getElementById('dwg-ios-spinner-overlay');
    if (activeSpinnerTokens.size > 0) {
      const el = overlay || ensureIosSpinnerElement();
      el.style.display = 'flex';
    } else if (overlay) {
      overlay.remove();
    }
  };

  const showIosSpinner = (minVisibleMs = 320) => {
    const id = ++spinnerTokenSeq;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const safetyTimer = setTimeout(() => {
      activeSpinnerTokens.delete(id);
      syncIosSpinnerVisibility();
    }, 45000);
    activeSpinnerTokens.set(id, { id, start: now, minMs: minVisibleMs, safetyTimer });
    const overlay = ensureIosSpinnerElement();
    overlay.style.display = 'flex';
    void overlay.offsetWidth;
    return id;
  };

  const hideIosSpinner = (token, overrideMinMs) => {
    let targetId = token;
    if (targetId == null || !activeSpinnerTokens.has(targetId)) {
      const keys = Array.from(activeSpinnerTokens.keys());
      targetId = keys.length > 0 ? keys[keys.length - 1] : null;
    }
    if (targetId == null) {
      syncIosSpinnerVisibility();
      return;
    }
    const entry = activeSpinnerTokens.get(targetId);
    if (!entry) {
      syncIosSpinnerVisibility();
      return;
    }
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const minMs = overrideMinMs !== undefined ? overrideMinMs : entry.minMs;
    const remaining = Math.max(0, minMs - (now - entry.start));
    const finalize = () => {
      clearTimeout(entry.safetyTimer);
      activeSpinnerTokens.delete(targetId);
      syncIosSpinnerVisibility();
    };
    if (remaining > 0) {
      setTimeout(finalize, remaining);
    } else {
      finalize();
    }
  };

  const forceHideIosSpinner = () => {
    activeSpinnerTokens.forEach(entry => clearTimeout(entry.safetyTimer));
    activeSpinnerTokens.clear();
    const overlay = document.getElementById('dwg-ios-spinner-overlay');
    if (overlay) overlay.remove();
  };

  const yieldForSpinnerPaint = (fn) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(fn, 25));
    } else {
      setTimeout(fn, 25);
    }
  };

  window.showIosSpinner = showIosSpinner;
  window.hideIosSpinner = hideIosSpinner;
  window.forceHideIosSpinner = forceHideIosSpinner;

  const startupSpinToken = showIosSpinner(500);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => hideIosSpinner(startupSpinToken), 450);
    });
  } else {
    setTimeout(() => hideIosSpinner(startupSpinToken), 450);
  }

  const wrapAsyncProto = (proto, methodName, minMs = 350) => {
    if (!proto || typeof proto[methodName] !== 'function' || proto[methodName]._iosSpinWrapped) return;
    const orig = proto[methodName];
    const wrapped = async function(...args) {
      const tok = showIosSpinner(minMs);
      try {
        return await orig.apply(this, args);
      } finally {
        hideIosSpinner(tok);
      }
    };
    wrapped._iosSpinWrapped = true;
    proto[methodName] = wrapped;
  };

  const wrapSyncCalc = (obj, methodName, minMs = 350, deferFrame = false) => {
    if (!obj || typeof obj[methodName] !== 'function' || obj[methodName]._iosSpinWrapped) return;
    const orig = obj[methodName];
    const wrapped = function(...args) {
      const tok = showIosSpinner(minMs);
      if (deferFrame) {
        yieldForSpinnerPaint(() => {
          try {
            orig.apply(this, args);
          } finally {
            hideIosSpinner(tok);
          }
        });
        return;
      }
      try {
        return orig.apply(this, args);
      } finally {
        hideIosSpinner(tok);
      }
    };
    wrapped._iosSpinWrapped = true;
    obj[methodName] = wrapped;
  };

  if (typeof StorageSyncManager !== 'undefined' && StorageSyncManager.prototype) {
    wrapAsyncProto(StorageSyncManager.prototype, 'pullFromCloud', 450);
    wrapAsyncProto(StorageSyncManager.prototype, 'fetchStatusOverview', 380);
    wrapAsyncProto(StorageSyncManager.prototype, 'fetchPlanMaterials', 380);
    if (typeof StorageSyncManager.prototype.executePush === 'function' && !StorageSyncManager.prototype.executePush._iosSpinWrapped) {
      const origExecPush = StorageSyncManager.prototype.executePush;
      StorageSyncManager.prototype.executePush = async function(payload, isBeacon = false) {
        if (isBeacon) return origExecPush.call(this, payload, isBeacon);
        const tok = showIosSpinner(320);
        try {
          return await origExecPush.call(this, payload, isBeacon);
        } finally {
          hideIosSpinner(tok);
        }
      };
      StorageSyncManager.prototype.executePush._iosSpinWrapped = true;
    }
    if (typeof StorageSyncManager.prototype.importBackupJson === 'function' && !StorageSyncManager.prototype.importBackupJson._iosSpinWrapped) {
      const origImportBackup = StorageSyncManager.prototype.importBackupJson;
      StorageSyncManager.prototype.importBackupJson = function(file) {
        if (!file) return;
        const tok = showIosSpinner(450);
        try {
          return origImportBackup.call(this, file);
        } finally {
          setTimeout(() => hideIosSpinner(tok), 400);
        }
      };
      StorageSyncManager.prototype.importBackupJson._iosSpinWrapped = true;
    }
  }

  if (typeof QcCheckController !== 'undefined' && QcCheckController.prototype) {
    wrapAsyncProto(QcCheckController.prototype, 'runCheck', 450);
  }

  if (typeof ContinuityAnalysisController !== 'undefined' && ContinuityAnalysisController.prototype) {
    wrapSyncCalc(ContinuityAnalysisController.prototype, 'open', 350, true);
    wrapSyncCalc(ContinuityAnalysisController.prototype, 'render', 300, false);
  }

  if (typeof AssemblyTreeController !== 'undefined' && AssemblyTreeController.prototype) {
    wrapAsyncProto(AssemblyTreeController.prototype, 'showBomModal', 400);
    wrapSyncCalc(AssemblyTreeController.prototype, 'selectAssembly', 350, true);
  }

  if (typeof WorkflowController !== 'undefined' && WorkflowController.prototype) {
    wrapSyncCalc(WorkflowController.prototype, 'runPDSimulation', 420, true);
  }

  if (typeof App !== 'undefined' && App.prototype) {
    if (typeof App.prototype.runAIOptimizationWithSelection === 'function' && !App.prototype.runAIOptimizationWithSelection._iosSpinWrapped) {
      const origRunAI = App.prototype.runAIOptimizationWithSelection;
      App.prototype.runAIOptimizationWithSelection = function(btn, selectedIds) {
        const tok = showIosSpinner(650);
        yieldForSpinnerPaint(() => {
          try {
            origRunAI.call(this, btn, selectedIds);
          } finally {
            setTimeout(() => hideIosSpinner(tok), 2100);
          }
        });
      };
      App.prototype.runAIOptimizationWithSelection._iosSpinWrapped = true;
    }
    if (typeof App.prototype.showAIResultModal === 'function' && !App.prototype.showAIResultModal._iosSpinWrapped) {
      const origShowAIResult = App.prototype.showAIResultModal;
      App.prototype.showAIResultModal = function(simJobs, lateJobs, onConfirmCallback, meta) {
        const wrappedConfirm = (adjustTargets) => {
          const tok = showIosSpinner(450);
          yieldForSpinnerPaint(() => {
            try {
              if (typeof onConfirmCallback === 'function') onConfirmCallback(adjustTargets);
            } finally {
              hideIosSpinner(tok);
            }
          });
        };
        return origShowAIResult.call(this, simJobs, lateJobs, wrappedConfirm, meta);
      };
      App.prototype.showAIResultModal._iosSpinWrapped = true;
    }
    wrapSyncCalc(App.prototype, 'showSameItemGroupingModal', 350, true);
    wrapSyncCalc(App.prototype, 'showProductionOrderListModal', 350, true);
    wrapSyncCalc(App.prototype, 'showLateWOsListModal', 350, true);
  }

  if (typeof state !== 'undefined' && state) {
    wrapSyncCalc(state, 'recomputeSchedule', 420, false);
    wrapSyncCalc(state, 'updateWorkCenters', 400, false);
    wrapSyncCalc(state, 'setActiveScale', 320, false);
    wrapSyncCalc(state, 'setGanttMode', 320, false);
    wrapSyncCalc(state, 'importPlan', 450, false);
    wrapSyncCalc(state, 'simulateQuoteImpact', 350, false);
  }
})();

// Start application when DOM loads
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
