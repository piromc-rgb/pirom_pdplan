// QC Log Verification Controller
// Cross-checks Production Orders against Google Sheets QC Log
// If PD has status "ส่งเข้าคลัง PRD" or "ส่งเข้าคลัง SEMI" (คลัง PRD / คลัง SEMI),
// marks them completed and removes them from the Gantt board and backlog.

export class QcCheckController {
  constructor(state) {
    this.state = state;
    this.btnCheck = typeof document !== 'undefined' ? document.getElementById('btn-qc-check') : null;
    this.bindEvents();
  }

  bindEvents() {
    if (this.btnCheck) {
      this.btnCheck.addEventListener('click', () => this.runCheck());
    }
  }

  async runCheck() {
    if (!this.btnCheck) return;
    const originalHtml = this.btnCheck.innerHTML;
    this.btnCheck.disabled = true;
    this.btnCheck.innerHTML = `
      <span style="display: inline-block; animation: spin 1s linear infinite; margin-right: 4px;">⏳</span>
      กำลังดึง QC Log...
    `;

    try {
      const csvText = await this.fetchQCLogCsv();
      const qcEntries = this.parseQCLogCsv(csvText);
      this.evaluateAndShowResults(qcEntries);
    } catch (err) {
      console.error('QC Check error:', err);
      this.showErrorModal(err.message || 'ไม่สามารถเชื่อมต่อกับ Google Sheet QC Log ได้');
    } finally {
      this.btnCheck.disabled = false;
      this.btnCheck.innerHTML = originalHtml;
    }
  }

  async fetchQCLogCsv() {
    const gvizUrl = 'https://docs.google.com/spreadsheets/d/1w8B0DyG7PEy_YLHM5HCI_eVU_nt4HvA8xHWShuLRL_8/gviz/tq?tqx=out:csv&gid=1814251242';
    const exportUrl = 'https://docs.google.com/spreadsheets/d/1w8B0DyG7PEy_YLHM5HCI_eVU_nt4HvA8xHWShuLRL_8/export?format=csv&gid=1814251242';

    // 1. Try Google Visualization API (standard CORS-friendly public sheet export)
    try {
      const res = await fetch(gvizUrl);
      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('PD No.')) return text;
      }
    } catch (e) {
      console.warn('QC Log: Direct gviz fetch failed, trying fallback...', e);
    }

    // 2. Try direct export URL
    try {
      const res = await fetch(exportUrl);
      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('PD No.')) return text;
      }
    } catch (e) {
      console.warn('QC Log: Direct export URL fetch failed, trying proxy...', e);
    }

    // 3. Try local dev server proxy if available
    try {
      const res = await fetch('/api/qc-log');
      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('PD No.')) return text;
      }
    } catch (e) {
      console.warn('QC Log: Proxy fetch failed...', e);
    }

    throw new Error('ไม่สามารถเข้าถึง Google Sheet QC Log ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  }

  // Robust CSV parser that handles quotes and line breaks
  parseQCLogCsv(csvText) {
    if (!csvText) return [];

    const lines = [];
    let currentLine = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else if (char === '"') {
          inQuotes = false;
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          currentLine.push(currentField.trim());
          currentField = '';
        } else if (char === '\r') {
          // ignore CR
        } else if (char === '\n') {
          currentLine.push(currentField.trim());
          if (currentLine.some(cell => cell.length > 0)) {
            lines.push(currentLine);
          }
          currentLine = [];
          currentField = '';
        } else {
          currentField += char;
        }
      }
    }
    if (currentField || currentLine.length > 0) {
      currentLine.push(currentField.trim());
      lines.push(currentLine);
    }

    if (lines.length === 0) return [];

    // Locate header row containing 'PD No.'
    const headerRowIdx = lines.findIndex(r => r.some(c => c.includes('PD No.')));
    if (headerRowIdx === -1) return [];

    const headers = lines[headerRowIdx];
    let pdIdx = headers.findIndex(c => c.includes('PD No.'));
    let actionIdx = headers.findIndex(c => c.includes('การดำเนินการ'));
    let dateIdx = headers.findIndex(c => c.includes('วันที่ตรวจ'));
    let inspectorIdx = headers.findIndex(c => c.includes('ผู้ตรวจสอบ'));

    if (pdIdx === -1) pdIdx = 5;
    if (actionIdx === -1) actionIdx = 13;
    if (dateIdx === -1) dateIdx = 2;
    if (inspectorIdx === -1) inspectorIdx = 4;

    const entries = [];
    for (let i = headerRowIdx + 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row || row.length <= pdIdx) continue;

      const rawPd = row[pdIdx] || '';
      const action = row[actionIdx] || '';
      const checkDate = row[dateIdx] || '';
      const inspector = row[inspectorIdx] || '';

      // Match actions like "คลัง PRD", "คลัง SEMI", "ส่งเข้าคลัง PRD", "ส่งเข้าคลัง SEMI"
      const isWarehouseDelivery = 
        action.includes('คลัง PRD') || 
        action.includes('คลัง SEMI') ||
        action.includes('ส่งเข้าคลัง');

      if (!isWarehouseDelivery) continue;

      // Extract all PD identifiers from the cell (e.g. PD2601327 or PD2520224+0225)
      const matches = rawPd.match(/(?:PD|P)\d+/gi);
      if (matches && matches.length > 0) {
        matches.forEach(pd => {
          entries.push({
            pdNo: pd.toUpperCase().trim(),
            rawPd,
            action: action.trim(),
            checkDate: checkDate.trim(),
            inspector: inspector.trim()
          });
        });
      }
    }

    return entries;
  }

  evaluateAndShowResults(qcEntries) {
    // 1. Group QC warehouse delivered entries by PD No.
    const qcDeliveredMap = new Map();
    qcEntries.forEach(entry => {
      if (!qcDeliveredMap.has(entry.pdNo)) {
        qcDeliveredMap.set(entry.pdNo, entry);
      }
    });

    // 2. Find currently active PDs in the system (on Gantt Board or in Backlog)
    const scheduledJobs = this.state.scheduledJobs || [];
    const workOrders = this.state.workOrders || [];
    const completedHistory = this.state.completedPdHistory || {};

    const activePdMap = new Map();

    scheduledJobs.forEach(job => {
      const woId = job.woId || job.id;
      if (!woId || completedHistory[woId]) return;
      if (!activePdMap.has(woId)) {
        activePdMap.set(woId, {
          woId,
          dwgNo: (job.dwgNo || '').trim() || '-',
          partName: (job.partName || '').trim() || '-',
          qty: job.qty || 1,
          customer: (job.customer || '').trim() || 'General',
          project: (job.project || '').trim() || '-',
          source: 'scheduled'
        });
      }
    });

    workOrders.forEach(wo => {
      const woId = wo.id;
      if (!woId || completedHistory[woId]) return;
      if (!activePdMap.has(woId)) {
        activePdMap.set(woId, {
          woId,
          dwgNo: (wo.dwgNo || '').trim() || '-',
          partName: (wo.partName || '').trim() || '-',
          qty: wo.qty || 1,
          customer: (wo.customer || '').trim() || 'General',
          project: (wo.project || '').trim() || '-',
          source: 'backlog'
        });
      }
    });

    // 3. Find matching active PDs that have warehouse delivery in QC Log
    const matchingPds = [];
    for (const [woId, pdData] of activePdMap.entries()) {
      const upperWoId = woId.toUpperCase();
      if (qcDeliveredMap.has(upperWoId)) {
        const qc = qcDeliveredMap.get(upperWoId);
        matchingPds.push({
          ...pdData,
          qcAction: qc.action,
          qcDate: qc.checkDate || '-',
          qcInspector: qc.inspector || '-'
        });
      }
    }

    matchingPds.sort((a, b) => a.woId.localeCompare(b.woId, undefined, { numeric: true, sensitivity: 'base' }));

    this.showResultsModal(matchingPds, qcDeliveredMap.size);
  }

  showResultsModal(matchingPds, totalQcDeliveredCount) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay qc-check-modal-overlay';
    modal.style.zIndex = '400';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    const hasMatches = matchingPds.length > 0;

    modal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 920px; width: 95%; max-height: 90vh; display: flex; flex-direction: column; padding: 22px; box-shadow: 0 20px 50px rgba(0,0,0,0.7); border: 1px solid var(--border-glass); border-radius: 14px;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 12px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 20px;">🔍</span>
            <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: var(--accent-teal); letter-spacing: 0.5px;">
              ผลการตรวจสอบกับ QC Log
            </h3>
            <span style="font-size: 11px; background: rgba(34, 197, 94, 0.12); border: 1px solid var(--accent-green, #22c55e); color: var(--accent-green, #22c55e); padding: 2px 8px; border-radius: 12px; font-weight: 600;">
              Google Sheets Live
            </span>
          </div>
          <button id="btn-close-qc-modal-x" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 4px;" title="ปิด (Close)">
            ✕
          </button>
        </div>

        <!-- Summary Banner -->
        <div style="background: ${hasMatches ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(15, 23, 42, 0.8))' : 'linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(15, 23, 42, 0.8))'}; border: 1.5px solid ${hasMatches ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)'}; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 700; color: ${hasMatches ? '#f87171' : 'var(--accent-green, #22c55e)'}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            ${hasMatches ? '⚠️ พบ Production Order ที่ผลิตเสร็จแล้วยังค้างอยู่บนผังการผลิต' : '✅ ข้อมูลบนผังการผลิตเป็นปัจจุบันแล้ว'}
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
            • ตรวจพบใน QC Log ที่มีสถานะ <strong>ส่งเข้าคลัง PRD / SEMI</strong> ทั้งหมด: <span style="color: var(--accent-teal); font-weight: bold;">${totalQcDeliveredCount.toLocaleString()}</span> รายการ<br>
            • พบ Production Order ที่ <strong>ยังค้างอยู่บนผังการผลิต (ยังไม่ได้ปิด)</strong>: <span style="color: ${hasMatches ? '#f87171' : 'var(--accent-green, #22c55e)'}; font-weight: bold; font-size: 13px;">${matchingPds.length}</span> รายการ
          </div>
        </div>

        ${hasMatches ? `
          <div style="font-size: 12px; color: var(--text-primary); margin-bottom: 8px; font-weight: 600;">
            รายการ Production Order ที่จะทำการปิดและลบออกจากผังการผลิต (${matchingPds.length} รายการ):
          </div>
          <!-- Table -->
          <div style="flex: 1; overflow-y: auto; border: 1px solid var(--border-glass); border-radius: 8px; background: rgba(0,0,0,0.25); min-height: 200px; max-height: 380px;">
            <table class="pd-order-list-table" style="width: 100%; font-size: 11.5px;">
              <thead>
                <tr>
                  <th style="width: 16%;">PD No.</th>
                  <th style="width: 18%;">DWG No.</th>
                  <th style="width: 24%;">Part Name</th>
                  <th style="width: 8%; text-align: center;">QTY</th>
                  <th style="width: 16%;">สถานะใน QC Log</th>
                  <th style="width: 10%;">วันที่ตรวจ</th>
                  <th style="width: 8%;">ผู้ตรวจ</th>
                </tr>
              </thead>
              <tbody>
                ${matchingPds.map(item => `
                  <tr>
                    <td style="font-family: monospace; font-weight: 700; color: var(--accent-teal);">${item.woId}</td>
                    <td style="font-family: monospace; color: var(--text-secondary);">${item.dwgNo}</td>
                    <td style="font-weight: 500; color: var(--text-primary);">${item.partName}</td>
                    <td style="text-align: center; font-weight: 700;">${item.qty}</td>
                    <td>
                      <span style="display: inline-block; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); color: #4ade80; padding: 2px 7px; border-radius: 4px; font-weight: 600; font-size: 10.5px;">
                        ${item.qcAction}
                      </span>
                    </td>
                    <td style="color: var(--text-secondary);">${item.qcDate}</td>
                    <td style="color: var(--text-secondary);">${item.qcInspector}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary); font-size: 13px;">
            🎉 ยอดเยี่ยม! ไม่พบรายการ PD ที่ส่งเข้าคลังแล้วหลงเหลืออยู่บน Gantt Board หรือ Backlog ในขณะนี้
          </div>
        `}

        <!-- Footer Actions -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-glass); padding-top: 14px; margin-top: 16px;">
          <div style="font-size: 11px; color: var(--text-secondary);">
            💡 สามารถกด Undo (เลิกทำ) ที่แถบเครื่องมือด้านบนได้หากต้องการย้อนคืนการลบ
          </div>
          <div style="display: flex; gap: 10px;">
            ${hasMatches ? `
              <button id="btn-confirm-close-pds" class="btn" style="background: linear-gradient(135deg, #dc2626, #b91c1c); color: #fff; border: 1px solid #ef4444; padding: 7px 18px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.35);">
                🗑️ ปิดและลบ PD ที่เสร็จแล้ว (${matchingPds.length} รายการ)
              </button>
            ` : ''}
            <button id="btn-close-qc-modal" class="btn btn-secondary" style="background: rgba(255,255,255,0.08); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 7px 18px; border-radius: 6px; font-size: 12px; cursor: pointer;">
              ${hasMatches ? 'ยกเลิก' : 'ตกลง'}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
      document.removeEventListener('keydown', handleEsc);
      modal.remove();
    };

    const handleEsc = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleEsc);

    modal.querySelector('#btn-close-qc-modal-x')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-close-qc-modal')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Confirm close listener
    modal.querySelector('#btn-confirm-close-pds')?.addEventListener('click', () => {
      const pdIdsToRemove = matchingPds.map(p => p.woId);
      this.state.markPdsCompletedAndRemoveBulk(pdIdsToRemove);

      closeModal();
      this.showToast(`✅ ปิดและลบ Production Order ที่ส่งเข้าคลังแล้วเรียบร้อย (${pdIdsToRemove.length} รายการ)`);
    });
  }

  showErrorModal(errorMessage) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.zIndex = '400';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    modal.innerHTML = `
      <div class="modal-content card-glass" style="max-width: 520px; width: 90%; padding: 22px; border-radius: 12px; border: 1px solid var(--border-glass);">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
          <span style="font-size: 24px;">⚠️</span>
          <h3 style="margin: 0; font-size: 16px; color: var(--accent-red, #f87171); font-weight: 700;">ไม่สามารถดึงข้อมูล QC Log ได้</h3>
        </div>
        <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 16px;">
          ${errorMessage}<br><br>
          กรุณาตรวจสอบว่าสามารถเปิดลิงก์ Google Sheet ด้านล่างนี้ได้หรือไม่:<br>
          <a href="https://docs.google.com/spreadsheets/d/1w8B0DyG7PEy_YLHM5HCI_eVU_nt4HvA8xHWShuLRL_8/edit?gid=1814251242" target="_blank" style="color: var(--accent-teal); word-break: break-all;">
            https://docs.google.com/spreadsheets/d/1w8B0DyG7PEy_YLHM5HCI_eVU_nt4HvA8xHWShuLRL_8/
          </a>
        </div>
        <div style="text-align: right;">
          <button id="btn-close-error-modal" class="btn btn-secondary" style="background: rgba(255,255,255,0.08); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 6px 18px; border-radius: 6px; font-size: 12px; cursor: pointer;">
            ปิด
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector('#btn-close-error-modal')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast card-glass';
    toast.style.position = 'fixed';
    toast.style.bottom = '25px';
    toast.style.right = '25px';
    toast.style.zIndex = '500';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.border = '1px solid var(--accent-green, #22c55e)';
    toast.style.background = 'rgba(15, 23, 42, 0.9)';
    toast.style.color = '#fff';
    toast.style.fontSize = '12.5px';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    toast.style.transition = 'opacity 0.3s ease';
    toast.textContent = message;

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}
