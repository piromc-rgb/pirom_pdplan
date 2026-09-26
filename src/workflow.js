// MIE Trak Pro - Production Order Backlog Controller
import { getPriorityWeight } from './scheduler.js';

export class WorkflowController {
  constructor(state) {
    this.state = state;
    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.backlogList = document.getElementById('backlog-list');
    this.btnAddPD = document.getElementById('btn-add-pd');
    this.btnClearBacklog = document.getElementById('btn-clear-backlog');
    this.btnImportExcel = document.getElementById('btn-import-excel');
    
    // Add PD Modal elements
    this.addPDModal = document.getElementById('add-pd-modal');
    this.btnCloseAddPD = document.getElementById('btn-close-add-pd');
    this.btnCancelAddPD = document.getElementById('btn-cancel-add-pd');
    this.btnConfirmSavePD = document.getElementById('btn-confirm-save-pd');
    this.btnAddPDStep = document.getElementById('btn-add-pd-step');
    this.pdStepsListContainer = document.getElementById('pd-steps-list-container');
    
    this.newPDId = document.getElementById('new-pd-id');
    this.newPDDwgNo = document.getElementById('new-pd-dwgno');
    this.newPDCustomer = document.getElementById('new-pd-customer');
    this.newPDProjectManual = document.getElementById('new-pd-project-manual');
    this.newPDPartName = document.getElementById('new-pd-partname');
    this.newPDQty = document.getElementById('new-pd-qty');
    this.newPDPriority = document.getElementById('new-pd-priority');
    this.newPDDueDate = document.getElementById('new-pd-duedate');
    
    // Import Excel Modal elements
    this.importExcelModal = document.getElementById('import-excel-modal');
    this.btnCloseImportExcel = document.getElementById('btn-close-import-excel');
    this.btnCancelImportExcel = document.getElementById('btn-cancel-import-excel');
    this.btnConfirmImportExcel = document.getElementById('btn-confirm-import-excel');

    // Import Excel Report Modal elements
    this.importExcelReportModal = document.getElementById('import-excel-report-modal');
    this.importExcelReportBody = document.getElementById('import-excel-report-body');
    this.btnCloseImportExcelReport = document.getElementById('btn-close-import-excel-report');
    this.btnCloseImportExcelReportFooter = document.getElementById('btn-close-import-excel-report-footer');
  }

  bindEvents() {
    if (this.btnAddPD) {
      this.btnAddPD.addEventListener('click', () => this.openAddPDModal());
    }
    if (this.btnClearBacklog) {
      this.btnClearBacklog.addEventListener('click', () => this.clearBacklog());
    }
    if (this.btnImportExcel) {
      this.btnImportExcel.addEventListener('click', () => this.openImportExcelModal());
    }
    if (this.btnCloseAddPD) this.btnCloseAddPD.addEventListener('click', () => this.closeAddPDModal());
    if (this.btnCancelAddPD) this.btnCancelAddPD.addEventListener('click', () => this.closeAddPDModal());
    if (this.btnConfirmSavePD) this.btnConfirmSavePD.addEventListener('click', () => this.saveNewPD());

    if (this.btnCloseImportExcel) this.btnCloseImportExcel.addEventListener('click', () => this.closeImportExcelModal());
    if (this.btnCancelImportExcel) this.btnCancelImportExcel.addEventListener('click', () => this.closeImportExcelModal());
    if (this.btnConfirmImportExcel) this.btnConfirmImportExcel.addEventListener('click', () => this.importExcelPD());

    const closeImportReport = () => this.importExcelReportModal?.classList.add('hidden');
    if (this.btnCloseImportExcelReport) this.btnCloseImportExcelReport.addEventListener('click', closeImportReport);
    if (this.btnCloseImportExcelReportFooter) this.btnCloseImportExcelReportFooter.addEventListener('click', closeImportReport);

    const btnCustomChoose = document.getElementById('btn-custom-choose-file');
    const fileInput = document.getElementById('new-pd-excel-file');
    const customFileName = document.getElementById('custom-file-name');

    if (btnCustomChoose && fileInput) {
      btnCustomChoose.addEventListener('click', (e) => {
        e.preventDefault();
        fileInput.click();
      });
    }

    if (fileInput && customFileName) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        customFileName.textContent = file ? file.name : 'No file chosen';
      });
    }

    if (this.btnAddPDStep) {
      this.btnAddPDStep.addEventListener('click', () => this.addStepRow());
    }
    if (this.newPDQty) {
      this.newPDQty.addEventListener('input', () => {
        const rows = this.pdStepsListContainer.querySelectorAll('.pd-step-row');
        rows.forEach(row => {
          const qty = parseFloat(this.newPDQty.value) || 0;
          const cyc = parseFloat(row.querySelector('.step-cycle-input').value) || 0;
          const setup = parseFloat(row.querySelector('.step-setup-input').value) || 0;
          const totalHours = (setup + qty * cyc) / 60.0;
          row.querySelector('.step-total-display').textContent = totalHours.toFixed(2) + ' h';
        });
      });
    }
  }

  clearBacklog() {
    if (this.state.workOrders.length === 0) {
      alert('ไม่มี Production Order ใน backlog ให้ลบ / Backlog is already empty.');
      return;
    }
    const confirmDelete = confirm('คุณต้องการลบ Production Order ทั้งหมดใน Backlog ใช่หรือไม่?\nAre you sure you want to delete all Production Orders in the Backlog?');
    if (confirmDelete) {
      this.state.saveStateToHistory();
      this.state.workOrders = [];
      this.state.notify();
      this.state.dispatchHistoryEvent();
    }
  }

  openAddPDModal() {
    // Generate next PD ID
    let maxId = 300;
    this.state.workOrders.forEach(wo => {
      const num = parseInt(wo.id.replace('PD', '')) || 0;
      if (num > maxId) maxId = num;
    });
    this.state.scheduledJobs.forEach(job => {
      const woId = job.woId || job.id;
      const num = parseInt(woId.replace('PD', '')) || 0;
      if (num > maxId) maxId = num;
    });
    this.newPDId.value = `PD0000${maxId + 1}`;
    if (this.newPDDwgNo) this.newPDDwgNo.value = '';
    this.newPDCustomer.value = '';
    this.newPDPartName.value = '';
    this.newPDQty.value = 100;
    this.newPDPriority.value = 'Normal';
    
    // Default target date is empty (not specified, system will calculate)
    this.newPDDueDate.value = '';
    
    // Clear steps and add first default step (DEA012)
    this.pdStepsListContainer.innerHTML = '';
    this.nextStepNum = 10;
    this.addStepRow(10, 'DEA012', 'Laser Cut out', 1.5, 30);
    
    this.addPDModal.classList.remove('hidden');
  }

  closeAddPDModal() {
    this.addPDModal.classList.add('hidden');
  }

  addStepRow(stepNum = null, machine = '', name = '', cycleMinutes = 1.0, setupMinutes = 0.0) {
    const sNum = stepNum || this.nextStepNum;
    this.nextStepNum = sNum + 10;
    
    const row = document.createElement('div');
    row.className = 'pd-step-row';
    row.style = 'display: grid; grid-template-columns: 50px 220px 80px 110px 80px 30px; gap: 8px; align-items: center; margin-bottom: 8px;';
    
    const optionsHtml = this.state.workCenterOrder.map(wc => {
      const nameOnly = this.state.workCenters[wc]?.name || wc;
      return `<option value="${wc}" ${wc === machine ? 'selected' : ''}>${nameOnly}</option>`;
    }).join('');
    
    row.innerHTML = `
      <span style="font-size: 10px; font-weight: bold; color: var(--text-secondary); text-align: center;">Step ${sNum}</span>
      <select class="step-machine-select" style="background-color: var(--bg-darkest); color: #000000; border: 1px solid var(--border-glass); padding: 5px; border-radius: 6px; font-size: 10px; outline: none; cursor: pointer; font-weight: 600; width: 100%;">
        ${optionsHtml}
      </select>
      <input type="number" class="step-setup-input" value="${setupMinutes}" min="0" step="1" title="Setup Time (minutes)" placeholder="Setup (Min)" style="background-color: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 5px; border-radius: 6px; font-size: 10px; outline: none; text-align: center;">
      <input type="number" class="step-cycle-input" value="${cycleMinutes}" min="0.01" step="0.01" title="Cycle Time (minutes per piece)" placeholder="Cycle (Min)" style="background-color: var(--bg-darkest); color: var(--text-primary); border: 1px solid var(--border-glass); padding: 5px; border-radius: 6px; font-size: 10px; outline: none; text-align: center;">
      <span class="step-total-display" style="font-size: 10px; font-weight: bold; color: var(--accent-teal); text-align: center;">0.00 h</span>
      <button type="button" class="btn-remove-step" style="background: none; border: none; color: var(--accent-red); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold;">&times;</button>
    `;
    
    row.querySelector('.btn-remove-step').addEventListener('click', () => {
      row.remove();
    });
    
    const updateCalculatedHours = () => {
      const qty = parseFloat(document.getElementById('new-pd-qty').value) || 0;
      const cyc = parseFloat(row.querySelector('.step-cycle-input').value) || 0;
      const setup = parseFloat(row.querySelector('.step-setup-input').value) || 0;
      const totalHours = (setup + qty * cyc) / 60.0;
      row.querySelector('.step-total-display').textContent = totalHours.toFixed(2) + ' h';
    };
    
    row.querySelector('.step-cycle-input').addEventListener('input', updateCalculatedHours);
    row.querySelector('.step-setup-input').addEventListener('input', updateCalculatedHours);
    
    this.pdStepsListContainer.appendChild(row);
    updateCalculatedHours();
  }

  saveNewPD() {
    const pdId = this.newPDId.value.trim();
    const customer = this.newPDCustomer.value.trim() || 'Walk-in';
    const project = this.newPDProjectManual ? this.newPDProjectManual.value.trim() || 'General' : 'General';
    const partName = this.newPDPartName.value.trim();
    const qty = parseInt(this.newPDQty.value) || 100;
    const priority = this.newPDPriority ? this.newPDPriority.value.trim() || 'Normal' : 'Normal';
    const dueDateVal = this.newPDDueDate ? this.newPDDueDate.value : '';
    
    if (!pdId) {
      alert('กรุณากรอกเลขที่ PD');
      return;
    }
    if (!partName) {
      alert('กรุณากรอก Part Name');
      return;
    }
    
    const stepRows = this.pdStepsListContainer.querySelectorAll('.pd-step-row');
    if (stepRows.length === 0) {
      alert('กรุณาเพิ่มขั้นตอนการผลิตอย่างน้อย 1 ขั้นตอน');
      return;
    }
    
    // Calculate dueHour from duedate
    let dueHour = null;
    if (dueDateVal) {
      const [y, m, d] = dueDateVal.split('-').map(Number);
      const dDue = new Date(y, m - 1, d, 17, 0, 0); // 17:00 deadline
      dueHour = this.state.dateToWorkingHour(dDue);
    }
    
    const stepsList = [];
    stepRows.forEach((row, idx) => {
      const sNum = (idx + 1) * 10;
      const machine = row.querySelector('.step-machine-select').value;
      const name = this.state.workCenters[machine]?.name || machine;
      const cycleMinutes = parseFloat(row.querySelector('.step-cycle-input').value) || 1.0;
      const setupMinutes = parseFloat(row.querySelector('.step-setup-input').value) || 0.0;
      const cap = this.state.workCenters[machine]?.capacity || 1;
      const estHours = parseFloat(((setupMinutes + qty * cycleMinutes) / 60.0 / cap).toFixed(4)) || 1.0;
      
      stepsList.push({
        id: `${pdId}-${sNum}`,
        stepNum: sNum,
        name: name,
        machine: machine,
        cycleMinutes: cycleMinutes,
        setupMinutes: setupMinutes,
        estHours: estHours,
        status: 'Unscheduled',
        startHour: null
      });
    });
    
    const dwgNo = this.newPDDwgNo ? this.newPDDwgNo.value.trim() : '';
    
    const newWO = {
      id: pdId,
      customer: customer,
      project: project,
      dwgNo: dwgNo,
      partName: partName,
      qty: qty,
      priority: priority,
      status: 'Unscheduled',
      delayReason: '',
      dueHour: dueHour,
      steps: stepsList
    };
    
    this.state.workOrders.push(newWO);
    this.state.notify();
    this.closeAddPDModal();
  }

  render() {
    // Update the backlog count in the header title - unless the sidebar is
    // currently showing the Assembly Set list instead (main.js owns that title then).
    const backlogTitle = document.getElementById('backlog-header-title');
    const assemblyListTabContent = document.getElementById('assembly-list-tab-content');
    const showingAssemblyList = assemblyListTabContent && !assemblyListTabContent.classList.contains('hidden');
    if (backlogTitle && !showingAssemblyList) {
      backlogTitle.textContent = `PD BACKLOG (${this.state.workOrders.length})`;
    }

    this.backlogList.innerHTML = '';
    if (this.state.workOrders.length === 0) {
      this.backlogList.innerHTML = '<div class="empty-list-hint">Backlog empty. All steps scheduled.</div>';
    } else {
      const sortedWOs = [...this.state.workOrders].sort((a, b) => {
        const pA = getPriorityWeight(a.priority);
        const pB = getPriorityWeight(b.priority);
        if (pA !== pB) {
          return pA - pB; // Lower number first (e.g. 1, 1.1, 2, ...)
        }
        return (a.dueHour || 999999) - (b.dueHour || 999999);
      });

      const parentWoIdsNumericSet = new Set();
      this.state.workOrders.forEach(w => {
        const m = w.id.match(/^(.*)-(\d+)$/);
        if (m) parentWoIdsNumericSet.add(m[1]);
      });
      (this.state.scheduledJobs || []).forEach(j => {
        if (j.woId) {
          const m = j.woId.match(/^(.*)-(\d+)$/);
          if (m) parentWoIdsNumericSet.add(m[1]);
        }
      });

      sortedWOs.forEach(wo => {
        const backlogCard = document.createElement('div');
        backlogCard.className = 'backlog-card';
        backlogCard.setAttribute('data-id', wo.id);
        backlogCard.setAttribute('draggable', 'true');
        
        let stepsHtml = '';
        wo.steps.forEach(step => {
          const setupText = step.setupMinutes ? ` | Setup: <strong>${step.setupMinutes}m</strong>` : '';
          const cycleText = step.cycleMinutes ? ` | Cycle: <strong>${step.cycleMinutes}m/pc</strong>` : '';
          stepsHtml += `
            <div class="backlog-step-item" draggable="true" data-id="${step.id}" title="Drag this operation onto the timeline">
              <div class="step-badge">[${step.stepNum}]</div>
              <div class="step-name-text">${step.name}</div>
              <div class="step-meta-text">${this.state.getMachineDisplayName(step.machine)} - Total: <strong>${step.estHours}h</strong>${setupText}${cycleText}</div>
            </div>
          `;
        });

        const childMatch = wo.id.match(/^(.*)-(\d+)$/);
        const isChild = !!childMatch;
        const isParent = parentWoIdsNumericSet.has(wo.id);

        let indicatorHtml = '';
        if (isParent) {
          indicatorHtml = `<span class="pd-relation-indicator parent" title="Parent (แม่)">M</span>`;
        } else if (isChild) {
          indicatorHtml = `<span class="pd-relation-indicator child" title="Child (ลูก) ของ ${childMatch[1]}">C</span>`;
        }

        const scaledDue = this.state.getScaledDueHour(wo);
        const dueTimeStr = scaledDue !== null ? this.formatDateOnly(scaledDue, this.state.activeScale) : 'ระบบวางแผนหาให้';
        const targetColor = scaledDue !== null ? 'var(--accent-red)' : 'var(--text-secondary)';

        backlogCard.innerHTML = `
          <div class="card-top" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="card-id" style="cursor: pointer;" title="คลิกเพื่อแก้ไขข้อมูล Production Order นี้">${wo.id}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${indicatorHtml}
              <button class="btn-edit-pd" data-id="${wo.id}" title="แก้ไขข้อมูล Production Order นี้" style="background: none; border: none; color: var(--accent-teal); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; font-size: 11px; transition: opacity 0.2s;">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-teal);">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button class="btn-delete-pd" data-id="${wo.id}" title="ลบใบสั่งผลิตนี้" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; transition: color 0.2s;">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-trash" style="color: var(--accent-red); filter: drop-shadow(0 0 2px rgba(255, 51, 51, 0.25));">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <span class="priority-badge ${wo.priority.toLowerCase()}">${wo.priority}</span>
            </div>
          </div>
          <div class="card-part">${wo.partName} ${wo.dwgNo ? `<span style="font-size: 8.5px; color: var(--accent-teal); font-weight: 500; display: block; margin-top: 2px;">DWG: ${wo.dwgNo}</span>` : ''}</div>
          <div class="card-details" style="margin-bottom: 4px;">
            <span>Customer: <strong>${wo.customer}</strong></span>
            <span>Project: <strong>${wo.project || 'General'}</strong></span>
          </div>
          <div class="card-details" style="margin-bottom: 4px;">
            <span>Qty: <strong>${wo.qty}</strong></span>
          </div>
          <div class="card-details delivery-target-container" style="margin-bottom: 8px; color: ${targetColor}; font-size: 9px; font-weight: 600; cursor: pointer;" title="Double-click to edit target date">
            <span>Delivery Target: <strong class="delivery-target-text">${dueTimeStr}</strong></span>
          </div>
          <div class="backlog-steps-container" style="margin-bottom: 8px;">
            <div style="font-size: 8px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Routing Steps:</div>
            ${stepsHtml}
          </div>
          <div class="card-details" style="margin-top: 8px; width: 100%;">
            <button class="btn-simulate-pd" data-id="${wo.id}" style="width: 100%; padding: 6px; font-size: 10px; background: rgba(0, 242, 254, 0.1); border: 1px solid var(--accent-teal); color: var(--accent-teal); border-radius: 6px; font-weight: bold; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 4px;">
              <span>⚡ Simulate Placement</span>
            </button>
          </div>
        `;

        // Bind Edit button click and card ID click
        const btnEdit = backlogCard.querySelector('.btn-edit-pd');
        if (btnEdit) {
          btnEdit.addEventListener('click', (e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-pd-modal', { detail: { woId: wo.id } }));
          });
        }
        const cardIdEl = backlogCard.querySelector('.card-id');
        if (cardIdEl) {
          cardIdEl.addEventListener('click', (e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-pd-modal', { detail: { woId: wo.id } }));
          });
        }

        // Bind Delete button click
        backlogCard.querySelector('.btn-delete-pd').addEventListener('click', (e) => {
          e.stopPropagation();
          const childPds = typeof this.state.getDescendantPdIds === 'function' ? this.state.getDescendantPdIds(wo.id) : [];
          const confirmMsg = childPds.length > 0
            ? `คุณต้องการลบ Production Order: ${wo.id} พร้อม PD ลูกทั้งหมดอีก ${childPds.length} รายการ (${childPds.slice(0, 10).join(', ')}${childPds.length > 10 ? '...' : ''}) ออกจากระบบใช่หรือไม่?`
            : `คุณต้องการลบ Production Order: ${wo.id} ออกจาก Backlog ใช่หรือไม่?`;
          if (confirm(confirmMsg)) {
            this.state.deleteProductionOrder(wo.id);
          }
        });

        // Bind Simulate button click
        backlogCard.querySelector('.btn-simulate-pd').addEventListener('click', (e) => {
          e.stopPropagation();
          this.runPDSimulation(wo.id);
        });

        const targetContainer = backlogCard.querySelector('.delivery-target-container');
        if (targetContainer) {
          targetContainer.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (targetContainer.querySelector('input')) return;

            const currentDateVal = this.state.workingHourToDate(scaledDue);
            const yyyy = currentDateVal.getFullYear();
            const mm = (currentDateVal.getMonth() + 1).toString().padStart(2, '0');
            const dd = currentDateVal.getDate().toString().padStart(2, '0');
            const dateString = `${yyyy}-${mm}-${dd}`;

            targetContainer.innerHTML = `
              <span style="display: flex; align-items: center; gap: 4px; width: 100%; color: #3b82f6;">
                Target: 
                <input type="date" class="edit-due-date-input" value="${dateString}" style="background: var(--bg-darkest); border: 1px solid #3b82f6; color: #3b82f6; font-size: 9px; padding: 2px; border-radius: 3px; font-family: monospace; flex: 1; outline: none; width: 80px;" />
                <button class="btn-save-due-date" style="background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; color: #3b82f6; padding: 2px 4px; border-radius: 3px; cursor: pointer; font-size: 8px; font-weight: bold; line-height: 1;">✓</button>
                <button class="btn-cancel-due-date" style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.3); color: #fff; padding: 2px 4px; border-radius: 3px; cursor: pointer; font-size: 8px; font-weight: bold; line-height: 1;">✕</button>
              </span>
            `;

            const input = targetContainer.querySelector('.edit-due-date-input');
            const btnSave = targetContainer.querySelector('.btn-save-due-date');
            const btnCancel = targetContainer.querySelector('.btn-cancel-due-date');

            input.focus();

            const saveChanges = () => {
              const newDateVal = input.value;
              if (newDateVal) {
                const [y, m, d] = newDateVal.split('-').map(Number);
                const newDate = new Date(y, m - 1, d, 17, 0, 0); // 17:00 deadline
                const newDueHour = this.state.dateToWorkingHour(newDate);
                this.state.updateWorkOrderDueHour(wo.id, newDueHour);
              } else {
                this.render();
              }
            };

            const cancelChanges = () => {
              this.render();
            };

            btnSave.addEventListener('click', (ev) => {
              ev.stopPropagation();
              saveChanges();
            });

            btnCancel.addEventListener('click', (ev) => {
              ev.stopPropagation();
              cancelChanges();
            });

            input.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter') {
                ev.stopPropagation();
                saveChanges();
              } else if (ev.key === 'Escape') {
                ev.stopPropagation();
                cancelChanges();
              }
            });
          });
        }

        // Bind drag events to the entire backlog Work Order card
        backlogCard.addEventListener('dragstart', (e) => {
          // If the drag originated from a step item, let the step item's listener handle it
          if (e.target.classList.contains('backlog-step-item') || e.target.closest('.backlog-step-item')) {
            return;
          }
          e.dataTransfer.setData('text/plain', wo.id);
          e.dataTransfer.effectAllowed = 'move';
          backlogCard.style.opacity = '0.4';
          backlogCard.style.borderColor = 'var(--accent-teal)';
        });

        backlogCard.addEventListener('dragend', () => {
          backlogCard.style.opacity = '1';
          backlogCard.style.borderColor = '';
        });

        // Bind drag events to each individual routing step item
        backlogCard.querySelectorAll('.backlog-step-item').forEach(stepItem => {
          const stepId = stepItem.getAttribute('data-id');
          
          stepItem.addEventListener('dragstart', (e) => {
            e.stopPropagation(); // Prevent triggering the parent backlogCard drag
            e.dataTransfer.setData('text/plain', stepId);
            e.dataTransfer.effectAllowed = 'move';
            stepItem.style.opacity = '0.4';
            stepItem.style.borderColor = 'var(--accent-teal)';
          });

          stepItem.addEventListener('dragend', (e) => {
            e.stopPropagation();
            stepItem.style.opacity = '1';
            stepItem.style.borderColor = '';
          });
        });

        this.backlogList.appendChild(backlogCard);
      });
    }
  }

  runPDSimulation(woId) {
    const wo = this.state.workOrders.find(w => w.id === woId);
    if (!wo) return;

    // Parent-Child identification
    const childMatch = woId.match(/^(.*)-(\d+)$/);
    const isChild = !!childMatch;

    // 1. Revert previous simulation if active
    if (this.simulationBackup) {
      this.state.scheduledJobs = this.simulationBackup.scheduledJobs;
      this.state.workOrders = this.simulationBackup.workOrders;
      this.simulationBackup = null;
    }

    // 2. Save backup of the current state
    this.simulationBackup = {
      scheduledJobs: JSON.parse(JSON.stringify(this.state.scheduledJobs)),
      workOrders: JSON.parse(JSON.stringify(this.state.workOrders))
    };

    // 3. Find parent and children to simulate
    let wosToSimulate = [];
    let childWos = [];
    
    if (!isChild) {
      // This is a parent. Find all its children in backlog
      childWos = this.state.workOrders.filter(w => {
        const m = w.id.match(/^(.*)-(\d+)$/);
        return m && m[1] === woId;
      });
      // We will simulate all backlog children first, then the parent
      wosToSimulate = [...childWos, wo];
    } else {
      // Just simulate this child
      wosToSimulate = [wo];
    }

    const woIdsToSimulate = wosToSimulate.map(w => w.id);

    // Remove all WOs being simulated from the backlog temporarily
    this.state.workOrders = this.state.workOrders.filter(w => !woIdsToSimulate.includes(w.id));

    // 4. Find earliest free slots sequentially starting from current time
    const now = new Date();
    const currentBaseHour = Math.max(0, this.state.dateToWorkingHour(now));

    const findEarliestFreeSlot = (machineName, minStartHour, estHours, scheduledJobs) => {
      let start = minStartHour;
      const machineJobs = scheduledJobs
        .filter(j => j.machine === machineName)
        .sort((a, b) => a.startHour - b.startHour);
        
      while (true) {
        let overlapFound = false;
        const end = start + estHours;
        
        for (const job of machineJobs) {
          const jobEnd = job.startHour + job.estHours;
          if (start < jobEnd && end > job.startHour) {
            start = jobEnd;
            overlapFound = true;
            break;
          }
        }
        
        if (!overlapFound) {
          break;
        }
      }
      return start;
    };

    const simulatedSteps = [];
    let lastFinishHour = currentBaseHour;

    if (!isChild) {
      // Simulate child WOs first
      const childEndHours = [];

      childWos.forEach(cWo => {
        const pdSteps = [...cWo.steps].sort((a, b) => a.stepNum - b.stepNum);
        let currentChildFinishHour = currentBaseHour;

        pdSteps.forEach(step => {
          const startHour = findEarliestFreeSlot(step.machine, currentChildFinishHour, step.estHours, [
            ...this.state.scheduledJobs,
            ...simulatedSteps
          ]);
          const finishHour = startHour + step.estHours;

          const scheduledStep = {
            id: step.id,
            woId: cWo.id,
            customer: cWo.customer,
            partName: cWo.partName,
            qty: cWo.qty,
            priority: cWo.priority,
            stepNum: step.stepNum,
            stepName: step.name,
            machine: step.machine,
            estHours: step.estHours,
            startHour: parseFloat(startHour.toFixed(1)),
            status: 'Scheduled',
            dueHour: cWo.dueHour,
            originalDueHour: cWo.originalDueHour !== undefined ? cWo.originalDueHour : cWo.dueHour
          };

          simulatedSteps.push(scheduledStep);
          currentChildFinishHour = finishHour;
        });
        childEndHours.push(currentChildFinishHour);
      });

      // Find if there are other scheduled children on the board
      const scheduledChildren = this.state.scheduledJobs.filter(j => {
        const m = j.woId.match(/^(.*)-(\d+)$/);
        return m && m[1] === woId;
      });
      scheduledChildren.forEach(sc => {
        childEndHours.push(sc.startHour + sc.estHours);
      });

      // Parent starts after all children complete
      let parentStartHour = currentBaseHour;
      if (childEndHours.length > 0) {
        parentStartHour = Math.max(parentStartHour, ...childEndHours);
      }

      // Simulate parent WO
      const pdSteps = [...wo.steps].sort((a, b) => a.stepNum - b.stepNum);
      let currentParentFinishHour = parentStartHour;

      pdSteps.forEach(step => {
        const startHour = findEarliestFreeSlot(step.machine, currentParentFinishHour, step.estHours, [
          ...this.state.scheduledJobs,
          ...simulatedSteps
        ]);
        const finishHour = startHour + step.estHours;

        const scheduledStep = {
          id: step.id,
          woId: wo.id,
          customer: wo.customer,
          partName: wo.partName,
          qty: wo.qty,
          priority: wo.priority,
          memo: wo.memo || (this.state?.pdMemos ? this.state.pdMemos[wo.id] : '') || '',
          stepNum: step.stepNum,
          stepName: step.name,
          machine: step.machine,
          estHours: step.estHours,
          startHour: parseFloat(startHour.toFixed(1)),
          status: 'Scheduled',
          dueHour: wo.dueHour,
          originalDueHour: wo.originalDueHour !== undefined ? wo.originalDueHour : wo.dueHour
        };

        simulatedSteps.push(scheduledStep);
        currentParentFinishHour = finishHour;
      });

      lastFinishHour = currentParentFinishHour;

    } else {
      // Just simulate this child
      const pdSteps = [...wo.steps].sort((a, b) => a.stepNum - b.stepNum);
      let currentChildFinishHour = currentBaseHour;

      pdSteps.forEach(step => {
        const startHour = findEarliestFreeSlot(step.machine, currentChildFinishHour, step.estHours, [
          ...this.state.scheduledJobs,
          ...simulatedSteps
        ]);
        const finishHour = startHour + step.estHours;

        const scheduledStep = {
          id: step.id,
          woId: wo.id,
          customer: wo.customer,
          partName: wo.partName,
          qty: wo.qty,
          priority: wo.priority,
          memo: wo.memo || (this.state?.pdMemos ? this.state.pdMemos[wo.id] : '') || '',
          stepNum: step.stepNum,
          stepName: step.name,
          machine: step.machine,
          estHours: step.estHours,
          startHour: parseFloat(startHour.toFixed(1)),
          status: 'Scheduled',
          dueHour: wo.dueHour,
          originalDueHour: wo.originalDueHour !== undefined ? wo.originalDueHour : wo.dueHour
        };

        simulatedSteps.push(scheduledStep);
        currentChildFinishHour = finishHour;
      });

      lastFinishHour = currentChildFinishHour;
    }

    // Add all simulated steps to scheduledJobs temporarily
    this.state.scheduledJobs = [...this.state.scheduledJobs, ...simulatedSteps];

    // 5. Update UI so the user can see the simulated tasks on the Gantt chart
    this.state.notify();

    // 6. Format completion date and time
    const finalFinishDate = this.state.workingHourToDate(lastFinishHour);
    
    const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const dayLabel = days[finalFinishDate.getDay()];
    const d = finalFinishDate.getDate().toString().padStart(2, '0');
    const m = (finalFinishDate.getMonth() + 1).toString().padStart(2, '0');
    const y = finalFinishDate.getFullYear();
    
    const dateStr = `วัน${dayLabel}ที่ ${d}/${m}/${y}`;
    const timeStr = finalFinishDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    // Format original target date and time (only if a valid target is set)
    const hasOriginalDue = wo.dueHour !== null && wo.dueHour !== undefined && wo.dueHour > 0;
    let originalTargetStr = '';
    let diffText = '';
    let diffColor = 'var(--accent-green)';

    if (hasOriginalDue) {
      const originalDueDate = this.state.workingHourToDate(wo.dueHour);
      const origDayLabel = days[originalDueDate.getDay()];
      const origD = originalDueDate.getDate().toString().padStart(2, '0');
      const origM = (originalDueDate.getMonth() + 1).toString().padStart(2, '0');
      const origY = originalDueDate.getFullYear();
      const origDateStr = `วัน${origDayLabel}ที่ ${origD}/${origM}/${origY}`;
      const origTimeStr = originalDueDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      originalTargetStr = `${origDateStr} เวลา ${origTimeStr} น.`;

      // Calculate diff in calendar time
      const diffMs = finalFinishDate.getTime() - originalDueDate.getTime();
      const isLate = diffMs > 0;
      const absDiffMs = Math.abs(diffMs);
      const totalDiffHours = Math.floor(absDiffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(totalDiffHours / 24);
      const diffHours = totalDiffHours % 24;

      if (isLate) {
        diffText = `ช้ากว่าเป้าที่ต้องการ ${diffDays} วัน ${diffHours} ชั่วโมง`;
        diffColor = 'var(--accent-red)';
      } else {
        diffText = `เร็วกว่าเป้าที่ต้องการ ${diffDays} วัน ${diffHours} ชั่วโมง`;
        diffColor = 'var(--accent-green)';
      }
    } else {
      diffText = 'พร้อมจัดสรรลงแผนงาน';
      diffColor = 'var(--accent-teal)';
    }

    // 7. Show the interactive banner
    this.showSimulationBanner(
      wo.id,
      dateStr,
      timeStr,
      originalTargetStr,
      diffText,
      diffColor,
      () => {
        // Accept: Commit simulation
        // Update the delivery targets of all simulated WOs
        const woEnds = {};
        simulatedSteps.forEach(step => {
          const end = step.startHour + step.estHours;
          if (woEnds[step.woId] === undefined || end > woEnds[step.woId]) {
            woEnds[step.woId] = end;
          }
        });

        Object.keys(woEnds).forEach(simWoId => {
          const finish = woEnds[simWoId];
          const dFinish = this.state.workingHourToDate(finish);
          const nextDay = new Date(dFinish.getFullYear(), dFinish.getMonth(), dFinish.getDate() + 1, 17, 0, 0);
          const newDueHour = this.state.dateToWorkingHour(nextDay);
          this.state.updateWorkOrderDueHour(simWoId, newDueHour);
        });

        // Save files
        this.state.savePlanToFile();
        this.state.saveWorkOrdersToFile();

        this.simulationBackup = null;
        this.state.notify();
        this.state.dispatchHistoryEvent();
      },
      () => {
        // Reject: Restore backup state
        this.state.scheduledJobs = this.simulationBackup.scheduledJobs;
        this.state.workOrders = this.simulationBackup.workOrders;
        this.simulationBackup = null;
        this.state.notify();
      }
    );
  }

  showSimulationBanner(pdId, finishDateStr, finishTimeStr, originalTargetStr, diffText, diffColor, onAccept, onReject) {
    const existing = document.getElementById('simulation-banner');
    if (existing) existing.remove();
    
    const banner = document.createElement('div');
    banner.id = 'simulation-banner';
    banner.style = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 10px 20px;
      border: 1.5px solid var(--accent-teal);
      box-shadow: 0 0 20px rgba(0, 242, 254, 0.4);
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
    `;
    
    const targetInfoHTML = originalTargetStr ? `<span style="color: var(--text-secondary); font-size: 10px;">(Target เดิม: ${originalTargetStr})</span>` : '';

    banner.innerHTML = `
      <span style="font-size: 11px; font-weight: bold; color: #fff; font-family: var(--font-family); display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span>ผลการทดลองวาง <span style="color: var(--accent-teal); font-weight: 800;">${pdId}</span>: ขั้นตอนสุดท้ายจะเสร็จเร็วที่สุดคือ <span style="color: var(--accent-green); font-weight: 800;">${finishDateStr} เวลา ${finishTimeStr} น.</span></span>
        ${targetInfoHTML}
        <span style="color: ${diffColor}; font-weight: 800; font-size: 11px; padding: 2px 6px; background: rgba(255,255,255,0.02); border: 1px solid ${diffColor}; border-radius: 4px;">[${diffText}]</span>
      </span>
      <button id="btn-sim-accept" class="btn btn-glowing" style="background: linear-gradient(135deg, var(--accent-green), #15803d); border: none; color: #fff; padding: 6px 14px; font-size: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 0 10px rgba(22, 163, 74, 0.4); font-family: var(--font-family);">Accept</button>
      <button id="btn-sim-reject" class="btn" style="background: rgba(255, 255, 255, 0.1); border: 1px solid var(--border-glass); color: #fff; padding: 6px 14px; font-size: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; font-family: var(--font-family);">Reject</button>
    `;
    
    banner.querySelector('#btn-sim-accept').addEventListener('click', () => {
      banner.remove();
      onAccept();
    });
    
    banner.querySelector('#btn-sim-reject').addEventListener('click', () => {
      banner.remove();
      onReject();
    });
    
    document.body.appendChild(banner);
  }

  formatTime(hourFloat, scale) {
    if (scale === 'hr') {
      const hours = Math.floor(hourFloat);
      const mins = Math.round((hourFloat - hours) * 60);
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    } else {
      const dayIndex = Math.floor(hourFloat / 24);
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const dayName = days[dayIndex % 7];
      
      const dayHour = hourFloat % 24;
      const hours = Math.floor(dayHour);
      const mins = Math.round((dayHour - hours) * 60);
      const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
      
      if (scale === 'day') {
        return `${dayName} ${timeStr}`;
      } else if (scale === 'week') {
        const weekIndex = Math.floor(dayIndex / 7) + 1;
        return `W${weekIndex}-${dayName} ${timeStr}`;
      } else {
        const monthIndex = Math.floor(dayIndex / 30) + 1;
        const relativeDay = (dayIndex % 30) + 1;
        return `M${monthIndex}-D${relativeDay} ${timeStr}`;
      }
    }
  }

  formatDateOnly(hourFloat, scale) {
    const dObj = this.state.workingHourToDate(hourFloat);
    const d = dObj.getDate();
    const m = dObj.getMonth() + 1;
    const y = dObj.getFullYear();
    const dd = d.toString().padStart(2, '0');
    const mm = m.toString().padStart(2, '0');
    return `${dd}/${mm}/${y}`;
  }

  openExcelDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PDPlanDB', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('ExcelStore')) {
          db.createObjectStore('ExcelStore');
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  saveExcelToDB(filename, arrayBuffer) {
    return this.openExcelDB().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('ExcelStore', 'readwrite');
        const store = transaction.objectStore('ExcelStore');
        store.put(arrayBuffer, 'lastExcelBuffer');
        store.put(filename, 'lastExcelName');
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      });
    });
  }

  loadExcelFileFromDB() {
    return this.openExcelDB().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('ExcelStore', 'readonly');
        const store = transaction.objectStore('ExcelStore');
        const reqBuffer = store.get('lastExcelBuffer');
        const reqName = store.get('lastExcelName');
        
        transaction.oncomplete = () => {
          resolve({
            arrayBuffer: reqBuffer.result,
            filename: reqName.result
          });
        };
        transaction.onerror = (e) => reject(e.target.error);
      });
    });
  }

  openImportExcelModal() {
    if (this.importExcelModal) {
      this.importExcelModal.classList.remove('hidden');
      const fileInput = document.getElementById('new-pd-excel-file');
      if (fileInput) fileInput.value = '';
      const customFileName = document.getElementById('custom-file-name');
      const defaultFilename = this.state.storageSync 
        ? this.state.storageSync.getStatusOverviewFilename() 
        : 'LN Status Overview.xlsx';
      if (customFileName) customFileName.textContent = defaultFilename;
      const rangeInput = document.getElementById('new-pd-excel-range');
      if (rangeInput) rangeInput.value = '';
      const priorityInput = document.getElementById('new-pd-excel-priority');
      if (priorityInput) priorityInput.value = '';

      // Add or update the last file hint label next to the input
      let hintEl = document.getElementById('excel-last-file-hint');
      if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.id = 'excel-last-file-hint';
        hintEl.style.fontSize = '10px';
        hintEl.style.color = 'var(--accent-teal)';
        hintEl.style.marginTop = '4px';
        hintEl.style.fontStyle = 'italic';
        if (fileInput) {
          fileInput.parentNode.appendChild(hintEl);
        }
      }
      
      const checkAvailableFile = async () => {
        if (this.state.storageSync) {
          const overview = await this.state.storageSync.fetchStatusOverview({ silent: true });
          if (overview && overview.filename) {
            if (customFileName) customFileName.textContent = overview.filename;
            const cacheNotice = overview.fromCache 
              ? '<span style="color: var(--accent-teal); font-weight: 600;">⚡ [โหลดทันทีจาก Local Cache]</span>' 
              : '<span style="color: #38bdf8; font-weight: 600;">☁️ [ดึงจาก Cloud/Server]</span>';
            hintEl.innerHTML = `📄 ตรวจพบไฟล์: <strong>${overview.filename}</strong> ${cacheNotice} - ระบบจะดึงไฟล์นี้อัตโนมัติ`;
            return;
          }
        }
        this.loadExcelFileFromDB().then(data => {
          if (data && data.filename) {
            if (customFileName) customFileName.textContent = data.filename;
            hintEl.innerHTML = `ไฟล์ล่าสุดที่เคยใช้: <strong>${data.filename}</strong> <span style="color: var(--accent-teal); font-weight: 600;">⚡ [แคชในเครื่อง]</span> (ระบบจะดึงไฟล์นี้อัตโนมัติหากไม่เลือกไฟล์ใหม่)`;
          } else {
            hintEl.innerHTML = `💡 ไฟล์เริ่มต้น: <strong>${defaultFilename}</strong> (Sheet "data" & "Plan + Mat")`;
          }
        }).catch(() => {
          hintEl.innerHTML = `💡 ไฟล์เริ่มต้น: <strong>${defaultFilename}</strong> (Sheet "data" & "Plan + Mat")`;
        });
      };
      checkAvailableFile();
    }
  }

  closeImportExcelModal() {
    if (this.importExcelModal) {
      this.importExcelModal.classList.add('hidden');
    }
  }

  matchWorkCenter(desc, code = '') {
    const dLower = String(desc || '').toLowerCase().trim();
    const cLower = String(code || '').toLowerCase().trim();

    // 1. Code is the authoritative identifier - try it first, before description text
    // (description text from Excel can be misspelled/abbreviated differently than
    // the configured workCenter name, e.g. missing a word, causing false fallbacks).
    if (cLower && this.state.workCenters[code]) {
      return code;
    }
    if (cLower) {
      for (let wc of this.state.workCenterOrder) {
        if (cLower === wc.toLowerCase()) {
          return wc;
        }
      }
    }

    // 2. Description didn't come with a valid code - try matching it against
    // Work Center display names (e.g. "เลื่อย", "CNC VF4", "TAP", "ปรับแต่ง", "ทำสี")
    if (dLower) {
      for (let wc of this.state.workCenterOrder) {
        const name = (this.state.workCenters[wc]?.name || '').toLowerCase();
        if (name && (dLower === name || dLower.includes(name) || name.includes(dLower))) {
          return wc;
        }
      }
    }

    if (dLower && this.state.workCenters[desc]) {
      return desc;
    }
    if (dLower) {
      for (let wc of this.state.workCenterOrder) {
        if (dLower === wc.toLowerCase()) {
          return wc;
        }
      }
    }

    // 3. Try matching code against Work Center display names
    if (cLower) {
      for (let wc of this.state.workCenterOrder) {
        const name = (this.state.workCenters[wc]?.name || '').toLowerCase();
        if (name && (cLower === name || cLower.includes(name) || name.includes(cLower))) {
          return wc;
        }
      }
    }

    return 'DEA012'; // default fallback
  }

  showImportExcelReport({ filename, importedCount, skippedCompletedIds, inferredCompletedIds, stepsCompletedReport }) {
    if (!this.importExcelReportModal || !this.importExcelReportBody) return;

    const section = (title, color, bodyHtml) => `
      <div>
        <div style="font-size: 12px; font-weight: bold; color: ${color}; margin-bottom: 6px;">${title}</div>
        ${bodyHtml}
      </div>
    `;
    const pdChips = (ids) => `
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        ${ids.map(id => `<span style="font-size: 11px; font-family: monospace; padding: 3px 8px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass); color: var(--text-primary);">${id}</span>`).join('')}
      </div>
    `;
    const emptyNote = '<div style="font-size: 11px; color: var(--text-secondary);">ไม่มี</div>';

    let html = `<div style="font-size: 11px; color: var(--text-secondary);">ไฟล์: <strong style="color: var(--text-primary);">${filename}</strong> · นำเข้าสำเร็จ <strong style="color: var(--accent-teal);">${importedCount}</strong> Production Orders</div>`;

    html += section(
      `1) ข้ามการนำเข้า - PD ที่บันทึกว่าผลิตเสร็จแล้ว (${skippedCompletedIds.length})`,
      'var(--accent-green, #16a34a)',
      skippedCompletedIds.length > 0 ? pdChips(skippedCompletedIds) : emptyNote
    );

    html += section(
      `2) หายไปจากไฟล์ทั้งหมด - สันนิษฐานว่าผลิตเสร็จแล้ว (${inferredCompletedIds.length})`,
      'var(--accent-orange)',
      inferredCompletedIds.length > 0 ? pdChips(inferredCompletedIds) : emptyNote
    );

    let stepsHtml = emptyNote;
    if (stepsCompletedReport.length > 0) {
      stepsHtml = `
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${stepsCompletedReport.map(r => `
            <div style="font-size: 11px; padding: 6px 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 6px;">
              <strong style="color: var(--accent-cyan); font-family: monospace;">${r.pdId}</strong>
              <span style="color: var(--text-secondary);"> - ขั้นตอนที่หายไป: ${r.steps.join(', ')}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
    html += section(
      `3) Operation ที่หายไปจาก PD เดิม - สันนิษฐานว่าเสร็จแล้ว (${stepsCompletedReport.length} PD)`,
      'var(--accent-cyan)',
      stepsHtml
    );

    this.importExcelReportBody.innerHTML = html;
    this.importExcelReportModal.classList.remove('hidden');
  }

  importExcelPD() {
    const fileInput = document.getElementById('new-pd-excel-file');
    const rangePD = document.getElementById('new-pd-excel-range')?.value.trim() || '';
    const priorityFilter = document.getElementById('new-pd-excel-priority')?.value.trim();
    const projectFilter = document.getElementById('new-pd-excel-project')?.value.trim();
    const incompleteOnly = document.getElementById('excel-opt-incomplete-only')?.checked;
    const unclosedOnly = document.getElementById('excel-opt-unclosed-only')?.checked;
    
    if (typeof XLSX === 'undefined') {
      alert('ไม่สามารถโหลดไลบรารี SheetJS (XLSX) ได้สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต');
      return;
    }

    const spinTok = typeof window.showIosSpinner === 'function' ? window.showIosSpinner(550) : null;
    const hideSpin = () => {
      if (typeof window.hideIosSpinner === 'function') window.hideIosSpinner(spinTok);
    };

    const parseAndLoad = (arrayBuffer, filename) => {
      const runParse = () => {
      try {
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Find sheet named "data" (trimmed, case-insensitive)
        let sheetName = workbook.SheetNames.find(name => (name || '').trim().toLowerCase() === 'data');
        if (!sheetName) {
          sheetName = workbook.SheetNames.find(name => (name || '').trim().toLowerCase().includes('data'));
        }
        if (!sheetName) {
          sheetName = workbook.SheetNames[0];
        }
        
        if (!sheetName) {
          alert('ไม่พบ Sheet ข้อมูลในไฟล์ Excel');
          return;
        }
        
        const worksheet = workbook.Sheets[sheetName];
        // Parse once as 2D array for ultra-fast direct index access
        const raw2D = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        if (!raw2D || raw2D.length <= 1) {
          alert(`ไม่พบข้อมูลใน Sheet "${sheetName}"`);
          return;
        }

        // Parse Plan + Mat sheet if present
        let matSheetName = workbook.SheetNames.find(name => {
          const n = (name || '').trim().toLowerCase();
          return n === 'plan + mat' || n === 'plan+mat' || (n.includes('plan') && n.includes('mat'));
        });
        if (matSheetName) {
          try {
            const matWorksheet = workbook.Sheets[matSheetName];
            const matRaw2D = XLSX.utils.sheet_to_json(matWorksheet, { header: 1, defval: '' });
            this.parseAndStoreMaterials(matRaw2D);
          } catch (e) {
            console.warn('Error parsing Plan + Mat sheet:', e);
          }
        }
        
        // Helper to extract number from PD code for comparison
        const parsePDNumber = (pdStr) => {
          if (!pdStr) return null;
          const match = String(pdStr).match(/\d+/);
          return match ? parseInt(match[0], 10) : null;
        };

        // Helper to parse PD range input string (e.g. "PD0000301-PD0000310", "PD0000301", or comma-separated)
        const parsePDRangeInput = (rangeStr) => {
          if (!rangeStr || !rangeStr.trim()) return null;
          
          const tokens = rangeStr.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
          const ranges = [];
          
          tokens.forEach(token => {
            // Match two parts separated by hyphen (e.g. PD0000301-PD0000310 or 301-310)
            const dashMatch = token.match(/^([a-zA-Z0-9_]+)\s*-\s*([a-zA-Z0-9_]+)$/);
            if (dashMatch) {
              const startNum = parsePDNumber(dashMatch[1]);
              const endNum = parsePDNumber(dashMatch[2]);
              if (startNum !== null && endNum !== null) {
                ranges.push({
                  start: Math.min(startNum, endNum),
                  end: Math.max(startNum, endNum)
                });
              }
            } else {
              // Single PD ID e.g. "PD0000301"
              const num = parsePDNumber(token);
              if (num !== null) {
                ranges.push({
                  start: num,
                  end: num
                });
              }
            }
          });
          
          return ranges.length > 0 ? ranges : null;
        };

        const parsedRanges = parsePDRangeInput(rangePD);
        
        // Dynamic exact-prioritized column index resolution
        const headerRow = (raw2D[0] || []).map(h => String(h || '').trim().toLowerCase());
        const findColIdx = (possibleNames, fallbackIdx) => {
          // 1. Exact match first
          for (let p of possibleNames) {
            for (let i = 0; i < headerRow.length; i++) {
              if (headerRow[i] === p) return i;
            }
          }
          // 2. Starts with match
          for (let p of possibleNames) {
            for (let i = 0; i < headerRow.length; i++) {
              if (headerRow[i].startsWith(p)) return i;
            }
          }
          // 3. Substring match (at least 3 chars)
          for (let p of possibleNames) {
            for (let i = 0; i < headerRow.length; i++) {
              if (p.length >= 3 && headerRow[i].includes(p)) return i;
            }
          }
          return fallbackIdx;
        };

        // Pre-computed column indexes (O(1) lookups during row processing)
        const col = {
          project: findColIdx(['project', 'project code', 'projectcode', 'project name', 'projectname', 'so no', 'so number', 'so'], 4),
          customer: findColIdx(['customer', 'cust', 'customer name', 'client'], 5),
          pd: findColIdx(['production order', 'productionorder', 'pd id', 'pd_id', 'pd no', 'pd_no', 'order'], 6),
          priority: findColIdx(['prioty', 'priority', 'urgency'], 2),
          dwg: findColIdx(['item_5', 'drawing', 'dwg', 'dwg_no', 'dwg no', 'part number'], 10),
          partName: findColIdx(['description', 'part name', 'part_name', 'part description', 'partname'], 11),
          step: findColIdx(['operation', 'step', 'oper', 'op'], 12),
          wcCode: findColIdx(['work center code', 'wc code', 'machine code', 'work center', 'wc', 'item_4'], 13),
          wcDesc: findColIdx(['r.ref.oper.desc', 'machine description', 'machine name', 'department'], 14),
          opStatus: findColIdx(['operation status', 'op status'], 15),
          qty: findColIdx(['quantity ordered', 'qty', 'quantity', 'orderqty'], 16),
          orderStatus: findColIdx(['order status'], 17),
          cycleTime: findColIdx(['cycle time', 'cycletime'], 21),
          setupTime: findColIdx(['average setup time', 'setup time', 'setup'], 23)
        };

        // Priority and Project filters
        const priorityFilterList = priorityFilter ? priorityFilter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        const projectFilterList = projectFilter ? projectFilter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

        // Build Dwg to PD mapping for 14-char sub-assembly tracking and PD Operation Status map
        const dwgToPdMap = this.state.dwgToPdMap || {};
        const pdOpStatusMap = this.state.pdOpStatusMap || {};
        for (let i = 1; i < raw2D.length; i++) {
          const rawRow = raw2D[i];
          if (!rawRow || rawRow.length === 0) continue;
          const dwg = String(rawRow[col.dwg] || '').trim();
          const rawPd = String(rawRow[col.pd] || '').trim();
          const pdMatch = rawPd.match(/^PD\d+[A-Z]?/i);
          const pdId = pdMatch ? pdMatch[0].toUpperCase() : rawPd;
          if (!pdId) continue;
          const opNum = parseInt(rawRow[col.step]) || 10;
          const opStatus = String(rawRow[col.opStatus] || '').trim();
          const orderStatus = String(rawRow[col.orderStatus] || '').trim();
          const wcDesc = String(rawRow[col.wcDesc] || '').trim();
          const wcCode = String(rawRow[col.wcCode] || '').trim();

          if (opStatus) {
            if (!pdOpStatusMap[pdId]) pdOpStatusMap[pdId] = {};
            pdOpStatusMap[pdId][String(opNum)] = opStatus;
            if (wcCode) {
              const prevSt = pdOpStatusMap[pdId][wcCode] || '';
              if (!prevSt || prevSt.toLowerCase() === 'completed') {
                pdOpStatusMap[pdId][wcCode] = opStatus;
              }
            }
          }

          if (!dwg) continue;

          if (!dwgToPdMap[dwg]) {
            dwgToPdMap[dwg] = {
              pdId,
              orderStatus,
              operations: []
            };
          } else if (orderStatus !== 'Closed' && dwgToPdMap[dwg].orderStatus === 'Closed') {
            dwgToPdMap[dwg].pdId = pdId;
            dwgToPdMap[dwg].orderStatus = orderStatus;
            dwgToPdMap[dwg].operations = [];
          }

          if (pdId === dwgToPdMap[dwg].pdId) {
            dwgToPdMap[dwg].operations.push({
              stepNum: opNum,
              name: wcDesc || wcCode,
              machine: wcCode,
              status: opStatus
            });
          }
        }
        this.state.dwgToPdMap = dwgToPdMap;
        this.state.pdOpStatusMap = pdOpStatusMap;

        // Group rows by Production Order ID
        const groups = {};

        for (let i = 1; i < raw2D.length; i++) {
          const rawRow = raw2D[i];
          if (!rawRow || rawRow.length === 0) continue;

          // 1. Order Status filter
          if (unclosedOnly) {
            const orderStatus = String(rawRow[col.orderStatus] || '').trim().toLowerCase();
            if (orderStatus === 'closed' || orderStatus === 'close') continue;
          }

          // 2. Operation Status filter
          if (incompleteOnly) {
            const opStatus = String(rawRow[col.opStatus] || '').trim().toLowerCase();
            if (opStatus === 'complete' || opStatus === 'completed') continue;
          }

          // 3. Priority filter
          const rawPriority = String(rawRow[col.priority] || '').trim();
          const rowPriorityVal = rawPriority || 'Normal';

          if (priorityFilterList.length > 0) {
            const pLower = rowPriorityVal.toLowerCase();
            if (!priorityFilterList.some(fVal => pLower.includes(fVal))) {
              continue;
            }
          }

          // 4. Project from Column E (Project / SOxxxxxxx)
          const rawProject = String(rawRow[col.project] || '').trim();
          const rowProjectVal = rawProject || 'General';

          if (projectFilterList.length > 0) {
            const prLower = rowProjectVal.toLowerCase();
            if (!projectFilterList.some(fVal => prLower.includes(fVal))) {
              continue;
            }
          }

          // 5. Customer from Column F
          const rawCustomer = String(rawRow[col.customer] || '').trim();
          const rowCustomerVal = rawCustomer || 'General';

          // 6. Production Order ID Resolution
          const colG = String(rawRow[col.pd] || '').trim();
          const colK = String(rawRow[col.dwg] || '').trim();
          const colL = String(rawRow[col.partName] || '').trim();

          let pdId = '';
          let dwgNo = '';
          let partName = '';

          if (/^PD\d+/i.test(colG)) {
            pdId = colG.match(/^PD\d+[A-Z]?/i)?.[0]?.toUpperCase() || colG;
            dwgNo = colK;
            partName = colL;
          } else if (/^PD\d+/i.test(colK)) {
            pdId = colK.match(/^PD\d+[A-Z]?/i)?.[0]?.toUpperCase() || colK;
            dwgNo = colL;
            partName = colG;
          } else {
            const matchA = String(rawRow[0] || '').match(/^PD\d+[A-Z]?/i);
            if (matchA) {
              pdId = matchA[0].toUpperCase();
              dwgNo = colK;
              partName = colL || colG;
            } else if (colG) {
              pdId = colG.match(/^PD\d+[A-Z]?/i)?.[0]?.toUpperCase() || colG;
              dwgNo = colK;
              partName = colL;
            }
          }

          if (!pdId) continue;
          
          const pdNum = parsePDNumber(pdId);
          if (pdNum === null) continue;
          
          // Range check if specified (from start-end range input)
          if (parsedRanges && parsedRanges.length > 0) {
            const inRange = parsedRanges.some(r => pdNum >= r.start && pdNum <= r.end);
            if (!inRange) continue;
          }
          
          const qty = parseInt(rawRow[col.qty]) || 1;

          if (!groups[pdId]) {
            groups[pdId] = {
              id: pdId,
              customer: rowCustomerVal,
              project: rowProjectVal,
              dwgNo: dwgNo,
              partName: partName,
              qty: qty,
              priority: rowPriorityVal,
              status: 'Unscheduled',
              delayReason: '',
              dueHour: null,
              steps: []
            };
          } else {
            // Update project/customer if they were default 'General' and we now found a real value
            if ((groups[pdId].project === 'General' || !groups[pdId].project) && rowProjectVal !== 'General') {
              groups[pdId].project = rowProjectVal;
            }
            if ((groups[pdId].customer === 'General' || !groups[pdId].customer) && rowCustomerVal !== 'General') {
              groups[pdId].customer = rowCustomerVal;
            }
            if (!groups[pdId].dwgNo && dwgNo) {
              groups[pdId].dwgNo = dwgNo;
            }
            if (!groups[pdId].partName && partName) {
              groups[pdId].partName = partName;
            }
          }
          
          const stepNumRaw = parseInt(rawRow[col.step]) || (groups[pdId].steps.length + 1) * 10;
          const wcCode = String(rawRow[col.wcCode] || '').trim();
          const wcDesc = String(rawRow[col.wcDesc] || '').trim();
          const machineCode = this.matchWorkCenter(wcDesc, wcCode);
          const cycleMinutes = parseFloat(rawRow[col.cycleTime]) || 1.0;
          const setupMinutes = parseFloat(rawRow[col.setupTime]) || 0.0;
          const rowOpStatus = String(rawRow[col.opStatus] || '').trim();

          // Skip a step someone manually removed from this PD's Routing Steps table
          // (edit modal) - it must not come back just because the Excel file still
          // has it. Identified by (machine, name) since step numbers get renumbered.
          const stepNameForCheck = wcDesc || this.state.workCenters[machineCode]?.name || machineCode;
          if (this.state.isStepIdentityRemoved(pdId, machineCode, stepNameForCheck)) continue;

          groups[pdId].steps.push({
            stepNum: stepNumRaw,
            name: stepNameForCheck,
            machine: machineCode,
            cycleMinutes: cycleMinutes,
            setupMinutes: setupMinutes,
            opStatus: rowOpStatus
          });
        }
        
        // Snapshot of the backlog as it stood before this import, used below to
        // infer which PDs / steps have quietly finished production since the
        // last import (conditions 2 and 3).
        const workOrdersBeforeImport = this.state.workOrders;

        // All PDs that matched this import's filters (priority/project/range/
        // unclosed/incomplete) and have at least one step - the "new" data set.
        const groupsAll = Object.values(groups).filter(wo => wo.steps.length > 0);
        const groupsAllMap = new Map(groupsAll.map(wo => [wo.id, wo]));

        // Condition 1: PD already marked "ผลิตจริงเสร็จแล้ว" - never bring it back.
        const skippedCompletedIds = groupsAll
          .filter(wo => this.state.isPdInCompletedHistory(wo.id))
          .map(wo => wo.id);

        const importedWOs = groupsAll.filter(wo => !this.state.isPdInCompletedHistory(wo.id));
        if (importedWOs.length === 0 && skippedCompletedIds.length === 0) {
          alert('ไม่พบ Production Order หรือขั้นตอนการผลิตในเงื่อนไขและช่วงที่กำหนด');
          return;
        }

        // Condition 2: a PD that existed in the backlog before this import, isn't
        // already marked completed, and doesn't appear anywhere in this import's
        // data at all - infer it finished production and never bring it back.
        const inferredCompletedIds = workOrdersBeforeImport
          .filter(wo => !groupsAllMap.has(wo.id) && !this.state.isPdInCompletedHistory(wo.id))
          .map(wo => wo.id);

        // Condition 3: a PD survives the import, but one or more of its previous
        // operations (identified by machine + operation name, since step numbers
        // get renumbered) are missing from the newly imported routing - infer
        // those specific steps finished production.
        const stepsCompletedReport = [];
        workOrdersBeforeImport.forEach(oldWO => {
          if (this.state.isPdInCompletedHistory(oldWO.id)) return;
          const newWO = groupsAllMap.get(oldWO.id);
          if (!newWO) return; // handled by condition 2

          const newStepKeys = new Set(
            newWO.steps.map(s => this.state.getStepIdentityKey(oldWO.id, s.machine, s.name))
          );
          const missingSteps = (oldWO.steps || []).filter(s =>
            !newStepKeys.has(this.state.getStepIdentityKey(oldWO.id, s.machine, s.name || s.stepName))
          );
          if (missingSteps.length > 0) {
            stepsCompletedReport.push({ pdId: oldWO.id, steps: missingSteps.map(s => s.name || s.stepName || s.machine) });
            missingSteps.forEach(s => {
              const key = this.state.getStepIdentityKey(oldWO.id, s.machine, s.name || s.stepName);
              this.state.removedStepHistory[key] = true;
            });
          }
        });

        // Apply condition 2's inference before merging, so those PDs don't
        // linger in the backlog just because they weren't part of this import.
        inferredCompletedIds.forEach(id => {
          this.state.completedPdHistory[id] = true;
        });

        // For each work order, sort steps by stepNum and assign step IDs
        importedWOs.forEach(wo => {
          wo.steps.sort((a, b) => a.stepNum - b.stepNum);
          wo.steps = wo.steps.map((step, idx) => {
            const stepNum = step.stepNum || (idx + 1) * 10;
            const wcName = this.state.workCenters[step.machine]?.name || step.machine;
            const cyc = step.cycleMinutes > 0 ? step.cycleMinutes : 1.0;
            const setup = step.setupMinutes >= 0 ? step.setupMinutes : 0.0;
            const cap = this.state.workCenters[step.machine]?.capacity || 1;
            const totalHours = parseFloat(((setup + wo.qty * cyc) / 60.0 / cap).toFixed(4)) || 0.1;
            return {
              id: `${wo.id}-${stepNum}`,
              stepNum: stepNum,
              name: step.name || wcName,
              machine: step.machine,
              cycleMinutes: cyc, 
              setupMinutes: setup, 
              estHours: totalHours, 
              status: 'Unscheduled',
              opStatus: step.opStatus || '',
              startHour: null
            };
          });
          wo.totalStepsCount = wo.steps.length;
        });
        
        // Fast merge using Map (O(N))
        const importedMap = new Map(importedWOs.map(wo => [wo.id, wo]));
        this.state.workOrders = [
          ...this.state.workOrders.filter(wo => !importedMap.has(wo.id)),
          ...importedWOs
        ];

        // Update details of already scheduled jobs with the newly imported excel properties
        importedWOs.forEach(newWO => {
          newWO.steps.forEach(newStep => {
            const scheduledJob = this.state.scheduledJobs.find(j => j.id === newStep.id);
            if (scheduledJob) {
              scheduledJob.priority = newWO.priority;
              scheduledJob.project = newWO.project;
              scheduledJob.dwgNo = newWO.dwgNo || '';
              scheduledJob.partName = newWO.partName;
              scheduledJob.customer = newWO.customer;
              scheduledJob.qty = newWO.qty;
              scheduledJob.setupMinutes = newStep.setupMinutes;
              scheduledJob.cycleMinutes = newStep.cycleMinutes;
              scheduledJob.estHours = newStep.estHours;
              if (newStep.opStatus) scheduledJob.opStatus = newStep.opStatus;
            }
          });
        });

        if (typeof this.state.cascadeCompletedPdsToChildren === 'function') {
          this.state.cascadeCompletedPdsToChildren();
        }
        if (typeof this.state.syncOverviewStatusToJobs === 'function') {
          this.state.syncOverviewStatusToJobs();
        }

        // Apply conditions 2 & 3's inferences: drop the now-completed PDs and the
        // now-completed individual steps out of both the backlog and the board.
        this.state.workOrders = this.state.workOrders.filter(wo => !this.state.isPdInCompletedHistory(wo.id));
        this.state.scheduledJobs = this.state.scheduledJobs.filter(j =>
          !this.state.isPdInCompletedHistory(j.woId) && !this.state.isStepIdentityRemoved(j.woId, j.machine, j.stepName || j.name)
        );

        // Automatically link assembly relationships
        this.state.autoLinkAssemblies();

        // Save to file and refresh
        this.state.saveWorkOrdersToFile();
        this.state.savePlanToFile();
        this.state.notify();

        this.closeImportExcelModal();
        this.showImportExcelReport({
          filename,
          importedCount: importedWOs.length,
          skippedCompletedIds,
          inferredCompletedIds,
          stepsCompletedReport
        });

        // ตรวจสอบโหมดผู้ใช้งาน: ถ้าอยู่ในโหมดวางแผน ค่อย Up ข้อมูลเก็บไว้ใน cloud
        const isPlanMode = this.state.storageSync ? this.state.storageSync.getUserMode() === 'plan' : false;
        if (isPlanMode) {
          this.state.storageSync?.pushToCloud(this.state.buildPlanPayload(), true);
          this.state.storageSync?.showToast(`☁️ [โหมดวางแผน] อัปเดตแผนงานและข้อมูลนำเข้าจาก ${filename} ขึ้น Cloud สำเร็จ`, 'success');
        } else {
          this.state.storageSync?.showToast(`💾 [โหมดดูแผน] บันทึกข้อมูลนำเข้าจาก ${filename} ลงแคชเครื่อง (Local) เรียบร้อย (ไม่อัปโหลดขึ้น Cloud)`, 'info');
        }
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการนำเข้าไฟล์ Excel: ' + err.message);
      } finally {
        hideSpin();
      }
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(runParse, 25));
      } else {
        setTimeout(runParse, 25);
      }
    };

    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      if (this.state.storageSync) {
        this.state.storageSync.setStatusOverviewFilename(file.name);
      }
      const reader = new FileReader();
      reader.onload = async (e) => {
        const buffer = e.target.result;
        // บันทึกลง Local Cache ทันที เพื่อความรวดเร็ว
        if (this.state.storageSync) {
          await this.state.storageSync.saveOverviewToCache(file.name, buffer);
        }
        this.saveExcelToDB(file.name, buffer)
          .then(() => {
            parseAndLoad(buffer, file.name);
          })
          .catch(err => {
            console.warn('Failed to save excel to IndexedDB:', err);
            parseAndLoad(buffer, file.name);
          });
      };
      reader.onerror = () => hideSpin();
      reader.readAsArrayBuffer(file);
    } else {
      const defaultFilename = this.state.storageSync 
        ? this.state.storageSync.getStatusOverviewFilename() 
        : 'LN Status Overview.xlsx';

      const tryFetchOverview = async () => {
        if (this.state.storageSync) {
          const overview = await this.state.storageSync.fetchStatusOverview();
          if (overview && overview.arrayBuffer) {
            parseAndLoad(overview.arrayBuffer, overview.filename);
            return true;
          }
        }
        return false;
      };

      tryFetchOverview().then(found => {
        if (found) return;
        this.loadExcelFileFromDB().then(data => {
          if (data && data.arrayBuffer && data.filename) {
            parseAndLoad(data.arrayBuffer, data.filename);
          } else {
            hideSpin();
            alert(`กรุณาเลือกไฟล์ ${defaultFilename} (หรือวางไฟล์ไว้ในระบบ)`);
          }
        }).catch(err => {
          hideSpin();
          console.warn('Failed to load excel from IndexedDB:', err);
          alert(`กรุณาเลือกไฟล์ ${defaultFilename} (หรือวางไฟล์ไว้ในระบบ)`);
        });
      }).catch(() => hideSpin());
    }
  }

  parseAndStoreMaterials(matRaw2D) {
    if (!matRaw2D || matRaw2D.length <= 1) return;
    const headerRow = (matRaw2D[0] || []).map(h => String(h || '').trim().toLowerCase());
    const findColIdx = (possibleNames, fallbackIdx) => {
      for (let p of possibleNames) {
        for (let i = 0; i < headerRow.length; i++) {
          if (headerRow[i] === p) return i;
        }
      }
      for (let p of possibleNames) {
        for (let i = 0; i < headerRow.length; i++) {
          if (headerRow[i].startsWith(p)) return i;
        }
      }
      for (let p of possibleNames) {
        for (let i = 0; i < headerRow.length; i++) {
          if (p.length >= 3 && headerRow[i].includes(p)) return i;
        }
      }
      return fallbackIdx;
    };

    const col = {
      pd: findColIdx(['production order', 'productionorder', 'pd id', 'pd_id', 'pd no', 'order'], 5),
      step: findColIdx(['operation', 'step', 'oper', 'op'], 9),
      wc: findColIdx(['work center', 'wc'], 10),
      operDesc: findColIdx(['r.ref.oper.desc', 'machine description', 'operation description'], 11),
      mat: findColIdx(['mat.', 'mat', 'item', 'material'], 14),
      matDesc: findColIdx(['mat._1', 'mat_1', 'mat desc', 'description'], 15),
      estimatedQty: findColIdx(['mat.estimated quantity', 'estimated quantity', 'est qty'], 18),
      actualQty: findColIdx(['mat.actual quantity', 'actual quantity'], 19),
      toIssue: findColIdx(['mat.to issue', 'to issue'], 21),
      operStatus: findColIdx(['operation status', 'oper status', 'op status'], 22),
      orderStatus: findColIdx(['order status'], 23)
    };

    const planMaterials = this.state.planMaterials || {};
    const pdOpStatusMap = this.state.pdOpStatusMap || {};
    for (let i = 1; i < matRaw2D.length; i++) {
      const row = matRaw2D[i];
      if (!row || row.length === 0) continue;
      const rawPd = String(row[col.pd] || '').trim();
      const pdMatch = rawPd.match(/^PD\d+[A-Z]?/i);
      const pdId = pdMatch ? pdMatch[0].toUpperCase() : rawPd;
      const mat = String(row[col.mat] || '').trim();
      if (!pdId || !mat) continue;

      if (!planMaterials[pdId]) {
        planMaterials[pdId] = [];
      }

      const stepNum = parseInt(row[col.step]) || 10;
      const wc = String(row[col.wc] || '').trim();
      const operDesc = String(row[col.operDesc] || '').trim();
      const matDesc = String(row[col.matDesc] || '').trim();
      const estQty = parseFloat(row[col.estimatedQty]) || 0;
      const actualQty = parseFloat(row[col.actualQty]) || 0;
      const toIssue = parseFloat(row[col.toIssue]) || 0;
      const operStatus = String(row[col.operStatus] || '').trim();
      const orderStatus = String(row[col.orderStatus] || '').trim();

      if (operStatus) {
        if (!pdOpStatusMap[pdId]) pdOpStatusMap[pdId] = {};
        if (!pdOpStatusMap[pdId][String(stepNum)]) {
          pdOpStatusMap[pdId][String(stepNum)] = operStatus;
        }
        if (wc && !pdOpStatusMap[pdId][wc]) {
          pdOpStatusMap[pdId][wc] = operStatus;
        }
      }

      const exists = planMaterials[pdId].some(m => m.mat === mat && m.stepNum === stepNum);
      if (!exists) {
        planMaterials[pdId].push({
          stepNum,
          wc,
          operDesc,
          mat,
          matDesc,
          estimatedQty: estQty,
          actualQty,
          toIssue,
          operStatus,
          orderStatus
        });
      }
    }
    this.state.planMaterials = planMaterials;
    this.state.pdOpStatusMap = pdOpStatusMap;
    if (typeof this.state.syncOverviewStatusToJobs === 'function') {
      this.state.syncOverviewStatusToJobs();
    }
  }
}
