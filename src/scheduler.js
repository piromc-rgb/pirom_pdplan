// MIE Trak Pro - Production Scheduling Engine

export function getPriorityWeight(priority) {
  if (priority === null || priority === undefined || priority === '') return 999999;
  
  const pStr = String(priority).trim().toLowerCase();
  
  if (pStr === 'hot' || pStr === 'urgent') return -1000;
  if (pStr === 'normal') return 5000;
  if (pStr === 'low') return 90000;
  
  const num = parseFloat(pStr);
  if (!isNaN(num)) {
    return num;
  }

  const match = pStr.match(/(\d+(\.\d+)?)/);
  if (match) {
    return parseFloat(match[1]);
  }

  return 999999;
}

export function getItemKey(jobOrWo) {
  if (!jobOrWo) return '';
  const dwg = (jobOrWo.dwgNo || '').trim();
  if (dwg) return dwg.toUpperCase();
  const part = (jobOrWo.partName || jobOrWo.name || '').trim();
  return part ? part.toUpperCase() : '';
}

// AMW strategy (TOC / Drum-Buffer-Rope): the Drum is the real bottleneck Work Center, CNC is protected from starvation.
// Default Drum = CNC VF4 / VF7 (DEA024 / DEA023): the plan keeps them ~100% loaded while Welding (DEB011-014) is ~20-50%.
// A Work Center can override its role with workCenters[code].amwRole = 'drum' | 'cnc' | 'none'
// (e.g. set the Welding centers to 'drum' when Welding becomes the constraint).
export const AMW_DEFAULT_DRUM_WCS = ['DEA023', 'DEA024'];
export const AMW_DEFAULT_CNC_WCS = ['DEA012', 'DEA016', 'DEA021', 'DEA022', 'DEA025', 'DEA026', 'DEA027', 'DEA028'];
export const AMW_CONSTRAINT_BUFFER_RATIO = 0.5; // Constraint Buffer = 1/2 of the upstream -> Welding lead time

export function getAmwRoles(workCenters = {}) {
  const drum = new Set(AMW_DEFAULT_DRUM_WCS);
  const cnc = new Set(AMW_DEFAULT_CNC_WCS);
  Object.keys(workCenters || {}).forEach(code => {
    const role = workCenters[code] && workCenters[code].amwRole;
    if (role === 'drum') { drum.add(code); cnc.delete(code); }
    else if (role === 'cnc') { cnc.add(code); drum.delete(code); }
    else if (role === 'none') { drum.delete(code); cnc.delete(code); }
  });
  return { drum, cnc };
}

// Raw-material codes (10-char) a job consumes at its own routing step, from the Plan + Mat sheet.
// Used by work centers with "check material" on to run PDs sharing a material back to back.
export function getJobMatKeys(job, planMaterials) {
  const rows = planMaterials && job && job.woId ? planMaterials[job.woId] : null;
  if (!Array.isArray(rows)) return [];
  const step = Number(job.stepNum);
  const keys = new Set();
  rows.forEach(r => {
    const mat = String(r.mat || '').trim();
    if (mat.length === 10 && Number(r.stepNum) === step) keys.add(mat.toUpperCase());
  });
  return [...keys];
}

// --- Fast Track rule -----------------------------------------------------------
// A PD qualifies when its total production time (excluding painting, adjusting
// and assembly) exceeds HYBRID_MIN_DAYS working days AND it has a welding step.
// Such a PD and its whole sub-PD tree are planned from the deepest sub-PD upward;
// every other PD is planned Forwards Finite as usual.
export const HYBRID_DAY_HOURS = 8.0;
export const HYBRID_MIN_DAYS = 2;
const HYBRID_EXCLUDED_MACHINES = new Set(['DEB021', 'DEA062', 'DEC001', 'DED001']);

export function isHybridExcludedStep(job) {
  if (!job) return false;
  if (HYBRID_EXCLUDED_MACHINES.has(String(job.machine || job.originalMachine || '').toUpperCase())) return true;
  const n = String(job.stepName || job.name || '').toLowerCase();
  return n.includes('ทำสี') || n.includes('ปรับแต่ง') || n.includes('assy') || n.includes('ประกอบ');
}

// Returns { roots: [woId], levelByWo: Map(woId -> depth, root = 0, deepest = highest) }
export function computeHybridFlow(allJobs, childrenOf, minHours = HYBRID_MIN_DAYS * HYBRID_DAY_HOURS) {
  const hoursByWo = new Map();
  const weldWo = new Set();
  allJobs.forEach(j => {
    if (!j || !j.woId) return;
    if (Scheduler.isWeldingJob(j)) weldWo.add(j.woId);
    if (isHybridExcludedStep(j)) return;
    hoursByWo.set(j.woId, (hoursByWo.get(j.woId) || 0) + (Number(j.estHours) || 0));
  });
  const roots = [];
  hoursByWo.forEach((h, woId) => {
    if (weldWo.has(woId) && h > minHours) roots.push(woId);
  });
  // Level = longest distance from a flow PD (root = 0, deepest sub-PD = highest). Linear time:
  // iterative DFS over the sub-PD graph (cycles / shared children are common - back edges are
  // ignored), then longest-path relaxation in topological order.
  const levelByWo = new Map();
  const state = new Map(); // 1 = on stack, 2 = done
  const post = [];
  roots.forEach(r => {
    if (state.has(r)) return;
    state.set(r, 1);
    const stack = [{ id: r, kids: childrenOf.get(r) || [], i: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i < top.kids.length) {
        const c = top.kids[top.i++];
        if (!state.has(c)) {
          state.set(c, 1);
          stack.push({ id: c, kids: childrenOf.get(c) || [], i: 0 });
        }
      } else {
        state.set(top.id, 2);
        post.push(top.id);
        stack.pop();
      }
    }
  });
  const topo = post.reverse();
  const order = new Map(topo.map((id, i) => [id, i]));
  roots.forEach(r => levelByWo.set(r, 0));
  topo.forEach(u => {
    if (!levelByWo.has(u)) levelByWo.set(u, 0);
    const lu = levelByWo.get(u);
    (childrenOf.get(u) || []).forEach(c => {
      if (order.has(c) && order.get(c) > order.get(u) && (levelByWo.get(c) ?? -1) < lu + 1) levelByWo.set(c, lu + 1);
    });
  });
  return { roots, levelByWo };
}

export class Scheduler {
  // Apply Backwards Infinite Scheduling model
  // Arranges all jobs backwards from a simulated due hour (dependent on scale)
  // For jobs belonging to the same WO, steps are sequenced backwards (Step 20 starts when Step 30 starts, etc.)
  static applyBackwardsInfinite(jobs, scale = 'hr') {
    // Completed jobs are done - never recompute their startHour, or a finished PD
    // would get bumped into a new future slot every time the scale changes.
    const completedJobs = jobs.filter(j => j.status === 'Completed');
    const pendingJobs = jobs.filter(j => j.status !== 'Completed');

    let deadline = 8.0;
    let minStart = 0.0;

    if (scale === 'day') { deadline = 48.0; minStart = 0.0; }
    else if (scale === 'week') { deadline = 192.0; minStart = 0.0; }
    else if (scale === 'month') { deadline = 576.0; minStart = 0.0; }

    // Group jobs by parent Work Order ID
    const woGroups = {};
    const independentJobs = [];

    pendingJobs.forEach(job => {
      if (!job.woId) {
        independentJobs.push(job);
      } else {
        if (!woGroups[job.woId]) {
          woGroups[job.woId] = [];
        }
        woGroups[job.woId].push(job);
      }
    });

    const updatedJobs = [];
    const woStartTimes = {};

    // Sort woIds so that parents are processed before children (parents later in time).
    // E.g. "PD0000310" processed before "PD0000310-1"
    const sortedWoIds = Object.keys(woGroups).sort((a, b) => {
      const aIsChildOfB = a.startsWith(b + '-');
      const bIsChildOfA = b.startsWith(a + '-');
      if (aIsChildOfB) return 1;
      if (bIsChildOfA) return -1;
      return a.length - b.length; // shorter string first (usually parents)
    });

    sortedWoIds.forEach(woId => {
      const steps = woGroups[woId];
      // Sort descending by stepNum (latest step first)
      steps.sort((a, b) => b.stepNum - a.stepNum);

      let currentDeadline = deadline;

      // If this is a child, its deadline should be constrained by the start time of its parent
      const childMatch = woId.match(/^(.*)-(\d+)$/);
      if (childMatch) {
        const parentWoId = childMatch[1];
        if (woStartTimes[parentWoId] !== undefined) {
          currentDeadline = woStartTimes[parentWoId];
        }
      }

      let minStepStart = Infinity;
      steps.forEach(step => {
        const start = Math.max(minStart, currentDeadline - step.estHours);
        step.startHour = parseFloat(start.toFixed(1));
        if (start < minStepStart) {
          minStepStart = start;
        }
        // Preceding step must end when this step starts
        currentDeadline = start;
      });

      woStartTimes[woId] = minStepStart;
      updatedJobs.push(...steps);
    });

    // Handle independent/nested jobs
    independentJobs.forEach(job => {
      const start = Math.max(minStart, deadline - job.estHours);
      updatedJobs.push({
        ...job,
        startHour: parseFloat(start.toFixed(1))
      });
    });

    return [...completedJobs, ...updatedJobs];
  }

  // Apply Forwards Finite Scheduling model
  // Arranges jobs starting from 8.0 (or 0.0 for wide scales), and pushes overlapping jobs forward.
  // Enforces step routing sequence constraints (Step N+1 starts after Step N ends).
  static adjustToWorkingHours(startHour, duration, forceConfirm = false, scale = 'hr') {
    return startHour;
  }

  static isWeldingJob(job) {
    if (!job) return false;
    const m = String(job.machine || '').toUpperCase();
    const n = String(job.stepName || job.name || '').toLowerCase();
    return m.startsWith('DEB01') || m === 'DEB011' || m === 'DEB012' || m === 'DEB013' || m === 'DEB014' || n.includes('เชื่อม') || n.includes('weld');
  }

  static getChildWoIds(parentWoId, options = {}) {
    if (!parentWoId) return [];
    const children = new Set();
    const planMaterials = options.planMaterials || (typeof window !== 'undefined' && window.state?.planMaterials) || {};
    const dwgToPdMap = options.dwgToPdMap || (typeof window !== 'undefined' && window.state?.dwgToPdMap) || {};
    const assemblyLinks = options.assemblyLinks || (typeof window !== 'undefined' && window.state?.assemblyLinks) || [];
    const allWoIds = options.distinctWoIds || [];

    // 1. Dash-suffix hierarchy (child.woId startsWith parent.woId + '-')
    if (allWoIds && allWoIds.length > 0) {
      if (!options._prefixChildrenMap) {
        const pMap = new Map();
        for (let i = 0; i < allWoIds.length; i++) {
          const id = allWoIds[i];
          let idx = id.indexOf('-');
          while (idx !== -1) {
            const parent = id.substring(0, idx);
            let list = pMap.get(parent);
            if (!list) {
              list = [];
              pMap.set(parent, list);
            }
            list.push(id);
            idx = id.indexOf('-', idx + 1);
          }
        }
        options._prefixChildrenMap = pMap;
      }
      const list = options._prefixChildrenMap.get(parentWoId);
      if (list) {
        for (let i = 0; i < list.length; i++) children.add(list[i]);
      }
    }

    // 2. Assembly links (link.from belongs to child PD, link.to belongs to parent PD)
    if (assemblyLinks && assemblyLinks.length > 0) {
      if (!options._linkChildrenMap) {
        const lMap = new Map();
        for (let i = 0; i < assemblyLinks.length; i++) {
          const link = assemblyLinks[i];
          const fromWo = (link.from || '').split('-')[0];
          const toWo = (link.to || '').split('-')[0];
          if (toWo && fromWo && toWo !== fromWo) {
            let list = lMap.get(toWo);
            if (!list) {
              list = [];
              lMap.set(toWo, list);
            }
            list.push(fromWo);
          }
        }
        options._linkChildrenMap = lMap;
      }
      const list = options._linkChildrenMap.get(parentWoId);
      if (list) {
        for (let i = 0; i < list.length; i++) children.add(list[i]);
      }
    }

    // 3. Materials / Child component PDs from sheet Plan + Mat (planMaterials)
    const mats = planMaterials[parentWoId] || [];
    if (mats.length > 0) {
      if (options.jobs && !options._dwgJobMap) {
        const dMap = new Map();
        for (let i = 0; i < options.jobs.length; i++) {
          const j = options.jobs[i];
          if (j.woId) {
            if (j.dwgNo && !dMap.has(j.dwgNo.trim())) {
              dMap.set(j.dwgNo.trim(), j.woId);
            }
            if (!dMap.has(j.woId)) {
              dMap.set(j.woId, j.woId);
            }
          }
        }
        options._dwgJobMap = dMap;
      }

      if (options.allWOs && !options._dwgWoMap) {
        const wMap = new Map();
        for (let i = 0; i < options.allWOs.length; i++) {
          const w = options.allWOs[i];
          if (w.id) {
            if (w.dwgNo && !wMap.has(w.dwgNo.trim())) {
              wMap.set(w.dwgNo.trim(), w.id);
            }
            if (!wMap.has(w.id)) {
              wMap.set(w.id, w.id);
            }
          }
        }
        options._dwgWoMap = wMap;
      }

      for (let i = 0; i < mats.length; i++) {
        const matCode = String(mats[i].mat || '').trim();
        if (!matCode) continue;
        if (dwgToPdMap[matCode]?.pdId) {
          const cId = dwgToPdMap[matCode].pdId;
          if (cId !== parentWoId) children.add(cId);
        }
        if (options._dwgJobMap) {
          const matchWoId = options._dwgJobMap.get(matCode);
          if (matchWoId && matchWoId !== parentWoId) {
            children.add(matchWoId);
          }
        } else if (options.jobs) {
          const match = options.jobs.find(j => (j.dwgNo && j.dwgNo.trim() === matCode) || j.woId === matCode);
          if (match && match.woId && match.woId !== parentWoId) {
            children.add(match.woId);
          }
        }
        if (options._dwgWoMap) {
          const matchId = options._dwgWoMap.get(matCode);
          if (matchId && matchId !== parentWoId) {
            children.add(matchId);
          }
        } else if (options.allWOs) {
          const match = options.allWOs.find(w => (w.dwgNo && w.dwgNo.trim() === matCode) || w.id === matCode);
          if (match && match.id && match.id !== parentWoId) {
            children.add(match.id);
          }
        }
      }
    }

    return Array.from(children).filter(cId => cId.startsWith(parentWoId + '-') || Scheduler.isInParentPdRange(cId, parentWoId, options));
  }

  // PD Range rule for Assembly / Plan + Mat links: a linked child only counts when it falls inside a PD Range
  // (Summary Project Order) that also contains the parent. A parent outside every range keeps all its links.
  static isInParentPdRange(childWoId, parentWoId, options = {}) {
    const summary = options.projectPrioritySummary || (typeof window !== 'undefined' && window.state?.projectPrioritySummary);
    if (!summary) return true;
    if (!options._pdRanges) {
      const ranges = [];
      Object.values(summary).forEach(arr => (Array.isArray(arr) ? arr : []).forEach(r => {
        const s = parseInt(String(r.start || '').replace(/\D/g, ''), 10);
        const e = parseInt(String(r.end || '').replace(/\D/g, ''), 10);
        if (!isNaN(s) && !isNaN(e)) ranges.push([s, e]);
      }));
      options._pdRanges = ranges;
    }
    const num = id => parseInt(String(id).split('-')[0].replace(/\D/g, ''), 10);
    const p = num(parentWoId);
    const parentRanges = options._pdRanges.filter(([s, e]) => p >= s && p <= e);
    if (parentRanges.length === 0) return true;
    const c = num(childWoId);
    return parentRanges.some(([s, e]) => c >= s && c <= e);
  }

  static isChildWoOf(childWoId, parentWoId, options = {}) {
    if (!childWoId || !parentWoId || childWoId === parentWoId) return false;
    if (childWoId.startsWith(parentWoId + '-')) return true;

    const planMaterials = options.planMaterials || (typeof window !== 'undefined' && window.state?.planMaterials) || {};
    const dwgToPdMap = options.dwgToPdMap || (typeof window !== 'undefined' && window.state?.dwgToPdMap) || {};
    const assemblyLinks = options.assemblyLinks || (typeof window !== 'undefined' && window.state?.assemblyLinks) || [];

    if (!Scheduler.isInParentPdRange(childWoId, parentWoId, options)) return false;

    const hasLink = assemblyLinks.some(l => {
      const f = (l.from || '').split('-')[0];
      const t = (l.to || '').split('-')[0];
      return f === childWoId && t === parentWoId;
    });
    if (hasLink) return true;

    const mats = planMaterials[parentWoId] || [];
    for (const item of mats) {
      const matCode = String(item.mat || '').trim();
      if (!matCode) continue;
      if (dwgToPdMap[matCode]?.pdId === childWoId) return true;
      if (matCode === childWoId) return true;
    }

    return false;
  }

  // Active Job Shop Scheduling Pass
  // Schedules jobs dynamically, minimizing machine idle gaps by pulling ready tasks forward
  // when a machine is free, keeping work centers running as continuously as possible.
  // Enforces 10-minute move time buffer between different work stations for the same Production Order.
  static applyActiveJobShopScheduling(jobs, scale = 'hr', nowWorkingHour = 0.0, existingScheduledJobs = [], workCenters = {}, allowOffload = true, groupSameItem = true, options = {}) {
    const startOffset = Math.max((scale === 'hr' ? 8.0 : 0.0), nowWorkingHour);

    // Each machine gets `capacity` parallel lanes instead of a single busy-until
    // time, so that many jobs (from different Work Orders) can genuinely run at
    // the same time on a machine configured for it (e.g. an oven/booth/multi-spindle
    // station), instead of queuing strictly one-after-another.
    const machineCapacity = {};
    const machineLanes = {};
    const machineLastItem = {};
    const machineLastMats = {};
    const matPlanSource = options.planMaterials || {};
    const matKeyCache = new Map();
    const matKeysOf = (j) => {
      if (!matKeyCache.has(j)) matKeyCache.set(j, getJobMatKeys(j, matPlanSource));
      return matKeyCache.get(j);
    };
    const getMinLaneIdx = (m) => {
      const lanes = machineLanes[m];
      let idx = 0;
      for (let i = 1; i < lanes.length; i++) {
        if (lanes[i] < lanes[idx]) idx = i;
      }
      return idx;
    };
    const woEndTime = {};
    const woLastMachine = {};

    // Dynamic alternate machine offloading for overloaded machines
    const machineSet = new Set(jobs.map(j => j.machine));
    jobs.forEach(job => {
      const origM = job.originalMachine || job.machine;
      job.originalMachine = origM;
      const altStr = allowOffload ? (workCenters[origM]?.altMachines || '') : '';
      if (altStr) {
        const altList = altStr.split(',').map(s => s.trim()).filter(m => m && (workCenters[m] || machineSet.has(m)));
        job.altCandidates = [origM, ...altList];
      } else {
        job.altCandidates = [origM];
      }
    });

    // Initialize machines list
    const allMachines = [...new Set([
      ...jobs.flatMap(j => j.altCandidates || [j.machine]),
      ...existingScheduledJobs.map(j => j.machine)
    ])];

    const isDone = (j) => j.status === 'Completed' || j.opStatus === 'Completed';

    // Initialize each machine's lanes (capacity-many) based on existing scheduled jobs.
    // Existing jobs are greedily packed onto whichever lane is free earliest, same
    // idea as interval-graph "machine minimization" packing.
    // Also track the last item on each lane to support same-item grouping continuity.
    allMachines.forEach(m => {
      const cap = Math.max(1, parseInt(workCenters[m]?.capacity, 10) || 1);
      machineCapacity[m] = cap;
      const lanes = new Array(cap).fill(startOffset);
      const lastItems = new Array(cap).fill('');
      const lastMats = new Array(cap).fill(null);
      const machineJobs = existingScheduledJobs
        .filter(j => j.machine === m)
        .sort((a, b) => a.startHour - b.startHour);
      machineJobs.forEach(j => {
        let best = 0;
        for (let i = 1; i < lanes.length; i++) if (lanes[i] < lanes[best]) best = i;
        // A finished job cannot occupy time that has not happened yet (its startHour may still hold the old planned date).
        const jEnd = isDone(j) ? Math.min(j.startHour + j.estHours, startOffset) : j.startHour + j.estHours;
        lanes[best] = Math.max(lanes[best], jEnd);
        lastItems[best] = getItemKey(j);
        lastMats[best] = matKeysOf(j);
      });
      machineLanes[m] = lanes;
      machineLastItem[m] = lastItems;
      machineLastMats[m] = lastMats;
    });

    // Initialize woEndTimes & woLastMachine based on existing scheduled jobs
    existingScheduledJobs.forEach(j => {
      if (j.woId) {
        const currentEnd = woEndTime[j.woId] || startOffset;
        const jobEnd = isDone(j) ? Math.min(j.startHour + j.estHours, startOffset) : j.startHour + j.estHours;
        if (jobEnd >= currentEnd) {
          woEndTime[j.woId] = jobEnd;
          woLastMachine[j.woId] = j.machine;
        }
      }
    });

    // --- Indexes so lookups inside the dispatch loop are O(1) / O(small constant)
    // instead of O(n) scans over the whole unscheduled pool (was O(n^3) overall). ---

    // Parent WO id -> direct/indirect child WO ids (child.woId startsWith parent.woId + '-', assemblyLinks, or Plan + Mat)
    const allDistinctWoIds = [...new Set([
      ...jobs.map(j => j.woId).filter(Boolean),
      ...existingScheduledJobs.map(j => j.woId).filter(Boolean)
    ])];
    const allCombinedJobs = [...existingScheduledJobs, ...jobs];

    const prefixChildren = new Map();
    allDistinctWoIds.forEach(id => {
      let idx = id.indexOf('-');
      while (idx !== -1) {
        const parent = id.substring(0, idx);
        let list = prefixChildren.get(parent);
        if (!list) {
          list = [];
          prefixChildren.set(parent, list);
        }
        list.push(id);
        idx = id.indexOf('-', idx + 1);
      }
    });

    const linkChildren = new Map();
    (options.assemblyLinks || []).forEach(link => {
      const fromWo = (link.from || '').split('-')[0];
      const toWo = (link.to || '').split('-')[0];
      if (toWo && fromWo && toWo !== fromWo) {
        let list = linkChildren.get(toWo);
        if (!list) {
          list = [];
          linkChildren.set(toWo, list);
        }
        list.push(fromWo);
      }
    });

    const dwgMap = new Map();
    const woMap = new Map();
    for (let i = 0; i < allCombinedJobs.length; i++) {
      const j = allCombinedJobs[i];
      if (j.woId) {
        if (j.dwgNo) {
          const d = j.dwgNo.trim();
          if (!dwgMap.has(d)) dwgMap.set(d, j.woId);
        }
        if (!woMap.has(j.woId)) woMap.set(j.woId, j.woId);
      }
    }

    const planMats = options.planMaterials || {};
    const dwgMapObj = options.dwgToPdMap || {};
    const childrenOf = new Map();
    for (let pIdx = 0; pIdx < allDistinctWoIds.length; pIdx++) {
      const parentId = allDistinctWoIds[pIdx];
      const children = new Set();
      const pKids = prefixChildren.get(parentId);
      if (pKids) {
        for (let i = 0; i < pKids.length; i++) children.add(pKids[i]);
      }
      const mats = planMats[parentId];
      const matKids = new Set();
      if (mats) {
        for (let i = 0; i < mats.length; i++) {
          const matCode = String(mats[i].mat || '').trim();
          if (!matCode) continue;
          const mapped = dwgMapObj[matCode]?.pdId;
          if (mapped && mapped !== parentId) matKids.add(mapped);
          const matchWo = dwgMap.get(matCode) || woMap.get(matCode);
          if (matchWo && matchWo !== parentId) matKids.add(matchWo);
        }
      }
      matKids.forEach(k => children.add(k));
      // A PD whose Plan + Mat lists only raw material (no child PD) has no sub-PDs: its assembly links are ignored.
      const rawMaterialOnly = !!mats && mats.some(m => String(m.mat || '').trim()) && matKids.size === 0;
      const lKids = rawMaterialOnly ? null : linkChildren.get(parentId);
      if (lKids) {
        for (let i = 0; i < lKids.length; i++) children.add(lKids[i]);
      }
      // Link / Plan + Mat children must sit in the parent's PD Range (dash-suffix children always count)
      childrenOf.set(parentId, Array.from(children).filter(cid => cid.startsWith(parentId + '-') || Scheduler.isInParentPdRange(cid, parentId, options)));
    }

    // AMW: Part Tier per WO (1 = feeds / is welded, 2 = outsourced, 3 = CNC part, 4 = general). Lower tier is dispatched first on a tie.
    const amw = options.amw || null;
    const amwTierOf = new Map();
    if (amw) {
      const weldWos = new Set();
      const outsourceWos = new Set();
      const cncWos = new Set();
      allCombinedJobs.forEach(j => {
        if (!j.woId) return;
        const m = j.originalMachine || j.machine;
        if (amw.drum.has(m)) weldWos.add(j.woId);
        if (String(m || '').startsWith('SUB')) outsourceWos.add(j.woId);
        if (amw.cnc.has(m)) cncWos.add(j.woId);
      });
      const feedsWeld = new Set(weldWos);
      const stack = Array.from(weldWos);
      while (stack.length) {
        const w = stack.pop();
        (childrenOf.get(w) || []).forEach(c => {
          if (!feedsWeld.has(c)) { feedsWeld.add(c); stack.push(c); }
        });
      }
      allDistinctWoIds.forEach(w => {
        amwTierOf.set(w, feedsWeld.has(w) ? 1 : outsourceWos.has(w) ? 2 : cncWos.has(w) ? 3 : 4);
      });
    }
    const tierOfJob = (j) => (amw && amwTierOf.get(j.woId)) || 4;
    if (amw) Scheduler._amwChildrenOf = childrenOf; // lets applyAmwDbr walk the sub-PD tree for the Rope

    // Remaining (not-yet-scheduled) steps per WO - sorted ascending by stepNum
    const remainingStepsByWo = new Map();
    jobs.forEach(job => {
      if (!job.woId) return;
      let arr = remainingStepsByWo.get(job.woId);
      if (!arr) {
        arr = [];
        remainingStepsByWo.set(job.woId, arr);
      }
      arr.push(job);
    });
    remainingStepsByWo.forEach(arr => arr.sort((a, b) => a.stepNum - b.stepNum));

    // Inverted index child -> parents for O(1) unscheduled child checks
    const parentsOfChild = new Map();
    childrenOf.forEach((kids, parentId) => {
      kids.forEach(cid => {
        let plist = parentsOfChild.get(cid);
        if (!plist) {
          plist = [];
          parentsOfChild.set(cid, plist);
        }
        plist.push(parentId);
      });
    });

    const unscheduledChildCount = new Map();
    allDistinctWoIds.forEach(parentId => {
      const kids = childrenOf.get(parentId);
      if (!kids || kids.length === 0) {
        unscheduledChildCount.set(parentId, 0);
        return;
      }
      let count = 0;
      for (let k = 0; k < kids.length; k++) {
        const arr = remainingStepsByWo.get(kids[k]);
        if (arr && arr.length > 0) count++;
      }
      unscheduledChildCount.set(parentId, count);
    });

    const removeFromWoRemaining = (job) => {
      if (!job.woId) return;
      const arr = remainingStepsByWo.get(job.woId);
      if (!arr) return;
      if (arr[0] === job) {
        arr.shift();
      } else {
        const idx = arr.indexOf(job);
        if (idx !== -1) arr.splice(idx, 1);
      }
      if (arr.length === 0) {
        // Child WO has no more remaining steps! Update parents
        const parents = parentsOfChild.get(job.woId);
        if (parents) {
          for (let p = 0; p < parents.length; p++) {
            const pid = parents[p];
            const c = unscheduledChildCount.get(pid);
            if (c > 0) unscheduledChildCount.set(pid, c - 1);
          }
        }
      }
    };

    const hasUnscheduledChildSteps = (parentWoId) => {
      return (unscheduledChildCount.get(parentWoId) || 0) > 0;
    };

    // Unscheduled jobs bucketed per eligible machine (a job can sit in multiple buckets via altCandidates)
    const jobsByMachine = new Map(allMachines.map(m => [m, new Set()]));
    jobs.forEach(job => {
      (job.altCandidates || [job.machine]).forEach(m => {
        if (!jobsByMachine.has(m)) jobsByMachine.set(m, new Set());
        jobsByMachine.get(m).add(job);
      });
    });
    const removeFromMachineBuckets = (job) => {
      (job.altCandidates || [job.machine]).forEach(m => {
        const set = jobsByMachine.get(m);
        if (set) set.delete(job);
      });
    };

    const scheduled = [];
    let remainingCount = jobs.length;
    let totalPasses = 0; // hard cap on dispatch passes so a bad sub-PD link can never freeze the page
    let stallPasses = 0; // consecutive passes where nothing could start and no end time was pending

    while (remainingCount > 0) {
      totalPasses++;
      let bestMachine = null;
      let minMachineTime = Infinity;
      allMachines.forEach(m => {
        const bucket = jobsByMachine.get(m);
        if (!bucket || bucket.size === 0) return;
        const laneTime = machineLanes[m][getMinLaneIdx(m)];
        if (laneTime < minMachineTime) {
          minMachineTime = laneTime;
          bestMachine = m;
        }
      });

      if (!bestMachine) break;

      const bestLaneIdx = getMinLaneIdx(bestMachine);
      const t = machineLanes[bestMachine][bestLaneIdx];
      // Candidates that can run on bestMachine
      const candidates = Array.from(jobsByMachine.get(bestMachine));

      const candidateStats = candidates.map(job => {
        const remArr = remainingStepsByWo.get(job.woId);
        const priorUnscheduled = (remArr && remArr.length > 0) ? (remArr[0].stepNum < job.stepNum) : false;

        let readyTime = t;
        if (priorUnscheduled) {
          readyTime = Infinity;
        } else {
          // Check previous step end time + previous machine lead time + move time if moving to a different station
          const lastM = woLastMachine[job.woId];
          const lastLeadDays = (lastM && workCenters[lastM]?.leadTimeDays) ? parseFloat(workCenters[lastM].leadTimeDays) : 0;
          const lastLeadHours = lastLeadDays * 8.0; // 1 day = 8.0 working hours
          const lastTransferMins = (lastM && workCenters[lastM]?.transferMinutes !== undefined) ? parseFloat(workCenters[lastM].transferMinutes) : 10.0;
          const moveBuffer = (lastM && lastM !== bestMachine) ? (lastTransferMins / 60.0) : 0.0;
          const totalBuffer = lastLeadHours + moveBuffer;
          const prevStepEndTime = (woEndTime[job.woId] !== undefined ? (woEndTime[job.woId] + totalBuffer) : startOffset);
          readyTime = Math.max(t, prevStepEndTime);

          // Parent-Child constraint (Forward Pass):
          // Parent / Sub-Assembly WO steps can only start after all Child WO steps are completed (+ lead time & move buffer).
          if (job.woId) {
            const parentWoId = job.woId;
            // Check if this WO has any direct/indirect child WOs still unscheduled
            const hasUnscheduledChildren = hasUnscheduledChildSteps(parentWoId);
            if (hasUnscheduledChildren) {
              readyTime = Infinity;
            } else {
              let maxChildEndTime = startOffset;
              let hasChild = false;

              (childrenOf.get(parentWoId) || []).forEach(childWoId => {
                if (woEndTime[childWoId] !== undefined) {
                  hasChild = true;
                  const childLastM = woLastMachine[childWoId];
                  const childLeadDays = (childLastM && workCenters[childLastM]?.leadTimeDays) ? parseFloat(workCenters[childLastM].leadTimeDays) : 0;
                  const childLeadHours = childLeadDays * 8.0;
                  const childTransferMins = (childLastM && workCenters[childLastM]?.transferMinutes !== undefined) ? parseFloat(workCenters[childLastM].transferMinutes) : 10.0;
                  const childMove = (childLastM && childLastM !== bestMachine) ? (childTransferMins / 60.0) : 0.0;
                  const childEndWithMove = woEndTime[childWoId] + childLeadHours + childMove;
                  if (childEndWithMove > maxChildEndTime) {
                    maxChildEndTime = childEndWithMove;
                  }
                }
              });
              if (hasChild) {
                readyTime = Math.max(readyTime, maxChildEndTime);
              }
            }
          }
        }

        // Opt-in debug: set window.__SCHED_DEBUG_WO = 'PD1234567' (then recompute) to record why that PD is not ready on a lane.
        const dbgWo = (typeof window !== 'undefined') ? window.__SCHED_DEBUG_WO : null;
        if (dbgWo && job.woId === dbgWo) {
          const log = (window.__schedDebug = window.__schedDebug || []);
          if (log.length < 400) {
            const kids = childrenOf.get(job.woId) || [];
            log.push({
              machine: bestMachine, laneTime: +t.toFixed(2), step: job.stepNum,
              priorStepUnscheduled: priorUnscheduled,
              woEnd: woEndTime[job.woId] !== undefined ? +woEndTime[job.woId].toFixed(2) : null,
              readyTime: readyTime === Infinity ? 'Infinity' : +readyTime.toFixed(2),
              unscheduledChildren: kids.filter(k => (remainingStepsByWo.get(k) || []).length > 0),
              childEnds: kids.filter(k => woEndTime[k] !== undefined).map(k => [k, +woEndTime[k].toFixed(2)]).sort((a, b) => b[1] - a[1]).slice(0, 5)
            });
          }
        }
        // AMW Rope: upstream work is not released earlier than the Welding drum needs it (minus the buffer)
        if (amw && readyTime !== Infinity && job.releaseHour !== undefined && job.releaseHour !== null) {
          readyTime = Math.max(readyTime, job.releaseHour);
        }
        const gap = readyTime - t;
        return { job, readyTime, gap };
      });

      const validCandidates = candidateStats.filter(c => c.readyTime !== Infinity);

      if (validCandidates.length === 0) {
        let nextTime = t + 0.25;
        const pendingEnds = [];
        candidates.forEach(c => {
          if (c.woId) {
            if (woEndTime[c.woId] !== undefined && woEndTime[c.woId] > t) {
              const lastM = woLastMachine[c.woId];
              const lastLeadDays = (lastM && workCenters[lastM]?.leadTimeDays) ? parseFloat(workCenters[lastM].leadTimeDays) : 0;
              const lastLeadHours = lastLeadDays * 8.0;
              const lastTransferMins = (lastM && workCenters[lastM]?.transferMinutes !== undefined) ? parseFloat(workCenters[lastM].transferMinutes) : 10.0;
              const move = (lastM && lastM !== bestMachine) ? (lastTransferMins / 60.0) : 0.0;
              pendingEnds.push(woEndTime[c.woId] + lastLeadHours + move);
            }
            const parentWoId = c.woId;
            (childrenOf.get(parentWoId) || []).forEach(childWoId => {
              if (woEndTime[childWoId] !== undefined && woEndTime[childWoId] > t) {
                const childLastM = woLastMachine[childWoId];
                const childLeadDays = (childLastM && workCenters[childLastM]?.leadTimeDays) ? parseFloat(workCenters[childLastM].leadTimeDays) : 0;
                const childLeadHours = childLeadDays * 8.0;
                const childTransferMins = (childLastM && workCenters[childLastM]?.transferMinutes !== undefined) ? parseFloat(workCenters[childLastM].transferMinutes) : 10.0;
                const childMove = (childLastM && childLastM !== bestMachine) ? (childTransferMins / 60.0) : 0.0;
                pendingEnds.push(woEndTime[childWoId] + childLeadHours + childMove);
              }
            });
          }
        });
        let forceStat = null;
        if (pendingEnds.length > 0) {
          nextTime = Math.min(...pendingEnds);
        } else {
          // Nothing on this machine can start until another machine schedules something (its next
          // PD / sub-PD). Instead of creeping 0.25h per pass up to that machine's time, jump straight
          // to the first 0.25h step at or after it; with no other machine left to wait for, the wait
          // can never end (cyclic / unreachable sub-PD link), so force the first job through.
          let otherMin = Infinity;
          allMachines.forEach(m => {
            if (m === bestMachine) return;
            const b = jobsByMachine.get(m);
            if (!b || b.size === 0) return;
            const lt = machineLanes[m][getMinLaneIdx(m)];
            if (lt < otherMin) otherMin = lt;
          });
          stallPasses++;
          if (otherMin === Infinity || stallPasses > 200 + allMachines.length * 20 || totalPasses > 100000 + jobs.length * 200) {
            forceStat = { job: candidates[0], readyTime: t, gap: 0 };
          } else if (otherMin > t + 1e-9) {
            nextTime = t + Math.ceil((otherMin - t) / 0.25 - 1e-9) * 0.25;
          }
        }
        if (!forceStat) {
          machineLanes[bestMachine][bestLaneIdx] = nextTime;
          continue;
        }
        validCandidates.push(forceStat);
      }
      stallPasses = 0;

      // Prioritize:
      // 0. Same-Item Grouping (if enabled): favor jobs matching the last item on this machine lane to keep setup continuous
      // 1. Priority numeric weight (lower number = higher priority, e.g. 1 before 2, 1.1 before 22)
      // 2. Smallest gap (keep machines running continuously)
      // 3. Lower stepNum first
      const lastItemOnLane = machineLastItem[bestMachine] ? machineLastItem[bestMachine][bestLaneIdx] : '';
      // Work centers with 'check material' on: after same-item grouping, prefer a job that shares
      // a raw material with the previous job on this lane (different PDs, same material -> run together).
      const lastMatsOnLane = (options.groupMat === true && workCenters[bestMachine]?.checkMaterial && machineLastMats[bestMachine]) ? machineLastMats[bestMachine][bestLaneIdx] : null;
      const sharesLastMat = (j) => !!lastMatsOnLane && lastMatsOnLane.length > 0 && matKeysOf(j).some(k => lastMatsOnLane.includes(k));
      const amwOnCnc = !!amw && amw.cnc.has(bestMachine);
      // AMW CNC rule: a part that just came out of Welding goes first (post-weld parts are never made to wait)
      const isPostWeld = (j) => !!amw && amw.drum.has(woLastMachine[j.woId]) && woEndTime[j.woId] !== undefined;
      validCandidates.sort((a, b) => {
        if (amwOnCnc) {
          const aPW = isPostWeld(a.job) ? 1 : 0;
          const bPW = isPostWeld(b.job) ? 1 : 0;
          if (aPW !== bPW) return bPW - aPW;
        }
        const pA = getPriorityWeight(a.job.priority);
        const pB = getPriorityWeight(b.job.priority);

        if (groupSameItem && lastItemOnLane) {
          const aMatch = (getItemKey(a.job) === lastItemOnLane) ? 1 : 0;
          const bMatch = (getItemKey(b.job) === lastItemOnLane) ? 1 : 0;
          if (aMatch !== bMatch) {
            // Favor matching item if priorities are in the same tier (weight diff <= 1000)
            if (Math.abs(pA - pB) <= 1000) {
              return bMatch - aMatch;
            }
          }
        }

        if (lastMatsOnLane) {
          const aMat = sharesLastMat(a.job) ? 1 : 0;
          const bMat = sharesLastMat(b.job) ? 1 : 0;
          if (aMat !== bMat && Math.abs(pA - pB) <= 1000) {
            return bMat - aMat;
          }
        }

        if (pA !== pB) return pA - pB;
        if (amw) {
          const tA = tierOfJob(a.job);
          const tB = tierOfJob(b.job);
          if (tA !== tB) return tA - tB;
        }
        if (a.gap !== b.gap) return a.gap - b.gap;
        return a.job.stepNum - b.job.stepNum;
      });

      let best = validCandidates[0];

      // Gap-filling: the highest-priority candidate may still have to wait
      // (gap > 0) on its own routing/lead time before it can actually start.
      // Rather than let the machine sit idle for that whole stretch, look for
      // a lower-priority candidate that's ready sooner and finishes before
      // the high-priority job would even become available - it doesn't delay
      // the high-priority job at all, so run it in the gap instead.
      // validCandidates is already sorted by priority, so the first match is
      // the highest-priority one among those that actually fit.
      if (best.gap > 0) {
        const filler = validCandidates.find(c => c !== best && (c.readyTime + c.job.estHours) <= best.readyTime);
        if (filler) {
          best = filler;
        }
      }
      const job = best.job;
      const origM = job.originalMachine || job.machine;
      job.originalMachine = origM;
      job.machine = bestMachine; // Assign chosen machine (whether primary or alternate)
      job.isOffloaded = Boolean(origM && bestMachine !== origM);
      const start = best.readyTime;

      // Duration comes straight from the job (setup + qty*cycle, already computed at
      // routing-step edit / import time) and is never rescaled here. workHoursPerDay
      // is capacity/OEE information (how many hours/day the station runs), not a
      // per-job speed multiplier - scaling estHours by it made durations drift further
      // from the real setup+cycle time every time the schedule was recomputed.
      const effectiveHours = job.estHours;

      const adjustedStart = this.adjustToWorkingHours(start, effectiveHours, false, scale);
      const end = adjustedStart + effectiveHours;

      job.startHour = parseFloat(adjustedStart.toFixed(4));

      machineLanes[bestMachine][bestLaneIdx] = end;
      if (machineLastItem[bestMachine]) {
        machineLastItem[bestMachine][bestLaneIdx] = getItemKey(job);
      }
      if (machineLastMats[bestMachine]) {
        machineLastMats[bestMachine][bestLaneIdx] = matKeysOf(job);
      }
      if (job.woId) {
        woEndTime[job.woId] = end;
        woLastMachine[job.woId] = bestMachine;
      }
      scheduled.push(job);

      removeFromMachineBuckets(job);
      removeFromWoRemaining(job);
      remainingCount--;
    }

    return [...existingScheduledJobs.map(j => ({ ...j })), ...scheduled];
  }

  // Wrapper to support legacy finite scheduling calls in UI
  static applyForwardsFinite(jobs, scale = 'hr', nowWorkingHour = 0.0, workCenters = {}, allowOffload = true, groupSameItem = true, options = {}) {
    // Completed jobs are done - keep them fixed (as already-occupied machine time)
    // instead of feeding them back into the dispatch pool, or a finished PD would
    // get a brand-new startHour (and look "reloaded into the plan") every time the
    // scale changes.
    const completedJobs = jobs.filter(j => j.status === 'Completed');
    const pendingJobs = jobs.filter(j => j.status !== 'Completed');
    return this.applyActiveJobShopScheduling(pendingJobs, scale, nowWorkingHour, completedJobs, workCenters, allowOffload, groupSameItem, options);
  }

  // AMW strategy (TOC / Drum-Buffer-Rope), two passes:
  //  1. Forward finite dispatch with AMW rules (Welding drum ordered by Priority + Part Tier, post-weld CNC parts first).
  //  2. Rope: upstream steps feeding Welding are released no earlier than (drum start - chain time - Constraint Buffer),
  //     then dispatch again. Pass 2 is kept only when Welding throughput does not get worse.
  // Returns the scheduled jobs; the Drum / Rope summary is left in Scheduler.lastAmwReport.
  static applyAmwDbr(jobs, scale = 'hr', nowWorkingHour = 0.0, workCenters = {}, allowOffload = true, groupSameItem = true, options = {}) {
    const roles = getAmwRoles(workCenters);
    const runOptions = { ...options, amw: roles };
    const pending = jobs.filter(j => j.status !== 'Completed');
    const grab = () => new Map(pending.map(j => [j, { machine: j.machine, originalMachine: j.originalMachine, isOffloaded: j.isOffloaded, startHour: j.startHour }]));
    const put = (snap) => snap.forEach((v, j) => { j.machine = v.machine; j.originalMachine = v.originalMachine; j.isOffloaded = v.isOffloaded; j.startHour = v.startHour; });
    const original = grab();
    pending.forEach(j => { delete j.releaseHour; });

    const drumStats = (list) => {
      const perWc = {};
      list.forEach(j => {
        if (j.status === 'Completed' || !roles.drum.has(j.machine)) return;
        const w = perWc[j.machine] || (perWc[j.machine] = { jobs: 0, busy: 0, first: Infinity, last: 0 });
        w.jobs++; w.busy += j.estHours; w.first = Math.min(w.first, j.startHour); w.last = Math.max(w.last, j.startHour + j.estHours);
      });
      Object.values(perWc).forEach(w => {
        const span = Math.max(0, w.last - w.first);
        w.idle = +Math.max(0, span - w.busy).toFixed(2);
        w.utilization = span > 0 ? +(w.busy / span).toFixed(3) : 1;
        w.busy = +w.busy.toFixed(2);
      });
      return perWc;
    };
    const lastDrumEnd = (stats) => Math.max(0, ...Object.values(stats).map(w => w.last));

    const result1 = this.applyForwardsFinite(jobs, scale, nowWorkingHour, workCenters, allowOffload, groupSameItem, runOptions);
    const stats1 = drumStats(result1);
    const pass1 = grab();

    // Rope release hour of every upstream step, from the pass-1 drum start of its WO
    const byWo = new Map();
    pending.forEach(j => {
      if (!j.woId) return;
      if (!byWo.has(j.woId)) byWo.set(j.woId, []);
      byWo.get(j.woId).push(j);
    });
    const release = new Map();
    const childrenOf = Scheduler._amwChildrenOf || new Map();
    const drumStartOfWo = new Map();
    byWo.forEach((steps, wo) => {
      steps.sort((a, b) => a.stepNum - b.stepNum);
      const weld = steps.find(j => roles.drum.has(j.machine));
      if (weld) drumStartOfWo.set(wo, weld.startHour);
    });
    // Rope target per WO = earliest Drum start that it feeds (its own Welding step, or any ancestor's)
    const needBy = new Map();
    const visit = (wo, t, seen) => {
      if (seen.has(wo)) return;
      seen.add(wo);
      if (needBy.get(wo) === undefined || t < needBy.get(wo)) needBy.set(wo, t);
      (childrenOf.get(wo) || []).forEach(c => visit(c, t, seen));
      seen.delete(wo);
    };
    drumStartOfWo.forEach((t, wo) => visit(wo, t, new Set()));
    byWo.forEach((steps, wo) => {
      const target = needBy.get(wo);
      if (target === undefined) return;
      const ownWeldIdx = steps.findIndex(j => roles.drum.has(j.machine));
      // own steps before the weld step, or every step of a child WO feeding a welded parent
      const last = ownWeldIdx >= 0 ? ownWeldIdx : steps.length;
      for (let i = last - 1; i >= 0; i--) {
        const chain = steps.slice(i, last).reduce((sum, j) => sum + j.estHours, 0);
        const lead = Math.max(0, target - steps[i].startHour);
        const buffer = Math.max(8.0, lead * AMW_CONSTRAINT_BUFFER_RATIO);
        const rel = target - chain - buffer;
        if (rel > steps[i].startHour + 1e-6 && rel > nowWorkingHour) release.set(steps[i], rel);
      }
    });

    let result = result1;
    let stats = stats1;
    let passUsed = 1;
    if (release.size > 0) {
      put(original);
      release.forEach((rel, j) => { j.releaseHour = rel; });
      const result2 = this.applyForwardsFinite(jobs, scale, nowWorkingHour, workCenters, allowOffload, groupSameItem, runOptions);
      const stats2 = drumStats(result2);
      // Throughput guard: keep the Rope plan only when the Drum does not finish later (tolerance 8h)
      if (lastDrumEnd(stats2) <= lastDrumEnd(stats1) + 8.0) {
        result = result2; stats = stats2; passUsed = 2;
      } else {
        pending.forEach(j => { delete j.releaseHour; });
        put(pass1);
        result = result1;
      }
    }

    Scheduler.lastAmwReport = {
      at: Date.now(), passUsed, ropeReleases: passUsed === 2 ? release.size : 0,
      drum: stats, drumWorkCenters: Array.from(roles.drum), cncWorkCenters: Array.from(roles.cnc)
    };
    return result;
  }

  // Backward Active Job Shop Scheduling Pass
  // Schedules jobs backwards from a target deadline, minimizing gaps and keeping tasks close to the deadline.
  // Enforces 10-minute move time buffer between different work stations for the same Production Order.
  static applyActiveJobShopSchedulingBackwards(jobs, scale = 'hr', deadlineHour = 100.0, existingScheduledJobs = [], nowWorkingHour = 0.0, workCenters = {}) {
    const startOffset = Math.max((scale === 'hr' ? 8.0 : 0.0), nowWorkingHour);
    const TRANSFER_HOURS = 10.0 / 60.0; // 10 minutes transfer buffer = 0.1667h
    
    // Shift any existing scheduled jobs that start before startOffset by work order families
    const woGroupMinStart = {};
    existingScheduledJobs.forEach(j => {
      const woId = j.woId || j.id.split('-')[0];
      if (j.startHour !== undefined && j.startHour !== null) {
        if (woGroupMinStart[woId] === undefined || j.startHour < woGroupMinStart[woId]) {
          woGroupMinStart[woId] = j.startHour;
        }
      }
    });

    existingScheduledJobs.forEach(j => {
      const woId = j.woId || j.id.split('-')[0];
      const minStart = woGroupMinStart[woId];
      if (minStart !== undefined && minStart !== null && minStart < startOffset) {
        const delta = startOffset - minStart;
        j.startHour += delta;
      }
    });

    const machineTime = {};
    const machineMinTime = {};
    const woStartTime = {};
    const woFirstMachine = {};
    const completedJobs = new Set();
    
    jobs.forEach(job => {
      const origM = job.originalMachine || job.machine;
      job.originalMachine = origM;
      const altStr = workCenters[origM]?.altMachines || '';
      if (altStr) {
        const altList = altStr.split(',').map(s => s.trim()).filter(m => m && (workCenters[m] || jobs.some(j => j.machine === m)));
        job.altCandidates = [origM, ...altList];
      } else {
        job.altCandidates = [origM];
      }
    });

    // Initialize machines list
    const allMachines = [...new Set([
      ...jobs.flatMap(j => j.altCandidates || [j.machine]), 
      ...existingScheduledJobs.map(j => j.machine)
    ])];
    
    // For each machine, it cannot start before the end of the existing jobs on that machine.
    allMachines.forEach(m => {
      const machineJobs = existingScheduledJobs.filter(j => j.machine === m);
      const maxFinish = machineJobs.length > 0 ? Math.max(...machineJobs.map(j => j.startHour + j.estHours)) : startOffset;
      machineMinTime[m] = Math.max(startOffset, maxFinish);
      machineTime[m] = Math.max(deadlineHour, machineMinTime[m]);
    });

    // Initialize woStartTimes based on existing scheduled jobs
    existingScheduledJobs.forEach(j => {
      if (j.woId) {
        const currentStart = woStartTime[j.woId] !== undefined ? woStartTime[j.woId] : Infinity;
        if (j.startHour <= currentStart) {
          woStartTime[j.woId] = j.startHour;
          woFirstMachine[j.woId] = j.machine;
        }
      }
    });

    const unscheduled = [...jobs];
    const scheduled = [];

    while (unscheduled.length > 0) {
      let bestMachine = null;
      let maxMachineTime = -Infinity;
      allMachines.forEach(m => {
        const hasJobs = unscheduled.some(j => j.machine === m || (j.altCandidates && j.altCandidates.includes(m)));
        if (hasJobs && machineTime[m] > maxMachineTime) {
          maxMachineTime = machineTime[m];
          bestMachine = m;
        }
      });

      if (!bestMachine) break;

      const t = machineTime[bestMachine];
      const candidates = unscheduled.filter(j => j.machine === bestMachine || (j.altCandidates && j.altCandidates.includes(bestMachine)));

      const candidateStats = candidates.map(job => {
        const subsequentUnscheduled = unscheduled.some(uj => uj.woId === job.woId && uj.stepNum > job.stepNum);
        
        let readyEndTime = t;
        if (subsequentUnscheduled) {
          readyEndTime = -Infinity;
        } else {
          // Check subsequent step start time - current machine lead time - move time if moving to a different station
          const currLeadDays = (workCenters[bestMachine]?.leadTimeDays) ? parseFloat(workCenters[bestMachine].leadTimeDays) : 0;
          const currLeadHours = currLeadDays * 8.0; // 1 day = 8.0 working hours
          const nextM = woFirstMachine[job.woId];
          const currTransferMins = (workCenters[bestMachine]?.transferMinutes !== undefined) ? parseFloat(workCenters[bestMachine].transferMinutes) : 10.0;
          const moveBuffer = (nextM && nextM !== bestMachine) ? (currTransferMins / 60.0) : 0.0;
          const totalBuffer = currLeadHours + moveBuffer;
          const nextStepStartTime = woStartTime[job.woId] !== undefined ? (woStartTime[job.woId] - totalBuffer) : deadlineHour;
          readyEndTime = Math.min(t, nextStepStartTime);

          // Parent-Child constraint (backwards pass):
          // Child / Sub-Assembly steps must be scheduled before Parent / Assembly steps start.
          if (job.woId) {
            const lastDash = job.woId.lastIndexOf('-');
            if (lastDash > 0) {
              const parentWoId = job.woId.substring(0, lastDash);
              const hasUnscheduledParent = unscheduled.some(uj => uj.woId === parentWoId);
              if (hasUnscheduledParent) {
                readyEndTime = -Infinity;
              } else {
                const parentFirstM = woFirstMachine[parentWoId];
                const childLeadDays = (workCenters[bestMachine]?.leadTimeDays) ? parseFloat(workCenters[bestMachine].leadTimeDays) : 0;
                const childLeadHours = childLeadDays * 8.0;
                const childTransferMins = (workCenters[bestMachine]?.transferMinutes !== undefined) ? parseFloat(workCenters[bestMachine].transferMinutes) : 10.0;
                const move = (parentFirstM && parentFirstM !== bestMachine) ? (childTransferMins / 60.0) : 0.0;
                const parentStartTime = woStartTime[parentWoId] !== undefined ? (woStartTime[parentWoId] - childLeadHours - move) : deadlineHour;
                readyEndTime = Math.min(readyEndTime, parentStartTime);
              }
            }
          }
        }

        const gap = t - readyEndTime;
        return { job, readyEndTime, gap };
      });

      const validCandidates = candidateStats.filter(c => c.readyEndTime !== -Infinity);

      if (validCandidates.length === 0) {
        let nextTime = t - 0.25;
        const pendingStarts = [];
        candidates.forEach(c => {
          if (c.woId) {
            if (woStartTime[c.woId] !== undefined && woStartTime[c.woId] < t) {
              const nextM = woFirstMachine[c.woId];
              const currLeadDays = (workCenters[bestMachine]?.leadTimeDays) ? parseFloat(workCenters[bestMachine].leadTimeDays) : 0;
              const currLeadHours = currLeadDays * 8.0;
              const currTransferMins = (workCenters[bestMachine]?.transferMinutes !== undefined) ? parseFloat(workCenters[bestMachine].transferMinutes) : 10.0;
              const move = (nextM && nextM !== bestMachine) ? (currTransferMins / 60.0) : 0.0;
              pendingStarts.push(woStartTime[c.woId] - currLeadHours - move);
            }
            const lastDash = c.woId.lastIndexOf('-');
            if (lastDash > 0) {
              const pId = c.woId.substring(0, lastDash);
              if (woStartTime[pId] !== undefined && woStartTime[pId] < t) {
                const pFirstM = woFirstMachine[pId];
                const childLeadDays = (workCenters[bestMachine]?.leadTimeDays) ? parseFloat(workCenters[bestMachine].leadTimeDays) : 0;
                const childLeadHours = childLeadDays * 8.0;
                const childTransferMins = (workCenters[bestMachine]?.transferMinutes !== undefined) ? parseFloat(workCenters[bestMachine].transferMinutes) : 10.0;
                const move = (pFirstM && pFirstM !== bestMachine) ? (childTransferMins / 60.0) : 0.0;
                pendingStarts.push(woStartTime[pId] - childLeadHours - move);
              }
            }
          }
        });
        if (pendingStarts.length > 0) {
          nextTime = Math.max(...pendingStarts);
        }
        machineTime[bestMachine] = Math.max(nextTime, machineMinTime[bestMachine]);
        continue;
      }

      // Prioritize:
      // 1. Priority numeric weight (lower number = higher priority)
      // 2. Smallest gap
      // 3. Higher stepNum first (backwards)
      validCandidates.sort((a, b) => {
        const pA = getPriorityWeight(a.job.priority);
        const pB = getPriorityWeight(b.job.priority);
        if (pA !== pB) return pA - pB;
        if (a.gap !== b.gap) return a.gap - b.gap;
        return b.job.stepNum - a.job.stepNum;
      });

      const best = validCandidates[0];
      const job = best.job;
      const origM = job.originalMachine || job.machine;
      job.originalMachine = origM;
      job.machine = bestMachine;
      job.isOffloaded = Boolean(origM && bestMachine !== origM);
      
      // Duration comes straight from the job (setup + qty*cycle) - see the forwards
      // pass above for why this is no longer rescaled by workHoursPerDay.
      const effectiveHours = job.estHours;

      const end = best.readyEndTime;
      const start = end - effectiveHours;

      const adjustedStart = this.adjustToWorkingHours(start, effectiveHours, true, scale);
      const finalStart = Math.max(machineMinTime[bestMachine], adjustedStart);

      job.startHour = parseFloat(finalStart.toFixed(4));

      machineTime[bestMachine] = finalStart;
      if (job.woId) {
        const currentStart = woStartTime[job.woId] !== undefined ? woStartTime[job.woId] : Infinity;
        if (finalStart <= currentStart) {
          woStartTime[job.woId] = finalStart;
          woFirstMachine[job.woId] = bestMachine;
        }
      }
      completedJobs.add(job.id);
      scheduled.push(job);

      const idx = unscheduled.findIndex(uj => uj.id === job.id);
      unscheduled.splice(idx, 1);
    }

    return [...existingScheduledJobs.map(j => ({ ...j })), ...scheduled];
  }

  // Helper: Find earliest free slot on a machine without overlapping any scheduled jobs
  // Finds the earliest time >= minStartHour where a new job of length `estHours`
  // can run on `machineName` without more than `capacity` jobs overlapping at any
  // instant. capacity=1 (default) is the original single-lane behavior; capacity>1
  // lets that many jobs from different Work Orders run on the machine in parallel
  // (e.g. an oven/booth/multi-spindle station that can hold several jobs at once).
  static findEarliestFreeSlot(machineName, minStartHour, estHours, scheduledJobs, capacity = 1) {
    const cap = Math.max(1, Math.floor(capacity) || 1);
    const machineJobs = scheduledJobs
      .filter(j => j.machine === machineName && typeof j.startHour === 'number' && !isNaN(j.startHour))
      .map(j => ({ start: j.startHour, end: j.startHour + j.estHours }));

    if (machineJobs.length === 0) {
      return parseFloat(minStartHour.toFixed(4));
    }

    if (cap === 1) {
      // Original single-lane sweep, unchanged for the common case.
      machineJobs.sort((a, b) => a.start - b.start);
      let start = minStartHour;
      while (true) {
        let overlapFound = false;
        const end = start + estHours;
        for (const job of machineJobs) {
          if (start < job.end && end > job.start) {
            start = job.end;
            overlapFound = true;
            break;
          }
        }
        if (!overlapFound) break;
      }
      return parseFloat(start.toFixed(4));
    }

    // Capacity > 1: build a concurrency step function (how many existing jobs are
    // running at any given time) from sorted start/end breakpoints, then walk
    // candidate start times (minStartHour + every existing job's end time) looking
    // for the earliest one where concurrency stays below `cap` for the whole
    // [start, start+estHours) window. O(M log M) instead of the naive O(M^2).
    const events = [];
    machineJobs.forEach(j => {
      events.push([j.end, -1]);   // process ends before starts at the same instant
      events.push([j.start, 1]);
    });
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    const steps = [];
    let running = 0;
    events.forEach(([t, d]) => {
      running += d;
      if (steps.length > 0 && steps[steps.length - 1].time === t) {
        steps[steps.length - 1].level = running;
      } else {
        steps.push({ time: t, level: running });
      }
    });

    const concurrencyAt = (t) => {
      let lo = 0, hi = steps.length - 1, level = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (steps[mid].time <= t) { level = steps[mid].level; lo = mid + 1; }
        else hi = mid - 1;
      }
      return level;
    };

    const candidateSet = new Set([minStartHour]);
    machineJobs.forEach(j => { if (j.end >= minStartHour) candidateSet.add(j.end); });
    const candidates = Array.from(candidateSet).sort((a, b) => a - b);

    for (const start of candidates) {
      const end = start + estHours;
      let maxConcurrent = concurrencyAt(start);
      let lo = 0, hi = steps.length - 1, idx = steps.length;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (steps[mid].time > start) { idx = mid; hi = mid - 1; }
        else lo = mid + 1;
      }
      for (let i = idx; i < steps.length && steps[i].time < end; i++) {
        if (steps[i].level > maxConcurrent) maxConcurrent = steps[i].level;
      }
      if (maxConcurrent < cap) {
        return parseFloat(start.toFixed(4));
      }
    }

    const lastEnd = Math.max(...machineJobs.map(j => j.end));
    return parseFloat(Math.max(minStartHour, lastEnd).toFixed(4));
  }

  // Multi-PD Simulation Placement Engine (Placement of multiple Production Orders simultaneously)
  // Operates on the exact same principles as individual PD simulation placement:
  // 1. Group by Work Order / Hierarchy (Child components scheduled before Parent assemblies)
  // Multi-PD Simulation Placement Engine (Placement of multiple Production Orders simultaneously)
  // Operates on the exact same principles as individual PD simulation placement:
  // 1. Group by Work Order / Hierarchy (Child components scheduled before Parent assemblies)
  // 2. Sort by Priority (High / 1.1 first)
  // 3. Find earliest free slot on machine (or best alternate machine) sequentially for each step (10 -> 20 -> 30)
  // 4. Starts strictly from current time (nowWorkingHour)
  static applyMultiPDSimulationPlacement(backlogWOs = [], scheduledJobs = [], scale = 'day', nowWorkingHour = 0.0, workCenters = {}, lockedProjects = {}, allowOffload = true, groupSameItem = true) {
    const startOffset = Math.max(0.0, typeof nowWorkingHour === 'number' && !isNaN(nowWorkingHour) ? nowWorkingHour : 0.0);

    const isJobFixed = (j) => j.status === 'Completed' || Boolean(lockedProjects && lockedProjects[j.project || 'General']);
    
    // Fixed anchors that cannot be moved
    const fixedJobs = scheduledJobs.filter(isJobFixed).map(j => ({ ...j }));
    const activeBoardJobs = scheduledJobs.filter(j => !isJobFixed(j));

    // Reconstruct Work Order structures from active unlocked board jobs
    const boardWoMap = new Map();
    activeBoardJobs.forEach(job => {
      const woId = job.woId || job.id;
      if (!boardWoMap.has(woId)) {
        boardWoMap.set(woId, {
          id: woId,
          customer: job.customer || 'General',
          project: job.project || 'General',
          dwgNo: job.dwgNo || '',
          partName: job.partName || '',
          qty: job.qty || 1,
          priority: job.priority || 'Normal',
          dueHour: job.dueHour || null,
          originalDueHour: job.originalDueHour !== undefined ? job.originalDueHour : job.dueHour,
          steps: []
        });
      }
      const wo = boardWoMap.get(woId);
      wo.steps.push({
        id: job.id,
        stepNum: job.stepNum || 10,
        name: job.stepName || job.name || job.partName || 'Operation',
        machine: job.originalMachine || job.machine,
        estHours: job.estHours,
        cycleMinutes: job.cycleMinutes !== undefined ? job.cycleMinutes : 1.0,
        setupMinutes: job.setupMinutes !== undefined ? job.setupMinutes : 0.0
      });
    });

    const boardWOs = Array.from(boardWoMap.values());
    const unlockedBacklog = (backlogWOs || []).filter(wo => !lockedProjects || !lockedProjects[wo.project || 'General']);

    // Merge backlog WOs and board WOs
    const combinedWoMap = new Map();
    boardWOs.forEach(wo => combinedWoMap.set(wo.id, wo));
    unlockedBacklog.forEach(wo => combinedWoMap.set(wo.id, wo));
    const allWOs = Array.from(combinedWoMap.values());

    if (allWOs.length === 0) {
      return [...fixedJobs];
    }

    // Sort Work Orders:
    // 1. Priority tier weight (Hot / 1.1 first)
    // 2. Child component WOs before Parent assembly WOs
    // 3. Same-Item Grouping: group identical items together to run consecutively
    // 4. Natural ID sorting
    const sortedWOs = [...allWOs].sort((a, b) => {
      const pA = getPriorityWeight(a.priority);
      const pB = getPriorityWeight(b.priority);
      if (pA !== pB) return pA - pB;

      // Child component WOs before Parent assembly WOs (including welding child PDs)
      const aIsChildOfB = Scheduler.isChildWoOf(a.id, b.id, { allWOs });
      const bIsChildOfA = Scheduler.isChildWoOf(b.id, a.id, { allWOs });
      if (aIsChildOfB && !bIsChildOfA) return -1;
      if (bIsChildOfA && !aIsChildOfB) return 1;

      // Group WOs of the same item together
      if (groupSameItem) {
        const itemA = getItemKey(a);
        const itemB = getItemKey(b);
        if (itemA && itemB && itemA !== itemB) {
          const cmp = itemA.localeCompare(itemB);
          if (cmp !== 0) return cmp;
        } else if (itemA && !itemB) {
          return -1;
        } else if (!itemA && itemB) {
          return 1;
        }
      }

      return a.id.localeCompare(b.id);
    });

    const allScheduledJobs = [...fixedJobs];
    const woEndTimes = {};

    // Record existing fixed jobs into woEndTimes
    fixedJobs.forEach(j => {
      if (j.woId) {
        const end = j.startHour + j.estHours;
        if (woEndTimes[j.woId] === undefined || end > woEndTimes[j.woId]) {
          woEndTimes[j.woId] = end;
        }
      }
    });

    // Sequential multi-PD placement
    sortedWOs.forEach(wo => {
      // Check child component completion times (dash-suffix, assembly links, and welding materials)
      const childEnds = [];
      const childIds = Scheduler.getChildWoIds(wo.id, {
        distinctWoIds: Object.keys(woEndTimes),
        allWOs
      });
      childIds.forEach(cId => {
        if (woEndTimes[cId] !== undefined) {
          childEnds.push(woEndTimes[cId]);
        }
      });
      Object.keys(woEndTimes).forEach(cId => {
        if (cId.startsWith(wo.id + '-') && !childIds.includes(cId)) {
          childEnds.push(woEndTimes[cId]);
        }
      });

      let woStart = startOffset;
      if (childEnds.length > 0) {
        woStart = Math.max(startOffset, ...childEnds);
      }

      let currentStepStart = woStart;
      let lastMachine = null;
      const steps = [...wo.steps].sort((a, b) => a.stepNum - b.stepNum);

      steps.forEach(step => {
        const origM = step.machine;
        const altStr = allowOffload ? (workCenters[origM]?.altMachines || '') : '';
        const candidates = [origM];
        if (altStr) {
          altStr.split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
            if (!candidates.includes(m) && workCenters[m]) candidates.push(m);
          });
        }

        // Lead time (e.g. outsourced processing) from the previous step's machine always
        // applies; the move/transfer time only applies when relocating to a different
        // station. Without this, steps could start the instant the prior one finished,
        // ignoring the configured transfer/lead time between work centers.
        const lastLeadDays = (lastMachine && workCenters[lastMachine]?.leadTimeDays) ? parseFloat(workCenters[lastMachine].leadTimeDays) : 0;
        const lastLeadHours = lastLeadDays * 8.0;
        const floorFor = (candidateMachine) => {
          const transferMins = (lastMachine && workCenters[lastMachine]?.transferMinutes !== undefined) ? parseFloat(workCenters[lastMachine].transferMinutes) : 10.0;
          const moveBuffer = (lastMachine && lastMachine !== candidateMachine) ? (transferMins / 60.0) : 0.0;
          return currentStepStart + lastLeadHours + moveBuffer;
        };

        // Find candidate with earliest free slot
        let bestMachine = origM;
        let bestSlot = this.findEarliestFreeSlot(origM, floorFor(origM), step.estHours, allScheduledJobs, workCenters[origM]?.capacity || 1);

        if (candidates.length > 1) {
          for (let i = 1; i < candidates.length; i++) {
            const altM = candidates[i];
            const altSlot = this.findEarliestFreeSlot(altM, floorFor(altM), step.estHours, allScheduledJobs, workCenters[altM]?.capacity || 1);
            if (altSlot < bestSlot) {
              bestSlot = altSlot;
              bestMachine = altM;
            }
          }
        }

        const startHour = bestSlot;
        const finishHour = parseFloat((startHour + step.estHours).toFixed(4));

        const scheduledStep = {
          id: step.id,
          woId: wo.id,
          customer: wo.customer,
          project: wo.project,
          dwgNo: wo.dwgNo || '',
          partName: wo.partName,
          qty: wo.qty,
          priority: wo.priority,
          memo: wo.memo || (this.state?.pdMemos ? this.state.pdMemos[wo.id] : '') || '',
          stepNum: step.stepNum,
          stepName: step.name || step.stepName,
          machine: bestMachine,
          estHours: step.estHours,
          cycleMinutes: step.cycleMinutes !== undefined ? step.cycleMinutes : 1.0,
          setupMinutes: step.setupMinutes !== undefined ? step.setupMinutes : 0.0,
          startHour: startHour,
          status: 'Scheduled',
          elapsedMinutes: 0,
          delayReason: '',
          dueHour: wo.dueHour || null,
          originalDueHour: wo.originalDueHour !== undefined ? wo.originalDueHour : wo.dueHour,
          originalMachine: origM,
          isOffloaded: bestMachine !== origM,
          altCandidates: candidates
        };

        allScheduledJobs.push(scheduledStep);
        currentStepStart = finishHour;
        lastMachine = bestMachine;
      });

      woEndTimes[wo.id] = currentStepStart;
    });

    return allScheduledJobs;
  }

  // AI Simulation / APS Optimizer
  // Schedules backlog and scheduled steps sequentially using Multi-PD Simulation Placement principles.
  static runAISimulation(backlog, scheduledJobs, scale = 'hr', nowWorkingHour = 0.0, workCenters = {}, lockedProjects = {}, allowOffload = true, groupSameItem = true) {
    return this.applyMultiPDSimulationPlacement(backlog, scheduledJobs, scale, nowWorkingHour, workCenters, lockedProjects, allowOffload, groupSameItem);
  }
}
