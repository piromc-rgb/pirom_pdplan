// Machine Continuity Analysis - finds idle gaps in a work center's schedule
// and, for each gap, identifies the PD/step that made the machine wait (its
// own prior routing step, on a different machine, still had to finish first).
const FEATURED_MACHINE_KEYWORDS = ['TL2 2', 'ST30', 'VF7', 'VF4', 'TM3', 'HDT1870'];

export class ContinuityAnalysisController {
  constructor(state) {
    this.state = state;
    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.modal = document.getElementById('continuity-analysis-modal');
    this.btnOpen = document.getElementById('btn-continuity-analysis');
    this.btnClose = document.getElementById('btn-close-continuity-analysis');
    this.machineSelect = document.getElementById('continuity-machine-select');
    this.summaryEl = document.getElementById('continuity-summary');
    this.resultsEl = document.getElementById('continuity-results');
  }

  bindEvents() {
    if (this.btnOpen) {
      this.btnOpen.addEventListener('click', () => this.open());
    }
    if (this.btnClose) {
      this.btnClose.addEventListener('click', () => this.close());
    }
    if (this.machineSelect) {
      this.machineSelect.addEventListener('change', () => this.render());
    }
  }

  open() {
    if (!this.modal) return;
    this.populateMachineOptions();
    this.modal.classList.remove('hidden');
    this.render();
  }

  close() {
    if (this.modal) this.modal.classList.add('hidden');
  }

  populateMachineOptions() {
    if (!this.machineSelect) return;
    const workCenters = this.state.workCenters || {};
    const order = this.state.workCenterOrder && this.state.workCenterOrder.length > 0
      ? this.state.workCenterOrder
      : Object.keys(workCenters);

    const featured = [];
    const others = [];
    order.forEach(code => {
      const name = workCenters[code]?.name || code;
      const isFeatured = FEATURED_MACHINE_KEYWORDS.some(k => name.includes(k));
      (isFeatured ? featured : others).push({ code, name });
    });

    const previousValue = this.machineSelect.value;
    const optionHtml = (list) => list.map(m => `<option value="${m.code}">${m.code} - ${m.name}</option>`).join('');

    this.machineSelect.innerHTML = `
      ${featured.length > 0 ? `<optgroup label="สถานีงานที่เน้น">${optionHtml(featured)}</optgroup>` : ''}
      <optgroup label="สถานีงานอื่นๆ">${optionHtml(others)}</optgroup>
    `;

    if (previousValue && Array.from(this.machineSelect.options).some(o => o.value === previousValue)) {
      this.machineSelect.value = previousValue;
    } else if (featured.length > 0) {
      this.machineSelect.value = featured[0].code;
    }
  }

  // Walks a machine's schedule in order and, for every idle gap over the
  // threshold, finds the job right after it and traces that job's own
  // immediately-prior routing step (same WO, next lower stepNum) - that
  // step's machine and finish time is the reason the gap happened.
  analyzeContinuity(machineCode, gapThresholdHours = 1.0) {
    const allJobs = this.state.scheduledJobs;
    const jobs = allJobs
      .filter(j => j.machine === machineCode && j.status !== 'Completed')
      .sort((a, b) => a.startHour - b.startHour);

    if (jobs.length === 0) {
      return { totalJobs: 0, totalGapHours: 0, gaps: [], firstStart: null, lastEnd: null };
    }

    const gaps = [];
    let prevEnd = null;
    jobs.forEach(job => {
      const start = job.startHour;
      const end = start + job.estHours;
      if (prevEnd !== null && start - prevEnd >= gapThresholdHours) {
        const priorSteps = allJobs
          .filter(j => j.woId === job.woId && j.stepNum < job.stepNum && j.status !== 'Completed')
          .sort((a, b) => b.stepNum - a.stepNum);
        const causeStep = priorSteps[0] || null;

        gaps.push({
          gapStart: prevEnd,
          gapEnd: start,
          gapHours: start - prevEnd,
          blockedJob: job,
          causeStep
        });
      }
      prevEnd = prevEnd === null ? end : Math.max(prevEnd, end);
    });

    const totalGapHours = gaps.reduce((sum, g) => sum + g.gapHours, 0);
    return { totalJobs: jobs.length, totalGapHours, gaps, firstStart: jobs[0].startHour, lastEnd: prevEnd };
  }

  formatDateTime(hour) {
    const d = this.state.workingHourToDate(hour);
    return d.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  render() {
    if (!this.machineSelect || !this.resultsEl || !this.summaryEl) return;
    const machineCode = this.machineSelect.value;
    if (!machineCode) return;

    const machineName = this.state.workCenters[machineCode]?.name || machineCode;
    const analysis = this.analyzeContinuity(machineCode);

    if (analysis.totalJobs === 0) {
      this.summaryEl.innerHTML = `<strong>${machineCode} - ${machineName}</strong>: ไม่มีงานค้างอยู่ในแผน`;
      this.resultsEl.innerHTML = '';
      return;
    }

    const rangeStr = `${this.formatDateTime(analysis.firstStart)} → ${this.formatDateTime(analysis.lastEnd)}`;
    this.summaryEl.innerHTML = `
      <strong>${machineCode} - ${machineName}</strong> · ${analysis.totalJobs} งาน · ช่วงเวลาแผนงาน: ${rangeStr}<br>
      <span style="color: ${analysis.gaps.length > 0 ? 'var(--accent-orange)' : 'var(--accent-green, #16a34a)'};">
        ${analysis.gaps.length > 0
          ? `พบ ${analysis.gaps.length} ช่วงว่าง รวม ${analysis.totalGapHours.toFixed(1)} ชั่วโมง`
          : '✓ ไม่มีช่วงว่าง - เครื่องทำงานต่อเนื่องเต็มที่'}
      </span>
    `;

    if (analysis.gaps.length === 0) {
      this.resultsEl.innerHTML = '';
      return;
    }

    this.resultsEl.innerHTML = analysis.gaps
      .sort((a, b) => b.gapHours - a.gapHours)
      .map(g => {
        const pdLink = (woId) => `<strong class="continuity-pd-link" data-wo-id="${woId}" title="ดับเบิลคลิกเพื่อเปิดรายละเอียด ${woId}" style="cursor: pointer; text-decoration: underline dotted;">${woId}</strong>`;
        const causeHtml = g.causeStep
          ? `<span style="color: var(--accent-cyan);">${pdLink(g.causeStep.woId)}</span> ที่ <strong>${g.causeStep.machine} - ${this.state.workCenters[g.causeStep.machine]?.name || ''}</strong> (เสร็จ ${this.formatDateTime(g.causeStep.startHour + g.causeStep.estHours)})`
          : `<span style="color: var(--text-secondary);">ไม่พบ step ก่อนหน้า (อาจรอคิวเครื่องจักรเฉยๆ)</span>`;

        return `
          <div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-left: 3px solid var(--accent-orange); border-radius: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 11.5px; color: var(--text-primary);">ว่าง <strong style="color: var(--accent-orange);">${g.gapHours.toFixed(1)} ชม.</strong> (${this.formatDateTime(g.gapStart)} → ${this.formatDateTime(g.gapEnd)})</span>
              <span style="font-size: 10px; color: var(--text-secondary);">รอ <span style="color: var(--accent-teal);">${pdLink(g.blockedJob.woId)}</span> [${g.blockedJob.stepNum}]</span>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary);">สาเหตุ: ${causeHtml}</div>
          </div>
        `;
      })
      .join('');

    this.resultsEl.querySelectorAll('.continuity-pd-link').forEach(el => {
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const woId = el.getAttribute('data-wo-id');
        this.close();
        window.dispatchEvent(new CustomEvent('open-pd-modal', { detail: { woId } }));
      });
    });
  }
}
