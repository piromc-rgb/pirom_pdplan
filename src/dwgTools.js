// Drawing File Tools (Planing Tools menu): reindex the drawing PDFs in Google Drive and clean up duplicate / old-Rev files.
// Everything runs in the Apps Script behind Cloud Sync (actions dwg-reindex / dwg-duplicates / dwg-trash).
export class DwgToolsController {
  constructor(state) {
    this.state = state;
    this.overlay = null;
  }

  init() {
    const group = document.getElementById('btn-dwg-tools');
    const sub = document.getElementById('dwg-tools-submenu');
    if (group && sub) {
      group.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = sub.style.display === 'none' || !sub.style.display;
        sub.style.display = open ? 'flex' : 'none';
        const arrow = group.querySelector('.dwg-tools-arrow');
        if (arrow) arrow.style.transform = open ? 'rotate(180deg)' : '';
      });
    }
    document.getElementById('btn-dwg-reindex')?.addEventListener('click', () => this.openReindex());
    document.getElementById('btn-dwg-duplicates')?.addEventListener('click', () => this.openDuplicates());
  }

  toast(msg, type = 'info') {
    this.state.ganttController?.showToast?.(msg, type);
  }

  // Calls an Apps Script action; resolves to the parsed JSON or throws a readable Error
  async call(params, timeoutMs = 120000) {
    const sync = this.state.storageSync;
    const ep = sync?.getEndpointUrl?.() || '';
    if (!ep || !ep.startsWith('http')) throw new Error('ยังไม่ได้ตั้งค่า Cloud Sync (Apps Script URL) — ตั้งค่าที่ปุ่ม ☁️ ที่เก็บข้อมูล');
    const sep = ep.includes('?') ? '&' : '?';
    const q = new URLSearchParams({ ...params, dwgFolderId: sync.getDwgFolderId?.() || '', t: String(Date.now()) });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${ep}${sep}${q.toString()}`, { signal: ctrl.signal });
    } catch (err) {
      throw new Error(err && err.name === 'AbortError' ? 'หมดเวลารอ Apps Script' : 'เชื่อมต่อ Apps Script ไม่ได้');
    } finally {
      clearTimeout(timer);
    }
    const data = res.ok ? await res.json().catch(() => null) : null;
    if (!data) throw new Error('Apps Script ตอบกลับไม่ถูกต้อง');
    if (!data.dwgTool) {
      throw new Error('Apps Script ยังเป็นเวอร์ชันเก่า — เปิด ☁️ ที่เก็บข้อมูล → คัดลอกโค้ด Apps Script ใหม่ไปวางแทน แล้ว Deploy เวอร์ชันใหม่');
    }
    if (data.status !== 'success') {
      const err = new Error(data.message || 'เกิดข้อผิดพลาด');
      err.code = data.code;
      throw err;
    }
    return data;
  }

  esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  openModal(title, bodyHtml, width = 760) {
    this.closeModal();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;color:#0f172a;border-radius:12px;width:min(${width}px,100%);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,0.35);">
        <div style="padding:14px 18px 8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="font-size:15px;font-weight:700;">${title}</div>
          <button type="button" id="dwgt-close" style="border:none;background:transparent;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div id="dwgt-body" style="padding:4px 18px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px;font-size:12.5px;">${bodyHtml}</div>
      </div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    overlay.querySelector('#dwgt-close').addEventListener('click', () => this.closeModal());
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.closeModal(); });
    return overlay.querySelector('#dwgt-body');
  }

  closeModal() {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this._runToken = (this._runToken || 0) + 1; // stops a running reindex loop
  }

  // ---- 1. Reindex ----------------------------------------------------------------------------------------------------
  openReindex() {
    const body = this.openModal('🗂️ Reindex ไฟล์ PDF แบบงานใน Google Drive', `
      <div style="color:#475569;line-height:1.6;">
        สแกนทุกโฟลเดอร์ของแบบงาน แล้วเก็บรายชื่อไฟล์ PDF ไว้เป็น <b>dwg_index.json</b> ใน Drive —
        การเปิดไฟล์แบบ (ดับเบิลคลิก Item Code / รายงาน Progress) จะค้นจากรายการนี้แทนการไล่เปิดทุกโฟลเดอร์ จึงเร็วขึ้น
        และเลือก Rev ล่าสุดให้อัตโนมัติ<br>
        ทำใหม่ทุกครั้งที่เพิ่มหรือลบไฟล์แบบจำนวนมาก. ถ้าไฟล์เยอะ ใช้เวลาหลายนาที (ทำต่อเนื่องจนครบ ปิดหน้านี้ = หยุด)
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="button" id="dwgt-start" style="padding:7px 16px;border:none;border-radius:6px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer;">▶ เริ่ม Reindex</button>
        <button type="button" id="dwgt-resume" style="padding:7px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;" title="ทำต่อจากที่ค้างไว้ (ไม่เริ่มสแกนใหม่)">ทำต่อจากที่ค้าง</button>
      </div>
      <div id="dwgt-status" style="padding:10px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;color:#334155;">ยังไม่ได้เริ่ม</div>`, 640);
    const status = body.querySelector('#dwgt-status');
    const run = async (reset) => {
      const token = (this._runToken = (this._runToken || 0) + 1);
      body.querySelector('#dwgt-start').disabled = true;
      body.querySelector('#dwgt-resume').disabled = true;
      let first = reset;
      try {
        for (;;) {
          status.innerHTML = '⏳ กำลังสแกน Drive ... (รอบนี้อาจใช้เวลาถึง 3-4 นาที)';
          const d = await this.call({ action: 'dwg-reindex', ...(first ? { reset: '1' } : {}) }, 330000);
          first = false;
          if (token !== this._runToken) return;
          status.innerHTML = d.done
            ? `✅ เสร็จแล้ว — พบไฟล์ PDF ${d.files.toLocaleString()} ไฟล์ ใน ${d.folders.toLocaleString()} โฟลเดอร์`
            : `⏳ สแกนแล้ว ${d.folders.toLocaleString()} โฟลเดอร์ · พบ PDF ${d.files.toLocaleString()} ไฟล์ · เหลืออีก ${d.remaining.toLocaleString()} โฟลเดอร์ ...`;
          if (d.done) { this.toast(`✅ Reindex แบบงานเสร็จ (${d.files} ไฟล์)`, 'success'); break; }
        }
      } catch (err) {
        if (token === this._runToken) status.innerHTML = `<span style="color:#b91c1c;">⚠️ ${this.esc(err.message)}</span>`;
      } finally {
        if (this.overlay) {
          const a = body.querySelector('#dwgt-start'); const b = body.querySelector('#dwgt-resume');
          if (a) a.disabled = false;
          if (b) b.disabled = false;
        }
      }
    };
    body.querySelector('#dwgt-start').addEventListener('click', () => run(true));
    body.querySelector('#dwgt-resume').addEventListener('click', () => run(false));
  }

  // ---- 2. Duplicates / old revisions ---------------------------------------------------------------------------------
  async openDuplicates() {
    const body = this.openModal('🧹 ตรวจไฟล์แบบซ้ำ / Rev เก่า', '<div id="dwgt-dup-status" style="color:#475569;">⏳ กำลังตรวจจากรายการ Reindex ...</div>', 980);
    let data;
    try {
      data = await this.call({ action: 'dwg-duplicates' }, 150000);
    } catch (err) {
      const msg = err.code === 'no-index'
        ? 'ยังไม่มีรายการ Reindex — ไปที่ เครื่องมือจัดการ File Drawing → Reindex ก่อน แล้วค่อยตรวจไฟล์ซ้ำ'
        : err.message;
      body.innerHTML = `<div style="color:#b91c1c;">⚠️ ${this.esc(msg)}</div>`;
      return;
    }
    this.renderDuplicates(body, data);
  }

  renderDuplicates(body, data) {
    const groups = data.groups || [];
    const fmtDate = (ms) => { const d = new Date(ms); return isNaN(d) ? '-' : d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }); };
    const fmtSize = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round((b || 0) / 1024)} KB`;
    const revLabel = (f) => f.rev < 0 ? 'ไม่มี Rev' : `Rev.${f.revText}`;
    const link = (f) => `<a href="https://drive.google.com/file/d/${this.esc(f.id)}/view" target="_blank" rel="noopener" style="color:#1d4ed8;text-decoration:none;" title="เปิดไฟล์">${this.esc(f.name)}</a>`;
    const totalRemove = groups.reduce((n, g) => n + g.remove.length, 0);
    const stamp = data.indexUpdatedAt ? new Date(data.indexUpdatedAt).toLocaleString('th-TH') : '-';

    if (groups.length === 0) {
      body.innerHTML = `<div style="color:#15803d;font-weight:700;">✅ ไม่พบไฟล์แบบซ้ำ (ตรวจ ${Number(data.totalFiles || 0).toLocaleString()} ไฟล์ · Reindex ล่าสุด ${this.esc(stamp)})</div>`;
      return;
    }
    const rowsHtml = groups.map((g, gi) => {
      const keepReason = g.keep.rev < 0 ? 'ไม่มี Rev ทั้งกลุ่ม → เก็บไฟล์ที่แก้ไขล่าสุด' : 'Rev ล่าสุด';
      return `<tbody class="dwgt-group" data-key="${this.esc(g.key.toLowerCase())}">
        <tr style="background:#f1f5f9;"><td colspan="5" style="padding:5px 8px;font-weight:700;font-family:monospace;">${this.esc(g.key)} <span style="font-weight:400;color:#64748b;font-family:inherit;">· ${g.remove.length + 1} ไฟล์</span></td></tr>
        <tr style="background:#f0fdf4;">
          <td style="padding:4px 8px;text-align:center;">✅</td>
          <td style="padding:4px 8px;">${link(g.keep)}<div style="color:#64748b;font-size:10.5px;">📁 ${this.esc(g.keep.folder)}</div></td>
          <td style="padding:4px 8px;white-space:nowrap;font-weight:700;color:#15803d;">${revLabel(g.keep)}</td>
          <td style="padding:4px 8px;white-space:nowrap;color:#475569;">${fmtDate(g.keep.modified)} · ${fmtSize(g.keep.size)}</td>
          <td style="padding:4px 8px;color:#15803d;font-weight:700;">เก็บไว้ (${keepReason})</td>
        </tr>
        ${g.remove.map(r => `<tr style="background:#fef2f2;">
          <td style="padding:4px 8px;text-align:center;"><input type="checkbox" class="dwgt-chk" data-id="${this.esc(r.id)}" data-gi="${gi}" checked></td>
          <td style="padding:4px 8px;">${link(r)}<div style="color:#64748b;font-size:10.5px;">📁 ${this.esc(r.folder)}</div></td>
          <td style="padding:4px 8px;white-space:nowrap;font-weight:700;color:#b91c1c;">${revLabel(r)}</td>
          <td style="padding:4px 8px;white-space:nowrap;color:#475569;">${fmtDate(r.modified)} · ${fmtSize(r.size)}</td>
          <td style="padding:4px 8px;color:#b91c1c;">แนะนำลบ (${r.rev < g.keep.rev ? 'Rev เก่ากว่า' : 'ซ้ำ Rev เดียวกัน / เก่ากว่า'})</td>
        </tr>`).join('')}
      </tbody>`;
    }).join('');

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="color:#334155;"><b>${groups.length.toLocaleString()}</b> กลุ่มที่มีไฟล์ซ้ำ · แนะนำลบ <b id="dwgt-count" style="color:#b91c1c;">${totalRemove.toLocaleString()}</b> ไฟล์ จาก ${Number(data.totalFiles || 0).toLocaleString()} ไฟล์<br>
          <span style="color:#64748b;font-size:11px;">Reindex ล่าสุด ${this.esc(stamp)} · เก็บ Rev ล่าสุดของแต่ละรหัสแบบ · ไฟล์ที่ลบจะย้ายไป <b>ถังขยะ Drive</b> (กู้คืนได้ 30 วัน)</span></div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <input id="dwgt-search" placeholder="ค้นรหัสแบบ..." style="padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;width:150px;">
          <button type="button" id="dwgt-all" style="padding:5px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">Select All</button>
          <button type="button" id="dwgt-none" style="padding:5px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">Deselect All</button>
          <button type="button" id="dwgt-trash" style="padding:6px 14px;border:none;border-radius:6px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer;">🗑 ย้ายที่เลือกไปถังขยะ</button>
        </div>
      </div>
      <div id="dwgt-trash-status" style="color:#475569;"></div>
      <div style="overflow:auto;border:1px solid #e2e8f0;border-radius:8px;max-height:58vh;">
        <table style="border-collapse:collapse;width:100%;font-size:12px;">
          <thead><tr style="background:#e2e8f0;text-align:left;position:sticky;top:0;"><th style="padding:5px 8px;width:36px;"></th><th style="padding:5px 8px;">ไฟล์</th><th style="padding:5px 8px;">Rev</th><th style="padding:5px 8px;">แก้ไข / ขนาด</th><th style="padding:5px 8px;">คำแนะนำ</th></tr></thead>
          ${rowsHtml}
        </table>
      </div>`;

    const countEl = body.querySelector('#dwgt-count');
    const checks = () => [...body.querySelectorAll('.dwgt-chk')];
    const refreshCount = () => { countEl.textContent = checks().filter(c => c.checked).length.toLocaleString(); };
    body.addEventListener('change', (e) => { if (e.target.classList?.contains('dwgt-chk')) refreshCount(); });
    body.querySelector('#dwgt-all').addEventListener('click', () => { checks().forEach(c => { if (c.closest('tbody').style.display !== 'none') c.checked = true; }); refreshCount(); });
    body.querySelector('#dwgt-none').addEventListener('click', () => { checks().forEach(c => { c.checked = false; }); refreshCount(); });
    body.querySelector('#dwgt-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      body.querySelectorAll('.dwgt-group').forEach(tb => { tb.style.display = !q || tb.dataset.key.includes(q) ? '' : 'none'; });
    });
    body.querySelector('#dwgt-trash').addEventListener('click', async () => {
      const ids = checks().filter(c => c.checked).map(c => c.dataset.id);
      if (ids.length === 0) { this.toast('ยังไม่ได้เลือกไฟล์ที่จะลบ', 'info'); return; }
      if (!confirm(`ย้ายไฟล์แบบ ${ids.length.toLocaleString()} ไฟล์ ไปถังขยะ Google Drive ?\n(ไฟล์ Rev ล่าสุดของแต่ละรหัสแบบจะถูกเก็บไว้ · กู้คืนจากถังขยะได้ภายใน 30 วัน)`)) return;
      const btn = body.querySelector('#dwgt-trash');
      const st = body.querySelector('#dwgt-trash-status');
      btn.disabled = true;
      let done = 0; let failed = 0;
      try {
        for (let i = 0; i < ids.length; i += 20) {
          const batch = ids.slice(i, i + 20);
          st.textContent = `⏳ กำลังย้ายไปถังขยะ ${done.toLocaleString()} / ${ids.length.toLocaleString()} ...`;
          const r = await this.call({ action: 'dwg-trash', ids: batch.join(',') }, 120000);
          done += r.trashed.length; failed += r.failed.length;
        }
        this.toast(`🗑 ย้ายไปถังขยะแล้ว ${done} ไฟล์${failed ? ` (ล้มเหลว ${failed})` : ''}`, failed ? 'info' : 'success');
        await this.openDuplicates();
      } catch (err) {
        st.innerHTML = `<span style="color:#b91c1c;">⚠️ ${this.esc(err.message)} (ย้ายสำเร็จแล้ว ${done} ไฟล์)</span>`;
        btn.disabled = false;
      }
    });
  }
}
