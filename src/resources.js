import { getPriorityWeight } from './scheduler.js';
import { getJobPriority, isJobPriorityVisible, isJobProjectVisible, isJobPdRangeVisible } from './gantt.js';

function parseColorToHex(colorStr) {
  if (!colorStr) return '#0284c7';
  if (colorStr.startsWith('#')) {
    if (colorStr.length === 4) {
      return '#' + colorStr[1] + colorStr[1] + colorStr[2] + colorStr[2] + colorStr[3] + colorStr[3];
    }
    return colorStr.slice(0, 7);
  }
  const s = String(colorStr).toLowerCase();
  if (s.includes('red') || s.includes('ef4444')) return '#ef4444';
  if (s.includes('teal') || s.includes('0284c7')) return '#0284c7';
  if (s.includes('green') || s.includes('16a34a')) return '#16a34a';
  if (s.includes('orange') || s.includes('ea580c')) return '#ea580c';
  if (s.includes('purple') || s.includes('7c3aed')) return '#7c3aed';
  if (s.includes('secondary') || s.includes('64748b')) return '#64748b';
  return '#0284c7';
}

export class ResourcesController {
  constructor(state) {
    this.state = state;
    this.activeToolTab = 'nest'; // 'nest' | 'split'
    this.activeRightTab = 'resources'; // 'resources' | 'pdrange' | 'machinelink'
    this.showingPieView = false;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.oeeList = document.getElementById('oee-list');
    this.oeePieView = document.getElementById('oee-pie-view');

    // Tools tabs
    this.toolTabNest = document.getElementById('tool-tab-nest');
    this.toolTabSplit = document.getElementById('tool-tab-split');
    this.nestPanel = document.getElementById('nest-tool-panel');
    this.splitPanel = document.getElementById('split-tool-panel');
    
    // Nest Tool UI
    this.nestCandidatesList = document.getElementById('nest-candidates-list');
    this.btnCreateNest = document.getElementById('btn-create-nest');

    // Split Tool UI
    this.splitJobSelect = document.getElementById('split-job-select');
    this.splitPreviewBox = document.getElementById('split-preview-box');
    this.splitOrigQty = document.getElementById('split-orig-qty');
    this.splitNewQty = document.getElementById('split-new-qty');
    this.splitOrigHours = document.getElementById('split-orig-hours');
    this.splitNewHours = document.getElementById('split-new-hours');
    this.btnExecuteSplit = document.getElementById('btn-execute-split');

    // Sidebar Right Tabs
    this.tabRightResources = document.getElementById('tab-right-resources');
    this.tabRightPriority = document.getElementById('tab-right-priority');
    this.tabRightProject = document.getElementById('tab-right-project');
    this.tabRightGenka = document.getElementById('tab-right-pdrange');
    this.tabRightMachineLink = document.getElementById('tab-right-machinelink');
    this.panelRightResources = document.getElementById('panel-right-resources');
    this.panelRightPriority = document.getElementById('panel-right-priority');
    this.panelRightProject = document.getElementById('panel-right-project');
    this.panelRightGenka = document.getElementById('panel-right-pdrange');
    this.panelRightMachineLink = document.getElementById('panel-right-machinelink');
    
    // Dynamic Priority Filters Container
    this.priorityFiltersContainer = document.getElementById('priority-filters-container');
    this.projectFiltersContainer = document.getElementById('project-filters-container');
  }

  bindEvents() {
    this.toolTabNest.addEventListener('click', () => this.switchToolTab('nest'));
    this.toolTabSplit.addEventListener('click', () => this.switchToolTab('split'));
    
    // Nest actions
    this.btnCreateNest.addEventListener('click', () => this.executeNesting());
    
    // Split actions
    this.splitJobSelect.addEventListener('change', () => this.previewSplit());
    this.btnExecuteSplit.addEventListener('click', () => this.executeSplit());

    // Sidebar Right Tab actions
    this.tabRightResources.addEventListener('click', () => this.switchRightTab('resources'));
    if (this.tabRightPriority) {
      this.tabRightPriority.addEventListener('click', () => this.switchRightTab('priority'));
    }
    if (this.tabRightProject) {
      this.tabRightProject.addEventListener('click', () => this.switchRightTab('project'));
    }
    this.tabRightGenka.addEventListener('click', () => this.switchRightTab('pdrange'));
    this.tabRightMachineLink.addEventListener('click', () => this.switchRightTab('machinelink'));

    // Resource usage pie chart - toggles the sidebar between the OEE list and the pie view
    this.btnResourcePie = document.getElementById('btn-resource-pie');
    if (this.btnResourcePie) {
      this.btnResourcePie.addEventListener('click', () => {
        this.showingPieView = !this.showingPieView;
        this.renderOEE();
      });
    }

    // PD Range Filter Events
    const btnAddPdRange = document.getElementById('btn-add-pdrange');
    const inputPdRange = document.getElementById('input-pdrange');
    if (btnAddPdRange && inputPdRange) {
      btnAddPdRange.addEventListener('click', () => {
        const val = inputPdRange.value.trim().toUpperCase();
        if (!val) return;
        
        let start = val, end = null;
        if (val.includes('-')) {
          const parts = val.split('-');
          start = parts[0].trim();
          end = parts[1].trim();
        }
        
        // Prevent duplicate exact same ranges
        const exists = this.state.activePdRanges.some(r => r.start === start && r.end === end);
        if (!exists) {
          this.state.activePdRanges.push({ start, end, enabled: true });
          inputPdRange.value = '';
          this.state.notify();
        }
      });
      inputPdRange.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') btnAddPdRange.click();
      });
    }

    document.getElementById('btn-pdrange-select-all')?.addEventListener('click', () => {
      this.state.activePdRanges.forEach(r => r.enabled = true);
      this.state.notify();
    });
    document.getElementById('btn-pdrange-deselect-all')?.addEventListener('click', () => {
      this.state.activePdRanges.forEach(r => r.enabled = false);
      this.state.notify();
    });
    document.getElementById('btn-pdrange-clear-all')?.addEventListener('click', () => {
      this.state.activePdRanges = [];
      this.state.notify();
    });

    // Priority filter Select All / Deselect All
    document.getElementById('btn-priority-select-all')?.addEventListener('click', () => {
      Object.keys(this.state.activePriorities).forEach(k => { this.state.activePriorities[k] = true; });
      this.state.notify();
    });
    document.getElementById('btn-priority-deselect-all')?.addEventListener('click', () => {
      Object.keys(this.state.activePriorities).forEach(k => { this.state.activePriorities[k] = false; });
      this.state.notify();
    });

    // Project filter Select All / Deselect All
    document.getElementById('btn-project-select-all')?.addEventListener('click', () => {
      Object.keys(this.state.activeProjects).forEach(k => { this.state.activeProjects[k] = true; });
      this.state.notify();
    });
    document.getElementById('btn-project-deselect-all')?.addEventListener('click', () => {
      Object.keys(this.state.activeProjects).forEach(k => { this.state.activeProjects[k] = false; });
      this.state.notify();
    });

    // Work Center filter Select All / Deselect All
    document.getElementById('btn-wc-select-all')?.addEventListener('click', () => {
      Object.keys(this.state.activeWorkCenters).forEach(k => { this.state.activeWorkCenters[k] = true; });
      this.state.notify();
    });
    document.getElementById('btn-wc-deselect-all')?.addEventListener('click', () => {
      Object.keys(this.state.activeWorkCenters).forEach(k => { this.state.activeWorkCenters[k] = false; });
      this.state.notify();
    });
    document.getElementById('btn-wc-deselect-zero')?.addEventListener('click', () => {
      Object.keys(this.state.activeWorkCenters).forEach(k => {
        if (this.state.getMachineOEE(k).oee === 0) {
          this.state.activeWorkCenters[k] = false;
        }
      });
      this.state.notify();
    });

    // Events for dynamic priority/project filters are bound during dynamic rendering
  }

  switchToolTab(tab) {
    this.activeToolTab = tab;
    if (tab === 'nest') {
      this.toolTabNest.classList.add('active');
      this.toolTabSplit.classList.remove('active');
      this.nestPanel.classList.remove('hidden');
      this.splitPanel.classList.add('hidden');
    } else {
      this.toolTabNest.classList.remove('active');
      this.toolTabSplit.classList.add('active');
      this.nestPanel.classList.add('hidden');
      this.splitPanel.classList.remove('hidden');
    }
  }

  switchRightTab(tab) {
    this.activeRightTab = tab;
    const tabs = [this.tabRightResources, this.tabRightPriority, this.tabRightProject, this.tabRightGenka, this.tabRightMachineLink];
    const panels = [this.panelRightResources, this.panelRightPriority, this.panelRightProject, this.panelRightGenka, this.panelRightMachineLink];
    
    tabs.forEach(t => { if (t) t.classList.remove('active'); });
    panels.forEach(p => { if (p) p.classList.add('hidden'); });
    
    if (tab === 'resources') {
      this.tabRightResources.classList.add('active');
      this.panelRightResources.classList.remove('hidden');
    } else if (tab === 'priority') {
      if (this.tabRightPriority) this.tabRightPriority.classList.add('active');
      if (this.panelRightPriority) this.panelRightPriority.classList.remove('hidden');
    } else if (tab === 'project') {
      if (this.tabRightProject) this.tabRightProject.classList.add('active');
      if (this.panelRightProject) this.panelRightProject.classList.remove('hidden');
    } else if (tab === 'pdrange') {
      this.tabRightGenka.classList.add('active');
      this.panelRightGenka.classList.remove('hidden');
    } else if (tab === 'machinelink') {
      this.tabRightMachineLink.classList.add('active');
      this.panelRightMachineLink.classList.remove('hidden');
    }
    this.render();
  }

  renderPriorityFilters() {
    if (!this.priorityFiltersContainer) return;
    
    // 1. Get all unique priorities from state.scheduledJobs and state.workOrders
    const priorities = new Set();
    this.state.scheduledJobs.forEach(job => {
      const p = getJobPriority(job, this.state);
      priorities.add(p);
    });
    this.state.workOrders.forEach(wo => {
      const p = (wo.priority !== undefined && wo.priority !== null && String(wo.priority).trim() !== '') ? String(wo.priority).trim() : 'Normal';
      priorities.add(p);
    });
    
    // Sort priorities by numeric priority weight ascending (lower numbers first)
    const sortedPriorities = Array.from(priorities).sort((a, b) => {
      const pA = getPriorityWeight(a);
      const pB = getPriorityWeight(b);
      if (pA !== pB) return pA - pB;
      return a.localeCompare(b);
    });
    
    // 2. Count jobs for each priority
    const counts = {};
    sortedPriorities.forEach(p => counts[p] = 0);
    this.state.scheduledJobs.forEach(job => {
      const p = getJobPriority(job, this.state);
      counts[p]++;
    });
    this.state.workOrders.forEach(wo => {
      const p = (wo.priority !== undefined && wo.priority !== null && String(wo.priority).trim() !== '') ? String(wo.priority).trim() : 'Normal';
      counts[p]++;
    });
    
    // 3. Update state.activePriorities keys. If a key is new, default to true.
    sortedPriorities.forEach(p => {
      if (this.state.activePriorities[p] === undefined) {
        this.state.activePriorities[p] = true;
      }
    });
    
    // Clean up old priorities that are no longer in scheduledJobs or workOrders
    Object.keys(this.state.activePriorities).forEach(p => {
      if (!priorities.has(p)) {
        delete this.state.activePriorities[p];
      }
    });

    // 4. Generate HTML elements
    this.priorityFiltersContainer.innerHTML = '';
    
    if (sortedPriorities.length === 0) {
      this.priorityFiltersContainer.innerHTML = '<div style="font-size: 10px; color: var(--text-secondary); text-align: center; padding: 10px;">No priorities found.</div>';
      return;
    }
    
    sortedPriorities.forEach(p => {
      const label = document.createElement('label');
      label.style.cssText = 'display: flex; align-items: flex-start; gap: 8px; cursor: pointer; user-select: none; margin-bottom: 6px; padding: 4px 6px; border-radius: 6px; transition: background 0.2s;';
      
      const isChecked = this.state.activePriorities[p] !== false;
      const count = counts[p] || 0;
      
      // Select bullet color based on priority name or custom priorityColors
      let dotColor = 'var(--text-secondary)';
      let shadow = '';
      const pLower = p.toLowerCase();
      if (this.state.priorityColors && this.state.priorityColors[p]) {
        dotColor = this.state.priorityColors[p];
        shadow = `box-shadow: 0 0 8px ${dotColor};`;
      } else if (pLower.includes('hot') || pLower.includes('ด่วน') || pLower.includes('urgent') || pLower.includes('critical')) {
        dotColor = 'var(--accent-red)';
        shadow = 'box-shadow: 0 0 8px var(--accent-red);';
      } else if (pLower.includes('normal') || pLower.includes('ปกติ') || pLower.includes('medium')) {
        dotColor = 'var(--accent-teal)';
        shadow = 'box-shadow: 0 0 8px var(--accent-teal);';
      } else if (pLower.includes('low') || pLower.includes('ต่ำ')) {
        dotColor = 'var(--text-secondary)';
      } else {
        // Generate a pseudo-random color based on hash of name
        let hash = 0;
        for (let i = 0; i < p.length; i++) {
          hash = p.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        dotColor = '#' + '00000'.substring(0, 6 - c.length) + c;
      }
      const hexColor = parseColorToHex(dotColor);

      // Find customer(s) associated with this priority
      const pCustomers = new Set();
      this.state.scheduledJobs.forEach(j => {
        const jobP = String(j.priority || this.state.workOrders?.find(wo => wo.id === j.woId)?.priority || 'Normal').trim();
        if (jobP === String(p).trim()) {
          const cust = j.customer || this.state.workOrders?.find(wo => wo.id === j.woId)?.customer;
          if (cust && cust.trim() && cust !== 'Unknown') pCustomers.add(cust.trim());
        }
      });
      if (this.state.workOrders) {
        this.state.workOrders.forEach(wo => {
          const woP = String(wo.priority || 'Normal').trim();
          if (woP === String(p).trim()) {
            if (wo.customer && wo.customer.trim() && wo.customer !== 'Unknown') pCustomers.add(wo.customer.trim());
          }
        });
      }
      const customerList = Array.from(pCustomers);
      const customerStr = customerList.length > 0 ? customerList.join(', ') : '';

      // Calculate production date range & find the last task for this priority from scheduled jobs
      // (jobs on a Work Center hidden via the Resources tab checkboxes don't count towards Finish Date)
      const priorityJobs = this.state.scheduledJobs.filter(j => {
        const jobP = String(j.priority || this.state.workOrders?.find(wo => wo.id === j.woId)?.priority || 'Normal').trim();
        return jobP === String(p).trim() && typeof j.startHour === 'number' && !isNaN(j.startHour) && this.state.activeWorkCenters[j.machine] !== false;
      });
      let dateRangeStr = '-';
      let lastTaskStr = 'ยังไม่มีงานบนกระดาน';
      let fullTooltip = `Priority: ${p}${customerStr ? ' (' + customerStr + ')' : ''} - ยังไม่มีแผนงานผลิต`;
      let minStartHour = Infinity;
      let maxFinishHour = -Infinity;
      let lastJob = null;

      if (priorityJobs.length > 0) {
        priorityJobs.forEach(j => {
          const est = (typeof j.estHours === 'number' && j.estHours > 0) ? j.estHours : 1.0;
          const finish = j.startHour + est;
          if (j.startHour < minStartHour) minStartHour = j.startHour;
          if (finish > maxFinishHour) {
            maxFinishHour = finish;
            lastJob = j;
          }
        });

        const dStart = this.state.workingHourToDate(minStartHour);
        const dEnd = this.state.workingHourToDate(maxFinishHour);
        if (dStart && !isNaN(dStart.getTime()) && dEnd && !isNaN(dEnd.getTime())) {
          const sDay = dStart.getDate();
          const sMonth = dStart.getMonth() + 1;
          const sYear = String(dStart.getFullYear()).slice(-2);
          const sTime = `${String(dStart.getHours()).padStart(2, '0')}:${String(dStart.getMinutes()).padStart(2, '0')}`;
          
          const eDay = dEnd.getDate();
          const eMonth = dEnd.getMonth() + 1;
          const eYear = String(dEnd.getFullYear()).slice(-2);
          const eTime = `${String(dEnd.getHours()).padStart(2, '0')}:${String(dEnd.getMinutes()).padStart(2, '0')}`;

          const startDayMidnight = new Date(dStart.getFullYear(), dStart.getMonth(), dStart.getDate());
          const endDayMidnight = new Date(dEnd.getFullYear(), dEnd.getMonth(), dEnd.getDate());
          const calDays = Math.max(1, Math.round((endDayMidnight - startDayMidnight) / (1000 * 60 * 60 * 24)) + 1);
          const daySuffix = calDays === 1 ? '1 วัน' : `${calDays} วัน`;
          
          dateRangeStr = `${sDay}/${sMonth}/${sYear} - ${eDay}/${eMonth}/${eYear} (${daySuffix})`;
          lastTaskStr = `Last Task: ${eDay}/${sMonth}/${eYear} ${eTime}`;
          const lastTaskDetail = lastJob ? `\n• Last Task: ${lastJob.woId || lastJob.id} - ${lastJob.stepName || lastJob.name || lastJob.partName || ''} (${this.state.getMachineDisplayName(lastJob.machine)})` : '';
          fullTooltip = `Priority: ${p}${customerStr ? ' (Customer: ' + customerStr + ')' : ''}\n• แผนการผลิต: ${sDay}/${sMonth}/${dStart.getFullYear()} ${sTime} ถึง ${eDay}/${eMonth}/${dEnd.getFullYear()} ${eTime} (รวม ${calDays} วัน)${lastTaskDetail}\n(คลิกที่วันเสร็จเพื่อเลื่อน Gantt ไปยัง Last Task)`;
        }
      }
      
      label.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; margin-top: 2px;">
          <input type="checkbox" style="width: auto; margin: 0; cursor: pointer;" ${isChecked ? 'checked' : ''} title="Hide / Unhide Priority (ซ่อน/แสดง)">
          <div style="position: relative; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;" title="Change Task Bar Color (คลิกเปลี่ยนสีแถบงาน)">
            <input type="color" class="priority-color-input" data-priority="${p}" value="${hexColor}" style="position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer; left: 0; top: 0; padding: 0; margin: 0; border: none; z-index: 2;">
            <span class="color-swatch-icon" style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 3px; background-color: ${dotColor}; color: #ffffff; font-size: 8px; border: 1px solid rgba(255,255,255,0.4); box-shadow: 0 1px 3px rgba(0,0,0,0.3); pointer-events: none;" title="Change Task Bar Color (คลิกเปลี่ยนสีแถบงาน)">🎨</span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; min-width: 0; flex: 1; margin-left: 2px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">
            <div style="display: flex; align-items: baseline; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p}${customerStr ? ' - ' + customerStr : ''}">
              <span style="font-weight: bold; color: ${dotColor}; font-size: 11.5px; flex-shrink: 0;">${p}</span>
              ${customerStr ? `<span style="font-size: 10px; color: var(--text-primary); opacity: 0.85; margin-left: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${customerStr}</span>` : ''}
            </div>
            <span style="font-size: 10px; color: var(--text-secondary); flex-shrink: 0; margin-left: 4px;">(${count})</span>
          </div>
          <div class="priority-last-task-btn" style="display: flex; align-items: center; gap: 3px; font-size: 9px; font-weight: 700; color: ${maxFinishHour > -Infinity ? 'var(--accent-green)' : 'var(--text-secondary)'}; margin-top: 2px; cursor: pointer;" title="${fullTooltip}">
            <span>🏁 ${lastTaskStr}</span>
          </div>
          <div style="font-size: 8px; color: var(--text-secondary); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${fullTooltip}">
            <span>${dateRangeStr}</span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; margin-left: 6px; align-self: flex-start;">
          <button class="edit-btn" title="แก้ไขชื่อ Priority นี้" style="background: none; border: none; color: var(--accent-teal); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; transition: opacity 0.2s;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-teal);">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="delete-btn" title="ลบข้อมูลงานทั้งหมดที่มี Priority นี้" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; transition: color 0.2s;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-trash" style="color: var(--accent-red); filter: drop-shadow(0 0 2px rgba(255, 51, 51, 0.25));">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      // Bind click on Last Task badge to navigate Gantt chart
      const lastTaskBtn = label.querySelector('.priority-last-task-btn');
      if (lastTaskBtn && maxFinishHour > -Infinity) {
        lastTaskBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const config = this.state.ganttController ? this.state.ganttController.getScaleConfig(this.state.activeScale) : { totalHours: 48, snapHours: 1 };
          const targetOffset = maxFinishHour - config.totalHours / 2;
          const snap = config.snapHours || 1;
          const snappedOffset = Math.round(targetOffset / snap) * snap;
          this.state.setTimelineOffset(snappedOffset);
        });
      }

      // Bind color picker input event listener
      const colorInput = label.querySelector('.priority-color-input');
      if (colorInput) {
        colorInput.addEventListener('input', (e) => {
          e.stopPropagation();
          const newColor = e.target.value;
          if (!this.state.priorityColors) this.state.priorityColors = {};
          this.state.priorityColors[p] = newColor;
          this.state.savePlanToFile();
          this.state.notify();
        });
      }
      
      // Bind event listener to checkbox
      const checkbox = label.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          this.state.activePriorities[p] = checkbox.checked;
          for (const k in this.state.activePriorities) {
            if (String(k).trim() === String(p).trim()) {
              this.state.activePriorities[k] = checkbox.checked;
            }
          }
          this.state.notify();
        });
      }

      // Bind edit button event listener
      const editBtn = label.querySelector('.edit-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const newName = prompt(`แก้ไขชื่อ Priority "${p}" เป็น:`, p);
        if (newName === null) return;
        const trimmed = newName.trim();
        if (!trimmed || trimmed === p) return;

        // 1. Rename on scheduledJobs
        this.state.scheduledJobs.forEach(j => {
          if (j.priority === p) j.priority = trimmed;
        });
        // 2. Rename on workOrders
        this.state.workOrders.forEach(w => {
          if (w.priority === p) w.priority = trimmed;
        });
        // 3. Carry over active/visibility state and custom color to the new name
        if (this.state.activePriorities[p] !== undefined) {
          this.state.activePriorities[trimmed] = this.state.activePriorities[p];
          delete this.state.activePriorities[p];
        }
        if (this.state.priorityColors && this.state.priorityColors[p]) {
          this.state.priorityColors[trimmed] = this.state.priorityColors[p];
          delete this.state.priorityColors[p];
        }

        // 4. Save files
        this.state.savePlanToFile();
        this.state.saveWorkOrdersToFile();

        // 5. Notify to re-render
        this.state.notify();
      });

      // Bind delete button event listener
      const deleteBtn = label.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const confirmMsg = `คุณต้องการลบข้อมูลงานทั้งหมดที่มีระดับความสำคัญ (Priority): "${p}" ใช่หรือไม่?\n\n*คำเตือน: การดำเนินการนี้จะลบใบสั่งผลิตใน Backlog และคิวงานบน Gantt ทั้งหมดที่มีระดับความสำคัญนี้ออกไปอย่างถาวร`;
        if (confirm(confirmMsg)) {
          // 1. Filter scheduledJobs
          this.state.scheduledJobs = this.state.scheduledJobs.filter(j => j.priority !== p);
          // 2. Filter workOrders
          this.state.workOrders = this.state.workOrders.filter(w => w.priority !== p);

          // 3. Save files
          this.state.savePlanToFile();
          this.state.saveWorkOrdersToFile();

          // 4. Notify to re-render
          this.state.notify();
        }
      });

      this.priorityFiltersContainer.appendChild(label);
    });
  }

  renderProjectFilters() {
    if (!this.projectFiltersContainer) return;
    
    // 1. Get all unique projects from state.scheduledJobs and state.workOrders
    const projects = new Set();
    this.state.scheduledJobs.forEach(job => {
      const proj = job.project || 'General';
      projects.add(proj);
    });
    this.state.workOrders.forEach(wo => {
      const proj = wo.project || 'General';
      projects.add(proj);
    });
    
    // Sort them so the list is stable
    const sortedProjects = Array.from(projects).sort();
    
    // 2. Count jobs for each project
    const counts = {};
    sortedProjects.forEach(proj => counts[proj] = 0);
    this.state.scheduledJobs.forEach(job => {
      const proj = job.project || 'General';
      counts[proj]++;
    });
    this.state.workOrders.forEach(wo => {
      const proj = wo.project || 'General';
      counts[proj]++;
    });
    
    // 3. Update state.activeProjects keys. If a key is new, default to true.
    sortedProjects.forEach(proj => {
      if (this.state.activeProjects[proj] === undefined) {
        this.state.activeProjects[proj] = true;
      }
    });
    
    // Clean up old projects that are no longer in scheduledJobs or workOrders
    Object.keys(this.state.activeProjects).forEach(proj => {
      if (!projects.has(proj)) {
        delete this.state.activeProjects[proj];
      }
    });

    // 4. Generate HTML elements
    this.projectFiltersContainer.innerHTML = '';
    
    if (sortedProjects.length === 0) {
      this.projectFiltersContainer.innerHTML = '<div style="font-size: 10px; color: var(--text-secondary); text-align: center; padding: 10px;">No projects found.</div>';
      return;
    }
    
    sortedProjects.forEach(proj => {
      const label = document.createElement('label');
      label.style.cssText = 'display: flex; align-items: flex-start; gap: 8px; cursor: pointer; user-select: none; margin-bottom: 6px; padding: 4px 6px; border-radius: 6px; transition: background 0.2s;';
      
      const isChecked = this.state.activeProjects[proj] !== false;
      const isLocked = this.state.isProjectLocked(proj);
      const count = counts[proj] || 0;
      
      // Generate a pseudo-random color based on hash of name or custom projectColors
      let dotColor = 'var(--accent-teal)';
      if (this.state.projectColors && this.state.projectColors[proj]) {
        dotColor = this.state.projectColors[proj];
      } else {
        let hash = 0;
        for (let i = 0; i < proj.length; i++) {
          hash = proj.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        dotColor = '#' + '00000'.substring(0, 6 - c.length) + c;
      }
      const hexColor = parseColorToHex(dotColor);
      
      const lockIconSvg = isLocked
        ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
        : `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
      const lockTitle = isLocked
        ? `โครงการ "${proj}" ถูกล็อคแผนงานไว้ (คลิกเพื่อปลดล็อค / Unlock)`
        : `คลิกเพื่อล็อคแผนงานโครงการ "${proj}" ป้องกันการขยับแผน (Lock Project)`;
      const lockStyle = isLocked
        ? 'margin-left: 6px; background: rgba(239, 68, 68, 0.15); border: none; color: var(--accent-red); cursor: pointer; padding: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 0 2px rgba(255, 51, 51, 0.25));'
        : 'margin-left: 6px; background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center; opacity: 0.6; transition: opacity 0.2s;';

      // Calculate production date range for this project from scheduled jobs
      // (jobs on a Work Center hidden via the Resources tab checkboxes don't count towards Finish Date)
      const projJobs = this.state.scheduledJobs.filter(j => (j.project || 'General') === proj && typeof j.startHour === 'number' && !isNaN(j.startHour) && this.state.activeWorkCenters[j.machine] !== false);
      let dateRangeStr = '-';
      let fullTooltip = 'ยังไม่มีแผนงานผลิต';
      if (projJobs.length > 0) {
        const minStartHour = Math.min(...projJobs.map(j => j.startHour));
        const maxFinishHour = Math.max(...projJobs.map(j => j.startHour + ((typeof j.estHours === 'number' && j.estHours > 0) ? j.estHours : 1.0)));
        const dStart = this.state.workingHourToDate(minStartHour);
        const dEnd = this.state.workingHourToDate(maxFinishHour);
        if (dStart && !isNaN(dStart.getTime()) && dEnd && !isNaN(dEnd.getTime())) {
          const sDay = dStart.getDate();
          const sMonth = dStart.getMonth() + 1;
          const sYear = String(dStart.getFullYear()).slice(-2);
          const sTime = `${String(dStart.getHours()).padStart(2, '0')}:${String(dStart.getMinutes()).padStart(2, '0')}`;
          
          const eDay = dEnd.getDate();
          const eMonth = dEnd.getMonth() + 1;
          const eYear = String(dEnd.getFullYear()).slice(-2);
          const eTime = `${String(dEnd.getHours()).padStart(2, '0')}:${String(dEnd.getMinutes()).padStart(2, '0')}`;

          const startDayMidnight = new Date(dStart.getFullYear(), dStart.getMonth(), dStart.getDate());
          const endDayMidnight = new Date(dEnd.getFullYear(), dEnd.getMonth(), dEnd.getDate());
          const calDays = Math.max(1, Math.round((endDayMidnight - startDayMidnight) / (1000 * 60 * 60 * 24)) + 1);
          const daySuffix = calDays === 1 ? '1 Day' : `${calDays} Days`;
          
          dateRangeStr = `${sDay}/${sMonth}/${sYear} - ${eDay}/${eMonth}/${eYear} (${daySuffix})`;
          fullTooltip = `ช่วงเวลาผลิต: ${sDay}/${sMonth}/${dStart.getFullYear()} ${sTime} ถึง ${eDay}/${eMonth}/${dEnd.getFullYear()} ${eTime} (รวม ${calDays} วัน)`;
        }
      }

      label.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; margin-top: 2px;">
          <input type="checkbox" style="width: auto; margin: 0; cursor: pointer;" ${isChecked ? 'checked' : ''} title="Hide / Unhide Project (ซ่อน/แสดง)">
          <div style="position: relative; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;" title="Change Task Bar Color (คลิกเปลี่ยนสีแถบงาน)">
            <input type="color" class="project-color-input" data-project="${proj}" value="${hexColor}" style="position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer; left: 0; top: 0; padding: 0; margin: 0; border: none; z-index: 2;">
            <span class="color-swatch-icon" style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 3px; background-color: ${dotColor}; color: #ffffff; font-size: 8px; border: 1px solid rgba(255,255,255,0.4); box-shadow: 0 1px 3px rgba(0,0,0,0.3); pointer-events: none;" title="Change Task Bar Color (คลิกเปลี่ยนสีแถบงาน)">🎨</span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; min-width: 0; flex: 1; margin-left: 2px;">
          <span style="font-weight: bold; color: ${dotColor}; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${proj}">${proj}</span>
          <span style="font-size: 8.5px; color: var(--text-secondary); margin-top: 1px; white-space: nowrap;" title="${fullTooltip}">
            <strong style="color: ${dateRangeStr === '-' ? 'var(--text-secondary)' : 'var(--accent-teal)'};">${dateRangeStr}</strong>
          </span>
        </div>
        <span style="font-size: 10px; color: var(--text-secondary); margin-left: 4px; align-self: center;">(${count})</span>
        <button class="lock-btn" style="${lockStyle} align-self: center;" title="${lockTitle}">${lockIconSvg}</button>
        <button class="delete-btn" title="ลบข้อมูลงานทั้งหมดที่มี Project นี้" style="margin-left: 4px; align-self: center; background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; transition: color 0.2s;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-trash" style="color: var(--accent-red); filter: drop-shadow(0 0 2px rgba(255, 51, 51, 0.25));">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;
      
      // Bind color picker input event listener
      const colorInput = label.querySelector('.project-color-input');
      if (colorInput) {
        colorInput.addEventListener('input', (e) => {
          e.stopPropagation();
          const newColor = e.target.value;
          if (!this.state.projectColors) this.state.projectColors = {};
          this.state.projectColors[proj] = newColor;
          this.state.savePlanToFile();
          this.state.notify();
        });
      }
      
      // Bind event listener to checkbox
      const checkbox = label.querySelector('input');
      checkbox.addEventListener('change', () => {
        this.state.activeProjects[proj] = checkbox.checked;
        this.state.notify();
      });

      // Bind lock button event listener
      const lockBtn = label.querySelector('.lock-btn');
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.state.toggleProjectLock(proj);
      });

      // Bind delete button event listener
      const deleteBtn = label.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const confirmMsg = `คุณต้องการลบข้อมูลงานทั้งหมดที่มีเลขที่ SO / Project: "${proj}" ใช่หรือไม่?\n\n*คำเตือน: การดำเนินการนี้จะลบใบสั่งผลิตใน Backlog และคิวงานบน Gantt ทั้งหมดที่มีโครงการนี้ออกไปอย่างถาวร`;
        if (confirm(confirmMsg)) {
          // 1. Filter scheduledJobs
          this.state.scheduledJobs = this.state.scheduledJobs.filter(j => (j.project || 'General') !== proj);
          // 2. Filter workOrders
          this.state.workOrders = this.state.workOrders.filter(w => (w.project || 'General') !== proj);
          
          // 3. Save files
          this.state.savePlanToFile();
          this.state.saveWorkOrdersToFile();
          
          // 4. Notify to re-render
          this.state.notify();
        }
      });
      
      this.projectFiltersContainer.appendChild(label);
    });
  }

  render() {
    this.renderPriorityFilters();
    this.renderProjectFilters();
    if (this.activeRightTab === 'resources') {
      this.renderOEE();
      this.renderNestingCandidates();
      this.renderSplitDropdown();
    } else if (this.activeRightTab === 'priority') {
      // Handled by renderPriorityFilters() above
    } else if (this.activeRightTab === 'project') {
      // Handled by renderProjectFilters() above
    } else if (this.activeRightTab === 'pdrange') {
      this.renderPdRangeFilters();
    } else if (this.activeRightTab === 'machinelink') {
      this.renderMachineLink();
    }
  }

  // Work centers currently visible on the board: either all of them (if the
  // "show all" toggle is on), or only ones with a job actually shown right now -
  // respecting the Priority/Project filters, so a machine whose only jobs are
  // hidden by those filters doesn't show up either. Does NOT account for the
  // manual per-Work-Center checkboxes - use getVisibleMachines() for that.
  getAutoVisibleMachines() {
    let machines = Object.keys(this.state.workCenters);
    if (!this.state.showAllWorkCenters) {
      const usedMachines = new Set(
        this.state.scheduledJobs
          .filter(j => isJobPriorityVisible(j, this.state) && isJobProjectVisible(j, this.state) && isJobPdRangeVisible(j, this.state))
          .map(j => j.machine)
          .filter(Boolean)
      );
      this.state.workOrders.forEach(wo => {
        wo.steps.forEach(step => {
          if (step.machine) usedMachines.add(step.machine);
        });
      });
      machines = machines.filter(m => usedMachines.has(m));
    }
    return machines;
  }

  // Work centers actually shown on the Gantt board: auto-visible ones, further
  // narrowed down by the manual Work Center Filter checkboxes in the Resources tab.
  getVisibleMachines() {
    return this.getAutoVisibleMachines().filter(m => this.state.activeWorkCenters[m] !== false);
  }

  // Render Machine OEE list
  renderOEE() {
    if (this.btnResourcePie) {
      this.btnResourcePie.textContent = this.showingPieView ? '📋' : '🥧';
      this.btnResourcePie.title = this.showingPieView ? 'กลับไปแสดงลิสต์ Work Center' : 'สัดส่วนการใช้งาน Resource (Pie Chart)';
    }
    if (this.showingPieView) {
      this.oeeList.classList.add('hidden');
      this.oeePieView.classList.remove('hidden');
      this.renderResourcePie();
      return;
    }
    this.oeeList.classList.remove('hidden');
    this.oeePieView.classList.add('hidden');

    this.oeeList.innerHTML = '';

    let machines = this.getAutoVisibleMachines();
    // Highest load first
    machines.sort((a, b) => this.state.getMachineOEE(b).util - this.state.getMachineOEE(a).util);

    // Sync activeWorkCenters keys against the full Work Center roster (not just the
    // auto-visible ones) so a manual choice survives a machine being auto-hidden later.
    Object.keys(this.state.workCenters).forEach(m => {
      if (this.state.activeWorkCenters[m] === undefined) {
        this.state.activeWorkCenters[m] = true;
      }
    });
    Object.keys(this.state.activeWorkCenters).forEach(m => {
      if (!this.state.workCenters[m]) {
        delete this.state.activeWorkCenters[m];
      }
    });

    let maxOeeVal = -1;
    let maxUtilVal = -1;
    machines.forEach(machine => {
      const oeeData = this.state.getMachineOEE(machine);
      if (oeeData.oee > maxOeeVal) {
        maxOeeVal = oeeData.oee;
      }
      if (oeeData.util > maxUtilVal) {
        maxUtilVal = oeeData.util;
      }
    });

    const subHeader = document.createElement('div');
    subHeader.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 8.5px; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; border-bottom: 1.5px solid var(--border-glass); padding-bottom: 4px; margin-bottom: 8px; letter-spacing: 0.5px;';
    subHeader.innerHTML = `
      <span style="width: 14px; flex-shrink: 0;"></span>
      <span style="flex: 1; display: flex; justify-content: space-between;">
        <span>Work Center</span>
        <span style="padding-right: 5px;">OEE</span>
      </span>
    `;
    this.oeeList.appendChild(subHeader);

    machines.forEach(machine => {
      const oeeData = this.state.getMachineOEE(machine);
      const item = document.createElement('div');
      item.className = 'oee-item';
      item.style.cursor = 'pointer';
      item.style.userSelect = 'none';
      
      let statusClass = 'active-idle';
      if (oeeData.active === 'Running') statusClass = 'active-running';
      else if (oeeData.active === 'Blocked') statusClass = 'active-blocked';
      else if (oeeData.active === 'Scheduled') statusClass = 'active-scheduled';
      else if (oeeData.active === 'Overtime') statusClass = 'active-overtime';
      else if (oeeData.active === 'Overcap') statusClass = 'active-overcap';

      const isMax = oeeData.oee === maxOeeVal && maxOeeVal > 0;
      const percentColor = isMax ? 'var(--accent-red)' : 'var(--text-primary)';
      const percentWeight = isMax ? 'bold' : 'normal';

      const isMaxUtil = oeeData.util === maxUtilVal && maxUtilVal > 0;
      const barStyleOverride = isMaxUtil ? 'background: var(--accent-red) !important; box-shadow: 0 0 8px rgba(255, 51, 51, 0.4);' : '';

      const isWcChecked = this.state.activeWorkCenters[machine] !== false;
      item.style.display = 'flex';
      item.style.flexDirection = 'row';
      item.style.alignItems = 'center';
      item.style.gap = '6px';
      item.innerHTML = `
        <input type="checkbox" class="wc-visibility-checkbox" style="width: auto; margin: 0; cursor: pointer; flex-shrink: 0;" ${isWcChecked ? 'checked' : ''} title="Hide / Unhide Work Center บนบอร์ด Gantt (ซ่อน/แสดง)">
        <div style="flex: 1; min-width: 0;">
          <div class="oee-info">
            <span class="oee-name">${this.state.getMachineDisplayName(machine)} <span class="badge-status" style="font-size: 8px; color: var(--text-secondary)">(${oeeData.active})</span></span>
            <span class="oee-percent" style="color: ${percentColor}; font-weight: ${percentWeight};">${oeeData.oee}%</span>
          </div>
          <div class="oee-bar-bg" title="Machine Capacity Load: ${oeeData.util}%">
            <div class="oee-bar-fill ${statusClass}" style="width: ${Math.min(100, oeeData.util)}%; ${barStyleOverride}"></div>
          </div>
        </div>
      `;

      const wcCheckbox = item.querySelector('.wc-visibility-checkbox');
      wcCheckbox.addEventListener('click', (e) => e.stopPropagation());
      wcCheckbox.addEventListener('change', () => {
        this.state.activeWorkCenters[machine] = wcCheckbox.checked;
        this.state.notify();
      });

      item.addEventListener('dblclick', () => {
        if (this.state.dailyScheduleController) {
          const machineJobs = this.state.scheduledJobs.filter(j => j.machine === machine);
          let initialDate = null;
          if (machineJobs.length > 0) {
            machineJobs.sort((a, b) => a.startHour - b.startHour);
            initialDate = this.state.workingHourToDate(machineJobs[0].startHour);
          } else {
            initialDate = this.state.getBaseDate();
          }
          this.state.dailyScheduleController.open(machine, initialDate);
        }
      });
      
      this.oeeList.appendChild(item);
    });
  }

  // Build the pie chart of each visible work center's share of total scheduled
  // hours (i.e. how the current workload is distributed across machines), drawn
  // in-place in the sidebar (toggled with the OEE list via renderOEE()).
  renderResourcePie() {
    const container = this.oeePieView;
    if (!container) return;

    const machines = this.getVisibleMachines();
    const hoursByMachine = machines.map(m => {
      const hours = this.state.scheduledJobs
        .filter(j => j.machine === m && isJobPriorityVisible(j, this.state) && isJobProjectVisible(j, this.state) && isJobPdRangeVisible(j, this.state))
        .reduce((sum, j) => sum + (j.estHours > 0 ? j.estHours : 0), 0);
      return { machine: m, name: this.state.getMachineDisplayName(m), hours };
    }).filter(m => m.hours > 0).sort((a, b) => b.hours - a.hours);

    const totalHours = hoursByMachine.reduce((s, m) => s + m.hours, 0);

    if (totalHours <= 0) {
      container.innerHTML = '<div style="padding: 20px 5px; text-align: center; color: var(--text-secondary); font-size: 11px;">ไม่มีงานที่กำลังแสดงอยู่บนบอร์ดตอนนี้</div>';
      return;
    }

    const palette = ['#00f2fe', '#a855f7', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#f97316', '#ef4444', '#22c55e', '#818cf8', '#e879f9', '#94a3b8'];

    const cx = 100, cy = 100, r = 90;
    let angleStart = -Math.PI / 2;
    const slices = hoursByMachine.map((m, i) => {
      const fraction = m.hours / totalHours;
      const angleEnd = angleStart + fraction * Math.PI * 2;
      const x1 = cx + r * Math.cos(angleStart);
      const y1 = cy + r * Math.sin(angleStart);
      const x2 = cx + r * Math.cos(angleEnd);
      const y2 = cy + r * Math.sin(angleEnd);
      const largeArc = (angleEnd - angleStart) > Math.PI ? 1 : 0;
      const color = palette[i % palette.length];
      const path = fraction >= 0.9995
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" />`
        : `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}">
             <title>${m.name}: ${m.hours.toFixed(1)}h (${(fraction * 100).toFixed(1)}%)</title>
           </path>`;
      angleStart = angleEnd;
      return { html: path, color, m, fraction };
    });

    const legendHtml = slices.map(s => `
      <div style="display: flex; align-items: center; gap: 6px; font-size: 10.5px; padding: 3px 0;">
        <span style="width: 9px; height: 9px; border-radius: 2px; background: ${s.color}; flex-shrink: 0;"></span>
        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary);">${s.m.name}</span>
        <span style="font-weight: bold; color: var(--text-secondary);">${(s.fraction * 100).toFixed(1)}%</span>
      </div>
    `).join('');

    container.innerHTML = `
      <div style="display: flex; justify-content: center; margin-bottom: 10px;">
        <svg viewBox="0 0 200 200" width="150" height="150">
          ${slices.map(s => s.html).join('')}
        </svg>
      </div>
      <div style="max-height: 280px; overflow-y: auto;">
        ${legendHtml}
      </div>
      <div style="margin-top: 8px; font-size: 9px; color: var(--text-secondary); text-align: center; border-top: 1px solid var(--border-glass); padding-top: 6px;">รวม ${totalHours.toFixed(1)} ชั่วโมง จาก ${hoursByMachine.length} เครื่องจักรที่แสดงอยู่</div>
    `;
  }

  // Render Nesting Candidates checklist (step-based)
  renderNestingCandidates() {
    this.nestCandidatesList.innerHTML = '';
    
    // Find all laser cutting steps in backlog
    const backlogLaserSteps = [];
    this.state.workOrders.forEach(wo => {
      wo.steps.forEach(s => {
        if (s.machine === 'Lasercut') {
          backlogLaserSteps.push({ id: s.id, desc: `${s.id} (${wo.customer}) - ${s.estHours}h` });
        }
      });
    });

    // Find all scheduled laser cutting steps
    const scheduledLaser = this.state.scheduledJobs.filter(j => j.machine === 'Lasercut' && !j.isNest);

    const candidates = [
      ...backlogLaserSteps,
      ...scheduledLaser.map(j => ({ id: j.id, desc: `${j.id} (${j.customer}) - ${j.estHours}h` }))
    ];

    if (candidates.length === 0) {
      this.nestCandidatesList.innerHTML = '<div class="empty-list-hint" style="font-size: 10px; color: var(--text-secondary);">No laser cutting operations found.</div>';
      this.btnCreateNest.disabled = true;
      return;
    }

    candidates.forEach(cand => {
      const item = document.createElement('div');
      item.className = 'nest-candidate';
      item.innerHTML = `
        <input type="checkbox" id="nest-chk-${cand.id}" data-id="${cand.id}" class="nest-chk">
        <label for="nest-chk-${cand.id}">
          <span>${cand.id}</span>
          <span>${cand.desc.split(' - ')[1]}</span>
        </label>
      `;

      item.querySelector('.nest-chk').addEventListener('change', () => this.updateNestButtonState());
      this.nestCandidatesList.appendChild(item);
    });

    this.updateNestButtonState();
  }

  updateNestButtonState() {
    const checked = this.nestCandidatesList.querySelectorAll('.nest-chk:checked');
    this.btnCreateNest.disabled = checked.length < 2;
  }

  executeNesting() {
    const checked = this.nestCandidatesList.querySelectorAll('.nest-chk:checked');
    const ids = Array.from(checked).map(chk => chk.getAttribute('data-id'));
    if (this.state.nestJobs(ids)) {
      this.render();
    }
  }

  // Render Split Dropdown selection (step-based)
  renderSplitDropdown() {
    const currentVal = this.splitJobSelect.value;
    this.splitJobSelect.innerHTML = '<option value="">-- Choose Work Order Step --</option>';

    // Load candidate steps with parent Qty > 1 (excluding nests)
    const backlogCandidates = [];
    this.state.workOrders.forEach(wo => {
      if (wo.qty > 1) {
        wo.steps.forEach(s => {
          backlogCandidates.push({ id: s.id, label: `${s.id} - ${wo.customer} (${wo.qty} pcs, ${s.estHours}h)` });
        });
      }
    });

    const scheduledCandidates = this.state.scheduledJobs.filter(j => j.qty > 1 && !j.isNest);

    const candidates = [
      ...backlogCandidates,
      ...scheduledCandidates.map(j => ({ id: j.id, label: `${j.id} - ${j.customer} (${j.qty} pcs, ${j.estHours}h)` }))
    ];

    candidates.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      this.splitJobSelect.appendChild(opt);
    });

    if (candidates.some(c => c.id === currentVal)) {
      this.splitJobSelect.value = currentVal;
    } else {
      this.splitJobSelect.value = '';
      this.previewSplit();
    }
  }

  previewSplit() {
    const val = this.splitJobSelect.value;
    if (!val) {
      this.splitPreviewBox.classList.add('hidden');
      this.btnExecuteSplit.disabled = true;
      return;
    }

    // Find step
    let step = null;
    let qty = 0;
    let estHours = 0;

    // Check backlog
    for (let wo of this.state.workOrders) {
      const s = wo.steps.find(step => step.id === val);
      if (s) {
        step = s;
        qty = wo.qty;
        estHours = s.estHours;
        break;
      }
    }

    // Check scheduled
    if (!step) {
      const s = this.state.scheduledJobs.find(j => j.id === val);
      if (s) {
        step = s;
        qty = s.qty;
        estHours = s.estHours;
      }
    }

    if (step) {
      const qty1 = Math.floor(qty / 2);
      const qty2 = qty - qty1;
      const hours1 = parseFloat((estHours / 2).toFixed(1));
      const hours2 = parseFloat((estHours - hours1).toFixed(1));

      this.splitOrigQty.textContent = `${qty} pcs`;
      this.splitNewQty.textContent = `${qty1} / ${qty2} pcs`;
      this.splitOrigHours.textContent = `${estHours}h`;
      this.splitNewHours.textContent = `${hours1}h / ${hours2}h`;

      this.splitPreviewBox.classList.remove('hidden');
      this.btnExecuteSplit.disabled = false;
    }
  }

  executeSplit() {
    const jobId = this.splitJobSelect.value;
    if (jobId) {
      if (this.state.splitJob(jobId)) {
        this.splitJobSelect.value = '';
        this.previewSplit();
        this.render();
      }
    }
  }

  renderPdRangeFilters() {
    const container = document.getElementById('pdrange-filters-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (this.state.activePdRanges.length === 0) {
      container.innerHTML = '<div style="font-size: 10px; color: var(--text-secondary); text-align: center; padding: 10px;">ไม่มีรายการช่วง PD ที่กำหนด<br>แสดงผลทั้งหมด</div>';
      return;
    }
    
    this.state.activePdRanges.forEach((range, idx) => {
      const row = document.createElement('div');
      row.style = 'display: flex; align-items: center; justify-content: space-between; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; border: 1px solid var(--border-glass);';
      
      const leftDiv = document.createElement('div');
      leftDiv.style = 'display: flex; align-items: center; gap: 8px;';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = range.enabled;
      cb.style = 'cursor: pointer;';
      cb.addEventListener('change', (e) => {
        range.enabled = e.target.checked;
        this.state.notify();
      });
      
      const label = document.createElement('label');
      label.textContent = range.end ? `${range.start} - ${range.end}` : range.start;
      label.style = 'font-size: 11px; cursor: pointer; color: var(--text-primary); font-family: monospace;';
      label.addEventListener('click', () => { cb.click(); });
      
      leftDiv.appendChild(cb);
      leftDiv.appendChild(label);
      
      const btnDel = document.createElement('button');
      btnDel.innerHTML = '&times;';
      btnDel.style = 'background: none; border: none; color: var(--accent-red); cursor: pointer; font-size: 14px; font-weight: bold; padding: 0 4px;';
      btnDel.title = 'ลบช่วงนี้';
      btnDel.addEventListener('click', () => {
        this.state.activePdRanges.splice(idx, 1);
        this.state.notify();
      });
      
      row.appendChild(leftDiv);
      row.appendChild(btnDel);
      container.appendChild(row);
    });
  }

  renderMachineLink() {
    const listEl = document.getElementById('machinelink-sensors-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    
    Object.keys(this.state.workCenters).forEach(machine => {
      const row = document.createElement('div');
      row.className = 'machinelink-row';

      const jobs = this.state.scheduledJobs.filter(j => j.machine === machine);
      const activeJob = jobs.find(j => j.status === 'Running');
      const pausedJob = jobs.find(j => j.status === 'Paused');

      const finalRed = (pausedJob) ? 'active' : '';
      const finalYellow = (!activeJob && !pausedJob && jobs.length > 0) || (jobs.length === 0) ? 'active' : '';
      const finalGreen = (activeJob) ? 'active' : '';

      row.innerHTML = `
        <span style="font-weight: 600;">${this.state.getMachineDisplayName(machine)}</span>
        <div class="machinelink-tower">
          <span class="machinelink-bulb red ${finalRed}" title="Machine Paused / Alarm"></span>
          <span class="machinelink-bulb yellow ${finalYellow}" title="Machine Idle / Standby"></span>
          <span class="machinelink-bulb green ${finalGreen}" title="Machine Running"></span>
        </div>
      `;
      listEl.appendChild(row);
    });
  }
}
