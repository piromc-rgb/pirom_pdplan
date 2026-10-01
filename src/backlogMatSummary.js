// Backlog Mat. requirement summary: lists the Op01 raw materials each Backlog Production Order
// needs, one row per PD-Mat pair, so planners can see material demand before a PD is even scheduled.

const TONE_STYLES = {
  warn: 'border:1px solid #d97706;color:#b45309;background:rgba(245,158,11,0.15);',
  info: 'border:1px solid #0284c7;color:#0369a1;background:rgba(2,132,199,0.15);',
  ok: 'border:1px solid #16a34a;color:#15803d;background:rgba(22,163,74,0.15);',
  old: 'border:1px solid #7c3aed;color:#5b21b6;background:rgba(124,58,237,0.12);',
  notready: 'border:1.5px solid #b91c1c;color:#7f1d1d;background:rgba(185,28,28,0.12);',
  ready: 'border:1.5px solid #15803d;color:#14532d;background:rgba(21,128,61,0.12);'
};

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Column definitions (header label + sort value getter) for the two views.
const PD_VIEW_COLS = [
  { key: 'pdNo', label: 'PD No.', get: r => r.pdNo },
  { key: 'dwgNo', label: 'Dwg No.', get: r => r.dwgNo },
  { key: 'partName', label: 'Part Name', get: r => r.partName },
  { key: 'mat', label: 'Mat.', get: r => r.mat },
  { key: 'desc', label: 'Mat._1', get: r => r.desc },
  { key: 'qty', label: 'QTY', right: true, get: r => Number(r.qty) || 0 },
  { key: 'status', label: 'Mat. status', get: r => r.status ? r.status.label : null },
  { key: 'alloc', label: 'วันที่ที่จะผลิต', get: r => { const t = r.allocationDate ? new Date(r.allocationDate).getTime() : NaN; return isNaN(t) ? null : t; } },
  { key: 'wh', label: 'จำนวนในคลัง', right: true, get: r => (r.warehouseQty === undefined || r.warehouseQty === null) ? null : Number(r.warehouseQty) },
  { key: 'suff', label: 'พอเบิก/ไม่พอ', get: r => (r.warehouseQty === undefined || r.warehouseQty === null) ? null : (Number(r.warehouseQty) >= Number(r.qty || 0) ? 'พอเบิก' : 'ไม่พอ') }
];
const MAT_VIEW_COLS = [
  { key: 'mat', label: 'Mat.', get: r => r.mat },
  { key: 'desc', label: 'รายละเอียด', get: r => r.desc },
  { key: 'qty', label: 'QTY รวม', right: true, get: r => r.qty },
  { key: 'inv', label: 'Inventory on Hand', right: true, get: r => r.inventory === null ? null : Number(r.inventory) },
  { key: 'suff', label: 'พอเบิก/ไม่พอ', get: r => r.sufficiency ? r.sufficiency.label : null },
  { key: 'pdCount', label: 'จำนวน PD', right: true, get: r => r.pdList.length },
  { key: 'pds', label: 'PD ที่ต้องการ', get: r => r.pdList[0] || null }
];

export class BacklogMatSummaryController {
  constructor(state) {
    this.state = state;
    this.limit = 100;
    this.viewMode = 'pd'; // 'pd' = group by PD No (current view) · 'mat' = group by Mat.
    this.report = null;
    this.sort = { pd: null, mat: null }; // per view: { key, dir: 1|-1 } · set by double-clicking a column header
    // Repurposes the former "Add Production Order" button (id kept as btn-add-pd so the
    // existing show/hide-during-Assembly-browsing wiring elsewhere keeps working unchanged).
    this.btn = typeof document !== 'undefined' ? document.getElementById('btn-add-pd') : null;
    if (this.btn) this.btn.addEventListener('click', () => this.open());
    // Auto-refresh an open popup when Allocation Date data is re-read (e.g. newer Material to issue.xlsx)
    if (typeof window !== 'undefined') {
      window.addEventListener('plan-materials-updated', () => {
        if (!document.getElementById('backlog-mat-summary-modal') || !this.report) return;
        this.report = this.buildReport();
        this.render();
      });
    }
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
    const rows = [];
    (state.workOrders || []).forEach(wo => {
      const steps = wo.steps || [];
      if (steps.length === 0) return;
      const op1StepNum = Math.min(...steps.map(s => Number(s.stepNum) || 10));
      const matList = typeof state.getStepMaterialsList === 'function' ? state.getStepMaterialsList(wo.id, op1StepNum) : [];
      matList.forEach(m => {
        rows.push({
          pdNo: wo.id,
          dwgNo: wo.dwgNo || '',
          partName: wo.partName || '',
          mat: m.mat,
          desc: m.desc || '',
          qty: m.qty,
          status: m.status || null,
          allocationDate: m.allocationDate || null,
          warehouseQty: m.warehouseQty
        });
      });
    });
    rows.sort((a, b) => a.pdNo.localeCompare(b.pdNo));
    return { rows, generatedAt: new Date() };
  }

  // Same-Mat. rows across every Backlog PD collapsed into one row per Mat.: QTY summed across
  // PDs, compared against the material's company-wide Inventory on Hand (from Material to issue.xlsx).
  buildMatGroupedRows() {
    const groups = new Map();
    this.report.rows.forEach(r => {
      let g = groups.get(r.mat);
      if (!g) {
        g = { mat: r.mat, desc: r.desc || '', qty: 0, pdSet: new Set() };
        groups.set(r.mat, g);
      }
      g.qty += Number(r.qty) || 0;
      g.pdSet.add(r.pdNo);
      if (!g.desc && r.desc) g.desc = r.desc;
    });
    const inventory = this.state.materialInventory || {};
    const rows = [...groups.values()].map(g => {
      const inv = inventory[g.mat];
      const hasInv = inv !== undefined && inv !== null;
      const sufficiency = hasInv
        ? (Number(inv) >= g.qty ? { label: 'พอเบิก', tone: 'ok' } : { label: 'ไม่พอ', tone: 'notready' })
        : null;
      return {
        mat: g.mat,
        desc: g.desc,
        qty: g.qty,
        pdList: [...g.pdSet].sort(),
        inventory: hasInv ? inv : null,
        sufficiency
      };
    });
    rows.sort((a, b) => {
      const aBad = a.sufficiency?.tone === 'notready' ? 0 : 1;
      const bBad = b.sufficiency?.tone === 'notready' ? 0 : 1;
      return aBad !== bBad ? aBad - bBad : a.mat.localeCompare(b.mat);
    });
    return rows;
  }

  render() {
    const report = this.report;
    const isMatView = this.viewMode === 'mat';
    const allRows = isMatView ? this.buildMatGroupedRows() : [...report.rows];
    const cols = isMatView ? MAT_VIEW_COLS : PD_VIEW_COLS;
    const activeSort = this.sort[this.viewMode];
    const sortCol = activeSort ? cols.find(c => c.key === activeSort.key) : null;
    if (sortCol) {
      allRows.sort((a, b) => {
        const va = sortCol.get(a), vb = sortCol.get(b);
        const aEmpty = va === null || va === undefined || va === '';
        const bEmpty = vb === null || vb === undefined || vb === '';
        if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : (aEmpty ? 1 : -1); // blanks always last
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
        return cmp * activeSort.dir;
      });
    }
    const shown = this.limit === 0 ? allRows : allRows.slice(0, this.limit);

    const chip = (label, value, color) => `<div style="flex:1;min-width:120px;padding:6px 10px;border-radius:6px;background:#f8fafc;border-left:3px solid ${color};"><div style="font-size:10.5px;color:#64748b;">${label}</div><div style="font-size:16px;font-weight:800;color:#0f172a;">${value}</div></div>`;
    const fmtQty = (v) => Number(Number(v || 0).toFixed(2)).toLocaleString('en-US');
    const statusBadge = (st) => st
      ? `<span class="${st.tone === 'notready' ? 'mat-status-blink' : ''}" style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:4px;${TONE_STYLES[st.tone] || TONE_STYLES.info}">${escapeHtml(st.label)}</span>`
      : '<span style="color:#94a3b8;">-</span>';
    const fmtAllocationDate = (v) => {
      if (!v) return '<span style="color:#94a3b8;">-</span>';
      const d = new Date(v);
      if (isNaN(d.getTime())) return escapeHtml(v);
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(v));
      return escapeHtml(d.toLocaleString('th-TH', dateOnly
        ? { day: '2-digit', month: 'short', year: '2-digit' }
        : { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }));
    };
    const sufficiencyOf = (r) => {
      if (r.warehouseQty === undefined || r.warehouseQty === null) return null;
      return Number(r.warehouseQty) >= Number(r.qty || 0) ? { label: 'พอเบิก', tone: 'ok' } : { label: 'ไม่พอ', tone: 'notready' };
    };
    const fmtNum = (v) => (v === undefined || v === null) ? '<span style="color:#94a3b8;">-</span>' : fmtQty(v);
    const pdBadge = (pd) => `<strong class="backlog-mat-pd" data-pd="${escapeHtml(pd)}" style="cursor:pointer;color:#2563eb;">${escapeHtml(pd)}</strong>`;
    const fmtPdList = (list) => {
      const maxShown = 6;
      const shownPds = list.slice(0, maxShown).map(pdBadge).join(', ');
      const rest = list.length > maxShown ? ` <span title="${escapeHtml(list.join(', '))}" style="color:#64748b;">+${list.length - maxShown} อื่นๆ</span>` : '';
      return shownPds + rest;
    };

    const rowsHtml = isMatView ? shown.map(r => `
      <tr>
        <td style="font-family:monospace;">${escapeHtml(r.mat)}</td>
        <td class="truncate" title="${escapeHtml(r.desc)}">${escapeHtml(r.desc)}</td>
        <td style="text-align:right;">${fmtQty(r.qty)}</td>
        <td style="text-align:right;">${fmtNum(r.inventory)}</td>
        <td>${statusBadge(r.sufficiency)}</td>
        <td style="text-align:right;">${r.pdList.length}</td>
        <td style="white-space:normal;">${fmtPdList(r.pdList)}</td>
      </tr>
    `).join('') : shown.map(r => `
      <tr>
        <td>${pdBadge(r.pdNo)}</td>
        <td style="font-family:monospace;">${escapeHtml(r.dwgNo)}</td>
        <td class="truncate" title="${escapeHtml(r.partName)}">${escapeHtml(r.partName)}</td>
        <td style="font-family:monospace;">${escapeHtml(r.mat)}</td>
        <td class="truncate" title="${escapeHtml(r.desc)}">${escapeHtml(r.desc)}</td>
        <td style="text-align:right;">${fmtQty(r.qty)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${fmtAllocationDate(r.allocationDate)}</td>
        <td style="text-align:right;">${fmtNum(r.warehouseQty)}</td>
        <td>${statusBadge(sufficiencyOf(r))}</td>
      </tr>
    `).join('');

    const limitOptions = [[50, '50 รายการแรก'], [100, '100 รายการ'], [200, '200 รายการ'], [0, 'ทั้งหมด']]
      .map(([v, t]) => `<option value="${v}" ${v === this.limit ? 'selected' : ''}>${t}</option>`).join('');

    const viewToggleBtn = (mode, label) => {
      const active = this.viewMode === mode;
      return `<button type="button" class="btn-backlog-mat-view" data-view="${mode}" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-weight:700;font-size:11.5px;border:1px solid ${active ? '#2563eb' : '#cbd5e1'};background:${active ? '#2563eb' : '#fff'};color:${active ? '#fff' : '#334155'};">${label}</button>`;
    };

    const pdSet = new Set(isMatView ? shown.flatMap(r => r.pdList) : shown.map(r => r.pdNo));
    const chips = isMatView
      ? `${chip('Mat. ที่แสดง', shown.length, '#2563eb')}${chip('PD ที่เกี่ยวข้อง', pdSet.size, '#7c3aed')}`
      : `${chip('รายการที่แสดง', shown.length, '#2563eb')}${chip('PD ที่เกี่ยวข้อง', pdSet.size, '#7c3aed')}`;

    const headHtml = cols.map(c => {
      const arrow = activeSort && activeSort.key === c.key ? (activeSort.dir === 1 ? ' ▲' : ' ▼') : '';
      return `<th class="backlog-mat-th" data-key="${c.key}" title="ดับเบิลคลิกเพื่อเรียงข้อมูล" style="cursor:pointer;user-select:none;${c.right ? 'text-align:right;' : ''}">${c.label}${arrow}</th>`;
    }).join('');
    const tableHtml = `<table class="backlog-mat-table"><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;

    this.showModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-size:15px;font-weight:700;">สรุปความต้องการ Mat. ของ PD ใน Backlog</div>
        <button type="button" id="btn-close-backlog-mat-summary" style="border:none;background:transparent;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div style="color:#64748b;margin:2px 0 2px;font-size:11.5px;">วัตถุดิบ Op01 ของ PD ทุกตัวที่ยังอยู่ใน Backlog (ยังไม่ถูกจัดลงแผน) · สร้างเมื่อ ${escapeHtml(report.generatedAt.toLocaleString('th-TH'))}</div>
      <div style="color:#94a3b8;margin:0 0 10px;font-size:10.5px;">จำนวนในคลัง/พอเบิก-ไม่พอ: ดึงจากไฟล์ Status Overview (.xlsx) ชีต "Plan + Mat" คอลัมน์ Mat.To Issue by Warehouse · วันที่ที่จะผลิต: ดึงจากทุก Tab ใน Google Sheet "ตรวจสอบรายการแมทและ STD ที่ใช้ผลิต" (จับคู่ Production Order + Material No.) · Inventory on Hand: ดึงจากไฟล์ Material to issue.xlsx เช่นกัน (สต๊อกรวมของบริษัท ไม่ผูกกับ PD ใดโดยเฉพาะ)</div>
      <div style="display:flex;gap:6px;margin:6px 0;">
        ${viewToggleBtn('pd', 'จัดกลุ่มตาม PD No')}
        ${viewToggleBtn('mat', 'จัดกลุ่มตาม Mat.')}
        <button type="button" id="btn-sync-backlog-mat-alloc" title="ดึงวันที่ที่จะผลิตใหม่จาก Google Sheet" style="padding:5px 12px;border:1px solid #2563eb;color:#1d4ed8;border-radius:6px;background:#eff6ff;cursor:pointer;">🔄 Sync วันที่ที่จะผลิต</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="font-weight:600;">แสดง</label>
        <select id="select-backlog-mat-limit" style="padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;">${limitOptions}</select>
        <span style="color:#64748b;">จากทั้งหมด ${allRows.length} รายการ</span>
        <button type="button" id="btn-export-backlog-mat-summary" style="margin-left:auto;padding:5px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">Export CSV</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">
        ${chips}
      </div>
      ${shown.length === 0 ? '<div style="padding:24px;text-align:center;color:#64748b;">ไม่พบข้อมูล Mat. สำหรับ PD ใน Backlog</div>' : `
      <div style="overflow:auto;max-height:52vh;border:1px solid rgba(0,0,0,0.08);border-radius:6px;">
        ${tableHtml}
      </div>`}
    `);

    const overlay = document.getElementById('backlog-mat-summary-modal');
    overlay.querySelector('#btn-close-backlog-mat-summary')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#select-backlog-mat-limit')?.addEventListener('change', (e) => {
      this.limit = Number(e.target.value);
      this.render();
    });
    overlay.querySelectorAll('.btn-backlog-mat-view').forEach(el => el.addEventListener('click', () => {
      if (this.viewMode === el.dataset.view) return;
      this.viewMode = el.dataset.view;
      this.render();
    }));
    overlay.querySelectorAll('.backlog-mat-th').forEach(el => el.addEventListener('dblclick', () => {
      const cur = this.sort[this.viewMode];
      const key = el.dataset.key;
      // asc -> desc -> back to default order
      if (!cur || cur.key !== key) this.sort[this.viewMode] = { key, dir: 1 };
      else if (cur.dir === 1) this.sort[this.viewMode] = { key, dir: -1 };
      else this.sort[this.viewMode] = null;
      this.render();
    }));
    overlay.querySelector('#btn-sync-backlog-mat-alloc')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '⏳ กำลัง Sync...';
      try { await this.state.storageSync?.syncProductionDates(); } catch (err) { console.error('Sync Allocation Date failed', err); }
      this.report = this.buildReport();
      this.render();
    });
    overlay.querySelector('#btn-export-backlog-mat-summary')?.addEventListener('click', () => this.exportCsv(shown, isMatView));
    overlay.querySelectorAll('.backlog-mat-pd').forEach(el => el.addEventListener('dblclick', () => {
      const pdModal = document.getElementById('pd-plan-modal');
      if (pdModal) pdModal.style.zIndex = '100001';
      window.dispatchEvent(new CustomEvent('open-pd-modal', { detail: { woId: el.dataset.pd } }));
    }));
  }

  showModal(innerHtml) {
    let overlay = document.getElementById('backlog-mat-summary-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'backlog-mat-summary-modal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <style>
        #backlog-mat-summary-modal .backlog-mat-table{width:100%;border-collapse:collapse;font-size:12px;}
        #backlog-mat-summary-modal .backlog-mat-table thead{position:relative;z-index:2;isolation:isolate;}
        #backlog-mat-summary-modal .backlog-mat-table th{position:sticky;top:0;z-index:2;background:#f1f5f9;text-align:left;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,0.12);white-space:nowrap;}
        #backlog-mat-summary-modal .backlog-mat-table td{vertical-align:middle;padding:5px 8px;border-bottom:1px solid rgba(0,0,0,0.06);white-space:nowrap;}
        #backlog-mat-summary-modal .backlog-mat-table td.truncate{max-width:220px;overflow:hidden;text-overflow:ellipsis;}
      </style>
      <div style="background:#fff;color:#0f172a;border-radius:10px;max-width:1500px;width:100%;max-height:90vh;overflow:auto;padding:16px 18px;box-shadow:0 20px 50px rgba(0,0,0,0.3);font-size:12.5px;">${innerHtml}</div>`;
  }

  buildCsvLines(rows) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['PD No.', 'Dwg No.', 'Part Name', 'Mat.', 'Mat._1', 'QTY', 'Mat. status', 'วันที่ที่จะผลิต', 'จำนวนในคลัง', 'พอเบิก/ไม่พอ'].map(q).join(',')];
    rows.forEach(r => {
      const hasWh = r.warehouseQty !== undefined && r.warehouseQty !== null;
      const sufficiency = hasWh ? (Number(r.warehouseQty) >= Number(r.qty || 0) ? 'พอเบิก' : 'ไม่พอ') : '';
      lines.push([r.pdNo, r.dwgNo, r.partName, r.mat, r.desc, r.qty, r.status ? r.status.label : '', r.allocationDate || '', hasWh ? r.warehouseQty : '', sufficiency].map(q).join(','));
    });
    return lines;
  }

  buildMatViewCsvLines(rows) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Mat.', 'รายละเอียด', 'QTY รวม', 'Inventory on Hand', 'พอเบิก/ไม่พอ', 'จำนวน PD', 'PD ที่ต้องการ'].map(q).join(',')];
    rows.forEach(r => {
      lines.push([r.mat, r.desc, r.qty, r.inventory ?? '', r.sufficiency ? r.sufficiency.label : '', r.pdList.length, r.pdList.join('; ')].map(q).join(','));
    });
    return lines;
  }

  exportCsv(rows, isMatView) {
    const lines = isMatView ? this.buildMatViewCsvLines(rows) : this.buildCsvLines(rows);
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backlog_Mat_Summary${isMatView ? '_by_Mat' : ''}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
