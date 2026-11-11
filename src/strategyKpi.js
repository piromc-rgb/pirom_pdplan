import { getAmwRoles, getItemKey, AMW_WELD_DRUM_WCS, AMW_WELD_CNC_WCS, AMW_CONSTRAINT_BUFFER_RATIO } from './scheduler.js';

// Planning-strategy KPIs shown at the top right of the header. They are computed from the current plan
// (any Scheduling Model) so the models can be compared side by side. Drum = the constraint Work Center(s)
// of the selected AMW model (Drum = Welding for 'amw-weld', otherwise CNC VF4 / VF7).
export function computeStrategyKpis(state) {
  const variant = state.schedulingModel === 'amw-weld' ? 'amw-weld' : 'amw';
  const roles = getAmwRoles(state.workCenters, variant);
  const jobs = (state.scheduledJobs || []).filter(j => j.status !== 'Completed' && j.opStatus !== 'Completed' && Number.isFinite(j.startHour));
  const end = j => j.startHour + j.estHours;
  const now = state.dateToWorkingHour(new Date());

  // Drum: last finish, utilization, starvation (idle gaps while the whole Drum Work Center is empty)
  const byDrum = new Map();
  jobs.forEach(j => {
    if (!roles.drum.has(j.machine)) return;
    if (!byDrum.has(j.machine)) byDrum.set(j.machine, []);
    byDrum.get(j.machine).push(j);
  });
  let drumLast = 0, busy = 0, capacityHours = 0, starve = 0;
  const perDrum = [];
  byDrum.forEach((list, m) => {
    list.sort((a, b) => a.startHour - b.startHour);
    const cap = Math.max(1, parseInt(state.workCenters[m]?.capacity, 10) || 1);
    let curEnd = list[0].startHour;
    list.forEach(j => {
      busy += j.estHours;
      if (j.startHour - curEnd > 0.25) starve += j.startHour - curEnd;
      curEnd = Math.max(curEnd, end(j));
    });
    const first = list[0].startHour;
    drumLast = Math.max(drumLast, curEnd);
    capacityHours += Math.max(0, curEnd - first) * cap;
    const wcBusy = list.reduce((sum, j) => sum + j.estHours, 0);
    perDrum.push({
      code: m, name: state.workCenters[m]?.name || m, jobs: list.length, cap,
      busy: wcBusy, last: curEnd, util: curEnd - first > 0 ? wcBusy / ((curEnd - first) * cap) : null
    });
  });
  perDrum.sort((a, b) => b.jobs - a.jobs);
  const drumUtil = capacityHours > 0 ? busy / capacityHours : null;

  // Per-WO step lists
  const byWo = new Map();
  jobs.forEach(j => {
    if (!j.woId) return;
    if (!byWo.has(j.woId)) byWo.set(j.woId, []);
    byWo.get(j.woId).push(j);
  });
  byWo.forEach(list => list.sort((a, b) => a.stepNum - b.stepNum));

  // Wait before the Drum: previous step of the same PD, and child PDs (assembly links) finishing before the Drum step
  const waits = [];
  byWo.forEach(list => {
    list.forEach((j, i) => {
      if (roles.drum.has(j.machine) && i > 0) waits.push(Math.max(0, j.startHour - end(list[i - 1])));
    });
  });
  const seen = new Set();
  (state.assemblyLinks || []).forEach(l => {
    const p = String(l.to).split('-')[0];
    const c = String(l.from).split('-')[0];
    const key = c + '>' + p;
    if (seen.has(key)) return;
    seen.add(key);
    const parent = byWo.get(p);
    const child = byWo.get(c);
    if (!parent || !child) return;
    const drumStep = parent.find(j => roles.drum.has(j.machine));
    if (!drumStep) return;
    const w = drumStep.startHour - Math.max(...child.map(end));
    if (w >= 0) waits.push(w);
  });

  // Wait for CNC right after the Drum
  const cncWaits = [];
  byWo.forEach(list => {
    list.forEach((j, i) => {
      if (roles.drum.has(j.machine) && i < list.length - 1 && roles.cnc.has(list[i + 1].machine)) {
        cncWaits.push(Math.max(0, list[i + 1].startHour - end(j)));
      }
    });
  });

  // Flow time (PD finish - now, working days) and makespan
  const woEnds = [];
  byWo.forEach(list => woEnds.push(Math.max(...list.map(end))));
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = a => {
    if (!a.length) return null;
    const t = a.slice().sort((x, y) => x - y);
    const m = t.length >> 1;
    return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
  };
  const flowDays = woEnds.length ? Math.max(0, median(woEnds) - now) / 8 : null;
  const makespan = woEnds.length ? Math.max(...woEnds) : null;

  // Queue wait, Welding vs CNC side by side (independent of which Work Center is the Drum):
  // wait before a step = its start - end of the previous step of the same PD (Welding also counts child PDs)
  const waitStats = (machineSet, withChildren) => {
    const list = [];
    byWo.forEach(steps => {
      steps.forEach((j, i) => {
        if (machineSet.has(j.machine) && i > 0) list.push(Math.max(0, j.startHour - end(steps[i - 1])));
      });
    });
    if (withChildren) {
      const seenPairs = new Set();
      (state.assemblyLinks || []).forEach(l => {
        const p = String(l.to).split('-')[0];
        const c = String(l.from).split('-')[0];
        const key = c + '>' + p;
        if (seenPairs.has(key)) return;
        seenPairs.add(key);
        const parent = byWo.get(p);
        const child = byWo.get(c);
        if (!parent || !child) return;
        const step = parent.find(j => machineSet.has(j.machine));
        if (!step) return;
        const w = step.startHour - Math.max(...child.map(end));
        if (w >= 0) list.push(w);
      });
    }
    const total = list.reduce((a, b) => a + b, 0);
    return { n: list.length, avg: list.length ? total / list.length : null, total, max: list.length ? Math.max(...list) : null };
  };
  const weldWait = waitStats(new Set(AMW_WELD_DRUM_WCS), true);
  const cncWait = waitStats(new Set(AMW_WELD_CNC_WCS), false);

  // Changeovers: consecutive jobs on the same Drum/CNC Work Center that are a different item (Setup proxy)
  let changeovers = 0;
  const byMachine = new Map();
  jobs.forEach(j => {
    if (!roles.drum.has(j.machine) && !roles.cnc.has(j.machine)) return;
    if (!byMachine.has(j.machine)) byMachine.set(j.machine, []);
    byMachine.get(j.machine).push(j);
  });
  byMachine.forEach(list => {
    list.sort((a, b) => a.startHour - b.startHour);
    for (let i = 1; i < list.length; i++) {
      if (getItemKey(list[i]) !== getItemKey(list[i - 1])) changeovers++;
    }
  });

  // Buffer Zones (TOC): 3 buffers, zone by remaining time / fill vs buffer size (>2/3 green, 1/3-2/3 yellow, <1/3 red)
  const HORIZON = 40; // 5 working days of 8 h
  const CNC_BUFFER_DAYS = 1.5;
  const isDone = j => j.status === 'Completed' || j.opStatus === 'Completed';
  const allByWo = new Map();
  (state.scheduledJobs || []).forEach(j => {
    if (!j.woId) return;
    if (!allByWo.has(j.woId)) allByWo.set(j.woId, []);
    allByWo.get(j.woId).push(j);
  });
  allByWo.forEach(list => list.sort((a, b) => a.stepNum - b.stepNum));
  const zoneOf = r => (r > 2 / 3 ? 'g' : r > 1 / 3 ? 'y' : 'r');
  const childrenOfWo = new Map();
  (state.assemblyLinks || []).forEach(l => {
    const p = String(l.to).split('-')[0];
    const c = String(l.from).split('-')[0];
    if (!childrenOfWo.has(p)) childrenOfWo.set(p, new Set());
    childrenOfWo.get(p).add(c);
  });
  const openOf = wo => (allByWo.get(wo) || []).filter(j => !isDone(j) && Number.isFinite(j.startHour));
  const leftTxt = h => (h <= 0 ? `เลยกำหนดเริ่ม ${Math.abs(h).toFixed(0)} ชม.` : `เริ่มอีก ${h.toFixed(0)} ชม.`);
  const lbl = j => `${j.woId} step ${j.stepNum} ${state.workCenters[j.machine]?.name || j.machine}`;
  const zoneJob = (start, unfinished, lead) => {
    const buf = Math.max(8, lead * AMW_CONSTRAINT_BUFFER_RATIO);
    return { zone: zoneOf((start - now) / buf), left: start - now };
  };

  // 1) Buffer in front of the Drum: next Drum jobs and whether their feeders (previous step, child PDs) are ready
  const drumBuf = { g: 0, y: 0, r: 0, red: [] };
  jobs.forEach(j => {
    if (!roles.drum.has(j.machine) || j.startHour > now + HORIZON) return;
    const steps = allByWo.get(j.woId) || [];
    const feeders = steps.filter(s => s.stepNum < j.stepNum && !isDone(s) && Number.isFinite(s.startHour));
    if (steps.find(s => roles.drum.has(s.machine) && !isDone(s)) === j) {
      (childrenOfWo.get(j.woId) || []).forEach(c => openOf(c).forEach(f => feeders.push(f)));
    }
    if (!feeders.length) { drumBuf.g++; return; }
    const lead = j.startHour - Math.min(...feeders.map(f => f.startHour));
    const z = zoneJob(j.startHour, feeders, lead);
    drumBuf[z.zone]++;
    if (z.zone === 'r') drumBuf.red.push({ text: `${lbl(j)} (${leftTxt(z.left)}, รอ ${feeders.length} งานต้นน้ำ)`, left: z.left });
  });
  drumBuf.red.sort((a, b) => a.left - b.left);

  // 2) Buffer in front of CNC: hours of CNC work that already left the Drum (ready to run) vs target of N CNC working days
  let cncReady = 0, cncReadyJobs = 0, cncTarget = 0;
  roles.cnc.forEach(c => {
    const wc = state.workCenters[c];
    if (wc) cncTarget += (Math.max(1, parseInt(wc.capacity, 10) || 1)) * (parseFloat(wc.workHoursPerDay) || 8) * CNC_BUFFER_DAYS;
  });
  byWo.forEach(list => {
    list.forEach((j, i) => {
      if (!roles.cnc.has(j.machine) || i === 0) return;
      const prev = list[i - 1];
      if (roles.drum.has(prev.machine) && end(prev) <= now) { cncReady += j.estHours; cncReadyJobs++; }
    });
  });
  const cncBuf = { days: CNC_BUFFER_DAYS, hours: cncReady, target: cncTarget, jobs: cncReadyJobs, zone: cncTarget > 0 ? zoneOf(cncReady / cncTarget) : null };

  // 3) Buffer in front of Assembly: parent PDs that start soon while child PDs are still not finished
  const asmBuf = { g: 0, y: 0, r: 0, red: [] };
  childrenOfWo.forEach((kids, p) => {
    const own = openOf(p);
    if (!own.length) return;
    const need = Math.min(...own.map(j => j.startHour));
    if (need > now + HORIZON) return;
    const open = [];
    kids.forEach(c => openOf(c).forEach(j => open.push(j)));
    if (!open.length) { asmBuf.g++; return; }
    const lead = need - Math.min(...open.map(j => j.startHour));
    const z = zoneJob(need, open, lead);
    asmBuf[z.zone]++;
    if (z.zone === 'r') asmBuf.red.push({ text: `${p} (${leftTxt(z.left)}, PD ลูกค้าง ${new Set(open.map(j => j.woId)).size} ใบ)`, left: z.left });
  });
  asmBuf.red.sort((a, b) => a.left - b.left);

  return {
    drumBuf, cncBuf, asmBuf,
    weldWait,
    cncWait,
    changeovers,
    variant,
    isAmw: ['amw', 'amw-weld'].includes(state.schedulingModel),
    drumNames: Array.from(roles.drum).map(c => state.workCenters[c]?.name || c),
    perDrum,
    drumLast: byDrum.size ? drumLast : null,
    drumUtil,
    starveHours: byDrum.size ? starve : null,
    waitBeforeDrum: avg(waits),
    waitBeforeDrumCount: waits.length,
    drumToCncWait: avg(cncWaits),
    flowDays,
    makespan
  };
}

export class StrategyKpiPanel {
  constructor(state) {
    this.state = state;
    this.el = document.getElementById('strategy-kpi');
    this.timer = null;
    if (this.el) {
      state.subscribe(() => this.schedule());
      window.addEventListener('resize', () => this.fit());
      this.initTooltip();
      this.schedule();
    }
  }

  // Instant custom tooltip (native title tooltips are slow and single-style)
  initTooltip() {
    const tip = document.createElement('div');
    tip.className = 'kpi-tooltip';
    document.body.appendChild(tip);
    this.el.addEventListener('mouseover', e => {
      const card = e.target.closest('.kpi-card');
      if (!card || !card.dataset.tip) return;
      tip.textContent = card.dataset.tip;
      tip.style.display = 'block';
      const r = card.getBoundingClientRect();
      const w = tip.offsetWidth;
      tip.style.top = `${r.bottom + 6}px`;
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    });
    this.el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.render(); }, 250);
  }

  fmtDate(h) {
    if (h === null || h === undefined) return '-';
    const d = this.state.workingHourToDate(h);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  fmtNum(v, digits = 1, unit = '') {
    return v === null || v === undefined || !Number.isFinite(v) ? '-' : `${v.toFixed(digits)}${unit}`;
  }

  render() {
    if (!this.el) return;
    let k;
    try {
      k = computeStrategyKpis(this.state);
    } catch (e) {
      this.el.innerHTML = '';
      return;
    }
    const model = this.state.schedulingModel;
    const drumLabel = k.perDrum.length === 0 ? '-' : k.perDrum.length === 1 ? k.perDrum[0].name
      : `${k.perDrum[0].name} +${k.perDrum.length - 1}`;
    const drumDetail = k.perDrum.map(d => `${d.code} ${d.name}: ${d.jobs} งาน, ${d.busy.toFixed(0)} ชม., ${d.cap} lane, Util ${d.util === null ? '-' : (d.util * 100).toFixed(0) + '%'}`).join('\n');
    const zc = z => `<span class="kpi-z kpi-z-${z}">`;
    const zoneCounts = b => `${zc('g')}${b.g}</span> ${zc('y')}${b.y}</span> ${zc('r')}${b.r}</span>`;
    const redList = b => b.red.length ? '\n🔴 ' + b.red.slice(0, 10).map(x => x.text).join('\n🔴 ') + (b.red.length > 10 ? `\n... อีก ${b.red.length - 10} งาน` : '') : '';
    const cb = k.cncBuf;
    const cards = [
      { label: `Drum: ${drumLabel}`, value: this.fmtDate(k.drumLast), sub: k.drumUtil === null ? '' : `Util ${(k.drumUtil * 100).toFixed(0)}%`,
        tip: `Drum = Work Center คอขวดของแผน (TOC/DBR) Throughput ของ Drum = Throughput ทั้งโรงงาน\nตัวเลขใหญ่ (วัน/เดือน) = วันที่งานสุดท้ายของ Drum เสร็จ\nUtil = ชม.งานจริง ÷ (ชม.ตั้งแต่งานแรกถึงงานสุดท้าย × จำนวน lane) ต่ำ = Drum มีช่องว่าง/รองาน (ดู 'Drum ว่าง', 'รอก่อน Drum')\n"+N" = มีอีก N Work Center เป็น Drum ที่มีงาน\n${drumDetail}` },
      { label: 'Drum ว่าง', value: this.fmtNum(k.starveHours, 0, ' ชม.'), sub: 'Starvation',
        tip: 'ชั่วโมงที่ Drum ว่างระหว่างงาน (ไม่มีงานเลยทั้ง Work Center) ยิ่งน้อยยิ่งดี (รวมช่วงกลางคืน/วันหยุดด้วย)' },
      { label: 'รอก่อน Drum', value: this.fmtNum(k.waitBeforeDrum, 0, ' ชม.'), sub: `เฉลี่ย ${k.waitBeforeDrumCount} งาน`,
        tip: 'เวลาเฉลี่ยที่งานต้นน้ำ/PD ลูกเสร็จแล้วต้องรอก่อนเข้า Drum = WIP หน้า Drum ยิ่งน้อยยิ่งดี' },
      { label: 'รอคิว WELD | CNC', value: `${this.fmtNum(k.weldWait.avg, 0)} | ${this.fmtNum(k.cncWait.avg, 0)}`, sub: 'ชม./งาน เฉลี่ย',
        tip: `เวลาเฉลี่ยที่งานรอก่อนเข้าเครื่อง (เสร็จ step ก่อนหน้า/PD ลูกแล้วแต่ยังไม่ได้ทำ)\nWELD (เชื่อม): เฉลี่ย ${this.fmtNum(k.weldWait.avg, 1)} ชม., รวม ${this.fmtNum(k.weldWait.total, 0)} ชม., สูงสุด ${this.fmtNum(k.weldWait.max, 0)} ชม., ${k.weldWait.n} รายการ\nCNC: เฉลี่ย ${this.fmtNum(k.cncWait.avg, 1)} ชม., รวม ${this.fmtNum(k.cncWait.total, 0)} ชม., สูงสุด ${this.fmtNum(k.cncWait.max, 0)} ชม., ${k.cncWait.n} รายการ` },
      { label: 'Drum→CNC รอ', value: this.fmtNum(k.drumToCncWait, 0, ' ชม.'), sub: 'เฉลี่ย',
        tip: 'เวลาเฉลี่ยที่ชิ้นงานออกจาก Drum แล้วรอขึ้น CNC ตัวถัดไป ยิ่งน้อยยิ่งดี' },
      { label: 'Flow (median)', value: this.fmtNum(k.flowDays, 1, ' วัน'), sub: 'ต่อ PD',
        tip: 'ค่ากลาง (median) ของเวลาจากวันนี้ถึง PD เสร็จ (วันทำงาน 8 ชม.) ยิ่งน้อยยิ่งดี' },
      { label: 'จบแผน', value: this.fmtDate(k.makespan), sub: 'Makespan',
        tip: 'วันที่งานสุดท้ายในแผนเสร็จ' },
      { label: 'เปลี่ยนงาน', value: String(k.changeovers), sub: 'Setup (ครั้ง)',
        tip: 'จำนวนครั้งที่งานติดกันบนเครื่อง Drum/CNC เดียวกันเป็นคนละชิ้นงาน (ตัวแทน Setup) ยิ่งน้อยยิ่งดี' },
      { label: 'Buffer หน้า Drum', value: zoneCounts(k.drumBuf), sub: 'เขียว/เหลือง/แดง (งาน)',
        tip: `งานของ Drum ใน 5 วันทำงานข้างหน้า ต้นน้ำ/PD ลูกพร้อมหรือยัง\nเขียว = ต้นน้ำเสร็จแล้ว หรือเหลือเวลา >2/3 ของ buffer\nเหลือง = 1/3-2/3 | แดง = <1/3 หรือเลยเวลา (Drum เสี่ยงรองาน)\nBuffer = max(8 ชม., ½ × lead time ต้นน้ำ→Drum)${redList(k.drumBuf)}` },
      { label: 'Buffer หน้า CNC', value: cb.zone ? `${zc(cb.zone)}${cb.hours.toFixed(0)}/${cb.target.toFixed(0)}</span>` : '-', sub: 'ชม. พร้อมขึ้น/เป้า',
        tip: `ชม.งาน CNC ที่ออกจาก Drum แล้วรอขึ้นเครื่อง (${cb.jobs} งาน) เทียบเป้า ${cb.days} วันทำงานของ CNC ทุกเครื่อง\nเขียว >2/3 ของเป้า | เหลือง 1/3-2/3 | แดง <1/3 (CNC เสี่ยงรองาน)` },
      { label: 'Buffer หน้า Assembly', value: zoneCounts(k.asmBuf), sub: 'เขียว/เหลือง/แดง (PD)',
        tip: `PD แม่ที่เริ่มใน 5 วันทำงานข้างหน้า PD ลูกเสร็จพร้อมหรือยัง\nเขียว = PD ลูกครบ หรือเหลือเวลา >2/3 | เหลือง 1/3-2/3 | แดง <1/3 หรือเลยเวลา${redList(k.asmBuf)}` }
    ];
 // Drum-based cards (0,1,2,4) only make sense for the AMW models
    const drumOnly = new Set([0, 1, 2, 4, 8, 9, 10]);
    const shown = cards.map((c, i) => ({ c, i })).filter(x => k.isAmw || !drumOnly.has(x.i));
    this.el.innerHTML = shown.map(({ c, i }) => `
      <div class="kpi-card" data-prio="${[0, 3, 1, 2, 5, 4, 6, 7, 1.5, 2.5, 4.5][i]}" data-tip="${c.tip.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value">${c.value}</div>
        <div class="kpi-sub">${c.sub}</div>
      </div>`).join('');
    this.fit();
  }

  // Show as many cards as fit next to the header controls (lowest priority card is hidden first)
  fit() {
    const box = this.el && this.el.parentElement;
    if (!box) return;
    const cards = Array.from(this.el.children);
    cards.forEach(c => { c.style.display = ''; });
    const byPrio = cards.slice().sort((a, b) => Number(b.dataset.prio) - Number(a.dataset.prio));
    let guard = cards.length;
    while (guard-- > 0 && this.el.scrollWidth > box.clientWidth + 1) {
      const next = byPrio.shift();
      if (!next) break;
      next.style.display = 'none';
    }
    if (this.el.scrollWidth > box.clientWidth + 1) this.el.style.visibility = 'hidden';
    else this.el.style.visibility = '';
  }
}

if (typeof window !== 'undefined') window.computeStrategyKpis = computeStrategyKpis; // for console checks
