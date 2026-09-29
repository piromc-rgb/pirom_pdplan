// Mat. issue report: raw materials still waiting to be issued from the warehouse
// (warehouse has no stock yet / ready to issue / partly issued) and the PDs that need them,
// ordered by when the production plan needs them.

const WAITING_LABELS = ['คลังยังไม่มีของให้เบิก', 'ของมาพร้อมเบิก', 'เบิกบางส่วน'];
const TONE_STYLES = {
  warn: 'border:1px solid #d97706;color:#b45309;background:rgba(245,158,11,0.15);',
  info: 'border:1px solid #0284c7;color:#0369a1;background:rgba(2,132,199,0.15);'
};

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class MatIssueReportController {
  constructor(state) {
    this.state = state;
    this.limit = 30;
    this.report = null;
    this.btn = typeof document !== 'undefined' ? document.getElementById('btn-mat-issue-report') : null;
    if (this.btn) this.btn.addEventListener('click', () => this.open());
  }

  async open() {
    this.showModal('<div style="padding:30px;text-align:center;color:#64748b;">กำลังโหลดข้อมูล Mat....</div>');
    const noMats = !this.state.planMaterials || Object.keys(this.state.planMaterials).length === 0;
    if (noMats && this.state.storageSync?.fetchPlanMaterials) {
      try { await this.state.storageSync.fetchPlanMaterials(); } catch (e) { /* report below explains empty data */ }
    }
    this.report = this.buildReport();
    this.render();
  }

  buildReport() {
    const state = this.state;
    const jobs = (state.scheduledJobs || []).filter(j => j.status !== 'Completed' && !j.erpCompleted);
    const stepStart = new Map();
    const pdStart = new Map();
    const pdInfo = new Map();
    for (const j of jobs) {
      const pdId = j.woId || j.id;
      if (typeof j.startHour !== 'number' || isNaN(j.startHour)) continue;
      const key = `${pdId}|${j.stepNum}`;
      if (!stepStart.has(key) || j.startHour < stepStart.get(key)) stepStart.set(key, j.startHour);
      if (!pdStart.has(pdId) || j.startHour < pdStart.get(pdId)) pdStart.set(pdId, j.startHour);
      if (!pdInfo.has(pdId)) pdInfo.set(pdId, { partName: j.partName || '', customer: j.customer || '' });
    }
    const activePds = new Set(jobs.map(j => j.woId || j.id));

    const byMat = new Map();
    let skippedNoWarehouse = 0;
    for (const [pdId, rows] of Object.entries(state.planMaterials || {})) {
      if (!activePds.has(pdId) || !Array.isArray(rows)) continue;
      const raw = rows.filter(r => String(r.mat || '').trim().length === 10);
      const mats = new Map();
      raw.forEach(r => { (mats.get(r.mat) || mats.set(r.mat, []).get(r.mat)).push(r); });
      for (const [mat, matRows] of mats) {
        const hasWh = matRows.some(r => r.toIssueWh !== undefined);
        const agg = {
          actualQty: Math.max(...matRows.map(r => Number(r.actualQty) || 0)),
          toIssue: Math.max(...matRows.map(r => Number(r.toIssue) || 0)),
          toIssueWh: hasWh ? Math.max(...matRows.map(r => Number(r.toIssueWh) || 0)) : undefined
        };
        if (state.isOldMaterialUsed(matRows.map(r => ({ ...r, actualQty: agg.actualQty, toIssue: agg.toIssue })))) continue;
        const status = state.getMaterialIssueStatus(agg);
        if (!status) { skippedNoWarehouse++; continue; }
        if (!WAITING_LABELS.includes(status.label)) continue;

        const firstStep = Math.min(...matRows.map(r => Number(r.stepNum) || 0));
        const hour = stepStart.has(`${pdId}|${firstStep}`) ? stepStart.get(`${pdId}|${firstStep}`) : (pdStart.has(pdId) ? pdStart.get(pdId) : Infinity);
        let entry = byMat.get(mat);
        if (!entry) {
          entry = { mat, desc: matRows.find(r => r.matDesc)?.matDesc || '', pds: [], earliest: Infinity };
          byMat.set(mat, entry);
        }
        const qty = Math.max(...matRows.map(r => Number(r.estimatedQty) || 0), agg.toIssue);
        entry.pds.push({ pdId, status, hour, firstStep, qty, toIssue: agg.toIssue, warehouse: agg.toIssueWh, ...(pdInfo.get(pdId) || {}) });
        entry.earliest = Math.min(entry.earliest, hour);
      }
    }
    const mats = [...byMat.values()];
    mats.forEach(m => {
      m.pds.sort((a, b) => a.hour - b.hour);
      m.totalQty = m.pds.reduce((sum, p) => sum + p.qty, 0);
    });
    mats.sort((a, b) => (a.earliest === b.earliest ? a.mat.localeCompare(b.mat) : a.earliest - b.earliest));
    return { mats, skippedNoWarehouse, generatedAt: new Date() };
  }

  formatHour(hour) {
    if (!isFinite(hour)) return 'ยังไม่จัดคิว';
    const d = this.state.workingHourToDate(hour);
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  render() {
    const report = this.report;
    const shown = this.limit === 0 ? report.mats : report.mats.slice(0, this.limit);
    const pdSet = new Set();
    let noStock = 0;
    let ready = 0;
    shown.forEach(m => m.pds.forEach(p => {
      pdSet.add(p.pdId);
      if (p.status.label === 'คลังยังไม่มีของให้เบิก') noStock++;
      else if (p.status.label === 'ของมาพร้อมเบิก') ready++;
    }));

    const chip = (label, value, color) => `<div style="flex:1;min-width:120px;padding:6px 10px;border-radius:6px;background:#f8fafc;border-left:3px solid ${color};"><div style="font-size:10.5px;color:#64748b;">${label}</div><div style="font-size:16px;font-weight:800;color:#0f172a;">${value}</div></div>`;
    const fmtQty = (v) => Number(Number(v || 0).toFixed(2)).toLocaleString('en-US');
    const statusBadge = (st) => `<span style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:4px;${TONE_STYLES[st.tone] || TONE_STYLES.info}">${escapeHtml(st.label)}</span>`;
    // Repeated text (Mat., total, and the status when identical) is merged into one cell spanning the Mat.'s PD rows
    // PD needing a Mat. within the next 7 days (or overdue) that the warehouse cannot issue yet -> red
    const urgentLimit = Date.now() + 7 * 24 * 3600 * 1000;
    const isUrgent = (p) => p.status.label === 'คลังยังไม่มีของให้เบิก' && isFinite(p.hour) && this.state.workingHourToDate(p.hour).getTime() <= urgentLimit;
    const rowsHtml = shown.map((m) => {
      const n = m.pds.length;
      const sameStatus = m.pds.every(p => p.status.label === m.pds[0].status.label);
      return m.pds.map((p, idx) => {
        const first = idx === 0;
        return `<tr class="${first ? 'mat-first-row' : ''}">
        ${first ? `<td class="mat-cell" rowspan="${n}" title="${escapeHtml(m.mat)} ${escapeHtml(m.desc)}"><strong>${escapeHtml(m.mat)}</strong> <span style="color:#475569;">${escapeHtml(m.desc)}</span></td>` : ''}
        ${sameStatus ? (first ? `<td rowspan="${n}">${statusBadge(p.status)}</td>` : '') : `<td>${statusBadge(p.status)}</td>`}
        ${first ? `<td rowspan="${n}" style="text-align:right;">${fmtQty(m.totalQty)}</td>` : ''}
        <td title="${escapeHtml(p.partName)} (ดับเบิลคลิกเพื่อดูรายละเอียด PD)"><strong class="mat-report-pd" data-pd="${escapeHtml(p.pdId)}" style="cursor:pointer;user-select:none;color:${isUrgent(p) ? '#dc2626' : '#2563eb'};">${escapeHtml(p.pdId)}</strong></td>
        <td style="text-align:right;">${fmtQty(p.qty)}</td>
        <td>${escapeHtml(this.formatHour(p.hour))}</td>
      </tr>`;
      }).join('');
    }).join('');

    const limitOptions = [[30, '30 รายการแรก'], [50, '50 รายการ'], [100, '100 รายการ'], [0, 'ทั้งหมด']]
      .map(([v, t]) => `<option value="${v}" ${v === this.limit ? 'selected' : ''}>${t}</option>`).join('');
    const warning = report.skippedNoWarehouse > 0
      ? `<div style="margin:8px 0;padding:6px 10px;border-radius:6px;background:#fef3c7;color:#92400e;font-size:11px;">มี Mat. ${report.skippedNoWarehouse} รายการที่ยังไม่มีข้อมูล "To Issue by Warehouse" (แคชเก่า) — เปิดโหมด EDIT เพื่อดึงไฟล์ Status Overview ใหม่ก่อน</div>` : '';

    this.showModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-size:15px;font-weight:700;">ตรวจสอบ Mat รอเบิก</div>
        <button type="button" id="btn-close-mat-report" style="border:none;background:transparent;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div style="color:#64748b;margin:2px 0 10px;font-size:11.5px;">เรียงตามวันที่แผนผลิตต้องใช้ (เร็วสุดก่อน) · ไม่รวม Mat. ที่ "ใช้วัสดุเก่า" และที่เบิกแล้ว · สร้างเมื่อ ${escapeHtml(report.generatedAt.toLocaleString('th-TH'))}</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="font-weight:600;">แสดง</label>
        <select id="select-mat-report-limit" style="padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;">${limitOptions}</select>
        <span style="color:#64748b;">จากทั้งหมด ${report.mats.length} รายการ Mat. ที่รอเบิก</span>
        <button type="button" id="btn-export-mat-report" style="margin-left:auto;padding:5px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">Export CSV</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">
        ${chip('Mat. ที่แสดง', shown.length, '#2563eb')}
        ${chip('PD ที่เกี่ยวข้อง', pdSet.size, '#7c3aed')}
        ${chip('คลังยังไม่มีของให้เบิก (PD-Mat)', noStock, '#d97706')}
        ${chip('ของมาพร้อมเบิก (PD-Mat)', ready, '#0284c7')}
      </div>
      ${warning}
      ${shown.length === 0 ? '<div style="padding:24px;text-align:center;color:#64748b;">ไม่มี Mat. ที่รอเบิก</div>' : `
      <div style="overflow:auto;max-height:52vh;border:1px solid rgba(0,0,0,0.08);border-radius:6px;">
        <table class="mat-report-table"><thead><tr><th>Mat.</th><th>สถานะ</th><th style="text-align:right;">จำนวนรวมที่ใช้</th><th>PD ที่ใช้</th><th style="text-align:right;">จำนวน</th><th>วันที่ต้องการ</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      </div>`}
    `);

    const overlay = document.getElementById('mat-issue-report-modal');
    overlay.querySelector('#btn-close-mat-report')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#select-mat-report-limit')?.addEventListener('change', (e) => {
      this.limit = Number(e.target.value);
      this.render();
    });
    overlay.querySelector('#btn-export-mat-report')?.addEventListener('click', () => this.exportCsv(shown));
    // Double-click a PD number to open its PD detail modal on top of this report
    overlay.querySelectorAll('.mat-report-pd').forEach(el => el.addEventListener('dblclick', () => {
      const pdModal = document.getElementById('pd-plan-modal');
      if (pdModal) pdModal.style.zIndex = '100001';
      window.dispatchEvent(new CustomEvent('open-pd-modal', { detail: { woId: el.dataset.pd } }));
    }));
  }

  showModal(innerHtml) {
    let overlay = document.getElementById('mat-issue-report-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mat-issue-report-modal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <style>
        #mat-issue-report-modal .mat-report-table{width:100%;border-collapse:collapse;font-size:12px;}
        #mat-issue-report-modal .mat-report-table th{position:sticky;top:0;background:#f1f5f9;text-align:left;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,0.12);}
        #mat-issue-report-modal .mat-report-table td{vertical-align:middle;padding:5px 8px;border-bottom:1px solid rgba(0,0,0,0.06);white-space:nowrap;}
        #mat-issue-report-modal .mat-report-table th{white-space:nowrap;}
        #mat-issue-report-modal .mat-report-table td[rowspan]{vertical-align:top;}
        #mat-issue-report-modal .mat-report-table td.mat-cell{max-width:330px;overflow:hidden;text-overflow:ellipsis;}
        #mat-issue-report-modal .mat-report-table tr.mat-first-row td{border-top:2px solid rgba(0,0,0,0.14);}
      </style>
      <div style="background:#fff;color:#0f172a;border-radius:10px;max-width:1000px;width:100%;max-height:90vh;overflow:auto;padding:16px 18px;box-shadow:0 20px 50px rgba(0,0,0,0.3);font-size:12.5px;">${innerHtml}</div>`;
  }

  exportCsv(mats) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Mat.', 'รายละเอียด', 'สถานะ', 'จำนวนรวมที่ใช้', 'PD ที่ใช้', 'ชื่องาน', 'จำนวน', 'วันที่ต้องการ', 'Op แรกที่ใช้', 'ค้างเบิก', 'คลังพร้อมจ่าย'].map(q).join(',')];
    mats.forEach(m => m.pds.forEach(p => {
      lines.push([m.mat, m.desc, p.status.label, m.totalQty, p.pdId, p.partName, p.qty, this.formatHour(p.hour), p.firstStep, p.toIssue, p.warehouse ?? ''].map(q).join(','));
    }));
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Mat_รอเบิก_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
