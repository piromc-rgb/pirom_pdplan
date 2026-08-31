// MIE Trak Pro - Gantt Planning Board Controller

function workingHourToDate(workingHour) {
  const baseDate = new Date(2026, 5, 22, 8, 0, 0); // Mon June 22 2026 8:00
  const weeks = Math.floor(workingHour / 54);
  const remInWeek = workingHour - (weeks * 54); // Always non-negative
  const days = Math.floor(remInWeek / 9);
  const hours = remInWeek - (days * 9);
  const calendarDays = weeks * 7 + days;
  const timeMs = baseDate.getTime() + calendarDays * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000;
  return new Date(timeMs);
}

function dateToWorkingHour(date) {
  const baseDate = new Date(2026, 5, 22, 8, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDayBase = new Date(2026, 5, 22, 0, 0, 0);
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
    } else if (hour > 17.0) {
      workHoursInDay = 9.0;
    } else {
      workHoursInDay = hour - 8.0;
    }
  } else {
    workHoursInDay = 9.0;
  }
  return workingDays * 9 + workHoursInDay;
}

function playSnapSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    // Satisfying mechanical magnet click (woodblock tap feel)
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(550, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.05);
    
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) {
    // Ignore context blocked errors or lack of support
  }
}

export class GanttController {
  constructor(state) {
    this.state = state;
    this.toastTimeout = null;
    this.initElements();
    this.initEvents();
  }

  initElements() {
    this.ganttGrid = document.getElementById('gantt-grid');
    this.modelTag = document.getElementById('current-model-tag');
    this.rulerHours = document.querySelector('.ruler-hours');
    this.boardWrapper = document.querySelector('.gantt-board-wrapper');
  }

  initEvents() {
    window.addEventListener('scheduling-blocked', (e) => {
      this.showToast(e.detail.error);
    });
    window.addEventListener('resize', () => {
    }
    this.drawDependencyLines();
    });

    // Mouse wheel zoom to change time frame (Wheel zoom)
    if (this.boardWrapper) {
      this.boardWrapper.addEventListener('wheel', (e) => {
        // Prevent default browser scroll/zoom
        e.preventDefault();
        
        const scales = ['hr', 'day', 'week', 'month', 'quarter', 'year'];
        const currentScale = this.state.activeScale;
        let index = scales.indexOf(currentScale);
        if (index === -1) index = 1; // Default to 'day'
        
        if (e.deltaY > 0) {
          // Scroll down / towards oneself: more detailed (finer scale)
          if (index > 0) {
            this.state.setActiveScale(scales[index - 1]);
          }
        } else if (e.deltaY < 0) {
          // Scroll up / away from oneself: coarser scale
          if (index < scales.length - 1) {
            this.state.setActiveScale(scales[index + 1]);
          }
        }
      }, { passive: false });
    }

    // Gantt board panning (drag-to-scroll)
    if (this.boardWrapper) {
      let isDown = false;
      let startMouseX;
      let startMouseY;
      let startTimelineOffset;
      let startScrollTop;
      let currentMouseX = 0;
      let currentMouseY = 0;
      let animationFrameId = null;

      const updateScroll = () => {
        if (!isDown) return;
        
        // 1. Horizontal panning via timelineOffset
        const dX = currentMouseX - startMouseX;
        const trackWidth = Math.max(100, this.boardWrapper.clientWidth - 140);
        const scale = this.state.activeScale;
        const config = this.getScaleConfig(scale);
        const totalHours = config.totalHours;

        const dHours = - (dX / trackWidth) * totalHours;
        const newOffset = startTimelineOffset + dHours;

        // 2. Vertical panning via scrollTop
        const dY = currentMouseY - startMouseY;
        this.boardWrapper.scrollTop = startScrollTop - dY * 1.5;

        this.state.setTimelineOffset(newOffset);
        animationFrameId = null;
      };

      this.boardWrapper.addEventListener('mousedown', (e) => {
        // Only drag with left mouse button
        if (e.button !== 0) return;

        // Do not pan if dragging a job card (gantt-card), overlap alerts, a row label, a button, input, or dropdown menu/select
        if (e.target.closest('.gantt-card') || 
            e.target.closest('.gantt-overlap-alert') || 
            e.target.closest('.gantt-row-label') || 
            e.target.closest('button') || 
            e.target.closest('select') || 
            e.target.closest('input') ||
            e.target.closest('.dropdown-menu')) {
          return;
        }

        isDown = true;
        this.boardWrapper.classList.add('active-panning');
        
        startMouseX = e.pageX;
        startMouseY = e.pageY;
        startTimelineOffset = this.state.timelineOffset || 0.0;
        startScrollTop = this.boardWrapper.scrollTop;
        currentMouseX = e.pageX;
        currentMouseY = e.pageY;
      });

      this.boardWrapper.addEventListener('mouseleave', () => {
        if (isDown) {
          isDown = false;
          this.boardWrapper.classList.remove('active-panning');
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
          }
        }
      });

      this.boardWrapper.addEventListener('mouseup', () => {
        if (isDown) {
          isDown = false;
          this.boardWrapper.classList.remove('active-panning');
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
          }
        }
      });

      this.boardWrapper.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        currentMouseX = e.pageX;
        currentMouseY = e.pageY;
        
        if (!animationFrameId) {
          animationFrameId = requestAnimationFrame(updateScroll);
        }
      });
    }
    
    // Close Work Center Plan Modal listeners
    const modal = document.getElementById('wc-plan-modal');
    const btnClose = document.getElementById('btn-close-wc-plan');
    const btnCancel = document.getElementById('btn-cancel-wc-plan');
    const closeWcModal = () => {
      if (modal) modal.classList.add('hidden');
    };
    if (btnClose) btnClose.addEventListener('click', closeWcModal);
    if (btnCancel) btnCancel.addEventListener('click', closeWcModal);

    // Close PD Plan Modal listeners
    const pdModal = document.getElementById('pd-plan-modal');
    const btnClosePd = document.getElementById('btn-close-pd-plan');
    const btnCancelPd = document.getElementById('btn-cancel-pd-plan');
    const closePdModal = () => {
      if (pdModal) pdModal.classList.add('hidden');
    };
    if (btnClosePd) btnClosePd.addEventListener('click', closePdModal);
    if (btnCancelPd) btnCancelPd.addEventListener('click', closePdModal);
  }

  showToast(message) {
    const toast = document.getElementById('alert-toast');
    if (!toast) return;

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    toast.textContent = message;
    if (message.includes('Shifted')) {
      toast.classList.add('info');
    } else {
      toast.classList.remove('info');
    }
    toast.classList.remove('hidden');

    // Force reflow
    void toast.offsetWidth;

    toast.classList.add('show');

    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (!toast.classList.contains('show')) {
          toast.classList.add('hidden');
        }
      }, 300);
    }, 2000);
  }

  generateTicks(scale, offset) {
    const ticks = [];
    if (scale === 'day') {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (let i = 0; i < 6; i++) {
        const workingHour = offset + i * 9.0;
        const d = workingHourToDate(workingHour);
        const dayLabel = days[d.getDay() === 0 ? 5 : d.getDay() - 1];
        const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        ticks.push(`${dayLabel} ${dateStr}`);
      }
    } else if (scale === 'week') {
      for (let i = 0; i < 24; i++) {
        const workingHour = offset + i * 9.0;
        const d = workingHourToDate(workingHour);
        const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
        ticks.push(dateStr);
      }
    } else if (scale === 'month') {
      for (let i = 0; i < 3; i++) {
        const workingHour = offset + i * 216.0;
        const d = workingHourToDate(workingHour);
        const monthName = d.toLocaleDateString('en-US', { month: 'long' });
        ticks.push(monthName);
      }
    } else if (scale === 'quarter') {
      for (let i = 0; i < 3; i++) {
        const workingHour = offset + i * 648.0;
        const d = workingHourToDate(workingHour);
        const monthName = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        ticks.push(monthName);
      }
    } else if (scale === 'year') {
      for (let i = 0; i < 4; i++) {
        const workingHour = offset + i * 1944.0;
        const d = workingHourToDate(workingHour);
        const qName = `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
        ticks.push(qName);
      }
    }
    return ticks;
  }

  getRangeLabel(scale, offset) {
    const start = workingHourToDate(offset);
    if (scale === 'hr') {
      return start.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    } else if (scale === 'day') {
      const end = workingHourToDate(offset + 54.0);
      const startStr = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      return `Week of ${startStr} - ${endStr}`;
    } else if (scale === 'week') {
      const end = workingHourToDate(offset + 216.0 - 1);
      const startStr = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      return `4-Week: ${startStr} - ${endStr}`;
    } else if (scale === 'month') {
      const end = workingHourToDate(offset + 648.0 - 1);
      const startStr = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      return `${startStr} - ${endStr}`;
    } else if (scale === 'quarter') {
      const end = workingHourToDate(offset + 1944.0 - 1);
      const startStr = start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      return `Quarter: ${startStr} - ${endStr}`;
    } else if (scale === 'year') {
      const end = workingHourToDate(offset + 7776.0 - 1);
      const startStr = start.toLocaleDateString('en-GB', { year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { year: 'numeric' });
      return `Year: ${startStr} - ${endStr}`;
    }
    return '';
  }

  getScaleConfig(scale) {
    const offset = this.state.timelineOffset || 0.0;
    switch (scale) {
      case 'day':
        return {
          totalHours: 54.0, 
          startOffset: offset,
          columns: 6,
          ticks: this.generateTicks('day', offset),
          snapHours: 1.0 
        };
      case 'week':
        return {
          totalHours: 216.0, 
          startOffset: offset,
          columns: 24,
          ticks: this.generateTicks('week', offset),
          snapHours: 9.0 
        };
      case 'month':
        return {
          totalHours: 648.0, 
          startOffset: offset,
          columns: 3,
          ticks: this.generateTicks('month', offset),
          snapHours: 18.0 
        };
      case 'quarter':
        return {
          totalHours: 1944.0, 
          startOffset: offset,
          columns: 3,
          ticks: this.generateTicks('quarter', offset),
          snapHours: 54.0 
        };
      case 'year':
        return {
          totalHours: 7776.0, 
          startOffset: offset,
          columns: 4,
          ticks: this.generateTicks('year', offset),
          snapHours: 216.0 
        };
      case 'hr':
      default:
        return {
          totalHours: 9.0, 
          startOffset: offset,
          columns: 9, 
          ticks: ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'],
          snapHours: 0.5 
        };
    }
  }

  render() {
    const scale = this.state.activeScale;
    const config = this.getScaleConfig(scale);

    // Update active model tag text if present
    const modelLabels = {
      whiteboard: 'Model: Whiteboard & Cell (Manual)',
      finite: 'Model: Forwards Finite Capacity',
      infinite: 'Model: Backwards Infinite Capacity'
    };
    if (this.modelTag) {
      this.modelTag.textContent = `${modelLabels[this.state.schedulingModel]} [Scale: ${scale.toUpperCase()}]`;
    }

    // Update the timeline range label
    const rangeLabel = document.getElementById('timeline-range-label');
    if (rangeLabel) {
      rangeLabel.textContent = this.getRangeLabel(scale, this.state.timelineOffset || 0.0);
    }

    // Redraw timeline ruler headers dynamically
    this.rulerHours.innerHTML = '';
    this.rulerHours.style.gridTemplateColumns = `repeat(${config.ticks.length - (scale === 'hr' ? 1 : 0)}, 1fr)`;
    
    if (scale === 'hr') {
      config.ticks.slice(0, -1).forEach(tick => {
        const span = document.createElement('span');
        span.textContent = tick;
        this.rulerHours.appendChild(span);
      });
      const span = document.createElement('span');
      span.textContent = '20:00';
      span.style.position = 'absolute';
      span.style.right = '5px';
      span.style.border = 'none';
      this.rulerHours.appendChild(span);
    } else {
      config.ticks.forEach(tick => {
        const span = document.createElement('span');
        span.textContent = tick;
        this.rulerHours.appendChild(span);
      });
    }

    // Clear Gantt grid
    this.ganttGrid.innerHTML = '';
      // Clear Gantt grid
    this.ganttGrid.innerHTML = '';

    // Loop through each Work Center track in sorted order
    const order = this.state.workCenterOrder || Object.keys(this.state.workCenters);
    order.forEach(machineName => {
      const row = document.createElement('div');
      row.className = 'gantt-row';

      row.innerHTML = `
        <div class="gantt-row-label" draggable="true" data-machine="${machineName}" style="cursor: grab;">
          <span class="gantt-row-name">${machineName}</span>
        </div>
        <div class="gantt-row-track" data-machine="${machineName}"></div>
      `;

      const label = row.querySelector('.gantt-row-label');
      
      label.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/machine-reorder', machineName);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('row-dragging');
      });

      label.addEventListener('dragend', () => {
        row.classList.remove('row-dragging');
        document.querySelectorAll('.gantt-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      });

      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.showWorkCenterPlanModal(machineName);
      });

      label.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/machine-reorder')) {
          e.preventDefault();
          const rect = label.getBoundingClientRect();
          const relativeY = e.clientY - rect.top;
          
          row.classList.remove('drag-over-top', 'drag-over-bottom');
          if (relativeY < rect.height / 2) {
            row.classList.add('drag-over-top');
          } else {
            row.classList.add('drag-over-bottom');
          }
        }
      });

      label.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      label.addEventListener('drop', (e) => {
        const draggedMachine = e.dataTransfer.getData('text/machine-reorder');
        if (draggedMachine && draggedMachine !== machineName) {
          e.preventDefault();
          row.classList.remove('drag-over-top', 'drag-over-bottom');
          this.state.reorderWorkCenters(draggedMachine, machineName);
        }
      });

      const track = row.querySelector('.gantt-row-track');
      track.className = `gantt-row-track scale-${scale}`;

      // Bind Drag & Drop Events
      track.addEventListener('dragover', (e) => {
        e.preventDefault();
        track.classList.add('drag-hover');
      });

      track.addEventListener('dragleave', () => {
        track.classList.remove('drag-hover');
      });

      track.addEventListener('drop', (e) => {
        e.preventDefault();
        track.classList.remove('drag-hover');
        
        const stepId = e.dataTransfer.getData('text/plain');
        if (!stepId) return;

        // Calculate hours based on X coordinate relative to track width
        const rect = track.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const percentage = offsetX / rect.width;
        
        let hour = config.startOffset + (percentage * config.totalHours);
        
        // Find step to get duration
        let duration = 2.0;
        const isEntireOrder = (stepId.startsWith('PD') && !stepId.includes('-')) || 
                              (stepId.startsWith('WO') && stepId.split('-').length === 2);
        if (isEntireOrder) {
          // Dropped an entire Production Order
          const parentWO = this.state.workOrders.find(wo => wo.id === stepId);
          if (parentWO && parentWO.steps.length > 0) {
            duration = parentWO.steps[0].estHours;
          }
        } else {
          // Search in backlog work orders
          for (let wo of this.state.workOrders) {
            const s = wo.steps.find(step => step.id === stepId);
            if (s) { duration = s.estHours; break; }
          }
          // Search in scheduled jobs
          const schedStep = this.state.scheduledJobs.find(j => j.id === stepId);
          if (schedStep) { duration = schedStep.estHours; }
        }

        // Slide-right overlap resolution:
        // If the placed task [hour, hour + duration] overlaps with any existing task on this machine,
        // we shift hour to the right (to the end of the overlapping task) and repeat until no overlaps remain.
        const otherJobs = this.state.scheduledJobs.filter(j => j.id !== stepId && j.woId !== stepId && j.machine === machineName);
        let resolvedHour = hour;
        let hasOverlap = true;
        let iterations = 0;
        const maxIterations = 100; // Prevent infinite loops

        while (hasOverlap && iterations < maxIterations) {
          hasOverlap = false;
          // Find the first task on this machine that overlaps with [resolvedHour, resolvedHour + duration]
          const overlappingJob = otherJobs.find(j => 
            !(resolvedHour + duration <= j.startHour || resolvedHour >= j.startHour + j.estHours)
          );

          if (overlappingJob) {
            resolvedHour = overlappingJob.startHour + overlappingJob.estHours;
            hasOverlap = true;
          }
          iterations++;
        }

        // Apply magnetic snap to the preceding task on the left if it's close (within snapTolerance)
        const snapTolerance = config.snapHours * 1.5; // 1.5 grid slots tolerance
        let hourSnappedByMagnet = (resolvedHour !== hour); // If it was shifted by overlap, it snapped!
        
        hour = resolvedHour;
        
        if (!hourSnappedByMagnet) {
          let bestSnapHour = null;
          let minDiff = Infinity;
          
          otherJobs.forEach(otherJob => {
            const otherEnd = otherJob.startHour + otherJob.estHours;
            const isPreceding = (otherJob.startHour <= hour);
            const diff = Math.abs(hour - otherEnd);
            
            if (isPreceding || diff <= snapTolerance) {
              if (diff < minDiff) {
                minDiff = diff;
                bestSnapHour = otherEnd;
              }
            }
          });

          if (bestSnapHour !== null && (minDiff <= snapTolerance || minDiff < duration)) {
            hour = bestSnapHour;
            hourSnappedByMagnet = true;
          } else {
            // Otherwise, snap to standard grid
            hour = Math.round(hour / config.snapHours) * config.snapHours;
          }
        }
        
        // Cap within timeline bounds
        hour = Math.max(config.startOffset, Math.min(config.startOffset + config.totalHours - duration, hour));

        // Double check if the final hour (after sliding and capping) still overlaps with any task
        const finalOverlap = otherJobs.some(j => 
          !(hour + duration <= j.startHour || hour >= j.startHour + j.estHours)
        );

        if (finalOverlap) {
          const event = new CustomEvent('scheduling-blocked', {
            detail: { stepId, error: `Cannot schedule: Overlaps with another task on ${machineName}!` }
          });
          window.dispatchEvent(event);
          this.state.notify(); // Re-render to revert card position
          return;
        }

        const success = this.state.scheduleJob(stepId, machineName, hour);
        if (success !== false && hourSnappedByMagnet) {
          playSnapSound();
        }
      });

      // Filter jobs/steps assigned to this machine
      const machineJobs = this.state.scheduledJobs.filter(j => j.machine === machineName);

      // Render job cards on timeline
      machineJobs.forEach(job => {
        const jobEnd = job.startHour + job.estHours;
        const timelineEnd = config.startOffset + config.totalHours;
        
        if (job.startHour < timelineEnd && jobEnd > config.startOffset) {
          const card = document.createElement('div');
          
          // 1. Detect sequence routing overlaps (Sequence Warning)
          let isSeqError = false;
          let isParentChildViolation = false;
          if (job.woId && this.state.schedulingModel !== 'finite') {
            const sisterSteps = this.state.scheduledJobs.filter(j => j.woId === job.woId && j.id !== job.id);
            sisterSteps.forEach(sister => {
              // If prior step starts after this step starts
              if (sister.stepNum < job.stepNum && (sister.startHour + sister.estHours) > job.startHour) {
                isSeqError = true;
              }
              // If subsequent step starts before this step ends
              if (sister.stepNum > job.stepNum && jobEnd > sister.startHour) {
                isSeqError = true;
              }
            });

            // Parent-Child violation check
            const isChild = job.woId.includes('-');
            if (isChild) {
              const parentWoId = job.woId.split('-')[0];
              const parentSteps = this.state.scheduledJobs.filter(j => j.woId === parentWoId);
              const parentFirstStep = [...parentSteps].sort((a, b) => a.stepNum - b.stepNum)[0];
              if (parentFirstStep && jobEnd > parentFirstStep.startHour) {
                isParentChildViolation = true;
              }
            } else {
              const parentWoId = job.woId;
              const childWoIds = Array.from(new Set(this.state.scheduledJobs.map(j => j.woId).filter(id => id && id.startsWith(parentWoId + '-'))));
              childWoIds.forEach(childId => {
                const childSteps = this.state.scheduledJobs.filter(j => j.woId === childId);
                const childLastStep = [...childSteps].sort((a, b) => b.stepNum - a.stepNum)[0];
                if (childLastStep && childLastStep.startHour + childLastStep.estHours > job.startHour) {
                  isParentChildViolation = true;
                }
              });
            }
          }

          // 2. Detect delivery target date delay (Due Date Error)
          let isDueError = false;
          let diffDays = 0;
          if (job.dueHour) {
            const scaledDueHour = this.state.getScaledDueHour(job);
            if ((job.startHour + job.estHours) > scaledDueHour) {
              isDueError = true;
              const targetDate = workingHourToDate(scaledDueHour);
              const estDate = workingHourToDate(job.startHour + job.estHours);
              diffDays = Math.ceil((estDate - targetDate) / (1000 * 60 * 60 * 24));
            }
          }

          let statusClass = 'scheduled';
          if (job.status === 'Running') statusClass = 'running';
          else if (job.status === 'Paused') statusClass = 'paused';
          else if (job.status === 'Setup') statusClass = 'setup';
          else if (job.status === 'Completed') statusClass = 'completed';
          else if (job.isNest) statusClass = 'nest';
          if (isSeqError) statusClass += ' sequence-error';
          if (isDueError) statusClass += ' due-error';

          card.className = `gantt-card ${statusClass}`;
          card.setAttribute('draggable', 'true');
          card.setAttribute('data-id', job.id);
          card.setAttribute('data-wo-id', woId);

          // Tooltip description
          let tooltip = `Start: ${this.formatTime(job.startHour, scale)} | Finish: ${this.formatTime(jobEnd, scale)}`;
          if (isSeqError) {
            tooltip += `\n[WARNING] Sequence Violation: Prior operation steps must complete before subsequent ones.`;
          }
          if (isParentChildViolation) {
            tooltip += `\n[WARNING] Parent-Child Violation: Child parts must complete before Parent parts can start.`;
          }
          if (isDueError) {
            tooltip += `\n[ALERT] Delivery Delay: Estimated completion exceeds the Work Order due date target by ${diffDays} day(s).`;
          }
          card.setAttribute('title', tooltip);
          
          // Calculate clip percentages if job is partially offscreen
          const start = Math.max(config.startOffset, job.startHour);
          const end = Math.min(timelineEnd, jobEnd);
          const width = end - start;

          const leftPercent = ((start - config.startOffset) / config.totalHours) * 100;
          const widthPercent = (width / config.totalHours) * 100;

          card.style.left = `${leftPercent}%`;
          card.style.width = `${widthPercent}%`;

          // Card layout showing Routing Step
          const stepIndicator = job.stepNum ? `[${job.stepNum}]` : '';
          const stepName = job.stepName || job.name || '';
          
          const lateIndicator = isDueError ? `<span class="gantt-card-late-tag" style="color: #ff4a4a; font-weight: 700; font-size: 8px; background: rgba(255, 74, 74, 0.15); padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(255, 74, 74, 0.3); margin-left: 4px; animation: pulse-flash 0.5s infinite alternate;">ช้า ${diffDays} วัน</span>` : '';
          const completedIndicator = job.status === 'Completed' ? '<span style="font-size: 8px; font-weight: 900; color: var(--accent-green); background: rgba(22, 163, 74, 0.15); padding: 1px 3px; border-radius: 3px; border: 1px solid var(--accent-green); margin-right: 4px; display: inline-flex; align-items: center; justify-content: center;">✓</span>' : '';

          const childMatchCard = job.woId ? job.woId.match(/^(.*)-(\d+)$/) : null;
          const isChildCard = !!childMatchCard;
          let isParentCard = false;
          if (job.woId) {
            const allWoIds = new Set([
              ...this.state.workOrders.map(w => w.id),
              ...this.state.scheduledJobs.map(j => j.woId).filter(Boolean)
            ]);
            isParentCard = Array.from(allWoIds).some(id => {
              const m = id.match(/^(.*)-(\d+)$/);
              return m && m[1] === job.woId;
            });
          }

          let relationIndicatorHtml = '';
          if (isParentCard) {
            relationIndicatorHtml = `<span class="gantt-card-relation-indicator" title="Parent Part (ตัวแม่)">M</span>`;
          } else if (isChildCard) {
            relationIndicatorHtml = `<span class="gantt-card-relation-indicator" title="Child Part (ตัวลูก) ของ ${childMatchCard[1]}">C</span>`;
          }

          card.innerHTML = `
            <div class="gantt-card-id" style="display: flex; align-items: center; justify-content: space-between; width: 100%; white-space: nowrap; overflow: hidden;">
              <span style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; gap: 4px; flex: 1; padding-right: 15px;">
                ${completedIndicator}<strong>${job.woId || job.id}</strong> <span style="opacity: 0.85; font-weight: normal;">${job.partName}</span> ${stepIndicator} ${job.priority === 'Hot' ? '🔥' : ''}
              </span>
              ${lateIndicator}
            </div>
            <div class="gantt-card-desc" title="${stepName}">${stepName}</div>
            <div class="gantt-card-bottom">
              <span style="padding-left: 14px;">Qty: ${job.qty}</span>
              <span>Fin: ${this.formatTime(jobEnd, scale)}</span>
            </div>
            <span class="gantt-card-remove" title="Unschedule step" data-id="${job.id}">×</span>
            ${relationIndicatorHtml}
            <svg class="gantt-card-qr-icon" data-id="${job.id}" viewBox="0 0 24 24" width="12" height="12">
              <path d="M3 3h6v6H3V3zm2 2v2h2V5H5zm8-2h6v6h-6V3zm2 2v2h2V5h-2zM3 13h6v6H3v-6zm2 2v2h2v-2H5zm13-2h3v2h-3v-2zm-3 3h3v3h-3v-3zm3 3h3v-3h-3v3zm-3-3h-2v2h2v-2zm3-3h-3v2h3v-2zm-3-2h2V9h-2v2zm2-4h2V3h-2v2zm0 4h2V7h-2v2zm-4 4h2v-2h-2v2zm-2 2H9v2h2v-2zm4 4h-2v2h2v-2zm2-2h-2v2h2v-2z"/>
            </svg>
          `;

          // Bind drag event
          card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', job.id);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => { card.style.opacity = '0.3'; }, 0);
          });

          card.addEventListener('dragend', () => {
            card.style.opacity = '1';
            this.state.notify();
          });

          // Click card to open Kiosk Terminal / webactual modal
          card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const jid = e.currentTarget.getAttribute('data-id');
            const event = new CustomEvent('open-webactual', { detail: { jobId: jid } });
            window.dispatchEvent(event);
          });

          // Click card to select in Kiosk Terminal
          card.addEventListener('click', (e) => {
            if (e.target.classList.contains('gantt-card-remove') || e.target.classList.contains('gantt-card-qr-icon') || e.target.tagName === 'path') {
              return;
            }
            e.stopPropagation();
            const event = new CustomEvent('gantt-card-selected', {
              detail: { jobId: job.id, machine: job.machine }
            });
            window.dispatchEvent(event);
          });

          // Double click card to edit Delivery Target
          card.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const woId = job.woId || job.id;
            this.showPDPlanModal(woId);
          });

          // Interactive Chain Highlight on Hover
          if (woId) {
            card.addEventListener('mouseenter', () => {
              document.querySelectorAll(`.gantt-card[data-wo-id="${woId}"]`).forEach(c => {
                c.classList.add('chain-highlight');
              });
              document.querySelectorAll(`.gantt-dep-line[data-wo-id="${woId}"]`).forEach(line => {
                line.classList.add('highlight');
              });
            });

            card.addEventListener('mouseleave', () => {
              document.querySelectorAll(`.gantt-card[data-wo-id="${woId}"]`).forEach(c => {
                c.classList.remove('chain-highlight');
              });
              document.querySelectorAll(`.gantt-dep-line[data-wo-id="${woId}"]`).forEach(line => {
                line.classList.remove('highlight');
              });
            });
          }

          // Parent-Child family yellow highlight on hover
          let familyParentWoId = null;
          if (isParentCard) {
            familyParentWoId = job.woId;
          } else if (isChildCard) {
            familyParentWoId = childMatchCard[1];
          }

          if (familyParentWoId) {
            card.addEventListener('mouseenter', () => {
              const pWoId = familyParentWoId;
              
              // Highlight parent cards
              document.querySelectorAll(`.gantt-card[data-wo-id="${pWoId}"]`).forEach(c => {
                c.classList.add('parent-child-highlight');
              });
              
              // Highlight child cards
              document.querySelectorAll('.gantt-card').forEach(c => {
                const cWoId = c.getAttribute('data-wo-id');
                if (cWoId && (cWoId === pWoId || cWoId.startsWith(pWoId + '-'))) {
                  c.classList.add('parent-child-highlight');
                }
              });

              // Highlight parent-child connection lines
              document.querySelectorAll(`.parent-child-dep-line[data-parent-wo-id="${pWoId}"]`).forEach(line => {
                line.classList.add('parent-child-highlight');
              });

              // Highlight internal sequence lines for parent and all its children
              document.querySelectorAll(`.gantt-dep-line`).forEach(line => {
                const lineWoId = line.getAttribute('data-wo-id');
                if (lineWoId && (lineWoId === pWoId || lineWoId.startsWith(pWoId + '-'))) {
                  line.classList.add('parent-child-highlight');
                }
              });
            });

            card.addEventListener('mouseleave', () => {
              document.querySelectorAll('.gantt-card').forEach(c => {
                c.classList.remove('parent-child-highlight');
              });
              document.querySelectorAll('.gantt-dep-line').forEach(line => {
                line.classList.remove('parent-child-highlight');
              });
            });
          }

          track.appendChild(card);
        }
      });

        // 3. Render Overlap Warnings
        if (this.state.schedulingModel !== 'finite') {
          const overlaps = this.detectOverlaps(machineJobs);
          overlaps.forEach(overlap => {
            const timelineEnd = config.startOffset + config.totalHours;
            if (overlap.start < timelineEnd && overlap.end > config.startOffset) {
              const overlapAlert = document.createElement('div');
              overlapAlert.className = 'gantt-overlap-alert';
              
              const start = Math.max(config.startOffset, overlap.start);
              const end = Math.min(timelineEnd, overlap.end);
              
              const leftPercent = ((start - config.startOffset) / config.totalHours) * 100;
              const widthPercent = ((end - start) / config.totalHours) * 100;
              
              overlapAlert.style.left = `${leftPercent}%`;
              overlapAlert.style.width = `${widthPercent}%`;
              overlapAlert.setAttribute('title', 'Capacity Constraint Conflict: Jobs Overlapping');
              
              track.appendChild(overlapAlert);
            }
          });
        }

        this.ganttGrid.appendChild(row);
      });

    // Clear Gantt grid
    this.ganttGrid.innerHTML = '';

    // Loop through each Work Center track in sorted order
    const order = this.state.workCenterOrder || Object.keys(this.state.workCenters);
    order.forEach(machineName => {
      const row = document.createElement('div');
      row.className = 'gantt-row';

      row.innerHTML = `
        <div class="gantt-row-label" draggable="true" data-machine="${machineName}" style="cursor: grab;">
          <span class="gantt-row-name">${machineName}</span>
        </div>
        <div class="gantt-row-track" data-machine="${machineName}"></div>
      `;

      const label = row.querySelector('.gantt-row-label');
      
      label.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/machine-reorder', machineName);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('row-dragging');
      });

      label.addEventListener('dragend', () => {
        row.classList.remove('row-dragging');
        document.querySelectorAll('.gantt-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      });

      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.showWorkCenterPlanModal(machineName);
      });

      label.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/machine-reorder')) {
          e.preventDefault();
          const rect = label.getBoundingClientRect();
          const relativeY = e.clientY - rect.top;
          
          row.classList.remove('drag-over-top', 'drag-over-bottom');
          if (relativeY < rect.height / 2) {
            row.classList.add('drag-over-top');
          } else {
            row.classList.add('drag-over-bottom');
          }
        }
      });

      label.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      label.addEventListener('drop', (e) => {
        const draggedMachine = e.dataTransfer.getData('text/machine-reorder');
        if (draggedMachine && draggedMachine !== machineName) {
          e.preventDefault();
          row.classList.remove('drag-over-top', 'drag-over-bottom');
          this.state.reorderWorkCenters(draggedMachine, machineName);
        }
      });

      const track = row.querySelector('.gantt-row-track');
      track.className = `gantt-row-track scale-${scale}`;

      // Bind Drag & Drop Events
      track.addEventListener('dragover', (e) => {
        e.preventDefault();
        track.classList.add('drag-hover');
      });

      track.addEventListener('dragleave', () => {
        track.classList.remove('drag-hover');
      });

      track.addEventListener('drop', (e) => {
        e.preventDefault();
        track.classList.remove('drag-hover');
        
        const stepId = e.dataTransfer.getData('text/plain');
        if (!stepId) return;

        // Calculate hours based on X coordinate relative to track width
        const rect = track.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const percentage = offsetX / rect.width;
        
        let hour = config.startOffset + (percentage * config.totalHours);
        
        // Find step to get duration
        let duration = 2.0;
        const isEntireOrder = (stepId.startsWith('PD') && !stepId.includes('-')) || 
                              (stepId.startsWith('WO') && stepId.split('-').length === 2);
        if (isEntireOrder) {
          // Dropped an entire Production Order
          const parentWO = this.state.workOrders.find(wo => wo.id === stepId);
          if (parentWO && parentWO.steps.length > 0) {
            duration = parentWO.steps[0].estHours;
          }
        } else {
          // Search in backlog work orders
          for (let wo of this.state.workOrders) {
            const s = wo.steps.find(step => step.id === stepId);
            if (s) { duration = s.estHours; break; }
          }
          // Search in scheduled jobs
          const schedStep = this.state.scheduledJobs.find(j => j.id === stepId);
          if (schedStep) { duration = schedStep.estHours; }
        }

        // Slide-right overlap resolution:
        // If the placed task [hour, hour + duration] overlaps with any existing task on this machine,
        // we shift hour to the right (to the end of the overlapping task) and repeat until no overlaps remain.
        const otherJobs = this.state.scheduledJobs.filter(j => j.id !== stepId && j.woId !== stepId && j.machine === machineName);
        let resolvedHour = hour;
        let hasOverlap = true;
        let iterations = 0;
        const maxIterations = 100; // Prevent infinite loops

        while (hasOverlap && iterations < maxIterations) {
          hasOverlap = false;
          // Find the first task on this machine that overlaps with [resolvedHour, resolvedHour + duration]
          const overlappingJob = otherJobs.find(j => 
            !(resolvedHour + duration <= j.startHour || resolvedHour >= j.startHour + j.estHours)
          );

          if (overlappingJob) {
            resolvedHour = overlappingJob.startHour + overlappingJob.estHours;
            hasOverlap = true;
          }
          iterations++;
        }

        // Apply magnetic snap to the preceding task on the left if it's close (within snapTolerance)
        const snapTolerance = config.snapHours * 1.5; // 1.5 grid slots tolerance
        let hourSnappedByMagnet = (resolvedHour !== hour); // If it was shifted by overlap, it snapped!
        
        hour = resolvedHour;
        
        if (!hourSnappedByMagnet) {
          let bestSnapHour = null;
          let minDiff = Infinity;
          
          otherJobs.forEach(otherJob => {
            const otherEnd = otherJob.startHour + otherJob.estHours;
            const isPreceding = (otherJob.startHour <= hour);
            const diff = Math.abs(hour - otherEnd);
            
            if (isPreceding || diff <= snapTolerance) {
              if (diff < minDiff) {
                minDiff = diff;
                bestSnapHour = otherEnd;
              }
            }
          });

          if (bestSnapHour !== null && (minDiff <= snapTolerance || minDiff < duration)) {
            hour = bestSnapHour;
            hourSnappedByMagnet = true;
          } else {
            // Otherwise, snap to standard grid
            hour = Math.round(hour / config.snapHours) * config.snapHours;
          }
        }
        
        // Cap within timeline bounds
        hour = Math.max(config.startOffset, Math.min(config.startOffset + config.totalHours - duration, hour));

        // Double check if the final hour (after sliding and capping) still overlaps with any task
        const finalOverlap = otherJobs.some(j => 
          !(hour + duration <= j.startHour || hour >= j.startHour + j.estHours)
        );

        if (finalOverlap) {
          const event = new CustomEvent('scheduling-blocked', {
            detail: { stepId, error: `Cannot schedule: Overlaps with another task on ${machineName}!` }
          });
          window.dispatchEvent(event);
          this.state.notify(); // Re-render to revert card position
          return;
        }

        const success = this.state.scheduleJob(stepId, machineName, hour);
        if (success !== false && hourSnappedByMagnet) {
          playSnapSound();
        }
      });

      // Filter jobs/steps assigned to this machine
      const machineJobs = this.state.scheduledJobs.filter(j => j.machine === machineName);

      // Render job cards on timeline
      machineJobs.forEach(job => {
        const jobEnd = job.startHour + job.estHours;
        const timelineEnd = config.startOffset + config.totalHours;
        
        if (job.startHour < timelineEnd && jobEnd > config.startOffset) {
          const card = document.createElement('div');
          
          // 1. Detect sequence routing overlaps (Sequence Warning)
          let isSeqError = false;
          let isParentChildViolation = false;
          if (job.woId && this.state.schedulingModel !== 'finite') {
            const sisterSteps = this.state.scheduledJobs.filter(j => j.woId === job.woId && j.id !== job.id);
            sisterSteps.forEach(sister => {
              // If prior step starts after this step starts
              if (sister.stepNum < job.stepNum && (sister.startHour + sister.estHours) > job.startHour) {
                isSeqError = true;
              }
              // If subsequent step starts before this step ends
              if (sister.stepNum > job.stepNum && jobEnd > sister.startHour) {
                isSeqError = true;
              }
            });

            // Parent-Child violation check
            const isChild = job.woId.includes('-');
            if (isChild) {
              const parentWoId = job.woId.split('-')[0];
              const parentSteps = this.state.scheduledJobs.filter(j => j.woId === parentWoId);
              const parentFirstStep = [...parentSteps].sort((a, b) => a.stepNum - b.stepNum)[0];
              if (parentFirstStep && jobEnd > parentFirstStep.startHour) {
                isParentChildViolation = true;
              }
            } else {
              const parentWoId = job.woId;
              const childWoIds = Array.from(new Set(this.state.scheduledJobs.map(j => j.woId).filter(id => id && id.startsWith(parentWoId + '-'))));
              childWoIds.forEach(childId => {
                const childSteps = this.state.scheduledJobs.filter(j => j.woId === childId);
                const childLastStep = [...childSteps].sort((a, b) => b.stepNum - a.stepNum)[0];
                if (childLastStep && childLastStep.startHour + childLastStep.estHours > job.startHour) {
                  isParentChildViolation = true;
                }
              });
            }
          }

          // 2. Detect delivery target date delay (Due Date Error)
          let isDueError = false;
          let diffDays = 0;
          if (job.dueHour) {
            const scaledDueHour = this.state.getScaledDueHour(job);
            if ((job.startHour + job.estHours) > scaledDueHour) {
              isDueError = true;
              const targetDate = workingHourToDate(scaledDueHour);
              const estDate = workingHourToDate(job.startHour + job.estHours);
              diffDays = Math.ceil((estDate - targetDate) / (1000 * 60 * 60 * 24));
            }
          }

          let statusClass = 'scheduled';
          if (job.status === 'Running') statusClass = 'running';
          else if (job.status === 'Paused') statusClass = 'paused';
          else if (job.status === 'Setup') statusClass = 'setup';
          else if (job.status === 'Completed') statusClass = 'completed';
          else if (job.isNest) statusClass = 'nest';
          if (isSeqError) statusClass += ' sequence-error';
          if (isDueError) statusClass += ' due-error';

          card.className = `gantt-card ${statusClass}`;
          card.setAttribute('draggable', 'true');
          card.setAttribute('data-id', job.id);
          card.setAttribute('data-wo-id', woId);

          // Tooltip description
          let tooltip = `Start: ${this.formatTime(job.startHour, scale)} | Finish: ${this.formatTime(jobEnd, scale)}`;
          if (isSeqError) {
            tooltip += `\n[WARNING] Sequence Violation: Prior operation steps must complete before subsequent ones.`;
          }
          if (isParentChildViolation) {
            tooltip += `\n[WARNING] Parent-Child Violation: Child parts must complete before Parent parts can start.`;
          }
          if (isDueError) {
            tooltip += `\n[ALERT] Delivery Delay: Estimated completion exceeds the Work Order due date target by ${diffDays} day(s).`;
          }
          card.setAttribute('title', tooltip);
          
          // Calculate clip percentages if job is partially offscreen
          const start = Math.max(config.startOffset, job.startHour);
          const end = Math.min(timelineEnd, jobEnd);
          const width = end - start;

          const leftPercent = ((start - config.startOffset) / config.totalHours) * 100;
          const widthPercent = (width / config.totalHours) * 100;

          card.style.left = `${leftPercent}%`;
          card.style.width = `${widthPercent}%`;

          // Card layout showing Routing Step
          const stepIndicator = job.stepNum ? `[${job.stepNum}]` : '';
          const stepName = job.stepName || job.name || '';
          
          const lateIndicator = isDueError ? `<span class="gantt-card-late-tag" style="color: #ff4a4a; font-weight: 700; font-size: 8px; background: rgba(255, 74, 74, 0.15); padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(255, 74, 74, 0.3); margin-left: 4px; animation: pulse-flash 0.5s infinite alternate;">ช้า ${diffDays} วัน</span>` : '';
          const completedIndicator = job.status === 'Completed' ? '<span style="font-size: 8px; font-weight: 900; color: var(--accent-green); background: rgba(22, 163, 74, 0.15); padding: 1px 3px; border-radius: 3px; border: 1px solid var(--accent-green); margin-right: 4px; display: inline-flex; align-items: center; justify-content: center;">✓</span>' : '';

          const childMatchCard = job.woId ? job.woId.match(/^(.*)-(\d+)$/) : null;
          const isChildCard = !!childMatchCard;
          let isParentCard = false;
          if (job.woId) {
            const allWoIds = new Set([
              ...this.state.workOrders.map(w => w.id),
              ...this.state.scheduledJobs.map(j => j.woId).filter(Boolean)
            ]);
            isParentCard = Array.from(allWoIds).some(id => {
              const m = id.match(/^(.*)-(\d+)$/);
              return m && m[1] === job.woId;
            });
          }

          let relationIndicatorHtml = '';
          if (isParentCard) {
            relationIndicatorHtml = `<span class="gantt-card-relation-indicator" title="Parent Part (ตัวแม่)">M</span>`;
          } else if (isChildCard) {
            relationIndicatorHtml = `<span class="gantt-card-relation-indicator" title="Child Part (ตัวลูก) ของ ${childMatchCard[1]}">C</span>`;
          }

          card.innerHTML = `
            <div class="gantt-card-id" style="display: flex; align-items: center; justify-content: space-between; width: 100%; white-space: nowrap; overflow: hidden;">
              <span style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; gap: 4px; flex: 1; padding-right: 15px;">
                ${completedIndicator}<strong>${job.woId || job.id}</strong> <span style="opacity: 0.85; font-weight: normal;">${job.partName}</span> ${stepIndicator} ${job.priority === 'Hot' ? '🔥' : ''}
              </span>
              ${lateIndicator}
            </div>
            <div class="gantt-card-desc" title="${stepName}">${stepName}</div>
            <div class="gantt-card-bottom">
              <span style="padding-left: 14px;">Qty: ${job.qty}</span>
              <span>Fin: ${this.formatTime(jobEnd, scale)}</span>
            </div>
            <span class="gantt-card-remove" title="Unschedule step" data-id="${job.id}">×</span>
            ${relationIndicatorHtml}
            <svg class="gantt-card-qr-icon" data-id="${job.id}" viewBox="0 0 24 24" width="12" height="12">
              <path d="M3 3h6v6H3V3zm2 2v2h2V5H5zm8-2h6v6h-6V3zm2 2v2h2V5h-2zM3 13h6v6H3v-6zm2 2v2h2v-2H5zm13-2h3v2h-3v-2zm-3 3h3v3h-3v-3zm3 3h3v-3h-3v3zm-3-3h-2v2h2v-2zm3-3h-3v2h3v-2zm-3-2h2V9h-2v2zm2-4h2V3h-2v2zm0 4h2V7h-2v2zm-4 4h2v-2h-2v2zm-2 2H9v2h2v-2zm4 4h-2v2h2v-2zm2-2h-2v2h2v-2z"/>
            </svg>
          `;

          // Bind drag event
          card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', job.id);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => { card.style.opacity = '0.3'; }, 0);
          });

          card.addEventListener('dragend', () => {
            card.style.opacity = '1';
            this.state.notify();
          });

          // Click card to open Kiosk Terminal / webactual modal
          card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const jid = e.currentTarget.getAttribute('data-id');
            const event = new CustomEvent('open-webactual', { detail: { jobId: jid } });
            window.dispatchEvent(event);
          });

          // Click card to select in Kiosk Terminal
          card.addEventListener('click', (e) => {
            if (e.target.classList.contains('gantt-card-remove') || e.target.classList.contains('gantt-card-qr-icon') || e.target.tagName === 'path') {
              return;
            }
            e.stopPropagation();
            const event = new CustomEvent('gantt-card-selected', {
              detail: { jobId: job.id, machine: job.machine }
            });
            window.dispatchEvent(event);
          });

          // Double click card to edit Delivery Target
          card.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const woId = job.woId || job.id;
            this.showPDPlanModal(woId);
          });

          // Interactive Chain Highlight on Hover
          if (woId) {
            card.addEventListener('mouseenter', () => {
              document.querySelectorAll(`.gantt-card[data-wo-id="${woId}"]`).forEach(c => {
                c.classList.add('chain-highlight');
              });
              document.querySelectorAll(`.gantt-dep-line[data-wo-id="${woId}"]`).forEach(line => {
                line.classList.add('highlight');
              });
            });

            card.addEventListener('mouseleave', () => {
              document.querySelectorAll(`.gantt-card[data-wo-id="${woId}"]`).forEach(c => {
                c.classList.remove('chain-highlight');
              });
              document.querySelectorAll(`.gantt-dep-line[data-wo-id="${woId}"]`).forEach(line => {
                line.classList.remove('highlight');
              });
            });
          }

          // Parent-Child family yellow highlight on hover
          let familyParentWoId = null;
          if (isParentCard) {
            familyParentWoId = job.woId;
          } else if (isChildCard) {
            familyParentWoId = childMatchCard[1];
          }

          if (familyParentWoId) {
            card.addEventListener('mouseenter', () => {
              const pWoId = familyParentWoId;
              
              // Highlight parent cards
              document.querySelectorAll(`.gantt-card[data-wo-id="${pWoId}"]`).forEach(c => {
                c.classList.add('parent-child-highlight');
              });
              
              // Highlight child cards
              document.querySelectorAll('.gantt-card').forEach(c => {
                const cWoId = c.getAttribute('data-wo-id');
                if (cWoId && (cWoId === pWoId || cWoId.startsWith(pWoId + '-'))) {
                  c.classList.add('parent-child-highlight');
                }
              });

              // Highlight parent-child connection lines
              document.querySelectorAll(`.parent-child-dep-line[data-parent-wo-id="${pWoId}"]`).forEach(line => {
                line.classList.add('parent-child-highlight');
              });

              // Highlight internal sequence lines for parent and all its children
              document.querySelectorAll(`.gantt-dep-line`).forEach(line => {
                const lineWoId = line.getAttribute('data-wo-id');
                if (lineWoId && (lineWoId === pWoId || lineWoId.startsWith(pWoId + '-'))) {
                  line.classList.add('parent-child-highlight');
                }
              });
            });

            card.addEventListener('mouseleave', () => {
              document.querySelectorAll('.gantt-card').forEach(c => {
                c.classList.remove('parent-child-highlight');
              });
              document.querySelectorAll('.gantt-dep-line').forEach(line => {
                line.classList.remove('parent-child-highlight');
              });
            });
          }

          track.appendChild(card);
        });

        // 3. Render Overlap Warnings
        if (this.state.schedulingModel !== 'finite') {
          const overlaps = this.detectOverlaps(machineJobs);
          overlaps.forEach(overlap => {
            const timelineEnd = config.startOffset + config.totalHours;
            if (overlap.start < timelineEnd && overlap.end > config.startOffset) {
              const overlapAlert = document.createElement('div');
              overlapAlert.className = 'gantt-overlap-alert';
              
              const start = Math.max(config.startOffset, overlap.start);
              const end = Math.min(timelineEnd, overlap.end);
              
              const leftPercent = ((start - config.startOffset) / config.totalHours) * 100;
              const widthPercent = ((end - start) / config.totalHours) * 100;
              
              overlapAlert.style.left = `${leftPercent}%`;
              overlapAlert.style.width = `${widthPercent}%`;
              overlapAlert.setAttribute('title', 'Capacity Constraint Conflict: Jobs Overlapping');
              
              track.appendChild(overlapAlert);
            }
          });
        }

        this.ganttGrid.appendChild(row);
      });
    }
    this.drawDependencyLines();
  }

  detectOverlaps(jobs) {
    if (jobs.length < 2) return [];
    
    const sorted = [...jobs].sort((a, b) => a.startHour - b.startHour);
    const overlaps = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      
      const currentEnd = current.startHour + current.estHours;
      
      if (next.startHour < currentEnd) {
        overlaps.push({
          start: next.startHour,
          end: Math.min(currentEnd, next.startHour + next.estHours)
        });
      }
    }
    return overlaps;
  }

  drawDependencyLines() {
    const svg = document.getElementById('gantt-svg-overlay');
    if (!svg) return;

    // Remove all children except defs
    Array.from(svg.children).forEach(child => {
      if (child.tagName !== 'defs') {
        svg.removeChild(child);
      }
    });

    const board = this.ganttGrid.closest('.gantt-board');
    if (!board) return;
    const boardRect = board.getBoundingClientRect();

    // Map scheduled job IDs to their rendered DOM cards
    const cards = Array.from(this.ganttGrid.querySelectorAll('.gantt-card'));
    const cardMap = {};
    cards.forEach(card => {
      const id = card.getAttribute('data-id');
      if (id) cardMap[id] = card;
    });

    // Group jobs by woId
    const woGroups = {};
    this.state.scheduledJobs.forEach(job => {
      if (job.woId) {
        if (!woGroups[job.woId]) {
          woGroups[job.woId] = [];
        }
        woGroups[job.woId].push(job);
      }
    });

    // Draw lines for each group
    Object.keys(woGroups).forEach(woId => {
      const jobs = woGroups[woId];
      // Sort jobs by stepNum in ascending order
      jobs.sort((a, b) => a.stepNum - b.stepNum);

      // Draw lines between consecutive steps
      for (let i = 0; i < jobs.length - 1; i++) {
        const stepA = jobs[i];
        const stepB = jobs[i + 1];

        const cardA = cardMap[stepA.id];
        const cardB = cardMap[stepB.id];

        // Only draw if both cards are rendered on the Gantt grid
        if (cardA && cardB) {
          const rectA = cardA.getBoundingClientRect();
          const rectB = cardB.getBoundingClientRect();

          // Calculate coordinates relative to the gantt-board
          const xA = rectA.right - boardRect.left;
          const yA = rectA.top + (rectA.height / 2) - boardRect.top;

          const xB = rectB.left - boardRect.left;
          const yB = rectB.top + (rectB.height / 2) - boardRect.top;

          // Create SVG Path
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          
          // Generate Cubic Bezier curve string
          const dx = Math.max(40, Math.abs(xB - xA) * 0.5);
          const pathD = `M ${xA} ${yA} C ${xA + dx} ${yA}, ${xB - dx} ${yB}, ${xB} ${yB}`;
          
          path.setAttribute('d', pathD);
          path.setAttribute('class', 'gantt-dep-line');
          path.setAttribute('data-wo-id', woId);

          // Check if sequence is in error (previous step finishes after next step starts)
          const stepAEnd = stepA.startHour + stepA.estHours;
          if (stepAEnd > stepB.startHour) {
            path.classList.add('error');
          }

          svg.appendChild(path);
        }
      }
    });

    // Draw lines between Child WOs and Parent WOs (Child finishes -> Parent starts)
    const parentWoIds = new Set(Object.keys(woGroups).filter(woId => {
      return Object.keys(woGroups).some(otherWoId => {
        const m = otherWoId.match(/^(.*)-(\d+)$/);
        return m && m[1] === woId;
      });
    }));

    parentWoIds.forEach(parentWoId => {
      const parentJobs = woGroups[parentWoId];
      if (!parentJobs || parentJobs.length === 0) return;
      // Sort parent jobs in ascending order to find the first step
      parentJobs.sort((a, b) => a.stepNum - b.stepNum);
      const parentFirstStep = parentJobs[0];
      const cardParent = cardMap[parentFirstStep.id];

      // Find children
      const childWoIds = Object.keys(woGroups).filter(woId => {
        const m = woId.match(/^(.*)-(\d+)$/);
        return m && m[1] === parentWoId;
      });

      childWoIds.forEach(childWoId => {
        const childJobs = woGroups[childWoId];
        if (!childJobs || childJobs.length === 0) return;
        // Sort child jobs in descending order to find the last step (highest stepNum)
        childJobs.sort((a, b) => b.stepNum - a.stepNum);
        const childLastStep = childJobs[0];
        const cardChild = cardMap[childLastStep.id];

        if (cardChild && cardParent) {
          const rectA = cardChild.getBoundingClientRect();
          const rectB = cardParent.getBoundingClientRect();

          const xA = rectA.right - boardRect.left;
          const yA = rectA.top + (rectA.height / 2) - boardRect.top;

          const xB = rectB.left - boardRect.left;
          const yB = rectB.top + (rectB.height / 2) - boardRect.top;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const dx = Math.max(40, Math.abs(xB - xA) * 0.5);
          const pathD = `M ${xA} ${yA} C ${xA + dx} ${yA}, ${xB - dx} ${yB}, ${xB} ${yB}`;
          
          path.setAttribute('d', pathD);
          path.setAttribute('class', 'gantt-dep-line parent-child-dep-line');
          path.setAttribute('data-parent-wo-id', parentWoId);
          path.setAttribute('data-child-wo-id', childWoId);

          // Error condition: Child finishes after Parent starts
          const childLastStepEnd = childLastStep.startHour + childLastStep.estHours;
          if (childLastStepEnd > parentFirstStep.startHour) {
            path.classList.add('error');
          }

          svg.appendChild(path);
        }
      });
    });

    // Draw vertical "Now" line showing current simulated date/time status
    const scale = this.state.activeScale;
    const config = this.getScaleConfig(scale);
    const now = new Date();
    
    const nowWorkingHour = dateToWorkingHour(now);

    const timelineEnd = config.startOffset + config.totalHours;
    if (nowWorkingHour >= config.startOffset && nowWorkingHour <= timelineEnd) {
      const percent = ((nowWorkingHour - config.startOffset) / config.totalHours) * 100;
      
      const track = this.ganttGrid.querySelector('.gantt-row-track');
      if (track) {
        const trackRect = track.getBoundingClientRect();
        const trackLeft = trackRect.left - boardRect.left;
        const trackWidth = trackRect.width;
        const x = trackLeft + (percent / 100) * trackWidth;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x);
        line.setAttribute('y1', 0);
        line.setAttribute('x2', x);
        line.setAttribute('y2', boardRect.height);
        line.setAttribute('class', 'gantt-now-line');
        line.setAttribute('title', `Current Time: ${now.toLocaleTimeString()}`);
        
        svg.appendChild(line);
      }
    }
  }

  formatTime(hourFloat, scale) {
    const d = workingHourToDate(hourFloat);
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
      } else if (scale === 'week') {
        const baseDate = new Date(2026, 5, 22, 8, 0, 0);
        const dayDiff = Math.floor((d - baseDate) / (24 * 60 * 60 * 1000));
        const weekIndex = Math.floor(dayDiff / 7) + 1;
        return `W${weekIndex}-${dayName} ${timeStr}`;
      } else {
        const baseDate = new Date(2026, 5, 22, 8, 0, 0);
        const dayDiff = Math.floor((d - baseDate) / (24 * 60 * 60 * 1000));
        const monthIndex = Math.floor(dayDiff / 30) + 1;
        const relativeDay = (dayDiff % 30) + 1;
        return `M${monthIndex}-D${relativeDay} ${timeStr}`;
      }
    }
  }

  showWorkCenterPlanModal(machineName) {
    const modal = document.getElementById('wc-plan-modal');
    const title = document.getElementById('wc-plan-title');
    const tbody = document.getElementById('wc-plan-table-body');
    const emptyMsg = document.getElementById('wc-plan-empty-msg');
    const btnExport = document.getElementById('btn-export-wc-csv');
    
    title.textContent = `Production Plan: ${machineName}`;
    tbody.innerHTML = '';
    
    // Find jobs on this machine, sorted by startHour
    const jobs = this.state.scheduledJobs
      .filter(j => j.machine === machineName)
      .sort((a, b) => a.startHour - b.startHour);
      
    if (jobs.length === 0) {
      emptyMsg.classList.remove('hidden');
      btnExport.style.display = 'none';
    } else {
      emptyMsg.classList.add('hidden');
      btnExport.style.display = 'block';
      
      jobs.forEach(job => {
        const dStart = workingHourToDate(job.startHour);
        const dEnd = workingHourToDate(job.startHour + job.estHours);
        
        const startStr = `${dStart.toLocaleDateString('en-GB')} ${dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
        const endStr = `${dEnd.toLocaleDateString('en-GB')} ${dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
        
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-glass)';
        
        let statusBadge = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(0, 242, 254, 0.1); color: var(--accent-teal); border: 1px solid var(--accent-teal);">${job.status}</span>`;
        if (job.status === 'Running') {
          statusBadge = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(57, 255, 20, 0.1); color: var(--accent-green); border: 1px solid var(--accent-green);">${job.status}</span>`;
        } else if (job.status === 'Paused') {
          statusBadge = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(255, 153, 0, 0.1); color: var(--accent-orange); border: 1px solid var(--accent-orange);">${job.status}</span>`;
        } else if (job.status === 'Completed') {
          statusBadge = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(22, 163, 74, 0.15); color: var(--accent-green); border: 1px solid var(--accent-green);">✓ Done</span>`;
        }

        tr.innerHTML = `
          <td style="padding: 10px 8px; font-weight: bold; color: var(--text-primary);">${job.woId || job.id}</td>
          <td style="padding: 10px 8px;">${job.partName}</td>
          <td style="padding: 10px 8px;">${job.stepNum ? `Step ${job.stepNum} - ` : ''}${job.stepName || ''}</td>
          <td style="padding: 10px 8px; text-align: center; font-weight: bold;">${job.qty}</td>
          <td style="padding: 10px 8px; font-family: monospace;">${startStr}</td>
          <td style="padding: 10px 8px; font-family: monospace;">${endStr}</td>
          <td style="padding: 10px 8px; text-align: center;">${statusBadge}</td>
        `;
        tbody.appendChild(tr);
      });
    }
    
    // Bind Export Button click
    // Remove previous event listener to avoid multiple downloads
    const newBtnExport = btnExport.cloneNode(true);
    btnExport.parentNode.replaceChild(newBtnExport, btnExport);
    
    newBtnExport.addEventListener('click', () => {
      this.exportWorkCenterPlanToCSV(machineName, jobs);
    });
    
    modal.classList.remove('hidden');
  }
  
  exportWorkCenterPlanToCSV(machineName, jobs) {
    const headers = [
      "Production Order ID",
      "Part Name",
      "Step No",
      "Step Name",
      "Qty",
      "Start Date",
      "Start Time",
      "Finish Date",
      "Finish Time",
      "Status"
    ];
    
    const rows = jobs.map(job => {
      const dStart = workingHourToDate(job.startHour);
      const dEnd = workingHourToDate(job.startHour + job.estHours);
      
      const startDateStr = dStart.toLocaleDateString('en-GB');
      const startTimeStr = dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const endDateStr = dEnd.toLocaleDateString('en-GB');
      const endTimeStr = dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      
      return [
        job.woId || job.id,
        job.partName,
        job.stepNum ? `Step ${job.stepNum}` : "",
        job.stepName || "",
        job.qty,
        startDateStr,
        startTimeStr,
        endDateStr,
        endTimeStr,
        job.status
      ];
    });
    
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(val => {
        let cell = val.toString().replace(/"/g, '""');
        if (cell.includes(",") || cell.includes('"') || cell.includes('\n')) {
          cell = `"${cell}"`;
        }
        return cell;
      }).join(","))
    ].join("\n");
    
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Plan_${machineName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  showPDPlanModal(woId) {
    const modal = document.getElementById('pd-plan-modal');
    const title = document.getElementById('pd-plan-title');
    const customerEl = document.getElementById('pd-plan-customer');
    const partnameEl = document.getElementById('pd-plan-partname');
    const qtyEl = document.getElementById('pd-plan-qty');
    const targetdateEl = document.getElementById('pd-plan-targetdate');
    const tbody = document.getElementById('pd-plan-table-body');
    const btnExport = document.getElementById('btn-export-pd-csv');
    
    title.textContent = `Production Plan: ${woId}`;
    tbody.innerHTML = '';
    
    // Find all steps for this PD in scheduledJobs
    const jobs = this.state.scheduledJobs
      .filter(j => j.woId === woId || j.id === woId)
      .sort((a, b) => a.stepNum - b.stepNum);
      
    if (jobs.length === 0) return;
    
    const firstJob = jobs[0];
    customerEl.textContent = firstJob.customer || 'N/A';
    partnameEl.textContent = firstJob.partName || 'N/A';
    qtyEl.textContent = firstJob.qty || 'N/A';
    
    const scaledDue = this.state.getScaledDueHour(firstJob);
    const dDue = workingHourToDate(scaledDue);
    
    // Clear previous event listeners by cloning
    const cleanTargetDateEl = targetdateEl.cloneNode(true);
    targetdateEl.parentNode.replaceChild(cleanTargetDateEl, targetdateEl);
    
    cleanTargetDateEl.textContent = `${dDue.toLocaleDateString('en-GB')} ${dDue.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    
    cleanTargetDateEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cleanTargetDateEl.querySelector('input')) return;
      
      const yyyy = dDue.getFullYear();
      const mm = (dDue.getMonth() + 1).toString().padStart(2, '0');
      const dd = dDue.getDate().toString().padStart(2, '0');
      const dateString = `${yyyy}-${mm}-${dd}`;
      
      cleanTargetDateEl.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 4px;">
          <input type="date" class="modal-due-date-input" value="${dateString}" style="background: var(--bg-darkest); border: 1px solid var(--accent-red); color: #fff; font-size: 10px; padding: 2px; border-radius: 3px; font-family: monospace; outline: none; width: 100px; height: 18px; line-height: 1;" />
          <button class="btn-save-modal-due" style="background: rgba(0, 242, 254, 0.2); border: 1px solid var(--accent-teal); color: #fff; padding: 2px 4px; border-radius: 3px; cursor: pointer; font-size: 8px; font-weight: bold; line-height: 1;">✓</button>
          <button class="btn-cancel-modal-due" style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.3); color: #fff; padding: 2px 4px; border-radius: 3px; cursor: pointer; font-size: 8px; font-weight: bold; line-height: 1;">✕</button>
        </span>
      `;
      
      const input = cleanTargetDateEl.querySelector('.modal-due-date-input');
      const btnSave = cleanTargetDateEl.querySelector('.btn-save-modal-due');
      const btnCancel = cleanTargetDateEl.querySelector('.btn-cancel-modal-due');
      
      input.focus();
      
      btnSave.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const newDateVal = input.value;
        if (newDateVal) {
          const [y, m, d] = newDateVal.split('-').map(Number);
          const newDate = new Date(y, m - 1, d, 17, 0, 0); // Default to 17:00 deadline
          const newDueHour = this.state.dateToWorkingHour(newDate);
          
          this.state.updateWorkOrderDueHour(woId, newDueHour);
          
          // Re-render modal
          this.showPDPlanModal(woId);
        } else {
          this.showPDPlanModal(woId);
        }
      });
      
      btnCancel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.showPDPlanModal(woId);
      });
    });
    
    jobs.forEach(job => {
      const dStart = workingHourToDate(job.startHour);
      const dEnd = workingHourToDate(job.startHour + job.estHours);
      
      const startStr = `${dStart.toLocaleDateString('en-GB')} ${dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
      const endStr = `${dEnd.toLocaleDateString('en-GB')} ${dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
      
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-glass)';
      
      let statusBadge = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(0, 242, 254, 0.1); color: var(--accent-teal); border: 1px solid var(--accent-teal);">${job.status}</span>`;
      if (job.status === 'Running') {
        statusBadge = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(57, 255, 20, 0.1); color: var(--accent-green); border: 1px solid var(--accent-green);">${job.status}</span>`;
      } else if (job.status === 'Paused') {
        statusBadge = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(255, 153, 0, 0.1); color: var(--accent-orange); border: 1px solid var(--accent-orange);">${job.status}</span>`;
      } else if (job.status === 'Completed') {
        statusBadge = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(22, 163, 74, 0.15); color: var(--accent-green); border: 1px solid var(--accent-green);">✓ Done</span>`;
      }

      tr.innerHTML = `
        <td style="padding: 10px 8px; font-weight: bold; color: var(--text-primary);">Step ${job.stepNum}</td>
        <td style="padding: 10px 8px;">${job.stepName || ''}</td>
        <td style="padding: 10px 8px; font-weight: bold;">${job.machine}</td>
        <td style="padding: 10px 8px; text-align: center;">${job.estHours}h</td>
        <td style="padding: 10px 8px; font-family: monospace;">${startStr}</td>
        <td style="padding: 10px 8px; font-family: monospace;">${endStr}</td>
        <td style="padding: 10px 8px; text-align: center;">${statusBadge}</td>
      `;
      tbody.appendChild(tr);
    });
    
    // Bind Export Button click
    const newBtnExport = btnExport.cloneNode(true);
    btnExport.parentNode.replaceChild(newBtnExport, btnExport);
    
    newBtnExport.addEventListener('click', () => {
      this.exportPDPlanToCSV(woId, jobs);
    });
    
    modal.classList.remove('hidden');
  }
  
  exportPDPlanToCSV(woId, jobs) {
    const headers = [
      "Production Order ID",
      "Customer",
      "Part Name",
      "Qty",
      "Step No",
      "Operation Name",
      "Work Center",
      "Est Hours",
      "Start Date",
      "Start Time",
      "Finish Date",
      "Finish Time",
      "Status"
    ];
    
    const rows = jobs.map(job => {
      const dStart = workingHourToDate(job.startHour);
      const dEnd = workingHourToDate(job.startHour + job.estHours);
      
      const startDateStr = dStart.toLocaleDateString('en-GB');
      const startTimeStr = dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const endDateStr = dEnd.toLocaleDateString('en-GB');
      const endTimeStr = dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      
      return [
        job.woId || job.id,
        job.customer,
        job.partName,
        job.qty,
        `Step ${job.stepNum}`,
        job.stepName || "",
        job.machine,
        job.estHours,
        startDateStr,
        startTimeStr,
        endDateStr,
        endTimeStr,
        job.status
      ];
    });
    
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(val => {
        let cell = val.toString().replace(/"/g, '""');
        if (cell.includes(",") || cell.includes('"') || cell.includes('\n')) {
          cell = `"${cell}"`;
        }
        return cell;
      }).join(","))
    ].join("\n");
    
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Plan_${woId}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
