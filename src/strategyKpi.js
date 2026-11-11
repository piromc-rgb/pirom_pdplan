import { getAmwRoles, getItemKey, AMW_WELD_DRUM_WCS, AMW_WELD_CNC_WCS } from './scheduler.js';

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
  const flowDays = woEnds.length ? Math.max(0, avg(woEnds) - now) / 8 : null;
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

  // Changeovers: consecutive jobs on the same Work Center that are a different item (Setup proxy)
  let changeovers = 0;
  const byMachine = new Map();
  jobs.forEach(j => {
    if (!byMachine.has(j.machine)) byMachine.set(j.machine, []);
    byMachine.get(j.machine).push(j);
  });
  byMachine.forEach(list => {
    list.sort((a, b) => a.startHour - b.startHour);
    for (let i = 1; i < list.length; i++) {
      if (getItemKey(list[i]) !== getItemKey(list[i - 1])) changeovers++;
    }
  });

  return {
    weldWait,
    cncWait,
    changeovers,
    variant,
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
      this.schedule();
    }
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
    const utilPct = k.drumUtil === null ? null : k.drumUtil * 100;
    const cards = [
      { label: 'Utilization', value: utilPct === null ? '-' : `${utilPct.toFixed(0)}%`, sub: 'Drum', big: true,
        cls: utilPct === null ? '' : utilPct >= 90 ? 'kpi-util-good' : 'kpi-util-bad', prio: -1,
        tip: `% การใช้งาน Drum (เขียว = 90% ขึ้นไป, แดง = ต่ำกว่า 90%)
${drumDetail}` },
      { label: `Drum: ${drumLabel}`, value: this.fmtDate(k.drumLast), sub: 'ชิ้นสุดท้ายเสร็จ',
        tip: `วันที่ Drum ทำงานชิ้นสุดท้ายเสร็จ และ % การใช้งาน. Throughput ของ Drum = Throughput ทั้งโรงงาน\n${drumDetail}` },
      { label: 'Drum ว่าง', value: this.fmtNum(k.starveHours, 0, ' ชม.'), sub: 'Starvation',
        tip: 'ชั่วโมงที่ Drum ว่างระหว่างงาน (ไม่มีงานเลยทั้ง Work Center) ยิ่งน้อยยิ่งดี (รวมช่วงกลางคืน/วันหยุดด้วย)' },
      { label: 'รอก่อน Drum', value: this.fmtNum(k.waitBeforeDrum, 0, ' ชม.'), sub: `เฉลี่ย ${k.waitBeforeDrumCount} งาน`,
        tip: 'เวลาเฉลี่ยที่งานต้นน้ำ/PD ลูกเสร็จแล้วต้องรอก่อนเข้า Drum = WIP หน้า Drum ยิ่งน้อยยิ่งดี' },
      { label: 'รอคิว WELD | CNC', value: `${this.fmtNum(k.weldWait.avg, 0)} | ${this.fmtNum(k.cncWait.avg, 0)}`, sub: 'ชม./งาน เฉลี่ย',
        tip: `เวลาเฉลี่ยที่งานรอก่อนเข้าเครื่อง (เสร็จ step ก่อนหน้า/PD ลูกแล้วแต่ยังไม่ได้ทำ)\nWELD (เชื่อม): เฉลี่ย ${this.fmtNum(k.weldWait.avg, 1)} ชม., รวม ${this.fmtNum(k.weldWait.total, 0)} ชม., สูงสุด ${this.fmtNum(k.weldWait.max, 0)} ชม., ${k.weldWait.n} รายการ\nCNC: เฉลี่ย ${this.fmtNum(k.cncWait.avg, 1)} ชม., รวม ${this.fmtNum(k.cncWait.total, 0)} ชม., สูงสุด ${this.fmtNum(k.cncWait.max, 0)} ชม., ${k.cncWait.n} รายการ` },
      { label: 'Drum→CNC รอ', value: this.fmtNum(k.drumToCncWait, 0, ' ชม.'), sub: 'เฉลี่ย',
        tip: 'เวลาเฉลี่ยที่ชิ้นงานออกจาก Drum แล้วรอขึ้น CNC ตัวถัดไป ยิ่งน้อยยิ่งดี' },
      { label: 'Flow เฉลี่ย', value: this.fmtNum(k.flowDays, 1, ' วัน'), sub: 'ต่อ PD',
        tip: 'เวลาเฉลี่ยจากวันนี้ถึง PD เสร็จ (วันทำงาน 8 ชม.) ยิ่งน้อยยิ่งดี' },
      { label: 'จบแผน', value: this.fmtDate(k.makespan), sub: 'Makespan',
        tip: 'วันที่งานสุดท้ายในแผนเสร็จ' },
      { label: 'เปลี่ยนงาน', value: String(k.changeovers), sub: 'Setup (ครั้ง)',
        tip: 'จำนวนครั้งที่งานติดกันบนเครื่องเดียวกันเป็นคนละชิ้นงาน (ตัวแทน Setup รวม) ยิ่งน้อยยิ่งดี' }
    ];
    this.el.title = `Model: ${model} | Drum: ${k.drumNames.join(', ')}`;
    const prios = [0, 3, 1, 2, 5, 4, 6, 7];
    let n = 0;
    this.el.innerHTML = cards.map(c => `
      <div class="kpi-card${c.big ? ' kpi-util' : ''}" data-prio="${c.prio !== undefined ? c.prio : prios[n++]}" title="${c.tip}">
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value ${c.cls || ''}">${c.value}</div>
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
