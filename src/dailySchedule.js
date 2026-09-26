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

  getMaterialReadiness(job, prevStep) {
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
      
      const readiness = this.getMaterialReadiness(job, prevStep);
      
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
            <span style="font-size: 13px; color: var(--text-primary);"><strong style="color: var(--accent-teal);">PD ID: ${job.woId}</strong> &nbsp;·&nbsp; ชื่องาน: <strong>${job.partName}</strong> &nbsp;·&nbsp; รหัสแบบ: <strong style="color: var(--accent-cyan); font-family: monospace;">${job.dwgNo || 'N/A'}</strong> &nbsp;·&nbsp; จำนวนผลิต: <strong>${job.qty}</strong> pcs</span>
            <span class="priority-badge ${job.priority ? job.priority.toLowerCase() : 'normal'}" style="font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 700; flex-shrink: 0;">${job.priority || 'Normal'}</span>
          </div>
          <div style="font-size: 11.5px; color: var(--text-secondary); display: flex; gap: 20px; flex-wrap: wrap;">
            <span>Customer: <strong style="color: var(--text-primary);">${job.customer || 'N/A'}</strong></span>
            <span>เลขที่ SO: <strong style="color: var(--accent-teal); font-weight: bold;">${job.project || 'N/A'}</strong></span>
          </div>
          <div style="font-size: 11.5px; color: var(--text-secondary); display: flex; gap: 20px; flex-wrap: wrap;">
            <span>📥 Operation ก่อนหน้า: <strong style="color: var(--text-primary);">${prevWCStr}</strong></span>
            <span>📤 Operation ถัดไป: <strong style="color: var(--text-primary);">${nextWCStr}</strong></span>
          </div>
        </div>

        <!-- Mark this PD finished and take it off the board -->
        <div style="flex: 0 0 90px; display: flex; align-items: center; justify-content: center; border-left: 1px dashed var(--border-glass); padding-left: 10px;">
          <button class="btn-mark-pd-completed" title="บันทึกว่า ${job.woId} ผลิตจริงเสร็จแล้ว - จะไม่ถูกนำกลับเข้าแผนอีก" style="font-size: 9.5px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--accent-green, #16a34a); background: rgba(22, 163, 74, 0.1); color: var(--accent-green, #16a34a); cursor: pointer; font-weight: 700; white-space: nowrap;">✅ ผลิตเสร็จแล้ว</button>
        </div>
      `;

      card.addEventListener('dblclick', (e) => {
        if (e.target.closest('.btn-mark-pd-completed')) return;
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

      const btnMarkCompleted = card.querySelector('.btn-mark-pd-completed');
      if (btnMarkCompleted) {
        btnMarkCompleted.addEventListener('click', (e) => {
          e.stopPropagation();
          const childPds = typeof this.state.getDescendantPdIds === 'function' ? this.state.getDescendantPdIds(job.woId) : [];
          const confirmMsg = childPds.length > 0
            ? `บันทึกว่า ${job.woId} พร้อม PD ลูกทั้งหมดอีก ${childPds.length} รายการ (${childPds.slice(0, 10).join(', ')}${childPds.length > 10 ? '...' : ''}) ผลิตจริงเสร็จแล้วใช่หรือไม่?\n(PD แม่และ PD ลูกทั้งหมดจะถูกนำออกจากแผน และจะไม่ถูกนำกลับเข้ามาอีก)`
            : `บันทึกว่า ${job.woId} ผลิตจริงเสร็จแล้วใช่หรือไม่?\n(PD นี้จะถูกนำออกจากแผน และจะไม่ถูกนำกลับเข้ามาอีก)`;
          if (confirm(confirmMsg)) {
            this.state.markPdCompletedAndRemove(job.woId);
            this.render();
          }
        });
      }

      this.timelineContainer.appendChild(card);
    });
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
    const colSpanVal = viewMode !== 'daily' ? 10 : 9;
    
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
        
        const readiness = this.getMaterialReadiness(job, prevStep);
        
        // Conditional Date cell HTML
        let dateTdHtml = '';
        if (viewMode !== 'daily') {
          const daysShort = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
          const dateLabelStr = `${daysShort[dateStart.getDay()]} ${dateStart.getDate()}/${dateStart.getMonth()+1}`;
          dateTdHtml = `<td style="border: 1px solid #000; padding: 6px; text-align: center; font-weight: bold;">${dateLabelStr}</td>`;
        }

        jobsHtml += `
          <tr>
            <td style="border: 1px solid #000; padding: 6px; text-align: center;">${index + 1}</td>
            ${dateTdHtml}
            <td style="border: 1px solid #000; padding: 6px; text-align: center; font-weight: bold;">${timeStartStr} - ${timeEndStr}</td>
            <td style="border: 1px solid #000; padding: 6px; font-weight: bold;">${job.woId}</td>
            <td style="border: 1px solid #000; padding: 6px; font-weight: bold;">${job.project || 'N/A'}</td>
            <td style="border: 1px solid #000; padding: 6px;">${job.customer || 'N/A'}</td>
            <td style="border: 1px solid #000; padding: 6px;">${job.partName}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center; font-family: monospace;">${job.dwgNo || 'N/A'}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center;">${job.qty}</td>
            <td style="border: 1px solid #000; padding: 6px;">${nextWCStr}</td>
            <td style="border: 1px solid #000; padding: 6px; font-size: 10px; color: #111;">${readiness.text}</td>
          </tr>
        `;
      });
    }

    const tableHeadersHtml = `
      <tr>
        <th style="width: 5%; text-align: center;">ลำดับ</th>
        ${viewMode !== 'daily' ? '<th style="width: 8%; text-align: center;">วันที่</th>' : ''}
        <th style="width: 14%; text-align: center;">ช่วงเวลาทำงาน</th>
        <th style="width: 10%;">เลขที่ PD</th>
        <th style="width: 10%;">เลขที่ SO</th>
        <th style="width: 14%;">Customer</th>
        <th style="width: 18%;">ชื่อชิ้นงาน (Part Name)</th>
        <th style="width: 9%; text-align: center;">รหัสแบบ (Dwg)</th>
        <th style="width: 6%; text-align: center;">จำนวน</th>
        <th style="width: 8%;">ขั้นตอนถัดไป</th>
        <th style="width: 8%;">วัตถุดิบ</th>
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
              @page { margin: 1.5cm; }
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
