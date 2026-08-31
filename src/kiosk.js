// MIE Trak Pro - Shop Floor Kiosk Controller

export class KioskController {
  constructor(state) {
    this.state = state;
    this.selectedJobId = null;
    
    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.drawer = document.getElementById('kiosk-drawer');
    this.toggleHandle = document.getElementById('kiosk-toggle-handle');
    this.stationSelect = document.getElementById('kiosk-station-select');
    this.queueList = document.getElementById('kiosk-queue-list');
    this.activeJobBox = document.getElementById('kiosk-active-job-box');
    
    // Timeclock controls
    this.btnSetup = document.getElementById('kiosk-btn-setup');
    this.btnRun = document.getElementById('kiosk-btn-run');
    this.btnPause = document.getElementById('kiosk-btn-pause');
    this.btnComplete = document.getElementById('kiosk-btn-complete');
    
    // Pause Reasons
    this.pauseBox = document.getElementById('kiosk-pause-reasons');
    this.pauseReasonSelect = document.getElementById('pause-reason-select');
    this.btnConfirmPause = document.getElementById('kiosk-btn-confirm-pause');

    // CAD Blueprint Viewer
    this.cadViewer = document.getElementById('kiosk-cad-viewer');

    // Assembly parts status modal
    this.assemblyPartsModal = document.getElementById('assembly-parts-modal');
    this.assemblyPartsBody = document.getElementById('assembly-parts-modal-body');
    this.btnCloseAssemblyParts = document.getElementById('btn-close-assembly-parts');
    this.btnCloseAssemblyPartsFooter = document.getElementById('btn-close-assembly-parts-footer');
  }

  bindEvents() {
    // Initialize Resize & Toggle events
    this.isResizing = false;
    this.kioskHeight = 370;
    this.initResizeEvents();

    // Station Select change
    this.stationSelect.addEventListener('change', (e) => {
      this.state.setKioskMachine(e.target.value);
      this.selectedJobId = null; // Reset selection
    });

    // Timeclock Button actions
    this.btnSetup.addEventListener('click', () => this.executeAction('Setup', 'Setting up'));
    this.btnRun.addEventListener('click', () => this.executeAction('Running'));
    this.btnPause.addEventListener('click', () => {
      this.pauseBox.classList.remove('hidden');
    });
    
    this.btnConfirmPause.addEventListener('click', () => {
      const reason = this.pauseReasonSelect.value;
      this.executeAction('Paused', reason);
      this.pauseBox.classList.add('hidden');
    });

    this.btnComplete.addEventListener('click', () => {
      this.executeAction('Completed');
      this.selectedJobId = null; // Reset
    });

    // Listen to Gantt card clicks to sync with Kiosk
    window.addEventListener('gantt-card-selected', (e) => {
      const { jobId, machine } = e.detail;
      this.state.setKioskMachine(machine);
      this.selectedJobId = jobId;
      if (this.drawer.classList.contains('closed')) {
        this.toggleDrawer();
      } else {
        this.updateKioskDimensions();
      }
      this.state.notify();
    });

    const closeAssemblyModal = () => {
      if (this.assemblyPartsModal) {
        this.assemblyPartsModal.classList.add('hidden');
      }
    };
    if (this.btnCloseAssemblyParts) {
      this.btnCloseAssemblyParts.addEventListener('click', closeAssemblyModal);
    }
    if (this.btnCloseAssemblyPartsFooter) {
      this.btnCloseAssemblyPartsFooter.addEventListener('click', closeAssemblyModal);
    }
  }

  initResizeEvents() {
    this.toggleHandle.style.cursor = 'ns-resize'; // Show resize cursor on handle

    this.toggleHandle.addEventListener('mousedown', (e) => {
      this.isResizing = true;
      this.startY = e.clientY;
      this.startHeight = this.kioskHeight;
      this.hasMoved = false;
      
      // Disable transition during drag for smoothness
      this.drawer.style.transition = 'none';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isResizing) return;
      
      const dy = this.startY - e.clientY;
      if (Math.abs(dy) > 4) {
        this.hasMoved = true;
      }
      
      let newHeight = this.startHeight + dy;
      // Constrain height
      const minHeight = 160;
      const maxHeight = window.innerHeight - 100;
      newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
      
      this.kioskHeight = newHeight;
      this.updateKioskDimensions();
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isResizing) return;
      this.isResizing = false;
      
      // Re-enable transition
      this.drawer.style.transition = 'transform 0.3s cubic-bezier(0.165, 0.84, 0.44, 1)';
      
      if (!this.hasMoved) {
        // It was a simple click, toggle open/closed!
        this.toggleDrawer();
      } else {
        // If they dragged, make sure it is marked as open
        this.drawer.classList.remove('closed');
        this.updateKioskDimensions();
      }
    });
  }

  toggleDrawer() {
    this.drawer.classList.toggle('closed');
    this.updateKioskDimensions();
  }

  updateKioskDimensions() {
    const isClosed = this.drawer.classList.contains('closed');
    
    // Set heights
    this.drawer.style.height = `${this.kioskHeight}px`;
    const contentEl = this.drawer.querySelector('.kiosk-content');
    if (contentEl) {
      contentEl.style.height = `${this.kioskHeight - 40}px`;
    }
    
    // Set transform
    if (isClosed) {
      this.drawer.style.transform = `translateY(${this.kioskHeight - 40}px)`;
    } else {
      this.drawer.style.transform = 'translateY(0)';
    }
  }

  executeAction(status, reason = '') {
    if (this.selectedJobId) {
      this.state.updateJobStatus(this.selectedJobId, status, reason);
    }
  }

  render() {
    const order = this.state.workCenterOrder || [];
    const currentOptions = Array.from(this.stationSelect.options).map(o => o.value);
    if (order.join('|') !== currentOptions.join('|')) {
      const currentSelected = this.stationSelect.value || this.state.kioskMachine;
      this.stationSelect.innerHTML = order.map(wc => 
        `<option value="${wc}">${this.state.getMachineDisplayName(wc)}</option>`
      ).join('');
      
      if (order.includes(currentSelected)) {
        this.stationSelect.value = currentSelected;
        this.state.kioskMachine = currentSelected;
      } else if (order.length > 0) {
        this.stationSelect.value = order[0];
        this.state.kioskMachine = order[0];
      }
    }

    if (this.stationSelect.value !== this.state.kioskMachine) {
      this.stationSelect.value = this.state.kioskMachine;
    }

    // Filter jobs for selected kiosk machine
    const jobs = this.state.scheduledJobs
      .filter(j => j.machine === this.state.kioskMachine)
      .sort((a, b) => a.startHour - b.startHour);

    // Auto-select first job if nothing is selected and we have jobs
    if (!this.selectedJobId && jobs.length > 0) {
      this.selectedJobId = jobs[0].id;
    }

    // Render Kiosk Queue list
    this.queueList.innerHTML = '';
    if (jobs.length === 0) {
      this.queueList.innerHTML = '<div class="empty-list-hint" style="font-size: 11px; padding: 10px;">No scheduled jobs for this station.</div>';
    } else {
      jobs.forEach(job => {
        const item = document.createElement('div');
        const isActive = job.id === this.selectedJobId;
        const isBlocked = this.state.isStepBlocked(job.id);
        
        let statusTag = 'Scheduled';
        if (job.status === 'Running') statusTag = 'Running';
        else if (job.status === 'Paused') statusTag = 'Paused';
        if (isBlocked) statusTag = 'Blocked';

        item.className = `kiosk-queue-item ${isActive ? 'active' : ''} ${isBlocked ? 'blocked' : ''}`;
        
        const stepIndicator = job.stepNum ? `[${job.stepNum}]` : '';
        const displayName = job.stepName ? `${job.partName} - ${job.stepName}` : job.partName;

        item.innerHTML = `
          <div class="kiosk-queue-header">
            <span><strong>${job.woId || job.id}</strong> ${stepIndicator} - ${displayName}</span>
            <span style="color: ${isBlocked ? 'var(--accent-red)' : (job.status === 'Running' ? 'var(--accent-green)' : 'var(--text-secondary)')}">${statusTag}</span>
          </div>
          <div style="font-size: 9px; margin-top: 3px; display:flex; justify-content:space-between;">
            <span>Customer: ${job.customer}</span>
            <span>Est: ${job.estHours}h (Start: ${this.formatTime(job.startHour, this.state.activeScale)})</span>
          </div>
        `;
        
        item.addEventListener('click', () => {
          this.selectedJobId = job.id;
          this.pauseBox.classList.add('hidden');
          this.state.notify();
        });
        
        this.queueList.appendChild(item);
      });
    }

    // Render Active Job details and controls
    const activeJob = this.state.scheduledJobs.find(j => j.id === this.selectedJobId);
    this.renderActiveJobBox(activeJob);
    this.renderCADBlueprint(activeJob);
  }

  formatTime(hourFloat) {
    const d = this.state.workingHourToDate(hourFloat);
    const day = d.getDate().toString().padStart(2, '0');
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const y = d.getFullYear();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${day}/${m}/${y} ${hh}:${mm}`;
  }

  formatDateOnly(hourFloat, scale) {
    const dayOffset = Math.floor(hourFloat / 24);
    // Baseline: Monday, 22 June 2026
    const baseDate = new Date(2026, 5, 22); 
    baseDate.setDate(baseDate.getDate() + dayOffset);
    const d = baseDate.getDate();
    const m = baseDate.getMonth() + 1;
    const y = baseDate.getFullYear();
    const dd = d.toString().padStart(2, '0');
    const mm = m.toString().padStart(2, '0');
    return `${dd}/${mm}/${y}`;
  }

  renderActiveJobBox(job) {
    if (!job) {
      this.activeJobBox.innerHTML = `
        <div style="height: 100%; display:flex; align-items:center; justify-content:center; color: var(--text-secondary); text-align:center;">
          <div>
            <p style="font-size: 14px; font-weight: bold; margin-bottom: 5px;">No Active Work Order Step</p>
            <p style="font-size: 11px;">Select an operation step from the queue to start.</p>
          </div>
        </div>
      `;
      this.btnSetup.disabled = true;
      this.btnRun.disabled = true;
      this.btnPause.disabled = true;
      this.btnComplete.disabled = true;
      return;
    }

    const isBlocked = this.state.isStepBlocked(job.id);

    // Tag styling
    let tagClass = 'scheduled';
    let statusText = job.status;
    if (job.status === 'Running') tagClass = 'running';
    else if (job.status === 'Paused') tagClass = 'paused';
    else if (job.status === 'Setup') tagClass = 'setup';
    
    if (isBlocked) {
      tagClass = 'paused'; // Render red/blocked style
      statusText = 'Blocked';
    }

    const stepLabel = job.stepNum ? `Step [${job.stepNum}]` : '';
    const operationName = job.stepName ? job.stepName : 'Processing';
    
    let alertDetails = '';
    if (isBlocked) {
      // Find what step we are waiting for
      const priorStepNum = job.stepNum - 10; // Simple estimation
      alertDetails = `<p style="color: var(--accent-red); font-size: 10px; margin-top: 5px; font-weight: bold; animation: pulse-flash 1s infinite alternate;">⚠️ BLOCKED: Waiting for prior step [${priorStepNum}] to complete.</p>`;
    } else if (job.delayReason) {
      alertDetails = `<p style="color: var(--accent-orange); font-size: 10px; margin-top: 5px;">⚠️ Hold Reason: <strong>${job.delayReason}</strong></p>`;
    }

    const scaledDueHour = this.state.getScaledDueHour(job);
    const dueTimeStr = this.formatDateOnly(scaledDueHour, this.state.activeScale);
    const startHourStr = this.formatTime(job.startHour, this.state.activeScale);
    const finishHourStr = this.formatTime(job.startHour + job.estHours, this.state.activeScale);

    const isAssemblyCard = (job.machine.toLowerCase() === 'assembly' || job.machine === 'Assembly');
    let assemblyBtnHtml = '';
    let assemblySummaryHtml = '';
    if (isAssemblyCard) {
      const links = this.state.assemblyLinks || [];
      const subPdIds = Array.from(new Set(links.filter(link => link.to === job.id).map(link => this.state.parseStepId(link.from).woId)));
      
      const totalPDs = subPdIds.length;
      const completedPDs = subPdIds.filter(subPdId => {
        const backlogWO = this.state.workOrders.find(wo => wo.id === subPdId);
        const backlogStepsCount = backlogWO ? backlogWO.steps.length : 0;
        const scheduledSteps = this.state.scheduledJobs.filter(j => j.woId === subPdId);
        const totalSteps = scheduledSteps.length + backlogStepsCount;
        const completedSteps = scheduledSteps.filter(j => j.status === 'Completed').length;
        return totalSteps > 0 && completedSteps === totalSteps;
      }).length;
      
      const readinessPercent = totalPDs > 0 ? Math.round((completedPDs / totalPDs) * 100) : 0;
      
      // Find the slowest pending sub-PD and its finish hour
      let slowestPdId = null;
      let maxSubPdFinishHour = 0;
      subPdIds.forEach(subPdId => {
        // Calculate max finish hour for this sub-PD
        const scheduledSteps = this.state.scheduledJobs.filter(j => j.woId === subPdId);
        let maxFinish = 0;
        scheduledSteps.forEach(s => {
          const finish = s.startHour + s.estHours;
          if (finish > maxFinish) {
            maxFinish = finish;
          }
        });
        
        // Check if this sub-PD is pending
        const backlogWO = this.state.workOrders.find(wo => wo.id === subPdId);
        const backlogStepsCount = backlogWO ? backlogWO.steps.length : 0;
        const totalSteps = scheduledSteps.length + backlogStepsCount;
        const completedSteps = scheduledSteps.filter(j => j.status === 'Completed').length;
        const isPending = completedSteps < totalSteps;
        
        if (isPending && maxFinish > maxSubPdFinishHour) {
          maxSubPdFinishHour = maxFinish;
          slowestPdId = subPdId;
        }
      });

      // Fallback to latest among all sub-PDs if none are pending
      if (!slowestPdId) {
        subPdIds.forEach(subPdId => {
          const scheduledSteps = this.state.scheduledJobs.filter(j => j.woId === subPdId);
          let maxFinish = 0;
          scheduledSteps.forEach(s => {
            const finish = s.startHour + s.estHours;
            if (finish > maxFinish) {
              maxFinish = finish;
            }
          });
          if (maxFinish > maxSubPdFinishHour) {
            maxSubPdFinishHour = maxFinish;
            slowestPdId = subPdId;
          }
        });
      }
      
      let slowestPdDateStr = '';
      if (slowestPdId && maxSubPdFinishHour > 0) {
        const d = this.state.workingHourToDate(maxSubPdFinishHour);
        const day = d.getDate().toString().padStart(2, '0');
        const m = (d.getMonth() + 1).toString().padStart(2, '0');
        const y = d.getFullYear();
        const hh = d.getHours().toString().padStart(2, '0');
        const mm = d.getMinutes().toString().padStart(2, '0');
        slowestPdDateStr = `${day}/${m}/${y} ${hh}:${mm}`;
      }

      assemblyBtnHtml = `
        <button id="kiosk-btn-assembly-status" class="btn" style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(34, 197, 94, 0.15); border: 1px solid var(--accent-green); color: var(--accent-green); font-weight: bold; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;">
          🔧 Assembly Parts
        </button>
      `;

      assemblySummaryHtml = `
        <div class="assembly-summary" style="font-size: 9px; color: var(--text-secondary); text-align: right; margin-top: 4px; line-height: 1.3;">
          <div>Parts: <strong style="color: var(--text-primary);">${completedPDs}/${totalPDs} PDs</strong></div>
          <div>Ready: <strong style="color: ${readinessPercent === 100 ? '#22c55e' : '#ef4444'};">${readinessPercent}%</strong></div>
          <div style="white-space: nowrap;">ช้าสุด: <strong style="color: var(--accent-red);">${slowestPdId || '-'}</strong></div>
          <div style="white-space: nowrap; font-size: 8.5px; opacity: 0.95; color: var(--accent-teal); font-weight: bold;">(${slowestPdDateStr || '-'})</div>
        </div>
      `;
    }

    this.activeJobBox.innerHTML = `
      <div class="card-top" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
        <!-- Left Column: All Job Details -->
        <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; padding-right: 12px;">
          <span class="card-id" style="font-size: 15px; font-weight: bold; color: var(--accent-teal);">${job.woId || job.id} ${stepLabel}</span>
          <h3 style="font-size: 14px; font-weight: 700; margin: 4px 0 2px 0; color: var(--text-primary);">${job.partName} - ${operationName}</h3>
          <p style="font-size: 11px; color: var(--text-secondary); margin: 0; line-height: 1.4;">Customer: <strong style="color: var(--text-primary);">${job.customer}</strong> | Qty: <strong style="color: var(--text-primary);">${job.qty} pcs</strong></p>
          <p style="font-size: 11px; color: var(--text-secondary); margin: 2px 0 0 0; line-height: 1.4;">Router Machine Station: <strong style="color: var(--text-primary);">${job.machine}</strong></p>
          <p style="font-size: 11px; color: var(--text-secondary); margin: 2px 0 0 0; line-height: 1.4;">Est Operation Time: <strong style="color: var(--text-primary);">${job.estHours} hours</strong> | Start: <strong>${startHourStr}</strong> | Est Finish: <strong style="color: var(--accent-teal);">${finishHourStr}</strong> | Due: <strong style="color: var(--accent-red);">${dueTimeStr}</strong></p>
          ${alertDetails}
        </div>
        <!-- Right Column: Status tag, Button, and Compact Summary -->
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;">
          <span class="kiosk-status-tag ${tagClass}" style="margin-top: 0;">${statusText}</span>
          ${assemblyBtnHtml}
          ${assemblySummaryHtml}
        </div>
      </div>
    `;

    if (isAssemblyCard) {
      const btnAssembly = this.activeJobBox.querySelector('#kiosk-btn-assembly-status');
      if (btnAssembly) {
        btnAssembly.addEventListener('click', () => {
          this.showAssemblyStatusModal(job);
        });
      }
    }

    // Disable clocking buttons if BLOCKED by routing sequence
    if (isBlocked) {
      this.btnSetup.disabled = true;
      this.btnRun.disabled = true;
      this.btnPause.disabled = true;
      this.btnComplete.disabled = true;
      return;
    }

    // Enable/disable timeclock buttons based on status normally
    if (job.status === 'Scheduled') {
      this.btnSetup.disabled = false;
      this.btnRun.disabled = false;
      this.btnPause.disabled = true;
      this.btnComplete.disabled = true;
    } else if (job.status === 'Setup') {
      this.btnSetup.disabled = true;
      this.btnRun.disabled = false; // Can start production run
      this.btnPause.disabled = false;
      this.btnComplete.disabled = true;
    } else if (job.status === 'Running') {
      this.btnSetup.disabled = true;
      this.btnRun.disabled = true;
      this.btnPause.disabled = false;
      this.btnComplete.disabled = false;
    } else if (job.status === 'Paused') {
      this.btnSetup.disabled = true;
      this.btnRun.disabled = false; // Can resume
      this.btnPause.disabled = true;
      this.btnComplete.disabled = true;
    }
  }

  // Draw technical interactive blueprints (SVG) based on machine & job
  renderCADBlueprint(job) {
    this.cadViewer.innerHTML = '<div class="cad-grid"></div>';
    
    let svgContent = '';

    if (!job) {
      svgContent = `
        <svg viewBox="0 0 400 240">
          <text x="200" y="120" fill="rgba(0, 242, 254, 0.2)" font-family="var(--font-display)" font-size="14" text-anchor="middle">AWAITING LIVE JOB LINK</text>
        </svg>
      `;
    } else if (this.state.kioskMachine === 'Laser Cutting') {
      if (job.isNest) {
        svgContent = `
          <svg viewBox="0 0 400 240" style="background:#020712;">
            <!-- Outer plate -->
            <rect x="30" y="30" width="340" height="180" fill="none" stroke="rgba(0, 242, 254, 0.4)" stroke-width="1.5" />
            <text x="35" y="25" fill="rgba(0, 242, 254, 0.6)" font-size="8" font-family="var(--font-display)">PLATE 2.0MM STEEL (4x8 FT)</text>
            
            <!-- Nest Parts -->
            <g>
              <rect class="nest-part" x="50" y="50" width="80" height="50" rx="4" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1">
                <title>Part WO-303 (Qty: 25) - Click to zoom</title>
              </rect>
              <rect class="nest-part" x="140" y="50" width="80" height="50" rx="4" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1">
                <title>Part WO-303 (Qty: 25)</title>
              </rect>
              <circle class="nest-part" cx="270" cy="75" r="30" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1">
                <title>Part WO-304 (Qty: 60)</title>
              </circle>
              <rect class="nest-part" x="50" y="120" width="120" height="60" rx="6" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1">
                <title>Part WO-307 (Qty: 100)</title>
              </rect>
              <circle class="nest-part" cx="240" cy="150" r="20" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1">
                <title>Part WO-304 (Qty: 60)</title>
              </circle>
              <rect class="nest-part" x="290" y="120" width="60" height="60" rx="4" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1">
                <title>Part WO-303 (Qty: 50)</title>
              </rect>
            </g>

            <!-- Animated Laser Head indicator if running -->
            ${job.status === 'Running' ? `
              <circle cx="160" cy="150" r="3" fill="#ff0000" class="laser-beam" />
              <line x1="50" y1="120" x2="170" y2="120" stroke="#ff3333" stroke-width="1" stroke-dasharray="3,3" />
              <text x="175" y="145" fill="var(--accent-red)" font-size="7" font-weight="bold">LASER CUTTING...</text>
            ` : ''}
          </svg>
        `;
      } else {
        svgContent = `
          <svg viewBox="0 0 400 240">
            <rect x="80" y="40" width="240" height="160" fill="none" stroke="rgba(0, 242, 254, 0.3)" stroke-width="1" stroke-dasharray="4,2"/>
            <path d="M 120 70 L 280 70 L 280 170 L 200 170 L 160 130 L 120 130 Z" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="2"/>
            <circle cx="160" cy="100" r="12" fill="none" stroke="var(--accent-teal)" stroke-width="1" />
            <circle cx="240" cy="120" r="12" fill="none" stroke="var(--accent-teal)" stroke-width="1" />
            <line x1="120" y1="60" x2="280" y2="60" stroke="rgba(255,255,255,0.3)" stroke-width="0.75" />
            <text x="200" y="55" fill="rgba(255,255,255,0.5)" font-size="8" text-anchor="middle">160.00 mm (LASER PATH)</text>
          </svg>
        `;
      }
    } else if (this.state.kioskMachine === 'CNC Milling') {
      svgContent = `
        <svg viewBox="0 0 400 240">
          <rect x="60" y="60" width="100" height="60" rx="3" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1.5" />
          <circle cx="110" cy="90" r="15" fill="none" stroke="var(--accent-teal)" stroke-width="1" />
          <circle cx="80" cy="90" r="6" fill="none" stroke="var(--accent-teal)" stroke-width="0.75" />
          <circle cx="140" cy="90" r="6" fill="none" stroke="var(--accent-teal)" stroke-width="0.75" />
          <text x="110" y="50" fill="rgba(255,255,255,0.4)" font-size="8" text-anchor="middle">TOP VIEW</text>

          <rect x="220" y="60" width="120" height="30" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1.5" />
          <rect x="250" y="90" width="60" height="40" fill="rgba(0, 242, 254, 0.05)" stroke="var(--accent-teal)" stroke-width="1.5" />
          <text x="280" y="50" fill="rgba(255,255,255,0.4)" font-size="8" text-anchor="middle">FRONT VIEW</text>
          
          <line x1="220" y1="140" x2="340" y2="140" stroke="rgba(255,255,255,0.3)" stroke-width="0.75" />
          <text x="280" y="152" fill="rgba(255,255,255,0.5)" font-size="8" text-anchor="middle">L: 120.0 mm (CNC MILL)</text>
        </svg>
      `;
    } else if (this.state.kioskMachine === 'Welding Cell') {
      svgContent = `
        <svg viewBox="0 0 400 240">
          <!-- Weld Joint blueprint -->
          <rect x="80" y="80" width="100" height="20" fill="none" stroke="var(--accent-teal)" stroke-width="1.5"/>
          <rect x="220" y="80" width="100" height="20" fill="none" stroke="var(--accent-teal)" stroke-width="1.5"/>
          <line x1="180" y1="90" x2="220" y2="90" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
          <!-- Weld Bead -->
          <path d="M 180 90 Q 200 70 220 90" fill="rgba(189, 0, 255, 0.2)" stroke="var(--accent-purple)" stroke-width="3" stroke-dasharray="2,2"/>
          <polygon points="200,90 190,110 210,110" fill="none" stroke="var(--accent-purple)" stroke-width="1"/>
          <text x="200" y="125" fill="rgba(255,255,255,0.5)" font-size="8" text-anchor="middle">WELD JOINT DETAIL</text>
        </svg>
      `;
    } else if (this.state.kioskMachine === 'Quality Control') {
      svgContent = `
        <svg viewBox="0 0 400 240">
          <!-- Caliper Micrometer measuring part -->
          <rect x="150" y="90" width="100" height="40" fill="none" stroke="var(--accent-teal)" stroke-width="1"/>
          <!-- Caliper Jaws -->
          <path d="M 120 70 L 150 70 L 150 140 L 120 140 L 120 120 L 140 120 L 140 90 L 120 90 Z" fill="none" stroke="var(--accent-cyan)" stroke-width="1.5"/>
          <rect x="250" y="70" width="30" height="70" fill="none" stroke="var(--accent-cyan)" stroke-width="1.5"/>
          <!-- Dial Gauge indicator -->
          <circle cx="200" cy="50" r="15" fill="none" stroke="var(--accent-cyan)" stroke-width="1.5"/>
          <line x1="200" y1="50" x2="208" y2="42" stroke="var(--accent-cyan)" stroke-width="2"/>
          <text x="200" y="150" fill="rgba(255,255,255,0.5)" font-size="8" text-anchor="middle">QC DIMENSIONAL CALIBRATION</text>
        </svg>
      `;
    } else {
      svgContent = `
        <svg viewBox="0 0 400 240">
          <circle cx="200" cy="110" r="50" fill="none" stroke="var(--accent-teal)" stroke-width="1.5" stroke-dasharray="5,2" />
          <line x1="100" y1="110" x2="300" y2="110" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
          <line x1="200" y1="40" x2="200" y2="180" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
          <text x="200" y="210" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="middle">PROCESS METHOD: ${job.machine.toUpperCase()}</text>
        </svg>
      `;
    }

    this.cadViewer.insertAdjacentHTML('beforeend', svgContent);
  }

  showAssemblyStatusModal(job) {
    if (!this.assemblyPartsModal || !this.assemblyPartsBody) return;
    
    const links = this.state.assemblyLinks || [];
    const subPdIds = Array.from(new Set(links.filter(link => link.to === job.id).map(link => this.state.parseStepId(link.from).woId)));
    
    // First, calculate the max finish hour for each sub-PD
    const pdFinishHours = {};
    subPdIds.forEach(subPdId => {
      const scheduledSteps = this.state.scheduledJobs.filter(j => j.woId === subPdId);
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
      const backlogWO = this.state.workOrders.find(wo => wo.id === subPdId);
      const backlogStepsCount = backlogWO ? backlogWO.steps.length : 0;
      const scheduledSteps = this.state.scheduledJobs.filter(j => j.woId === subPdId);
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

    let html = '';
    if (subPdIds.length === 0) {
      html = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center; padding: 20px 0;">No sub-PDs are currently linked to this assembly step.</p>';
    } else {
      subPdIds.forEach(subPdId => {
        // Get all steps for this PD
        const backlogWO = this.state.workOrders.find(wo => wo.id === subPdId);
        const backlogSteps = backlogWO ? backlogWO.steps : [];
        const scheduledSteps = this.state.scheduledJobs.filter(j => j.woId === subPdId);
        
        const partName = backlogWO?.partName || scheduledSteps[0]?.partName || 'Unknown';
        
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
        let planFinishDateStr = 'Not Scheduled';
        const maxFinishHour = pdFinishHours[subPdId] || 0;
        if (maxFinishHour > 0) {
          const d = this.state.workingHourToDate(maxFinishHour);
          const day = d.getDate().toString().padStart(2, '0');
          const m = (d.getMonth() + 1).toString().padStart(2, '0');
          const y = d.getFullYear();
          const hh = d.getHours().toString().padStart(2, '0');
          const mm = d.getMinutes().toString().padStart(2, '0');
          planFinishDateStr = `${day}/${m}/${y} ${hh}:${mm}`;
        }

        const isSlowest = (subPdId === slowestPdId);
        const slowestPrefix = isSlowest ? `<span style="color: #ef4444; font-weight: bold; margin-right: 6px; border: 1.5px solid #ef4444; padding: 1px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.1); font-size: 10px; animation: pulse-flash 0.8s infinite alternate; vertical-align: middle;">ช้าสุด</span>` : '';
        
        let infoStr = `Part: <strong style="color: var(--text-primary); font-size: 11px;">${partName}</strong>`;
        if (isPdPending) {
          infoStr += ` | Plan Finish: <strong style="color: var(--accent-teal); font-size: 11px;">${planFinishDateStr}</strong>`;
        } else {
          infoStr += ` | <strong style="color: var(--accent-green); font-size: 11px;">Completed (เสร็จสิ้น)</strong>`;
        }
        
        html += `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; width: 100%;">
              <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 13px; font-weight: bold;">
                ${slowestPrefix}
                <span style="color: var(--accent-teal); margin-right: 4px;">Production Order: ${subPdId}</span>
                <span style="color: var(--text-secondary); font-weight: normal; font-size: 11px;">| ${infoStr}</span>
              </div>
              <span style="font-size: 11px; opacity: 0.8; font-weight: normal; color: var(--text-secondary);">(${allSteps.length} Steps)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
        `;
        
        allSteps.forEach((step, idx) => {
          const isDone = step.status === 'Completed';
          const color = isDone ? '#22c55e' : '#ef4444';
          const bg = isDone ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
          
          html += `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1.5px solid ${color}; background: ${bg}; color: ${color}; border-radius: 6px; padding: 6px 12px; min-width: 90px; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,0.2);">
              <span style="font-size: 11px; font-weight: bold; text-transform: uppercase;">${step.name}</span>
              <span style="font-size: 9px; opacity: 0.85; margin-top: 2px;">${isDone ? 'Completed' : 'Pending'}</span>
            </div>
          `;
          if (idx < allSteps.length - 1) {
            html += `<span style="color: var(--text-secondary); font-weight: bold; font-size: 16px; user-select: none;">➔</span>`;
          }
        });
        
        html += `
            </div>
          </div>
        `;
      });
    }
    
    this.assemblyPartsBody.innerHTML = html;
    this.assemblyPartsModal.dataset.jobId = job.id;
    this.assemblyPartsModal.classList.remove('hidden');
  }
}
