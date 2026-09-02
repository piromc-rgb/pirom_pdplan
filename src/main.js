import './style.css';
import { state } from './state.js';
import { Scheduler, getPriorityWeight } from './scheduler.js';
import { WorkflowController } from './workflow.js';
import { GanttController } from './gantt.js';
import { ResourcesController } from './resources.js';
import { KioskController } from './kiosk.js';
import { DailyScheduleController } from './dailySchedule.js';
import { AssemblyTreeController } from './assemblyTree.js';

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
      const versionStr = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '260811';
      const updateDateTime = () => {
        const now = new Date();
        const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        headerDateTime.textContent = now.toLocaleDateString('en-GB', options).replace(/,/g, '') + ` | v${versionStr}`;
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
        headerDateTime.textContent = now.toLocaleDateString('en-GB', options).replace(/,/g, '') + ` | v${versionStr}`;
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
    this.btnAddWc = document.getElementById('btn-add-workcenter');
    this.wcSettingsList = document.getElementById('workcenter-settings-list');

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

    if (this.btnSaveWcSettings) {
      this.btnSaveWcSettings.addEventListener('click', () => {
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
          return;
        }

        if (newOrder.length === 0) {
          alert('กรุณาเพิ่มเครื่องจักรอย่างน้อย 1 รายการ');
          return;
        }

        state.updateWorkCenters(newWorkCenters, newOrder);
        this.wcSettingsModal.classList.add('hidden');
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

        this.wcSettingsList.appendChild(row);
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

  initGlobalEvents() {
    // 1. Scheduling Model Selector
    const modelSelect = document.getElementById('model-select');
    modelSelect.addEventListener('change', (e) => {
      const selectedModel = e.target.value;
      state.setSchedulingModel(selectedModel);
      
      if (selectedModel === 'infinite') {
        state.scheduledJobs = Scheduler.applyBackwardsInfinite(state.scheduledJobs, state.activeScale);
        state.notify();
      } else if (selectedModel === 'finite') {
        const nowWorkingHour = state.dateToWorkingHour(new Date());
        state.scheduledJobs = Scheduler.applyForwardsFinite(state.scheduledJobs, state.activeScale, nowWorkingHour, state.workCenters);
        state.notify();
      }
    });

    // 2. AI Optimize (APS) Button
    const btnAIOptimize = document.getElementById('btn-ai-optimize');
    if (btnAIOptimize) {
      btnAIOptimize.addEventListener('click', () => {
        this.showBacklogSelectionModal(btnAIOptimize);
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

    // 4. Resources Sidebar Show/Hide Toggle
    const btnToggleResources = document.getElementById('btn-toggle-resources');
    const btnHideSidebar = document.getElementById('btn-hide-sidebar');
    
    const toggleResources = () => {
      const mainLayout = document.querySelector('.main-layout');
      mainLayout.classList.toggle('hide-resources');
      
      const isHidden = mainLayout.classList.contains('hide-resources');
      if (btnToggleResources) {
        if (isHidden) {
          btnToggleResources.textContent = 'Show Resources';
          btnToggleResources.classList.add('active');
        } else {
          btnToggleResources.textContent = 'Hide Resources';
          btnToggleResources.classList.remove('active');
        }
      }
      
      const btnToggleResourcesHeader = document.getElementById('btn-toggle-resources-header');
      if (btnToggleResourcesHeader) {
        if (isHidden) {
          btnToggleResourcesHeader.style.background = 'rgba(255, 255, 255, 0.05)';
          btnToggleResourcesHeader.style.borderColor = 'var(--border-glass)';
          btnToggleResourcesHeader.style.color = 'var(--text-secondary)';
        } else {
          btnToggleResourcesHeader.style.background = 'rgba(0, 242, 254, 0.1)';
          btnToggleResourcesHeader.style.borderColor = 'var(--accent-teal)';
          btnToggleResourcesHeader.style.color = 'var(--accent-teal)';
        }
      }
      
      // Force redraw Gantt to resize cards to the expanded planning board
      this.gantt.render();
    };

    if (btnToggleResources) {
      btnToggleResources.addEventListener('click', toggleResources);
    }
    const btnToggleResourcesHeader = document.getElementById('btn-toggle-resources-header');
    if (btnToggleResourcesHeader) {
      btnToggleResourcesHeader.addEventListener('click', toggleResources);
    }
    if (btnHideSidebar) {
      btnHideSidebar.addEventListener('click', toggleResources);
    }

    // 4b. Backlog Sidebar Show/Hide Toggle
    const btnToggleBacklog = document.getElementById('btn-toggle-backlog');
    const btnToggleBacklogHeader = document.getElementById('btn-toggle-backlog-header');
    const btnCollapseBacklogX = document.getElementById('btn-collapse-backlog-x');
    
    const toggleBacklog = () => {
      const mainLayout = document.querySelector('.main-layout');
      mainLayout.classList.toggle('hide-backlog');
      
      const isHidden = mainLayout.classList.contains('hide-backlog');
      if (btnToggleBacklog) {
        if (isHidden) {
          btnToggleBacklog.textContent = 'Show Backlog';
        } else {
          btnToggleBacklog.textContent = 'Hide Backlog';
        }
      }
      if (btnToggleBacklogHeader) {
        if (isHidden) {
          btnToggleBacklogHeader.style.background = 'rgba(255, 255, 255, 0.05)';
          btnToggleBacklogHeader.style.borderColor = 'var(--border-glass)';
          btnToggleBacklogHeader.style.color = 'var(--text-secondary)';
        } else {
          btnToggleBacklogHeader.style.background = 'rgba(0, 242, 254, 0.1)';
          btnToggleBacklogHeader.style.borderColor = 'var(--accent-teal)';
          btnToggleBacklogHeader.style.color = 'var(--accent-teal)';
        }
      }
      
      // Force redraw Gantt to resize cards to the expanded planning board
      this.gantt.render();
    };

    if (btnToggleBacklog) {
      btnToggleBacklog.addEventListener('click', toggleBacklog);
    }
    if (btnToggleBacklogHeader) {
      btnToggleBacklogHeader.addEventListener('click', toggleBacklog);
    }
    if (btnCollapseBacklogX) {
      btnCollapseBacklogX.addEventListener('click', toggleBacklog);
    }

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

    // 12. Toggle Task Dependency Lines (Show/Hide)
    const btnToggleDep = document.getElementById('btn-toggle-dep-lines');
    const depText = document.getElementById('dep-lines-text');

    const updateDepButtonUI = () => {
      const isShow = state.showDependencyLines !== false;
      if (btnToggleDep) {
        if (isShow) {
          btnToggleDep.style.background = 'rgba(0, 242, 254, 0.15)';
          btnToggleDep.style.borderColor = 'var(--accent-teal)';
          btnToggleDep.style.color = 'var(--accent-teal)';
          if (depText) depText.textContent = 'เส้นเชื่อมโยง: ON';
        } else {
          btnToggleDep.style.background = 'rgba(255, 255, 255, 0.05)';
          btnToggleDep.style.borderColor = 'var(--border-glass)';
          btnToggleDep.style.color = 'var(--text-secondary)';
          if (depText) depText.textContent = 'เส้นเชื่อมโยง: OFF';
        }
      }
    };

    if (btnToggleDep) {
      btnToggleDep.addEventListener('click', () => {
        state.toggleDependencyLines();
        updateDepButtonUI();
      });
    }

    // 12b. Toggle Hide/Unhide unused Work Centers (respects current Priority/Project filters)
    const btnToggleHideUnusedWc = document.getElementById('btn-toggle-hide-unused-wc');
    const hideUnusedWcText = document.getElementById('hide-unused-wc-text');

    const updateHideUnusedWcButtonUI = () => {
      const isHiding = !state.showAllWorkCenters;
      if (btnToggleHideUnusedWc) {
        if (isHiding) {
          btnToggleHideUnusedWc.style.background = 'rgba(0, 242, 254, 0.15)';
          btnToggleHideUnusedWc.style.borderColor = 'var(--accent-teal)';
          btnToggleHideUnusedWc.style.color = 'var(--accent-teal)';
          if (hideUnusedWcText) hideUnusedWcText.textContent = 'WC ว่าง: ซ่อน';
        } else {
          btnToggleHideUnusedWc.style.background = 'rgba(255, 255, 255, 0.05)';
          btnToggleHideUnusedWc.style.borderColor = 'var(--border-glass)';
          btnToggleHideUnusedWc.style.color = 'var(--text-secondary)';
          if (hideUnusedWcText) hideUnusedWcText.textContent = 'WC ว่าง: แสดง';
        }
      }
      const checkShowAllWc = document.getElementById('check-show-all-wc');
      if (checkShowAllWc) checkShowAllWc.checked = state.showAllWorkCenters;
    };

    if (btnToggleHideUnusedWc) {
      btnToggleHideUnusedWc.addEventListener('click', () => {
        state.showAllWorkCenters = !state.showAllWorkCenters;
        updateHideUnusedWcButtonUI();
        state.notify();
      });
    }

    state.subscribe(() => {
      updateDepButtonUI();
      updateHideUnusedWcButtonUI();
    });
    updateDepButtonUI();
    updateHideUnusedWcButtonUI();

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
          <div style="background: rgba(0, 242, 254, 0.04); border: 1px solid rgba(0, 242, 254, 0.2); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
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
    console.log('[AI Auto] now:', now, 'nowWorkingHour:', nowWorkingHour);
    const optimized = Scheduler.runAISimulation(
      backlogToOptimize, 
      state.scheduledJobs, 
      state.activeScale, 
      nowWorkingHour, 
      state.workCenters, 
      state.lockedProjects
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

        // Remove jobs from backlog that are now scheduled (only if they were selected!)
        state.workOrders = state.workOrders.filter(wo => {
          const isScheduledDirect = optimized.some(o => o.woId === wo.id || o.id === wo.id);
          const isScheduledNested = optimized.some(o => o.isNest && state.nests[o.id]?.jobIds.includes(wo.id));
          const wasSelected = selectedWOIds.includes(wo.id);
          return !(wasSelected && (isScheduledDirect || isScheduledNested));
        });

        // If updateTargets is true, update dueHour of late jobs (only those originally on board)
        if (updateTargets) {
          lateJobsOnBoard.forEach(job => {
            const finish = job.startHour + job.estHours;
            const targetWOId = job.woId || job.id;
            
            const dFinish = state.workingHourToDate(finish);
            const nextDay = new Date(dFinish.getFullYear(), dFinish.getMonth(), dFinish.getDate() + 1, 17, 0, 0);
            const newDueHour = state.dateToWorkingHour(nextDay);

            // 1. Update in backlog workOrders
            const wo = state.workOrders.find(w => w.id === targetWOId);
            if (wo) {
              if (wo.originalDueHour === undefined) {
                wo.originalDueHour = wo.dueHour;
              }
              wo.dueHour = newDueHour;
            }
            
            // 2. Update in optimized array directly so it is not overwritten!
            optimized.forEach(oj => {
              if (oj.woId === targetWOId || oj.id === targetWOId) {
                if (oj.originalDueHour === undefined) {
                  oj.originalDueHour = oj.dueHour;
                }
                oj.dueHour = newDueHour;
              }
            });
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

        // Save plan to file so the new start dates and assignments persist!
        state.savePlanToFile();
        state.saveWorkOrdersToFile();

        // Adjust Gantt chart view to Fit all optimized tasks
        if (this.gantt && optimized.length > 0) {
          this.gantt.fitTasks(optimized);
        }

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

    modal.querySelector('#btn-confirm-apply-ai').addEventListener('click', () => {
      modal.remove();
      
      // 1. Apply schedule to board immediately
      try {
        applySchedule(lateJobsOnBoard.length > 0);
      } catch (err) {
        console.error('Error applying AI schedule:', err);
      }
    });
  }

  renderAll() {
    this.workflow.render();
    
    if (state.ganttMode === 'assembly') {
      if (this.assemblyTree) this.assemblyTree.show();
    } else {
      if (this.assemblyTree) this.assemblyTree.hide();
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
}

// Start application when DOM loads
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
