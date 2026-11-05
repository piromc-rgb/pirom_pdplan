// Mobile Mode: read-only portrait view for a ~6 inch phone.
// Screens: Work Center list -> daily schedule of one Work Center -> PD detail (+ drawing PDF).
import { DSC_ICON_READY, DSC_ICON_ACTIVE, DSC_ICON_WAIT } from './dailySchedule.js';

const esc =(v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');

const OP_STYLES = {
  completed: { label: 'Completed', bg: '#dcfce7', fg: '#166534' },
  active: { label: 'Active', bg: '#dbeafe', fg: '#1d4ed8' },
  running: { label: 'Active', bg: '#dbeafe', fg: '#1d4ed8' },
  'ready to start': { label: 'Ready to Start', bg: '#fef9c3', fg: '#854d0e' },
  planned: { label: 'Planned', bg: '#e2e8f0', fg: '#475569' }
};
const MAT_TONES = { ok: '#15803d', warn: '#b45309', info: '#0369a1', old: '#5b21b6', notready: '#b91c1c', ready: '#15803d' };

export class MobileModeController {
  constructor(state) {
    this.state = state;
    this.active = false;
    this.stack = [{ screen: 'wc' }];
    this.date = new Date();
    this.btn = document.getElementById('btn-mobile-mode');
    this.build();
    if (this.btn) this.btn.addEventListener('click', () => (this.active ? this.exit() : this.enter()));
    this.state.subscribe(() => { if (this.active) this.render(); });
    // Opened on a phone: start in Mobile Mode (unless the user left it during this browser session)
    if (this.isPhone() && !this.optedOut()) this.enter();
  }

  isPhone() {
    try {
      const ua = /Android.+Mobile|iPhone|iPod|Windows Phone/i.test(navigator.userAgent || '');
      const smallTouch = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600;
      return ua || smallTouch;
    } catch (e) { return false; }
  }

  optedOut() { try { return sessionStorage.getItem('mm-desktop') === '1'; } catch (e) { return false; } }
  setOptedOut(v) { try { v ? sessionStorage.setItem('mm-desktop', '1') : sessionStorage.removeItem('mm-desktop'); } catch (e) { /* storage blocked */ } }

  build() {
    const el = document.createElement('div');
    el.id = 'mobile-mode-overlay';
    el.className = 'hidden';
    el.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#f1f5f9;color:#0f172a;display:flex;flex-direction:column;font-family:inherit;';
    el.innerHTML = `
      <div id="mm-bar" style="flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0f3d5e;color:#fff;">
        <button type="button" id="mm-back" style="border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:18px;width:36px;height:36px;border-radius:8px;">‹</button>
        <div id="mm-title" style="flex:1;min-width:0;font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
        <button type="button" id="mm-search" title="ค้นหา PD / สแกน QR Code" style="border:none;background:rgba(255,255,255,0.15);color:#fff;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg></button>
        <button type="button" id="mm-exit" style="border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:12px;font-weight:700;padding:0 10px;height:36px;border-radius:8px;">✕ ออก</button>
      </div>
      <div id="mm-body" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:10px 12px 24px;"></div>`;
    document.body.appendChild(el);
    // The desktop layout is wider than a phone and would stretch the viewport: hide it while Mobile Mode is on
    const css = document.createElement('style');
    css.textContent = 'body.mm-active > *:not(#mobile-mode-overlay):not(script):not(style){display:none !important;}';
    document.head.appendChild(css);
    this.el = el;
    this.body = el.querySelector('#mm-body');
    this.title = el.querySelector('#mm-title');
    this.backBtn = el.querySelector('#mm-back');
    this.backBtn.addEventListener('click', () => this.back());
    el.querySelector('#mm-exit').addEventListener('click', () => this.exit());
    el.querySelector('#mm-search').addEventListener('click', () => this.openSearch());
  }

  enter() {
    this.setOptedOut(false);
    this.active = true;
    this.stack = [{ screen: 'wc' }];
    this.date = new Date();
    this.el.classList.remove('hidden');
    document.body.classList.add('mm-active');
    if (this.btn) this.btn.classList.add('mm-on');
    this.render();
  }

  exit() {
    this.setOptedOut(true);
    this.active = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('mm-active');
    if (this.btn) this.btn.classList.remove('mm-on');
  }

  push(entry) { this.stack.push(entry); this.render(true); }
  back() { if (this.stack.length > 1) { this.stack.pop(); this.render(true); } }

  render(resetScroll = false) {
    const cur = this.stack[this.stack.length - 1];
    this.backBtn.style.visibility = this.stack.length > 1 ? 'visible' : 'hidden';
    const scroll = this.body.scrollTop;
    if (cur.screen === 'wc') this.renderWorkCenters();
    else if (cur.screen === 'daily') this.renderDaily(cur);
    else if (cur.screen === 'pd') this.renderPd(cur);
    this.body.scrollTop = resetScroll ? 0 : scroll;
  }

  // ---- PD search: type a PD number or scan its barcode ---------------------------------------
  normalizePd(text) {
    const t = String(text || '').trim().toUpperCase();
    const m = t.match(/PD\d+[A-Z]?/);
    if (m) return m[0];
    const d = t.match(/\d{5,}/);
    return d ? `PD${d[0]}` : t;
  }

  pdExists(id) {
    const s = this.state;
    return (s.workOrders || []).some(w => w.id === id) || (s.scheduledJobs || []).some(j => (j.woId || j.id) === id)
      || Boolean(s.pdOpStatusMap && s.pdOpStatusMap[id]) || Boolean(s.pdDoneOps && s.pdDoneOps[id]);
  }

  openSearch() {
    this.closeSearch();
    const box = document.createElement('div');
    box.id = 'mm-search-sheet';
    box.style.cssText = 'position:absolute;inset:0;z-index:5;background:rgba(15,23,42,0.55);display:flex;align-items:flex-start;';
    box.innerHTML = `<div style="width:100%;background:#fff;padding:14px 12px 16px;border-radius:0 0 14px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><b style="font-size:15px;">ค้นหา PD</b><button type="button" id="mm-s-close" style="border:none;background:#e2e8f0;border-radius:8px;width:34px;height:34px;font-size:16px;">✕</button></div>
      <div style="display:flex;gap:8px;">
        <input id="mm-s-input" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" placeholder="กรอกเลข PD เช่น PD2611484" style="flex:1;min-width:0;font-size:16px;padding:10px 12px;border:1.5px solid #94a3b8;border-radius:8px;">
        <button type="button" id="mm-s-go" style="border:none;background:#2563eb;color:#fff;font-weight:700;font-size:14px;border-radius:8px;padding:0 16px;">ค้นหา</button>
      </div>
      <button type="button" id="mm-s-scan" style="width:100%;margin-top:10px;border:1.5px solid #2563eb;background:#eff6ff;color:#1d4ed8;font-weight:700;font-size:14px;border-radius:8px;padding:11px;">📷 สแกน QR Code</button>
      <div id="mm-s-msg" style="font-size:12.5px;color:#b91c1c;margin-top:8px;min-height:16px;"></div>
      <div id="mm-s-cam" style="display:none;margin-top:8px;"><video id="mm-s-video" playsinline muted style="width:100%;border-radius:8px;background:#000;max-height:280px;object-fit:cover;"></video></div>
    </div>`;
    this.el.appendChild(box);
    const input = box.querySelector('#mm-s-input');
    box.querySelector('#mm-s-close').addEventListener('click', () => this.closeSearch());
    box.addEventListener('click', (e) => { if (e.target === box) this.closeSearch(); });
    const go = () => this.goToPd(input.value);
    box.querySelector('#mm-s-go').addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    box.querySelector('#mm-s-scan').addEventListener('click', () => this.startScan());
    setTimeout(() => input.focus(), 50);
  }

  closeSearch() {
    this.stopScan();
    const box = this.el.querySelector('#mm-search-sheet');
    if (box) box.remove();
  }

  goToPd(text) {
    const box = this.el.querySelector('#mm-search-sheet');
    const msg = box && box.querySelector('#mm-s-msg');
    const id = this.normalizePd(text);
    if (!id) { if (msg) msg.textContent = 'กรุณากรอกเลข PD'; return false; }
    if (!this.pdExists(id)) { if (msg) msg.textContent = `ไม่พบ ${id}`; return false; }
    this.closeSearch();
    this.push({ screen: 'pd', pdId: id });
    return true;
  }

  async startScan() {
    const box = this.el.querySelector('#mm-search-sheet');
    const msg = box.querySelector('#mm-s-msg');
    msg.style.color = '#b91c1c';
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = 'เบราว์เซอร์นี้ไม่รองรับการสแกน QR Code กรุณากรอกเลข PD (หรือใช้ Chrome บน Android)';
      return;
    }
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      msg.textContent = 'เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้อง';
      return;
    }
    const video = box.querySelector('#mm-s-video');
    box.querySelector('#mm-s-cam').style.display = 'block';
    video.srcObject = this._stream;
    await video.play().catch(() => {});
    msg.style.color = '#475569';
    msg.textContent = 'ส่องกล้องไปที่ QR Code ของ PD';
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    this._scanning = true;
    const tick = async () => {
      if (!this._scanning) return;
      try {
        const codes = await detector.detect(video);
        for (const c of codes) {
          const id = this.normalizePd(c.rawValue);
          if (id && this.pdExists(id)) { this.goToPd(id); return; }
        }
        if (codes.length) { msg.style.color = '#b91c1c'; msg.textContent = `ไม่พบ PD จาก QR Code: ${codes[0].rawValue}`; }
      } catch (e) { /* frame not ready */ }
      setTimeout(tick, 250);
    };
    tick();
  }

  stopScan() {
    this._scanning = false;
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
  }

  // ---- Screen 1: Work Centers ------------------------------------------------------------
  getMachines() {
    const s = this.state;
    const rc = s.resourcesController;
    let machines = rc && typeof rc.getVisibleMachines === 'function' ? rc.getVisibleMachines() : [...new Set((s.scheduledJobs || []).map(j => j.machine).filter(Boolean))];
    const order = (s.workCenterOrder || []);
    const idx = (m) => { const i = order.indexOf(m); return i < 0 ? 9999 : i; };
    return machines.filter(m => s.workCenters[m]).sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
  }

  renderWorkCenters() {
    const s = this.state;
    this.title.textContent = 'Work Center';
    const machines = this.getMachines();
    // Same as the Gantt row labels: the three most loaded Work Centers are red
    const top3 = new Set(machines.map(m => ({ m, u: s.getMachineOEE(m).util || 0 })).filter(x => x.u > 0).sort((a, b) => b.u - a.u).slice(0, 3).map(x => x.m));
    const rows = machines.map(m => {
      const wc = s.workCenters[m] || {};
      const hpd = wc.workHoursPerDay !== undefined ? wc.workHoursPerDay : 8;
      const util = s.getMachineOEE(m).util || 0;
      const color = top3.has(m) ? '#dc2626' : '#3b82f6';
      return `<div class="mm-wc" data-m="${esc(m)}" style="background:#fff;border-radius:10px;padding:12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
          <span style="font-size:15px;font-weight:700;">${esc(s.getMachineDisplayName(m))}</span>
          <span style="font-size:12px;font-weight:700;color:#3b82f6;white-space:nowrap;">${Number(hpd.toFixed(1))} h/d</span>
        </div>
        <div style="height:6px;border-radius:3px;background:#e2e8f0;margin-top:8px;overflow:hidden;"><div style="width:${Math.min(100, util)}%;height:100%;background:${color};"></div></div>
      </div>`;
    }).join('');
    this.body.innerHTML = rows || '<div style="text-align:center;color:#64748b;padding:40px 0;">ไม่มี Work Center</div>';
    this.body.querySelectorAll('.mm-wc').forEach(el => el.addEventListener('click', () => {
      this.date = new Date();
      this.push({ screen: 'daily', machine: el.dataset.m });
    }));
  }

  // ---- Screen 2: daily schedule ------------------------------------------------------------
  stepLabel(st) { return (st && (st.name || st.stepName || st.partName)) || 'Operation'; }

  getSortedSteps(woId) {
    const s = this.state;
    const wo = (s.workOrders || []).find(w => w.id === woId);
    if (wo && wo.steps && wo.steps.length) return [...wo.steps].sort((a, b) => a.stepNum - b.stepNum);
    return (s.scheduledJobs || []).filter(j => (j.woId || j.id) === woId).sort((a, b) => a.stepNum - b.stepNum);
  }

  renderDaily(cur) {
    const s = this.state;
    const machine = cur.machine;
    const dsc = s.dailyScheduleController;
    this.title.textContent = s.getMachineDisplayName(machine);
    const d = this.date;
    const jobs = (s.scheduledJobs || []).filter(j => {
      if (j.machine !== machine || j.status === 'Completed') return false;
      const jd = s.workingHourToDate(j.startHour);
      return jd.getFullYear() === d.getFullYear() && jd.getMonth() === d.getMonth() && jd.getDate() === d.getDate();
    }).sort((a, b) => a.startHour - b.startHour);

    const dateText = dsc && dsc.formatThaiDate ? dsc.formatThaiDate(d) : d.toDateString();
    const nav = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
      <button type="button" id="mm-prev" style="flex:0 0 44px;height:44px;border:none;border-radius:10px;background:#fff;font-size:20px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">◀</button>
      <div style="flex:1;text-align:center;font-size:14px;font-weight:700;background:#fff;border-radius:10px;padding:12px 4px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">${esc(dateText)}</div>
      <button type="button" id="mm-next" style="flex:0 0 44px;height:44px;border:none;border-radius:10px;background:#fff;font-size:20px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">▶</button>
    </div>`;

    const cards = jobs.map(job => {
      const a = s.workingHourToDate(job.startHour);
      const b = s.workingHourToDate(job.startHour + job.estHours);
      const steps = this.getSortedSteps(job.woId);
      const i = steps.findIndex(x => x.stepNum === job.stepNum);
      // Status figures as on the desktop cards: crouching = Ready to Start, running = Active, red seated = first Operation still Planned
      const opSt = dsc && dsc.getOpStatusSteps ? dsc.getOpStatusSteps(job.woId) : new Map();
      const firstPlanned = dsc && dsc.isFirstStepPlanned ? dsc.isFirstStepPlanned(job.woId, steps[0]) : false;
      const icon = (idx) => {
        const st = steps[idx];
        if (!st) return '';
        const tag = opSt.get(st.stepNum);
        if (tag === 'active') return DSC_ICON_ACTIVE + ' ';
        if (tag === 'ready') return `<span style="color:#a16207;">${DSC_ICON_READY}</span> `;
        return firstPlanned && idx === 0 ? DSC_ICON_WAIT + ' ' : '';
      };
      const prev = i > 0 ? this.stepLabel(steps[i - 1]) : '';
      const next = i >= 0 && i < steps.length - 1 ? this.stepLabel(steps[i + 1]) : '';
      const cur = this.stepLabel(steps[i] || job) || job.stepName || job.name;
      const chain = [prev && `<span style="color:#15803d;">${icon(i - 1)}${esc(prev)}</span>`, `<b style="border:1.5px solid #16a34a;border-radius:4px;padding:0 4px;">${icon(i)}${esc(cur)}</b>`, next && `<span>${icon(i + 1)}${esc(next)}</span>`].filter(Boolean).join(' › ');
      const iss = s.getStepMaterialIssueSummary(job.woId, job.stepNum);
      const mat = iss ? `<div style="font-size:12px;margin-top:4px;">📦 <b style="color:${MAT_TONES[iss.tone] || '#0369a1'};">${esc(iss.label)}</b></div>` : '';
      return `<div class="mm-job" data-pd="${esc(job.woId)}" style="background:#fff;border-radius:10px;border-left:5px solid #0ea5e9;padding:10px 12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
          <b style="font-size:15px;">${pad2(a.getHours())}:${pad2(a.getMinutes())} - ${pad2(b.getHours())}:${pad2(b.getMinutes())}</b>
          <span style="font-size:11.5px;color:#64748b;">${job.estHours.toFixed(2)} h</span>
        </div>
        <div style="margin-top:4px;"><span class="mm-pd" style="color:#2563eb;font-weight:700;text-decoration:underline;font-size:14px;">${s.isFastTrackPd(job.woId) ? '⚡ ' : ''}${esc(job.woId)}</span> <span style="font-size:12px;color:#64748b;">· ${esc(job.qty)} pcs · ${esc(job.project || '')}</span></div>
        <div style="font-size:13px;margin-top:2px;">${esc(job.partName || '')}</div>
        ${mat}
        <div style="font-size:12px;margin-top:6px;color:#475569;">${chain}</div>
      </div>`;
    }).join('');

    this.body.innerHTML = nav + (cards || '<div style="text-align:center;color:#64748b;padding:40px 0;">ไม่มีงานในวันนี้</div>');
    const shift = (n) => { this.date = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); this.render(true); };
    this.body.querySelector('#mm-prev').addEventListener('click', () => shift(-1));
    this.body.querySelector('#mm-next').addEventListener('click', () => shift(1));
    this.body.querySelectorAll('.mm-job').forEach(el => el.addEventListener('click', () => this.push({ screen: 'pd', pdId: el.dataset.pd })));
  }

  // Plan + Mat rows of a PD (same rules as the PD modal's "รายการวัสดุ / ชิ้นส่วนประกอบงานเชื่อม" table):
  // 14-char codes are child PDs (status of the child), 10-char codes are warehouse raw materials (issue status).
  getMatRows(woId) {
    const s = this.state;
    const unique = new Map();
    ((s.planMaterials && s.planMaterials[woId]) || []).forEach(item => {
      const code = String(item.mat || '').trim();
      if (!code) return;
      const op = { stepNum: item.stepNum, operDesc: item.operDesc, wc: item.wc, operStatus: item.operStatus };
      const ex = unique.get(code);
      if (!ex) { unique.set(code, { ...item, operations: [op] }); return; }
      if (item.estimatedQty > ex.estimatedQty) ex.estimatedQty = item.estimatedQty;
      if ((item.actualQty || 0) > (ex.actualQty || 0)) ex.actualQty = item.actualQty;
      if ((item.toIssue || 0) > (ex.toIssue || 0)) ex.toIssue = item.toIssue;
      if (item.operStatus && !ex.operStatus) ex.operStatus = item.operStatus;
      if (!ex.operations.some(o => o.stepNum === item.stepNum)) ex.operations.push(op);
    });
    const GREEN = { fg: '#15803d', bg: '#dcfce7' }, AMBER = { fg: '#b45309', bg: '#fef3c7' }, BLUE = { fg: '#0369a1', bg: '#e0f2fe' };
    const RED = { fg: '#b91c1c', bg: '#fee2e2' }, PURPLE = { fg: '#5b21b6', bg: '#ede9fe' }, GREY = { fg: '#475569', bg: '#e2e8f0' };
    const toneColor = { ok: GREEN, warn: AMBER, info: BLUE, notready: RED, old: PURPLE, ready: GREEN };
    return [...unique.values()].map(item => {
      const code = String(item.mat || '').trim();
      const row = { code, desc: item.matDesc || '', qty: item.estimatedQty, childPd: '', kind: 'raw', status: '', color: GREY, pendingOp: '' };
      if (code.length === 14) {
        row.kind = 'child';
        const c = typeof s.getChildPdInfo === 'function' ? s.getChildPdInfo(code, woId) : null;
        if (c && c.found && !c.isRawMat) {
          row.childPd = c.pdId; row.status = c.statusLabel; row.color = c.isClosed ? GREEN : AMBER; row.pendingOp = c.pendingOp;
        } else row.status = 'ไม่พบ PD';
      } else if (code.length === 10) {
        row.kind = 'stock';
        const ops = (item.operations || []).slice().sort((a, b) => (Number(a.stepNum) || 0) - (Number(b.stepNum) || 0));
        const readiness = s.getMatReadinessStatus ? s.getMatReadinessStatus(ops[0]?.operStatus, item.orderStatus) : null;
        const usedOld = s.isOldMaterialUsed ? s.isOldMaterialUsed(ops.map(o => ({ ...o, actualQty: item.actualQty, toIssue: item.toIssue }))) : false;
        const issue = s.getMaterialIssueStatus ? s.getMaterialIssueStatus(item) : null;
        if (readiness) { row.status = readiness.label; row.color = readiness.tone === 'notready' ? RED : GREEN; }
        else if (usedOld) { row.status = '♻️ ใช้วัสดุเก่า'; row.color = PURPLE; }
        else if (issue) { row.status = issue.label; row.color = toneColor[issue.tone] || BLUE; }
        else if (item.toIssue === 0 && (item.actualQty > 0 || item.estimatedQty > 0)) { row.status = '✓ จ่ายครบแล้ว'; row.color = GREEN; }
        else if (item.toIssue > 0) { row.status = `⏳ รอเบิกจ่าย (${item.toIssue})`; row.color = AMBER; }
        else if (item.operStatus) { row.status = item.operStatus; row.color = BLUE; }
        else { row.status = '✓ พร้อมใช้งาน'; row.color = GREEN; }
        const unfinished = ops.filter(o => !['completed', 'closed'].includes(String(o.operStatus || '').toLowerCase()));
        const target = unfinished[0] || ops[ops.length - 1];
        if (ops.length && !unfinished.length) row.pendingOp = '✓ เสร็จสิ้น';
        else if (target) row.pendingOp = String(target.operDesc || s.workCenters?.[target.wc]?.name || target.wc || '').replace(/\s*\([A-Za-z0-9_-]+\)\s*/g, ' ').trim();
      } else row.status = 'วัตถุดิบ';
      return row;
    });
  }

  // ---- Screen 3: PD detail ----------------------------------------------------------------
  renderPd(cur) {
    const s = this.state;
    const pdId = cur.pdId;
    this.title.textContent = (s.isFastTrackPd(pdId) ? '⚡ ' : '') + pdId;
    const wo = (s.workOrders || []).find(w => w.id === pdId);
    const jobs = (s.scheduledJobs || []).filter(j => (j.woId || j.id) === pdId);
    const head = wo || jobs[0] || {};
    const st = s.getPdOrderStatusDisplay ? s.getPdOrderStatusDisplay(pdId) : null;
    const opMap = (s.pdOpStatusMap && s.pdOpStatusMap[pdId]) || {};

    // Routing: Backlog steps or Board jobs, plus Completed operations kept from the Status Overview
    const rows = new Map();
    (wo && wo.steps ? wo.steps : []).forEach(x => rows.set(x.stepNum, { stepNum: x.stepNum, name: this.stepLabel(x), machine: x.machine, estHours: x.estHours, status: x.opStatus || x.status, job: null }));
    jobs.forEach(j => rows.set(j.stepNum, { stepNum: j.stepNum, name: j.stepName || j.name || this.stepLabel(j), machine: j.machine, estHours: j.estHours, status: j.status, job: j }));
    ((s.pdDoneOps || {})[pdId] || []).forEach(x => { if (!rows.has(x.stepNum)) rows.set(x.stepNum, { stepNum: x.stepNum, name: x.name, machine: x.machine, estHours: x.estHours, status: 'Completed', job: null }); });
    const steps = [...rows.values()].sort((a, b) => a.stepNum - b.stepNum);

    const opChip = (r) => {
      const raw = String(opMap[String(r.stepNum)] || (r.status === 'Completed' ? 'Completed' : '') || r.status || 'Planned').trim();
      const o = OP_STYLES[raw.toLowerCase()] || { label: raw, bg: '#e2e8f0', fg: '#475569' };
      return `<span style="background:${o.bg};color:${o.fg};font-size:11px;font-weight:700;border-radius:10px;padding:2px 8px;white-space:nowrap;">${esc(o.label)}</span>`;
    };
    const stepHtml = steps.map(r => {
      let when = '';
      if (r.job && r.job.startHour != null) {
        const a = s.workingHourToDate(r.job.startHour);
        const b = s.workingHourToDate(r.job.startHour + r.job.estHours);
        when = `<div style="font-size:11.5px;color:#64748b;margin-top:2px;">${pad2(a.getDate())}/${pad2(a.getMonth() + 1)} ${pad2(a.getHours())}:${pad2(a.getMinutes())}-${pad2(b.getHours())}:${pad2(b.getMinutes())}</div>`;
      }
      const mins = Number(r.estHours) > 0 ? Math.round(r.estHours * 60) : 0;
      return `<div style="padding:8px 0;border-top:1px solid #e2e8f0;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><b style="font-size:13px;">${esc(r.stepNum)} · ${esc(r.name)}</b>${opChip(r)}</div>
        <div style="font-size:12px;color:#475569;margin-top:2px;">${esc(s.getMachineDisplayName(r.machine) || r.machine || '')}${mins ? ` · ${mins} นาที` : ''}</div>${when}</div>`;
    }).join('');

    const matRows = this.getMatRows(pdId);
    const matHtml = matRows.map(m => `<div style="padding:8px 0;border-top:1px solid #e2e8f0;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;"><span style="font-family:monospace;font-weight:800;font-size:12px;color:#0284c7;word-break:break-all;">${esc(m.code)}</span><b style="font-size:12px;color:#c2410c;white-space:nowrap;">Qty ${esc(m.qty ?? '-')}</b></div>
        <div style="font-size:13px;font-weight:600;margin-top:2px;">${esc(m.desc || '-')}</div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:5px;">
          ${m.childPd ? `<span class="mm-child" data-pd="${esc(m.childPd)}" style="color:#2563eb;font-weight:700;text-decoration:underline;font-size:12.5px;">🔍 ${esc(m.childPd)}</span>` : (m.kind === 'stock' ? '<span style="font-size:11.5px;color:#475569;">📦 วัตถุดิบคลัง</span>' : '')}
          ${m.status ? `<span style="background:${m.color.bg};color:${m.color.fg};font-size:11px;font-weight:700;border-radius:10px;padding:2px 8px;">${esc(m.status)}</span>` : ''}
          ${m.pendingOp ? `<span style="font-size:11.5px;color:#475569;">Op: <b>${esc(m.pendingOp)}</b></span>` : ''}
        </div></div>`).join('');

    const field = (label, value) => `<div style="margin-top:8px;"><div style="font-size:11px;color:#64748b;">${label}</div><div style="font-size:14px;font-weight:600;word-break:break-word;">${esc(value || '-')}</div></div>`;
    const dwg = head.dwgNo || '';
    this.body.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        ${st ? `<span style="background:${st.color};color:#fff;font-size:11.5px;font-weight:700;border-radius:10px;padding:3px 10px;">${esc(st.label)}</span>` : ''}
        ${field('ชื่อชิ้นงาน', head.partName)}
        ${field('SO / Project', head.project)}
        ${field('Customer', head.customer)}
        <div style="display:flex;gap:16px;">${field('จำนวน', head.qty)}${field('Priority', head.priority)}</div>
        <div style="margin-top:8px;"><div style="font-size:11px;color:#64748b;">Dwg No</div>
          <div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:600;word-break:break-all;">${esc(dwg || '-')}</span>
            ${dwg ? '<button type="button" id="mm-pdf" style="border:none;background:#2563eb;color:#fff;font-weight:700;font-size:13px;border-radius:8px;padding:8px 16px;">PDF</button>' : ''}</div></div>
      </div>
      <div style="background:#fff;border-radius:10px;padding:8px 12px;margin-top:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:13px;font-weight:700;padding:4px 0;">ขั้นตอนการผลิต (${steps.length})</div>${stepHtml || '<div style="color:#64748b;padding:8px 0;">ไม่มีข้อมูล</div>'}
      </div>
      ${matRows.length ? `<div style="background:#fff;border-radius:10px;padding:8px 12px;margin-top:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:13px;font-weight:700;padding:4px 0;color:#d97706;">⚡ รายการวัสดุ / ชิ้นส่วนประกอบย่อย (${matRows.length})</div>${matHtml}
      </div>` : ''}`;
    this.body.querySelectorAll('.mm-child').forEach(el => el.addEventListener('click', () => this.push({ screen: 'pd', pdId: el.dataset.pd })));
    const pdf = this.body.querySelector('#mm-pdf');
    if (pdf) pdf.addEventListener('click', () => { if (typeof window.openDwgPdfViewer === 'function') window.openDwgPdfViewer(dwg); });
  }
}
