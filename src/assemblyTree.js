// Assembly Parts Tree Diagram Controller
// Implements full GoDiagram-style Visual Parts Tree Hierarchy (BOM Tree)

import { isJobPriorityVisible, isJobProjectVisible, isJobCustomerVisible } from './gantt.js';

// Parses a search box entry like "PD2607785-PD2607795" into a numeric ID range, so
// searching finds every PD whose number falls between two IDs instead of only
// exact/substring text matches. Returns null when the query isn't range-shaped
// (plain substring search should be used instead).
export function parseIdRangeQuery(query) {
  const q = (query || '').trim();
  const m = q.match(/^([A-Za-z]*)(\d+)\s*-\s*([A-Za-z]*)(\d+)$/);
  if (!m) return null;
  const [, prefix1, numStr1, prefix2, numStr2] = m;
  if (prefix1 && prefix2 && prefix1.toUpperCase() !== prefix2.toUpperCase()) return null;
  const prefix = (prefix1 || prefix2 || '').toUpperCase();
  if (!prefix) return null; // require a prefix (e.g. "PD") so a bare "1-5" doesn't match everything
  // A right side with no prefix and fewer digits than the left (e.g. "PD2519316-329")
  // is ambiguous - is "329" a full second ID or a truncated suffix? Rather than guess,
  // only treat it as a range when both sides carry the same digit count (or the right
  // side repeats the "PD" prefix), otherwise fall back to a plain substring search.
  if (!prefix2 && numStr2.length !== numStr1.length) return null;
  const num1 = parseInt(numStr1, 10);
  const num2 = parseInt(numStr2, 10);
  return { prefix, min: Math.min(num1, num2), max: Math.max(num1, num2) };
}

// True if `id`/`partName`/`dwgNo` satisfy a search query - either a "PDxxxx-PDyyyy" ID
// range, or (for anything else) a plain case-insensitive substring match.
export function matchesAssemblyQuery(id, partName, query, dwgNo = '') {
  const q = (query || '').trim();
  if (!q) return true;

  const range = parseIdRangeQuery(q);
  if (range) {
    const idMatch = (id || '').toUpperCase().match(/^([A-Za-z]+)(\d+)$/);
    if (!idMatch) return false;
    if (idMatch[1] !== range.prefix) return false;
    const idNum = parseInt(idMatch[2], 10);
    return idNum >= range.min && idNum <= range.max;
  }

  const lower = q.toLowerCase();
  return (id || '').toLowerCase().includes(lower) || 
         (partName || '').toLowerCase().includes(lower) ||
         (dwgNo || '').toLowerCase().includes(lower);
}

export class AssemblyTreeController {
  constructor(state, ganttController) {
    this.state = state;
    this.gantt = ganttController;
    this.container = document.getElementById('assembly-tree-view-wrapper');
    this.canvasContainer = document.getElementById('assembly-tree-canvas-container');
    this.zoomPlane = document.getElementById('assembly-tree-zoom-plane');
    this.svg = document.getElementById('assembly-tree-svg');
    this.nodesContainer = document.getElementById('assembly-tree-nodes-container');
    this.searchInput = document.getElementById('assembly-tree-search-input');
    this.searchDropdown = document.getElementById('assembly-tree-search-dropdown');

    this.headerPartNo = document.getElementById('tree-header-partno');
    this.headerDesc = document.getElementById('tree-header-desc');
    this.legendContainer = document.getElementById('assembly-tree-legend-container');

    this.selectedWoId = null;
    this.focusedWoId = null;
    this.allAssemblies = [];
    this.collapsedNodes = new Set();
    this.sidebarExpandedNodes = new Set();
    this.orientation = (typeof localStorage !== 'undefined' && localStorage.getItem('assembly_tree_orientation')) || 'horizontal';
    this.showRawMaterials = typeof localStorage !== 'undefined' ? localStorage.getItem('assembly_tree_show_raw') !== 'false' : true;
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;
    this._savedPrintState = null;

    // Sidebar TreeView elements
    this.sidebarTab = document.getElementById('assembly-tree-sidebar-tab');
    this.sidebarMainPdInput = document.getElementById('sidebar-main-pd-input');
    this.sidebarMainPdDropdown = document.getElementById('sidebar-main-pd-dropdown');
    this.sidebarTreeview = document.getElementById('sidebar-assembly-treeview');
    this.btnSidebarTreeExpandAll = document.getElementById('btn-sidebar-tree-expand-all');
    this.btnSidebarTreeCollapseAll = document.getElementById('btn-sidebar-tree-collapse-all');

    // Toolbar Breadcrumb elements
    this.treeFocusText = document.getElementById('tree-focus-text');
    this.btnTreeResetFocus = document.getElementById('btn-tree-reset-focus');

    // BOM Explorer Modal elements
    this.bomModal = document.getElementById('assembly-bom-modal');
    this.bomTableBody = document.getElementById('assembly-bom-table-body');
    this.bomPdSelect = document.getElementById('bom-modal-pd-select');
    this.bomPdBadge = document.getElementById('bom-modal-pd-badge');
    this.bomPdDesc = document.getElementById('bom-modal-pd-desc');
    this.bomScopeSelect = document.getElementById('bom-modal-scope-select');
    this.bomSearchInput = document.getElementById('bom-modal-search-input');
    this.bomFooterStats = document.getElementById('bom-modal-footer-stats');
    this.btnTreeViewBom = document.getElementById('btn-tree-view-bom');
    this.btnSidebarViewBom = document.getElementById('btn-sidebar-view-bom');

    // BOM Modal Stat & Count elements
    this.bomStatTotal = document.getElementById('bom-stat-total');
    this.bomStatCompleted = document.getElementById('bom-stat-completed');
    this.bomStatProgress = document.getElementById('bom-stat-progress');
    this.bomStatToIssue = document.getElementById('bom-stat-toissue');
    this.bomFilterCountAll = document.getElementById('bom-filter-count-all');
    this.bomFilterCountCompleted = document.getElementById('bom-filter-count-completed');
    this.bomFilterCountProgress = document.getElementById('bom-filter-count-progress');
    this.bomFilterCountToIssue = document.getElementById('bom-filter-count-toissue');

    // BOM Explorer State
    this.bomActivePdId = null;
    this.bomActiveStatusFilter = 'all'; // 'all' | 'completed' | 'in_progress' | 'to_issue'
    this.bomScope = 'all'; // 'all' | 'main'
    this.bomSearchTerm = '';
    this.bomCachedItems = [];

    // Caches and indexes for high-performance assembly graph & BOM queries
    this._indexCache = null;
    this._cachedGraph = null;
    this._cachedAssemblies = null;
    this._cachedTreeNodes = new Map();
    this._cachedProgress = new Map();

    if (this.state && typeof this.state.subscribe === 'function') {
      this.state.subscribe(() => {
        this.invalidateCache();
      });
    }

    this.initEvents();
  }

  invalidateCache() {
    this._indexCache = null;
    this._cachedGraph = null;
    this._cachedAssemblies = null;
    this._cachedTreeNodes.clear();
    this._cachedProgress.clear();
  }

  getIndexMaps() {
    if (this._indexCache) return this._indexCache;

    const pdToDwgInfo = new Map();
    const dwgMap = this.state.dwgToPdMap || {};
    for (const [dwg, info] of Object.entries(dwgMap)) {
      if (info && info.pdId && !pdToDwgInfo.has(info.pdId)) {
        pdToDwgInfo.set(info.pdId, { dwgNo: dwg, ...info });
      }
    }

    const jobsByWoId = new Map();
    const knownJobs = new Map();
    for (const j of this.state.scheduledJobs || []) {
      if (j.woId) {
        let list = jobsByWoId.get(j.woId);
        if (!list) {
          list = [];
          jobsByWoId.set(j.woId, list);
        }
        list.push(j);

        if (!knownJobs.has(j.woId)) knownJobs.set(j.woId, j);
        if (j.dwgNo && !knownJobs.has(j.dwgNo.trim())) knownJobs.set(j.dwgNo.trim(), j);
      }
    }

    const backlogByWoId = new Map();
    for (const w of this.state.workOrders || []) {
      if (w.id) {
        backlogByWoId.set(w.id, w);
        if (!knownJobs.has(w.id)) knownJobs.set(w.id, w);
        if (w.dwgNo && !knownJobs.has(w.dwgNo.trim())) knownJobs.set(w.dwgNo.trim(), w);
      }
    }

    const allKnownIds = new Set([
      ...backlogByWoId.keys(),
      ...jobsByWoId.keys()
    ]);

    this._indexCache = {
      pdToDwgInfo,
      jobsByWoId,
      backlogByWoId,
      knownJobs,
      allKnownIds
    };
    return this._indexCache;
  }

  initEvents() {
    // Tree Orientation switcher (Hor Tree vs Ver Tree)
    const btnOrientHor = document.getElementById('btn-tree-orient-hor');
    if (btnOrientHor) {
      btnOrientHor.addEventListener('click', () => {
        this.setOrientation('horizontal');
      });
    }

    const btnOrientVer = document.getElementById('btn-tree-orient-ver');
    if (btnOrientVer) {
      btnOrientVer.addEventListener('click', () => {
        this.setOrientation('vertical');
      });
    }
    this.updateOrientButtons();

    // Show/Hide Warehouse Raw Materials toggle
    const btnToggleRaw = document.getElementById('btn-tree-toggle-raw');
    if (btnToggleRaw) {
      btnToggleRaw.addEventListener('click', () => {
        this.toggleRawMaterials();
      });
    }
    this.updateToggleRawButton();

    // Reset focus button in board toolbar (Return to Main PD)
    if (this.btnTreeResetFocus) {
      this.btnTreeResetFocus.addEventListener('click', () => {
        this.focusedWoId = this.selectedWoId;
        this.render();
        this.renderSidebarTreeView();
        this.fitView();
      });
    }

    // Sidebar TreeView Expand All / Collapse All
    if (this.btnSidebarTreeExpandAll) {
      this.btnSidebarTreeExpandAll.addEventListener('click', () => {
        const { allTreeNodes } = this.buildAssemblyTree(this.selectedWoId);
        allTreeNodes.forEach(n => {
          if (n.hasChildren) this.sidebarExpandedNodes.add(n.nodeKey);
        });
        this.renderSidebarTreeView();
      });
    }

    if (this.btnSidebarTreeCollapseAll) {
      this.btnSidebarTreeCollapseAll.addEventListener('click', () => {
        this.sidebarExpandedNodes.clear();
        this.renderSidebarTreeView();
      });
    }

    // Sidebar Main PD Input & Dropdown ("ตรงหัว สามารถใส่เลขที่ PD ตัว Main ได้")
    if (this.sidebarMainPdInput) {
      this.sidebarMainPdInput.addEventListener('focus', () => {
        this.sidebarMainPdInput.select();
        this.renderSidebarMainPdDropdown(this.sidebarMainPdInput.value);
      });
      this.sidebarMainPdInput.addEventListener('input', () => {
        const val = this.sidebarMainPdInput.value.trim();
        if (!val && this.selectedWoId) {
          this.selectedWoId = null;
          this.focusedWoId = null;
          this.render();
          this.renderSidebarTreeView();
        }
        this.renderSidebarMainPdDropdown(this.sidebarMainPdInput.value);
      });
      this.sidebarMainPdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.hideSidebarMainPdDropdown();
          this.sidebarMainPdInput.blur();
        } else if (e.key === 'Enter') {
          const val = this.sidebarMainPdInput.value.trim().toUpperCase();
          const exact = this.allAssemblies.find(a => a.id.toUpperCase() === val);
          if (exact) {
            e.preventDefault();
            this.selectAssembly(exact.id);
          } else {
            const firstItem = this.sidebarMainPdDropdown?.querySelector('.sidebar-main-pd-item');
            if (firstItem) {
              e.preventDefault();
              this.selectAssembly(firstItem.getAttribute('data-wo-id'));
            }
          }
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (this.sidebarMainPdInput && this.sidebarMainPdDropdown &&
          !this.sidebarMainPdInput.contains(e.target) && !this.sidebarMainPdDropdown.contains(e.target)) {
        this.hideSidebarMainPdDropdown();
      }
    });

    // Searchable Assembly Set picker: a text input that filters a dropdown list
    // (44+ PDs makes a plain <select> hard to scan/scroll through).
    if (this.searchInput) {
      this.searchInput.addEventListener('focus', () => {
        this.searchInput.select();
        this.renderSearchDropdown(this.searchInput.value);
      });
      this.searchInput.addEventListener('input', () => {
        const val = this.searchInput.value.trim();
        if (!val && this.selectedWoId) {
          this.selectedWoId = null;
          this.focusedWoId = null;
          this.render();
          this.renderSidebarTreeView();
        }
        this.renderSearchDropdown(this.searchInput.value);
      });
      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.hideSearchDropdown();
          this.searchInput.blur();
        } else if (e.key === 'Enter') {
          const val = this.searchInput.value.trim().toUpperCase();
          const exact = this.allAssemblies.find(a => a.id.toUpperCase() === val);
          if (exact) {
            e.preventDefault();
            this.selectAssembly(exact.id);
          } else {
            const firstItem = this.searchDropdown?.querySelector('.assembly-search-item');
            if (firstItem) {
              e.preventDefault();
              this.selectAssembly(firstItem.getAttribute('data-wo-id'));
            }
          }
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (this.searchInput && this.searchDropdown &&
          !this.searchInput.contains(e.target) && !this.searchDropdown.contains(e.target)) {
        this.hideSearchDropdown();
      }
    });

    // Print
    const btnPrint = document.getElementById('btn-print-assembly-tree');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        this.print();
      });
    }

    window.addEventListener('beforeprint', () => {
      if (this.container && !this.container.classList.contains('hidden') && this.container.style.display !== 'none') {
        this.prepareForPrint();
      }
    });

    window.addEventListener('afterprint', () => {
      this.restoreAfterPrint();
    });

    // Zoom buttons
    const btnZoomIn = document.getElementById('btn-tree-zoom-in');
    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        this.scale = Math.min(2.5, this.scale + 0.15);
        this.applyTransform();
      });
    }

    const btnZoomOut = document.getElementById('btn-tree-zoom-out');
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        this.scale = Math.max(0.4, this.scale - 0.15);
        this.applyTransform();
      });
    }

    const btnFit = document.getElementById('btn-tree-fit');
    if (btnFit) {
      btnFit.addEventListener('click', () => {
        this.fitView();
      });
    }

    const btnExpandAll = document.getElementById('btn-tree-expand-all');
    if (btnExpandAll) {
      btnExpandAll.addEventListener('click', () => {
        this.collapsedNodes.clear();
        this.render();
      });
    }

    const btnCollapseAll = document.getElementById('btn-tree-collapse-all');
    if (btnCollapseAll) {
      btnCollapseAll.addEventListener('click', () => {
        const { allTreeNodes } = this.buildAssemblyTree(this.selectedWoId);
        allTreeNodes.forEach(n => {
          if (n.hasChildren && n.depth > 0) this.collapsedNodes.add(n.nodeKey);
        });
        this.render();
      });
    }

    // Pan & Zoom with mouse
    if (this.canvasContainer) {
      this.canvasContainer.addEventListener('mousedown', (e) => {
        if (e.target.closest('.assembly-node-card') || e.target.closest('#assembly-tree-legend-container')) return;
        this.isPanning = true;
        this.startX = e.clientX - this.panX;
        this.startY = e.clientY - this.panY;
        this.canvasContainer.style.cursor = 'grabbing';
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isPanning) return;
        this.panX = e.clientX - this.startX;
        this.panY = e.clientY - this.startY;
        this.applyTransform();
      });

      window.addEventListener('mouseup', () => {
        if (this.isPanning) {
          this.isPanning = false;
          if (this.canvasContainer) this.canvasContainer.style.cursor = 'grab';
        }
      });

      this.canvasContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomDelta = e.deltaY < 0 ? 0.1 : -0.1;
        this.scale = Math.min(2.5, Math.max(0.4, this.scale + zoomDelta));
        this.applyTransform();
      }, { passive: false });
    }

    // BOM Explorer Modal Triggers & Controls
    if (this.btnTreeViewBom) {
      this.btnTreeViewBom.addEventListener('click', () => {
        this.showBomModal();
      });
    }
    if (this.btnSidebarViewBom) {
      this.btnSidebarViewBom.addEventListener('click', () => {
        this.showBomModal();
      });
    }

    const btnCloseBom = document.getElementById('btn-close-assembly-bom');
    if (btnCloseBom) {
      btnCloseBom.addEventListener('click', () => {
        this.hideBomModal();
      });
    }

    const btnCloseBomFooter = document.getElementById('btn-close-assembly-bom-footer');
    if (btnCloseBomFooter) {
      btnCloseBomFooter.addEventListener('click', () => {
        this.hideBomModal();
      });
    }

    if (this.bomModal) {
      this.bomModal.addEventListener('click', (e) => {
        if (e.target === this.bomModal) {
          this.hideBomModal();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.bomModal && !this.bomModal.classList.contains('hidden')) {
        this.hideBomModal();
      }
    });

    // BOM Status Filter Buttons
    const filterGroup = document.getElementById('bom-status-filter-group');
    if (filterGroup) {
      filterGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.bom-status-filter-btn');
        if (!btn) return;
        const filter = btn.getAttribute('data-filter') || 'all';
        this.bomActiveStatusFilter = filter;
        this.renderBomTable();
      });
    }

    // BOM Scope Selector (all levels vs main only)
    if (this.bomScopeSelect) {
      this.bomScopeSelect.addEventListener('change', (e) => {
        this.bomScope = e.target.value;
        this.renderBomTable();
      });
    }

    // BOM Search Input
    if (this.bomSearchInput) {
      this.bomSearchInput.addEventListener('input', (e) => {
        this.bomSearchTerm = (e.target.value || '').trim();
        this.renderBomTable();
      });
    }

    // BOM Modal PD Selector
    if (this.bomPdSelect) {
      this.bomPdSelect.addEventListener('change', (e) => {
        const pdId = e.target.value;
        if (pdId) {
          this.showBomModal(pdId);
        }
      });
    }

    // Export CSV
    const btnExportCsv = document.getElementById('btn-export-bom-csv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', () => {
        this.exportBomCsv();
      });
    }
  }

  applyTransform() {
    if (this.zoomPlane) {
      this.zoomPlane.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    }
  }

  hideSearchDropdown() {
    if (this.searchDropdown) this.searchDropdown.classList.add('hidden');
  }

  renderSearchDropdown(query) {
    if (!this.searchDropdown) return;
    const matches = this.allAssemblies.filter(a => matchesAssemblyQuery(a.id, a.partName, query, a.dwgNo));

    if (matches.length === 0) {
      this.searchDropdown.innerHTML = '<div style="padding: 10px 12px; font-size: 12px; color: #64748b;">ไม่พบ Assembly Set ที่ตรงกับคำค้นหา</div>';
    } else {
      const maxItems = 50;
      const displayMatches = matches.slice(0, maxItems);
      let html = displayMatches.map(a => `
        <div class="assembly-search-item" data-wo-id="${a.id}" style="padding: 7px 12px; font-size: 12px; cursor: pointer; color: #0f172a; ${a.id === this.selectedWoId ? 'background: #e0f2fe; font-weight: 700;' : ''}" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='${a.id === this.selectedWoId ? '#e0f2fe' : ''}'">
          <span style="font-weight: 700; color: #0284c7;">${a.id}</span>
          ${a.dwgNo ? `<span style="font-size: 10.5px; color: #0369a1; font-family: monospace; margin-left: 4px;">(${a.dwgNo})</span>` : ''}
          <span style="color: #475569;"> - ${a.partName}</span>
        </div>
      `).join('');

      if (matches.length > maxItems) {
        html += `<div style="padding: 7px 12px; font-size: 11px; color: #64748b; background: #f8fafc; text-align: center; border-top: 1px solid #e2e8f0;">+ แสดง 50 จากทั้งหมด ${matches.length.toLocaleString()} รายการ (พิมพ์เพื่อค้นหาเจาะจงขึ้น)</div>`;
      }

      this.searchDropdown.innerHTML = html;

      this.searchDropdown.querySelectorAll('.assembly-search-item').forEach(item => {
        item.addEventListener('click', () => {
          this.selectAssembly(item.getAttribute('data-wo-id'));
        });
      });
    }

    this.searchDropdown.classList.remove('hidden');
  }

  hideSidebarMainPdDropdown() {
    if (this.sidebarMainPdDropdown) this.sidebarMainPdDropdown.classList.add('hidden');
  }

  renderSidebarMainPdDropdown(query) {
    if (!this.sidebarMainPdDropdown) return;
    const matches = this.allAssemblies.filter(a => matchesAssemblyQuery(a.id, a.partName, query, a.dwgNo));

    if (matches.length === 0) {
      this.sidebarMainPdDropdown.innerHTML = '<div style="padding: 10px 12px; font-size: 11px; color: var(--text-secondary);">ไม่พบ Assembly Set ที่ตรงกับคำค้นหา</div>';
    } else {
      const maxItems = 50;
      const displayMatches = matches.slice(0, maxItems);
      let html = displayMatches.map(a => `
        <div class="sidebar-main-pd-item" data-wo-id="${a.id}" style="padding: 7px 10px; font-size: 11.5px; cursor: pointer; color: var(--text-primary); ${a.id === this.selectedWoId ? 'background: rgba(0, 242, 254, 0.15); font-weight: 700;' : ''}" onmouseover="this.style.background='rgba(0, 242, 254, 0.08)'" onmouseout="this.style.background='${a.id === this.selectedWoId ? 'rgba(0, 242, 254, 0.15)' : ''}'">
          <span style="font-weight: 700; color: var(--accent-teal);">${a.id}</span>
          ${a.dwgNo ? `<span style="font-size: 10px; color: var(--text-secondary); font-family: monospace; margin-left: 3px;">(${a.dwgNo})</span>` : ''}
          <span style="color: var(--text-secondary);"> - ${a.partName}</span>
        </div>
      `).join('');

      if (matches.length > maxItems) {
        html += `<div style="padding: 6px 10px; font-size: 10px; color: var(--text-secondary); background: rgba(255,255,255,0.03); text-align: center; border-top: 1px solid var(--border-glass);">+ แสดง 50 จากทั้งหมด ${matches.length.toLocaleString()} รายการ (พิมพ์เพื่อค้นหาเจาะจงขึ้น)</div>`;
      }

      this.sidebarMainPdDropdown.innerHTML = html;

      this.sidebarMainPdDropdown.querySelectorAll('.sidebar-main-pd-item').forEach(item => {
        item.addEventListener('click', () => {
          this.selectAssembly(item.getAttribute('data-wo-id'));
        });
      });
    }

    this.sidebarMainPdDropdown.classList.remove('hidden');
  }

  renderSidebarTreeView() {
    if (!this.sidebarTreeview) return;
    const rootWoId = this.selectedWoId;
    if (!rootWoId) {
      this.sidebarTreeview.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--text-secondary); font-size: 11px;">กรุณาระบุหรือเลือกเลขที่ PD Main</div>';
      return;
    }

    const { rootTree } = this.buildAssemblyTree(rootWoId);
    if (!rootTree) {
      this.sidebarTreeview.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--text-secondary); font-size: 11px;">ไม่พบข้อมูลโครงสร้างของ PD นี้</div>';
      return;
    }

    // Default: expand root and depth 1 nodes if empty
    if (this.sidebarExpandedNodes.size === 0) {
      this.sidebarExpandedNodes.add(rootTree.nodeKey);
      (rootTree.children || []).forEach(c => {
        if (c.hasChildren) this.sidebarExpandedNodes.add(c.nodeKey);
      });
    }

    const focusedId = this.focusedWoId || rootWoId;

    const renderNode = (node) => {
      const hasChildren = node.children && node.children.length > 0;
      const isExpanded = this.sidebarExpandedNodes.has(node.nodeKey);
      const isSelected = (node.id === focusedId || node.nodeKey === focusedId);

      let icon = '📁';
      if (node.depth === 0) {
        icon = '🏷️';
      } else if (node.isRawMat) {
        icon = '📦';
      } else if (hasChildren) {
        icon = '📑';
      } else {
        icon = '📄';
      }

      const statusDot = `<span class="treeview-status-dot ${node.status}" title="สถานะ: ${node.status}"></span>`;
      const toggleBtn = hasChildren
        ? `<span class="treeview-toggle" data-node-key="${node.nodeKey}" title="${isExpanded ? 'คลิกเพื่อยุบกิ่ง' : 'คลิกเพื่อขยายกิ่ง'}">${isExpanded ? '−' : '+'}</span>`
        : `<span class="treeview-toggle empty"></span>`;

      let html = `
        <div class="treeview-item" data-node-key="${node.nodeKey}">
          <div class="treeview-row ${isSelected ? 'selected' : ''}" data-node-key="${node.nodeKey}" data-wo-id="${node.id}" data-is-raw="${node.isRawMat ? 'true' : 'false'}" data-parent-wo-id="${node.parentWoId || ''}" title="${node.partName}">
            ${toggleBtn}
            <span class="treeview-icon">${icon}</span>
            <span class="treeview-text">
              <span class="treeview-pd-id">${(node.displayId || '').replace(/^📦\s*/, '')}</span>
              ${node.dwgNo && node.dwgNo !== node.id ? `<span style="font-family: monospace; font-size: 10px; color: var(--text-secondary);">(${node.dwgNo})</span>` : ''}
              <span class="treeview-desc">${node.partName}</span>
            </span>
            ${statusDot}
          </div>
      `;

      if (hasChildren && isExpanded) {
        html += `<div class="treeview-children">`;
        node.children.forEach(child => {
          html += renderNode(child);
        });
        html += `</div>`;
      }

      html += `</div>`;
      return html;
    };

    this.sidebarTreeview.innerHTML = renderNode(rootTree);

    // Toggle branches listener
    this.sidebarTreeview.querySelectorAll('.treeview-toggle:not(.empty)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nKey = btn.getAttribute('data-node-key');
        if (this.sidebarExpandedNodes.has(nKey)) {
          this.sidebarExpandedNodes.delete(nKey);
        } else {
          this.sidebarExpandedNodes.add(nKey);
        }
        this.renderSidebarTreeView();
      });
    });

    // Select node listener (updates board enlarged view!)
    this.sidebarTreeview.querySelectorAll('.treeview-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.treeview-toggle')) return;
        const woId = row.getAttribute('data-wo-id');
        const isRaw = row.getAttribute('data-is-raw') === 'true';
        const parentWo = row.getAttribute('data-parent-wo-id');

        if (isRaw) {
          if (parentWo) this.focusedWoId = parentWo;
        } else if (woId) {
          this.focusedWoId = woId;
        }

        this.sidebarTreeview.querySelectorAll('.treeview-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');

        this.render();
        this.fitView();
      });
    });
  }

  setOrientation(orientation) {
    if (this.orientation === orientation) return;
    this.orientation = orientation;
    try {
      localStorage.setItem('assembly_tree_orientation', orientation);
    } catch (e) {
      // ignore
    }
    this.updateOrientButtons();
    this.render();
    this.fitView();
  }

  updateOrientButtons() {
    const btnHor = document.getElementById('btn-tree-orient-hor');
    const btnVer = document.getElementById('btn-tree-orient-ver');
    if (!btnHor || !btnVer) return;

    if (this.orientation === 'vertical') {
      btnVer.style.background = '#ffffff';
      btnVer.style.color = '#0284c7';
      btnVer.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
      btnHor.style.background = 'transparent';
      btnHor.style.color = '#64748b';
      btnHor.style.boxShadow = 'none';
    } else {
      btnHor.style.background = '#ffffff';
      btnHor.style.color = '#0284c7';
      btnHor.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
      btnVer.style.background = 'transparent';
      btnVer.style.color = '#64748b';
      btnVer.style.boxShadow = 'none';
    }
  }

  toggleRawMaterials() {
    this.showRawMaterials = !this.showRawMaterials;
    try {
      localStorage.setItem('assembly_tree_show_raw', this.showRawMaterials);
    } catch (e) {
      // ignore
    }
    this.updateToggleRawButton();
    this.render();
    this.fitView();
  }

  updateToggleRawButton() {
    const btn = document.getElementById('btn-tree-toggle-raw');
    if (!btn) return;
    if (this.showRawMaterials) {
      btn.textContent = '📦 วัตถุดิบ: แสดง';
      btn.style.borderColor = '#0284c7';
      btn.style.background = '#f0f9ff';
      btn.style.color = '#0284c7';
      btn.title = 'กำลังแสดงรายการวัตถุดิบคลังในผัง (คลิกเพื่อซ่อน)';
    } else {
      btn.textContent = '📦 วัตถุดิบ: ซ่อน';
      btn.style.borderColor = '#cbd5e1';
      btn.style.background = '#ffffff';
      btn.style.color = '#64748b';
      btn.title = 'กำลังซ่อนรายการวัตถุดิบคลังในผัง (คลิกเพื่อแสดง)';
    }
  }

  updatePrintHeader() {
    const rootWoId = this.selectedWoId;
    if (!rootWoId) return;

    const indexes = this.getIndexMaps();
    const jobs = indexes.jobsByWoId.get(rootWoId) || [];
    const backlog = indexes.backlogByWoId.get(rootWoId);

    let dwgNo = jobs[0]?.dwgNo || backlog?.dwgNo || '';
    let dwgInfo = dwgNo ? (this.state.dwgToPdMap && this.state.dwgToPdMap[dwgNo]) : indexes.pdToDwgInfo.get(rootWoId);
    if (!dwgNo && dwgInfo) {
      dwgNo = dwgInfo.dwgNo || '';
    }

    const project = jobs[0]?.project || backlog?.project || dwgInfo?.project || (jobs[0]?.so) || '-';
    const customer = jobs[0]?.customer || backlog?.customer || dwgInfo?.customer || '-';
    const partName = jobs[0]?.partName || backlog?.partName || dwgInfo?.partName || rootWoId;
    const qty = jobs[0]?.qty || backlog?.qty || dwgInfo?.qty || 1;

    const setElem = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || '-';
    };

    setElem('print-header-pd', rootWoId);
    setElem('print-header-dwg', dwgNo || '-');
    setElem('print-header-project', project);
    setElem('print-header-customer', customer);
    setElem('print-header-partname', partName);
    setElem('print-header-qty', qty);
    setElem('print-header-mode', this.orientation === 'vertical' ? 'ผังแนวตั้ง (Vertical Tree)' : 'ผังแนวนอน (Horizontal Tree)');
    setElem('print-header-rawstatus', this.showRawMaterials ? 'แสดง (Show)' : 'ซ่อน (Hidden)');

    const nowStr = new Date().toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    setElem('print-header-date', nowStr);
  }

  prepareForPrint() {
    this.updatePrintHeader();
    document.body.classList.add('printing-assembly-tree');

    // Save previous transform state so we can restore cleanly after print
    if (!this._savedPrintState) {
      this._savedPrintState = {
        scale: this.scale,
        panX: this.panX,
        panY: this.panY
      };
    }

    // Keep legendContainer anchored at its native top-left position (14px, 14px)
    // inside #assembly-tree-canvas-container (never reparent to zoomPlane to avoid preview races)

    // Calculate bounding box of all rendered node cards
    const cards = this.nodesContainer ? this.nodesContainer.querySelectorAll('.assembly-node-card') : [];
    
    let minCardX = Infinity, minCardY = Infinity;
    let maxCardX = -Infinity, maxCardY = -Infinity;

    if (cards.length > 0) {
      cards.forEach(card => {
        const left = parseFloat(card.style.left) || 0;
        const top = parseFloat(card.style.top) || 0;
        const w = parseFloat(card.style.width) || 190;
        const h = parseFloat(card.style.height) || 80;
        if (left < minCardX) minCardX = left;
        if (top < minCardY) minCardY = top;
        if (left + w > maxCardX) maxCardX = left + w;
        if (top + h > maxCardY) maxCardY = top + h;
      });
    } else if (this.allTreeNodes && this.allTreeNodes.length > 0) {
      this.allTreeNodes.forEach(n => {
        if (n.x != null && n.y != null) {
          if (n.x < minCardX) minCardX = n.x;
          if (n.y < minCardY) minCardY = n.y;
          if (n.x + 190 > maxCardX) maxCardX = n.x + 190;
          if (n.y + 80 > maxCardY) maxCardY = n.y + 80;
        }
      });
    }

    if (!isFinite(minCardX) || !isFinite(maxCardX)) {
      minCardX = 0; maxCardX = 800; minCardY = 0; maxCardY = 600;
    }

    const treeW = Math.max(100, maxCardX - minCardX);
    const treeH = Math.max(100, maxCardY - minCardY);

    // Target printable landscape dimensions: ~1040px x 680px (Landscape A4 with ~5-6mm margins)
    const targetW = 1040;
    const targetH = 680;
    const LEGEND_W = 255;
    const LEGEND_H = 185;
    const MARGIN = 16;

    let printScale = 1.0;
    let panX = 0;
    let panY = 0;

    if (this.orientation === 'horizontal') {
      // In horizontal tree mode, nodes branch rightwards
      const availW = targetW - LEGEND_W - (MARGIN * 2);
      const availH = targetH - (MARGIN * 2);
      printScale = Math.min(1.0, availW / treeW, availH / treeH);
      printScale = Math.max(0.18, printScale);
      panX = -minCardX * printScale + LEGEND_W + MARGIN;
      panY = -minCardY * printScale + MARGIN + Math.max(0, (availH - (treeH * printScale)) / 2);
    } else {
      // Vertical tree mode
      const rightAvailW = targetW - LEGEND_W - (MARGIN * 2);
      const availH = targetH - (MARGIN * 2);

      // If tree fits comfortably to the right of the legend (like PD2603245 in user sample)
      if (treeW <= rightAvailW) {
        printScale = Math.min(1.0, rightAvailW / treeW, availH / treeH);
        printScale = Math.max(0.18, printScale);
        panX = -minCardX * printScale + LEGEND_W + MARGIN + Math.max(0, (rightAvailW - (treeW * printScale)) / 2);
        panY = -minCardY * printScale + MARGIN + Math.max(0, (availH - (treeH * printScale)) / 2);
      } else {
        // Wide tree (like PD2519323 with multiple children)
        const fullAvailW = targetW - (MARGIN * 2);
        const belowAvailH = targetH - LEGEND_H - (MARGIN * 2);
        const scaleBelow = Math.min(1.0, fullAvailW / treeW, belowAvailH / treeH);
        const scaleFull = Math.min(1.0, fullAvailW / treeW, availH / treeH);

        if (scaleBelow >= 0.38 || (scaleBelow / scaleFull) >= 0.7) {
          // Position comfortably below the top-left legend
          printScale = Math.max(0.18, scaleBelow);
          const renderedW = treeW * printScale;
          panX = -minCardX * printScale + MARGIN + Math.max(0, (fullAvailW - renderedW) / 2);
          panY = -minCardY * printScale + LEGEND_H + MARGIN;
        } else {
          // Use full height, root centered horizontally across page
          printScale = Math.max(0.18, scaleFull);
          const renderedW = treeW * printScale;
          panX = -minCardX * printScale + MARGIN + Math.max(0, (fullAvailW - renderedW) / 2);
          panY = -minCardY * printScale + MARGIN;
        }
      }
    }

    // Set CSS custom properties on documentElement for @media print
    document.documentElement.style.setProperty('--tree-print-scale', String(printScale));
    document.documentElement.style.setProperty('--tree-print-pan-x', `${panX}px`);
    document.documentElement.style.setProperty('--tree-print-pan-y', `${panY}px`);

    this.scale = printScale;
    this.panX = panX;
    this.panY = panY;
    this.applyTransform();
  }

  restoreAfterPrint() {
    // Delay clean-up so Chrome / Safari print preview generation is never interrupted or raced
    setTimeout(() => {
      this._isPrinting = false;
      document.body.classList.remove('printing-assembly-tree');
      document.documentElement.style.removeProperty('--tree-print-scale');
      document.documentElement.style.removeProperty('--tree-print-pan-x');
      document.documentElement.style.removeProperty('--tree-print-pan-y');

      if (this._savedPrintState) {
        this.scale = this._savedPrintState.scale;
        this.panX = this._savedPrintState.panX;
        this.panY = this._savedPrintState.panY;
        this._savedPrintState = null;
        this.applyTransform();
      }
    }, 600);
  }

  print() {
    this._isPrinting = false;
    this.prepareForPrint();
    setTimeout(() => {
      window.print();
    }, 200);
  }

  selectAssembly(woId) {
    this.selectedWoId = woId;
    this.focusedWoId = woId;
    this.collapsedNodes.clear();
    this.sidebarExpandedNodes.clear();
    this.hideSearchDropdown();
    this.hideSidebarMainPdDropdown();
    if (this.searchInput) this.searchInput.blur();
    if (this.sidebarMainPdInput) this.sidebarMainPdInput.blur();
    this.render();
    this.renderSidebarTreeView();
    this.fitView();
  }

  fitView() {
    const cards = this.nodesContainer ? this.nodesContainer.querySelectorAll('.assembly-node-card') : [];
    if (cards.length > 0 && this.canvasContainer) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      cards.forEach(card => {
        const left = parseFloat(card.style.left) || 0;
        const top = parseFloat(card.style.top) || 0;
        const w = parseFloat(card.style.width) || 190;
        const h = parseFloat(card.style.height) || 80;
        if (left < minX) minX = left;
        if (top < minY) minY = top;
        if (left + w > maxX) maxX = left + w;
        if (top + h > maxY) maxY = top + h;
      });

      const containerW = this.canvasContainer.clientWidth || 1000;
      const containerH = this.canvasContainer.clientHeight || 600;
      const contentW = Math.max(200, maxX - minX + 60);
      const contentH = Math.max(100, maxY - minY + 60);

      const scaleW = (containerW - 80) / contentW;
      const scaleH = (containerH - 80) / contentH;
      const optimalScale = Math.min(1.0, scaleW, scaleH);

      this.scale = Math.max(0.3, Math.min(1.05, optimalScale));
      if (this.orientation === 'vertical') {
        this.panX = Math.max(20, -minX * this.scale + 230);
        this.panY = Math.max(20, -minY * this.scale + 30);
      } else {
        this.panX = Math.max(20, -minX * this.scale + 40);
        this.panY = Math.max(20, -minY * this.scale + 30);
      }
    } else {
      if (this.orientation === 'vertical') {
        this.panX = 180;
        this.panY = 20;
        this.scale = 0.95;
      } else {
        this.panX = 40;
        this.panY = 30;
        this.scale = 0.95;
      }
    }
    this.applyTransform();
  }

  // Builds the cross-PD assembly graph from:
  // 1. state.assemblyLinks (scheduled & custom assembly links)
  // 2. state.planMaterials & dwgToPdMap (mechanical/welding assembly BOMs from Plan + Mat)
  // 3. Hierarchical dash suffixes (e.g. PDxxx-1 -> PDxxx)
  getAssemblyGraph() {
    if (this._cachedGraph) return this._cachedGraph;

    const indexes = this.getIndexMaps();
    const parentOf = new Map();   // childWoId -> parentWoId
    const childrenOf = new Map(); // parentWoId -> Set<childWoId>
    const allWoIds = new Set();

    const addLink = (parentWo, childWo) => {
      if (!parentWo || !childWo || parentWo === childWo) return;
      allWoIds.add(parentWo);
      allWoIds.add(childWo);
      if (!parentOf.has(childWo)) parentOf.set(childWo, parentWo);
      let set = childrenOf.get(parentWo);
      if (!set) {
        set = new Set();
        childrenOf.set(parentWo, set);
      }
      set.add(childWo);
    };

    // 1. Existing assemblyLinks
    (this.state.assemblyLinks || []).forEach(link => {
      const fromWo = (link.from || '').split('-')[0];
      const toWo = (link.to || '').split('-')[0];
      addLink(toWo, fromWo);
    });

    // 2. Plan + Mat (planMaterials & dwgToPdMap)
    // Brings in all related child PDs from materials (welding/mechanical assembly)
    if (this.state.planMaterials) {
      const dwgMap = this.state.dwgToPdMap || {};
      const knownJobs = indexes.knownJobs;

      for (const [parentWoId, mats] of Object.entries(this.state.planMaterials)) {
        if (!Array.isArray(mats) || mats.length === 0) continue;
        allWoIds.add(parentWoId);
        let hasAnyChild = false;
        for (const item of mats) {
          const matCode = String(item.mat || '').trim();
          if (!matCode) continue;

          let childWoId = dwgMap[matCode]?.pdId;
          if (!childWoId && knownJobs.has(matCode)) {
            const match = knownJobs.get(matCode);
            childWoId = match.woId || match.id;
          }

          if (childWoId && childWoId !== parentWoId) {
            addLink(parentWoId, childWoId);
            hasAnyChild = true;
          }
        }

        // Even if all items are raw materials, register that this parent has components
        if (!childrenOf.has(parentWoId)) {
          childrenOf.set(parentWoId, new Set());
        }
        if (!hasAnyChild && mats.length > 0) {
          childrenOf.get(parentWoId).add('RAW_' + parentWoId);
        }
      }
    }

    // 3. Hierarchical dash suffixes (e.g. PD25001-1 is child of PD25001)
    const allKnownSet = new Set([
      ...indexes.allKnownIds,
      ...allWoIds
    ]);
    for (const id of allKnownSet) {
      if (id.includes('-')) {
        const lastDash = id.lastIndexOf('-');
        const parentPrefix = id.substring(0, lastDash);
        if (allKnownSet.has(parentPrefix) && !parentOf.has(id)) {
          addLink(parentPrefix, id);
        }
      }
    }

    this._cachedGraph = { parentOf, childrenOf, allWoIds };
    return this._cachedGraph;
  }

  // True if this assembly (root PD) or any of its sub-PDs has at least one
  // scheduled job passing the current Priority/Project/Customer/Work Center
  // filters set from the Resources tab.
  hasAnyVisibleJobInFamily(rootWoId, childrenOf) {
    if (this.state.assemblyListFollowsFilters === false) return true; // filtering turned off
    const indexes = this.getIndexMaps();
    const queue = [rootWoId];
    const visited = new Set([rootWoId]);
    let hasAnyScheduled = false;

    while (queue.length > 0) {
      const cur = queue.shift();
      const jobs = indexes.jobsByWoId.get(cur);
      if (jobs && jobs.length > 0) {
        hasAnyScheduled = true;
        const isVis = jobs.some(j =>
          isJobPriorityVisible(j, this.state) &&
          isJobProjectVisible(j, this.state) &&
          isJobCustomerVisible(j, this.state) &&
          this.state.activeWorkCenters[j.machine] !== false
        );
        if (isVis) return true;
      }
      const kids = childrenOf ? childrenOf.get(cur) : null;
      if (kids) {
        for (const k of kids) {
          if (!visited.has(k)) {
            visited.add(k);
            queue.push(k);
          }
        }
      }
    }
    if (!hasAnyScheduled) return true; // nothing scheduled yet - don't hide it
    return false;
  }

  getAllAssemblies() {
    if (this._cachedAssemblies) return this._cachedAssemblies;

    const { parentOf, childrenOf, allWoIds } = this.getAssemblyGraph();
    const indexes = this.getIndexMaps();

    const scheduledWoIds = indexes.jobsByWoId;
    const backlogWoIds = indexes.backlogByWoId;

    const rootAssemblies = [];
    const subAssemblies = [];

    for (const woId of allWoIds) {
      const kids = childrenOf.get(woId);
      if (kids && kids.size > 0) {
        if (!this.hasAnyVisibleJobInFamily(woId, childrenOf)) continue;

        const jobs = indexes.jobsByWoId.get(woId) || [];
        const backlog = indexes.backlogByWoId.get(woId);
        const dwgInfo = indexes.pdToDwgInfo.get(woId);
        const dwgNo = jobs[0]?.dwgNo || backlog?.dwgNo || dwgInfo?.dwgNo || '';
        const partName = jobs[0]?.partName || backlog?.partName || dwgInfo?.partName || woId;

        const item = { id: woId, partName, dwgNo, isRoot: !parentOf.has(woId) };
        if (!parentOf.has(woId)) {
          rootAssemblies.push(item);
        } else {
          subAssemblies.push(item);
        }
      }
    }

    // Prioritize assemblies that currently have scheduled or backlog jobs, then sort by ID
    const sortFn = (a, b) => {
      const aLive = scheduledWoIds.has(a.id) || backlogWoIds.has(a.id) ? 1 : 0;
      const bLive = scheduledWoIds.has(b.id) || backlogWoIds.has(b.id) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      return a.id.localeCompare(b.id);
    };

    rootAssemblies.sort(sortFn);
    subAssemblies.sort(sortFn);

    const assemblies = [...rootAssemblies, ...subAssemblies];

    if (assemblies.length === 0) {
      // No assembly links recorded yet - fall back to any WO so the tab isn't blank.
      const anyWoIds = indexes.allKnownIds;
      if (anyWoIds.size > 0) {
        const first = Array.from(anyWoIds)[0];
        const jobs = indexes.jobsByWoId.get(first) || [];
        const backlog = indexes.backlogByWoId.get(first);
        const dwgInfo = indexes.pdToDwgInfo.get(first);
        assemblies.push({
          id: first,
          partName: jobs[0]?.partName || backlog?.partName || dwgInfo?.partName || first,
          dwgNo: jobs[0]?.dwgNo || backlog?.dwgNo || dwgInfo?.dwgNo || '',
          isRoot: true
        });
      }
    }

    this._cachedAssemblies = assemblies;
    return assemblies;
  }

  // Builds the hierarchical BOM tree starting recursively from rootWoId
  // Includes Child PDs, Warehouse Raw Materials (วัตถุดิบคลัง), and sub-level parts
  buildAssemblyTree(rootWoId) {
    if (!rootWoId) return { rootTree: null, allTreeNodes: [] };

    const cacheKey = `${rootWoId}_${this.showRawMaterials}`;
    if (this._cachedTreeNodes.has(cacheKey)) {
      return this._cachedTreeNodes.get(cacheKey);
    }

    const indexes = this.getIndexMaps();
    const dwgMap = this.state.dwgToPdMap || {};
    const knownJobs = indexes.knownJobs;
    const allKnown = indexes.allKnownIds;

    const getComponentsForWo = (woId) => {
      const mats = this.state.planMaterials?.[woId] || [];
      const childPds = [];
      const rawMats = new Map();
      const seenPds = new Set();

      for (const item of mats) {
        const matCode = String(item.mat || '').trim();
        if (!matCode) continue;
        let childPdId = dwgMap[matCode]?.pdId;
        if (!childPdId && knownJobs.has(matCode)) {
          const match = knownJobs.get(matCode);
          childPdId = match.woId || match.id;
        }
        if (childPdId && childPdId !== woId) {
          if (!seenPds.has(childPdId)) {
            seenPds.add(childPdId);
            childPds.push({ pdId: childPdId, matCode, item });
          }
        } else {
          if (!rawMats.has(matCode)) {
            rawMats.set(matCode, { ...item });
          } else {
            const existing = rawMats.get(matCode);
            existing.estimatedQty = Math.max(existing.estimatedQty || 0, item.estimatedQty || 0);
            existing.actualQty = Math.max(existing.actualQty || 0, item.actualQty || 0);
            existing.toIssue = Math.max(existing.toIssue || 0, item.toIssue || 0);
            if (item.operStatus && !existing.operStatus) existing.operStatus = item.operStatus;
          }
        }
      }

      // Also check assemblyLinks for links not in planMaterials
      (this.state.assemblyLinks || []).forEach(link => {
        const fromWo = (link.from || '').split('-')[0];
        const toWo = (link.to || '').split('-')[0];
        if (toWo === woId && fromWo && fromWo !== woId && !seenPds.has(fromWo)) {
          seenPds.add(fromWo);
          childPds.push({ pdId: fromWo, matCode: '', item: null });
        }
      });

      // Also check hierarchical dash suffixes (e.g. PDxxx-1 is child of PDxxx)
      for (const id of allKnown) {
        if (id.includes('-')) {
          const lastDash = id.lastIndexOf('-');
          const parentPrefix = id.substring(0, lastDash);
          if (parentPrefix === woId && !seenPds.has(id)) {
            seenPds.add(id);
            childPds.push({ pdId: id, matCode: '', item: null });
          }
        }
      }

      return { childPds, rawList: Array.from(rawMats.values()) };
    };

    const createPdNode = (id, nodeKey, depth, parentKey) => {
      const jobs = indexes.jobsByWoId.get(id) || [];
      const backlog = indexes.backlogByWoId.get(id);

      let dwgNo = jobs[0]?.dwgNo || backlog?.dwgNo || '';
      let dwgInfo = dwgNo ? dwgMap[dwgNo] : indexes.pdToDwgInfo.get(id);
      if (!dwgNo && dwgInfo) {
        dwgNo = dwgInfo.dwgNo || '';
      }

      let partName = jobs[0]?.partName || backlog?.partName || dwgInfo?.partName;
      if (!partName) {
        const mats = this.state.planMaterials?.[id];
        if (Array.isArray(mats) && mats.length > 0) {
          const directMatch = mats.find(m => m.matDesc);
          if (directMatch) partName = directMatch.matDesc;
        }
      }
      if (!partName) partName = id;

      const totalSteps = jobs.length + (backlog ? backlog.steps.length : 0);
      const completedSteps = jobs.filter(j => j.status === 'Completed').length;
      const isRunning = jobs.some(j => j.status === 'Running' || j.status === 'Setup');
      const isComplete = totalSteps > 0 && completedSteps === totalSteps;

      const isCompletedHistory = typeof this.state.isPdInCompletedHistory === 'function' ? this.state.isPdInCompletedHistory(id) : false;
      const orderStatusStr = String(dwgInfo?.orderStatus || '').toLowerCase();

      let status = 'waiting';
      if (isComplete || isCompletedHistory || orderStatusStr === 'released' || orderStatusStr === 'closed') {
        status = 'released';
      } else if (isRunning || completedSteps > 0 || orderStatusStr === 'active' || orderStatusStr === 'running') {
        status = 'working';
      }

      let stepNames = jobs.map(j => j.stepName || j.name || j.machine).filter(Boolean);
      if (stepNames.length === 0 && dwgInfo && Array.isArray(dwgInfo.operations)) {
        stepNames = dwgInfo.operations.map(o => o.name || o.machine).filter(Boolean);
      }
      if (stepNames.length === 0 && backlog && Array.isArray(backlog.steps)) {
        stepNames = backlog.steps.map(s => s.name || s.machine).filter(Boolean);
      }

      return {
        id,
        nodeKey,
        displayId: id,
        partName,
        dwgNo,
        depth,
        parentId: parentKey,
        isRawMat: false,
        status,
        totalSteps,
        completedSteps,
        stepNames: stepNames.length > 0 ? stepNames.slice(0, 3).join(', ') : (orderStatusStr ? orderStatusStr.toUpperCase() : 'ASSEMBLY'),
        qty: jobs[0]?.qty || backlog?.qty || 1,
        children: []
      };
    };

    const allTreeNodes = [];
    const buildSubTree = (woId, parentKey, depth, visitedAncestorIds) => {
      const nodeKey = parentKey ? `${parentKey}_${woId}` : woId;
      const node = createPdNode(woId, nodeKey, depth, parentKey);
      allTreeNodes.push(node);

      if (visitedAncestorIds.has(woId)) {
        node.hasChildren = false;
        return node;
      }

      const nextAncestors = new Set(visitedAncestorIds);
      nextAncestors.add(woId);

      const comp = getComponentsForWo(woId);

      // 1. Child PDs (Level 1, Level 2, etc.)
      comp.childPds.forEach(child => {
        const childNode = buildSubTree(child.pdId, nodeKey, depth + 1, nextAncestors);
        node.children.push(childNode);
      });

      // 2. Warehouse Raw Materials (วัตถุดิบคลัง)
      if (this.showRawMaterials && comp.rawList.length > 0) {
        if (comp.rawList.length <= 2) {
          comp.rawList.forEach((raw, idx) => {
            const rawKey = `${nodeKey}_RAW_${raw.mat || idx}`;
            const isIssued = raw.toIssue === 0 && (raw.actualQty > 0 || raw.estimatedQty > 0 || raw.toIssueWh > 0);
            const rawStatus = isIssued ? 'released' : (raw.toIssue > 0 ? 'working' : 'released');
            const statusLabel = isIssued ? '✓ จ่ายครบแล้ว' : (raw.toIssue > 0 ? `⏳ รอเบิก (${raw.toIssue})` : '✓ พร้อมใช้งาน');

            const rawNode = {
              id: raw.mat || 'RAW',
              nodeKey: rawKey,
              displayId: 'วัตถุดิบคลัง',
              dwgNo: raw.mat || '',
              partName: raw.matDesc || 'วัตถุดิบคลัง',
              depth: depth + 1,
              parentId: nodeKey,
              parentWoId: woId,
              isRawMat: true,
              status: rawStatus,
              stepNames: `${statusLabel} (x${raw.estimatedQty || raw.actualQty || 1})`,
              qty: raw.estimatedQty || 1,
              hasChildren: false,
              children: []
            };
            allTreeNodes.push(rawNode);
            node.children.push(rawNode);
          });
        } else {
          const rawKey = `${nodeKey}_RAW_GROUP`;
          const allIssued = comp.rawList.every(r => r.toIssue === 0);
          const issuedCount = comp.rawList.filter(r => r.toIssue === 0).length;
          const sampleDesc = comp.rawList.slice(0, 3).map(r => r.matDesc?.split(' ')[0] || r.mat).join(', ') + '...';
          const rawStatus = allIssued ? 'released' : 'working';
          const statusLabel = allIssued ? `✓ จ่ายครบ (${comp.rawList.length} รายการ)` : `จ่ายแล้ว ${issuedCount}/${comp.rawList.length}`;

          const rawNode = {
            id: `RAW_${woId}`,
            nodeKey: rawKey,
            displayId: 'วัตถุดิบคลัง',
            dwgNo: `พบ ${comp.rawList.length} รายการ`,
            partName: sampleDesc,
            depth: depth + 1,
            parentId: nodeKey,
            parentWoId: woId,
            isRawMat: true,
            status: rawStatus,
            stepNames: statusLabel,
            qty: comp.rawList.length,
            hasChildren: false,
            rawItems: comp.rawList,
            children: []
          };
          allTreeNodes.push(rawNode);
          node.children.push(rawNode);
        }
      }

      node.hasChildren = node.children.length > 0;
      return node;
    };

    const rootTree = buildSubTree(rootWoId, null, 0, new Set());
    const result = { rootTree, allTreeNodes };
    this._cachedTreeNodes.set(cacheKey, result);
    return result;
  }

  // Counts, among a root's sub-PDs (every family node below depth 0), how many have
  // actually started production.
  getSubPdProgress(rootWoId) {
    if (!rootWoId) return { progressed: 0, total: 0 };
    if (this._cachedProgress.has(rootWoId)) {
      return this._cachedProgress.get(rootWoId);
    }

    const { allTreeNodes } = this.buildAssemblyTree(rootWoId);
    const subNodes = allTreeNodes.filter(n => n.depth > 0 && !n.isRawMat);
    const total = subNodes.length;
    let progressed = 0;
    const indexes = this.getIndexMaps();

    subNodes.forEach(n => {
      if (n.status === 'released') {
        progressed++;
        return;
      }
      const jobs = indexes.jobsByWoId.get(n.id) || [];
      const hasProgress = jobs.some(j =>
        j.status === 'Running' || j.status === 'Setup' || j.status === 'Paused' || j.status === 'Completed'
      );
      if (hasProgress) progressed++;
    });

    const res = { progressed, total };
    this._cachedProgress.set(rootWoId, res);
    return res;
  }

  // --- BOM Explorer Methods ---

  formatBomQty(val) {
    if (val == null || isNaN(val)) return '0';
    const num = Number(val);
    if (Number.isInteger(num)) return num.toLocaleString('th-TH');
    return Number(num.toFixed(3)).toLocaleString('th-TH', { maximumFractionDigits: 3 });
  }

  collectBomItems(rootWoId) {
    if (!rootWoId) return [];

    const { allTreeNodes } = this.buildAssemblyTree(rootWoId);
    const pdNodes = allTreeNodes.filter(n => !n.isRawMat);
    const indexes = this.getIndexMaps();
    const dwgMap = this.state.dwgToPdMap || {};
    const knownJobs = indexes.knownJobs;
    const planMaterials = this.state.planMaterials || {};

    const items = [];
    const seenItems = new Set();

    for (const node of pdNodes) {
      const pdId = node.id;
      const depth = node.depth;
      const mats = planMaterials[pdId] || [];

      // Group by Mat code within this PD to avoid duplicating routing operations
      const matMap = new Map();
      for (const m of mats) {
        const matCode = String(m.mat || '').trim();
        if (!matCode) continue;

        let childPdId = dwgMap[matCode]?.pdId;
        if (!childPdId && knownJobs.has(matCode)) {
          const match = knownJobs.get(matCode);
          childPdId = match.woId || match.id;
        }
        const isChildPd = Boolean(childPdId && childPdId !== pdId);

        if (!matMap.has(matCode)) {
          matMap.set(matCode, {
            pdId,
            depth,
            parentPdId: node.parentId,
            mat: matCode,
            matDesc: m.matDesc || '',
            wc: m.wc || '',
            wcList: m.wc ? [m.wc] : [],
            stepNum: m.stepNum,
            stepList: m.stepNum ? [m.stepNum] : [],
            operDesc: m.operDesc || '',
            estimatedQty: Number(m.estimatedQty) || 0,
            actualQty: Number(m.actualQty) || 0,
            toIssue: Number(m.toIssue) || 0,
            toIssueWh: Number(m.toIssueWh) || 0,
            operStatus: m.operStatus || '',
            orderStatus: m.orderStatus || '',
            isChildPd,
            childPdId: isChildPd ? childPdId : null,
            drawingNo: dwgMap[matCode]?.dwgNo || ''
          });
        } else {
          const existing = matMap.get(matCode);
          existing.estimatedQty = Math.max(existing.estimatedQty, Number(m.estimatedQty) || 0);
          existing.actualQty = Math.max(existing.actualQty, Number(m.actualQty) || 0);
          existing.toIssue = Math.max(existing.toIssue, Number(m.toIssue) || 0);
          if (m.wc && !existing.wcList.includes(m.wc)) existing.wcList.push(m.wc);
          if (m.stepNum && !existing.stepList.includes(m.stepNum)) existing.stepList.push(m.stepNum);
          if (m.matDesc && !existing.matDesc) existing.matDesc = m.matDesc;
          if (m.operStatus && !existing.operStatus) existing.operStatus = m.operStatus;
        }
      }

      for (const item of matMap.values()) {
        const itemKey = `${item.pdId}_${item.mat}`;
        if (seenItems.has(itemKey)) continue;
        seenItems.add(itemKey);

        // Status classification: completed vs in_progress vs to_issue
        if (item.isChildPd && item.childPdId) {
          const childJobs = indexes.jobsByWoId.get(item.childPdId) || [];
          const childBacklog = indexes.backlogByWoId.get(item.childPdId);
          const childDwgInfo = dwgMap[item.mat] || indexes.pdToDwgInfo.get(item.childPdId);

          const totalSteps = childJobs.length + (childBacklog ? childBacklog.steps.length : 0);
          const completedSteps = childJobs.filter(j => j.status === 'Completed').length;
          const isRunning = childJobs.some(j => j.status === 'Running' || j.status === 'Setup' || j.status === 'Paused');
          const isComplete = totalSteps > 0 && completedSteps === totalSteps;
          const isCompletedHistory = typeof this.state.isPdInCompletedHistory === 'function' ? this.state.isPdInCompletedHistory(item.childPdId) : false;
          const orderStatusStr = String(childDwgInfo?.orderStatus || '').toLowerCase();

          if (isComplete || isCompletedHistory || orderStatusStr === 'closed' || orderStatusStr === 'completed' || orderStatusStr === 'released') {
            item.status = 'completed';
            item.statusText = totalSteps > 0 ? `✅ ผลิตเสร็จ (${completedSteps}/${totalSteps})` : '✅ ผลิตเสร็จสิ้น';
          } else if (isRunning || completedSteps > 0 || orderStatusStr === 'active' || orderStatusStr === 'running') {
            item.status = 'in_progress';
            item.statusText = totalSteps > 0 ? `⏳ กำลังผลิต (${completedSteps}/${totalSteps})` : '⏳ กำลังผลิต';
          } else {
            item.status = 'in_progress';
            item.statusText = '⏳ อยู่ในแผนการผลิต';
          }
        } else {
          // Raw Material / Warehouse part status
          if (item.toIssue > 0) {
            item.status = 'to_issue';
            item.statusText = `⚠️ รอเบิก (${this.formatBomQty(item.toIssue)})`;
          } else if (item.toIssue === 0 && (item.actualQty > 0 || item.operStatus === 'Completed' || (item.actualQty >= item.estimatedQty && item.estimatedQty > 0))) {
            item.status = 'completed';
            item.statusText = '✅ เบิกครบแล้ว';
          } else if (item.actualQty > 0 && item.actualQty < item.estimatedQty) {
            item.status = 'in_progress';
            item.statusText = `⏳ เบิกบางส่วน (${this.formatBomQty(item.actualQty)}/${this.formatBomQty(item.estimatedQty)})`;
          } else if (item.operStatus === 'Active' || item.operStatus === 'Running' || item.operStatus === 'Ready to Start') {
            item.status = 'in_progress';
            item.statusText = `⏳ ${item.operStatus}`;
          } else if (item.toIssue === 0) {
            item.status = 'completed';
            item.statusText = '✅ พร้อมใช้งาน';
          } else {
            item.status = 'in_progress';
            item.statusText = '⏳ รอดำเนินการ';
          }
        }

        items.push(item);
      }
    }

    return items;
  }

  async showBomModal(targetWoId = null) {
    if (this.bomModal) {
      this.bomModal.classList.remove('hidden');
    }

    // 1. Ensure planMaterials is loaded
    if ((!this.state.planMaterials || Object.keys(this.state.planMaterials).length === 0) && this.state.storageSync?.fetchPlanMaterials) {
      if (this.bomTableBody) {
        this.bomTableBody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align: center; padding: 40px; color: var(--accent-teal); font-size: 13px;">
              <div style="font-size: 28px; margin-bottom: 8px;">⏳</div>
              <div style="font-weight: 600;">กำลังโหลดข้อมูลรายการวัสดุและ BOM จากระบบ...</div>
            </td>
          </tr>
        `;
      }
      await this.state.storageSync.fetchPlanMaterials();
      this.invalidateCache();
      this.allAssemblies = this.getAllAssemblies();
    }

    if (!this.allAssemblies || this.allAssemblies.length === 0) {
      this.allAssemblies = this.getAllAssemblies();
    }
    const woId = targetWoId || this.selectedWoId || (this.allAssemblies && this.allAssemblies[0]?.id);
    if (!woId) {
      if (this.bomTableBody) {
        this.bomTableBody.innerHTML = `
          <tr>
            <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary); font-size: 13px;">
              <div style="font-size: 28px; margin-bottom: 8px;">ℹ️</div>
              <div>ไม่พบชุดประกอบ (Assembly) ในระบบ กรุณาเลือกหรือระบุเลขที่ PD ก่อน</div>
            </td>
          </tr>
        `;
      }
      return;
    }

    this.bomActivePdId = woId;
    this.bomActiveStatusFilter = 'all';
    this.bomSearchTerm = '';
    if (this.bomSearchInput) this.bomSearchInput.value = '';
    if (this.bomScopeSelect) this.bomScopeSelect.value = this.bomScope || 'all';

    // Populate PD selector in modal
    if (this.bomPdSelect && this.allAssemblies) {
      this.bomPdSelect.innerHTML = this.allAssemblies.map(a => `
        <option value="${a.id}" ${a.id === woId ? 'selected' : ''}>
          ${a.id}${a.dwgNo ? ` (${a.dwgNo})` : ''} - ${a.partName}
        </option>
      `).join('');
    }

    // Update header badge & desc
    const currentAssembly = (this.allAssemblies || []).find(a => a.id === woId);
    if (this.bomPdBadge) {
      this.bomPdBadge.textContent = woId;
    }
    if (this.bomPdDesc) {
      const desc = currentAssembly ? `${currentAssembly.partName}${currentAssembly.dwgNo ? ` | Drawing: ${currentAssembly.dwgNo}` : ''}` : woId;
      this.bomPdDesc.textContent = desc;
    }

    // Clear specific cached nodes so fresh planMaterials is reflected
    this._cachedTreeNodes.delete(`${woId}_${this.showRawMaterials}`);
    this._cachedTreeNodes.delete(`${woId}_false`);
    this._cachedTreeNodes.delete(`${woId}_true`);

    // Collect BOM items
    this.bomCachedItems = this.collectBomItems(woId);

    // Render table & stats
    this.renderBomTable();
  }

  hideBomModal() {
    if (this.bomModal) {
      this.bomModal.classList.add('hidden');
    }
  }

  renderBomTable() {
    if (!this.bomTableBody) return;

    const allItems = this.bomCachedItems || [];

    // 1. Filter by Scope (all levels vs main PD only)
    const scopedItems = this.bomScope === 'main'
      ? allItems.filter(item => item.depth === 0)
      : allItems;

    // 2. Compute summary counts based on scopedItems
    const totalCount = scopedItems.length;
    const completedCount = scopedItems.filter(i => i.status === 'completed').length;
    const inProgressCount = scopedItems.filter(i => i.status === 'in_progress').length;
    const toIssueCount = scopedItems.filter(i => i.status === 'to_issue').length;

    // Update stat cards
    if (this.bomStatTotal) this.bomStatTotal.textContent = totalCount.toLocaleString();
    if (this.bomStatCompleted) this.bomStatCompleted.textContent = completedCount.toLocaleString();
    if (this.bomStatProgress) this.bomStatProgress.textContent = inProgressCount.toLocaleString();
    if (this.bomStatToIssue) this.bomStatToIssue.textContent = toIssueCount.toLocaleString();

    // Update filter button count badges
    if (this.bomFilterCountAll) this.bomFilterCountAll.textContent = totalCount.toLocaleString();
    if (this.bomFilterCountCompleted) this.bomFilterCountCompleted.textContent = completedCount.toLocaleString();
    if (this.bomFilterCountProgress) this.bomFilterCountProgress.textContent = inProgressCount.toLocaleString();
    if (this.bomFilterCountToIssue) this.bomFilterCountToIssue.textContent = toIssueCount.toLocaleString();

    // Update active state on filter buttons
    const filterBtns = this.bomModal?.querySelectorAll('.bom-status-filter-btn') || [];
    filterBtns.forEach(btn => {
      const f = btn.getAttribute('data-filter');
      if (f === this.bomActiveStatusFilter) {
        btn.classList.add('active');
        btn.style.borderColor = '#0284c7';
        btn.style.background = 'rgba(2, 132, 199, 0.16)';
        btn.style.color = '#0369a1';
        btn.style.fontWeight = '800';
      } else {
        btn.classList.remove('active');
        btn.style.borderColor = '#cbd5e1';
        btn.style.background = 'transparent';
        btn.style.color = '#334155';
        btn.style.fontWeight = '700';
      }
    });

    // 3. Filter by active status
    let filtered = scopedItems;
    if (this.bomActiveStatusFilter === 'completed') {
      filtered = filtered.filter(i => i.status === 'completed');
    } else if (this.bomActiveStatusFilter === 'in_progress') {
      filtered = filtered.filter(i => i.status === 'in_progress');
    } else if (this.bomActiveStatusFilter === 'to_issue') {
      filtered = filtered.filter(i => i.status === 'to_issue');
    }

    // 4. Filter by search query
    if (this.bomSearchTerm) {
      const term = this.bomSearchTerm.toLowerCase();
      filtered = filtered.filter(i =>
        (i.mat || '').toLowerCase().includes(term) ||
        (i.matDesc || '').toLowerCase().includes(term) ||
        (i.pdId || '').toLowerCase().includes(term) ||
        (i.drawingNo || '').toLowerCase().includes(term) ||
        (i.wcList || []).some(w => (w || '').toLowerCase().includes(term)) ||
        (i.operDesc || '').toLowerCase().includes(term) ||
        (i.childPdId || '').toLowerCase().includes(term)
      );
    }

    // 5. Update footer stats
    if (this.bomFooterStats) {
      this.bomFooterStats.textContent = `แสดง ${filtered.length.toLocaleString()} จากทั้งหมด ${scopedItems.length.toLocaleString()} รายการ (เสร็จสิ้น ${completedCount.toLocaleString()}, กำลังดำเนินการ ${inProgressCount.toLocaleString()}, รอเบิก ${toIssueCount.toLocaleString()})`;
    }

    // 6. Render table rows
    if (filtered.length === 0) {
      const hasPlanMat = this.state.planMaterials && Object.keys(this.state.planMaterials).length > 0;
      if (scopedItems.length === 0) {
        this.bomTableBody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align: center; padding: 40px; color: var(--text-secondary); font-size: 13px;">
              <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
              <div style="margin-bottom: 12px; font-weight: 500;">${hasPlanMat ? `ไม่พบรายการวัสดุ/BOM สำหรับ PD ${this.bomActivePdId} ในฐานข้อมูล Plan + Mat (อาจเป็น PD ที่ยังไม่มี BOM ในไฟล์ Overview)` : 'ยังไม่ได้เชื่อมต่อหรือโหลดข้อมูล Plan + Mat เข้าสู่ระบบ'}</div>
              <button type="button" id="btn-reload-bom-cache" class="btn" style="padding: 7px 16px; font-size: 12px; font-weight: bold; background: rgba(0, 242, 254, 0.15); border: 1px solid var(--accent-teal); color: var(--accent-teal); border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                🔄 ดึงข้อมูล Plan + Mat ใหม่
              </button>
            </td>
          </tr>
        `;
        const btnReload = this.bomTableBody.querySelector('#btn-reload-bom-cache');
        if (btnReload) {
          btnReload.addEventListener('click', async () => {
            this.bomTableBody.innerHTML = `
              <tr>
                <td colspan="10" style="text-align: center; padding: 40px; color: var(--accent-teal); font-size: 13px;">
                  <div style="font-size: 32px; margin-bottom: 12px;">⏳</div>
                  <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px;">กำลังดึงและประมวลผลข้อมูล Plan + Mat...</div>
                  <div style="font-size: 12px; color: var(--text-secondary);">กำลังโหลดข้อมูล BOM จากไฟล์ Status Overview / แคชข้อมูล...</div>
                </td>
              </tr>
            `;
            let mats = null;
            if (this.state.storageSync?.fetchPlanMaterials) {
              mats = await this.state.storageSync.fetchPlanMaterials(true);
            }
            const count = mats ? Object.keys(mats).length : (this.state.planMaterials ? Object.keys(this.state.planMaterials).length : 0);
            if (count > 0) {
              if (this.state.storageSync?.showToast) {
                this.state.storageSync.showToast(`✅ โหลดข้อมูล Plan + Mat สำเร็จ (${count.toLocaleString()} รายการ PD)`, 'success');
              }
            } else {
              if (this.state.storageSync?.showToast) {
                this.state.storageSync.showToast('⚠️ ไม่สามารถดึงข้อมูล Plan + Mat ได้ กรุณาตรวจสอบการเชื่อมต่อหรือไฟล์ Status Overview', 'error');
              }
            }
            this.invalidateCache();
            this.allAssemblies = this.getAllAssemblies();
            await this.showBomModal(this.bomActivePdId);
          });
        }
      } else {
        this.bomTableBody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align: center; padding: 40px; color: var(--text-secondary); font-size: 13px;">
              <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
              <div>ไม่พบรายการ BOM ตามเงื่อนไขตัวกรอง</div>
            </td>
          </tr>
        `;
      }
      return;
    }

    this.bomTableBody.innerHTML = filtered.map((item, idx) => {
      const isRoot = item.depth === 0;
      const pdBadgeStyle = isRoot
        ? 'background: rgba(14, 165, 233, 0.16); color: #0369a1; border: 1px solid rgba(14, 165, 233, 0.45); font-weight: 800;'
        : 'background: rgba(168, 85, 247, 0.16); color: #6b21a8; border: 1px solid rgba(168, 85, 247, 0.45); font-weight: 800;';
      const pdBadgeText = item.pdId;

      let typeBadge = '';
      if (item.isChildPd) {
        typeBadge = `<span class="bom-child-pd-link" data-pd-id="${item.childPdId}" style="display: inline-block; font-size: 9.5px; font-weight: 800; padding: 2px 5px; border-radius: 4px; background: rgba(37, 99, 235, 0.15); color: #1d4ed8; border: 1px solid rgba(37, 99, 235, 0.4); cursor: pointer; white-space: nowrap;" title="คลิกเพื่อดูรายละเอียด PD ${item.childPdId}">ผลิต (${item.childPdId})</span>`;
      } else {
        typeBadge = `<span style="display: inline-block; font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(100, 116, 139, 0.15); color: #0f172a; border: 1px solid rgba(100, 116, 139, 0.35); white-space: nowrap;">วัตถุดิบ</span>`;
      }

      let statusBadge = '';
      if (item.status === 'completed') {
        statusBadge = `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 10.5px; background: rgba(16, 185, 129, 0.18); color: #047857; border: 1px solid rgba(16, 185, 129, 0.5);">${item.statusText}</span>`;
      } else if (item.status === 'to_issue') {
        statusBadge = `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 10.5px; background: rgba(239, 68, 68, 0.18); color: #b91c1c; border: 1px solid rgba(239, 68, 68, 0.5);">${item.statusText}</span>`;
      } else {
        statusBadge = `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 10.5px; background: rgba(245, 158, 11, 0.18); color: #92400e; border: 1px solid rgba(245, 158, 11, 0.5);">${item.statusText}</span>`;
      }

      // OP Name: shows clean operation name (e.g. ASSY ประกอบแมคคานิก, Laser, ทำสี) without work center code and without Step info
      let opName = item.operDesc || '';
      if (!opName && item.wc) {
        const wcObj = this.state.workCenters?.[item.wc];
        opName = wcObj?.name || '';
      }
      if (!opName && item.wcList && item.wcList.length > 0) {
        opName = item.wcList.map(w => this.state.workCenters?.[w]?.name || w).join(', ');
      }
      if (!opName) opName = '-';

      const toIssueColor = item.toIssue > 0 ? 'color: #b91c1c; font-weight: 800;' : 'color: #0f172a; font-weight: 700;';
      const actColor = (item.actualQty > 0 && item.actualQty >= item.estimatedQty) ? 'color: #047857; font-weight: 800;' : 'color: #0f172a; font-weight: 700;';

      return `
        <tr style="border-bottom: 1px solid #cbd5e1; transition: background 0.15s;" onmouseover="this.style.background='rgba(0,0,0,0.035)'" onmouseout="this.style.background=''">
          <td style="padding: 8px 4px; text-align: center; color: #0f172a; font-weight: 800; font-size: 11px;">${idx + 1}</td>
          <td style="padding: 8px 4px; text-align: center; white-space: nowrap;">
            ${typeBadge}
          </td>
          <td style="padding: 8px 4px; white-space: nowrap;">
            <span class="bom-row-pd-badge" data-pd-id="${item.pdId}" style="display: inline-block; font-size: 10.5px; padding: 2px 5px; border-radius: 4px; cursor: pointer; ${pdBadgeStyle}" title="คลิกเพื่อดูรายละเอียด PD Plan">${pdBadgeText}</span>
          </td>
          <td style="padding: 8px 6px;">
            <div style="font-weight: 800; color: #0f172a; font-size: 11px;">${opName}</div>
          </td>
          <td style="padding: 8px 6px; white-space: nowrap;">
            <code style="font-size: 10.5px; font-weight: 800; color: #0f172a; background: rgba(0,0,0,0.06); padding: 2px 5px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.12);">${item.mat}</code>
          </td>
          <td style="padding: 8px 10px;">
            <div style="font-weight: 700; color: #0f172a; font-size: 11.5px; word-break: break-word;">${item.matDesc || '-'}</div>
            ${item.drawingNo ? `<div style="font-size: 10.5px; color: #0369a1; font-weight: 700; font-family: monospace; margin-top: 2px;">Dwg: ${item.drawingNo}</div>` : ''}
          </td>
          <td style="padding: 8px 4px; text-align: right; font-weight: 800; color: #0f172a; font-family: monospace; font-size: 11px;">${this.formatBomQty(item.estimatedQty)}</td>
          <td style="padding: 8px 4px; text-align: right; ${actColor} font-family: monospace; font-size: 11px;">${this.formatBomQty(item.actualQty)}</td>
          <td style="padding: 8px 4px; text-align: right; ${toIssueColor} font-family: monospace; font-size: 11px;">${this.formatBomQty(item.toIssue)}</td>
          <td style="padding: 8px 6px; text-align: center;">${statusBadge}</td>
        </tr>
      `;
    }).join('');

    // Attach click events on row PD badges and Child PD links to open PD detail modal
    this.bomTableBody.querySelectorAll('.bom-row-pd-badge, .bom-child-pd-link').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const pd = badge.getAttribute('data-pd-id');
        if (pd && this.gantt && typeof this.gantt.showPDPlanModal === 'function') {
          this.gantt.showPDPlanModal(pd);
        }
      });
    });
  }

  exportBomCsv() {
    const allItems = this.bomCachedItems || [];
    const scopedItems = this.bomScope === 'main'
      ? allItems.filter(item => item.depth === 0)
      : allItems;

    let filtered = scopedItems;
    if (this.bomActiveStatusFilter === 'completed') {
      filtered = filtered.filter(i => i.status === 'completed');
    } else if (this.bomActiveStatusFilter === 'in_progress') {
      filtered = filtered.filter(i => i.status === 'in_progress');
    } else if (this.bomActiveStatusFilter === 'to_issue') {
      filtered = filtered.filter(i => i.status === 'to_issue');
    }

    if (this.bomSearchTerm) {
      const term = this.bomSearchTerm.toLowerCase();
      filtered = filtered.filter(i =>
        (i.mat || '').toLowerCase().includes(term) ||
        (i.matDesc || '').toLowerCase().includes(term) ||
        (i.pdId || '').toLowerCase().includes(term) ||
        (i.drawingNo || '').toLowerCase().includes(term) ||
        (i.wcList || []).some(w => (w || '').toLowerCase().includes(term)) ||
        (i.operDesc || '').toLowerCase().includes(term) ||
        (i.childPdId || '').toLowerCase().includes(term)
      );
    }

    if (filtered.length === 0) {
      alert('ไม่มีข้อมูลสำหรับ Export ตามเงื่อนไขปัจจุบัน');
      return;
    }

    const headers = [
      'ลำดับ',
      'ประเภท',
      'อยู่ใน PD',
      'OP',
      'รหัส Mat',
      'รายการวัสดุ',
      'Drawing No',
      'แผน (Estimated)',
      'เบิกจริง (Actual)',
      'ค้างจ่าย (To Issue)',
      'สถานะ'
    ];

    const escapeCsv = (str) => {
      if (str == null) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = filtered.map((item, idx) => {
      let opName = item.operDesc || '';
      if (!opName && item.wc) {
        opName = this.state.workCenters?.[item.wc]?.name || item.wc;
      }
      const typeStr = item.isChildPd ? `ชิ้นส่วนผลิต (${item.childPdId})` : 'วัตถุดิบคลัง';
      const cleanStatus = (item.statusText || item.status).replace(/[✅⏳⚠️]/g, '').trim();
      return [
        idx + 1,
        escapeCsv(typeStr),
        escapeCsv(item.pdId),
        escapeCsv(opName),
        escapeCsv(item.mat),
        escapeCsv(item.matDesc),
        escapeCsv(item.drawingNo),
        item.estimatedQty,
        item.actualQty,
        item.toIssue,
        escapeCsv(cleanStatus)
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BOM_${this.bomActivePdId}_${this.bomScope}_${this.bomActiveStatusFilter}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  render() {
    if (!this.container) return;

    const assemblies = this.getAllAssemblies();
    if (assemblies.length === 0) {
      if (this.nodesContainer) {
        this.nodesContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: #64748b; font-size: 14px;">ไม่พบชุดประกอบ (Assembly Set) ในระบบ กรุณานำเข้าข้อมูล PD หรือสร้างรายการใหม่</div>';
      }
      return;
    }

    // Keep the full list around for the search dropdown, and reflect the current
    // selection in the search box's text (only while the user isn't actively typing).
    this.allAssemblies = assemblies;
    const currentVal = this.selectedWoId;

    if (!currentVal) {
      if (this.searchInput && document.activeElement !== this.searchInput) {
        this.searchInput.value = '';
      }
      if (this.sidebarMainPdInput && document.activeElement !== this.sidebarMainPdInput) {
        this.sidebarMainPdInput.value = '';
      }
      if (this.headerPartNo) this.headerPartNo.textContent = '-';
      if (this.headerDesc) this.headerDesc.textContent = 'กรุณาระบุหรือเลือกเลขที่ PD Main เพื่อแสดงผังโครงสร้าง';
      if (this.treeFocusText) this.treeFocusText.textContent = '-';
      if (this.btnTreeResetFocus) this.btnTreeResetFocus.style.display = 'none';

      if (this.nodesContainer) {
        this.nodesContainer.innerHTML = `
          <div style="padding: 80px 20px; text-align: center; color: #64748b; font-size: 13px;">
            <div style="font-size: 40px; margin-bottom: 14px;">🌿</div>
            <div style="font-weight: 700; font-size: 16px; color: #1e293b; margin-bottom: 8px;">ผังโครงสร้างชุดประกอบ (Assembly Tree)</div>
            <div style="color: #64748b; max-width: 440px; margin: 0 auto; line-height: 1.6;">
              กรุณาระบุหรือเลือกเลขที่ PD ตัว Main จากช่องค้นหาด้านบน หรือเลือกจากแถบด้านซ้าย เพื่อดูผังโครงสร้างชุดประกอบ
            </div>
          </div>
        `;
      }
      if (this.svg) {
        this.svg.innerHTML = '';
      }
      return;
    }

    if (this.searchInput && document.activeElement !== this.searchInput) {
      const currentAssembly = assemblies.find(a => a.id === currentVal);
      this.searchInput.value = currentAssembly ? `${currentAssembly.id} - ${currentAssembly.partName}` : currentVal;
    }

    if (this.sidebarMainPdInput && document.activeElement !== this.sidebarMainPdInput) {
      const currentAssembly = assemblies.find(a => a.id === currentVal);
      this.sidebarMainPdInput.value = currentAssembly ? `${currentAssembly.id} - ${currentAssembly.partName}` : currentVal;
    }

    const rootWoId = currentVal;
    const activeWoId = this.focusedWoId || rootWoId;
    const isEnlarged = Boolean(this.focusedWoId && this.focusedWoId !== rootWoId);

    // Update board breadcrumb & reset focus button
    if (this.treeFocusText) {
      if (isEnlarged) {
        const focusedWo = (this.state.workOrders || []).find(w => String(w.id || w.woId) === String(activeWoId)) ||
                          (this.state.scheduledJobs || []).find(j => String(j.id || j.woId) === String(activeWoId));
        const pName = focusedWo ? (focusedWo.partName || focusedWo.partNo || '') : '';
        this.treeFocusText.textContent = `🔍 ภาพขยาย: ${activeWoId}${pName ? ` (${pName})` : ''}`;
      } else {
        this.treeFocusText.textContent = `🏢 ผังหลัก: ${rootWoId}`;
      }
    }
    if (this.btnTreeResetFocus) {
      this.btnTreeResetFocus.style.display = isEnlarged ? 'inline-flex' : 'none';
    }

    const { rootTree: tree, allTreeNodes: allNodes } = this.buildAssemblyTree(activeWoId);
    if (!tree) return;
    const rootNode = tree;

    // Update Top-Left Header Box
    if (this.headerPartNo) {
      this.headerPartNo.textContent = rootNode ? (rootNode.dwgNo && rootNode.dwgNo !== rootNode.id ? `${rootNode.id} (${rootNode.dwgNo})` : rootNode.id) : '-';
    }
    if (this.headerDesc) {
      this.headerDesc.textContent = rootNode ? `${rootNode.partName} | ${rootNode.stepNames}` : '';
    }

    // Calculate layout positions based on orientation (Horizontal Tree vs Vertical Tree)
    const isHor = this.orientation === 'horizontal';
    const NODE_WIDTH = 190;
    const NODE_HEIGHT = 80;
    const H_GAP = isHor ? 100 : 30;
    const V_GAP = isHor ? 25 : 90;
    const START_X = isHor ? 280 : 260; // Leave margin for the Top-Left Legend box
    const START_Y = 40;

    // Filter out collapsed sub-trees
    const isVisible = (node) => {
      let p = node.parentId;
      while (p) {
        if (this.collapsedNodes.has(p)) return false;
        const parentNode = allNodes.find(n => n.nodeKey === p);
        p = parentNode ? parentNode.parentId : null;
      }
      return true;
    };

    if (isHor) {
      // Horizontal Tree: calculate subtree height recursively (sum of child heights + vertical gaps)
      const computeSubtreeHeight = (node) => {
        if (!isVisible(node)) return 0;
        const visibleChildren = node.children.filter(isVisible);
        if (visibleChildren.length === 0 || this.collapsedNodes.has(node.nodeKey)) {
          node.subtreeHeight = NODE_HEIGHT;
          return NODE_HEIGHT;
        }
        let height = 0;
        visibleChildren.forEach((child, idx) => {
          height += computeSubtreeHeight(child);
          if (idx < visibleChildren.length - 1) height += V_GAP;
        });
        node.subtreeHeight = Math.max(NODE_HEIGHT, height);
        return node.subtreeHeight;
      };

      computeSubtreeHeight(tree);

      // Assign (x, y) coordinates for Horizontal Tree (Root at left, children branch rightwards)
      const assignPositionsHor = (node, leftX, topY) => {
        if (!isVisible(node)) return;
        const visibleChildren = node.children.filter(isVisible);

        node.x = leftX;
        node.y = topY + (node.subtreeHeight / 2) - (NODE_HEIGHT / 2);

        if (!this.collapsedNodes.has(node.nodeKey) && visibleChildren.length > 0) {
          let currentY = topY;
          visibleChildren.forEach(child => {
            assignPositionsHor(child, leftX + NODE_WIDTH + H_GAP, currentY);
            currentY += child.subtreeHeight + V_GAP;
          });
        }
      };

      assignPositionsHor(tree, START_X, START_Y);
    } else {
      // Vertical Tree: calculate subtree width recursively (sum of child widths + horizontal gaps)
      const computeSubtreeWidth = (node) => {
        if (!isVisible(node)) return 0;
        const visibleChildren = node.children.filter(isVisible);
        if (visibleChildren.length === 0 || this.collapsedNodes.has(node.nodeKey)) {
          node.subtreeWidth = NODE_WIDTH;
          return NODE_WIDTH;
        }
        let width = 0;
        visibleChildren.forEach((child, idx) => {
          width += computeSubtreeWidth(child);
          if (idx < visibleChildren.length - 1) width += H_GAP;
        });
        node.subtreeWidth = Math.max(NODE_WIDTH, width);
        return node.subtreeWidth;
      };

      computeSubtreeWidth(tree);

      // Assign (x, y) coordinates for Vertical Tree (Root at top, children branch downwards)
      const assignPositionsVer = (node, leftX, topY) => {
        if (!isVisible(node)) return;
        const visibleChildren = node.children.filter(isVisible);

        node.x = leftX + (node.subtreeWidth / 2) - (NODE_WIDTH / 2);
        node.y = topY;

        if (!this.collapsedNodes.has(node.nodeKey) && visibleChildren.length > 0) {
          let currentX = leftX;
          visibleChildren.forEach(child => {
            assignPositionsVer(child, currentX, topY + NODE_HEIGHT + V_GAP);
            currentX += child.subtreeWidth + H_GAP;
          });
        }
      };

      assignPositionsVer(tree, START_X, START_Y);
    }

    // Render HTML Nodes & SVG Connectors
    let nodesHtml = '';
    const connectors = [];

    const collectRenderData = (node) => {
      if (!isVisible(node)) return;

      // Node Card Color Gradient based on status (Exact match with screenshot)
      let bgGradient = 'linear-gradient(to bottom, #ffffff 0%, #dcfce7 40%, #86efac 100%)';
      let borderColor = '#166534';
      let statusTextColor = '#14532d';

      if (node.status === 'working') {
        bgGradient = 'linear-gradient(to bottom, #ffffff 0%, #fef08a 40%, #fde047 100%)';
        borderColor = '#854d0e';
        statusTextColor = '#713f12';
      } else if (node.status === 'waiting') {
        bgGradient = 'linear-gradient(to bottom, #ffffff 0%, #fecaca 40%, #f87171 100%)';
        borderColor = '#991b1b';
        statusTextColor = '#7f1d1d';
      }

      const isCollapsed = this.collapsedNodes.has(node.nodeKey);
      const togglePosStyle = isHor
        ? 'position: absolute; right: -11px; top: 50%; transform: translateY(-50%);'
        : 'position: absolute; bottom: -11px; left: 50%; transform: translateX(-50%);';

      const expandBtnHtml = node.hasChildren ? `
        <button class="btn-tree-toggle" data-node-key="${node.nodeKey}" style="${togglePosStyle} width: 22px; height: 22px; border-radius: 50%; background: #ffffff; border: 1.5px solid #2563eb; color: #2563eb; font-size: 13px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.15); z-index: 15;">
          ${isCollapsed ? '+' : '-'}
        </button>
      ` : '';

      const isRaw = !!node.isRawMat;
      const rawTitle = (node.displayId || node.id || '').replace(/^📦\s*/, '');
      const cardTitle = isRaw ? `📦 ${rawTitle}` : (node.displayId || node.id);
      const cardDwg = node.dwgNo && node.dwgNo !== node.id ? `
        <div style="font-size: 8.5px; font-weight: 700; color: #0369a1; font-family: monospace; line-height: 1.1; margin-top: 1px;" title="${node.dwgNo}">${node.dwgNo}</div>
      ` : '';

      nodesHtml += `
        <div class="assembly-node-card" data-node-key="${node.nodeKey}" data-wo-id="${node.id}" data-is-raw="${isRaw}" data-parent-wo-id="${node.parentWoId || ''}" style="position: absolute; left: ${node.x}px; top: ${node.y}px; width: ${NODE_WIDTH}px; height: ${NODE_HEIGHT}px; background: ${bgGradient}; border: 2px solid ${borderColor}; border-radius: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); cursor: pointer; padding: 6px 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; user-select: none; transition: transform 0.2s, box-shadow 0.2s;" title="${isRaw ? `คลิกเพื่อดูรายการวัสดุและชิ้นส่วนประกอบ: ${node.partName}` : `คลิกเพื่อดูรายละเอียดขั้นตอนและแผนการผลิต: ${node.id}`}">
          <div style="font-weight: 900; font-size: 13px; color: #000000; letter-spacing: 0.2px; text-transform: uppercase;">${cardTitle}</div>
          ${cardDwg}
          <div style="font-size: 9.5px; font-weight: 700; color: #334155; margin-top: 2px; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${node.partName}">
            ${node.partName}
          </div>
          <div style="font-size: 8.5px; font-weight: 600; color: ${statusTextColor}; margin-top: 2px; text-transform: uppercase;">
            ${node.stepNames}
          </div>
          ${expandBtnHtml}
        </div>
      `;

      // Collect orthogonal connector lines to children
      if (!isCollapsed) {
        const visibleChildren = node.children.filter(isVisible);
        if (visibleChildren.length > 0) {
          if (isHor) {
            const parentRightX = node.x + NODE_WIDTH;
            const parentRightY = node.y + (NODE_HEIGHT / 2);
            const branchX = parentRightX + (H_GAP / 2);

            visibleChildren.forEach(child => {
              const childLeftX = child.x;
              const childLeftY = child.y + (NODE_HEIGHT / 2);
              connectors.push({
                isHor: true,
                parentRightX,
                parentRightY,
                branchX,
                childLeftX,
                childLeftY
              });
              collectRenderData(child);
            });
          } else {
            const parentBottomX = node.x + (NODE_WIDTH / 2);
            const parentBottomY = node.y + NODE_HEIGHT;
            const branchY = parentBottomY + (V_GAP / 2);

            visibleChildren.forEach(child => {
              const childTopX = child.x + (NODE_WIDTH / 2);
              const childTopY = child.y;
              connectors.push({
                isHor: false,
                parentBottomX,
                parentBottomY,
                branchY,
                childTopX,
                childTopY
              });
              collectRenderData(child);
            });
          }
        }
      }
    };

    collectRenderData(tree);

    // Draw SVG Orthogonal Blue Lines with "USES PARTS" label & Arrows
    let svgHtml = `
      <defs>
        <marker id="tree-arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#2563eb" />
        </marker>
      </defs>
    `;

    connectors.forEach(conn => {
      if (conn.isHor) {
        // Orthogonal path for Horizontal Tree:
        // Parent Right -> branchX -> Child Left Y -> Child Left edge with arrow
        const pathD = `M ${conn.parentRightX} ${conn.parentRightY} H ${conn.branchX} V ${conn.childLeftY} H ${conn.childLeftX - 2}`;
        svgHtml += `<path d="${pathD}" stroke="#2563eb" stroke-width="2" fill="none" marker-end="url(#tree-arrow-blue)" />`;

        // "USES PARTS" label on horizontal connector branch entering child
        const midLabelX = conn.branchX + ((conn.childLeftX - conn.branchX) / 2);
        const midLabelY = conn.childLeftY;
        svgHtml += `
          <rect x="${midLabelX - 27}" y="${midLabelY - 6.5}" width="54" height="13" fill="#ffffff" stroke="#93c5fd" stroke-width="0.75" rx="2" />
          <text x="${midLabelX}" y="${midLabelY + 3}" fill="#1d4ed8" font-size="7" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle">USES PARTS</text>
        `;
      } else {
        // Orthogonal path for Vertical Tree:
        // Parent Bottom -> branchY -> Child Top X -> Child Top edge with arrow
        const pathD = `M ${conn.parentBottomX} ${conn.parentBottomY} V ${conn.branchY} H ${conn.childTopX} V ${conn.childTopY - 2}`;
        svgHtml += `<path d="${pathD}" stroke="#2563eb" stroke-width="2" fill="none" marker-end="url(#tree-arrow-blue)" />`;

        // "USES PARTS" label on vertical connector entering child
        const midLabelY = conn.branchY + ((conn.childTopY - conn.branchY) / 2) - 4;
        svgHtml += `
          <rect x="${conn.childTopX - 32}" y="${midLabelY - 7}" width="64" height="13" fill="#ffffff" stroke="#93c5fd" stroke-width="0.75" rx="2" />
          <text x="${conn.childTopX}" y="${midLabelY + 3}" fill="#1d4ed8" font-size="7.5" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle">USES PARTS</text>
        `;
      }
    });

    if (this.svg) this.svg.innerHTML = svgHtml;
    if (this.nodesContainer) this.nodesContainer.innerHTML = nodesHtml;

    // Attach Toggle Listeners
    if (this.nodesContainer) {
      const toggleBtns = this.nodesContainer.querySelectorAll('.btn-tree-toggle');
      toggleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nKey = btn.getAttribute('data-node-key');
          if (this.collapsedNodes.has(nKey)) {
            this.collapsedNodes.delete(nKey);
          } else {
            this.collapsedNodes.add(nKey);
          }
          this.render();
        });
      });

      // Attach Node Card Click Listener (Open PD details or Raw Material details)
      const nodeCards = this.nodesContainer.querySelectorAll('.assembly-node-card');
      nodeCards.forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-tree-toggle')) return;
          const isRaw = card.getAttribute('data-is-raw') === 'true';
          const parentWoId = card.getAttribute('data-parent-wo-id');
          const woId = card.getAttribute('data-wo-id');
          if (this.gantt && this.gantt.showPDPlanModal) {
            if (isRaw && parentWoId) {
              this.gantt.showPDPlanModal(parentWoId);
            } else if (woId) {
              this.gantt.showPDPlanModal(woId);
            }
          }
        });

        card.addEventListener('dblclick', (e) => {
          if (e.target.closest('.btn-tree-toggle')) return;
          const isRaw = card.getAttribute('data-is-raw') === 'true';
          const woId = card.getAttribute('data-wo-id');
          if (!isRaw && woId && woId !== this.focusedWoId) {
            this.focusedWoId = woId;
            this.render();
            this.renderSidebarTreeView();
            this.fitView();
          }
        });
      });
    }

    // Adjust zoom plane bounding size dynamically from placed nodes
    if (this.zoomPlane) {
      let maxNodeX = 0;
      let maxNodeY = 0;
      allNodes.forEach(n => {
        if (isVisible(n) && n.x != null && n.y != null) {
          if (n.x > maxNodeX) maxNodeX = n.x;
          if (n.y > maxNodeY) maxNodeY = n.y;
        }
      });
      const planeWidth = Math.max(1800, maxNodeX + NODE_WIDTH + 400);
      const planeHeight = Math.max(1200, maxNodeY + NODE_HEIGHT + 300);
      this.zoomPlane.style.width = `${planeWidth}px`;
      this.zoomPlane.style.height = `${planeHeight}px`;
    }
  }

  show() {
    if (this.container) {
      this.container.classList.remove('hidden');
      this.container.style.display = 'flex';
      this.updateOrientButtons();
      this.updateToggleRawButton();
      this.render();
      this.renderSidebarTreeView();
      this.fitView();
    }
    const ganttBoardWrapper = document.querySelector('.gantt-board-wrapper');
    if (ganttBoardWrapper) ganttBoardWrapper.style.display = 'none';

    const timelineRuler = document.querySelector('.gantt-timeline-ruler');
    if (timelineRuler) timelineRuler.style.display = 'none';

    const ganttLegend = document.querySelector('.gantt-legend');
    if (ganttLegend) ganttLegend.style.display = 'none';
  }

  hide() {
    if (this.container) {
      this.container.classList.add('hidden');
      this.container.style.display = 'none';
    }
    const ganttBoardWrapper = document.querySelector('.gantt-board-wrapper');
    if (ganttBoardWrapper) ganttBoardWrapper.style.display = 'block';

    const timelineRuler = document.querySelector('.gantt-timeline-ruler');
    if (timelineRuler) timelineRuler.style.display = 'grid';

    const ganttLegend = document.querySelector('.gantt-legend');
    if (ganttLegend) {
      const shouldShow = !!(this.state && this.state.showGanttLegend);
      ganttLegend.classList.toggle('hidden', !shouldShow);
      ganttLegend.style.display = shouldShow ? 'flex' : 'none';
    }
  }
}
