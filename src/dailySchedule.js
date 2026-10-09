export class DailyScheduleController {
  constructor(state) {
    this.state = state;
    this.selectedMachine = null;
    this.selectedDate = new Date();
    this.initElements();
    this.bindEvents();
    
    // Register controller to state so others can access it
    this.state.dailyScheduleController = this;
  }

  initElements() {
    this.modal = document.getElementById('wc-daily-schedule-modal');
    this.btnClose = document.getElementById('btn-close-wc-daily');
    this.btnCloseFooter = document.getElementById('btn-close-wc-daily-footer');
    this.btnPrevDay = document.getElementById('btn-prev-day');
    this.btnNextDay = document.getElementById('btn-next-day');
    this.btnExportPDF = document.getElementById('btn-export-daily-pdf');
    this.btnExportExcel = document.getElementById('btn-export-daily-excel');
    this.viewModeSelect = document.getElementById('wc-schedule-view-mode');
    
    this.titleLabel = document.getElementById('wc-daily-title');
    this.dateLabel = document.getElementById('wc-daily-date-label');
    this.timelineContainer = document.getElementById('wc-daily-schedule-timeline');
    this.emptyMsg = document.getElementById('wc-daily-empty-msg');
  }

  bindEvents() {
    if (this.btnClose) this.btnClose.addEventListener('click', () => this.close());
    if (this.btnCloseFooter) this.btnCloseFooter.addEventListener('click', () => this.close());
    
    if (this.btnPrevDay) {
      this.btnPrevDay.addEventListener('click', () => {
        this.navigateTime(-1);
      });
    }
    
    if (this.btnNextDay) {
      this.btnNextDay.addEventListener('click', () => {
        this.navigateTime(1);
      });
    }

    if (this.btnExportPDF) {
      this.btnExportPDF.addEventListener('click', () => this.exportDailyPDF());
    }

    if (this.btnExportExcel) {
      this.btnExportExcel.addEventListener('click', () => this.exportAllWorkCentersExcel());
    }

    if (this.viewModeSelect) {
      this.viewModeSelect.addEventListener('change', () => {
        this.render();
      });
    }
  }

  navigateTime(direction) {
    const viewMode = this.viewModeSelect ? this.viewModeSelect.value : 'daily';
    if (viewMode === 'daily') {
      this.selectedDate.setDate(this.selectedDate.getDate() + direction);
    } else if (viewMode === 'weekly') {
      this.selectedDate.setDate(this.selectedDate.getDate() + (direction * 7));
    } else if (viewMode === 'monthly') {
      this.selectedDate.setMonth(this.selectedDate.getMonth() + direction);
    }
    this.render();
  }

  open(machineName, initialDate = null, viewMode = null) {
    this.selectedMachine = machineName;
    
    // Set view mode if specified, otherwise keep current or fallback to 'daily'
    if (this.viewModeSelect) {
      if (viewMode) {
        this.viewModeSelect.value = viewMode;
      } else if (!this.viewModeSelect.value) {
        this.viewModeSelect.value = 'daily';
      }
    }

    if (initialDate) {
      this.selectedDate = new Date(initialDate.getTime());
    } else {
      const baseDate = this.state.getBaseDate();
      this.selectedDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0);
    }
    
    if (this.modal) {
      this.modal.classList.remove('hidden');
      this.render();
    }
  }

  close() {
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
  }

  getWeekRange(date) {
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday is start of week
    const monday = new Date(date.getFullYear(), date.getMonth(), diff);
    const sunday = new Date(date.getFullYear(), date.getMonth(), diff + 6);
    return { monday, sunday };
  }

  formatThaiDate(date) {
    const days = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
    const months = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    
    const dayName = days[date.getDay()];
    const day = date.getDate();
    const monthName = months[date.getMonth()];
    const yearThai = date.getFullYear() + 543;
    
    return `${dayName}ที่ ${day} ${monthName} ${yearThai}`;
  }

  formatThaiWeek(date) {
    const { monday, sunday } = this.getWeekRange(date);
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const monStr = `${monday.getDate()} ${months[monday.getMonth()]}`;
    const sunStr = `${sunday.getDate()} ${months[sunday.getMonth()]}`;
    const yearThai = sunday.getFullYear() + 543;
    return `สัปดาห์ที่ ${monStr} - ${sunStr} ${yearThai}`;
  }

  formatThaiMonth(date) {
    const monthsFull = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const yearThai = date.getFullYear() + 543;
    return `เดือน${monthsFull[date.getMonth()]} ${yearThai}`;
  }

  formatTime(date) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm} น.`;
  }

  // Prefers the PD detail's actual Mat status (issueSummary, same source as the PD modal, Mat รอเบิก
  // report, and the "สถานะเบิกวัสดุ" line below) when this step has tracked raw materials; falls back
  // to the previous-step scheduling heuristic only for steps with no material tracking data at all.
  getMaterialReadiness(job, prevStep, issueSummary) {
    if (issueSummary) {
      const toneStyle = {
        notready: { color: 'var(--accent-red)', bgColor: 'rgba(255, 51, 51, 0.1)', borderColor: 'var(--accent-red)' },
        warn: { color: 'var(--accent-orange)', bgColor: 'rgba(255, 165, 0, 0.1)', borderColor: 'var(--accent-orange)' },
        old: { color: '#7c3aed', bgColor: 'rgba(124, 58, 237, 0.1)', borderColor: '#7c3aed' },
        info: { color: '#0284c7', bgColor: 'rgba(2, 132, 199, 0.1)', borderColor: '#0284c7' },
        ok: { color: 'var(--accent-teal)', bgColor: 'rgba(0, 242, 254, 0.1)', borderColor: 'var(--accent-teal)' },
        ready: { color: 'var(--accent-teal)', bgColor: 'rgba(0, 242, 254, 0.1)', borderColor: 'var(--accent-teal)' }
      };
      const colors = toneStyle[issueSummary.tone] || toneStyle.info;
      return {
        status: issueSummary.tone,
        text: issueSummary.label + (issueSummary.count < issueSummary.total ? ` (${issueSummary.count}/${issueSummary.total} รายการ)` : ''),
        ...colors
      };
    }

    if (!prevStep) {
      return {
        status: 'Ready',
        text: 'พร้อม (คลังสินค้าจัดเตรียมแล้ว)',
        color: 'var(--accent-teal)',
        bgColor: 'rgba(0, 242, 254, 0.1)',
        borderColor: 'var(--accent-teal)'
      };
    }
    
    const prevJob = this.state.scheduledJobs.find(j => j.woId === job.woId && j.stepNum === prevStep.stepNum);
    
    if (prevJob) {
      const finishesBefore = (prevJob.startHour + prevJob.estHours) <= job.startHour;
      if (finishesBefore) {
        return {
          status: 'Ready',
          text: `พร้อม (ผ่านขั้นตอน ${prevStep.name} แล้ว)`,
          color: 'var(--accent-teal)',
          bgColor: 'rgba(0, 242, 254, 0.1)',
          borderColor: 'var(--accent-teal)'
        };
      } else {
        return {
          status: 'Waiting',
          text: `รอส่งมอบจากขั้นตอน ${prevStep.name}`,
          color: 'var(--accent-orange)',
          bgColor: 'rgba(255, 165, 0, 0.1)',
          borderColor: 'var(--accent-orange)'
        };
      }
    }
    
    return {
      status: 'Backlog',
      text: `รอจัดคิวขั้นตอนก่อนหน้า (${prevStep.name})`,
      color: 'var(--accent-red)',
      bgColor: 'rgba(255, 51, 51, 0.1)',
      borderColor: 'var(--accent-red)'
    };
  }

  render() {
    if (!this.selectedMachine) return;
    
    const wcName = this.state.workCenters[this.selectedMachine]?.name || this.selectedMachine;
    if (this.titleLabel) {
      this.titleLabel.textContent = `${this.selectedMachine} - ${wcName}`;
    }
    
    const viewMode = this.viewModeSelect ? this.viewModeSelect.value : 'daily';
    
    // Update Date/Range Label based on mode
    if (this.dateLabel) {
      if (viewMode === 'daily') {
        this.dateLabel.textContent = this.formatThaiDate(this.selectedDate);
      } else if (viewMode === 'weekly') {
        this.dateLabel.textContent = this.formatThaiWeek(this.selectedDate);
      } else if (viewMode === 'monthly') {
        this.dateLabel.textContent = this.formatThaiMonth(this.selectedDate);
      }
    }
    
    // Filter scheduled jobs for this machine based on mode
    const targetJobs = this.state.scheduledJobs.filter(job => {
      if (job.machine !== this.selectedMachine) return false;
      if (job.status === 'Completed') return false;

      const jobDate = this.state.workingHourToDate(job.startHour);
      
      if (viewMode === 'daily') {
        return jobDate.getFullYear() === this.selectedDate.getFullYear() &&
               jobDate.getMonth() === this.selectedDate.getMonth() &&
               jobDate.getDate() === this.selectedDate.getDate();
      } else if (viewMode === 'weekly') {
        const { monday, sunday } = this.getWeekRange(this.selectedDate);
        const startOfWeek = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0);
        const endOfWeek = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59);
        return jobDate >= startOfWeek && jobDate <= endOfWeek;
      } else if (viewMode === 'monthly') {
        return jobDate.getFullYear() === this.selectedDate.getFullYear() &&
               jobDate.getMonth() === this.selectedDate.getMonth();
      }
      return false;
    });
    
    targetJobs.sort((a, b) => a.startHour - b.startHour);

    this.timelineContainer.innerHTML = '';

    if (targetJobs.length === 0) {
      this.emptyMsg.classList.remove('hidden');
      return;
    }
    
    this.emptyMsg.classList.add('hidden');

    // PD -> name of the Operation whose imported status is "Ready to Start" (same data as the
    // Resources "Ready to Start" list), looked up once for every card in this view.
    const readyToStartByPd = new Map();
    (this.state.getReadyToStartByWorkCenter?.() || new Map()).forEach(rows => {
      rows.forEach(r => { if (!readyToStartByPd.has(r.pdId)) readyToStartByPd.set(r.pdId, r.opName); });
    });

    targetJobs.forEach(job => {
      const dateStart = this.state.workingHourToDate(job.startHour);
      const dateEnd = this.state.workingHourToDate(job.startHour + job.estHours);
      
      const timeStartStr = this.formatTime(dateStart);
      const timeEndStr = this.formatTime(dateEnd);
      
      const hasOT = dateEnd.getHours() > 17 || (dateEnd.getHours() === 17 && dateEnd.getMinutes() > 0);
      const otSuffix = hasOT ? ' <span style="color: var(--accent-red); font-size: 8.5px; font-weight: bold; background: rgba(255,51,51,0.1); padding: 1px 3px; border-radius: 3px;">+ OT</span>' : '';
      
      const wo = this.state.workOrders.find(w => w.id === job.woId);
      let prevWCStr = 'ไม่มี (ขั้นตอนแรก / คลังวัตถุดิบ)';
      let nextWCStr = 'คลังสินค้าสำเร็จรูป (FG)';
      let prevStep = null;
      let nextStep = null;
      
      let sortedSteps = [];
      if (wo && wo.steps && wo.steps.length > 0) {
        sortedSteps = [...wo.steps].sort((a, b) => a.stepNum - b.stepNum);
      } else {
        sortedSteps = this.state.scheduledJobs
          .filter(j => j.woId === job.woId)
          .sort((a, b) => a.stepNum - b.stepNum);
      }
      
      if (sortedSteps.length > 0) {
        const currentIndex = sortedSteps.findIndex(s => s.stepNum === job.stepNum);
        if (currentIndex > 0) {
          prevStep = sortedSteps[currentIndex - 1];
          const name = prevStep.name || prevStep.stepName || prevStep.partName || 'Operation';
          prevWCStr = `${name} (${prevStep.machine})`;
        }
        if (currentIndex !== -1 && currentIndex < sortedSteps.length - 1) {
          nextStep = sortedSteps[currentIndex + 1];
          const name = nextStep.name || nextStep.stepName || nextStep.partName || 'Operation';
          nextWCStr = `${name} (${nextStep.machine})`;
        } else {
          // Last step: check if it goes to another PD
          if (this.state.assemblyLinks) {
            const link = this.state.assemblyLinks.find(l => l.from === job.id);
            if (link) {
              const toWoId = link.to.split('-')[0];
              nextWCStr = `ประกอบเข้า ${toWoId}`;
            }
          }
        }
      }
      
      const issueSummary = this.state.getStepMaterialIssueSummary(job.woId, job.stepNum);
      const readiness = this.getMaterialReadiness(job, prevStep, issueSummary);
      const issueTones = { ok: '#15803d', warn: '#b45309', info: '#0369a1', old: '#5b21b6', notready: '#7f1d1d', ready: '#14532d' };
      const issueHtml = issueSummary
        ? `<span>📦 สถานะเบิกวัสดุ: <strong class="${issueSummary.tone === 'notready' ? 'mat-status-blink' : ''}" style="color: ${issueTones[issueSummary.tone]};">${issueSummary.label}${issueSummary.count < issueSummary.total ? ` (${issueSummary.count}/${issueSummary.total} รายการ)` : ''}</strong></span>`
        : '';

      const readyOpName = readyToStartByPd.get(job.woId) || '';
      const readyOpHtml = readyOpName
        ? `<span>▶ Op ปัจจุบัน: <strong class="rev-blink">${readyOpName}</strong></span>`
        : '';

      const latestRev = this.state.getLatestRevision ? this.state.getLatestRevision(job.woId) : null;
      const revHtml = latestRev ? ` <span class="rev-blink" title="Rev ${latestRev.rev} (ปรับปรุงแบบล่าสุด) · แจ้ง ${latestRev.noticeDate || '-'} · ใบแจ้ง ${latestRev.noticeNo || '-'}">Rev ${latestRev.rev}</span>` : '';

      // If we are in weekly/monthly view, prepend the date to the card time block
      let datePrefix = '';
      if (viewMode !== 'daily') {
        const daysShort = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
        const monthsShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        datePrefix = `<span style="font-size: 9.5px; color: var(--accent-cyan); font-weight: bold; margin-bottom: 3px; display: block; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 2px; width: 100%; text-align: left;">${daysShort[dateStart.getDay()]} ${dateStart.getDate()} ${monthsShort[dateStart.getMonth()]}</span>`;
      }

      const card = document.createElement('div');
      card.className = 'daily-job-card';
      card.title = 'ดับเบิลคลิกเพื่อแก้ไข Production Order นี้';
      card.style.cssText = `
        display: flex;
        background: rgba(255,255,255,0.02);
        border: 1px solid var(--border-glass);
        border-left: 4px solid var(--accent-teal);
        border-radius: 8px;
        padding: 12px;
        gap: 12px;
        transition: all 0.2s;
        box-shadow: 0 4px 10px rgba(0,0,0,0.15);
        cursor: pointer;
      `;
      
      card.innerHTML = `
        <!-- Time block -->
        <div style="flex: 0 0 150px; display: flex; flex-direction: column; border-right: 1px dashed var(--border-glass); padding-right: 12px; justify-content: center; align-items: flex-start;">
          ${datePrefix}
          <span style="font-size: 9.5px; color: var(--text-secondary); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">ช่วงเวลาทำงาน</span>
          <strong style="font-size: 14px; color: var(--text-primary); margin-top: 4px;">${timeStartStr} - ${timeEndStr}${otSuffix}</strong>
          <span style="font-size: 10.5px; color: var(--text-secondary); margin-top: 3px;">Duration: <strong>${job.estHours.toFixed(2)}h</strong></span>
        </div>

        <!-- Job details: 3 fixed lines -->
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 8px; padding-left: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
            <span style="font-size: 13px; color: var(--text-primary);"><strong style="color: var(--accent-teal);">PD ID: ${job.woId}</strong> &nbsp;·&nbsp; ชื่องาน: <strong>${job.partName}</strong> &nbsp;·&nbsp; รหัสแบบ: <strong style="color: var(--accent-cyan); font-family: monospace;">${job.dwgNo || 'N/A'}</strong>${revHtml} &nbsp;·&nbsp; จำนวนผลิต: <strong>${job.qty}</strong> pcs</span>
            <span class="priority-badge ${job.priority ? job.priority.toLowerCase() : 'normal'}" style="font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 700; flex-shrink: 0;">${job.priority || 'Normal'}</span>
          </div>
          <div style="font-size: 11.5px; color: var(--text-secondary); display: flex; gap: 20px; flex-wrap: wrap;">
            <span>Customer: <strong style="color: var(--text-primary);">${job.customer || 'N/A'}</strong></span>
            <span>เลขที่ SO: <strong style="color: var(--accent-teal); font-weight: bold;">${job.project || 'N/A'}</strong></span>
          </div>
          <div style="font-size: 11.5px; color: var(--text-secondary); display: flex; gap: 20px; flex-wrap: wrap;">
            <span>📥 Operation ก่อนหน้า: <strong style="color: var(--text-primary);">${prevWCStr}</strong></span>
            <span>📤 Operation ถัดไป: <strong style="color: var(--text-primary);">${nextWCStr}</strong></span>
            ${readyOpHtml}
            ${issueHtml}
          </div>
        </div>
      `;

      card.addEventListener('dblclick', (e) => {
        const currentMachine = this.selectedMachine;
        const currentDate = new Date(this.selectedDate);
        const currentViewMode = this.viewModeSelect ? this.viewModeSelect.value : 'daily';

        this.close();
        window.dispatchEvent(new CustomEvent('open-pd-modal', {
          detail: {
            woId: job.woId,
            returnCallback: () => {
              this.open(currentMachine, currentDate, currentViewMode);
            }
          }
        }));
      });

      this.timelineContainer.appendChild(card);
    });
  }

  // Jobs of one machine that fall inside the period currently selected in the modal (day / week / month)
  getJobsForMachineInPeriod(machine, viewMode) {
    const { monday, sunday } = this.getWeekRange(this.selectedDate);
    const startOfWeek = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0);
    const endOfWeek = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59);
    return this.state.scheduledJobs.filter(job => {
      if (job.machine !== machine) return false;
      if (job.status === 'Completed') return false;
      const d = this.state.workingHourToDate(job.startHour);
      if (viewMode === 'daily') {
        return d.getFullYear() === this.selectedDate.getFullYear() && d.getMonth() === this.selectedDate.getMonth() && d.getDate() === this.selectedDate.getDate();
      }
      if (viewMode === 'weekly') return d >= startOfWeek && d <= endOfWeek;
      if (viewMode === 'monthly') return d.getFullYear() === this.selectedDate.getFullYear() && d.getMonth() === this.selectedDate.getMonth();
      return false;
    }).sort((a, b) => a.startHour - b.startHour);
  }

  // Previous / next operation of a job (same wording as the card and the PDF)
  getJobNeighbors(job) {
    const wo = this.state.workOrders.find(w => w.id === job.woId);
    let prevWCStr = 'ไม่มี (ขั้นตอนแรก / คลังวัตถุดิบ)';
    let nextWCStr = 'คลังสินค้าสำเร็จรูป (FG)';
    let prevStep = null;
    const sortedSteps = (wo && wo.steps && wo.steps.length > 0)
      ? [...wo.steps].sort((a, b) => a.stepNum - b.stepNum)
      : this.state.scheduledJobs.filter(j => j.woId === job.woId).sort((a, b) => a.stepNum - b.stepNum);
    if (sortedSteps.length > 0) {
      const idx = sortedSteps.findIndex(st => st.stepNum === job.stepNum);
      if (idx > 0) {
        prevStep = sortedSteps[idx - 1];
        prevWCStr = `${prevStep.name || prevStep.stepName || prevStep.partName || 'Operation'} (${prevStep.machine})`;
      }
      if (idx !== -1 && idx < sortedSteps.length - 1) {
        const nextStep = sortedSteps[idx + 1];
        nextWCStr = `${nextStep.name || nextStep.stepName || nextStep.partName || 'Operation'} (${nextStep.machine})`;
      } else if (this.state.assemblyLinks) {
        const link = this.state.assemblyLinks.find(l => l.from === job.id);
        if (link) nextWCStr = `ประกอบเข้า ${link.to.split('-')[0]}`;
      }
    }
    return { prevWCStr, nextWCStr, prevStep };
  }

  // Excel: one workbook, one sheet per Work Center (only those with jobs in the selected period),
  // columns follow the daily-schedule card (time, PD, part, Dwg, Qty, customer, SO, prev/next op, Mat status)
  // plus the Op01 raw-material list the PDF prints.
  exportAllWorkCentersExcel() {
    if (typeof XLSX === 'undefined') {
      this.state.ganttController?.showToast?.('⚠️ ไม่พบตัวสร้างไฟล์ Excel (XLSX) กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'error');
      return;
    }
    const viewMode = this.viewModeSelect ? this.viewModeSelect.value : 'daily';
    const periodLabel = viewMode === 'weekly' ? this.formatThaiWeek(this.selectedDate)
      : viewMode === 'monthly' ? this.formatThaiMonth(this.selectedDate)
      : this.formatThaiDate(this.selectedDate);

    const order = (this.state.workCenterOrder && this.state.workCenterOrder.length)
      ? this.state.workCenterOrder.filter(k => this.state.workCenters[k])
      : Object.keys(this.state.workCenters || {});
    const machines = [...new Set([...order, ...Object.keys(this.state.workCenters || {})])];

    const pad = (n) => String(n).padStart(2, '0');
    const fmtDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const usedNames = new Set();
    const sheetNameFor = (machine) => {
      const wcLabel = this.state.workCenters[machine]?.name;
      const fullName = wcLabel && wcLabel !== machine ? `${machine} ${wcLabel}` : String(machine);
      let base = fullName.replace(/[\\/?*\[\]:]/g, '-').trim().slice(0, 31) || 'WC';
      let name = base;
      let i = 2;
      while (usedNames.has(name.toLowerCase())) {
        const suffix = `~${i++}`;
        name = base.slice(0, 31 - suffix.length) + suffix;
      }
      usedNames.add(name.toLowerCase());
      return name;
    };

    const header = ['ลำดับ', 'วันที่', 'เวลาเริ่ม', 'เวลาสิ้นสุด', 'Duration (ชม.)', 'OT', 'Priority', 'เลขที่ PD', 'ชื่องาน',
      'รหัสแบบ (Dwg)', 'จำนวนผลิต', 'Customer', 'เลขที่ SO', 'Operation ที่ Ready to Start', 'Op No.', 'Operation ก่อนหน้า', 'Operation ถัดไป', 'สถานะเบิกวัสดุ',
      'Mat. Op1 (รหัส)', 'Mat. Op1 (รายละเอียด)', 'Mat. Op1 (จำนวน)', 'Mat. Op1 (สถานะ)'];
    const widths = [6, 11, 9, 11, 13, 5, 9, 14, 38, 18, 11, 26, 24, 16, 7, 34, 34, 26, 16, 36, 14, 18];

    // PD -> name of the Operation whose imported status is "Ready to Start" (first match; a PD normally
    // has at most one Operation ready at a time), reusing the same data as the Resources "Ready to Start" list.
    const readyToStartByPd = new Map();
    (this.state.getReadyToStartByWorkCenter?.() || new Map()).forEach(rows => {
      rows.forEach(r => { if (!readyToStartByPd.has(r.pdId)) readyToStartByPd.set(r.pdId, r.opName); });
    });

    const wb = XLSX.utils.book_new();
    let sheets = 0;
    let totalJobs = 0;
    machines.forEach(machine => {
      const jobs = this.getJobsForMachineInPeriod(machine, viewMode);
      if (jobs.length === 0) return;
      const rows = [header];
      jobs.forEach((job, idx) => {
        const dStart = this.state.workingHourToDate(job.startHour);
        const dEnd = this.state.workingHourToDate(job.startHour + job.estHours);
        const hasOT = dEnd.getHours() > 17 || (dEnd.getHours() === 17 && dEnd.getMinutes() > 0);
        const { prevWCStr, nextWCStr, prevStep } = this.getJobNeighbors(job);
        const issue = this.state.getStepMaterialIssueSummary(job.woId, job.stepNum);
        const issueText = issue ? issue.label + (issue.count < issue.total ? ` (${issue.count}/${issue.total} รายการ)` : '') : '';
        const mats = !prevStep ? (this.state.getStepMaterialsList(job.woId, job.stepNum) || []) : [];
        const rev = this.state.getLatestRevision ? this.state.getLatestRevision(job.woId) : null;
        const dwgCell = (job.dwgNo || '') + (rev ? ` (Rev ${rev.rev})` : '');
        rows.push([
          idx + 1, fmtDate(dStart), fmtTime(dStart), fmtTime(dEnd), Number(Number(job.estHours || 0).toFixed(2)), hasOT ? 'OT' : '',
          job.priority || '', job.woId, job.partName || '', dwgCell, job.qty ?? '', job.customer || '', job.project || '',
          readyToStartByPd.get(job.woId) || '',
          job.stepNum ?? '', prevWCStr, nextWCStr, issueText,
          mats.map(m => m.mat).join(' | '),
          mats.map(m => m.desc || '').join(' | '),
          mats.map(m => m.qty).join(' | '),
          mats.map(m => (m.status ? m.status.label : '')).join(' | ')
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = widths.map(w => ({ wch: w }));
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };
      XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(machine));
      sheets++;
      totalJobs += jobs.length;
    });

    if (sheets === 0) {
      this.state.ganttController?.showToast?.(`ℹ️ ไม่มีแผนงานของ Work Center ใดในช่วง ${periodLabel}`, 'info');
      return;
    }
    const d = this.selectedDate;
    const fileName = `WorkCenter_Plan_${viewMode}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
    XLSX.writeFile(wb, fileName);
    this.state.ganttController?.showToast?.(`📊 ส่งออก Excel แล้ว: ${sheets} Work Center, ${totalJobs} งาน (${periodLabel})`, 'success');
  }

  exportDailyPDF() {
    if (!this.selectedMachine) return;
    
    const viewMode = this.viewModeSelect ? this.viewModeSelect.value : 'daily';
    
    // Filter scheduled jobs for this machine based on mode
    const targetJobs = this.state.scheduledJobs.filter(job => {
      if (job.machine !== this.selectedMachine) return false;
      if (job.status === 'Completed') return false;

      const jobDate = this.state.workingHourToDate(job.startHour);
      
      if (viewMode === 'daily') {
        return jobDate.getFullYear() === this.selectedDate.getFullYear() &&
               jobDate.getMonth() === this.selectedDate.getMonth() &&
               jobDate.getDate() === this.selectedDate.getDate();
      } else if (viewMode === 'weekly') {
        const { monday, sunday } = this.getWeekRange(this.selectedDate);
        const startOfWeek = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0);
        const endOfWeek = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59);
        return jobDate >= startOfWeek && jobDate <= endOfWeek;
      } else if (viewMode === 'monthly') {
        return jobDate.getFullYear() === this.selectedDate.getFullYear() &&
               jobDate.getMonth() === this.selectedDate.getMonth();
      }
      return false;
    });
    
    targetJobs.sort((a, b) => a.startHour - b.startHour);
    
    const wcName = this.state.workCenters[this.selectedMachine]?.name || this.selectedMachine;
    
    let reportTitle = 'แผนการผลิตประจำวัน (Daily Production Plan)';
    let dateRangeStr = this.formatThaiDate(this.selectedDate);
    
    if (viewMode === 'weekly') {
      reportTitle = 'แผนการผลิตประจำสัปดาห์ (Weekly Production Plan)';
      dateRangeStr = this.formatThaiWeek(this.selectedDate);
    } else if (viewMode === 'monthly') {
      reportTitle = 'แผนการผลิตประจำเดือน (Monthly Production Plan)';
      dateRangeStr = this.formatThaiMonth(this.selectedDate);
    }
    
    // Create print content
    let jobsHtml = '';
    const colSpanVal = viewMode !== 'daily' ? 9 : 8;
    // Op01 material sub-row splits the same colspan into 5 aligned cells: starts right at the
    // ลำดับ/เวลา border, a checkbox under "เวลา", Mat code(s) under "เลขที่ PD",
    // Qty under "เลขที่ SO", then description + status spanning the rest.
    const matColA = viewMode !== 'daily' ? 2 : 1; // ลำดับ + [วันที่]
    const matColD = colSpanVal - matColA - 3; // รหัสแบบ + ชื่อชิ้นงาน + จำนวนชิ้น + Next Op
    
    if (targetJobs.length === 0) {
      jobsHtml = `<tr><td colspan="${colSpanVal}" style="text-align: center; padding: 20px;">ไม่มีแผนงานผลิตในระยะเวลานี้</td></tr>`;
    } else {
      targetJobs.forEach((job, index) => {
        const dateStart = this.state.workingHourToDate(job.startHour);
        const dateEnd = this.state.workingHourToDate(job.startHour + job.estHours);
        
        const timeStartStr = this.formatTime(dateStart);
        const timeEndStr = this.formatTime(dateEnd);
        
        const wo = this.state.workOrders.find(w => w.id === job.woId);
        let prevWCStr = 'ไม่มี (ขั้นตอนแรก)';
        let nextWCStr = 'คลังสินค้าสำเร็จรูป (FG)';
        let prevStep = null;
        
        let sortedSteps = [];
        if (wo && wo.steps && wo.steps.length > 0) {
          sortedSteps = [...wo.steps].sort((a, b) => a.stepNum - b.stepNum);
        } else {
          sortedSteps = this.state.scheduledJobs
            .filter(j => j.woId === job.woId)
            .sort((a, b) => a.stepNum - b.stepNum);
        }
        
        if (sortedSteps.length > 0) {
          const currentIndex = sortedSteps.findIndex(s => s.stepNum === job.stepNum);
          if (currentIndex > 0) {
            prevStep = sortedSteps[currentIndex - 1];
            const name = prevStep.name || prevStep.stepName || prevStep.partName || 'Operation';
            prevWCStr = `${name} (${prevStep.machine})`;
          }
          if (currentIndex !== -1 && currentIndex < sortedSteps.length - 1) {
            const nextStep = sortedSteps[currentIndex + 1];
            const name = nextStep.name || nextStep.stepName || nextStep.partName || 'Operation';
            nextWCStr = `${name} (${nextStep.machine})`;
          } else {
            // Last step: check if it goes to another PD
            if (this.state.assemblyLinks) {
              const link = this.state.assemblyLinks.find(l => l.from === job.id);
              if (link) {
                const toWoId = link.to.split('-')[0];
                nextWCStr = `ประกอบเข้า ${toWoId}`;
              }
            }
          }
        }
        
        // Conditional Date cell HTML
        let dateTdHtml = '';
        if (viewMode !== 'daily') {
          const daysShort = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
          const dateLabelStr = `${daysShort[dateStart.getDay()]} ${dateStart.getDate()}/${dateStart.getMonth()+1}`;
          dateTdHtml = `<td style="border: 1px solid #000; padding: 6px; text-align: center; font-weight: bold; white-space: nowrap;">${dateLabelStr}</td>`;
        }

        jobsHtml += `
          <tr>
            <td style="border: 1px solid #000; padding: 6px; text-align: center; white-space: nowrap;">${index + 1}</td>
            ${dateTdHtml}
            <td style="border: 1px solid #000; padding: 6px; text-align: center; font-weight: bold; white-space: nowrap;">${timeStartStr} - ${timeEndStr}</td>
            <td style="border: 1px solid #000; padding: 6px; font-weight: bold; white-space: nowrap;">${job.woId}</td>
            <td style="border: 1px solid #000; padding: 6px; font-weight: bold; white-space: nowrap;">${job.project || 'N/A'}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center; font-family: monospace; white-space: nowrap;">${job.dwgNo || 'N/A'}</td>
            <td style="border: 1px solid #000; padding: 6px;">${job.partName}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center; white-space: nowrap;">${job.qty}</td>
            <td style="border: 1px solid #000; padding: 6px;">${nextWCStr}</td>
          </tr>
        `;

        // Op01 (first operation of the PD): list the raw materials it needs, since this is where
        // stock actually gets issued/consumed - not shown for later steps. Cells line up with the
        // main columns: Mat code starts at the ลำดับ/เวลา border, Qty under "เลขที่ SO".
        if (!prevStep) {
          const matList = this.state.getStepMaterialsList(job.woId, job.stepNum);
          if (matList.length > 0) {
            const checkboxStr = matList.map(() => '☐').join(' &nbsp;|&nbsp; ');
            const matCodesStr = matList.map(m => m.mat).join(' | ');
            const qtyStr = matList.map(m => m.qty).join(' | ');
            const descStr = matList.map(m => `${m.desc || ''}${m.status ? ' — ' + m.status.label : ''}`.trim()).join(' | ');
            jobsHtml += `
              <tr style="background: #f7f7f7; font-size: 10px;">
                <td colspan="${matColA}" style="border: 1px solid #000; padding: 4px 8px;"></td>
                <td style="border: 1px solid #000; padding: 4px 8px; text-align: center; font-size: 13px; white-space: nowrap;">${checkboxStr}</td>
                <td style="border: 1px solid #000; padding: 4px 8px; font-family: monospace; white-space: nowrap;">${matCodesStr}</td>
                <td style="border: 1px solid #000; padding: 4px 8px; text-align: center; white-space: nowrap;">${qtyStr}</td>
                <td colspan="${matColD}" style="border: 1px solid #000; padding: 4px 8px;">${descStr}</td>
              </tr>
            `;
          }
        }
      });
    }

    const tableHeadersHtml = `
      <tr>
        <th style="white-space: nowrap; text-align: center;">ลำดับ</th>
        ${viewMode !== 'daily' ? '<th style="white-space: nowrap; text-align: center;">วันที่</th>' : ''}
        <th style="white-space: nowrap; text-align: center;">เวลา</th>
        <th style="white-space: nowrap;">เลขที่ PD</th>
        <th style="white-space: nowrap;">เลขที่ SO</th>
        <th style="white-space: nowrap; text-align: center;">รหัสแบบ (Dwg)</th>
        <th>ชื่อชิ้นงาน</th>
        <th style="white-space: nowrap; text-align: center;">จำนวนชิ้น</th>
        <th>Next Op</th>
      </tr>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>${reportTitle} - ${this.selectedMachine}</title>
          <style>
            body { font-family: 'Sarabun', 'Helvetica Neue', Arial, sans-serif; padding: 20px; color: #000; font-size: 12px; }
            h2 { text-align: center; margin-bottom: 5px; font-size: 18px; text-transform: uppercase; }
            .meta-info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 11px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
            th { background-color: #f2f2f2; border: 1px solid #000; padding: 8px; font-size: 11px; text-align: left; }
            td { border: 1px solid #000; padding: 8px; font-size: 11px; }
            .signature-block { display: flex; justify-content: space-between; margin-top: 50px; font-size: 11px; page-break-inside: avoid; }
            .sig-col { text-align: center; width: 45%; }
            .sig-line { border-bottom: 1px solid #000; width: 80%; margin: 30px auto 5px auto; }
            @media print {
              body { padding: 0; }
              @page { size: landscape; margin: 1.5cm; }
            }
          </style>
        </head>
        <body>
          <h2>${reportTitle}</h2>
          <div class="meta-info">
            <div>
              <strong>เครื่องจักร / แผนก:</strong> ${this.selectedMachine} - ${wcName}<br>
              <strong>ระยะเวลาแผนงาน:</strong> ${dateRangeStr}
            </div>
            <div style="text-align: right;">
              <strong>วันที่พิมพ์:</strong> ${new Date().toLocaleString('th-TH')}<br>
              <strong>ผู้จัดทำแผน:</strong> ....................................................
            </div>
          </div>
          
          <h3 style="margin-bottom: 10px; font-size: 14px;">1. รายการงานผลิตตามลำดับเวลา (Production Queue Timeline)</h3>
          <table>
            <thead>
              ${tableHeadersHtml}
            </thead>
            <tbody>
              ${jobsHtml}
            </tbody>
          </table>
          
          <div class="signature-block">
            <div class="sig-col">
              <div class="sig-line"></div>
              <span>ลงชื่อผู้ปฏิบัติงาน (Operator)<br>วันที่: ......./......./.......</span>
            </div>
            <div class="sig-col">
              <div class="sig-line"></div>
              <span>ลงชื่อหัวหน้างาน (Supervisor/Planner)<br>วันที่: ......./......./.......</span>
            </div>
          </div>
          
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
}
