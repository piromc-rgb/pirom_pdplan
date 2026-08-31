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

export class Scheduler {
  // Apply Backwards Infinite Scheduling model
  // Arranges all jobs backwards from a simulated due hour (dependent on scale)
  // For jobs belonging to the same WO, steps are sequenced backwards (Step 20 starts when Step 30 starts, etc.)
  static applyBackwardsInfinite(jobs, scale = 'hr') {
    let deadline = 8.0;
    let minStart = 0.0;

    if (scale === 'day') { deadline = 48.0; minStart = 0.0; }
    else if (scale === 'week') { deadline = 192.0; minStart = 0.0; }
    else if (scale === 'month') { deadline = 576.0; minStart = 0.0; }

    // Group jobs by parent Work Order ID
    const woGroups = {};
    const independentJobs = [];

    jobs.forEach(job => {
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

    return updatedJobs;
  }

  // Apply Forwards Finite Scheduling model
  // Arranges jobs starting from 8.0 (or 0.0 for wide scales), and pushes overlapping jobs forward.
  // Enforces step routing sequence constraints (Step N+1 starts after Step N ends).
  static adjustToWorkingHours(startHour, duration, forceConfirm = false, scale = 'hr') {
    return startHour;
  }

  // Active Job Shop Scheduling Pass
  // Schedules jobs dynamically, minimizing machine idle gaps by pulling ready tasks forward
  // when a machine is free, keeping work centers running as continuously as possible.
  // Active Job Shop Scheduling Pass
  // Schedules jobs dynamically, minimizing machine idle gaps by pulling ready tasks forward
  // when a machine is free, keeping work centers running as continuously as possible.
  // Enforces 10-minute move time buffer between different work stations for the same Production Order.
  static applyActiveJobShopScheduling(jobs, scale = 'hr', nowWorkingHour = 0.0, existingScheduledJobs = [], workCenters = {}) {
    const startOffset = Math.max((scale === 'hr' ? 8.0 : 0.0), nowWorkingHour);

    // Each machine gets `capacity` parallel lanes instead of a single busy-until
    // time, so that many jobs (from different Work Orders) can genuinely run at
    // the same time on a machine configured for it (e.g. an oven/booth/multi-spindle
    // station), instead of queuing strictly one-after-another.
    const machineCapacity = {};
    const machineLanes = {};
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
      const altStr = workCenters[origM]?.altMachines || '';
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

    // Initialize each machine's lanes (capacity-many) based on existing scheduled jobs.
    // Existing jobs are greedily packed onto whichever lane is free earliest, same
    // idea as interval-graph "machine minimization" packing.
    allMachines.forEach(m => {
      const cap = Math.max(1, parseInt(workCenters[m]?.capacity, 10) || 1);
      machineCapacity[m] = cap;
      const lanes = new Array(cap).fill(startOffset);
      const machineJobs = existingScheduledJobs
        .filter(j => j.machine === m)
        .sort((a, b) => a.startHour - b.startHour);
      machineJobs.forEach(j => {
        let best = 0;
        for (let i = 1; i < lanes.length; i++) if (lanes[i] < lanes[best]) best = i;
        lanes[best] = Math.max(lanes[best], j.startHour + j.estHours);
      });
      machineLanes[m] = lanes;
    });

    // Initialize woEndTimes & woLastMachine based on existing scheduled jobs
    existingScheduledJobs.forEach(j => {
      if (j.woId) {
        const currentEnd = woEndTime[j.woId] || startOffset;
        const jobEnd = j.startHour + j.estHours;
        if (jobEnd >= currentEnd) {
          woEndTime[j.woId] = jobEnd;
          woLastMachine[j.woId] = j.machine;
        }
      }
    });

    // --- Indexes so lookups inside the dispatch loop are O(1) / O(small constant)
    // instead of O(n) scans over the whole unscheduled pool (was O(n^3) overall). ---

    // Parent WO id -> direct/indirect child WO ids (child.woId startsWith parent.woId + '-')
    const distinctWoIds = [...new Set(jobs.map(j => j.woId).filter(Boolean))];
    const childrenOf = new Map(distinctWoIds.map(id => [id, []]));
    distinctWoIds.forEach(childId => {
      distinctWoIds.forEach(parentId => {
        if (parentId !== childId && childId.startsWith(parentId + '-')) {
          childrenOf.get(parentId).push(childId);
        }
      });
    });

    // Remaining (not-yet-scheduled) steps per WO - small arrays (routing steps per WO)
    const remainingStepsByWo = new Map();
    jobs.forEach(job => {
      if (!job.woId) return;
      if (!remainingStepsByWo.has(job.woId)) remainingStepsByWo.set(job.woId, []);
      remainingStepsByWo.get(job.woId).push(job);
    });
    const removeFromWoRemaining = (job) => {
      if (!job.woId) return;
      const arr = remainingStepsByWo.get(job.woId);
      if (!arr) return;
      const idx = arr.indexOf(job);
      if (idx !== -1) arr.splice(idx, 1);
    };
    const hasUnscheduledChildSteps = (parentWoId) => {
      const kids = childrenOf.get(parentWoId);
      if (!kids || kids.length === 0) return false;
      return kids.some(cid => {
        const arr = remainingStepsByWo.get(cid);
        return arr && arr.length > 0;
      });
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

    while (remainingCount > 0) {
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
        const priorUnscheduled = remArr ? remArr.some(s => s.stepNum < job.stepNum) : false;

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
        if (pendingEnds.length > 0) {
          nextTime = Math.min(...pendingEnds);
        }
        machineLanes[bestMachine][bestLaneIdx] = nextTime;
        continue;
      }

      // Prioritize:
      // 1. Priority numeric weight (lower number = higher priority, e.g. 1 before 2, 1.1 before 22)
      // 2. Smallest gap (keep machines running continuously)
      // 3. Lower stepNum first
      validCandidates.sort((a, b) => {
        const pA = getPriorityWeight(a.job.priority);
        const pB = getPriorityWeight(b.job.priority);
        if (pA !== pB) return pA - pB;
        if (a.gap !== b.gap) return a.gap - b.gap;
        return a.job.stepNum - b.job.stepNum;
      });

      const best = validCandidates[0];
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
  static applyForwardsFinite(jobs, scale = 'hr', nowWorkingHour = 0.0, workCenters = {}) {
    return this.applyActiveJobShopScheduling(jobs, scale, nowWorkingHour, [], workCenters);
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
  static applyMultiPDSimulationPlacement(backlogWOs = [], scheduledJobs = [], scale = 'day', nowWorkingHour = 0.0, workCenters = {}, lockedProjects = {}) {
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
    // 3. Natural ID sorting
    const sortedWOs = [...allWOs].sort((a, b) => {
      const pA = getPriorityWeight(a.priority);
      const pB = getPriorityWeight(b.priority);
      if (pA !== pB) return pA - pB;

      const isAChild = a.id.includes('-');
      const isBChild = b.id.includes('-');
      if (isAChild && !isBChild && a.id.startsWith(b.id + '-')) return -1;
      if (isBChild && !isAChild && b.id.startsWith(a.id + '-')) return 1;

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
      // Check child component completion times
      const childEnds = [];
      Object.keys(woEndTimes).forEach(cId => {
        if (cId.startsWith(wo.id + '-')) {
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
        const altStr = workCenters[origM]?.altMachines || '';
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
  static runAISimulation(backlog, scheduledJobs, scale = 'hr', nowWorkingHour = 0.0, workCenters = {}, lockedProjects = {}) {
    return this.applyMultiPDSimulationPlacement(backlog, scheduledJobs, scale, nowWorkingHour, workCenters, lockedProjects);
  }
}
