// MIE Trak Pro - Production Scheduling Central State
import { Scheduler, getPriorityWeight } from './scheduler.js';
import { isJobPriorityVisible, isJobProjectVisible, isJobPdRangeVisible } from './gantt.js';

class CentralState {
  constructor() {
    this.subscribers = [];
    
    // Configurable scheduling model: 'whiteboard' | 'finite' | 'infinite'
    this.schedulingModel = 'finite';
    
    // Active time scale: 'hr' | 'day' | 'week' | 'month'
    this.activeScale = 'day';
    
    // Whether to show all Work Centers or only active ones
    this.showAllWorkCenters = false;

    // Gantt display mode: 'wc' (Work Center) | 'pd' (Production Order)
    this.ganttMode = 'wc';
    
    // Active priority filters (defaults to true for all keys)
    this.activePriorities = {};
    this.priorityColors = {};
    
    // Active project/SO filters (defaults to true for all keys)
    this.activeProjects = {};
    this.projectColors = {};

    // Active PD Ranges
    this.activePdRanges = [];

    // Manually selected Work Centers to show on the board (defaults to true for all keys)
    this.activeWorkCenters = {};
    
    // Locked projects to prevent moving or rescheduling
    this.lockedProjects = {};
    
    // Initial Quotes (ready to be converted to Work Orders)
    this.quotes = [
      { 
        id: 'Q-901', 
        customer: 'Aerospace Dynamics', 
        partName: 'Titanium Flange', 
        qty: 150, 
        priority: 'Normal', 
        price: '$4,500',
        steps: [
          { stepNum: 10, name: 'Laser Profile Cut', machine: 'DEA012', estHours: 1.5 },
          { stepNum: 20, name: 'Precision CNC Turn', machine: 'DEA021', estHours: 2.5 }
        ]
      },
      { 
        id: 'Q-902', 
        customer: 'Tesla Motors', 
        partName: 'Battery Bracket', 
        qty: 500, 
        priority: 'Normal', 
        price: '$2,800',
        steps: [
          { stepNum: 10, name: 'Nest Sheet Cut', machine: 'DEA012', estHours: 2.0 }
        ]
      },
      { 
        id: 'Q-903', 
        customer: 'Quantum Medical', 
        partName: 'Surgical Pivot', 
        qty: 80, 
        priority: 'Hot', 
        price: '$6,200',
        steps: [
          { stepNum: 10, name: 'Laser Cut', machine: 'DEA012', estHours: 1.0 },
          { stepNum: 20, name: 'CNC Precision Mill', machine: 'DEA023', estHours: 2.0 }
        ]
      }
    ];

    // Work Orders Backlog (Unscheduled)
    this.workOrders = [];

    // Scheduled Work Order Steps (Initially Scheduled)
    this.scheduledJobs = [];

    // Nesting groups (Work Orders grouped together for Laser Cutting)
    this.nests = {};

    // Work Centers / Machines metadata
    this.workCenters = {
      'DEA012': { capacity: 1, color: 'var(--accent-teal)', name: 'CNC Laser' },
      'DEA013': { capacity: 1, color: 'var(--accent-purple)', name: 'CNC ตัดแก๊ส' },
      'DEA016': { capacity: 1, color: 'var(--accent-blue)', name: 'CNC Laser 2' },
      'DEA021': { capacity: 1, color: 'var(--accent-cyan)', name: 'CNC TL2 2' },
      'DEA022': { capacity: 1, color: 'var(--accent-red)', name: 'CNC ST30' },
      'DEA023': { capacity: 1, color: 'var(--accent-orange)', name: 'CNC VF7' },
      'DEA024': { capacity: 1, color: 'var(--accent-magenta)', name: 'CNC VF4' },
      'DEA025': { capacity: 1, color: 'var(--accent-green)', name: 'CNC HDT1870' },
      'DEA026': { capacity: 1, color: 'var(--accent-teal)', name: 'CNC TM3' },
      'DEA027': { capacity: 1, color: 'var(--accent-cyan)', name: 'CNC CK6' },
      'DEA042': { capacity: 1, color: 'var(--accent-purple)', name: 'เครื่องอัดไฮดรอลิก RAS306 30T' },
      'DEA051': { capacity: 1, color: 'var(--accent-blue)', name: 'เจาะ' },
      'DEA052': { capacity: 1, color: 'var(--accent-cyan)', name: 'TAP' },
      'DEA062': { capacity: 1, color: 'var(--accent-red)', name: 'ปรับแต่ง' },
      'DEB013': { capacity: 1, color: 'var(--accent-orange)', name: 'เชื่อม CO2 WD' },
      'DEB021': { capacity: 1, color: 'var(--accent-magenta)', name: 'ทำสี' },
      'DEB011': { capacity: 1, color: 'var(--accent-green)', name: 'เชื่อม ROBOT WD' },
      'DEC001': { capacity: 1, color: 'var(--accent-teal)', name: 'ASSY ประกอบแมคคานิก' },
      'DEA011': { capacity: 1, color: 'var(--accent-purple)', name: 'เลื่อย' },
      'DEA032': { capacity: 1, color: 'var(--accent-blue)', name: 'กัดเฟือง - HOB' },
      'DEA031': { capacity: 1, color: 'var(--accent-cyan)', name: 'พับ' },
      'SUB036': { capacity: 1, color: 'var(--accent-red)', name: 'หุ้มยาง' },
      'DEA041': { capacity: 1, color: 'var(--accent-orange)', name: 'เครื่องอัดไฮดรอลิก ไฟฟ่า 100T' },
      'DEA033': { capacity: 1, color: 'var(--accent-magenta)', name: 'ชุบแข็ง' },
      'SUB002': { capacity: 1, color: 'var(--accent-green)', name: 'ชุบแข็ง' },
      'SUB002-2': { capacity: 1, color: 'var(--accent-teal)', name: 'รมดำ' },
      'SUB038': { capacity: 1, color: 'var(--accent-purple)', name: 'ชุบชิงค์' },
      'SUB029': { capacity: 1, color: 'var(--accent-blue)', name: 'ชุบชิงค์' },
      'DEB012': { capacity: 1, color: 'var(--accent-cyan)', name: 'เชื่อม ARGON WD' },
      'SUB031': { capacity: 1, color: 'var(--accent-red)', name: 'หุ้มยาง' },
      'DEA015': { capacity: 1, color: 'var(--accent-orange)', name: 'Plasma Cutting' },
      'SUB020': { capacity: 1, color: 'var(--accent-magenta)', name: 'จ้างผลิตชิ้นงาน(ไม่รวมMAT)' },
      'SUB020-2': { capacity: 1, color: 'var(--accent-green)', name: 'กัดเฟือง (HOB)' },
      'DED001': { capacity: 1, color: 'var(--accent-teal)', name: 'ASSY ประกอบไฟฟ้า' },
      'DEA017': { capacity: 1, color: 'var(--accent-purple)', name: 'เลื่อย 2' },
      'SUB027': { capacity: 1, color: 'var(--accent-blue)', name: 'WIRE CUT' },
      'SUB027-2': { capacity: 1, color: 'var(--accent-cyan)', name: 'กัดเฟือง (HOB)' },
      'SUB027-3': { capacity: 1, color: 'var(--accent-red)', name: 'ชุบแข็ง' },
      'SUB001': { capacity: 1, color: 'var(--accent-orange)', name: 'ชุบชิงค์' },
      'SUB007': { capacity: 1, color: 'var(--accent-magenta)', name: 'หุ้มยาง' },
      'SUB005': { capacity: 1, color: 'var(--accent-green)', name: 'หุ้มยาง' },
      'SUB026': { capacity: 1, color: 'var(--accent-teal)', name: 'งานกลึง-ภายนอก' },
      'SUB043': { capacity: 1, color: 'var(--accent-purple)', name: 'Color Powder Coat' },
      'SUB044': { capacity: 1, color: 'var(--accent-blue)', name: 'ตัด(ภายนอก)' },
      'DEB014': { capacity: 1, color: 'var(--accent-cyan)', name: 'เชื่อมไฟฟ้า WD' },
      'SUB004': { capacity: 1, color: 'var(--accent-red)', name: 'เจียรไน' },
      'SUB004-2': { capacity: 1, color: 'var(--accent-orange)', name: 'WIRE CUT' },
      'DM0001': { capacity: 1, color: 'var(--accent-magenta)', name: 'Install machine' },
      'DEA061': { capacity: 1, color: 'var(--accent-green)', name: 'พ่นทราย' },
      'SUB039': { capacity: 1, color: 'var(--accent-teal)', name: 'ชุบ Hot Dip Galvanized' }
    };

    this.workCenterOrder = [
      'DEA012', 'DEA013', 'DEA016', 'DEA021', 'DEA022', 'DEA023', 'DEA024', 'DEA025', 'DEA026', 'DEA027',
      'DEA042', 'DEA051', 'DEA052', 'DEA062', 'DEB013', 'DEB021', 'DEB011', 'DEC001', 'DEA011', 'DEA032',
      'DEA031', 'SUB036', 'DEA041', 'DEA033', 'SUB002', 'SUB002-2', 'SUB038', 'SUB029', 'DEB012', 'SUB031',
      'DEA015', 'SUB020', 'SUB020-2', 'DED001', 'DEA017', 'SUB027', 'SUB027-2', 'SUB027-3', 'SUB001', 'SUB007',
      'SUB005', 'SUB026', 'SUB043', 'SUB044', 'DEB014', 'SUB004', 'SUB004-2', 'DM0001', 'DEA061', 'SUB039'
    ];

    // Employees with their skills
    this.employees = [
      { name: 'John Doe', activeMachine: 'DEA023', skills: { 'DEA023': 'Expert', 'DEA012': 'Intermediate' }, status: 'Active' },
      { name: 'Sarah Connor', activeMachine: 'DEA025', skills: { 'DEA025': 'Expert', 'DEA026': 'Expert' }, status: 'Active' },
      { name: 'Marcus Wright', activeMachine: 'DEA012', skills: { 'DEA012': 'Expert' }, status: 'Active' },
      { name: 'Ellen Ripley', activeMachine: 'DEA026', skills: { 'DEA026': 'Expert', 'DEA027': 'Intermediate' }, status: 'Active' },
      { name: 'Kyle Reese', activeMachine: 'DEA024', skills: { 'DEA024': 'Intermediate' }, status: 'Active' }
    ];

    // Active Kiosk Machine filter (which machine is viewed at the Shop Floor Kiosk)
    this.kioskMachine = 'DEA012';

    // History stacks for Undo/Redo (limit 3 steps)
    this.undoStack = [];
    this.redoStack = [];
    this.timelineOffset = 0.0;
    this.assemblyLinks = [];
    this.showDependencyLines = false;

    // Load backlog and plan on startup
    this.loadWorkOrdersFromFile();
    this.loadPlanFromFile();
  }

  toggleDependencyLines() {
    this.showDependencyLines = !this.showDependencyLines;
    this.notify();
  }

  getMachineRate(machine) {
    const rates = {
      'DEA012': 100,
      'DEA023': 120,
      'DEA025': 80,
      'DEA026': 50,
      'DEA024': 60,
      'DEA027': 70
    };
    return rates[machine] || 50;
  }

  calculatePlannedCost(item) {
    const qty = item.qty || 100;
    const materialCost = qty * 5;
    const stepsCost = (item.steps || []).reduce((sum, step) => sum + (step.estHours * this.getMachineRate(step.machine)), 0);
    return materialCost + stepsCost;
  }

  calculateRevenue(item) {
    if (item.revenue) return item.revenue;
    if (item.price) {
      return parseFloat(item.price.replace(/[^0-9.]/g, '')) || 2500;
    }
    return (item.qty || 100) * 25;
  }

  calculateJobActualCost(job) {
    const totalSteps = job.totalStepsCount || 2;
    const materialCost = (job.qty * 5) / totalSteps;
    const machineRate = this.getMachineRate(job.machine);
    const actualHours = (job.elapsedMinutes || 0) / 60;
    const scrapCost = (job.scrapQty || 0) * 15;
    return materialCost + (actualHours * machineRate) + scrapCost;
  }

  findEarliestAvailableSlot(machine, duration, minStart, scale) {
    const jobs = this.scheduledJobs.filter(j => j.machine === machine);
    const intervals = jobs.map(j => ({
      start: j.startHour,
      end: j.startHour + j.estHours
    })).sort((a, b) => a.start - b.start);

    let t = minStart;
    let i = 0;
    while (i < intervals.length) {
      // Adjust t to working hours
      const adjusted = Scheduler.adjustToWorkingHours(t, duration, false, scale);
      if (adjusted !== t) {
        t = adjusted;
        i = 0; // Restart check
        continue;
      }

      const inv = intervals[i];
      // Check if [t, t + duration] overlaps with inv
      if (!(t + duration <= inv.start || t >= inv.end)) {
        t = inv.end;
        i = 0; // Restart check
        continue;
      }
      i++;
    }
    return parseFloat(t.toFixed(1));
  }

  simulateQuoteImpact(quoteId) {
    const quote = this.quotes.find(q => q.id === quoteId);
    if (!quote) return null;

    const scale = this.activeScale;
    const config = this.getScaleConfig(scale);
    const startOffset = config.startOffset;

    let currentMinStart = startOffset;
    const simulatedQuoteJobs = [];

    quote.steps.forEach(step => {
      const startHour = this.findEarliestAvailableSlot(step.machine, step.estHours, currentMinStart, scale);
      const simulatedJob = {
        id: `${quote.id}-${step.stepNum}`,
        woId: quote.id,
        customer: quote.customer,
        partName: quote.partName,
        qty: quote.qty,
        estHours: step.estHours,
        priority: quote.priority,
        machine: step.machine,
        startHour: startHour,
        status: 'Scheduled',
        elapsedMinutes: 0,
        stepNum: step.stepNum,
        stepName: step.name,
        originalMachine: step.machine
      };
      simulatedQuoteJobs.push(simulatedJob);
      currentMinStart = startHour + step.estHours;
    });

    const combinedJobs = [
      ...this.scheduledJobs.map(j => ({ ...j })),
      ...simulatedQuoteJobs
    ];

    const workloadsBefore = {};
    const workloadsAfter = {};

    Object.keys(this.workCenters).forEach(machine => {
      const beforeHours = this.scheduledJobs.filter(j => j.machine === machine).reduce((sum, j) => sum + j.estHours, 0);
      const afterHours = combinedJobs.filter(j => j.machine === machine).reduce((sum, j) => sum + j.estHours, 0);

      let capacity = (scale === 'hr' ? 12.0 : config.totalHours);
      
      workloadsBefore[machine] = Math.round((beforeHours / capacity) * 100);
      workloadsAfter[machine] = Math.round((afterHours / capacity) * 100);
    });

    const bottlenecks = Object.keys(workloadsAfter).filter(m => workloadsAfter[m] > 100);

    let estFinishHour = 0;
    if (simulatedQuoteJobs.length > 0) {
      estFinishHour = Math.max(...simulatedQuoteJobs.map(j => j.startHour + j.estHours));
    }

    return {
      quote,
      workloadsBefore,
      workloadsAfter,
      bottlenecks,
      estFinishHour
    };
  }

  reportActualProgress(jobId, status, elapsedMinutes, actualQty, scrapQty) {
    this.saveStateToHistory();
    const job = this.scheduledJobs.find(j => j.id === jobId);
    if (!job) return false;

    job.status = status;
    job.elapsedMinutes = parseInt(elapsedMinutes) || 0;
    job.scrapQty = parseInt(scrapQty) || 0;
    
    job.actualCost = this.calculateJobActualCost(job);

    this.notify();
    this.dispatchHistoryEvent();
    return true;
  }

  // Subscribe to state changes
  subscribe(callback) {
    this.subscribers.push(callback);
  }

  getMachineDisplayName(machine) {
    const wc = this.workCenters[machine];
    if (wc && wc.name) {
      return `${machine} - ${wc.name}`;
    }
    return machine;
  }

  updateWorkCenters(newWorkCenters, newOrder) {
    this.saveStateToHistory();
    this.workCenters = newWorkCenters;
    this.workCenterOrder = newOrder;
    
    // Recalculate estHours for all scheduled jobs based on the updated machine capacities
    this.scheduledJobs.forEach(job => {
      const cap = this.workCenters[job.machine]?.capacity || 1;
      const setup = job.setupMinutes !== undefined ? job.setupMinutes : 0;
      const cycle = job.cycleMinutes !== undefined ? job.cycleMinutes : 1;
      job.estHours = parseFloat(((setup + job.qty * cycle) / 60.0 / cap).toFixed(2)) || 0.1;
    });

    // Recalculate estHours for all backlog steps based on the updated machine capacities
    this.workOrders.forEach(wo => {
      wo.steps.forEach(step => {
        const cap = this.workCenters[step.machine]?.capacity || 1;
        const setup = step.setupMinutes !== undefined ? step.setupMinutes : 0;
        const cycle = step.cycleMinutes !== undefined ? step.cycleMinutes : 1;
        step.estHours = parseFloat(((setup + wo.qty * cycle) / 60.0 / cap).toFixed(2)) || 0.1;
      });
    });

    this.savePlanToFile();
    this.notify();
  }

  // Notify all subscribers
  notify() {
    this.subscribers.forEach(callback => callback(this));
    
    // Debounced save to pd.md and plan.md
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      this.saveWorkOrdersToFile();
      this.savePlanToFile();
    }, 500);
  }

  // Switch scheduling model
  setSchedulingModel(model) {
    this.schedulingModel = model;
    this.notify();
  }

  // Switch Gantt display mode
  setGanttMode(mode) {
    this.ganttMode = mode;
    this.notify();
  }

  // Set active time scale
  setActiveScale(scale) {
    this.activeScale = scale;

    // Auto-scroll timeline view to center on the current working hour for the new time scale
    const now = new Date();
    const nowWorkingHour = this.dateToWorkingHour(now);

    // Recalculate scheduledJobs to fit the new scale bounds if not in manual whiteboard mode
    if (this.schedulingModel === 'infinite') {
      this.scheduledJobs = Scheduler.applyBackwardsInfinite(this.scheduledJobs, scale);
    } else if (this.schedulingModel === 'finite') {
      this.scheduledJobs = Scheduler.applyForwardsFinite(this.scheduledJobs, scale, nowWorkingHour, this.workCenters);
    }

    const config = this.getScaleConfig(scale);
    const targetOffset = nowWorkingHour - config.totalHours / 3;
    const snap = config.snapHours;
    this.timelineOffset = Math.round(targetOffset / snap) * snap;
    
    this.notify();
  }

  reorderWorkCenters(draggedName, targetName) {
    const fromIdx = this.workCenterOrder.indexOf(draggedName);
    const toIdx = this.workCenterOrder.indexOf(targetName);
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
      this.saveStateToHistory();
      this.workCenterOrder.splice(fromIdx, 1);
      this.workCenterOrder.splice(toIdx, 0, draggedName);
      this.notify();
    }
  }

  // Set timeline horizontal scroll offset
  setTimelineOffset(offset) {
    this.timelineOffset = offset;
    this.notify();
  }

  // Reset timeline scroll offset to 0
  resetTimelineOffset() {
    this.timelineOffset = 0.0;
    this.notify();
  }

  // Update a Work Order's Delivery Target (dueHour) and propagate to all its steps and scheduled jobs
  updateWorkOrderDueHour(woId, dueHour) {
    this.saveStateToHistory();
    
    // 1. Update in backlog workOrders
    const wo = this.workOrders.find(w => w.id === woId);
    if (wo) {
      wo.dueHour = dueHour;
      wo.steps.forEach(step => {
        step.dueHour = dueHour;
      });
    }
    
    // 2. Update in scheduledJobs
    this.scheduledJobs.forEach(job => {
      if (job.woId === woId) {
        job.dueHour = dueHour;
      }
    });
    
    this.notify();
    this.dispatchHistoryEvent();
  }

  // Import a complete production plan
  importPlan(planData) {
    this.saveStateToHistory();
    
    if (planData.scheduledJobs) this.scheduledJobs = planData.scheduledJobs;
    if (planData.workOrders) this.workOrders = planData.workOrders;
    if (planData.nests) this.nests = planData.nests;
    if (planData.schedulingModel) this.schedulingModel = planData.schedulingModel;
    if (planData.activeScale) this.activeScale = planData.activeScale;
    if (planData.timelineOffset !== undefined) this.timelineOffset = planData.timelineOffset;
    if (planData.priorityColors) this.priorityColors = planData.priorityColors;
    if (planData.projectColors) this.projectColors = planData.projectColors;
    
    this.notify();
    this.dispatchHistoryEvent();
  }

  // Helper to parse step ID and return parent WO ID and step number
  parseStepId(stepId) {
    const parts = stepId.split('-');
    if (parts[0].startsWith('PD')) {
      return { woId: parts[0], stepNum: parseInt(parts[1]) };
    } else if (parts[0] === 'WO' || parts[0] === 'Q') {
      return { woId: `${parts[0]}-${parts[1]}`, stepNum: parseInt(parts[2]) };
    } else {
      return { woId: parts[0], stepNum: parseInt(parts[1]) || 10 };
    }
  }

  // Convert Quote to Production Order
  convertQuote(quoteId) {
    const idx = this.quotes.findIndex(q => q.id === quoteId);
    if (idx !== -1) {
      const quote = this.quotes[idx];
      this.quotes.splice(idx, 1);
      
      const newWOId = 'PD' + String(310 + Math.floor(Math.random() * 500)).padStart(7, '0');
      const newWO = {
        id: newWOId,
        customer: quote.customer,
        partName: quote.partName,
        qty: quote.qty,
        priority: quote.priority,
        status: 'Unscheduled',
        delayReason: '',
        dueHour: 72.0, // Default due hour
        revenue: this.calculateRevenue(quote),
        plannedCost: this.calculatePlannedCost(quote),
        totalStepsCount: quote.steps.length,
        steps: quote.steps.map(step => ({
          id: `${newWOId}-${step.stepNum}`,
          stepNum: step.stepNum,
          name: step.name,
          machine: step.machine,
          estHours: step.estHours,
          status: 'Unscheduled',
          startHour: null,
          plannedCost: (quote.qty * 5 / quote.steps.length) + (step.estHours * this.getMachineRate(step.machine))
        }))
      };
      this.workOrders.push(newWO);
      this.notify();
      return newWO;
    }
    return null;
  }

  // Check if a step's prior operations are incomplete (blocks start in Kiosk)
  isStepBlocked(stepId) {
    const { woId, stepNum } = this.parseStepId(stepId);

    // Find any scheduled prior step that is NOT Completed
    const priorScheduled = this.scheduledJobs.some(j => 
      j.woId === woId && j.stepNum < stepNum && j.status !== 'Completed'
    );

    // Find if there is any prior step still sitting in the backlog
    const parentWO = this.workOrders.find(wo => wo.id === woId);
    const priorUnscheduled = parentWO ? parentWO.steps.some(s => s.stepNum < stepNum) : false;

    return priorScheduled || priorUnscheduled;
  }

  // Check if a step can be scheduled on Gantt board based on routing sequence
  canScheduleStep(stepId) {
    // If it's already scheduled, it is allowed to be rescheduled (moved)
    if (this.scheduledJobs.some(j => j.id === stepId)) {
      return true;
    }
    
    const { woId, stepNum } = this.parseStepId(stepId);
    
    const parentWO = this.workOrders.find(wo => wo.id === woId);
    if (!parentWO) return true;
    
    // Check if there is any step in this WO's backlog that has a lower stepNum
    const hasPriorInBacklog = parentWO.steps.some(s => s.stepNum < stepNum);
    return !hasPriorInBacklog;
  }

  // Find the lowest step number in the backlog for this step's parent WO
  getLowestBacklogStepNum(stepId) {
    const { woId } = this.parseStepId(stepId);
    const parentWO = this.workOrders.find(wo => wo.id === woId);
    if (!parentWO) return null;
    
    let minStepNum = Infinity;
    parentWO.steps.forEach(s => {
      if (s.stepNum < minStepNum) {
        minStepNum = s.stepNum;
      }
    });
    return minStepNum === Infinity ? null : minStepNum;
  }

  // Get the maximum step number of a WO across backlog and scheduled
  getLastStepNum(woId) {
    let maxStep = 0;
    this.scheduledJobs.forEach(j => {
      if (j.woId === woId && j.stepNum > maxStep) {
        maxStep = j.stepNum;
      }
    });
    const wo = this.workOrders.find(w => w.id === woId);
    if (wo) {
      wo.steps.forEach(s => {
        if (s.stepNum > maxStep) {
          maxStep = s.stepNum;
        }
      });
    }
    return maxStep;
  }

  getBaseDate() {
    return new Date(2026, 5, 22, 8, 0, 0); // Fixed epoch: Mon June 22 2026 8:00
  }

  getStartOfDayBase() {
    const bd = this.getBaseDate();
    return new Date(bd.getFullYear(), bd.getMonth(), bd.getDate(), 0, 0, 0);
  }

  workingHourToDate(workingHour) {
    const baseDate = this.getBaseDate();
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

  dateToWorkingHour(date) {
    const baseDate = this.getBaseDate();
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfDayBase = this.getStartOfDayBase();
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

  // Get the scaled due hour based on active scale
  getScaledDueHour(jobOrWo) {
    if (jobOrWo.dueHour === null || jobOrWo.dueHour === undefined || jobOrWo.dueHour === '') return null;
    return jobOrWo.dueHour;
  }

  updateWorkOrderDueHour(woId, newDueHour) {
    this.saveStateToHistory();
    // 1. Update in backlog workOrders
    const wo = this.workOrders.find(w => w.id === woId);
    if (wo) {
      if (wo.originalDueHour === undefined) {
        wo.originalDueHour = wo.dueHour;
      }
      wo.dueHour = newDueHour;
    }
    // 2. Update in scheduledJobs for all steps of this WO
    this.scheduledJobs.forEach(j => {
      if (j.woId === woId || j.id === woId) {
        if (j.originalDueHour === undefined) {
          j.originalDueHour = j.dueHour;
        }
        j.dueHour = newDueHour;
      }
    });
    this.notify();
  }

  getDayNameAndDate(hourFloat) {
    const dObj = this.workingHourToDate(hourFloat);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayLabel = days[dObj.getDay()];
    const d = dObj.getDate();
    const m = dObj.getMonth() + 1;
    const y = dObj.getFullYear();
    const dd = d.toString().padStart(2, '0');
    const mm = m.toString().padStart(2, '0');
    return `${dayLabel}, ${dd}/${mm}/${y}`;
  }

  // Get scale configurations (totalHours, startOffset, snapHours)
  getScaleConfig(scale) {
    switch (scale) {
      case 'min1':
        return { totalHours: 15.0 / 60.0, startOffset: 0.0, snapHours: 1.0 / 60.0 };
      case 'min5':
        return { totalHours: 1.0, startOffset: 0.0, snapHours: 5.0 / 60.0 };
      case 'min15':
        return { totalHours: 2.0, startOffset: 0.0, snapHours: 15.0 / 60.0 };
      case 'min30':
        return { totalHours: 4.0, startOffset: 0.0, snapHours: 0.5 };
      case 'day':
        return { totalHours: 48.0, startOffset: 0.0, snapHours: 1.0 };
      case 'week':
        return { totalHours: 192.0, startOffset: 0.0, snapHours: 8.0 };
      case 'month':
        return { totalHours: 576.0, startOffset: 0.0, snapHours: 16.0 };
      case 'quarter':
        return { totalHours: 1728.0, startOffset: 0.0, snapHours: 48.0 };
      case 'year':
        return { totalHours: 6912.0, startOffset: 0.0, snapHours: 192.0 };
      case 'hr':
      default:
        return { totalHours: 8.0, startOffset: 0.0, snapHours: 0.5 };
    }
  }

  // Simulated Forwards Finite scheduling pass
  simulateForwardsFinite(jobs) {
    const scale = this.activeScale;
    const startOffset = (scale === 'hr' ? 8.0 : 0.0);
    const machineTime = {};
    const woTime = {};

    const sortedJobs = [...jobs].sort((a, b) => {
      const pA = getPriorityWeight(a.priority);
      const pB = getPriorityWeight(b.priority);
      if (pA !== pB) return pA - pB;
      if (a.woId && b.woId && a.woId === b.woId) {
        return a.stepNum - b.stepNum;
      }
      if (a.startHour !== b.startHour) {
        return a.startHour - b.startHour;
      }
      return a.id.localeCompare(b.id);
    });

    const result = sortedJobs.map(j => {
      const mTime = machineTime[j.machine] || startOffset;
      const wTime = j.woId ? (woTime[j.woId] || startOffset) : startOffset;

      const start = Math.max(j.startHour, mTime, wTime);
      const end = start + j.estHours;
      
      machineTime[j.machine] = end;
      if (j.woId) {
        woTime[j.woId] = end;
      }
      
      return {
        ...j,
        startHour: parseFloat(start.toFixed(1))
      };
    });

    return result;
  }

  // Find the earliest valid start hour for a job and apply the shifted schedule
  findEarliestStartHourAndSchedule(tempJob, startHourCandidate) {
    const scale = this.activeScale;
    const config = this.getScaleConfig(scale);
    const startOffset = config.startOffset;
    const totalHours = config.totalHours;
    const snapHours = config.snapHours;

    // Determine minStart (timeline start offset or after preceding scheduled steps of the same WO)
    let minStart = Math.max(startOffset, startHourCandidate);
    if (tempJob.woId) {
      const priorSteps = this.scheduledJobs.filter(j => j.woId === tempJob.woId && j.stepNum < tempJob.stepNum);
      if (priorSteps.length > 0) {
        const priorEnd = Math.max(...priorSteps.map(j => j.startHour + j.estHours));
        minStart = Math.max(minStart, priorEnd);
      }
    }
    
    // Keep exact startHourCandidate for contiguous snapping
    minStart = Math.max(startOffset, minStart);

    // Apply standard working hours & overtime shifting (blocking past 20:00, asking for Sunday)
    const adjustedStart = Scheduler.adjustToWorkingHours(minStart, tempJob.estHours, true, scale);
    const shifted = (adjustedStart !== minStart);
    minStart = adjustedStart;

    // Overtime cutoff scales with the machine's own workHoursPerDay instead of a flat
    // 20:00 for everyone - a station configured to run longer per day (e.g. 14h/20h)
    // should be allowed to be scheduled correspondingly later before being blocked.
    const machineWorkHours = (this.workCenters[tempJob.machine]?.workHoursPerDay > 0) ? parseFloat(this.workCenters[tempJob.machine].workHoursPerDay) : 8.0;
    const overtimeCutoff = 12.0 + machineWorkHours; // = 20.0 for the standard 8h/day case

    const dayIndex = Math.floor(minStart / 24);
    const maxHour = (scale === 'hr' ? (dayIndex * 24 + overtimeCutoff) : startOffset + totalHours);

    if (shifted) {
      const dateStr = this.getDayNameAndDate(minStart);
      const event = new CustomEvent('scheduling-blocked', {
        detail: { stepId: tempJob.id, error: `Shifted: Scheduled on ${dateStr} at 08:00 (Next Working Day).` }
      });
      window.dispatchEvent(event);
    }

    if (this.schedulingModel === 'whiteboard') {
      if (scale === 'hr' && (minStart % 24) + tempJob.estHours > overtimeCutoff) {
        const event = new CustomEvent('scheduling-blocked', {
          detail: { stepId: tempJob.id, error: `Cannot schedule past ${overtimeCutoff.toFixed(0)}:00 (Overtime limit reached)!` }
        });
        window.dispatchEvent(event);
        return false;
      }

      const candidateJob = { ...tempJob, startHour: minStart };
      this.scheduledJobs = [...this.scheduledJobs.filter(j => j.id !== tempJob.id), candidateJob];
      this.notify();
      return true;
    }

    if (scale === 'hr' && (minStart % 24) + tempJob.estHours > overtimeCutoff) {
      const event = new CustomEvent('scheduling-blocked', {
        detail: { stepId: tempJob.id, error: `Cannot schedule past ${overtimeCutoff.toFixed(0)}:00 (Overtime limit reached)!` }
      });
      window.dispatchEvent(event);
      return false;
    }

    let bestHour = null;
    let bestSchedule = null;

    // Scan candidate start hours from minStart upwards
    for (let t = minStart; t <= maxHour - tempJob.estHours; t += snapHours) {
      t = parseFloat(t.toFixed(1));
      
      const candidateJob = { ...tempJob, startHour: t };
      const simulatedJobs = [...this.scheduledJobs.filter(j => j.id !== tempJob.id), candidateJob];
      
      const scheduledSim = this.simulateForwardsFinite(simulatedJobs);
      
      // Validate if any job exceeds its due date or is pushed past its original late finish
      let isValid = true;
      for (const simJob of scheduledSim) {
        const scaledDue = this.getScaledDueHour(simJob);
        const finish = simJob.startHour + simJob.estHours;
        
        const origJob = this.scheduledJobs.find(j => j.id === simJob.id);
        const origFinish = origJob ? (origJob.startHour + origJob.estHours) : 0;
        
        const limit = Math.max(origFinish, scaledDue);
        if (finish > limit) {
          isValid = false;
          break;
        }

        const dayIdx = Math.floor(simJob.startHour / 24);
        const simJobWorkHours = (this.workCenters[simJob.machine]?.workHoursPerDay > 0) ? parseFloat(this.workCenters[simJob.machine].workHoursPerDay) : 8.0;
        const simJobOvertimeCutoff = 12.0 + simJobWorkHours;
        if (scale === 'hr' && finish > (dayIdx * 24 + simJobOvertimeCutoff)) {
          isValid = false;
          break;
        }
      }
      
      if (isValid) {
        bestHour = t;
        bestSchedule = scheduledSim;
        break; // Found the earliest valid slot!
      }
    }

    if (bestSchedule) {
      this.scheduledJobs = bestSchedule;
      this.notify();
      return true;
    }

    // Fallback: If no valid slot was found (because of due date constraints),
    // find the first slot that does not cause any overlap at all (a clean gap)
    for (let t = minStart; t <= maxHour - tempJob.estHours; t += snapHours) {
      t = parseFloat(t.toFixed(1));
      const hasOverlap = this.scheduledJobs.some(j => 
        j.id !== tempJob.id && 
        j.machine === tempJob.machine && 
        !(t + tempJob.estHours <= j.startHour || t >= j.startHour + j.estHours)
      );
      if (!hasOverlap) {
        const candidateJob = { ...tempJob, startHour: t };
        this.scheduledJobs = [...this.scheduledJobs.filter(j => j.id !== tempJob.id), candidateJob];
        this.notify();
        return true;
      }
    }

    // Ultimate fallback: Just place it at minStart and push overlapping jobs forward
    const candidateJob = { ...tempJob, startHour: minStart };
    const simulated = this.simulateForwardsFinite([...this.scheduledJobs.filter(j => j.id !== tempJob.id), candidateJob]);
    
    if (scale === 'hr') {
      const exceeds = simulated.some(j => {
        return j.startHour + j.estHours > 9.0;
      });
      if (exceeds) {
        const event = new CustomEvent('scheduling-blocked', {
          detail: { stepId: tempJob.id, error: `Cannot schedule: pushes tasks past 17:00 capacity limit!` }
        });
        window.dispatchEvent(event);
        return false;
      }
    }

    this.scheduledJobs = simulated;
    this.notify();
    return true;
  }

  // Helper to schedule a single routing step
  scheduleSingleStep(stepId, machine, startHour) {
    // Find the step in backlog
    let foundWO = null;
    let foundStepIdx = -1;

    for (let wo of this.workOrders) {
      const idx = wo.steps.findIndex(s => s.id === stepId);
      if (idx !== -1) {
        foundWO = wo;
        foundStepIdx = idx;
        break;
      }
    }

    if (foundWO && foundStepIdx !== -1) {
      const step = foundWO.steps[foundStepIdx];
      foundWO.steps.splice(foundStepIdx, 1);
      
      // If parent WO has no steps left in backlog, remove it
      if (foundWO.steps.length === 0) {
        const woIdx = this.workOrders.indexOf(foundWO);
        this.workOrders.splice(woIdx, 1);
      }

      const tempJob = {
        id: step.id,
        woId: foundWO.id,
        customer: foundWO.customer,
        partName: foundWO.partName,
        dwgNo: foundWO.dwgNo || '',
        qty: step.qty !== undefined ? step.qty : foundWO.qty,
        estHours: step.estHours,
        cycleMinutes: step.cycleMinutes || 0.0,
        setupMinutes: step.setupMinutes || 0.0,
        priority: foundWO.priority,
        project: foundWO.project || '',
        machine: machine,
        startHour: startHour,
        status: 'Scheduled',
        elapsedMinutes: 0,
        stepNum: step.stepNum,
        stepName: step.name,
        delayReason: '',
        dueHour: foundWO.dueHour || 9.0,
        originalDueHour: foundWO.originalDueHour !== undefined ? foundWO.originalDueHour : foundWO.dueHour,
        originalMachine: step.machine,
        totalStepsCount: foundWO.totalStepsCount || foundWO.steps.length + (this.scheduledJobs.filter(j => j.woId === foundWO.id).length || 0) || 2,
        revenue: foundWO.revenue || this.calculateRevenue({ ...foundWO, qty: step.qty !== undefined ? step.qty : foundWO.qty }),
        plannedCost: step.plannedCost || ((step.qty !== undefined ? step.qty : foundWO.qty) * 5 / 2) + (step.estHours * this.getMachineRate(machine)),
        actualCost: ((step.qty !== undefined ? step.qty : foundWO.qty) * 5 / 2),
        scrapQty: 0
      };
      
      return this.findEarliestStartHourAndSchedule(tempJob, startHour);
    }

    // If it was already scheduled, update its position on Gantt
    const scheduledIdx = this.scheduledJobs.findIndex(j => j.id === stepId);
    if (scheduledIdx !== -1) {
      const job = this.scheduledJobs[scheduledIdx];
      
      const tempJob = {
        ...job,
        machine: machine,
        startHour: startHour
      };
      
      return this.findEarliestStartHourAndSchedule(tempJob, startHour);
    }
    return false;
  }

  // Schedule a specific routing step or an entire Work Order
  scheduleJob(stepId, machine, startHour) {
    this.saveStateToHistory();
    const success = this.executeScheduleJob(stepId, machine, startHour);
    if (!success) {
      const snapshot = this.undoStack.pop();
      if (snapshot) {
        this.scheduledJobs = snapshot.scheduledJobs;
        this.workOrders = snapshot.workOrders;
        this.nests = snapshot.nests;
      }
      this.dispatchHistoryEvent();
    } else {
      this.notify();
      this.dispatchHistoryEvent();
    }
    return success;
  }

  executeScheduleJob(stepId, machine, startHour) {
    const isEntireOrder = (stepId.startsWith('PD') && !stepId.includes('-')) || 
                          (stepId.startsWith('WO') && stepId.split('-').length === 2);
    
    // Check if this is a new task being scheduled from the backlog
    const isNewTask = isEntireOrder || !this.scheduledJobs.some(j => j.id === stepId);
    
    const targetWoId = isEntireOrder ? stepId : this.parseStepId(stepId).woId;
    const childMatch = targetWoId.match(/^(.*)-(\d+)$/);
    if (!childMatch && isNewTask) {
      const parentWoId = targetWoId;
      const hasChildInBacklog = this.workOrders.some(wo => {
        const m = wo.id.match(/^(.*)-(\d+)$/);
        return m && m[1] === parentWoId && wo.steps.length > 0;
      });
      if (hasChildInBacklog) {
        const event = new CustomEvent('scheduling-blocked', {
          detail: { stepId, error: `ต้องวางงานตัวลูกทั้งหมดก่อนวางงานตัวแม่ (${parentWoId})! / Must schedule all Child parts first!` }
        });
        window.dispatchEvent(event);
        return false;
      }
    }

    
    // Enforce no scheduling in the past
    const nowWorkingHour = this.dateToWorkingHour(new Date());
    if (startHour < nowWorkingHour - 0.01) {
      const event = new CustomEvent('scheduling-blocked', {
        detail: { stepId, error: `Cannot schedule in the past! Must be placed after the current time.` }
      });
      window.dispatchEvent(event);
      return false;
    }

    // 1. Dragging an entire Production Order
    if (isEntireOrder) {
      const woId = stepId;
      const parentWO = this.workOrders.find(wo => wo.id === woId);
      if (!parentWO) return false;

      // Copy steps so we don't iterate over a mutating array
      const stepsToSchedule = [...parentWO.steps];
      let currentStartHour = startHour;

      for (const step of stepsToSchedule) {
        const success = this.scheduleSingleStep(step.id, step.machine, currentStartHour);
        if (success) {
          currentStartHour += step.estHours;
        } else {
          return false; // If any step fails to schedule, revert the whole WO!
        }
      }
      return true;
    }

    // 2. Dragging a single step
    // Enforce drag restriction: must schedule first step first
    if (!this.canScheduleStep(stepId)) {
      const lowestStep = this.getLowestBacklogStepNum(stepId) || 10;
      const event = new CustomEvent('scheduling-blocked', {
        detail: { stepId, error: `Must schedule Step ${lowestStep} first!` }
      });
      window.dispatchEvent(event);
      return false;
    }

    // Enforce matching work center restriction
    let requiredMachine = null;
    for (let wo of this.workOrders) {
      const s = wo.steps.find(step => step.id === stepId);
      if (s) { requiredMachine = s.machine; break; }
    }
    if (!requiredMachine) {
      const sched = this.scheduledJobs.find(j => j.id === stepId);
      if (sched) {
        requiredMachine = sched.originalMachine || sched.machine;
      }
    }

    if (requiredMachine && machine !== requiredMachine) {
      const event = new CustomEvent('scheduling-blocked', {
        detail: { stepId, error: `Must schedule this step on ${requiredMachine}!` }
      });
      window.dispatchEvent(event);
      return false;
    }

    return this.scheduleSingleStep(stepId, machine, startHour);
  }

  // Unschedule a specific step (returns it back to parent backlog WO)
  unscheduleJob(stepId) {
    this.saveStateToHistory();
    this.executeUnscheduleJob(stepId);
    this.notify();
    this.dispatchHistoryEvent();
  }

  executeUnscheduleJob(stepId) {
    const idx = this.scheduledJobs.findIndex(j => j.id === stepId);
    if (idx !== -1) {
      const step = this.scheduledJobs[idx];
      this.scheduledJobs.splice(idx, 1);
      
      if (step.nestId) {
        this.executeDissolveNest(step.nestId);
      }

      const backlogStep = {
        id: step.id,
        stepNum: step.stepNum,
        name: step.stepName,
        machine: step.machine,
        estHours: step.estHours,
        status: 'Unscheduled',
        startHour: null
      };

      let parentWO = this.workOrders.find(wo => wo.id === step.woId);
      if (parentWO) {
        parentWO.steps.push(backlogStep);
        parentWO.steps.sort((a, b) => a.stepNum - b.stepNum);
      } else {
        this.workOrders.push({
          id: step.woId,
          customer: step.customer,
          partName: step.partName,
          qty: step.qty,
          priority: step.priority,
          status: 'Unscheduled',
          delayReason: '',
          steps: [backlogStep]
        });
      }
      
      // Renumber steps to ensure they are sequential and unique!
      this.renumberWorkOrderSteps(step.woId);
    }
  }

  // Split a specific routing step (splits quantities)
  splitJob(stepId) {
    this.saveStateToHistory();
    const success = this.executeSplitJob(stepId);
    if (!success) {
      const snapshot = this.undoStack.pop();
      if (snapshot) {
        this.scheduledJobs = snapshot.scheduledJobs;
        this.workOrders = snapshot.workOrders;
        this.nests = snapshot.nests;
      }
      this.dispatchHistoryEvent();
    } else {
      this.notify();
      this.dispatchHistoryEvent();
    }
    return success;
  }

  executeSplitJob(stepId) {
    let stepToSplit = null;
    let fromScheduled = false;
    
    // Find step
    let backlogWO = null;
    let backlogStepIdx = -1;
    for (let wo of this.workOrders) {
      const idx = wo.steps.findIndex(s => s.id === stepId);
      if (idx !== -1) {
        backlogWO = wo;
        backlogStepIdx = idx;
        stepToSplit = wo.steps[idx];
        break;
      }
    }

    let scheduledIdx = -1;
    if (!stepToSplit) {
      scheduledIdx = this.scheduledJobs.findIndex(j => j.id === stepId);
      if (scheduledIdx !== -1) {
        stepToSplit = this.scheduledJobs[scheduledIdx];
        fromScheduled = true;
      }
    }

    if (stepToSplit && !stepToSplit.nestId) {
      // Split qty
      const qty = fromScheduled ? stepToSplit.qty : backlogWO.qty;
      if (qty <= 1) return false;

      const qty1 = Math.floor(qty / 2);
      const qty2 = qty - qty1;
      const hours1 = parseFloat((stepToSplit.estHours / 2).toFixed(1));
      const hours2 = parseFloat((stepToSplit.estHours - hours1).toFixed(1));

      const baseId = stepId.endsWith('A') || stepId.endsWith('B') ? stepId.slice(0, -1) : stepId;

      if (fromScheduled) {
        // Remove old scheduled step
        this.scheduledJobs.splice(scheduledIdx, 1);
        
        // Add A and B scheduled steps
        const sub1 = {
          ...stepToSplit,
          id: `${baseId}A`,
          qty: qty1,
          estHours: hours1,
          partName: `${stepToSplit.partName} (Split A)`,
          status: 'Scheduled'
        };
        const sub2 = {
          ...stepToSplit,
          id: `${baseId}B`,
          qty: qty2,
          estHours: hours2,
          partName: `${stepToSplit.partName} (Split B)`,
          startHour: stepToSplit.startHour + hours1,
          status: 'Scheduled'
        };
        this.scheduledJobs.push(sub1, sub2);
      } else {
        // Remove from backlog parent steps
        backlogWO.steps.splice(backlogStepIdx, 1);
        
        const sub1 = {
          id: `${baseId}A`,
          stepNum: stepToSplit.stepNum,
          name: `${stepToSplit.name} (Split A)`,
          machine: stepToSplit.machine,
          estHours: hours1,
          status: 'Unscheduled',
          startHour: null,
          qty: qty1
        };
        const sub2 = {
          id: `${baseId}B`,
          stepNum: stepToSplit.stepNum,
          name: `${stepToSplit.name} (Split B)`,
          machine: stepToSplit.machine,
          estHours: hours2,
          status: 'Unscheduled',
          startHour: null,
          qty: qty2
        };

        backlogWO.steps.push(sub1, sub2);
        
        // Auto-schedule both split parts onto the board consecutively!
        const minStart = this.dateToWorkingHour(new Date());
        const startHour1 = this.findEarliestAvailableSlot(stepToSplit.machine, hours1, minStart, this.activeScale);
        
        this.scheduleSingleStep(sub1.id, sub1.machine, startHour1);
        this.scheduleSingleStep(sub2.id, sub2.machine, startHour1 + hours1);
      }

      // Renumber steps to ensure they are sequential and unique!
      const { woId } = this.parseStepId(stepId);
      this.renumberWorkOrderSteps(woId);
      return true;
    }
    return false;
  }

  // Nest multiple sheet-metal steps
  nestJobs(stepIds) {
    this.saveStateToHistory();
    const success = this.executeNestJobs(stepIds);
    if (!success) {
      this.undoStack.pop();
      this.dispatchHistoryEvent();
    } else {
      this.notify();
      this.dispatchHistoryEvent();
    }
    return success;
  }

  executeNestJobs(stepIds) {
    if (stepIds.length < 2) return false;

    const selectedSteps = [];
    const fromBacklog = []; // tuples of [woIndex, stepIndex]
    const fromScheduled = [];

    stepIds.forEach(id => {
      // Look in backlog
      let found = false;
      for (let i = 0; i < this.workOrders.length; i++) {
        const wo = this.workOrders[i];
        const sIdx = wo.steps.findIndex(s => s.id === id);
        if (sIdx !== -1) {
          selectedSteps.push({ ...wo.steps[sIdx], woId: wo.id, customer: wo.customer, priority: wo.priority, qty: wo.qty, partName: wo.partName });
          fromBacklog.push({ woIdx: i, stepIdx: sIdx });
          found = true;
          break;
        }
      }

      if (!found) {
        const sIdx = this.scheduledJobs.findIndex(j => j.id === id);
        if (sIdx !== -1) {
          selectedSteps.push(this.scheduledJobs[sIdx]);
          fromScheduled.push(sIdx);
        }
      }
    });

    // Make sure all target Laser Cutting
    const valid = selectedSteps.every(step => step.machine === 'Laser Cutting');
    if (!valid) return false;

    // Create nest ID
    const nestId = 'NEST-' + (100 + Math.floor(Math.random() * 900));
    const estNestHours = parseFloat((Math.max(...selectedSteps.map(s => s.estHours)) + 0.5).toFixed(1));

    // Remove from sources
    const idsToRemove = selectedSteps.map(s => s.id);
    this.workOrders.forEach(wo => {
      wo.steps = wo.steps.filter(s => !idsToRemove.includes(s.id));
    });
    // Remove empty backlog WOs
    this.workOrders = this.workOrders.filter(wo => wo.steps.length > 0);

    // Scheduled: remove directly
    fromScheduled.sort((a, b) => b - a).forEach(idx => this.scheduledJobs.splice(idx, 1));

    // Create nest group
    this.nests[nestId] = {
      id: nestId,
      name: `Laser Nest ${nestId.split('-')[1]}`,
      jobIds: selectedSteps.map(s => s.id),
      jobs: selectedSteps,
      estHours: estNestHours,
      machine: 'Laser Cutting',
      startHour: 8.0,
      status: 'Scheduled',
      elapsedMinutes: 0
    };

    // Add Nest card on Gantt
    const nestJobCard = {
      id: nestId,
      customer: 'MERGED NEST',
      partName: `Multi-Step Nest (${selectedSteps.map(s => s.id).join(', ')})`,
      qty: selectedSteps.reduce((acc, s) => acc + s.qty, 0),
      estHours: estNestHours,
      priority: selectedSteps.some(s => s.priority === 'Hot') ? 'Hot' : 'Normal',
      machine: 'Laser Cutting',
      startHour: 9.0,
      status: 'Scheduled',
      elapsedMinutes: 0,
      isNest: true,
      nestId: nestId,
      delayReason: ''
    };

    this.scheduledJobs.push(nestJobCard);
    return true;
  }

  // Dissolve Nest
  dissolveNest(nestId) {
    this.saveStateToHistory();
    this.executeDissolveNest(nestId);
    this.notify();
    this.dispatchHistoryEvent();
  }

  executeDissolveNest(nestId) {
    const nest = this.nests[nestId];
    if (nest) {
      const cardIdx = this.scheduledJobs.findIndex(j => j.id === nestId);
      if (cardIdx !== -1) {
        this.scheduledJobs.splice(cardIdx, 1);
      }

      // Add steps back to Unscheduled Backlog
      nest.jobs.forEach(step => {
        const stepWoId = step.woId || step.id.split('-')[0];
        const stepId = step.id.includes('-') ? step.id : `${step.id}-10`;
        const backlogStep = {
          id: stepId,
          stepNum: step.stepNum || 10,
          name: step.stepName || step.name || 'Laser Cut',
          machine: step.machine || nest.machine || 'Lasercut',
          estHours: step.estHours,
          status: 'Unscheduled',
          startHour: null
        };

        let parentWO = this.workOrders.find(wo => wo.id === stepWoId);
        if (parentWO) {
          parentWO.steps.push(backlogStep);
          parentWO.steps.sort((a, b) => a.stepNum - b.stepNum);
        } else {
          this.workOrders.push({
            id: stepWoId,
            customer: step.customer,
            partName: step.partName,
            qty: step.qty,
            priority: step.priority,
            status: 'Unscheduled',
            delayReason: '',
            steps: [backlogStep]
          });
        }
      });

      delete this.nests[nestId];
    }
  }

  // Save/Restore State History and Clear Board Actions
  saveStateToHistory() {
    const snapshot = {
      scheduledJobs: JSON.parse(JSON.stringify(this.scheduledJobs)),
      workOrders: JSON.parse(JSON.stringify(this.workOrders)),
      nests: JSON.parse(JSON.stringify(this.nests)),
      assemblyLinks: JSON.parse(JSON.stringify(this.assemblyLinks || []))
    };
    
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 3) {
      this.undoStack.shift();
    }
    
    // Clear redo stack on new action
    this.redoStack = [];
    this.dispatchHistoryEvent();
  }

  dispatchHistoryEvent() {
    const event = new CustomEvent('history-changed', {
      detail: {
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0
      }
    });
    window.dispatchEvent(event);
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    
    const currentSnapshot = {
      scheduledJobs: JSON.parse(JSON.stringify(this.scheduledJobs)),
      workOrders: JSON.parse(JSON.stringify(this.workOrders)),
      nests: JSON.parse(JSON.stringify(this.nests)),
      assemblyLinks: JSON.parse(JSON.stringify(this.assemblyLinks || []))
    };
    this.redoStack.push(currentSnapshot);
    if (this.redoStack.length > 3) {
      this.redoStack.shift();
    }
    
    const previousState = this.undoStack.pop();
    this.scheduledJobs = previousState.scheduledJobs;
    this.workOrders = previousState.workOrders;
    this.nests = previousState.nests;
    this.assemblyLinks = previousState.assemblyLinks || [];
    
    this.notify();
    this.dispatchHistoryEvent();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    
    const currentSnapshot = {
      scheduledJobs: JSON.parse(JSON.stringify(this.scheduledJobs)),
      workOrders: JSON.parse(JSON.stringify(this.workOrders)),
      nests: JSON.parse(JSON.stringify(this.nests)),
      assemblyLinks: JSON.parse(JSON.stringify(this.assemblyLinks || []))
    };
    this.undoStack.push(currentSnapshot);
    if (this.undoStack.length > 3) {
      this.undoStack.shift();
    }
    
    const nextState = this.redoStack.pop();
    this.scheduledJobs = nextState.scheduledJobs;
    this.workOrders = nextState.workOrders;
    this.nests = nextState.nests;
    this.assemblyLinks = nextState.assemblyLinks || [];
    
    this.notify();
    this.dispatchHistoryEvent();
    return true;
  }

  clearBoard(option = 'backlog') {
    this.saveStateToHistory();
    if (option === 'backlog') {
      // Copy the scheduledJobs array to avoid mutating while iterating
      const jobs = [...this.scheduledJobs];
      jobs.forEach(job => {
        this.executeUnscheduleJob(job.id);
      });
      this.assemblyLinks = [];
    } else if (option === 'delete') {
      // Remove all scheduled jobs
      const parentWoIds = new Set(this.scheduledJobs.map(j => j.woId));
      this.scheduledJobs = [];
      this.nests = {};
      // Delete all Work Orders completely from the system/backlog
      this.workOrders = [];
      this.assemblyLinks = [];
    }
    this.notify();
    this.dispatchHistoryEvent();
  }

  updateProductionOrder(woId, data) {
    this.saveStateToHistory();

    const customer = data.customer !== undefined ? data.customer : 'General';
    const project = data.project !== undefined ? data.project : 'General';
    const dwgNo = data.dwgNo !== undefined ? data.dwgNo : '';
    const partName = data.partName !== undefined ? data.partName : '';
    const qty = parseInt(data.qty) || 1;
    const priority = data.priority !== undefined ? data.priority : 'Normal';
    const dueHour = data.dueHour !== undefined ? data.dueHour : null;
    const steps = Array.isArray(data.steps) ? data.steps : [];

    // 1. Check existing backlog Work Order
    let backlogWO = this.workOrders.find(wo => wo.id === woId);

    // 2. Track kept scheduled jobs and new backlog steps
    const keptScheduledJobIds = new Set();
    const newBacklogSteps = [];

    steps.forEach((step, idx) => {
      const sNum = parseInt(step.stepNum) || (idx + 1) * 10;
      const stepId = step.id || `${woId}-${sNum}`;
      const machine = step.machine || 'DEA012';
      const name = step.name || this.workCenters[machine]?.name || machine;
      const setupMinutes = parseFloat(step.setupMinutes) >= 0 ? parseFloat(step.setupMinutes) : 0;
      const cycleMinutes = parseFloat(step.cycleMinutes) > 0 ? parseFloat(step.cycleMinutes) : 1;
      const cap = this.workCenters[machine]?.capacity || 1;
      const estHours = parseFloat(step.estHours) > 0 ? parseFloat(step.estHours) : parseFloat(((setupMinutes + qty * cycleMinutes) / 60 / cap).toFixed(2)) || 0.1;

      // Check if this step is currently scheduled
      const existingJob = this.scheduledJobs.find(j => j.id === stepId || (j.woId === woId && j.stepNum === sNum));
      if (existingJob) {
        existingJob.woId = woId;
        existingJob.customer = customer;
        existingJob.project = project;
        existingJob.dwgNo = dwgNo;
        existingJob.partName = partName;
        existingJob.qty = qty;
        existingJob.priority = priority;
        existingJob.dueHour = dueHour;
        existingJob.stepNum = sNum;
        existingJob.stepName = name;
        existingJob.name = name;
        existingJob.machine = machine;
        existingJob.originalMachine = machine;
        existingJob.setupMinutes = setupMinutes;
        existingJob.cycleMinutes = cycleMinutes;
        existingJob.estHours = estHours;
        if (step.status) existingJob.status = step.status;
        keptScheduledJobIds.add(existingJob.id);
      } else {
        // Step is in backlog
        newBacklogSteps.push({
          id: stepId,
          stepNum: sNum,
          name: name,
          machine: machine,
          setupMinutes: setupMinutes,
          cycleMinutes: cycleMinutes,
          estHours: estHours,
          status: 'Unscheduled',
          startHour: null,
          dueHour: dueHour
        });
      }
    });

    // Remove any scheduled jobs of this PD that were deleted in the modal
    this.scheduledJobs = this.scheduledJobs.filter(j => {
      if (j.woId === woId || j.id === woId) {
        return keptScheduledJobIds.has(j.id);
      }
      return true;
    });

    // Update backlog workOrders
    if (newBacklogSteps.length > 0) {
      if (backlogWO) {
        backlogWO.customer = customer;
        backlogWO.project = project;
        backlogWO.dwgNo = dwgNo;
        backlogWO.partName = partName;
        backlogWO.qty = qty;
        backlogWO.priority = priority;
        backlogWO.dueHour = dueHour;
        backlogWO.steps = newBacklogSteps;
      } else {
        this.workOrders.push({
          id: woId,
          customer,
          project,
          dwgNo,
          partName,
          qty,
          priority,
          status: 'Unscheduled',
          delayReason: '',
          dueHour,
          steps: newBacklogSteps
        });
      }
    } else {
      if (backlogWO) {
        this.workOrders = this.workOrders.filter(wo => wo.id !== woId);
      }
    }

    this.saveWorkOrdersToFile();
    this.savePlanToFile();
    this.notify();
    this.dispatchHistoryEvent();
  }

  deleteProductionOrder(woId) {
    this.saveStateToHistory();
    this.scheduledJobs = this.scheduledJobs.filter(j => j.woId !== woId && j.id !== woId);
    this.workOrders = this.workOrders.filter(wo => wo.id !== woId);
    if (this.assemblyLinks) {
      this.assemblyLinks = this.assemblyLinks.filter(link => {
        const fromWo = this.parseStepId(link.from).woId;
        const toWo = this.parseStepId(link.to).woId;
        return fromWo !== woId && toWo !== woId;
      });
    }
    this.saveWorkOrdersToFile();
    this.savePlanToFile();
    this.notify();
    this.dispatchHistoryEvent();
  }

  setKioskMachine(machine) {
    this.kioskMachine = machine;
    this.notify();
  }

  updateJobStatus(jobId, newStatus, delayReason = '') {
    const idx = this.scheduledJobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      const job = this.scheduledJobs[idx];
      job.status = newStatus;
      job.delayReason = delayReason;
      
      if (job.isNest && this.nests[job.id]) {
        this.nests[job.id].status = newStatus;
      }

      this.notify();
    }
  }

  // Calculate machine utility load (mock OEE based on scheduled hours and machine work hours/day)
  getMachineOEE(machine) {
    // Only count jobs currently visible on the board (respecting the Priority/Project
    // filters) - a job hidden by those filters shouldn't count toward this machine's load.
    const jobs = this.scheduledJobs.filter(j => j.machine === machine && isJobPriorityVisible(j, this) && isJobProjectVisible(j, this) && isJobPdRangeVisible(j, this));
    const wc = this.workCenters[machine] || {};
    const capacityCount = (wc.capacity !== undefined && wc.capacity > 0) ? parseInt(wc.capacity) : 1;
    let totalHours = jobs.reduce((sum, j) => sum + j.estHours * capacityCount, 0);
    
    const workHoursPerDay = (wc.workHoursPerDay !== undefined && wc.workHoursPerDay > 0) ? parseFloat(wc.workHoursPerDay) : 8.0;
    const dailyCap = workHoursPerDay * capacityCount;

    // Fixed reference horizon (21 working days ~= 1 month) so this % reads the same
    // no matter which timeline zoom (1H/1D/.../1Y) is currently selected - it used to
    // be recalculated per activeScale (up to an 864x swing between 1H and 1Y) even
    // though totalHours (the actual booked load) doesn't change with the view.
    const baseCapacity = dailyCap * 21.0;

    const utilization = Math.round((totalHours / baseCapacity) * 100);
    
    if (utilization === 0) return { oee: 0, util: 0, active: 'Idle' };
    
    const activeJob = jobs.find(j => j.status === 'Running');
    const isPaused = jobs.some(j => j.status === 'Paused');
    
    let status = 'Idle';
    if (activeJob) status = 'Running';
    else if (isPaused) status = 'Blocked';
    else if (jobs.length > 0) status = 'Scheduled';

    if (this.activeScale === 'hr') {
      if (totalHours > dailyCap * 1.5) {
        status = 'Overcap';
      } else if (totalHours > dailyCap) {
        status = 'Overtime';
      }
    }

    const oee = Math.round(utilization * 0.95);
    return {
      oee: Math.min(99, oee),
      util: utilization, // Allow exceeding 100% to represent overtime load visually
      active: status
    };
  }

  renumberWorkOrderSteps(woId) {
    const parentWO = this.workOrders.find(wo => wo.id === woId);
    const backlogSteps = parentWO ? parentWO.steps : [];
    const scheduledJobsOfWO = this.scheduledJobs.filter(j => j.woId === woId);

    const allSteps = [];
    backlogSteps.forEach(s => allSteps.push({ type: 'backlog', ref: s, stepNum: s.stepNum, id: s.id }));
    scheduledJobsOfWO.forEach(j => allSteps.push({ type: 'scheduled', ref: j, stepNum: j.stepNum, id: j.id }));

    // Sort by stepNum, then by ID to keep Split A before Split B, etc.
    allSteps.sort((a, b) => {
      if (a.stepNum !== b.stepNum) {
        return a.stepNum - b.stepNum;
      }
      return a.id.localeCompare(b.id);
    });

    const seenNames = new Set();
    const keptSteps = [];
    const stepsToRemove = [];

    allSteps.forEach(item => {
      let currentName = item.type === 'scheduled' ? item.ref.stepName : item.ref.name;
      let baseName = (currentName || 'Operation').trim();

      // Strip existing sequence number suffix (e.g. "Laser Cut 2" -> "Laser Cut")
      // Do NOT strip the "(Split A)" or "(Split B)" suffix because split parts are valid separate tasks
      baseName = baseName.replace(/\s+\d+$/, '');

      if (!seenNames.has(baseName)) {
        seenNames.add(baseName);
        keptSteps.push(item);
      } else {
        stepsToRemove.push(item);
      }
    });

    // Remove the duplicates from state
    stepsToRemove.forEach(item => {
      if (item.type === 'backlog') {
        if (parentWO) {
          const idx = parentWO.steps.findIndex(s => s.id === item.id);
          if (idx !== -1) {
            parentWO.steps.splice(idx, 1);
          }
        }
      } else if (item.type === 'scheduled') {
        const idx = this.scheduledJobs.findIndex(j => j.id === item.id);
        if (idx !== -1) {
          this.scheduledJobs.splice(idx, 1);
        }
      }
    });

    // Assign new stepNums and update IDs on the kept steps
    keptSteps.forEach((item, index) => {
      const newStepNum = (index + 1) * 10;
      item.ref.stepNum = newStepNum;

      // Extract trailing letter suffix (like 'A' or 'B') if present
      const suffixMatch = item.id.match(/-[0-9]+(.*)$/);
      const suffix = suffixMatch ? suffixMatch[1] : '';
      const newId = `${woId}-${newStepNum}${suffix}`;

      // Update ID
      item.ref.id = newId;

      // Clean name of any sequence number suffix
      let currentName = item.type === 'scheduled' ? item.ref.stepName : item.ref.name;
      let cleanName = (currentName || 'Operation').trim();
      cleanName = cleanName.replace(/\s+\d+$/, '');

      if (item.type === 'scheduled') {
        item.ref.stepName = cleanName;
      } else {
        item.ref.name = cleanName;
      }
    });

    if (parentWO) {
      parentWO.steps.sort((a, b) => a.stepNum - b.stepNum);
    }
  }

  deduplicateAllWorkOrders() {
    const allWoIds = new Set();
    this.workOrders.forEach(wo => allWoIds.add(wo.id));
    this.scheduledJobs.forEach(j => {
      if (j.woId) allWoIds.add(j.woId);
    });

    allWoIds.forEach(woId => {
      this.renumberWorkOrderSteps(woId);
    });
  }

  addAssemblyLink(fromId, toId) {
    if (!this.assemblyLinks) {
      this.assemblyLinks = [];
    }
    const exists = this.assemblyLinks.some(link => link.from === fromId && link.to === toId);
    if (!exists) {
      this.saveStateToHistory();
      this.assemblyLinks.push({ from: fromId, to: toId });
      this.savePlanToFile();
      this.notify();
      this.dispatchHistoryEvent();
      return true;
    }
    return false;
  }

  autoLinkAssemblies() {
    const allJobs = this.scheduledJobs || [];
    const links = [];
    const linkSet = new Set();

    const isAssyStep = (step) => {
      if (!step) return false;
      const m = (step.machine || '').toLowerCase();
      const name = (step.stepName || step.name || '').toLowerCase();
      return m.includes('assy') || m.includes('assembly') || m.startsWith('dec') || name.includes('assy') || name.includes('ประกอบ') || name.includes('weld') || name.includes('เชื่อม');
    };

    const getPartKey = (item) => {
      if (!item) return '';
      if (item.partName) {
        const match = item.partName.trim().match(/^([A-Za-z0-9_]+(-\d+)*)/);
        if (match && match[1] && (match[1].includes('-') || /^[A-Za-z0-9_]+$/.test(match[1]))) {
          return match[1];
        }
      }
      if (item.dwgNo) {
        const match = item.dwgNo.trim().match(/^([A-Za-z0-9_]+(-\d+)*)/);
        if (match && match[1]) return match[1];
      }
      return item.woId || item.id || '';
    };

    const getParentKey = (key) => {
      if (!key) return null;
      const match = key.match(/^(.+)-(\d+)$/);
      if (match) {
        const parent = match[1];
        if (/^[A-Za-z]+$/.test(parent)) return null;
        return parent;
      }
      return null;
    };

    // Group jobs by woId
    const woJobsMap = new Map();
    allJobs.forEach(j => {
      if (!j.woId) return;
      if (!woJobsMap.has(j.woId)) woJobsMap.set(j.woId, []);
      woJobsMap.get(j.woId).push(j);
    });

    // Map keys to woIds
    const keyToWoIdMap = new Map();
    woJobsMap.forEach((jobs, woId) => {
      const key = getPartKey(jobs[0]);
      if (key) keyToWoIdMap.set(key, woId);
    });

    const allWoIds = Array.from(woJobsMap.keys());

    // 1. Link by direct woId parent-child hierarchy (e.g. SR-268 -> SR-268-0 -> SR-268-0-1 or PD0000301-1 -> PD0000301)
    allWoIds.forEach(childWoId => {
      const parentWoId = getParentKey(childWoId);
      if (parentWoId && woJobsMap.has(parentWoId)) {
        const childSteps = [...woJobsMap.get(childWoId)].sort((a, b) => (b.stepNum || 0) - (a.stepNum || 0));
        const childFinalStep = childSteps[0];

        const parentSteps = [...woJobsMap.get(parentWoId)].sort((a, b) => (a.stepNum || 0) - (b.stepNum || 0));
        const parentAssyStep = parentSteps.find(isAssyStep) || parentSteps[0];

        if (childFinalStep && parentAssyStep) {
          const k = `${childFinalStep.id}->${parentAssyStep.id}`;
          if (!linkSet.has(k)) {
            linkSet.add(k);
            links.push({ from: childFinalStep.id, to: parentAssyStep.id });
          }
        }
      }
    });

    // 2. Link by part name / DWG key hierarchy (e.g. partName "SR-268-0-1..." -> partName "SR-268-0...")
    keyToWoIdMap.forEach((childWoId, childKey) => {
      const parentKey = getParentKey(childKey);
      if (parentKey && keyToWoIdMap.has(parentKey)) {
        const parentWoId = keyToWoIdMap.get(parentKey);
        if (parentWoId !== childWoId && woJobsMap.has(parentWoId)) {
          const childSteps = [...woJobsMap.get(childWoId)].sort((a, b) => (b.stepNum || 0) - (a.stepNum || 0));
          const childFinalStep = childSteps[0];

          const parentSteps = [...woJobsMap.get(parentWoId)].sort((a, b) => (a.stepNum || 0) - (b.stepNum || 0));
          const parentAssyStep = parentSteps.find(isAssyStep) || parentSteps[0];

          if (childFinalStep && parentAssyStep) {
            const k = `${childFinalStep.id}->${parentAssyStep.id}`;
            if (!linkSet.has(k)) {
              linkSet.add(k);
              links.push({ from: childFinalStep.id, to: parentAssyStep.id });
            }
          }
        }
      }
    });

    // Preserve existing custom links
    const existing = this.assemblyLinks || [];
    existing.forEach(l => {
      const k = `${l.from}->${l.to}`;
      if (!linkSet.has(k)) {
        linkSet.add(k);
        links.push(l);
      }
    });

    this.assemblyLinks = links;
    return links;
  }

  removeAssemblyLink(fromId, toId) {
    if (!this.assemblyLinks) return false;
    const initialLength = this.assemblyLinks.length;
    this.saveStateToHistory();
    this.assemblyLinks = this.assemblyLinks.filter(link => !(link.from === fromId && link.to === toId));
    
    if (this.assemblyLinks.length !== initialLength) {
      this.savePlanToFile();
      this.notify();
      this.dispatchHistoryEvent();
      return true;
    }
    return false;
  }

  loadWorkOrdersFromFile() {
    fetch('/api/pd')
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data) && data.length > 0) {
          this.workOrders = data;
          this.deduplicateAllWorkOrders();
          this.notify();
        } else {
          // If file is empty, write current default mock workOrders to pd.md
          this.saveWorkOrdersToFile();
        }
      })
      .catch(err => console.error('Error loading PD from file:', err));
  }

  saveWorkOrdersToFile() {
    fetch('/api/pd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(this.workOrders)
    })
    .then(res => {
      if (!res.ok) console.error('Failed to save PD to file');
    })
    .catch(err => console.error('Error saving PD to file:', err));
  }

  isProjectLocked(proj) {
    const p = proj || 'General';
    return Boolean(this.lockedProjects[p]);
  }

  isJobLocked(job) {
    if (!job) return false;
    return this.isProjectLocked(job.project);
  }

  toggleProjectLock(proj) {
    const p = proj || 'General';
    this.lockedProjects[p] = !this.lockedProjects[p];
    this.savePlanToFile();
    this.notify();
  }

  loadPlanFromFile() {
    fetch('/api/plan')
      .then(res => res.json())
      .then(data => {
        if (data && data.scheduledJobs && Array.isArray(data.scheduledJobs)) {
          this.scheduledJobs = data.scheduledJobs;
          this.nests = data.nests || {};
          this.assemblyLinks = data.assemblyLinks || [];
          this.lockedProjects = data.lockedProjects || {};
          if (data.priorityColors) this.priorityColors = data.priorityColors;
          if (data.projectColors) this.projectColors = data.projectColors;
          if (data.workCenters) this.workCenters = data.workCenters;
          if (data.workCenterOrder) this.workCenterOrder = data.workCenterOrder;
          if (data.timelineOffset !== undefined) this.timelineOffset = data.timelineOffset;
          if (data.activeScale) this.activeScale = data.activeScale;
          this.deduplicateAllWorkOrders();
          if (this.ganttController && this.scheduledJobs.length > 0) {
            this.ganttController.fitTasks(this.scheduledJobs);
          }
          this.notify();
        }
      })
      .catch(err => console.error('Error loading Plan from file:', err));
  }

  savePlanToFile() {
    const formattedRows = this.scheduledJobs.map(job => {
      const dStart = this.workingHourToDate(job.startHour);
      const dEnd = this.workingHourToDate(job.startHour + job.estHours);
      
      const startStr = `${dStart.toLocaleDateString('en-GB')} ${dStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
      const endStr = `${dEnd.toLocaleDateString('en-GB')} ${dEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
      
      return {
        id: job.id,
        woId: job.woId || '',
        customer: job.customer || '',
        partName: job.partName || '',
        machine: job.machine,
        start: startStr,
        end: endStr,
        status: job.status
      };
    });
    
    const payload = {
      scheduledJobs: this.scheduledJobs,
      nests: this.nests,
      assemblyLinks: this.assemblyLinks || [],
      lockedProjects: this.lockedProjects || {},
      priorityColors: this.priorityColors || {},
      projectColors: this.projectColors || {},
      workCenters: this.workCenters,
      workCenterOrder: this.workCenterOrder,
      timelineOffset: this.timelineOffset,
      activeScale: this.activeScale,
      formattedRows
    };
    
    fetch('/api/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(res => {
      if (!res.ok) console.error('Failed to save Plan to file');
    })
    .catch(err => console.error('Error saving Plan to file:', err));
  }
}

// Export a singleton state instance
export const state = new CentralState();
if (typeof window !== 'undefined') {
  window.state = state; // Expose to window for console debugging
}
