import { getPriorityWeight } from './scheduler.js';
import { getJobPriority, isJobPriorityVisible, isJobProjectVisible, isJobCustomerVisible, isJobPdRangeVisible, isPdMatchingRange } from './gantt.js';

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
    this.activeRightTab = 'resources'; // 'resources' | 'priority' | 'project' | 'pdrange' | 'customer'
    this.showingPieView = false;
    this.customerSearchQuery = '';
    this.projectSearchQuery = '';

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
    this.tabRightCustomer = document.getElementById('tab-right-customer');
    this.panelRightResources = document.getElementById('panel-right-resources');
    this.panelRightPriority = document.getElementById('panel-right-priority');
    this.panelRightProject = document.getElementById('panel-right-project');
    this.panelRightGenka = document.getElementById('panel-right-pdrange');
    this.panelRightCustomer = document.getElementById('panel-right-customer');

    // Dynamic Priority Filters Container
    this.priorityFiltersContainer = document.getElementById('priority-filters-container');
    this.projectFiltersContainer = document.getElementById('project-filters-container');
    this.projectSearchInput = document.getElementById('project-search-input');
    this.customerFiltersContainer = document.getElementById('customer-filters-container');
    this.customerSearchInput = document.getElementById('customer-search-input');
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
    if (this.tabRightCustomer) {
      this.tabRightCustomer.addEventListener('click', () => this.switchRightTab('customer'));
    }

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
          this.state.activePdRanges.push({ start, end, enabled: true, favorite: false });
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

    document.getElementById('btn-pdrange-mark-completed')?.addEventListener('click', () => {
      const pdIds = this.getPdIdsInEnabledRanges();
      if (pdIds.length === 0) return;
      const confirmed = window.confirm(`ยืนยันผลิตเสร็จแล้ว ${pdIds.length} PD?\nรายการจะถูกลบออกจากบอร์ดและบันทึกเป็น PD ที่ผลิตเสร็จแล้ว`);
      if (!confirmed) return;
      this.state.markPdsCompletedAndRemoveBulk(pdIds);
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
    document.getElementById('btn-project-summary')?.addEventListener('click', () => this.showProjectSummary());
    document.getElementById('btn-project-select-all')?.addEventListener('click', () => {
      Object.keys(this.state.activeProjects).forEach(k => { this.state.activeProjects[k] = true; });
      this.state.notify();
    });
    document.getElementById('btn-project-deselect-all')?.addEventListener('click', () => {
      Object.keys(this.state.activeProjects).forEach(k => { this.state.activeProjects[k] = false; });
      this.state.notify();
    });

    // Customer filter Select All / Deselect All
    document.getElementById('btn-customer-select-all')?.addEventListener('click', () => {
      Object.keys(this.state.activeCustomers).forEach(k => { this.state.activeCustomers[k] = true; });
      this.state.notify();
    });
    document.getElementById('btn-customer-deselect-all')?.addEventListener('click', () => {
      Object.keys(this.state.activeCustomers).forEach(k => { this.state.activeCustomers[k] = false; });
      this.state.notify();
    });
    document.getElementById('btn-customer-select-filtered')?.addEventListener('click', () => {
      // Isolate the search results: turn on every customer matching the current
      // search box text and turn off everything else (an empty query matches all,
      // same as "เลือกทั้งหมด").
      const query = (this.customerSearchQuery || '').trim().toLowerCase();
      Object.keys(this.state.activeCustomers).forEach(k => {
        this.state.activeCustomers[k] = !query || k.toLowerCase().includes(query);
      });
      this.state.notify();
    });
    if (this.customerSearchInput) {
      this.customerSearchInput.addEventListener('input', () => {
        this.customerSearchQuery = this.customerSearchInput.value;
        this.renderCustomerFilters();
      });
    }
    if (this.projectSearchInput) {
      this.projectSearchInput.addEventListener('input', () => {
        this.projectSearchQuery = this.projectSearchInput.value;
        this.renderProjectFilters();
      });
    }

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
    const tabs = [this.tabRightResources, this.tabRightPriority, this.tabRightProject, this.tabRightGenka, this.tabRightCustomer];
    const panels = [this.panelRightResources, this.panelRightPriority, this.panelRightProject, this.panelRightGenka, this.panelRightCustomer];

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
    } else if (tab === 'customer') {
      if (this.tabRightCustomer) this.tabRightCustomer.classList.add('active');
      if (this.panelRightCustomer) this.panelRightCustomer.classList.remove('hidden');
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
          <button class="delete-btn" title="Force close: ปิด PD ทั้งหมดที่มี Priority นี้ (ขึ้นหน้ายืนยันก่อน)" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; transition: color 0.2s;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-force-close" style="color: var(--accent-red); filter: drop-shadow(0 0 2px rgba(255, 51, 51, 0.25));">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
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

        // The popup lists the PDs that will be force-closed and asks for the confirmation
        this.confirmClosePds(j => j.priority === p, w => w.priority === p, `Priority: ${p}`);
      });

      this.priorityFiltersContainer.appendChild(label);
    });
  }

  // "สรุปภาพรวมโครงการที่เลือก": popup for the projects currently ticked in the Project filter.
  showProjectSummary() {
    const keys = Object.keys(this.state.activeProjects || {}).filter(k => this.state.activeProjects[k] !== false);
    if (keys.length === 0) {
      this.state.ganttController?.showToast?.('⚠️ ยังไม่ได้เลือกโครงการ (ติ๊กเลือกในตัวกรองก่อน)', 'error');
      return;
    }
    const sum = this.state.buildProjectSummary(keys);
    const o = sum.overall;
    let showLists = false;
    try { showLists = localStorage.getItem('chaken_project_summary_lists') === '1'; } catch (e) { /* ignore */ }
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const num = (n, color) => `<span style="font-weight:800;color:${color || '#0f172a'};white-space:nowrap;">${n} PD</span>`;
    // Project details shown at the top of each block: customer(s) and the planned production period on the Gantt
    const fmtD = (d) => `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
    const projectInfo = (proj) => {
      const custs = new Set();
      (this.state.scheduledJobs || []).forEach(j => { if ((j.project || 'General') === proj && j.customer && j.customer !== 'General') custs.add(j.customer); });
      (this.state.workOrders || []).forEach(w => { if ((w.project || 'General') === proj && w.customer && w.customer !== 'General') custs.add(w.customer); });
      const jobs = (this.state.scheduledJobs || []).filter(j => (j.project || 'General') === proj && typeof j.startHour === 'number' && !isNaN(j.startHour));
      let period = '';
      if (jobs.length > 0) {
        const dS = this.state.workingHourToDate(Math.min(...jobs.map(j => j.startHour)));
        const dE = this.state.workingHourToDate(Math.max(...jobs.map(j => j.startHour + ((typeof j.estHours === 'number' && j.estHours > 0) ? j.estHours : 1))));
        if (dS && dE && !isNaN(dS.getTime()) && !isNaN(dE.getTime())) {
          const days = Math.round((new Date(dE.getFullYear(), dE.getMonth(), dE.getDate()) - new Date(dS.getFullYear(), dS.getMonth(), dS.getDate())) / 86400000) + 1;
          period = `${fmtD(dS)} - ${fmtD(dE)} (${days} วัน)`;
        }
      }
      const row = (k, v) => `<div style="display:flex;gap:8px;font-size:11.5px;color:#334155;"><span style="color:#64748b;min-width:92px;">${k}</span><span style="font-weight:600;">${v}</span></div>`;
      return `<div style="margin:2px 0 8px;display:flex;flex-direction:column;gap:2px;">${row('ลูกค้า', custs.size ? esc([...custs].join(', ')) : '-')}${row('แผนผลิตบน Gantt', period || 'ยังไม่มีแผนงานผลิต')}</div>`;
    };
    // One summary row; the PD numbers behind it can be expanded ("ดูรายการ PD") and opened with a click
    const line = (label, n, color, indent = false, ids = null) => `<div style="padding:5px 0;border-bottom:1px solid #f1f5f9;${indent ? 'padding-left:22px;color:#475569;' : ''}">
      <div style="display:flex;justify-content:space-between;gap:16px;"><span>${indent ? '↳ ' : '• '}${label}</span>${num(n, color)}</div>
      ${ids && ids.length ? `<details class="ps-list" style="margin-top:3px;${showLists ? '' : 'display:none;'}"><summary style="cursor:pointer;font-size:11px;color:#2563eb;">ดูรายการ PD (${ids.length})</summary><div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;">${[...ids].sort().map(id => `<span class="project-summary-pd" data-pd="${esc(id)}" title="คลิกเพื่อเปิดรายละเอียด PD" style="font-size:11px;font-family:monospace;padding:2px 7px;border-radius:4px;background:#f1f5f9;border:1px solid #cbd5e1;color:#1e3a8a;cursor:pointer;">${esc(id)}</span>`).join('')}</div></details>` : ''}
    </div>`;
    // Donut chart: exclusive split of the project's PDs (finished / in production = Board / waiting = Backlog / other) with %
    const PIE = [
      ['done', 'ผลิตเสร็จแล้ว', '#15803d', (b) => b.pie.complete + b.pie.completedList],
      ['board', 'กำลังผลิต', '#eab308', (b) => b.pie.board],
      ['backlog', 'รอผลิต', '#dc2626', (b) => b.pie.backlog],
      ['other', 'อื่นๆ', '#94a3b8', (b) => b.pie.other]
    ];
    const donut = (b) => {
      const total = b.total || 0;
      const r = 42, c = 2 * Math.PI * r;
      let offset = 0;
      const arcs = total > 0 ? PIE.filter(([, , , get]) => get(b) > 0).map(([, , col, get]) => {
        const len = get(b) / total * c;
        const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"></circle>`;
        offset += len;
        return el;
      }).join('') : '';
      const legend = PIE.filter(([, , , get]) => get(b) > 0).map(([, label, col, get]) => `<div style="display:flex;align-items:center;gap:6px;font-size:11px;white-space:nowrap;"><span style="width:10px;height:10px;border-radius:2px;background:${col};flex-shrink:0;"></span><span style="flex:1;">${label}</span><span style="font-weight:700;">${(get(b) / total * 100).toFixed(1)}%</span><span style="color:#64748b;min-width:48px;text-align:right;white-space:nowrap;">${get(b)} PD</span></div>`).join('');
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:210px;">
        <svg viewBox="0 0 120 120" width="130" height="130" role="img" aria-label="สัดส่วน PD"><circle cx="60" cy="60" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="18"></circle>${arcs}<text x="60" y="58" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">${total}</text><text x="60" y="73" text-anchor="middle" font-size="8.5" fill="#64748b">PD ทั้งหมด</text></svg>
        <div style="display:flex;flex-direction:column;gap:3px;width:100%;">${legend}</div>
      </div>`;
    };
    const breakdownRows = (b) => [
      line('จำนวน PD ทั้งหมด (ดูจากไฟล์ Status Overview)', b.total, '#2563eb'),
      line('จำนวน PD ที่ทุก Operation Complete', b.allComplete, '#15803d'),
      line('จำนวน PD ที่อยู่ในแผน (อยู่ใน Board)', b.board, '#0d9488', false, b.ids.board),
      line('จำนวน PD ที่อยู่ใน Backlog', b.backlog, '#7c3aed', false, b.ids.backlog),
      line('อยู่ใน Backlog ที่ Mat ยังไม่พร้อม (อย่างเดียว)', b.backlogMatNotReady, b.backlogMatNotReady ? '#b91c1c' : '#475569', true, b.ids.matNotReady),
      line('อยู่ใน Backlog ที่รอ PD ลูกเสร็จ (อย่างเดียว)', b.backlogWaitChild, b.backlogWaitChild ? '#b45309' : '#475569', true, b.ids.waitChild),
      line('อยู่ใน Backlog ที่ Mat ยังไม่พร้อม และรอ PD ลูกเสร็จ (ทั้งสองอย่าง)', b.backlogBoth, b.backlogBoth ? '#9a3412' : '#475569', true, b.ids.both),
      b.backlogReady ? line('อยู่ใน Backlog ที่พร้อมวางแผน (Mat พร้อม และไม่รอ PD ลูก)', b.backlogReady, '#15803d', true, b.ids.ready) : '',
      b.inCompletedList ? line('อยู่ในรายการ "Production Order ที่ผลิตเสร็จแล้ว" (Op ใน Status Overview ยังไม่ Complete ทั้งหมด)', b.inCompletedList, '#15803d', false, b.ids.inCompletedList) : '',
      b.other ? line('ยังไม่ Complete แต่ไม่อยู่ใน Board / Backlog / รายการผลิตเสร็จแล้ว', b.other, '#92400e', false, b.ids.other) : ''
    ].join('');
    const breakdown = (b) => `<div style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap;"><div style="flex:1;min-width:360px;">${breakdownRows(b)}</div>${donut(b)}</div>`;
    // Two side-by-side boxes under the summary: PD type by Operation Work Center (left) and the 6 busiest Work Centers (right)
    const extraBoxes = (b) => {
      const total = b.total || 0;
      const pctOf = (n) => total > 0 ? (n / total * 100).toFixed(1) + '%' : '-';
      const typeRow = (label, n, color) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:3px 0;border-bottom:1px solid #f1f5f9;"><span style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0;"></span>${label}</span><span style="white-space:nowrap;"><span style="font-weight:800;">${n} PD</span> <span style="color:#64748b;font-size:11px;min-width:44px;display:inline-block;text-align:right;">${pctOf(n)}</span></span></div>`;
      const left = `<div style="flex:1;min-width:280px;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:11.5px;">
        <div style="font-weight:700;margin-bottom:2px;">จำนวน PD ที่มี Operation</div>
        ${typeRow(`<b>${esc(this.state.getMachineDisplayName('DEC001'))}</b> อย่างเดียว`, b.opTypes.dec, '#0ea5e9')}
        ${typeRow(`<b>${esc(this.state.getMachineDisplayName('DED001'))}</b> อย่างเดียว`, b.opTypes.ded, '#8b5cf6')}
        ${typeRow('ที่เหลือ เป็นผลิต Part', b.opTypes.part, '#16a34a')}
        ${b.opTypes.unknown ? typeRow('ไม่มีข้อมูล Operation', b.opTypes.unknown, '#94a3b8') : ''}
        <div style="color:#94a3b8;font-size:10.5px;margin-top:6px;">รวม ${total} PD</div>
      </div>`;
      const top = Object.entries(b.wcHours || {}).sort((x, y) => y[1] - x[1]).slice(0, 10);
      const maxH = top.length ? top[0][1] : 0;
      const fmtH = (h) => Number(h.toFixed(1)).toLocaleString('en-US');
      const wcRows = top.map(([wc, h], i) => `<div style="padding:2px 0;border-bottom:1px solid #f1f5f9;">
          <div style="display:flex;justify-content:space-between;gap:12px;"><span>${i + 1}. ${esc(this.state.getMachineDisplayName(wc))}</span><span style="font-weight:800;white-space:nowrap;">${fmtH(h)} ชม.</span></div>
          <div style="height:4px;border-radius:2px;background:#e2e8f0;margin-top:2px;"><div style="height:4px;border-radius:2px;background:#2563eb;width:${maxH > 0 ? (h / maxH * 100).toFixed(1) : 0}%;"></div></div>
        </div>`).join('');
      const right = `<div style="flex:1;min-width:280px;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:11.5px;">
        <div style="font-weight:700;margin-bottom:2px;">จำนวน ชม. ที่ใช้ของ Work Center 10 อันดับแรก</div>
        ${wcRows || '<div style="color:#94a3b8;padding:8px 0;">ยังไม่มีข้อมูลชั่วโมงงานใน Board / Backlog</div>'}
        <div style="color:#94a3b8;font-size:10.5px;margin-top:6px;">ชม. Est ของงานใน Board + Backlog</div>
      </div>`;
      return `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch;">${left}${right}</div>`;
    };
    const projectBlocks = sum.perProject.map(r => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;">
        <div style="font-weight:700;margin-bottom:2px;">โครงการ ${esc(r.project)}</div>
        ${projectInfo(r.project)}
        ${breakdown(r)}
      </div>`).join('');
    const old = document.getElementById('project-summary-popup');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'project-summary-popup';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;color:#0f172a;border-radius:10px;max-width:980px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,0.3);font-size:12.5px;">
        <div style="padding:14px 18px 6px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div style="font-size:15px;font-weight:700;">📊 สรุปภาพรวมโครงการที่เลือก (${sum.perProject.length} โครงการ${sum.perProject.length <= 3 ? ': ' + sum.perProject.map(r => esc(r.project)).join(', ') : ''})</div>
            <div style="color:#64748b;font-size:11.5px;margin-top:3px;">นับจาก PD ทั้งหมดในไฟล์ Status Overview ของ SO / โครงการที่ติ๊กอยู่ในตัวกรอง เทียบกับสถานะใน Board / Backlog ปัจจุบัน</div>
            <div style="color:#64748b;font-size:11.5px;margin-top:2px;white-space:nowrap;">แสดงรายงานเมื่อ ${esc(new Date().toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }))} ${esc(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;flex-shrink:0;">
            <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#334155;cursor:pointer;user-select:none;" title="เปิด = แสดงบรรทัด ดูรายการ PD (ยุบไว้ กดเพื่อขยาย) · ปิด = ซ่อนบรรทัด ดูรายการ PD"><span>แสดงรายการ PD</span><span class="ios-toggle"><input type="checkbox" id="chk-project-summary-lists"${showLists ? ' checked' : ''}><span class="ios-toggle-slider"></span></span></label>
            <button type="button" id="btn-close-project-summary" style="border:none;background:transparent;font-size:18px;cursor:pointer;">✕</button>
          </div>
        </div>
        <div style="padding:6px 18px 12px;overflow:auto;display:flex;flex-direction:column;gap:14px;">
          <div style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:8px;padding:10px 14px;">
            <div style="font-weight:700;margin-bottom:4px;">${sum.perProject.length === 1 ? `โครงการ ${esc(sum.perProject[0].project)}` : `รวมทุกโครงการที่เลือก (${sum.perProject.length} โครงการ)`}</div>
            ${sum.perProject.length === 1 ? projectInfo(sum.perProject[0].project) : ''}
            ${breakdown(o)}
          </div>
          ${extraBoxes(o)}
          ${sum.perProject.length > 1 ? `<div style="font-weight:700;">แยกรายโครงการ</div>${projectBlocks}` : ''}
          ${Object.keys(this.state.dwgToPdMap || {}).length === 0 ? '<div style="padding:8px 12px;border-radius:6px;background:#fef3c7;color:#92400e;font-size:11.5px;">⚠️ ยังไม่ได้โหลดไฟล์ Status Overview — "จำนวน PD ทั้งหมด" จึงนับได้เฉพาะ PD ที่อยู่ใน Board / Backlog เท่านั้น (ตัวเลขอาจไม่ครบ)</div>' : ''}
          <div style="color:#94a3b8;font-size:10.5px;">บรรทัดย่อยของ Backlog แยกกลุ่มไม่ซ้ำกัน รวมกันได้เท่ากับจำนวน PD ใน Backlog</div>
        </div>
        <div style="padding:10px 18px 14px;display:flex;justify-content:flex-end;border-top:1px solid #e2e8f0;">
          <button type="button" id="btn-ok-project-summary" style="padding:6px 18px;border:none;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">ปิด</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#btn-close-project-summary').addEventListener('click', close);
    // Top-right switch: expand / collapse every PD list at once (remembered)
    overlay.querySelector('#chk-project-summary-lists')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      overlay.querySelectorAll('details.ps-list').forEach(d => { d.style.display = on ? '' : 'none'; d.open = false; });
      try { localStorage.setItem('chaken_project_summary_lists', on ? '1' : '0'); } catch (err) { /* ignore */ }
    });
    overlay.querySelector('#btn-ok-project-summary').addEventListener('click', close);
    // Click a PD number to open its detail window on top of this popup
    overlay.querySelectorAll('.project-summary-pd').forEach(el => el.addEventListener('click', () => {
      const pdModal = document.getElementById('pd-plan-modal');
      if (pdModal) pdModal.style.zIndex = '100001';
      window.dispatchEvent(new CustomEvent('open-pd-modal', { detail: { woId: el.dataset.pd } }));
    }));
  }

  // Which PDs a trash action would force-close: the PDs of the list entry (board + backlog) and the child PDs that
  // are still open. Pure preview, nothing is changed.
  previewForceClose(matchJob, matchWo, extraIds = []) {
    const ids = new Set(extraIds);
    this.state.scheduledJobs.forEach(j => { if (matchJob(j)) ids.add(j.woId || j.id); });
    this.state.workOrders.forEach(w => { if (matchWo(w)) ids.add(w.id); });
    const direct = [...ids].sort();
    const directSet = new Set(direct);
    const allChildren = direct.length > 0 ? (this.state.getDescendantPdIds(direct) || []).filter(id => !directSet.has(id)).sort() : [];
    // Only the child PDs that are still open are force-closed; the rest were already Closed before
    const children = allChildren.filter(id => !this.state.isPdInCompletedHistory(id));
    return { direct, children, alreadyClosedChildren: allChildren.length - children.length };
  }

  // Trash button of the Priority / Project lists: every Production Order inside (board + backlog) is recorded as
  // Closed (completed list, together with its child PDs), all its Operations become Complete, and it is taken off
  // the plan so it does not come back from the next Status Overview import or get planned again.
  closePdsAndRemove(matchJob, matchWo, preview = null, label = '') {
    const { direct, children } = preview || this.previewForceClose(matchJob, matchWo);
    // Every Operation of the force-closed PDs becomes Complete (and stays Complete when a newer Status Overview is loaded)
    const opsMarked = this.state.forceCompleteOps([...direct, ...children]);
    if (direct.length > 0) this.state.markPdsCompletedAndRemoveBulk([...direct, ...children]);
    // Anything still matching (e.g. entries without a PD id) is removed as before
    this.state.scheduledJobs = this.state.scheduledJobs.filter(j => !matchJob(j));
    this.state.workOrders = this.state.workOrders.filter(w => !matchWo(w));
    this.state.savePlanToFile();
    this.state.saveWorkOrdersToFile();
    this.state.notify();
    return { closed: direct.length + children.length, opsMarked };
  }

  // Popup that lists the PDs about to be force-closed; nothing happens until "ยืนยันลบ" is pressed.
  confirmClosePds(matchJob, matchWo, label = '', extraIds = [], onDone = null) {
    const preview = this.previewForceClose(matchJob, matchWo, extraIds);
    this.showForceClosePopup({
      label,
      ...preview,
      onConfirm: () => {
        const r = this.closePdsAndRemove(matchJob, matchWo, preview, label);
        this.state.ganttController?.showToast?.(`✅ ยืนยันลบแล้ว: Force close ${r.closed} PD และตั้ง ${r.opsMarked} Operation เป็น Complete`, 'success');
        if (typeof onDone === 'function') onDone(r);
      }
    });
  }

  showForceClosePopup({ label, direct, children, alreadyClosedChildren = 0, onConfirm }) {
    const old = document.getElementById('force-closed-popup');
    if (old) old.remove();
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const chips = (ids, bg, border, color) => ids.length === 0
      ? '<div style="color:#94a3b8;font-size:11px;">ไม่มี</div>'
      : `<div style="display:flex;flex-wrap:wrap;gap:6px;">${ids.map(id => `<span style="font-size:11px;font-family:monospace;padding:3px 8px;border-radius:4px;background:${bg};border:1px solid ${border};color:${color};">${esc(id)}</span>`).join('')}</div>`;
    const total = direct.length + children.length;
    const overlay = document.createElement('div');
    overlay.id = 'force-closed-popup';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;color:#0f172a;border-radius:10px;max-width:760px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,0.3);font-size:12.5px;">
        <div style="padding:14px 18px 8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div style="font-size:15px;font-weight:700;">⛔ ยืนยัน Force Close Production Order (${total} PD)</div>
            <div style="color:#64748b;font-size:11.5px;margin-top:3px;">${esc(label)} · จะปิด ${direct.length} PD ของรายการนี้${children.length ? ` + PD ลูก ${children.length} PD` : ''} และนำออกจาก Backlog / Gantt</div>
          </div>
          <button type="button" id="btn-close-force-closed" style="border:none;background:transparent;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:6px 18px 10px;overflow:auto;display:flex;flex-direction:column;gap:12px;">
          <div>
            <div style="font-weight:700;color:#b91c1c;margin-bottom:6px;">1) PD ของรายการนี้ที่จะถูก Force close (${direct.length})</div>
            ${chips(direct, 'rgba(185,28,28,0.08)', 'rgba(185,28,28,0.35)', '#7f1d1d')}
          </div>
          <div>
            <div style="font-weight:700;color:#b45309;margin-bottom:6px;">2) PD ลูกที่จะถูก Force close ตามไปด้วย (${children.length})${alreadyClosedChildren ? ` <span style="font-weight:400;color:#64748b;">· ไม่นับ PD ลูก ${alreadyClosedChildren} PD ที่ Closed อยู่แล้ว</span>` : ''}</div>
            ${chips(children, 'rgba(245,158,11,0.12)', 'rgba(245,158,11,0.4)', '#92400e')}
          </div>
          <div style="color:#0f766e;font-size:11.5px;font-weight:600;">✔ Operation ทุกขั้นตอนของ PD เหล่านี้จะถูกตั้งเป็น Complete และจะไม่ถูกอัปเดตกลับตาม Status Overview ที่ดึงมาใหม่</div>
          <div style="color:#64748b;font-size:11px;">จะบันทึกเป็น Closed ในรายการผลิตเสร็จแล้ว ไม่ถูกนำเข้า Backlog หรือวางแผนอีก (ส่งขึ้น Drive/Cloud เมื่อกด Save ในโหมดวางแผน) การลบนี้ไม่สามารถยกเลิกได้ครบทุกส่วน</div>
        </div>
        <div style="padding:10px 18px 14px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #e2e8f0;">
          <button type="button" id="btn-cancel-force-closed" style="padding:6px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">ยกเลิก</button>
          <button type="button" id="btn-confirm-force-closed" style="padding:6px 18px;border:none;border-radius:6px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer;">🗑️ ยืนยันลบ</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#btn-close-force-closed').addEventListener('click', close);
    overlay.querySelector('#btn-cancel-force-closed').addEventListener('click', close);
    overlay.querySelector('#btn-confirm-force-closed').addEventListener('click', () => {
      close();
      if (typeof onConfirm === 'function') onConfirm();
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
    // Count distinct PDs (a PD on the board has one scheduled job per routing step, so
    // counting jobs would over-count multi-step PDs), both on the board and in the backlog.
    const pdSets = {};
    sortedProjects.forEach(proj => pdSets[proj] = new Set());
    this.state.scheduledJobs.forEach(job => {
      const proj = job.project || 'General';
      pdSets[proj].add(job.woId || job.id);
    });
    this.state.workOrders.forEach(wo => {
      const proj = wo.project || 'General';
      pdSets[proj].add(wo.id);
    });
    const counts = {};
    sortedProjects.forEach(proj => counts[proj] = pdSets[proj].size);

    // 2b. Collect which customer(s) each project belongs to, for display next
    // to the project number - most projects map to a single customer, but show
    // all of them (comma-separated) on the rare case a project spans a few.
    const projectCustomers = {};
    sortedProjects.forEach(proj => projectCustomers[proj] = new Set());
    this.state.scheduledJobs.forEach(job => {
      const proj = job.project || 'General';
      if (job.customer) projectCustomers[proj]?.add(job.customer);
    });
    this.state.workOrders.forEach(wo => {
      const proj = wo.project || 'General';
      if (wo.customer) projectCustomers[proj]?.add(wo.customer);
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

    // 4. Filter the list by the search box (matches against activeProjects/counts
    // computed above from the full list, so select-all/deselect-all still act on
    // every project even while a search narrows what's shown).
    const query = (this.projectSearchQuery || '').trim().toLowerCase();
    const visibleProjects = query ? sortedProjects.filter(p => p.toLowerCase().includes(query)) : sortedProjects;

    // 5. Generate HTML elements
    this.projectFiltersContainer.innerHTML = '';

    if (sortedProjects.length === 0) {
      this.projectFiltersContainer.innerHTML = '<div style="font-size: 10px; color: var(--text-secondary); text-align: center; padding: 10px;">No projects found.</div>';
      return;
    }
    if (visibleProjects.length === 0) {
      this.projectFiltersContainer.innerHTML = '<div style="font-size: 10px; color: var(--text-secondary); text-align: center; padding: 10px;">ไม่พบโครงการที่ตรงกับคำค้นหา</div>';
      return;
    }

    visibleProjects.forEach(proj => {
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

      const customerLabel = Array.from(projectCustomers[proj] || []).join(', ');

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
          ${customerLabel ? `<span style="font-size: 9px; color: var(--text-secondary); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${customerLabel}">${customerLabel}</span>` : ''}
          <span style="font-size: 8.5px; color: var(--text-secondary); margin-top: 1px; white-space: nowrap;" title="${fullTooltip}">
            <strong style="color: ${dateRangeStr === '-' ? 'var(--text-secondary)' : 'var(--accent-teal)'};">${dateRangeStr}</strong>
          </span>
        </div>
        <span style="font-size: 10px; color: var(--text-secondary); margin-left: 4px; align-self: center;">(${count})</span>
        <button class="lock-btn" style="${lockStyle} align-self: center;" title="${lockTitle}">${lockIconSvg}</button>
        <button class="delete-btn" title="Force close: ปิด PD ทั้งหมดของ Project นี้ (ขึ้นหน้ายืนยันก่อน)" style="margin-left: 4px; align-self: center; background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; transition: color 0.2s;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-force-close" style="color: var(--accent-red); filter: drop-shadow(0 0 2px rgba(255, 51, 51, 0.25));">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
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
        
        // The popup lists the PDs that will be force-closed and asks for the confirmation
        this.confirmClosePds(j => (j.project || 'General') === proj, w => (w.project || 'General') === proj, `SO / Project: ${proj}`);
      });
      
      this.projectFiltersContainer.appendChild(label);
    });
  }

  renderCustomerFilters() {
    if (!this.customerFiltersContainer) return;

    // 1. Get all unique customers from state.scheduledJobs and state.workOrders
    const customers = new Set();
    this.state.scheduledJobs.forEach(job => {
      const cust = job.customer || 'General';
      customers.add(cust);
    });
    this.state.workOrders.forEach(wo => {
      const cust = wo.customer || 'General';
      customers.add(cust);
    });

    // Sort them so the list is stable
    const sortedCustomers = Array.from(customers).sort();

    // 2. Count jobs for each customer
    const counts = {};
    sortedCustomers.forEach(cust => counts[cust] = 0);
    this.state.scheduledJobs.forEach(job => {
      const cust = job.customer || 'General';
      counts[cust]++;
    });
    this.state.workOrders.forEach(wo => {
      const cust = wo.customer || 'General';
      counts[cust]++;
    });

    // 3. Update state.activeCustomers keys. If a key is new, default to true.
    sortedCustomers.forEach(cust => {
      if (this.state.activeCustomers[cust] === undefined) {
        this.state.activeCustomers[cust] = true;
      }
    });

    // Clean up old customers that are no longer in scheduledJobs or workOrders
    Object.keys(this.state.activeCustomers).forEach(cust => {
      if (!customers.has(cust)) {
        delete this.state.activeCustomers[cust];
      }
    });

    // 4. Filter the list by the search box (matches against activeCustomers/counts
    // computed above from the full list, so select-all/deselect-all still act on
    // every customer even while a search narrows what's shown).
    const query = (this.customerSearchQuery || '').trim().toLowerCase();
    const visibleCustomers = query ? sortedCustomers.filter(c => c.toLowerCase().includes(query)) : sortedCustomers;

    // 5. Generate HTML elements
    this.customerFiltersContainer.innerHTML = '';

    if (sortedCustomers.length === 0) {
      this.customerFiltersContainer.innerHTML = '<div style="font-size: 10px; color: var(--text-secondary); text-align: center; padding: 10px;">No customers found.</div>';
      return;
    }
    if (visibleCustomers.length === 0) {
      this.customerFiltersContainer.innerHTML = '<div style="font-size: 10px; color: var(--text-secondary); text-align: center; padding: 10px;">ไม่พบลูกค้าที่ตรงกับคำค้นหา</div>';
      return;
    }

    visibleCustomers.forEach(cust => {
      const label = document.createElement('label');
      label.style.cssText = 'display: flex; align-items: flex-start; gap: 8px; cursor: pointer; user-select: none; margin-bottom: 6px; padding: 4px 6px; border-radius: 6px; transition: background 0.2s;';

      const isChecked = this.state.activeCustomers[cust] !== false;
      const count = counts[cust] || 0;

      // Generate a pseudo-random color based on hash of name or custom customerColors
      let dotColor = 'var(--accent-teal)';
      if (this.state.customerColors && this.state.customerColors[cust]) {
        dotColor = this.state.customerColors[cust];
      } else {
        let hash = 0;
        for (let i = 0; i < cust.length; i++) {
          hash = cust.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        dotColor = '#' + '00000'.substring(0, 6 - c.length) + c;
      }
      const hexColor = parseColorToHex(dotColor);

      // Calculate production date range for this customer from scheduled jobs
      const custJobs = this.state.scheduledJobs.filter(j => (j.customer || 'General') === cust && typeof j.startHour === 'number' && !isNaN(j.startHour) && this.state.activeWorkCenters[j.machine] !== false);
      let dateRangeStr = '-';
      let fullTooltip = 'ยังไม่มีแผนงานผลิต';
      if (custJobs.length > 0) {
        const minStartHour = Math.min(...custJobs.map(j => j.startHour));
        const maxFinishHour = Math.max(...custJobs.map(j => j.startHour + ((typeof j.estHours === 'number' && j.estHours > 0) ? j.estHours : 1.0)));
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
          <input type="checkbox" style="width: auto; margin: 0; cursor: pointer;" ${isChecked ? 'checked' : ''} title="Hide / Unhide Customer (ซ่อน/แสดง)">
          <div style="position: relative; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;" title="Change Task Bar Color (คลิกเปลี่ยนสีแถบงาน)">
            <input type="color" class="customer-color-input" data-customer="${cust}" value="${hexColor}" style="position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer; left: 0; top: 0; padding: 0; margin: 0; border: none; z-index: 2;">
            <span class="color-swatch-icon" style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 3px; background-color: ${dotColor}; color: #ffffff; font-size: 8px; border: 1px solid rgba(255,255,255,0.4); box-shadow: 0 1px 3px rgba(0,0,0,0.3); pointer-events: none;" title="Change Task Bar Color (คลิกเปลี่ยนสีแถบงาน)">🎨</span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; min-width: 0; flex: 1; margin-left: 2px;">
          <span style="font-weight: bold; color: ${dotColor}; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${cust}">${cust}</span>
          <span style="font-size: 8.5px; color: var(--text-secondary); margin-top: 1px; white-space: nowrap;" title="${fullTooltip}">
            <strong style="color: ${dateRangeStr === '-' ? 'var(--text-secondary)' : 'var(--accent-teal)'};">${dateRangeStr}</strong>
          </span>
        </div>
        <span style="font-size: 10px; color: var(--text-secondary); margin-left: 4px; align-self: center;">(${count})</span>
      `;

      // Bind color picker input event listener
      const colorInput = label.querySelector('.customer-color-input');
      if (colorInput) {
        colorInput.addEventListener('input', (e) => {
          e.stopPropagation();
          const newColor = e.target.value;
          if (!this.state.customerColors) this.state.customerColors = {};
          this.state.customerColors[cust] = newColor;
          this.state.savePlanToFile();
          this.state.notify();
        });
      }

      // Bind event listener to checkbox
      const checkbox = label.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => {
        this.state.activeCustomers[cust] = checkbox.checked;
        this.state.notify();
      });

      this.customerFiltersContainer.appendChild(label);
    });
  }

  render() {
    this.renderPriorityFilters();
    this.renderProjectFilters();
    this.renderCustomerFilters();
    if (this.activeRightTab === 'resources') {
      this.renderOEE();
      this.renderNestingCandidates();
      this.renderSplitDropdown();
    } else if (this.activeRightTab === 'priority') {
      // Handled by renderPriorityFilters() above
    } else if (this.activeRightTab === 'project') {
      // Handled by renderProjectFilters() above
    } else if (this.activeRightTab === 'pdrange') {
      this.renderFavoritePDs();
      this.renderPdRangeFilters();
    } else if (this.activeRightTab === 'customer') {
      // Handled by renderCustomerFilters() above
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
          .filter(j => isJobPriorityVisible(j, this.state) && isJobProjectVisible(j, this.state) && isJobCustomerVisible(j, this.state) && isJobPdRangeVisible(j, this.state))
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
            <span class="oee-name">${this.state.getMachineDisplayName(machine)}</span>
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
        .filter(j => j.machine === m && isJobPriorityVisible(j, this.state) && isJobProjectVisible(j, this.state) && isJobCustomerVisible(j, this.state) && isJobPdRangeVisible(j, this.state))
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

  renderFavoritePDs() {
    const container = document.getElementById('pdrange-favorites-container');
    if (!container) return;

    const pdIds = Object.keys(this.state.favoritePDs || {}).sort();

    if (pdIds.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = '';

    const heading = document.createElement('div');
    heading.textContent = `PD รายการโปรด (${pdIds.length})`;
    heading.style = 'font-size: 10px; font-weight: bold; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;';
    container.appendChild(heading);

    const list = document.createElement('div');
    list.style = 'display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--bg-darkest); border-radius: 8px; border: 1px solid var(--border-glass); max-height: 160px; overflow-y: auto;';

    pdIds.forEach(pdId => {
      const row = document.createElement('div');
      row.style = 'display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; background: rgba(255, 213, 74, 0.08); border-radius: 4px; border: 1px solid rgba(255, 213, 74, 0.3);';

      const leftDiv = document.createElement('div');
      leftDiv.style = 'display: flex; align-items: center; gap: 8px; cursor: pointer;';
      leftDiv.title = 'เปิดรายละเอียด PD นี้';
      leftDiv.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('open-pd-modal', { detail: { woId: pdId } }));
      });

      const star = document.createElement('span');
      star.innerHTML = '&#9733;';
      star.style = 'font-size: 12px; color: #ffd54a;';

      const label = document.createElement('span');
      label.textContent = pdId;
      label.style = 'font-size: 11px; color: var(--text-primary); font-family: monospace;';

      leftDiv.appendChild(star);
      leftDiv.appendChild(label);

      const btnRemove = document.createElement('button');
      btnRemove.innerHTML = '&times;';
      btnRemove.title = 'เอาออกจากรายการโปรด';
      btnRemove.style = 'background: none; border: none; color: var(--accent-red); cursor: pointer; font-size: 14px; font-weight: bold; padding: 0 4px;';
      btnRemove.addEventListener('click', () => {
        this.state.togglePdFavorite(pdId);
      });

      row.appendChild(leftDiv);
      row.appendChild(btnRemove);
      list.appendChild(row);
    });

    container.appendChild(list);
  }

  // PD ids (job.woId / workOrder.id) that fall inside any currently-checked
  // (enabled) PD Range Filter entry - same range-matching rule as
  // isJobPdRangeVisible() in gantt.js, applied directly to PD number strings.
  getPdIdsInEnabledRanges() {
    const enabledRanges = (this.state.activePdRanges || []).filter(r => r.enabled);
    if (enabledRanges.length === 0) return [];

    const matches = (pd) => enabledRanges.some(range => isPdMatchingRange(pd, range));

    const pdIds = new Set();
    (this.state.scheduledJobs || []).forEach(job => {
      const pd = String(job.woId || job.id || '').trim();
      if (pd && matches(pd)) pdIds.add(job.woId || pd.split('-')[0]);
    });
    (this.state.workOrders || []).forEach(wo => {
      const pd = String(wo.id || '').trim();
      if (pd && matches(pd)) pdIds.add(pd.split('-')[0]);
    });

    return Array.from(pdIds);
  }

  updatePdRangeMarkCompletedButton() {
    const btn = document.getElementById('btn-pdrange-mark-completed');
    if (!btn) return;
    const pdIds = this.getPdIdsInEnabledRanges();
    if (pdIds.length === 0) {
      btn.classList.add('hidden');
      return;
    }
    btn.classList.remove('hidden');
    btn.textContent = `✓ ผลิตเสร็จแล้ว (${pdIds.length} PD)`;
  }

  renderPdRangeFilters() {
    const container = document.getElementById('pdrange-filters-container');
    if (!container) return;

    container.innerHTML = '';
    this.updatePdRangeMarkCompletedButton();

    if (this.state.activePdRanges.length === 0) {
      container.innerHTML = '<div style="font-size: 10px; color: var(--text-secondary); text-align: center; padding: 10px;">ไม่มีรายการช่วง PD ที่กำหนด<br>แสดงผลทั้งหมด</div>';
      return;
    }
    
    const ordered = this.state.activePdRanges
      .map((range, idx) => ({ range, idx }))
      .sort((a, b) => (b.range.favorite ? 1 : 0) - (a.range.favorite ? 1 : 0));

    ordered.forEach(({ range, idx }) => {
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

      const btnStar = document.createElement('button');
      btnStar.innerHTML = range.favorite ? '&#9733;' : '&#9734;';
      btnStar.title = range.favorite ? 'เอาออกจากรายการโปรด' : 'เพิ่มเป็นรายการโปรด';
      btnStar.style = `background: none; border: none; cursor: pointer; font-size: 13px; padding: 0 2px; color: ${range.favorite ? '#ffd54a' : 'var(--text-secondary)'};`;
      btnStar.addEventListener('click', () => {
        range.favorite = !range.favorite;
        this.state.notify();
      });

      const label = document.createElement('label');
      label.textContent = range.end ? `${range.start} - ${range.end}` : range.start;
      label.style = 'font-size: 11px; cursor: pointer; color: var(--text-primary); font-family: monospace;';
      label.addEventListener('click', () => { cb.click(); });

      leftDiv.appendChild(cb);
      leftDiv.appendChild(btnStar);
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

}
