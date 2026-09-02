// MIE Trak Pro - Gantt Planning Board Controller
import { getPriorityWeight } from './scheduler.js';

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

// Picks black or white text so it stays readable against a custom (user-picked)
// task bar color - light backgrounds like white/yellow need black text instead
// of the default white.
function getReadableTextColor(hexColor) {
  if (!hexColor || typeof hexColor !== 'string' || hexColor[0] !== '#' || hexColor.length < 7) return '#fff';
  const r = parseInt(hexColor.substring(1, 3), 16);
  const g = parseInt(hexColor.substring(3, 5), 16);
  const b = parseInt(hexColor.substring(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000' : '#fff';
}

export function getJobPriority(job, state) {
  if (job.priority !== undefined && job.priority !== null && String(job.priority).trim() !== '') {
    return String(job.priority).trim();
  }
  const wo = state?.workOrders?.find(w => w.id === job.woId || w.id === job.id);
  if (wo && wo.priority !== undefined && wo.priority !== null && String(wo.priority).trim() !== '') {
    return String(wo.priority).trim();
  }
  return 'Normal';
}

export function isJobPriorityVisible(job, state) {
  if (!state || !state.activePriorities) return true;
  const p = getJobPriority(job, state);
  if (state.activePriorities[p] === false) return false;
  for (const k in state.activePriorities) {
    if (String(k).trim() === p && state.activePriorities[k] === false) {
      return false;
    }
  }
  return true;
}

export function isJobProjectVisible(job, state) {
  if (!state || !state.activeProjects) return true;
  const proj = String(job.project || state.workOrders?.find(w => w.id === job.woId)?.project || 'General').trim();
  if (state.activeProjects[proj] === false) return false;
  for (const k in state.activeProjects) {
    if (String(k).trim() === proj && state.activeProjects[k] === false) {
      return false;
    }
  }
  return true;
}

export class GanttController {
  constructor(state) {
    this.state = state;
    this.state.ganttController = this;
    this.toastTimeout = null;
    this.collapsedParents = new Set();
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
      this.drawDependencyLines();
    });

    // Mouse wheel vertical scroll row up/down
    if (this.boardWrapper) {
      this.boardWrapper.addEventListener('wheel', (e) => {
        // Prevent default browser page scrolling
        e.preventDefault();
        
        // Scroll vertically
        this.boardWrapper.scrollTop += e.deltaY;
        this.updateStickyIndicators();
      }, { passive: false });

      this.boardWrapper.addEventListener('scroll', () => {
        this.updateStickyIndicators();
      }, { passive: true });
    }

    // Gantt board panning (drag-to-scroll)
    if (this.boardWrapper) {
      let isDown = false;
      let startMouseX = 0;
      let startMouseY = 0;
      let startTimelineOffset = 0;
      let startScrollTop = 0;
      let currentMouseX = 0;
      let currentMouseY = 0;
      let animationFrameId = null;

      const updateScroll = () => {
        if (!isDown) return;
        
        // 1. Horizontal panning via timelineOffset
        const dX = currentMouseX - startMouseX;
        const trackWidth = Math.max(100, (this.boardWrapper.clientWidth || 1000) - 140);
        const scale = this.state.activeScale;
        const config = this.getScaleConfig(scale);
        const totalHours = config.totalHours || 48.0;

        const dHours = -(dX / trackWidth) * totalHours;
        const newOffset = startTimelineOffset + dHours;

        // 2. Vertical panning via scrollTop
        const dY = currentMouseY - startMouseY;
        this.boardWrapper.scrollTop = startScrollTop - dY;

        this.state.setTimelineOffset(newOffset);
        this.updateStickyIndicators();
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

      window.addEventListener('mouseup', () => {
        if (isDown) {
          isDown = false;
          this.boardWrapper.classList.remove('active-panning');
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
          }
        }
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        currentMouseX = e.pageX;
        currentMouseY = e.pageY;
        
        if (!animationFrameId) {
          animationFrameId = requestAnimationFrame(updateScroll);
        }
      });
    }

    // Keyboard navigation (Arrow Left / Right, L / R keys to pan Gantt board left/right, Up/Down for vertical)
    window.addEventListener('keydown', (e) => {
      // Ignore if user is currently typing in an input, textarea, select or editable field
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }

      const isLeft = e.key === 'ArrowLeft' || e.key === 'Left' || e.key === 'l' || e.key === 'L' || e.key === 'a' || e.key === 'A';
      const isRight = e.key === 'ArrowRight' || e.key === 'Right' || e.key === 'r' || e.key === 'R' || e.key === 'd' || e.key === 'D';
      const isUp = e.key === 'ArrowUp' || e.key === 'Up';
      const isDownKey = e.key === 'ArrowDown' || e.key === 'Down';

      if (isLeft || isRight) {
        e.preventDefault();
        const direction = isLeft ? -1 : 1;
        const wrapper = this.boardWrapper || document.querySelector('.gantt-board-wrapper');

        // If board wrapper has horizontal overflow, pan with smooth scroll
        if (wrapper && wrapper.scrollWidth > (wrapper.clientWidth + 5)) {
          const scrollAmount = Math.max(120, Math.floor(wrapper.clientWidth * 0.15));
          wrapper.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
        } else {
          // Otherwise shift the timeline offset
          const scale = this.state.activeScale;
          let step = 8.0; // 1 working day in hours (8h)
          if (scale === 'min1') {
            step = 1.0 / 60.0;
          } else if (scale === 'min5') {
            step = 5.0 / 60.0;
          } else if (scale === 'min15') {
            step = 15.0 / 60.0;
          } else if (scale === 'min30') {
            step = 0.5;
          } else if (scale === 'hr') {
            step = 1.0;
          } else if (scale === 'day') {
            step = 8.0;
          } else if (scale === 'week') {
            step = 48.0;
          } else if (scale === 'month') {
            step = 192.0;
          }
          
          const currentOffset = this.state.timelineOffset || 0.0;
          const newOffset = currentOffset + direction * step;
          this.state.setTimelineOffset(newOffset);
        }
      } else if (isUp || isDownKey) {
        // Vertical panning
        const wrapper = this.boardWrapper || document.querySelector('.gantt-board-wrapper');
        if (wrapper) {
          e.preventDefault();
          const scrollAmount = isUp ? -60 : 60;
          wrapper.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        }
      }
    });
    
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

    // Global open PD edit modal event listener
    window.addEventListener('open-pd-modal', (e) => {
      if (e.detail && e.detail.woId) {
        this.showPDPlanModal(e.detail.woId);
      }
    });
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
    const minuteTickCounts = { min1: [15, 1.0 / 60.0], min5: [12, 5.0 / 60.0], min15: [8, 15.0 / 60.0], min30: [8, 0.5] };
    if (minuteTickCounts[scale]) {
      const [count, stepHours] = minuteTickCounts[scale];
      for (let i = 0; i < count; i++) {
        const workingHour = offset + i * stepHours;
        const d = workingHourToDate(workingHour);
        ticks.push(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`);
      }
    } else if (scale === 'day') {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (let i = 0; i < 6; i++) {
        const workingHour = offset + i * 8.0;
        const d = workingHourToDate(workingHour);
        const dayLabel = days[d.getDay() === 0 ? 5 : d.getDay() - 1];
        const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
        ticks.push(`${dayLabel} ${dateStr}`);
      }
    } else if (scale === 'week') {
      for (let i = 0; i < 24; i++) {
        const workingHour = offset + i * 8.0;
        const d = workingHourToDate(workingHour);
        const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
        ticks.push(dateStr);
      }
    } else if (scale === 'month') {
      for (let i = 0; i < 3; i++) {
        const workingHour = offset + i * 192.0;
        const d = workingHourToDate(workingHour);
        const monthName = d.toLocaleDateString('en-US', { month: 'long' });
        const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
        ticks.push(`${monthName} (${dateStr})`);
      }
    } else if (scale === 'quarter') {
      for (let i = 0; i < 3; i++) {
        const workingHour = offset + i * 576.0;
        const d = workingHourToDate(workingHour);
        const monthName = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
        ticks.push(`${monthName} (${dateStr})`);
      }
    } else if (scale === 'year') {
      for (let i = 0; i < 4; i++) {
        const workingHour = offset + i * 1728.0;
        const d = workingHourToDate(workingHour);
        const qName = `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
        const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
        ticks.push(`${qName} (${dateStr})`);
      }
    }
    return ticks;
  }

  getRangeLabel(scale, offset) {
    const start = workingHourToDate(offset);
    const minuteScaleHours = { min1: 15.0 / 60.0, min5: 1.0, min15: 2.0, min30: 4.0 };
    if (minuteScaleHours[scale] !== undefined) {
      const end = workingHourToDate(offset + minuteScaleHours[scale]);
      const dateStr = start.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
      const startTime = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const endTime = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return `${dateStr} ${startTime} - ${endTime}`;
    } else if (scale === 'hr') {
      return start.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    } else if (scale === 'day') {
      const end = workingHourToDate(offset + 48.0);
      const startStr = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      return `Week of ${startStr} - ${endStr}`;
    } else if (scale === 'week') {
      const end = workingHourToDate(offset + 192.0 - 1);
      const startStr = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      return `4-Week: ${startStr} - ${endStr}`;
    } else if (scale === 'month') {
      const end = workingHourToDate(offset + 576.0 - 1);
      const startStr = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      return `${startStr} - ${endStr}`;
    } else if (scale === 'quarter') {
      const end = workingHourToDate(offset + 1728.0 - 1);
      const startStr = start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      return `Quarter: ${startStr} - ${endStr}`;
    } else if (scale === 'year') {
      const end = workingHourToDate(offset + 6912.0 - 1);
      const startStr = start.toLocaleDateString('en-GB', { year: 'numeric' });
      const endStr = end.toLocaleDateString('en-GB', { year: 'numeric' });
      return `Year: ${startStr} - ${endStr}`;
    }
    return '';
  }

  getScaleConfig(scale) {
    const offset = this.state.timelineOffset || 0.0;
    switch (scale) {
      case 'min1':
        return {
          totalHours: 15.0 / 60.0,
          startOffset: offset,
          columns: 15,
          ticks: this.generateTicks('min1', offset),
          snapHours: 1.0 / 60.0
        };
      case 'min5':
        return {
          totalHours: 1.0,
          startOffset: offset,
          columns: 12,
          ticks: this.generateTicks('min5', offset),
          snapHours: 5.0 / 60.0
        };
      case 'min15':
        return {
          totalHours: 2.0,
          startOffset: offset,
          columns: 8,
          ticks: this.generateTicks('min15', offset),
          snapHours: 15.0 / 60.0
        };
      case 'min30':
        return {
          totalHours: 4.0,
          startOffset: offset,
          columns: 8,
          ticks: this.generateTicks('min30', offset),
          snapHours: 0.5
        };
      case 'day':
        return {
          totalHours: 48.0, 
          startOffset: offset,
          columns: 6,
          ticks: this.generateTicks('day', offset),
          snapHours: 1.0 
        };
      case 'week':
        return {
          totalHours: 192.0, 
          startOffset: offset,
          columns: 24,
          ticks: this.generateTicks('week', offset),
          snapHours: 8.0 
        };
      case 'month':
        return {
          totalHours: 576.0, 
          startOffset: offset,
          columns: 3,
          ticks: this.generateTicks('month', offset),
          snapHours: 16.0 
        };
      case 'quarter':
        return {
          totalHours: 1728.0, 
          startOffset: offset,
          columns: 3,
          ticks: this.generateTicks('quarter', offset),
          snapHours: 48.0 
        };
      case 'year':
        return {
          totalHours: 6912.0, 
          startOffset: offset,
          columns: 4,
          ticks: this.generateTicks('year', offset),
          snapHours: 192.0 
        };
      case 'hr':
      default:
        return {
          totalHours: 8.0, 
          startOffset: offset,
          columns: 8, 
          ticks: ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00 (OT)'],
          snapHours: 0.5 
        };
    }
  }

  render() {
    const scale = this.state.activeScale;
    const config = this.getScaleConfig(scale);
    const cardMap = {};

    // --- Precomputed indexes (built once per render instead of re-scanning
    // this.state.scheduledJobs/workOrders inside every per-row loop below,
    // which was O(rows x jobs) and got very slow past ~1000 jobs). ---
    const jobsByWoId = new Map();
    this.state.scheduledJobs.forEach(j => {
      if (!j.woId) return;
      if (!jobsByWoId.has(j.woId)) jobsByWoId.set(j.woId, []);
      jobsByWoId.get(j.woId).push(j);
    });
    const jobsByMachine = new Map();
    this.state.scheduledJobs.forEach(j => {
      if (!j.machine) return;
      if (!jobsByMachine.has(j.machine)) jobsByMachine.set(j.machine, []);
      jobsByMachine.get(j.machine).push(j);
    });
    const jobById = new Map(this.state.scheduledJobs.map(j => [j.id, j]));
    const backlogWoById = new Map(this.state.workOrders.map(w => [w.id, w]));
    const allWoIdsSet = new Set([
      ...this.state.workOrders.map(w => w.id),
      ...this.state.scheduledJobs.map(j => j.woId).filter(Boolean)
    ]);
    // Parent WO id -> direct/indirect child WO ids (child startsWith parent + '-').
    // Two variants matching the two scopes the original per-row code used:
    // "All" = across backlog + scheduled (allWoIdsSet); "Scheduled" = scheduled jobs only.
    const buildChildrenMap = (idsArr) => {
      const map = new Map(idsArr.map(id => [id, []]));
      idsArr.forEach(childId => {
        idsArr.forEach(parentId => {
          if (parentId !== childId && childId.startsWith(parentId + '-')) {
            map.get(parentId).push(childId);
          }
        });
      });
      return map;
    };
    const distinctWoIdsArr = Array.from(allWoIdsSet);
    const childrenOfWoIdAll = buildChildrenMap(distinctWoIdsArr);
    const distinctScheduledWoIdsArr = Array.from(jobsByWoId.keys());
    const childrenOfWoIdScheduled = buildChildrenMap(distinctScheduledWoIdsArr);
    // Direct-parent lookup matching the original lastIndexOf('-') based isParent check
    // (only the LAST hyphen segment denotes a direct child, not any-level descendant).
    const directParentIdsAll = new Set();
    // Same, but only counting a "-<digits>" numeric suffix as a child (matches the
    // /^(.*)-(\d+)$/ regex used by the per-card "is this a parent part" check).
    const directParentIdsNumericAll = new Set();
    distinctWoIdsArr.forEach(id => {
      const lastDash = id.lastIndexOf('-');
      if (lastDash > 0) directParentIdsAll.add(id.substring(0, lastDash));
      const m = id.match(/^(.*)-(\d+)$/);
      if (m) directParentIdsNumericAll.add(m[1]);
    });
    const getJobsForWo = (woId) => jobsByWoId.get(woId) || [];
    const getJobsForWoFamily = (woId) => {
      // jobs whose woId === woId, or whose woId is a descendant ("woId-...")
      const own = jobsByWoId.get(woId) || [];
      const kids = childrenOfWoIdScheduled.get(woId) || [];
      if (kids.length === 0) return own;
      const kidJobs = kids.flatMap(cid => jobsByWoId.get(cid) || []);
      return own.concat(kidJobs);
    };

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

    // Update the board date range display span right after Go to Now button (Reflects Gantt Chart Plan Start & End)
    const boardRangeEl = document.getElementById('board-date-range-display');
    if (boardRangeEl) {
      const scheduledJobs = (this.state.scheduledJobs || []).filter(job => {
        return isJobPriorityVisible(job, this.state) && isJobProjectVisible(job, this.state) && this.state.activeWorkCenters[job.machine] !== false && typeof job.startHour === 'number' && !isNaN(job.startHour);
      });
      let startObj, endObj, lastTaskInfo = '';
      if (scheduledJobs.length > 0) {
        let minStart = Infinity;
        let maxFinish = -Infinity;
        let lastJob = null;
        scheduledJobs.forEach(j => {
          const est = (typeof j.estHours === 'number' && j.estHours > 0) ? j.estHours : 1.0;
          const finish = j.startHour + est;
          if (j.startHour < minStart) minStart = j.startHour;
          if (finish > maxFinish) {
            maxFinish = finish;
            lastJob = j;
          }
        });
        startObj = this.state.workingHourToDate(minStart);
        endObj = this.state.workingHourToDate(maxFinish);
        if (lastJob) {
          lastTaskInfo = ` [Last Task: ${lastJob.woId || lastJob.id} - ${lastJob.stepName || lastJob.name || lastJob.partName || ''} (${this.state.getMachineDisplayName(lastJob.machine)})]`;
        }
      } else {
        startObj = this.state.workingHourToDate(config.startOffset);
        endObj = this.state.workingHourToDate(config.startOffset + config.totalHours);
      }
      
      const formatFullDateTime = (dateObj) => {
        const d = dateObj.getDate().toString().padStart(2, '0');
        const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const y = dateObj.getFullYear();
        const hh = dateObj.getHours().toString().padStart(2, '0');
        const mm = dateObj.getMinutes().toString().padStart(2, '0');
        return `${d}/${m}/${y} ${hh}:${mm}`;
      };

      const startDayMidnight = new Date(startObj.getFullYear(), startObj.getMonth(), startObj.getDate());
      const endDayMidnight = new Date(endObj.getFullYear(), endObj.getMonth(), endObj.getDate());
      const productionDays = Math.max(1, Math.round((endDayMidnight - startDayMidnight) / (1000 * 60 * 60 * 24)) + 1);

      boardRangeEl.textContent = `Production Time: ${formatFullDateTime(startObj)} - ${formatFullDateTime(endObj)} (${productionDays} วัน)`;
      if (scheduledJobs.length > 0) {
        boardRangeEl.setAttribute('title', `ช่วงเวลาทำงานตามแผน Gantt Chart: ${formatFullDateTime(startObj)} ถึง ${formatFullDateTime(endObj)} (รวม ${productionDays} วัน)${lastTaskInfo}`);
      }
    }

    // Update row header column title dynamically
    const headerEl = document.getElementById('row-label-header');
    if (headerEl) {
      if (scale === 'hr') {
        headerEl.textContent = 'เวลา';
      } else {
        if (this.state.ganttMode === 'pd') {
          headerEl.textContent = 'PRODUCTION ORDER';
        } else if (this.state.ganttMode === 'assembly') {
          headerEl.textContent = 'ASSEMBLY SET';
        } else {
          headerEl.textContent = 'WORK CENTER';
        }
      }
    }

    // Redraw timeline ruler headers dynamically
    this.rulerHours.innerHTML = '';
    this.rulerHours.style.gridTemplateColumns = `repeat(${config.ticks.length - (scale === 'hr' ? 1 : 0)}, 1fr)`;
    
    if (scale === 'hr') {
      const start = workingHourToDate(this.state.timelineOffset || 0.0);
      const dateStr = `${start.getDate().toString().padStart(2, '0')}/${(start.getMonth() + 1).toString().padStart(2, '0')}/${start.getFullYear()}`;
      
      config.ticks.slice(0, -1).forEach(tick => {
        const span = document.createElement('span');
        span.textContent = `${tick} (${dateStr})`;
        this.rulerHours.appendChild(span);
      });
      const span = document.createElement('span');
      span.textContent = `20:00 (${dateStr})`;
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

    const isPdMode = this.state.ganttMode === 'pd';
    const isAssemblyMode = this.state.ganttMode === 'assembly';

    if (this.ganttBoard) {
      this.ganttBoard.classList.toggle('mode-assembly', isAssemblyMode);
    }

    if (isPdMode || isAssemblyMode) {
      // Group by Production Order
      let scheduledWoIds = distinctScheduledWoIdsArr.slice().sort();

      // Calculate Priority weights for PDs (used for highlighting in PD mode)
      const pdPriorityMap = {};
      scheduledWoIds.forEach(woId => {
        const woJobs = getJobsForWo(woId);
        const backlogWO = backlogWoById.get(woId);
        const p = backlogWO?.priority || woJobs[0]?.priority || 'Normal';
        pdPriorityMap[woId] = getPriorityWeight(p);
      });

      const uniquePriorityWeights = Array.from(new Set(Object.values(pdPriorityMap))).sort((a, b) => a - b);
      const minPriorityWeight = uniquePriorityWeights.length > 0 ? uniquePriorityWeights[0] : null;
      const secondPriorityWeight = uniquePriorityWeights.length > 1 ? uniquePriorityWeights[1] : null;

      if (isAssemblyMode) {
        // Automatically link assembly relationships
        if (this.state.autoLinkAssemblies) {
          this.state.autoLinkAssemblies();
        }

        const isAssyKeyword = (str) => /assy|ass'y|assm|assembly|ชุดประกอบ|เชื่อมประกอบ/i.test(str || '');
        const isAssyMachine = (m) => {
          const ml = (m || '').toLowerCase();
          return ml.startsWith('dec') || ml.includes('assy') || ml.includes('assembly') || ml.includes('ประกอบ') || ml.includes('weld') || ml.includes('เชื่อม');
        };

        // Filter to show all Main Assemblies, Sub-Assemblies, and Child Parts
        scheduledWoIds = scheduledWoIds.filter(woId => {
          const woJobs = getJobsForWo(woId);
          const backlogWO = backlogWoById.get(woId);
          const partName = woJobs[0]?.partName || backlogWO?.partName || '';

          if (isAssyKeyword(partName) || isAssyKeyword(woId)) return true;
          if (woJobs.some(j => isAssyMachine(j.machine) || isAssyKeyword(j.stepName)) || (backlogWO && backlogWO.steps.some(s => isAssyMachine(s.machine) || isAssyKeyword(s.name)))) return true;

          // Check if it is a Parent or a Child in an assembly hierarchy
          const hasChildren = (childrenOfWoIdScheduled.get(woId) || []).length > 0;
          const isChild = woId.includes('-');
          const hasLink = (this.state.assemblyLinks || []).some(l => l.from.startsWith(woId + '-') || l.to.startsWith(woId + '-'));

          return hasChildren || isChild || hasLink;
        });

        // Hierarchical tree sorting (Main Assembly -> Sub-Assembly -> Child Parts)
        scheduledWoIds.sort((a, b) => {
          const aParts = a.split('-');
          const bParts = b.split('-');
          const aBase = aParts[0];
          const bBase = bParts[0];
          if (aBase !== bBase) return aBase.localeCompare(bBase);

          for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
            const numA = parseInt(aParts[i], 10);
            const numB = parseInt(bParts[i], 10);
            if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
              return numA - numB;
            }
            if (aParts[i] !== bParts[i]) {
              return aParts[i].localeCompare(bParts[i]);
            }
          }
          return aParts.length - bParts.length;
        });
      }

      scheduledWoIds.forEach(woId => {
        // Skip child rows if their parent is collapsed
        let isChildOfCollapsedParent = false;
        this.collapsedParents.forEach(parentWoId => {
          if (woId.startsWith(parentWoId + '-')) {
            isChildOfCollapsedParent = true;
          }
        });
        if (isChildOfCollapsedParent) return;

        // Check if this woId is a Parent
        const allWoIds = allWoIdsSet;
        const isParent = directParentIdsAll.has(woId);

        const woJobs = getJobsForWo(woId).filter(j => {
          return isJobPriorityVisible(j, this.state) && isJobProjectVisible(j, this.state) && this.state.activeWorkCenters[j.machine] !== false;
        });

        if (woJobs.length === 0) return;

        const row = document.createElement('div');
        row.className = 'gantt-row';
        let maxFinishHour = 0;
        const positiveDurationJobs = woJobs.filter(job => job.estHours > 0);
        const jobsForFinish = positiveDurationJobs.length > 0 ? positiveDurationJobs : woJobs;
        jobsForFinish.forEach(job => {
          const finish = job.startHour + job.estHours;
          if (finish > maxFinishHour) {
            maxFinishHour = finish;
          }
        });
        let finDateStr = '-';
        let finDateShort = '-';
        if (maxFinishHour > 0) {
          const d = workingHourToDate(maxFinishHour);
          const day = d.getDate().toString().padStart(2, '0');
          const m = (d.getMonth() + 1).toString().padStart(2, '0');
          const y = d.getFullYear();
          const hh = d.getHours().toString().padStart(2, '0');
          const mm = d.getMinutes().toString().padStart(2, '0');
          finDateStr = `${day}/${m}/${y} ${hh}:${mm}`;
          finDateShort = `${d.getDate()}/${d.getMonth() + 1}`;
        }
        const partName = woJobs[0]?.partName || '';
        const project = woJobs[0]?.project || '';

        const labelIndicator = isParent ? (this.collapsedParents.has(woId) ? '⊞ ' : '⊟ ') : '';

        let labelBgStyle = '';
        let nameColor = 'var(--accent-teal)';
        let partColor = 'inherit';
        let projColor = 'var(--text-secondary)';
        let finColor = 'var(--accent-green)';
        const isChild = woId.includes('-');
        const currentPdWeight = pdPriorityMap[woId];

        if (isAssemblyMode) {
          // Tree depth styling for Assembly Set tab
          const depth = (woId.match(/-/g) || []).length;
          if (depth === 0) {
            // Main Assembly (ชุดประกอบหลัก)
            labelBgStyle = 'cursor: pointer; background: linear-gradient(135deg, #1e293b, #0f172a) !important; border-left: 4px solid var(--accent-teal);';
            nameColor = 'var(--accent-teal)';
            partColor = '#e2e8f0';
          } else if (isParent) {
            // Sub-Assembly (ชุดประกอบย่อย)
            labelBgStyle = 'cursor: pointer; background: linear-gradient(135deg, #1e1b4b, #0f172a) !important; border-left: 4px solid var(--accent-purple); padding-left: 14px !important;';
            nameColor = '#c084fc';
            partColor = '#cbd5e1';
          } else {
            // Child Part (ชิ้นส่วนลูก)
            labelBgStyle = 'cursor: pointer; background: #0b1120 !important; border-left: 2px solid var(--border-glass); padding-left: 20px !important;';
            nameColor = '#94a3b8';
            partColor = '#64748b';
          }
        } else if (isPdMode && minPriorityWeight !== null && currentPdWeight === minPriorityWeight) {
          // Rank 1: Lowest Priority number (Most Urgent) -> Red
          labelBgStyle = 'cursor: pointer; background-color: #dc2626 !important; color: #ffffff !important; box-shadow: inset 0 0 10px rgba(0,0,0,0.25);';
          nameColor = '#ffffff';
          partColor = '#fee2e2';
          projColor = '#fef2f2';
          finColor = '#bbf7d0';
        } else if (isPdMode && secondPriorityWeight !== null && currentPdWeight === secondPriorityWeight) {
          // Rank 2: Next higher Priority level -> Light Pink (ชมพูอ่อน)
          labelBgStyle = 'cursor: pointer; background-color: #f472b6 !important; color: #0f172a !important; box-shadow: inset 0 0 8px rgba(0,0,0,0.15);';
          nameColor = '#0f172a';
          partColor = '#1e293b';
          projColor = '#334155';
          finColor = '#15803d';
        } else if (isParent) {
          labelBgStyle = 'cursor: pointer; background-color: #828e94 !important; color: #0f172a !important;';
          nameColor = '#0f172a';
          partColor = '#1e293b';
          projColor = '#334155';
          finColor = '#166534';
        } else if (isChild) {
          labelBgStyle = 'cursor: pointer; background-color: #b3b4ae !important; color: #0f172a !important;';
          nameColor = '#0f172a';
          partColor = '#1e293b';
          projColor = '#334155';
          finColor = '#166534';
        }

        let assemblyLabelHtml = '';
        let assemblyChildStatsHtml = '';

        const isAssyStepObj = (s) => {
          if (!s) return false;
          const m = (s.machine || '').toLowerCase();
          const n = (s.stepName || s.name || '').toLowerCase();
          return m.startsWith('dec') || m.includes('assy') || m.includes('assembly') || m.includes('ประกอบ') || m.includes('weld') || n.includes('assy') || n.includes('ประกอบ') || n.includes('weld');
        };

        const assemblyJob = woJobs.find(isAssyStepObj);

        if (isAssemblyMode && isParent) {
          // Find all descendant children of this parent (both direct and multi-level)
          const allDescendantWoIds = childrenOfWoIdAll.get(woId) || [];
          const totalChildWOs = allDescendantWoIds.length;
          
          let completedChildWOs = 0;
          let runningChildWOs = 0;
          let queuedChildWOs = 0;
          const pendingChildList = [];

          allDescendantWoIds.forEach(cId => {
            const cJobs = getJobsForWo(cId);
            const cBacklog = backlogWoById.get(cId);
            const totalSteps = cJobs.length + (cBacklog ? cBacklog.steps.length : 0);
            const compSteps = cJobs.filter(j => j.status === 'Completed').length;
            const isRun = cJobs.some(j => j.status === 'Running' || j.status === 'Setup');

            if (totalSteps > 0 && compSteps === totalSteps) {
              completedChildWOs++;
            } else if (isRun) {
              runningChildWOs++;
              pendingChildList.push(`${cId} (⚡ผลิต)`);
            } else {
              queuedChildWOs++;
              pendingChildList.push(`${cId} (⏳รอ)`);
            }
          });

          const pct = totalChildWOs > 0 ? Math.round((completedChildWOs / totalChildWOs) * 100) : 0;
          const runPct = totalChildWOs > 0 ? Math.round((runningChildWOs / totalChildWOs) * 100) : 0;
          const statusColor = pct === 100 ? '#22c55e' : (runningChildWOs > 0 ? '#eab308' : '#0ea5e9');

          const icon = (woId.match(/-/g) || []).length === 0 ? '📦' : '⚙️';
          assemblyLabelHtml = `<span class="gantt-row-assembly-badge btn-open-assembly-modal" data-wo-id="${woId}" style="font-size: 10px; font-weight: bold; color: ${statusColor}; margin-left: auto; cursor: pointer; padding: 2px 5px; border-radius: 4px; background: rgba(0,0,0,0.35); border: 1px solid var(--border-glass);" title="คลิกดูผังรายการลูกทั้งหมด">${icon} ${completedChildWOs}/${totalChildWOs} (${pct}%)</span>`;

          const pendingText = pendingChildList.length > 0 ? `รอ: ${pendingChildList.slice(0, 3).join(', ')}${pendingChildList.length > 3 ? ` +${pendingChildList.length - 3}` : ''}` : 'พร้อมประกอบครบ 100%';

          assemblyChildStatsHtml = `
            <div class="assembly-child-summary-bar" style="margin-top: 3px; padding: 3px 5px; background: rgba(0,0,0,0.3); border-radius: 4px; border: 1px solid rgba(255,255,255,0.08); font-size: 8.5px;">
              <div style="display: flex; justify-content: space-between; color: ${statusColor}; font-weight: 600;">
                <span>ลูกทั้งหมด: ${totalChildWOs} ชิ้น</span>
                <span>✅ ${completedChildWOs} | ⚡ ${runningChildWOs} | ⏳ ${queuedChildWOs}</span>
              </div>
              <div style="height: 3px; width: 100%; background: rgba(255,255,255,0.1); border-radius: 2px; margin: 2px 0; overflow: hidden; display: flex;">
                <div style="width: ${pct}%; background: #22c55e;" title="เสร็จ ${pct}%"></div>
                <div style="width: ${runPct}%; background: #eab308;" title="กำลังผลิต ${runPct}%"></div>
              </div>
              <div style="color: ${pct === 100 ? '#22c55e' : 'var(--text-secondary)'}; font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${pendingChildList.join(', ')}">${pendingText}</div>
            </div>
          `;
        } else if (assemblyJob) {
          const targetStepId = assemblyJob.id;
          const links = this.state.assemblyLinks || [];
          const linkedJobs = links.filter(link => link.to === targetStepId || link.to.startsWith(woId + '-'));
          const totalAll = linkedJobs.length;
          const totalComplete = linkedJobs.filter(link => {
            const srcJob = jobById.get(link.from);
            return srcJob && srcJob.status === 'Completed';
          }).length;
          
          const isReady = (totalAll > 0 && totalComplete === totalAll);
          const color = isReady ? '#22c55e' : (totalAll > 0 ? '#ef4444' : '#0ea5e9');
          const labelPrefix = (woId.match(/-/g) || []).length === 0 ? '📦' : '⚙️';
          assemblyLabelHtml = `<span class="gantt-row-assembly-badge" style="font-size: 10px; font-weight: bold; color: ${color}; margin-left: auto;" title="Assembly Parts Ready / Total (ชิ้นงานประกอบเสร็จ / ทั้งหมด)">${labelPrefix} ${totalComplete}/${totalAll}</span>`;
        } else {
          // PD without Assembly: count completed steps / all steps
          const backlogWO = backlogWoById.get(woId);
          const backlogStepsCount = backlogWO ? backlogWO.steps.length : 0;
          const totalSteps = woJobs.length + backlogStepsCount;
          const completedSteps = woJobs.filter(j => j.status === 'Completed').length;
          
          if (totalSteps > 0) {
            const isAllComplete = (completedSteps === totalSteps);
            if (isAllComplete) {
              const badgeColor = (isPdMode && currentPdWeight === minPriorityWeight) ? '#ffffff' : ((isPdMode && currentPdWeight === secondPriorityWeight) ? '#15803d' : '#166534');
              assemblyLabelHtml = `<span class="gantt-row-steps-badge" style="font-size: 10px; font-weight: bold; color: ${badgeColor}; animation: pulse-flash 1s infinite alternate; margin-left: auto;" title="All Steps Completed (เสร็จสิ้นทุกขั้นตอน)">${completedSteps}/${totalSteps}</span>`;
            } else {
              const badgeColor = (isPdMode && currentPdWeight === minPriorityWeight) ? '#ffffff' : ((isPdMode && currentPdWeight === secondPriorityWeight) ? '#831843' : '#c084fc');
              assemblyLabelHtml = `<span class="gantt-row-steps-badge" style="font-size: 10px; font-weight: bold; color: ${badgeColor}; margin-left: auto;" title="Steps Completed / Total (เสร็จแล้ว / ทั้งหมด)">${completedSteps}/${totalSteps}</span>`;
            }
          }
        }

        const labelIndicatorHtml = isParent 
          ? `<span class="pd-collapse-toggle" style="cursor: pointer; padding: 0 4px 0 0; font-weight: bold; font-family: monospace; user-select: none; font-size: 11px;" title="${this.collapsedParents.has(woId) ? 'คลิกเพื่อกางออก (Expand)' : 'คลิกเพื่อยุบ (Collapse)'}">${this.collapsedParents.has(woId) ? '⊞' : '⊟'}</span>`
          : '';

        let treePrefix = '';
        let itemIcon = '📄';
        let itemTypeTag = '';
        let tagStyle = '';

        if (isAssemblyMode) {
          const depth = (woId.match(/-/g) || []).length;
          if (depth === 0) {
            // Main Assembly
            treePrefix = '';
            itemIcon = '📦';
            itemTypeTag = '[Main Assembly]';
            tagStyle = 'background: rgba(2, 132, 199, 0.25); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);';
          } else if (isParent) {
            // Sub-Assembly
            treePrefix = depth === 1 ? '├── ' : '│   ├── ';
            itemIcon = '⚙️';
            itemTypeTag = '[Sub-Assembly]';
            tagStyle = 'background: rgba(192, 132, 252, 0.25); color: #c084fc; border: 1px solid rgba(192, 132, 252, 0.4);';
          } else {
            // Child Part
            treePrefix = depth === 1 ? '├── ' : '│   └── ';
            itemIcon = '📄';
            itemTypeTag = '[Child Part]';
            tagStyle = 'background: rgba(255, 255, 255, 0.08); color: #94a3b8; border: 1px solid var(--border-glass);';
          }
        }

        const isProjLocked = this.state.isProjectLocked(project);
        const lockBadge = isProjLocked ? '<span style="margin-left: 4px; font-size: 10px;" title="โครงการนี้ถูกล็อคแผนงานไว้ (Locked Project)">🔒</span>' : '';

        if (isAssemblyMode) {
          row.innerHTML = `
            <div class="gantt-row-label" style="display: flex; flex-direction: column; justify-content: center; padding: 4px 10px; min-height: 52px; cursor: pointer; ${labelBgStyle}" title="คลิกเพื่อแก้ไขข้อมูล Production Order: ${woId}">
              <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 6px;">
                <div style="display: flex; align-items: center; gap: 4px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; flex: 1;">
                  ${labelIndicatorHtml}
                  <span style="font-family: monospace; opacity: 0.9; color: var(--text-secondary); font-size: 11px; font-weight: bold;">${treePrefix}</span>
                  <span style="font-size: 13px; margin-right: 2px;">${itemIcon}</span>
                  <strong style="font-size: 11.5px; color: ${nameColor}; letter-spacing: 0.2px;">${woId}</strong>
                  <span style="font-size: 10px; color: ${partColor}; opacity: 0.85; margin-left: 2px; overflow: hidden; text-overflow: ellipsis;" title="${partName}">(${partName})</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                  <span style="font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 4px; ${tagStyle}">${itemTypeTag}</span>
                  ${assemblyLabelHtml}
                </div>
              </div>
              ${assemblyChildStatsHtml}
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px; font-size: 8px;">
                ${project ? `<span style="color: ${projColor}; opacity: 0.9; display: flex; align-items: center;" title="Project: ${project}">Proj: ${project}${lockBadge}</span>` : '<span></span>'}
                <span style="color: ${finColor}; font-weight: bold;">เสร็จ: ${finDateStr}</span>
              </div>
            </div>
            <div class="gantt-row-track" data-wo-id="${woId}"></div>
          `;
        } else {
          row.innerHTML = `
            <div class="gantt-row-label" style="display: flex; flex-direction: column; justify-content: center; padding: 4px 8px; min-height: 38px; cursor: pointer; ${labelBgStyle}" title="คลิกเพื่อแก้ไขข้อมูล Production Order: ${woId} | Finish: ${finDateStr}">
              <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span class="gantt-row-name" style="font-weight: bold; color: ${nameColor}; display: flex; align-items: center; gap: 5px; font-size: 11px; overflow: hidden;">
                  ${labelIndicatorHtml}
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${woId}</span>
                  <span style="font-size: 9px; font-weight: 700; color: ${finColor}; opacity: 0.9; flex-shrink: 0;" title="Finish: ${finDateStr}">${finDateShort}</span>
                </span>
                ${assemblyLabelHtml}
              </div>
              <span style="font-size: 8px; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; color: ${partColor};" title="${partName}${project ? ` (Proj: ${project})` : ''}">${partName}${lockBadge}</span>
            </div>
            <div class="gantt-row-track" data-wo-id="${woId}"></div>
          `;
        }

        const label = row.querySelector('.gantt-row-label');
        const collapseBtn = label.querySelector('.pd-collapse-toggle');
        if (collapseBtn) {
          collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.collapsedParents.has(woId)) {
              this.collapsedParents.delete(woId);
            } else {
              this.collapsedParents.add(woId);
            }
            const familyJobs = this.state.scheduledJobs.filter(j => j.woId === woId || (j.woId && j.woId.startsWith(woId + '-')));
            this.fitTasks(familyJobs);
          });
        }

        const openModalBtn = label.querySelector('.btn-open-assembly-modal');
        if (openModalBtn) {
          openModalBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showAssemblyStatusModalForWo(woId);
          });
        }

        label.addEventListener('click', (e) => {
          if (e.target.closest('.pd-collapse-toggle')) return;
          this.showPDPlanModal(woId);
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
          
          // Enforce no scheduling in the past
          const nowHour = this.state.dateToWorkingHour(new Date());
          hour = Math.max(nowHour, hour);
          
          // Find step to get duration and machine
          let duration = 2.0;
          let targetMachine = null;
          
          const isEntireOrder = (stepId.startsWith('PD') && !stepId.includes('-')) || 
                                (stepId.startsWith('WO') && stepId.split('-').length === 2);

          if (isEntireOrder) {
            // Dragged entire order label
            const orderJobs = this.state.scheduledJobs.filter(j => j.woId === stepId);
            if (orderJobs.length > 0) {
              if (this.state.isJobLocked(orderJobs[0])) {
                this.showToast(`🔒 โครงการ "${orderJobs[0].project || 'General'}" ถูกล็อคแผนไว้ ไม่สามารถขยับได้`);
                return;
              }
              const minStart = Math.min(...orderJobs.map(j => j.startHour));
              const delta = hour - minStart;
              
              // Ensure no job starts in the past
              let finalDelta = delta;
              const earliestStart = minStart + delta;
              if (earliestStart < nowHour) {
                finalDelta = nowHour - minStart;
              }

              orderJobs.forEach(j => {
                this.state.updateJobStartHour(j.id, j.startHour + finalDelta);
              });
            }
          } else {
            const job = this.state.scheduledJobs.find(j => j.id === stepId);
            if (job) {
              if (this.state.isJobLocked(job)) {
                this.showToast(`🔒 โครงการ "${job.project || 'General'}" ถูกล็อคแผนไว้ ไม่สามารถขยับได้`);
                return;
              }
              this.state.updateJobStartHour(job.id, hour);
            }
          }
        });

        // Check if this woId is collapsed parent
        const isCollapsedRollup = isParent && this.collapsedParents.has(woId);

        if (isCollapsedRollup) {
          // Render a single collapsed rollup bar representing the duration of the entire family
          const familyWoIds = [woId, ...(childrenOfWoIdAll.get(woId) || [])];
          const familyJobs = familyWoIds.flatMap(id => getJobsForWo(id));
          
          let minStart = Infinity;
          let maxFinish = 0;
          
          familyJobs.forEach(j => {
            if (j.startHour < minStart) minStart = j.startHour;
            const finish = j.startHour + j.estHours;
            if (finish > maxFinish) {
              maxFinish = finish;
            }
          });

          if (minStart !== Infinity && maxFinish > minStart) {
            const card = document.createElement('div');
            card.className = 'gantt-card collapsed-rollup';
            
            const start = Math.max(config.startOffset, minStart);
            const end = Math.min(config.startOffset + config.totalHours, maxFinish);
            const width = end - start;

            const leftPercent = ((start - config.startOffset) / config.totalHours) * 100;
            const widthPercent = (width / config.totalHours) * 100;

            card.style.left = `${leftPercent}%`;
            card.style.width = `${widthPercent}%`;
            card.style.cursor = 'pointer';

            card.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #fff;">
                Parent Rollup (${woId}) • เสร็จ: ${finDateStr}
              </div>
            `;
            
            // Click to toggle collapse back
            card.addEventListener('click', () => {
              this.collapsedParents.delete(woId);
              this.state.notify();
            });

            track.appendChild(card);
          }
        } else {
          // Render normal job cards on timeline for this WO
          woJobs.forEach(job => {
            const jobEnd = job.startHour + job.estHours;
            const timelineEnd = config.startOffset + config.totalHours;
            
            if (job.startHour < timelineEnd && jobEnd > config.startOffset) {
              const card = document.createElement('div');
              
              // 1. Detect sequence routing overlaps (Sequence Warning)
              let isSeqError = false;
              let isParentChildViolation = false;
              if (job.woId && this.state.schedulingModel !== 'finite') {
                const sisterSteps = getJobsForWo(job.woId).filter(j => j.id !== job.id);
                sisterSteps.forEach(sister => {
                  if (sister.stepNum < job.stepNum) {
                    const leadDays = (sister.machine && this.state.workCenters[sister.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[sister.machine].leadTimeDays) : 0;
                    const leadHours = leadDays * 8.0;
                    const transferMins = (sister.machine && this.state.workCenters[sister.machine]?.transferMinutes !== undefined) ? parseFloat(this.state.workCenters[sister.machine].transferMinutes) : 10.0;
                    const moveBuffer = (sister.machine !== job.machine) ? (transferMins / 60.0) : 0.0;
                    if ((sister.startHour + sister.estHours + leadHours + moveBuffer) > (job.startHour + 0.01)) {
                      isSeqError = true;
                    }
                  }
                  if (sister.stepNum > job.stepNum) {
                    const leadDays = (job.machine && this.state.workCenters[job.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[job.machine].leadTimeDays) : 0;
                    const leadHours = leadDays * 8.0;
                    const transferMins = (job.machine && this.state.workCenters[job.machine]?.transferMinutes !== undefined) ? parseFloat(this.state.workCenters[job.machine].transferMinutes) : 10.0;
                    const moveBuffer = (job.machine !== sister.machine) ? (transferMins / 60.0) : 0.0;
                    if ((jobEnd + leadHours + moveBuffer) > (sister.startHour + 0.01)) {
                      isSeqError = true;
                    }
                  }
                });

                // Parent-Child violation check
                const isChild = job.woId.includes('-');
                if (isChild) {
                  const parentWoId = job.woId.split('-')[0];
                  const parentSteps = getJobsForWo(parentWoId);
                  const parentFirstStep = [...parentSteps].sort((a, b) => a.stepNum - b.stepNum)[0];
                  if (parentFirstStep) {
                    const childLeadDays = (job.machine && this.state.workCenters[job.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[job.machine].leadTimeDays) : 0;
                    const childLeadHours = childLeadDays * 8.0;
                    const transferMins = (job.machine && this.state.workCenters[job.machine]?.transferMinutes !== undefined) ? parseFloat(this.state.workCenters[job.machine].transferMinutes) : 10.0;
                    const moveBuffer = (job.machine !== parentFirstStep.machine) ? (transferMins / 60.0) : 0.0;
                    if ((jobEnd + childLeadHours + moveBuffer) > (parentFirstStep.startHour + 0.01)) {
                      isParentChildViolation = true;
                    }
                  }
                } else {
                  const parentWoId = job.woId;
                  const childWoIds = childrenOfWoIdScheduled.get(parentWoId) || [];
                  childWoIds.forEach(childId => {
                    const childSteps = getJobsForWo(childId);
                    const childLastStep = [...childSteps].sort((a, b) => b.stepNum - a.stepNum)[0];
                    if (childLastStep) {
                      const childLeadDays = (childLastStep.machine && this.state.workCenters[childLastStep.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[childLastStep.machine].leadTimeDays) : 0;
                      const childLeadHours = childLeadDays * 8.0;
                      const transferMins = (childLastStep.machine && this.state.workCenters[childLastStep.machine]?.transferMinutes !== undefined) ? parseFloat(this.state.workCenters[childLastStep.machine].transferMinutes) : 10.0;
                      const moveBuffer = (childLastStep.machine !== job.machine) ? (transferMins / 60.0) : 0.0;
                      if ((childLastStep.startHour + childLastStep.estHours + childLeadHours + moveBuffer) > (job.startHour + 0.01)) {
                        isParentChildViolation = true;
                      }
                    }
                  });
                }
              }

              const hasAlert = isSeqError || isParentChildViolation;
              const alertClass = hasAlert ? 'pulse-alert' : '';

              const jobPriority = String(job.priority || (backlogWO ? backlogWO.priority : '') || 'Normal').trim();
              const customPriorityColor = this.state.priorityColors ? this.state.priorityColors[jobPriority] : null;
              const customProjectColor = this.state.projectColors ? this.state.projectColors[job.project || 'General'] : null;
              const customCardColor = customPriorityColor || customProjectColor;

              let cardBg = 'linear-gradient(135deg, #1e293b, #0f172a)'; // default dark gradient
              let borderStyle = '1px solid var(--border-glass)';
              const isRunning = job.status === 'Running';

              if (job.status === 'Completed') {
                cardBg = 'linear-gradient(135deg, #15803d, #166534)';
                borderStyle = '1.5px solid #22c55e';
              } else if (job.status === 'Setup') {
                cardBg = 'linear-gradient(135deg, #0369a1, #075985)';
                borderStyle = '1.5px solid #38bdf8';
              } else if (job.status === 'Paused') {
                cardBg = 'linear-gradient(135deg, #b91c1c, #991b1b)';
                borderStyle = '1.5px solid #f87171';
              } else if (customCardColor) {
                cardBg = `linear-gradient(135deg, ${customCardColor}, ${customCardColor})`;
                borderStyle = `1.5px solid ${customCardColor}`;
              }

              card.className = `gantt-card ${alertClass} ${isRunning ? 'running' : ''}`;
              // Work Center is Active (Running): let the shared .gantt-card.running CSS
              // animation (flashing yellow) drive the look instead of a static inline color.
              if (!isRunning) {
                card.style.background = cardBg;
                card.style.border = borderStyle;
              }

              const start = Math.max(config.startOffset, job.startHour);
              const end = Math.min(config.startOffset + config.totalHours, jobEnd);
              const width = end - start;

              const leftPercent = ((start - config.startOffset) / config.totalHours) * 100;
              const widthPercent = (width / config.totalHours) * 100;

              card.style.left = `${leftPercent}%`;
              card.style.width = `${widthPercent}%`;
              card.setAttribute('draggable', job.status !== 'Completed' ? 'true' : 'false');
              card.setAttribute('data-id', job.id);
              card.setAttribute('data-job-id', job.id);
              card.setAttribute('data-wo-id', job.woId || job.id);

              // Tooltip and info
              const formatCalendarTime = (hourFloat) => {
                const d = workingHourToDate(hourFloat);
                const day = d.getDate().toString().padStart(2, '0');
                const m = (d.getMonth() + 1).toString().padStart(2, '0');
                const y = d.getFullYear();
                const hh = d.getHours().toString().padStart(2, '0');
                const mm = d.getMinutes().toString().padStart(2, '0');
                return `${day}/${m}/${y} ${hh}:${mm}`;
              };

              const isOffloadedJob = Boolean(job.isOffloaded || (job.originalMachine && job.originalMachine !== job.machine));

              const startStr = formatCalendarTime(job.startHour);
              const endStr = formatCalendarTime(jobEnd);
              const setupText = job.setupMinutes ? ` | Setup: ${job.setupMinutes}m` : '';
              const cycleText = job.cycleMinutes ? ` | Cycle: ${job.cycleMinutes}m/pc` : '';
              const offloadText = isOffloadedJob ? ` | [OFFLOAD] ย้ายจาก ${this.state.getMachineDisplayName(job.originalMachine)} มาช่วยที่ ${this.state.getMachineDisplayName(job.machine)}` : '';
              const tooltip = `Start: ${startStr} | Finish: ${endStr}${setupText}${cycleText}${offloadText}`;
              card.setAttribute('title', tooltip);

              const isJobLocked = this.state.isJobLocked(job);

              // woId/progress/finish are already shown on the row label to the left and
              // in the tooltip, so the bar itself shows only the machine's name (no code prefix).
              const cardMachineName = this.state.workCenters[job.machine]?.name || this.state.getMachineDisplayName(job.machine);
              card.innerHTML = `
                <div style="padding: 4px 6px; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                  <span style="font-weight: 800; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #ffffff;" title="${this.state.getMachineDisplayName(job.machine)}">${cardMachineName}</span>
                </div>
              `;

              // Handle double click to edit
              card.addEventListener('dblclick', () => {
                if (this.onCardEdit) this.onCardEdit(job);
              });

              if (isAssemblyMode) {
                card.addEventListener('click', (e) => {
                  e.stopPropagation();
                  this.showAssemblyStatusModalForWo(woId);
                });
              }

              // Custom dragging restriction and tooltip toast
              if (job.status === 'Completed' || isJobLocked) {
                card.style.cursor = 'not-allowed';
                card.addEventListener('dragstart', (e) => {
                  e.preventDefault();
                  if (job.status === 'Completed') {
                    this.showToast('ผลิตเสร็จแล้ว ย้ายไม่ได้');
                  } else {
                    this.showToast(`🔒 โครงการ "${job.project || 'General'}" ถูกล็อคแผนไว้ ไม่สามารถขยับได้`);
                  }
                });
              } else {
                card.addEventListener('dragstart', (e) => {
                  e.dataTransfer.setData('text/plain', job.id);
                  e.dataTransfer.effectAllowed = 'move';
                  card.classList.add('dragging');
                });
                card.addEventListener('dragend', () => {
                  card.classList.remove('dragging');
                });
              }

              // Register in cardMap for drawing arrows
              cardMap[job.id] = card;

              track.appendChild(card);
            }
          });
        }

        // Highlight related parent-child cards on hover
        const cards = row.querySelectorAll('.gantt-card:not(.collapsed-rollup)');
        cards.forEach(card => {
          card.addEventListener('mouseenter', () => {
            const woId = card.getAttribute('data-wo-id');
            const isChild = woId.includes('-');
            const pWoId = isChild ? woId.split('-')[0] : woId;
            
            // Highlight parent card
            document.querySelectorAll(`.gantt-card[data-wo-id="${pWoId}"]`).forEach(c => {
              c.classList.add('parent-child-highlight');
            });
            // Highlight child cards
            document.querySelectorAll(`.gantt-card`).forEach(c => {
              const cWoId = c.getAttribute('data-wo-id');
              if (cWoId && cWoId !== pWoId && cWoId.startsWith(pWoId + '-')) {
                c.classList.add('parent-child-highlight');
              }
            });
            // Highlight relationship lines
            document.querySelectorAll('.gantt-dep-line').forEach(line => {
              const lineWoId = line.getAttribute('data-wo-id');
              const parentWoId = line.getAttribute('data-parent-wo-id');
              if (lineWoId === pWoId || parentWoId === pWoId) {
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
        });

        this.ganttGrid.appendChild(row);
      });
    } else {
      // Loop through each Work Center track in sorted order
      let order = this.state.workCenterOrder || Object.keys(this.state.workCenters);
      if (!this.state.showAllWorkCenters) {
        const usedMachines = new Set(
          this.state.scheduledJobs
            .filter(j => isJobPriorityVisible(j, this.state) && isJobProjectVisible(j, this.state))
            .map(j => j.machine)
            .filter(Boolean)
        );
        this.state.workOrders.forEach(wo => {
          wo.steps.forEach(step => {
            if (step.machine) usedMachines.add(step.machine);
          });
        });
        order = order.filter(m => usedMachines.has(m));
      }

      // Manually deselected Work Centers (Resources tab checkboxes) are always hidden
      order = order.filter(m => this.state.activeWorkCenters[m] !== false);

      // Calculate top 3 workload threshold among active/rendered ones
      const machineLoads = order.map(m => {
        const oeeData = this.state.getMachineOEE(m);
        return { machine: m, util: oeeData.util };
      });
      machineLoads.sort((a, b) => b.util - a.util);
      let top3Threshold = -1;
      if (machineLoads.length >= 3) {
        top3Threshold = machineLoads[2].util;
      } else if (machineLoads.length > 0) {
        top3Threshold = machineLoads[machineLoads.length - 1].util;
      }

      order.forEach(machineName => {
        const oeeData = this.state.getMachineOEE(machineName);
        const isTop3 = oeeData.util >= top3Threshold && oeeData.util > 0;
        const barColor = isTop3 ? 'var(--accent-red)' : 'var(--accent-teal)';
        const wcObj = this.state.workCenters[machineName];
        const workHours = (wcObj && wcObj.workHoursPerDay !== undefined) ? wcObj.workHoursPerDay : 8;

        const row = document.createElement('div');
        row.className = 'gantt-row';

        row.innerHTML = `
          <div class="gantt-row-label" draggable="true" data-machine="${machineName}" style="cursor: grab; display: flex; flex-direction: column; justify-content: center; padding: 4px 8px; min-height: 34px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="gantt-row-name" style="font-weight: bold; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary);">${this.state.getMachineDisplayName(machineName)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px;">
              <div class="gantt-row-load-bg" style="flex: 1; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;" title="Work Center Load: ${oeeData.util}%">
                <div class="gantt-row-load-fill" style="height: 100%; width: ${Math.min(100, oeeData.util)}%; background: ${barColor}; border-radius: 2px;"></div>
              </div>
              <span style="font-size: 8.5px; font-weight: bold; color: var(--accent-cyan); letter-spacing: 0.2px; flex-shrink: 0; margin-left: 6px;" title="ชั่วโมงการทำงาน: ${workHours} ชม./วัน">${workHours} h/d</span>
            </div>
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

      let clickTimeout = null;
      label.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
        } else {
          clickTimeout = setTimeout(() => {
            clickTimeout = null;
            const machineJobs = this.state.scheduledJobs.filter(j => j.machine === machineName);
            this.fitTasks(machineJobs);
          }, 250);
        }
      });

      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
        }
        
        if (this.state.dailyScheduleController) {
          const machineJobs = this.state.scheduledJobs.filter(j => j.machine === machineName);
          let initialDate = null;
          if (machineJobs.length > 0) {
            machineJobs.sort((a, b) => a.startHour - b.startHour);
            initialDate = this.state.workingHourToDate(machineJobs[0].startHour);
          } else {
            initialDate = this.state.getBaseDate();
          }
          this.state.dailyScheduleController.open(machineName, initialDate);
        } else {
          this.showWorkCenterPlanModal(machineName);
        }
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

        // Check if dragged job belongs to a locked project
        const schedStep = this.state.scheduledJobs.find(j => j.id === stepId || j.woId === stepId);
        if (schedStep && this.state.isJobLocked(schedStep)) {
          this.showToast(`🔒 โครงการ "${schedStep.project || 'General'}" ถูกล็อคแผนไว้ ไม่สามารถขยับได้`);
          return;
        }

        // Calculate hours based on X coordinate relative to track width
        const rect = track.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const percentage = offsetX / rect.width;
        
        let hour = config.startOffset + (percentage * config.totalHours);
        
        // Enforce no scheduling in the past
        const nowHour = this.state.dateToWorkingHour(new Date());
        hour = Math.max(nowHour, hour);
        
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

      // Filter jobs/steps assigned to this machine and matching selected priorities
      const machineJobs = (jobsByMachine.get(machineName) || []).filter(j => {
        return isJobPriorityVisible(j, this.state) && isJobProjectVisible(j, this.state);
      });

      // When zoomed out (day/week/month/quarter/year), adjacent same-priority jobs
      // collapse into pixel-thin slivers that visually stack on top of each other
      // anyway. Merge them into a single summary bar so far fewer DOM nodes get
      // created/laid out per pan/redraw - this is what keeps panning smooth at
      // wide time scales. Zooming below the threshold (hr and finer) renders
      // every job individually again, same as before.
      const isWideScale = config.totalHours >= 48; // day, week, month, quarter, year
      const mergedJobIds = new Set();
      const mergedGroups = [];
      if (isWideScale && machineJobs.length > 1) {
        const sortedForMerge = [...machineJobs].sort((a, b) => a.startHour - b.startHour);
        const mergeGapHours = config.totalHours * 0.01; // ~1% of the visible window
        let currentGroup = null;
        sortedForMerge.forEach(job => {
          const jobPriority = getJobPriority(job, this.state);
          const jobEndHour = job.startHour + job.estHours;
          if (currentGroup && currentGroup.priority === jobPriority && job.startHour <= currentGroup.endHour + mergeGapHours) {
            currentGroup.jobs.push(job);
            currentGroup.endHour = Math.max(currentGroup.endHour, jobEndHour);
          } else {
            currentGroup = { priority: jobPriority, startHour: job.startHour, endHour: jobEndHour, jobs: [job] };
            mergedGroups.push(currentGroup);
          }
        });
        mergedGroups.filter(g => g.jobs.length > 1).forEach(g => {
          g.jobs.forEach(j => mergedJobIds.add(j.id));
        });
      }

      mergedGroups.filter(g => g.jobs.length > 1).forEach(group => {
        const timelineEnd = config.startOffset + config.totalHours;
        if (group.startHour >= timelineEnd || group.endHour <= config.startOffset) return;

        const start = Math.max(config.startOffset, group.startHour);
        const end = Math.min(timelineEnd, group.endHour);
        const leftPercent = ((start - config.startOffset) / config.totalHours) * 100;
        const widthPercent = ((end - start) / config.totalHours) * 100;

        const customColor = this.state.priorityColors ? this.state.priorityColors[group.priority] : null;

        const card = document.createElement('div');
        // "scheduled" gives it the standard solid task-bar background/text color as a
        // fallback so it's never see-through - without it, a merged group with no
        // custom priority color had no background at all and its default white text
        // vanished against a light theme.
        card.className = 'gantt-card gantt-card-merged scheduled';
        card.style.left = `${leftPercent}%`;
        card.style.width = `${widthPercent}%`;
        card.style.cursor = 'zoom-in';
        if (customColor) {
          card.style.background = `linear-gradient(135deg, ${customColor}, ${customColor})`;
          card.style.borderColor = customColor;
          card.style.color = getReadableTextColor(customColor);
        }
        card.setAttribute('title', `Priority: ${group.priority} — ${group.jobs.length} งาน\nStart: ${this.formatTime(group.startHour, scale)} | Finish: ${this.formatTime(group.endHour, scale)}\n(คลิกเพื่อซูมเข้าดูรายละเอียด)`);
        card.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; overflow: hidden;">
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 9px; font-weight: 700;">×${group.jobs.length}</span>
          </div>
        `;
        card.addEventListener('click', (e) => {
          e.stopPropagation();
          this.fitTasks(group.jobs);
        });
        track.appendChild(card);
      });

      // Render job cards on timeline
      machineJobs.forEach(job => {
        if (mergedJobIds.has(job.id)) return;
        const jobEnd = job.startHour + job.estHours;
        const timelineEnd = config.startOffset + config.totalHours;
        
        if (job.startHour < timelineEnd && jobEnd > config.startOffset) {
          const card = document.createElement('div');
          const woId = job.woId || job.id.split('-')[0];
          
          // 1. Detect sequence routing overlaps (Sequence Warning)
          let isSeqError = false;
          let isParentChildViolation = false;
          if (job.woId && this.state.schedulingModel !== 'finite') {
            const sisterSteps = getJobsForWo(job.woId).filter(j => j.id !== job.id);
            sisterSteps.forEach(sister => {
              const moveBuffer = (sister.machine !== job.machine) ? (10.0 / 60.0) : 0.0;
              // If prior step starts after this step starts
              if (sister.stepNum < job.stepNum) {
                const leadDays = (sister.machine && this.state.workCenters[sister.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[sister.machine].leadTimeDays) : 0;
                const leadHours = leadDays * 8.0;
                if ((sister.startHour + sister.estHours + leadHours + moveBuffer) > (job.startHour + 0.01)) {
                  isSeqError = true;
                }
              }
              // If subsequent step starts before this step ends
              if (sister.stepNum > job.stepNum) {
                const leadDays = (job.machine && this.state.workCenters[job.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[job.machine].leadTimeDays) : 0;
                const leadHours = leadDays * 8.0;
                if ((jobEnd + leadHours + moveBuffer) > (sister.startHour + 0.01)) {
                  isSeqError = true;
                }
              }
            });

            // Parent-Child violation check
            const isChild = job.woId.includes('-');
            if (isChild) {
              const parentWoId = job.woId.split('-')[0];
              const parentSteps = getJobsForWo(parentWoId);
              const parentFirstStep = [...parentSteps].sort((a, b) => a.stepNum - b.stepNum)[0];
              if (parentFirstStep) {
                const childLeadDays = (job.machine && this.state.workCenters[job.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[job.machine].leadTimeDays) : 0;
                const childLeadHours = childLeadDays * 8.0;
                const moveBuffer = (job.machine !== parentFirstStep.machine) ? (10.0 / 60.0) : 0.0;
                if ((jobEnd + childLeadHours + moveBuffer) > (parentFirstStep.startHour + 0.01)) {
                  isParentChildViolation = true;
                }
              }
            } else {
              const parentWoId = job.woId;
              const childWoIds = childrenOfWoIdScheduled.get(parentWoId) || [];
              childWoIds.forEach(childId => {
                const childSteps = getJobsForWo(childId);
                const childLastStep = [...childSteps].sort((a, b) => b.stepNum - a.stepNum)[0];
                if (childLastStep) {
                  const childLeadDays = (childLastStep.machine && this.state.workCenters[childLastStep.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[childLastStep.machine].leadTimeDays) : 0;
                  const childLeadHours = childLeadDays * 8.0;
                  const moveBuffer = (childLastStep.machine !== job.machine) ? (10.0 / 60.0) : 0.0;
                  if ((childLastStep.startHour + childLastStep.estHours + childLeadHours + moveBuffer) > (job.startHour + 0.01)) {
                    isParentChildViolation = true;
                  }
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

          const machineClass = 'wc-' + job.machine.toLowerCase().replace(/[^a-z0-9]/g, '-');
          card.className = `gantt-card ${statusClass} ${machineClass}`;
          
          const jobPriority = String(job.priority || this.state.workOrders?.find(wo => wo.id === job.woId)?.priority || 'Normal').trim();
          const customPriorityColor = this.state.priorityColors ? this.state.priorityColors[jobPriority] : null;
          const customProjectColor = this.state.projectColors ? this.state.projectColors[job.project || 'General'] : null;
          const customCardColor = customPriorityColor || customProjectColor;

          let readableTextColor = null;
          if (customCardColor && job.status !== 'Completed' && job.status !== 'Running' && job.status !== 'Paused') {
            card.style.background = `linear-gradient(135deg, ${customCardColor}, ${customCardColor})`;
            card.style.borderColor = customCardColor;
            card.style.boxShadow = `0 4px 10px rgba(0,0,0,0.35)`;
            readableTextColor = getReadableTextColor(customCardColor);
            card.style.color = readableTextColor;
          }

          card.setAttribute('draggable', job.status === 'Completed' ? 'false' : 'true');
          card.setAttribute('data-id', job.id);
          card.setAttribute('data-wo-id', woId);

          const isOffloadedJob = Boolean(job.isOffloaded || (job.originalMachine && job.originalMachine !== job.machine));
          const offloadIndicator = isOffloadedJob 
            ? `<span class="gantt-card-offload-tag" style="color: #c084fc; font-weight: 800; font-size: 8px; background: rgba(168, 85, 247, 0.25); padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(168, 85, 247, 0.5); margin-left: 2px;" title="[OFFLOAD] กระจายโหลดจากเครื่อง ${this.state.getMachineDisplayName(job.originalMachine)} มาช่วยที่เครื่อง ${this.state.getMachineDisplayName(job.machine)}">🔀 ช่วย</span>` 
            : '';

          // Tooltip description
          const tooltipStepName = job.stepName || job.name || '';
          let tooltip = `${tooltipStepName ? tooltipStepName + '\n' : ''}Start: ${this.formatTime(job.startHour, scale)} | Finish: ${this.formatTime(jobEnd, scale)}`;
          if (isOffloadedJob) {
            tooltip += `\n[OFFLOAD] กระจายโหลดจากเครื่อง ${this.state.getMachineDisplayName(job.originalMachine)} มาช่วยที่ ${this.state.getMachineDisplayName(job.machine)}`;
          }
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

          const lateIndicator = isDueError ? `<span class="gantt-card-late-tag" style="color: #ff4a4a; font-weight: 700; font-size: 8px; background: rgba(255, 74, 74, 0.15); padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(255, 74, 74, 0.3); margin-left: 4px; animation: pulse-flash 0.5s infinite alternate;">ช้า ${diffDays} วัน</span>` : '';
          const completedIndicator = job.status === 'Completed' ? '<span style="font-size: 8px; font-weight: 900; color: var(--accent-green); background: rgba(22, 163, 74, 0.15); padding: 1px 3px; border-radius: 3px; border: 1px solid var(--accent-green); margin-right: 4px; display: inline-flex; align-items: center; justify-content: center;">✓</span>' : '';

          const childMatchCard = job.woId ? job.woId.match(/^(.*)-(\d+)$/) : null;
          const isChildCard = !!childMatchCard;
          let isParentCard = false;
          if (job.woId) {
            isParentCard = directParentIdsNumericAll.has(job.woId);
          }

          let relationIndicatorHtml = '';
          if (isParentCard) {
            relationIndicatorHtml = `<span class="gantt-card-relation-indicator" title="Parent Part (ตัวแม่)">M</span>`;
          } else if (isChildCard) {
            relationIndicatorHtml = `<span class="gantt-card-relation-indicator" title="Child Part (ตัวลูก) ของ ${childMatchCard[1]}">C</span>`;
          }

          const isJobLocked = this.state.isJobLocked(job);
          const lockIndicator = isJobLocked ? `<span style="font-size: 9px; margin-right: 2px;" title="โครงการนี้ถูกล็อคแผนงานไว้ (Locked Project)">🔒</span>` : '';

          card.innerHTML = `
            <div class="gantt-card-id" style="display: flex; align-items: center; justify-content: space-between; width: 100%; white-space: nowrap; overflow: hidden;">
              <span style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; gap: 4px; flex: 1; padding-right: 15px;">
                ${completedIndicator}<strong>${job.woId || job.id}</strong> <span style="opacity: 0.85; font-weight: normal;">${job.partName}</span> ${stepIndicator} ${offloadIndicator} ${job.priority === 'Hot' ? '🔥' : ''} ${lockIndicator}
              </span>
              ${lateIndicator}
            </div>
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

          // .gantt-card-bottom / .gantt-card-remove hardcode a white text color in CSS
          // (they don't inherit from .gantt-card), so a custom light task bar color
          // needs them overridden here too or "Qty:"/"Fin:"/the × button stay unreadable.
          if (readableTextColor) {
            const mutedColor = readableTextColor === '#000' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)';
            const bottomEl = card.querySelector('.gantt-card-bottom');
            if (bottomEl) bottomEl.style.color = mutedColor;
            const removeEl = card.querySelector('.gantt-card-remove');
            if (removeEl) removeEl.style.color = readableTextColor === '#000' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)';
          }

          // Bind drag event
          if (job.status === 'Completed' || isJobLocked) {
            card.style.cursor = 'not-allowed';
            card.addEventListener('dragstart', (e) => {
              e.preventDefault();
              if (job.status === 'Completed') {
                this.showToast("ผลิตเสร็จแล้ว ย้ายไม่ได้");
              } else {
                this.showToast(`🔒 โครงการ "${job.project || 'General'}" ถูกล็อคแผนไว้ ไม่สามารถขยับได้`);
              }
            });
          } else {
            card.addEventListener('dragstart', (e) => {
              e.dataTransfer.setData('text/plain', job.id);
              e.dataTransfer.effectAllowed = 'move';
              setTimeout(() => { card.style.opacity = '0.3'; }, 0);
            });
          }

          card.addEventListener('dragend', () => {
            card.style.opacity = '1';
            this.state.notify();
          });

          // Drag & Drop onto Assembly step to create assembly dependency line
          const isAssembly = (job.machine.toLowerCase() === 'assembly' || job.machine === 'Assembly');
          if (isAssembly) {
            card.addEventListener('dragover', (e) => {
              e.preventDefault();
              card.classList.add('drag-hover-assembly');
            });
            card.addEventListener('dragleave', () => {
              card.classList.remove('drag-hover-assembly');
            });
            card.addEventListener('drop', (e) => {
              e.preventDefault();
              e.stopPropagation();
              card.classList.remove('drag-hover-assembly');
              
              const draggedJobId = e.dataTransfer.getData('text/plain');
              if (!draggedJobId || draggedJobId === job.id) return;
              
              this.state.addAssemblyLink(draggedJobId, job.id);
            });
          }

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
    }

    // Draw dependency connector lines
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

    svg.style.display = 'block';

    const board = this.ganttGrid.closest('.gantt-board');
    if (!board) return;
    const boardRect = board.getBoundingClientRect();

    // The task-to-task dependency arrows (routing sequence / parent-child / assembly
    // links) are gated by the toggle; the board's Start/Now/Finish date indicator
    // lines further below are NOT part of that toggle and always draw.
    if (this.state.showDependencyLines !== false) {
    // Map scheduled job IDs to their rendered DOM cards
    const cards = Array.from(this.ganttGrid.querySelectorAll('.gantt-card'));
    const cardMap = {};
    cards.forEach(card => {
      const id = card.getAttribute('data-id');
      if (id) cardMap[id] = card;
    });

    // Read every card's layout rect up front, in one batch, before any of the
    // svg.appendChild() writes below. Reading getBoundingClientRect() forces a
    // synchronous layout reflow only when it follows a DOM write since the last
    // read; interleaving reads and writes per-line (the old code) forced one
    // reflow per line, which was the dominant cost past ~1000 cards/lines.
    const rectCache = new Map();
    cards.forEach(card => rectCache.set(card, card.getBoundingClientRect()));
    const getCardRect = (card) => rectCache.get(card) || card.getBoundingClientRect();

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
          const rectA = getCardRect(cardA);
          const rectB = getCardRect(cardB);

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

          // Check if sequence is in error (previous step + machine lead time + 10m move buffer if different machine finishes after next step starts)
          const leadDays = (stepA.machine && this.state.workCenters[stepA.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[stepA.machine].leadTimeDays) : 0;
          const leadHours = leadDays * 8.0;
          const moveBuffer = (stepA.machine !== stepB.machine) ? (10.0 / 60.0) : 0.0;
          const stepAEnd = stepA.startHour + stepA.estHours + leadHours + moveBuffer;
          if (stepAEnd > (stepB.startHour + 0.01)) {
            path.classList.add('error');
          }

          svg.appendChild(path);
        }
      }
    });

    // Draw lines between Child WOs and Parent WOs (Child finishes -> Parent starts)
    // Build parent -> direct numeric children map in one O(W) pass instead of
    // the previous O(W^2) nested Object.keys().some()/.filter() scans.
    const childrenByParentWoId = new Map();
    Object.keys(woGroups).forEach(id => {
      const m = id.match(/^(.*)-(\d+)$/);
      if (m) {
        if (!childrenByParentWoId.has(m[1])) childrenByParentWoId.set(m[1], []);
        childrenByParentWoId.get(m[1]).push(id);
      }
    });
    const parentWoIds = new Set(childrenByParentWoId.keys());

    parentWoIds.forEach(parentWoId => {
      const parentJobs = woGroups[parentWoId];
      if (!parentJobs || parentJobs.length === 0) return;
      // Sort parent jobs in ascending order to find the first step
      parentJobs.sort((a, b) => a.stepNum - b.stepNum);
      const parentFirstStep = parentJobs[0];
      const cardParent = cardMap[parentFirstStep.id];

      // Find children
      const childWoIds = childrenByParentWoId.get(parentWoId) || [];

      childWoIds.forEach(childWoId => {
        const childJobs = woGroups[childWoId];
        if (!childJobs || childJobs.length === 0) return;
        // Sort child jobs in descending order to find the last step (highest stepNum)
        childJobs.sort((a, b) => b.stepNum - a.stepNum);
        const childLastStep = childJobs[0];
        const cardChild = cardMap[childLastStep.id];

        if (cardChild && cardParent) {
          const rectA = getCardRect(cardChild);
          const rectB = getCardRect(cardParent);

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

          // Error condition: Child finishes (+ lead time + move buffer if different machine) after Parent starts
          const childLeadDays = (childLastStep.machine && this.state.workCenters[childLastStep.machine]?.leadTimeDays) ? parseFloat(this.state.workCenters[childLastStep.machine].leadTimeDays) : 0;
          const childLeadHours = childLeadDays * 8.0;
          const childMoveBuffer = (childLastStep.machine !== parentFirstStep.machine) ? (10.0 / 60.0) : 0.0;
          const childLastStepEnd = childLastStep.startHour + childLastStep.estHours + childLeadHours + childMoveBuffer;
          if (childLastStepEnd > (parentFirstStep.startHour + 0.01)) {
            path.classList.add('error');
          }

          svg.appendChild(path);
        }
      });
    });

    // Draw custom assembly links
    if (this.state.assemblyLinks) {
      this.state.assemblyLinks.forEach(link => {
        const cardA = cardMap[link.from];
        const cardB = cardMap[link.to];
        
        if (cardA && cardB) {
          const rectA = getCardRect(cardA);
          const rectB = getCardRect(cardB);
          
          const xA = rectA.right - boardRect.left;
          const yA = rectA.top + (rectA.height / 2) - boardRect.top;
          
          const xB = rectB.left - boardRect.left;
          const yB = rectB.top + (rectB.height / 2) - boardRect.top;
          
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const dx = Math.max(40, Math.abs(xB - xA) * 0.5);
          const pathD = `M ${xA} ${yA} C ${xA + dx} ${yA}, ${xB - dx} ${yB}, ${xB} ${yB}`;
          
          path.setAttribute('d', pathD);
          path.setAttribute('class', 'gantt-dep-line assembly-dep-line');
          path.setAttribute('data-from-id', link.from);
          path.setAttribute('data-to-id', link.to);
          
          // Double-click to delete custom assembly connection
          path.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (this.state.removeAssemblyLink) {
              this.state.removeAssemblyLink(link.from, link.to);
            }
          });
          
          // Check if the source part PD is fully completed (all steps completed)
          const parsed = this.state.parseStepId(link.from);
          const sourceWoId = parsed.woId;
          
          const backlogWO = this.state.workOrders.find(wo => wo.id === sourceWoId);
          const backlogStepsCount = backlogWO ? backlogWO.steps.length : 0;
          const scheduledSteps = this.state.scheduledJobs.filter(j => j.woId === sourceWoId);
          const totalSteps = scheduledSteps.length + backlogStepsCount;
          const completedSteps = scheduledSteps.filter(j => j.status === 'Completed').length;
          
          const isAllComplete = (totalSteps > 0 && completedSteps === totalSteps);
          if (!isAllComplete) {
            path.classList.add('error');
          }
          
          svg.appendChild(path);
        }
      });
    }
    } // end showDependencyLines block

    // Draw vertical indicator lines (Start Date, Today/Now, and Latest Finish Date)
    const scale = this.state.activeScale;
    const config = this.getScaleConfig(scale);
    const timelineEnd = config.startOffset + config.totalHours;

    const track = this.ganttGrid.querySelector('.gantt-row-track');
    if (track) {
      const trackRect = track.getBoundingClientRect();
      const trackLeft = trackRect.left - boardRect.left;
      const trackWidth = trackRect.width;
      const totalBoardHeight = Math.max(
        board.scrollHeight,
        board.offsetHeight,
        (this.ganttGrid.scrollHeight || 0) + 50,
        boardRect.height || 0
      );

      // Ensure SVG overlay spans the full scrollable height
      svg.style.height = `${totalBoardHeight}px`;

      const formatFullDate = (dateObj) => {
        if (!dateObj || isNaN(dateObj.getTime())) return '-';
        const d = dateObj.getDate().toString().padStart(2, '0');
        const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const y = String(dateObj.getFullYear()).slice(-2);
        const hh = dateObj.getHours().toString().padStart(2, '0');
        const mm = dateObj.getMinutes().toString().padStart(2, '0');
        return `${d}/${m}/${y} ${hh}:${mm}`;
      };

      const drawVerticalIndicator = (hourVal, dateObj, className, labelPrefix, titlePrefix, badgeColor, badgeY = 3) => {
        if (hourVal >= config.startOffset && hourVal <= timelineEnd) {
          const percent = ((hourVal - config.startOffset) / config.totalHours) * 100;
          const x = trackLeft + (percent / 100) * trackWidth;
          const formattedDateTime = formatFullDate(dateObj);

          // Vertical line from top (y=0) all the way down to totalBoardHeight
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', x);
          line.setAttribute('y1', 0);
          line.setAttribute('x2', x);
          line.setAttribute('y2', totalBoardHeight);
          line.setAttribute('class', className);
          line.setAttribute('title', `${titlePrefix}: ${formattedDateTime}`);
          svg.appendChild(line);

          if (className === 'gantt-start-line') {
            // Start Date vertical badge on the left side of the line, rotated -90 degrees
            const wrapper = this.boardWrapper || document.querySelector('.gantt-board-wrapper');
            const visibleTop = wrapper ? wrapper.scrollTop : 0;
            const visibleHeight = wrapper ? wrapper.clientHeight : (boardRect.height || 600);
            const centerY = visibleTop + (visibleHeight / 2);

            const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badgeGroup.setAttribute('class', 'gantt-start-vertical-badge');
            badgeGroup.setAttribute('data-x', x);
            badgeGroup.setAttribute('transform', `translate(${x - 12}, ${centerY}) rotate(-90)`);
            badgeGroup.setAttribute('title', `${titlePrefix}: ${formattedDateTime} (คลิกเพื่อเลื่อนไปยังจุดนี้)`);
            badgeGroup.style.cursor = 'pointer';

            const badgeText = `${labelPrefix}: ${formattedDateTime}`;
            const badgeWidth = Math.max(badgeText.length * 5.8 + 16, 125);
            const badgeHeight = 18;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', -badgeWidth / 2);
            rect.setAttribute('y', -badgeHeight / 2);
            rect.setAttribute('width', badgeWidth);
            rect.setAttribute('height', badgeHeight);
            rect.setAttribute('rx', 4);
            rect.setAttribute('fill', badgeColor);
            rect.setAttribute('stroke', '#ffffff');
            rect.setAttribute('stroke-width', '1');
            rect.setAttribute('opacity', '0.95');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.textContent = badgeText;
            text.setAttribute('x', 0);
            text.setAttribute('y', 0);
            text.setAttribute('font-size', '9.5');
            text.setAttribute('font-family', 'var(--font-family), sans-serif');
            text.setAttribute('font-weight', '700');
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');

            badgeGroup.appendChild(rect);
            badgeGroup.appendChild(text);

            badgeGroup.addEventListener('click', (e) => {
              e.stopPropagation();
              const targetOffset = hourVal - config.totalHours / 3;
              const snap = config.snapHours || 1;
              const snappedOffset = Math.round(targetOffset / snap) * snap;
              this.state.setTimelineOffset(snappedOffset);
            });

            svg.appendChild(badgeGroup);
          } else if (className === 'gantt-finish-line') {
            // Finish Date vertical badge on the right side of the line, rotated -90 degrees
            const wrapper = this.boardWrapper || document.querySelector('.gantt-board-wrapper');
            const visibleTop = wrapper ? wrapper.scrollTop : 0;
            const visibleHeight = wrapper ? wrapper.clientHeight : (boardRect.height || 600);
            const centerY = visibleTop + (visibleHeight / 2);

            const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badgeGroup.setAttribute('class', 'gantt-finish-vertical-badge');
            badgeGroup.setAttribute('data-x', x);
            badgeGroup.setAttribute('transform', `translate(${x + 12}, ${centerY}) rotate(-90)`);
            badgeGroup.setAttribute('title', `${titlePrefix}: ${formattedDateTime} (คลิกเพื่อเลื่อนไปยังจุดนี้)`);
            badgeGroup.style.cursor = 'pointer';

            const badgeText = `${labelPrefix}: ${formattedDateTime}`;
            const badgeWidth = Math.max(badgeText.length * 5.8 + 16, 125);
            const badgeHeight = 18;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', -badgeWidth / 2);
            rect.setAttribute('y', -badgeHeight / 2);
            rect.setAttribute('width', badgeWidth);
            rect.setAttribute('height', badgeHeight);
            rect.setAttribute('rx', 4);
            rect.setAttribute('fill', badgeColor);
            rect.setAttribute('stroke', '#ffffff');
            rect.setAttribute('stroke-width', '1');
            rect.setAttribute('opacity', '0.95');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.textContent = badgeText;
            text.setAttribute('x', 0);
            text.setAttribute('y', 0);
            text.setAttribute('font-size', '9.5');
            text.setAttribute('font-family', 'var(--font-family), sans-serif');
            text.setAttribute('font-weight', '700');
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');

            badgeGroup.appendChild(rect);
            badgeGroup.appendChild(text);

            badgeGroup.addEventListener('click', (e) => {
              e.stopPropagation();
              const targetOffset = hourVal - config.totalHours / 3;
              const snap = config.snapHours || 1;
              const snappedOffset = Math.round(targetOffset / snap) * snap;
              this.state.setTimelineOffset(snappedOffset);
            });

            svg.appendChild(badgeGroup);
          } else {
            // Top Header Badge on timeline ruler showing full Date and Time (e.g. Today/Now)
            const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badgeGroup.setAttribute('class', `${className}-badge`);
            badgeGroup.setAttribute('title', `${titlePrefix}: ${formattedDateTime} (คลิกเพื่อเลื่อนไปยังจุดนี้)`);
            badgeGroup.style.cursor = 'pointer';

            const badgeText = `${labelPrefix}: ${formattedDateTime}`;
            const badgeWidth = Math.max(badgeText.length * 5.8 + 14, 120);
            const badgeHeight = 16;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', x - badgeWidth / 2);
            rect.setAttribute('y', badgeY);
            rect.setAttribute('width', badgeWidth);
            rect.setAttribute('height', badgeHeight);
            rect.setAttribute('rx', 4);
            rect.setAttribute('fill', badgeColor);
            rect.setAttribute('stroke', '#ffffff');
            rect.setAttribute('stroke-width', '1');
            rect.setAttribute('opacity', '0.95');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.textContent = badgeText;
            text.setAttribute('x', x);
            text.setAttribute('y', badgeY + badgeHeight / 2);
            text.setAttribute('font-size', '9');
            text.setAttribute('font-family', 'var(--font-family), sans-serif');
            text.setAttribute('font-weight', '700');
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');

            badgeGroup.appendChild(rect);
            badgeGroup.appendChild(text);

            // Click badge to navigate timeline to this exact position
            badgeGroup.addEventListener('click', (e) => {
              e.stopPropagation();
              const targetOffset = hourVal - config.totalHours / 3;
              const snap = config.snapHours || 1;
              const snappedOffset = Math.round(targetOffset / snap) * snap;
              this.state.setTimelineOffset(snappedOffset);
            });

            svg.appendChild(badgeGroup);
          }
        }
      };

      // Find earliest task start hour and latest task finish hour
      let minStartHour = Infinity;
      let maxFinishHour = -Infinity;
      let firstJob = null;
      let lastJob = null;

      const activeJobs = this.state.scheduledJobs.filter(job => {
        return isJobPriorityVisible(job, this.state) && isJobProjectVisible(job, this.state) && this.state.activeWorkCenters[job.machine] !== false && typeof job.startHour === 'number' && !isNaN(job.startHour);
      });

      activeJobs.forEach(job => {
        if (job.startHour < minStartHour) {
          minStartHour = job.startHour;
          firstJob = job;
        }
        const est = (typeof job.estHours === 'number' && job.estHours > 0) ? job.estHours : 1.0;
        const finish = job.startHour + est;
        if (finish > maxFinishHour) {
          maxFinishHour = finish;
          lastJob = job;
        }
      });

      // 1. Task Start Date (เวลาเริ่มงาน)
      if (minStartHour !== Infinity) {
        const startDate = workingHourToDate(minStartHour);
        const firstTaskDetail = firstJob ? ` (First Task: ${firstJob.woId || firstJob.id} - ${firstJob.stepName || firstJob.name || firstJob.partName || ''})` : '';
        drawVerticalIndicator(
          minStartHour,
          startDate,
          'gantt-start-line',
          'Start',
          `Start Date${firstTaskDetail}`,
          'var(--accent-teal, #0284c7)',
          2
        );
      }

      // 2. Today / Now (เวลาปัจจุบัน)
      const now = new Date();
      const nowWorkingHour = dateToWorkingHour(now);
      drawVerticalIndicator(
        nowWorkingHour,
        now,
        'gantt-now-line',
        'Today',
        'Today (เวลาปัจจุบัน)',
        'var(--accent-red, #ef4444)',
        18
      );

      // 3. Task Finish Date (เวลาสิ้นสุดของ Task ที่ช้าที่สุดของที่กรองไว้)
      if (maxFinishHour > -Infinity) {
        const finishDate = workingHourToDate(maxFinishHour);
        const lastTaskDetail = lastJob ? ` (Last Task: ${lastJob.woId || lastJob.id} - ${lastJob.stepName || lastJob.name || lastJob.partName || ''})` : '';
        drawVerticalIndicator(
          maxFinishHour,
          finishDate,
          'gantt-finish-line',
          'Finish',
          `Finish Date${lastTaskDetail}`,
          'var(--accent-green, #16a34a)',
          2
        );
      }
    }
  }

  updateStickyIndicators() {
    const wrapper = this.boardWrapper || document.querySelector('.gantt-board-wrapper');
    if (!wrapper) return;
    const visibleTop = wrapper.scrollTop;
    const visibleHeight = wrapper.clientHeight;
    const centerY = visibleTop + (visibleHeight / 2);

    const startBadge = document.querySelector('.gantt-start-vertical-badge');
    if (startBadge) {
      const x = parseFloat(startBadge.getAttribute('data-x') || 0);
      startBadge.setAttribute('transform', `translate(${x - 12}, ${centerY}) rotate(-90)`);
    }

    const finishBadge = document.querySelector('.gantt-finish-vertical-badge');
    if (finishBadge) {
      const x = parseFloat(finishBadge.getAttribute('data-x') || 0);
      finishBadge.setAttribute('transform', `translate(${x + 12}, ${centerY}) rotate(-90)`);
    }
  }

  formatTime(hourFloat, scale) {
    const d = workingHourToDate(hourFloat);
    const day = d.getDate();
    const m = d.getMonth() + 1;
    const y = String(d.getFullYear()).slice(-2);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hh}:${mm}`;
    
    if (scale === 'hr' || scale === 'min1' || scale === 'min5' || scale === 'min15' || scale === 'min30') {
      return timeStr;
    } else {
      return `${day}/${m}/${y} ${timeStr}`;
    }
  }

  showAssemblyStatusModalForWo(woId) {
    const modal = document.getElementById('assembly-parts-modal');
    const body = document.getElementById('assembly-parts-modal-body');
    if (!modal || !body) return;

    // Find all descendant children
    const allWoIds = new Set([
      ...this.state.workOrders.map(w => w.id),
      ...this.state.scheduledJobs.map(j => j.woId).filter(Boolean)
    ]);
    
    // Links to this WO
    const links = this.state.assemblyLinks || [];
    const linkedFromIds = links.filter(l => l.to.startsWith(woId + '-')).map(l => this.state.parseStepId(l.from).woId);
    
    const childWoIds = Array.from(allWoIds).filter(id => id && id !== woId && (id.startsWith(woId + '-') || linkedFromIds.includes(id)));
    
    // Sort childWoIds hierarchically
    childWoIds.sort((a, b) => {
      const aParts = a.split('-');
      const bParts = b.split('-');
      const aBase = aParts[0];
      const bBase = bParts[0];
      if (aBase !== bBase) return aBase.localeCompare(bBase);
      for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        const numA = parseInt(aParts[i], 10);
        const numB = parseInt(bParts[i], 10);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
        if (aParts[i] !== bParts[i]) return aParts[i].localeCompare(bParts[i]);
      }
      return aParts.length - bParts.length;
    });

    const parentJobs = this.state.scheduledJobs.filter(j => j.woId === woId);
    const parentBacklog = this.state.workOrders.find(wo => wo.id === woId);
    const parentPart = parentJobs[0]?.partName || parentBacklog?.partName || woId;
    const isTopMain = (woId.match(/-/g) || []).length === 0;

    let html = `
      <div style="background: rgba(2, 132, 199, 0.12); border: 1px solid var(--accent-teal); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 style="margin: 0; color: var(--accent-teal); font-size: 13px; font-weight: bold;">${isTopMain ? '📦 Main Assembly' : '⚙️ Sub-Assembly'}: ${woId}</h4>
          <span style="font-size: 10px; background: var(--bg-darkest); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border-glass); font-weight: bold; color: #38bdf8;">Tree Diagram View</span>
        </div>
        <div style="font-size: 11px; color: var(--text-primary); margin-top: 4px;">ชิ้นงาน: <strong>${parentPart}</strong></div>
      </div>
      <div class="assembly-tree-modal-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 480px; overflow-y: auto; padding-right: 4px;">
    `;

    if (childWoIds.length === 0) {
      html += `<p style="font-size: 12px; color: var(--text-secondary); text-align: center; padding: 20px 0;">ไม่มีรายการชิ้นงานลูกภายใต้ชุดประกอบนี้</p>`;
    } else {
      childWoIds.forEach(cWoId => {
        const depth = Math.max(1, (cWoId.match(/-/g) || []).length - (woId.match(/-/g) || []).length);
        const indentPx = (depth - 1) * 22;
        
        const isSubAssy = Array.from(allWoIds).some(id => id && id !== cWoId && id.startsWith(cWoId + '-'));
        const prefixIcon = isSubAssy ? '⚙️' : '📄';
        const typeBadge = isSubAssy 
          ? '<span style="font-size: 9px; font-weight: bold; background: rgba(192, 132, 252, 0.2); color: #c084fc; border: 1px solid #c084fc; border-radius: 3px; padding: 1px 5px;">Sub-Assy</span>' 
          : '<span style="font-size: 9px; font-weight: bold; background: rgba(2, 132, 199, 0.15); color: var(--accent-teal); border: 1px solid var(--accent-teal); border-radius: 3px; padding: 1px 5px;">Child Part</span>';

        const cJobs = this.state.scheduledJobs.filter(j => j.woId === cWoId);
        const cBacklog = this.state.workOrders.find(wo => wo.id === cWoId);
        const cPartName = cJobs[0]?.partName || cBacklog?.partName || 'Unknown';
        
        const totalSteps = cJobs.length + (cBacklog ? cBacklog.steps.length : 0);
        const completedSteps = cJobs.filter(j => j.status === 'Completed').length;
        const isComplete = totalSteps > 0 && completedSteps === totalSteps;
        const isRunning = cJobs.some(j => j.status === 'Running' || j.status === 'Setup');
        
        let statusBadge = '';
        if (isComplete) {
          statusBadge = '<span style="color: #22c55e; font-weight: bold; font-size: 11px;">✅ ผลิตเสร็จ 100%</span>';
        } else if (isRunning) {
          statusBadge = '<span style="color: #eab308; font-weight: bold; font-size: 11px;">⚡ กำลังผลิต</span>';
        } else {
          statusBadge = `<span style="color: var(--accent-teal); font-size: 11px;">⏳ รอคิว (${completedSteps}/${totalSteps} ขั้นตอน)</span>`;
        }

        // Calculate Finish date
        let cMaxFinish = 0;
        cJobs.forEach(j => {
          const fin = j.startHour + j.estHours;
          if (fin > cMaxFinish) cMaxFinish = fin;
        });
        let finStr = '-';
        if (cMaxFinish > 0) {
          const d = workingHourToDate(cMaxFinish);
          finStr = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        }

        const treeSymbol = depth === 1 ? '├── ' : '│   └── ';

        html += `
          <div style="margin-left: ${indentPx}px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-left: 3px solid ${isSubAssy ? '#c084fc' : 'var(--accent-teal)'}; border-radius: 6px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-family: monospace; color: var(--text-secondary); font-size: 11px;">${treeSymbol}</span>
              <span style="font-size: 14px;">${prefixIcon}</span>
              <div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <strong style="color: #fff; font-size: 11.5px;">${cWoId}</strong>
                  ${typeBadge}
                </div>
                <div style="font-size: 10.5px; color: var(--text-secondary); margin-top: 1px; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${cPartName}">${cPartName}</div>
              </div>
            </div>
            <div style="text-align: right; min-width: 140px;">
              <div>${statusBadge}</div>
              <div style="font-size: 9.5px; color: var(--text-secondary); margin-top: 2px;">กำหนดเสร็จ: <strong style="color: var(--accent-green);">${finStr}</strong></div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    body.innerHTML = html;
    modal.classList.remove('hidden');
  }

  showAssemblyStatusModalForJob(job) {
    const modal = document.getElementById('assembly-parts-modal');
    const body = document.getElementById('assembly-parts-modal-body');
    if (!modal || !body) return;

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
          const d = workingHourToDate(maxFinishHour);
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
    
    body.innerHTML = html;
    modal.dataset.jobId = job.id;
    modal.classList.remove('hidden');
  }

  fitTasks(jobs) {
    if (!jobs || jobs.length === 0) return;

    const minStart = Math.min(...jobs.map(j => j.startHour));
    const maxFinish = Math.max(...jobs.map(j => j.startHour + j.estHours));
    const span = maxFinish - minStart;

    let targetScale = 'hr';
    if (span <= 8.0) {
      targetScale = 'hr';
    } else if (span <= 48.0) {
      targetScale = 'day';
    } else if (span <= 192.0) {
      targetScale = 'week';
    } else if (span <= 576.0) {
      targetScale = 'month';
    } else if (span <= 1728.0) {
      targetScale = 'quarter';
    } else {
      targetScale = 'year';
    }

    // Offset margin so the Start Date dashed line & vertical badge on the left are clearly visible
    let leftMarginHours = 0;
    if (targetScale === 'hr') leftMarginHours = 0.5;
    else if (targetScale === 'day') leftMarginHours = 2.0;
    else if (targetScale === 'week') leftMarginHours = 8.0;
    else if (targetScale === 'month') leftMarginHours = 16.0;
    else if (targetScale === 'quarter') leftMarginHours = 48.0;
    else leftMarginHours = 96.0;

    const startDayOffset = Math.floor(minStart / 8.0) * 8.0;
    const targetOffset = startDayOffset - leftMarginHours;

    this.state.setActiveScale(targetScale);
    this.state.setTimelineOffset(targetOffset);
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
    if (!modal) return;

    const titleEl = document.getElementById('pd-plan-title');
    const statusBadgeEl = document.getElementById('pd-plan-status-badge');
    const stepCountEl = document.getElementById('pd-plan-step-count');
    const inputPdId = document.getElementById('edit-pd-id');
    const inputProject = document.getElementById('edit-pd-project');
    const inputCustomer = document.getElementById('edit-pd-customer');
    const inputDwgNo = document.getElementById('edit-pd-dwgno');
    const inputPartName = document.getElementById('edit-pd-partname');
    const inputQty = document.getElementById('edit-pd-qty');
    const inputPriority = document.getElementById('edit-pd-priority');
    const inputTargetDate = document.getElementById('edit-pd-targetdate');
    const tbody = document.getElementById('pd-plan-table-body');
    const btnAddStep = document.getElementById('btn-add-step-to-edit-pd');
    const btnSave = document.getElementById('btn-save-pd-changes');
    const btnExport = document.getElementById('btn-export-pd-csv');
    const btnDelete = document.getElementById('btn-delete-this-pd');

    // 1. Gather all info & steps for this PD
    const scheduledJobs = this.state.scheduledJobs
      .filter(j => j.woId === woId || j.id === woId);
    
    const backlogWO = this.state.workOrders.find(w => w.id === woId);

    if (scheduledJobs.length === 0 && !backlogWO) {
      this.showToast(`ไม่พบข้อมูล Production Order: ${woId}`);
      return;
    }

    const firstSource = scheduledJobs[0] || backlogWO;
    const customer = backlogWO?.customer || firstSource?.customer || 'General';
    const project = backlogWO?.project || firstSource?.project || 'General';
    const dwgNo = backlogWO?.dwgNo || firstSource?.dwgNo || '';
    const partName = backlogWO?.partName || firstSource?.partName || '';
    const qty = backlogWO?.qty || firstSource?.qty || 100;
    const priority = backlogWO?.priority || firstSource?.priority || 'Normal';
    const dueHour = backlogWO?.dueHour !== undefined ? backlogWO.dueHour : (firstSource?.dueHour !== undefined ? firstSource.dueHour : null);

    // 2. Populate form fields
    if (titleEl) titleEl.textContent = `Production Order: ${woId}`;
    if (inputPdId) inputPdId.value = woId;
    if (inputProject) inputProject.value = project;
    if (inputCustomer) inputCustomer.value = customer;
    if (inputDwgNo) inputDwgNo.value = dwgNo;
    if (inputPartName) inputPartName.value = partName;
    if (inputQty) inputQty.value = qty;
    if (inputPriority) inputPriority.value = priority;

    if (inputTargetDate) {
      if (dueHour !== null && dueHour !== undefined) {
        const dDue = workingHourToDate(dueHour);
        const yyyy = dDue.getFullYear();
        const mm = (dDue.getMonth() + 1).toString().padStart(2, '0');
        const dd = dDue.getDate().toString().padStart(2, '0');
        inputTargetDate.value = `${yyyy}-${mm}-${dd}`;
      } else {
        inputTargetDate.value = '';
      }
    }

    // 3. Compile all steps (both scheduled & unscheduled)
    const stepsList = [];
    const stepIdsSeen = new Set();

    scheduledJobs.forEach(job => {
      let setup = job.setupMinutes !== undefined ? job.setupMinutes : 0;
      let cyc = job.cycleMinutes;
      if ((cyc === undefined || cyc === null) && job.estHours > 0 && (job.qty || woQty) > 0) {
        const cap = this.state.workCenters[job.machine]?.capacity || 1;
        const q = job.qty || woQty || 1;
        cyc = parseFloat(((job.estHours * 60.0 * cap - setup) / q).toFixed(2));
        if (cyc <= 0) cyc = parseFloat(((job.estHours * 60.0 * cap) / q).toFixed(2));
      }
      if (cyc === undefined || cyc === null || isNaN(cyc)) cyc = 1;

      stepsList.push({
        id: job.id,
        stepNum: job.stepNum,
        name: job.stepName || job.name || '',
        machine: job.machine || 'DEA012',
        setupMinutes: setup,
        cycleMinutes: cyc,
        estHours: job.estHours,
        status: job.status || 'Scheduled',
        startHour: job.startHour,
        isScheduled: true
      });
      stepIdsSeen.add(job.id);
    });

    if (backlogWO && Array.isArray(backlogWO.steps)) {
      backlogWO.steps.forEach(s => {
        if (!stepIdsSeen.has(s.id)) {
          let setup = s.setupMinutes !== undefined ? s.setupMinutes : 0;
          let cyc = s.cycleMinutes;
          if ((cyc === undefined || cyc === null) && s.estHours > 0 && woQty > 0) {
            const cap = this.state.workCenters[s.machine]?.capacity || 1;
            cyc = parseFloat(((s.estHours * 60.0 * cap - setup) / woQty).toFixed(2));
            if (cyc <= 0) cyc = parseFloat(((s.estHours * 60.0 * cap) / woQty).toFixed(2));
          }
          if (cyc === undefined || cyc === null || isNaN(cyc)) cyc = 1;

          stepsList.push({
            id: s.id,
            stepNum: s.stepNum,
            name: s.name || '',
            machine: s.machine || 'DEA012',
            setupMinutes: setup,
            cycleMinutes: cyc,
            estHours: s.estHours,
            status: 'Unscheduled',
            startHour: null,
            isScheduled: false
          });
          stepIdsSeen.add(s.id);
        }
      });
    }

    stepsList.sort((a, b) => (a.stepNum || 0) - (b.stepNum || 0));

    const totalStepsCount = stepsList.length;
    const completedStepsCount = stepsList.filter(s => s.status === 'Completed').length;
    if (statusBadgeEl) {
      if (totalStepsCount > 0 && completedStepsCount === totalStepsCount) {
        statusBadgeEl.textContent = `✓ เสร็จสิ้นครบ ${completedStepsCount}/${totalStepsCount} ขั้นตอน`;
        statusBadgeEl.style.color = '#22c55e';
        statusBadgeEl.style.borderColor = '#22c55e';
        statusBadgeEl.style.background = 'rgba(34, 197, 94, 0.15)';
      } else {
        statusBadgeEl.textContent = `ความคืบหน้า ${completedStepsCount}/${totalStepsCount} ขั้นตอน`;
        statusBadgeEl.style.color = 'var(--accent-teal)';
        statusBadgeEl.style.borderColor = 'var(--accent-teal)';
        statusBadgeEl.style.background = 'rgba(0, 242, 254, 0.1)';
      }
    }
    if (stepCountEl) {
      stepCountEl.textContent = `(รวมทั้งหมด ${totalStepsCount} ขั้นตอน)`;
    }

    // 4. Render Step Rows
    tbody.innerHTML = '';

    const recalculateRowHours = (tr) => {
      const curQty = parseFloat(inputQty.value) || 1;
      const setup = parseFloat(tr.querySelector('.modal-step-setup').value) || 0;
      const cycle = parseFloat(tr.querySelector('.modal-step-cycle').value) || 0;
      const machine = tr.querySelector('.modal-step-machine').value;
      const cap = this.state.workCenters[machine]?.capacity || 1;
      const totalH = ((setup + curQty * cycle) / 60.0 / cap) || (1.0 / 60.0);
      // Field shows/edits minutes (matches how Setup/Cycle are entered); stored as hours.
      tr.querySelector('.modal-step-esthours').value = parseFloat((totalH * 60.0).toFixed(1));
    };

    const renderStepRow = (stepData) => {
      const tr = document.createElement('tr');
      tr.className = 'modal-step-row';
      tr.setAttribute('data-step-id', stepData.id || '');
      tr.style.borderBottom = '1px solid var(--border-glass)';
      tr.style.background = 'rgba(255,255,255,0.01)';

      const wcOptions = this.state.workCenterOrder.map(wc => {
        const wcName = this.state.workCenters[wc]?.name || wc;
        const isSelected = (wc === stepData.machine || wc.toLowerCase() === (stepData.machine || '').toLowerCase());
        return `<option value="${wc}" ${isSelected ? 'selected' : ''} style="color: #000000; background: #ffffff;">${wc} - ${wcName}</option>`;
      }).join('');

      let statusBadgeHtml = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(148, 163, 184, 0.1); color: var(--text-secondary); border: 1px solid var(--border-glass);">Unscheduled</span>`;
      let timeScheduleHtml = `<span style="color: var(--text-secondary); font-style: italic; font-size: 10px; white-space: nowrap;">In Backlog</span>`;

      if (stepData.isScheduled && stepData.startHour !== null && stepData.startHour !== undefined) {
        const dStart = workingHourToDate(stepData.startHour);
        const dEnd = workingHourToDate(stepData.startHour + (stepData.estHours || 1));
        const sDay = dStart.getDate().toString().padStart(2, '0');
        const sMonth = (dStart.getMonth() + 1).toString().padStart(2, '0');
        const sTime = `${dStart.getHours().toString().padStart(2, '0')}:${dStart.getMinutes().toString().padStart(2, '0')}`;
        const eTime = `${dEnd.getHours().toString().padStart(2, '0')}:${dEnd.getMinutes().toString().padStart(2, '0')}`;
        timeScheduleHtml = `<span style="font-family: monospace; font-size: 10px; color: var(--text-primary); font-weight: 600; white-space: nowrap; display: inline-block;">${sDay}/${sMonth} ${sTime}-${eTime}</span>`;

        if (stepData.status === 'Completed') {
          statusBadgeHtml = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(22, 163, 74, 0.15); color: #22c55e; border: 1px solid #22c55e;">✓ Done</span>`;
        } else if (stepData.status === 'Running') {
          statusBadgeHtml = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(57, 255, 20, 0.1); color: var(--accent-green); border: 1px solid var(--accent-green);">Running</span>`;
        } else if (stepData.status === 'Paused') {
          statusBadgeHtml = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(255, 153, 0, 0.1); color: var(--accent-orange); border: 1px solid var(--accent-orange);">Paused</span>`;
        } else {
          statusBadgeHtml = `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; background: rgba(0, 242, 254, 0.1); color: var(--accent-teal); border: 1px solid var(--accent-teal);">Scheduled</span>`;
        }
      }

      tr.innerHTML = `
        <td style="padding: 8px 6px; text-align: center;">
          <input type="number" class="modal-step-num" value="${stepData.stepNum || 10}" min="1" step="1" style="background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 4px; border-radius: 4px; font-size: 10px; width: 45px; text-align: center; font-weight: bold; outline: none;">
        </td>
        <td style="padding: 8px 6px;">
          <select class="modal-step-machine" style="background: #ffffff; color: #000000; border: 1px solid var(--border-glass); padding: 4px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; width: 100%; outline: none; cursor: pointer;">
            ${wcOptions}
          </select>
        </td>
        <td style="padding: 8px 6px;">
          <input type="text" class="modal-step-name" value="${stepData.name || ''}" placeholder="Operation name" style="background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 4px 6px; border-radius: 4px; font-size: 10px; width: 100%; outline: none;">
        </td>
        <td style="padding: 8px 4px; text-align: center;">
          <input type="number" class="modal-step-setup" value="${stepData.setupMinutes !== undefined ? stepData.setupMinutes : 0}" min="0" step="1" style="background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 4px; border-radius: 4px; font-size: 10px; width: 55px; text-align: center; outline: none;">
        </td>
        <td style="padding: 8px 4px; text-align: center;">
          <input type="number" class="modal-step-cycle" value="${stepData.cycleMinutes !== undefined ? stepData.cycleMinutes : 1}" min="0.01" step="0.01" style="background: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 4px; border-radius: 4px; font-size: 10px; width: 65px; text-align: center; outline: none;">
        </td>
        <td style="padding: 8px 4px; text-align: center;">
          <input type="number" class="modal-step-esthours" value="${stepData.estHours !== undefined ? parseFloat((stepData.estHours * 60.0).toFixed(1)) : 60.0}" min="0.1" step="0.1" title="Estimated duration in minutes" style="background: var(--bg-darkest); color: var(--accent-teal); border: 1px solid var(--border-glass); padding: 4px; border-radius: 4px; font-size: 10px; width: 60px; text-align: center; font-weight: bold; outline: none;">
        </td>
        <td style="padding: 8px 6px; text-align: center;">
          ${statusBadgeHtml}
        </td>
        <td style="padding: 8px 6px; text-align: center; white-space: nowrap;">
          ${timeScheduleHtml}
        </td>
        <td style="padding: 8px 4px; text-align: center;">
          <button type="button" class="btn-remove-step-row" title="ลบขั้นตอนนี้" style="background: none; border: none; color: var(--accent-red); cursor: pointer; font-size: 14px; padding: 2px 4px; font-weight: bold; line-height: 1;">✕</button>
        </td>
      `;

      tr.querySelector('.modal-step-setup').addEventListener('input', () => recalculateRowHours(tr));
      tr.querySelector('.modal-step-cycle').addEventListener('input', () => recalculateRowHours(tr));
      tr.querySelector('.modal-step-machine').addEventListener('change', () => recalculateRowHours(tr));
      
      tr.querySelector('.btn-remove-step-row').addEventListener('click', () => {
        tr.remove();
        const curRows = tbody.querySelectorAll('.modal-step-row');
        if (stepCountEl) stepCountEl.textContent = `(รวมทั้งหมด ${curRows.length} ขั้นตอน)`;
      });

      tbody.appendChild(tr);
    };

    stepsList.forEach(stepData => renderStepRow(stepData));

    // Listen on Qty changes to update all step hours
    const handleQtyChange = () => {
      const rows = tbody.querySelectorAll('.modal-step-row');
      rows.forEach(r => recalculateRowHours(r));
    };
    const cleanInputQty = inputQty.cloneNode(true);
    inputQty.parentNode.replaceChild(cleanInputQty, inputQty);
    cleanInputQty.addEventListener('input', handleQtyChange);

    // Add Step button handler
    if (btnAddStep) {
      const cleanBtnAdd = btnAddStep.cloneNode(true);
      btnAddStep.parentNode.replaceChild(cleanBtnAdd, btnAddStep);
      cleanBtnAdd.addEventListener('click', () => {
        const rows = tbody.querySelectorAll('.modal-step-row');
        let maxStepNum = 0;
        rows.forEach(r => {
          const num = parseInt(r.querySelector('.modal-step-num').value) || 0;
          if (num > maxStepNum) maxStepNum = num;
        });
        const nextNum = maxStepNum + 10;
        const curQty = parseFloat(cleanInputQty.value) || 100;
        const defaultSetup = 0;
        const defaultCycle = 1.0;
        const defaultHours = parseFloat(((defaultSetup + curQty * defaultCycle) / 60.0).toFixed(2)) || 1.0;

        renderStepRow({
          id: `${woId}-${nextNum}`,
          stepNum: nextNum,
          name: 'New Operation',
          machine: 'DEA012',
          setupMinutes: defaultSetup,
          cycleMinutes: defaultCycle,
          estHours: defaultHours,
          status: 'Unscheduled',
          startHour: null,
          isScheduled: false
        });

        const newCount = tbody.querySelectorAll('.modal-step-row').length;
        if (stepCountEl) stepCountEl.textContent = `(รวมทั้งหมด ${newCount} ขั้นตอน)`;
      });
    }

    // Save Changes button handler
    if (btnSave) {
      const cleanBtnSave = btnSave.cloneNode(true);
      btnSave.parentNode.replaceChild(cleanBtnSave, btnSave);
      cleanBtnSave.addEventListener('click', () => {
        const customerVal = inputCustomer.value.trim() || 'General';
        const projectVal = inputProject.value.trim() || 'General';
        const dwgNoVal = inputDwgNo.value.trim() || '';
        const partNameVal = inputPartName.value.trim() || '';
        const qtyVal = parseInt(cleanInputQty.value) || 1;
        const priorityVal = inputPriority.value.trim() || 'Normal';
        
        let dueHourVal = dueHour;
        if (inputTargetDate && inputTargetDate.value) {
          const [y, m, d] = inputTargetDate.value.split('-').map(Number);
          const dDue = new Date(y, m - 1, d, 17, 0, 0); // 17:00 deadline
          dueHourVal = this.state.dateToWorkingHour(dDue);
        }

        const stepRows = tbody.querySelectorAll('.modal-step-row');
        if (stepRows.length === 0) {
          alert('ต้องมีขั้นตอนการผลิตอย่างน้อย 1 ขั้นตอน');
          return;
        }

        const collectedSteps = [];
        stepRows.forEach(row => {
          const stepId = row.getAttribute('data-step-id');
          const stepNum = parseInt(row.querySelector('.modal-step-num').value) || 10;
          const machine = row.querySelector('.modal-step-machine').value;
          const name = row.querySelector('.modal-step-name').value.trim() || (this.state.workCenters[machine]?.name || machine);
          const setupMinutes = parseFloat(row.querySelector('.modal-step-setup').value) || 0;
          const cycleMinutes = parseFloat(row.querySelector('.modal-step-cycle').value) || 1;
          const estHours = (parseFloat(row.querySelector('.modal-step-esthours').value) || 6.0) / 60.0;

          collectedSteps.push({
            id: stepId || `${woId}-${stepNum}`,
            stepNum,
            machine,
            name,
            setupMinutes,
            cycleMinutes,
            estHours
          });
        });

        this.state.updateProductionOrder(woId, {
          customer: customerVal,
          project: projectVal,
          dwgNo: dwgNoVal,
          partName: partNameVal,
          qty: qtyVal,
          priority: priorityVal,
          dueHour: dueHourVal,
          steps: collectedSteps
        });

        modal.classList.add('hidden');
        this.showToast(`✓ บันทึกข้อมูล Production Order ${woId} สำเร็จ`);
      });
    }

    // Delete PD button handler
    if (btnDelete) {
      const cleanBtnDelete = btnDelete.cloneNode(true);
      btnDelete.parentNode.replaceChild(cleanBtnDelete, btnDelete);
      cleanBtnDelete.addEventListener('click', () => {
        if (confirm(`คุณต้องการลบ Production Order: ${woId} นี้ใช่หรือไม่?\n(การลบจะนำขั้นตอนและข้อมูลทั้งหมดของ PD นี้ออกจากระบบ)`)) {
          this.state.deleteProductionOrder(woId);
          modal.classList.add('hidden');
          this.showToast(`🗑️ ลบ Production Order ${woId} เรียบร้อยแล้ว`);
        }
      });
    }

    // Export CSV button handler
    if (btnExport) {
      const cleanBtnExport = btnExport.cloneNode(true);
      btnExport.parentNode.replaceChild(cleanBtnExport, btnExport);
      cleanBtnExport.addEventListener('click', () => {
        const stepRows = tbody.querySelectorAll('.modal-step-row');
        const jobsForExport = [];
        stepRows.forEach(row => {
          const stepNum = parseInt(row.querySelector('.modal-step-num').value) || 10;
          const machine = row.querySelector('.modal-step-machine').value;
          const stepName = row.querySelector('.modal-step-name').value.trim();
          const estHours = (parseFloat(row.querySelector('.modal-step-esthours').value) || 6.0) / 60.0;

          const sched = scheduledJobs.find(j => j.stepNum === stepNum);

          jobsForExport.push({
            woId: woId,
            customer: inputCustomer.value.trim() || 'General',
            partName: inputPartName.value.trim() || '',
            qty: parseInt(cleanInputQty.value) || 1,
            stepNum: stepNum,
            stepName: stepName,
            machine: machine,
            estHours: estHours,
            startHour: sched ? sched.startHour : null,
            status: sched ? sched.status : 'Unscheduled'
          });
        });
        this.exportPDPlanToCSV(woId, jobsForExport);
      });
    }

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
      let startDateStr = '-';
      let startTimeStr = '-';
      let endDateStr = '-';
      let endTimeStr = '-';

      if (job.startHour !== null && job.startHour !== undefined) {
        const dStart = workingHourToDate(job.startHour);
        const dEnd = workingHourToDate(job.startHour + (job.estHours || 1));
        startDateStr = dStart.toLocaleDateString('en-GB');
        startTimeStr = dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        endDateStr = dEnd.toLocaleDateString('en-GB');
        endTimeStr = dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      }
      
      return [
        job.woId || job.id,
        job.customer || 'General',
        job.partName || '',
        job.qty || 1,
        `Step ${job.stepNum}`,
        job.stepName || "",
        job.machine,
        job.estHours,
        startDateStr,
        startTimeStr,
        endDateStr,
        endTimeStr,
        job.status || 'Unscheduled'
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
