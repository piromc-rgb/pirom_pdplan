// Assembly Parts Tree Diagram Controller
// Implements full GoDiagram-style Visual Parts Tree Hierarchy (BOM Tree)

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

// True if `id`/`partName` satisfy a search query - either a "PDxxxx-PDyyyy" ID
// range, or (for anything else) a plain case-insensitive substring match.
export function matchesAssemblyQuery(id, partName, query) {
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
  return id.toLowerCase().includes(lower) || (partName || '').toLowerCase().includes(lower);
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

    this.selectedWoId = null;
    this.allAssemblies = [];
    this.collapsedNodes = new Set();
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;

    this.initEvents();
  }

  initEvents() {
    // Searchable Assembly Set picker: a text input that filters a dropdown list
    // (44+ PDs makes a plain <select> hard to scan/scroll through).
    if (this.searchInput) {
      this.searchInput.addEventListener('focus', () => {
        // The box shows "ID - part name" for the current selection; select it all so
        // typing replaces it, and open the dropdown showing every option first.
        this.searchInput.select();
        this.renderSearchDropdown('');
      });
      this.searchInput.addEventListener('input', () => {
        this.renderSearchDropdown(this.searchInput.value);
      });
      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.hideSearchDropdown();
          this.searchInput.blur();
        } else if (e.key === 'Enter') {
          const firstItem = this.searchDropdown?.querySelector('.assembly-search-item');
          if (firstItem) {
            e.preventDefault();
            this.selectAssembly(firstItem.getAttribute('data-wo-id'));
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
        window.print();
      });
    }

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
        const family = this.getAssemblyFamily(this.selectedWoId);
        family.forEach(n => {
          if (n.hasChildren) this.collapsedNodes.add(n.id);
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
    const matches = this.allAssemblies.filter(a => matchesAssemblyQuery(a.id, a.partName, query));

    if (matches.length === 0) {
      this.searchDropdown.innerHTML = '<div style="padding: 10px 12px; font-size: 12px; color: #64748b;">ไม่พบ Assembly Set ที่ตรงกับคำค้นหา</div>';
    } else {
      this.searchDropdown.innerHTML = matches.map(a => `
        <div class="assembly-search-item" data-wo-id="${a.id}" style="padding: 7px 12px; font-size: 12px; cursor: pointer; color: #0f172a; ${a.id === this.selectedWoId ? 'background: #e0f2fe; font-weight: 700;' : ''}" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='${a.id === this.selectedWoId ? '#e0f2fe' : ''}'">
          <span style="font-weight: 700;">${a.id}</span>
          <span style="color: #475569;"> - ${a.partName}</span>
        </div>
      `).join('');

      this.searchDropdown.querySelectorAll('.assembly-search-item').forEach(item => {
        item.addEventListener('click', () => {
          this.selectAssembly(item.getAttribute('data-wo-id'));
        });
      });
    }

    this.searchDropdown.classList.remove('hidden');
  }

  selectAssembly(woId) {
    this.selectedWoId = woId;
    this.collapsedNodes.clear();
    this.hideSearchDropdown();
    if (this.searchInput) this.searchInput.blur();
    this.render();
    this.fitView();
  }

  fitView() {
    this.panX = 180;
    this.panY = 20;
    this.scale = 0.95;
    this.applyTransform();
  }

  // Builds the cross-PD assembly graph from state.assemblyLinks: each link's `from`
  // step belongs to the child PD that gets assembled INTO the parent PD its `to`
  // step belongs to. This is a different relationship than the WO-ID dash suffix
  // (which just numbers routing steps within a single PD) - a link's from/to PD IDs
  // are recovered by stripping the step suffix off each side.
  getAssemblyGraph() {
    const parentOf = new Map();   // childWoId -> parentWoId
    const childrenOf = new Map(); // parentWoId -> Set<childWoId>
    const allWoIds = new Set();

    (this.state.assemblyLinks || []).forEach(link => {
      const fromWo = (link.from || '').split('-')[0];
      const toWo = (link.to || '').split('-')[0];
      if (!fromWo || !toWo || fromWo === toWo) return;
      allWoIds.add(fromWo);
      allWoIds.add(toWo);
      if (!parentOf.has(fromWo)) parentOf.set(fromWo, toWo);
      if (!childrenOf.has(toWo)) childrenOf.set(toWo, new Set());
      childrenOf.get(toWo).add(fromWo);
    });

    return { parentOf, childrenOf, allWoIds };
  }

  getAllAssemblies() {
    const { parentOf, childrenOf, allWoIds } = this.getAssemblyGraph();

    // Level 0 = PDs that are never assembled into something else (not a `from` in
    // any link) but do have other PDs assembled into them.
    const assemblies = [];
    allWoIds.forEach(woId => {
      if (!parentOf.has(woId) && childrenOf.has(woId) && childrenOf.get(woId).size > 0) {
        const jobs = this.state.scheduledJobs.filter(j => j.woId === woId);
        const backlog = this.state.workOrders.find(w => w.id === woId);
        const partName = jobs[0]?.partName || backlog?.partName || woId;
        assemblies.push({ id: woId, partName });
      }
    });

    if (assemblies.length === 0) {
      // No assembly links recorded yet - fall back to any WO so the tab isn't blank.
      const anyWoIds = new Set([
        ...this.state.workOrders.map(w => w.id),
        ...this.state.scheduledJobs.map(j => j.woId).filter(Boolean)
      ]);
      if (anyWoIds.size > 0) {
        const first = Array.from(anyWoIds)[0];
        const jobs = this.state.scheduledJobs.filter(j => j.woId === first);
        const backlog = this.state.workOrders.find(w => w.id === first);
        assemblies.push({ id: first, partName: jobs[0]?.partName || backlog?.partName || first });
      }
    }

    return assemblies;
  }

  getAssemblyFamily(rootWoId) {
    if (!rootWoId) return [];
    const { parentOf, childrenOf } = this.getAssemblyGraph();

    // BFS down the assembly graph from rootWoId (Level 0) - Level 1 are PDs
    // assembled directly into it, Level 2 are PDs assembled into a Level 1 PD, etc.
    const depthOf = new Map([[rootWoId, 0]]);
    const queue = [rootWoId];
    const familyIds = [rootWoId];
    while (queue.length > 0) {
      const current = queue.shift();
      const kids = childrenOf.get(current);
      if (!kids) continue;
      kids.forEach(childId => {
        if (depthOf.has(childId)) return; // guards against a cyclic/duplicate link
        depthOf.set(childId, depthOf.get(current) + 1);
        familyIds.push(childId);
        queue.push(childId);
      });
    }

    const nodes = familyIds.map(id => {
      const jobs = this.state.scheduledJobs.filter(j => j.woId === id);
      const backlog = this.state.workOrders.find(w => w.id === id);
      const partName = jobs[0]?.partName || backlog?.partName || id;
      const dwgNo = jobs[0]?.dwgNo || backlog?.dwgNo || '';

      const totalSteps = jobs.length + (backlog ? backlog.steps.length : 0);
      const completedSteps = jobs.filter(j => j.status === 'Completed').length;
      const isRunning = jobs.some(j => j.status === 'Running' || j.status === 'Setup');
      const isComplete = totalSteps > 0 && completedSteps === totalSteps;

      let status = 'waiting';
      if (isComplete) status = 'released';
      else if (isRunning || completedSteps > 0) status = 'working';

      const depth = depthOf.get(id) || 0;
      const parentId = depth === 0 ? null : (parentOf.get(id) || null);
      const hasChildren = childrenOf.has(id) && childrenOf.get(id).size > 0;

      // Machine steps summary
      const stepNames = jobs.map(j => j.machine || j.stepName).filter(Boolean);

      return {
        id,
        partName,
        dwgNo,
        depth,
        parentId,
        hasChildren,
        status, // 'released', 'working', 'waiting'
        totalSteps,
        completedSteps,
        stepNames: stepNames.length > 0 ? stepNames.slice(0, 3).join(', ') : 'ASSEMBLY, DCE',
        qty: jobs[0]?.qty || backlog?.qty || 1
      };
    });

    return nodes;
  }

  // Counts, among a root's sub-PDs (every family node below depth 0), how many have
  // actually started production - i.e. at least one of their jobs is Running, Setup,
  // Paused or Completed - versus ones still just sitting in the backlog or scheduled
  // on the board but not yet worked on. Used by the Assembly Set list to show "X/Y".
  getSubPdProgress(rootWoId) {
    const subNodes = this.getAssemblyFamily(rootWoId).filter(n => n.depth > 0);
    const total = subNodes.length;
    let progressed = 0;
    subNodes.forEach(n => {
      const jobs = this.state.scheduledJobs.filter(j => j.woId === n.id);
      const hasProgress = jobs.some(j =>
        j.status === 'Running' || j.status === 'Setup' || j.status === 'Paused' || j.status === 'Completed'
      );
      if (hasProgress) progressed++;
    });
    return { progressed, total };
  }

  buildTreeHierarchy(nodes, rootWoId) {
    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, { ...n, children: [] }));

    let root = null;
    nodeMap.forEach(n => {
      if (n.id === rootWoId) {
        root = n;
      } else if (n.parentId && nodeMap.has(n.parentId)) {
        nodeMap.get(n.parentId).children.push(n);
      } else if (root) {
        root.children.push(n);
      }
    });

    return root;
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
    const currentVal = this.selectedWoId || assemblies[0].id;
    this.selectedWoId = currentVal;
    if (this.searchInput && document.activeElement !== this.searchInput) {
      const currentAssembly = assemblies.find(a => a.id === currentVal);
      this.searchInput.value = currentAssembly ? `${currentAssembly.id} - ${currentAssembly.partName}` : currentVal;
    }

    const rootWoId = this.selectedWoId || assemblies[0].id;
    const allNodes = this.getAssemblyFamily(rootWoId);
    const rootNode = allNodes.find(n => n.id === rootWoId) || allNodes[0];

    // Update Top-Left Header Box (Exact match with screenshot)
    if (this.headerPartNo) this.headerPartNo.textContent = rootNode ? rootNode.id : '42354-01,L';
    if (this.headerDesc) this.headerDesc.textContent = rootNode ? `${rootNode.partName}, ASSEMBLY, DEC001` : 'MCU, 1/2 ATR, ASSEMBLY, NTSC, DCE3.0, AVT';

    // Build hierarchy
    const tree = this.buildTreeHierarchy(allNodes, rootWoId);
    if (!tree) return;

    // Calculate layout positions
    const NODE_WIDTH = 190;
    const NODE_HEIGHT = 80;
    const H_GAP = 30;
    const V_GAP = 90;

    // Filter out collapsed sub-trees
    const isVisible = (node) => {
      let p = node.parentId;
      while (p) {
        if (this.collapsedNodes.has(p)) return false;
        const parentNode = allNodes.find(n => n.id === p);
        p = parentNode ? parentNode.parentId : null;
      }
      return true;
    };

    // Calculate subtree width recursively
    const computeSubtreeWidth = (node) => {
      if (!isVisible(node)) return 0;
      const visibleChildren = node.children.filter(isVisible);
      if (visibleChildren.length === 0 || this.collapsedNodes.has(node.id)) {
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

    // Assign (x, y) coordinates
    const assignPositions = (node, leftX, topY) => {
      if (!isVisible(node)) return;
      const visibleChildren = node.children.filter(isVisible);
      
      node.x = leftX + (node.subtreeWidth / 2) - (NODE_WIDTH / 2);
      node.y = topY;

      if (!this.collapsedNodes.has(node.id) && visibleChildren.length > 0) {
        let currentX = leftX;
        visibleChildren.forEach(child => {
          assignPositions(child, currentX, topY + NODE_HEIGHT + V_GAP);
          currentX += child.subtreeWidth + H_GAP;
        });
      }
    };

    const START_X = 260; // Leave margin for the Top-Left Legend box
    const START_Y = 40;
    assignPositions(tree, START_X, START_Y);

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

      const isCollapsed = this.collapsedNodes.has(node.id);
      const expandBtnHtml = node.hasChildren ? `
        <button class="btn-tree-toggle" data-node-id="${node.id}" style="position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); width: 22px; height: 22px; border-radius: 50%; background: #ffffff; border: 1.5px solid #2563eb; color: #2563eb; font-size: 13px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.15); z-index: 15;">
          ${isCollapsed ? '+' : '-'}
        </button>
      ` : '';

      nodesHtml += `
        <div class="assembly-node-card" data-wo-id="${node.id}" style="position: absolute; left: ${node.x}px; top: ${node.y}px; width: ${NODE_WIDTH}px; height: ${NODE_HEIGHT}px; background: ${bgGradient}; border: 2px solid ${borderColor}; border-radius: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); cursor: pointer; padding: 6px 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; user-select: none; transition: transform 0.2s, box-shadow 0.2s;" title="คลิกเพื่อดูรายละเอียดขั้นตอนและแผนการผลิต: ${node.id}">
          <div style="font-weight: 900; font-size: 13px; color: #000000; letter-spacing: 0.2px; text-transform: uppercase;">${node.id}</div>
          <div style="font-size: 9.5px; font-weight: 700; color: #334155; margin-top: 3px; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${node.partName}">
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
          const parentBottomX = node.x + (NODE_WIDTH / 2);
          const parentBottomY = node.y + NODE_HEIGHT;
          const branchY = parentBottomY + (V_GAP / 2);

          visibleChildren.forEach(child => {
            const childTopX = child.x + (NODE_WIDTH / 2);
            const childTopY = child.y;
            connectors.push({
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
    };

    collectRenderData(tree);

    // Draw SVG Orthogonal Blue Lines with "USES PARTS" label & Downward Arrows
    let svgHtml = `
      <defs>
        <marker id="tree-arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#2563eb" />
        </marker>
      </defs>
    `;

    connectors.forEach(conn => {
      // Orthogonal path: Vertical down from parent -> Horizontal to child X -> Vertical down into child with arrow
      const pathD = `M ${conn.parentBottomX} ${conn.parentBottomY} V ${conn.branchY} H ${conn.childTopX} V ${conn.childTopY - 2}`;
      svgHtml += `<path d="${pathD}" stroke="#2563eb" stroke-width="2" fill="none" marker-end="url(#tree-arrow-blue)" />`;
      
      // Add "USES PARTS" label on vertical connector
      const midLabelY = conn.branchY + ((conn.childTopY - conn.branchY) / 2) - 4;
      svgHtml += `
        <rect x="${conn.childTopX - 32}" y="${midLabelY - 7}" width="64" height="13" fill="#ffffff" stroke="#93c5fd" stroke-width="0.75" rx="2" />
        <text x="${conn.childTopX}" y="${midLabelY + 3}" fill="#1d4ed8" font-size="7.5" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle">USES PARTS</text>
      `;
    });

    if (this.svg) this.svg.innerHTML = svgHtml;
    if (this.nodesContainer) this.nodesContainer.innerHTML = nodesHtml;

    // Attach Toggle Listeners
    if (this.nodesContainer) {
      const toggleBtns = this.nodesContainer.querySelectorAll('.btn-tree-toggle');
      toggleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nId = btn.getAttribute('data-node-id');
          if (this.collapsedNodes.has(nId)) {
            this.collapsedNodes.delete(nId);
          } else {
            this.collapsedNodes.add(nId);
          }
          this.render();
        });
      });

      // Attach Node Card Click Listener (Open PD details)
      const nodeCards = this.nodesContainer.querySelectorAll('.assembly-node-card');
      nodeCards.forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-tree-toggle')) return;
          const woId = card.getAttribute('data-wo-id');
          if (this.gantt && this.gantt.showPDPlanModal) {
            this.gantt.showPDPlanModal(woId);
          }
        });
      });
    }

    // Adjust zoom plane bounding size
    if (this.zoomPlane) {
      const maxRight = Math.max(1600, START_X + (tree.subtreeWidth || 1000) + 300);
      this.zoomPlane.style.width = `${maxRight}px`;
      this.zoomPlane.style.height = `1200px`;
    }
  }

  show() {
    if (this.container) {
      this.container.classList.remove('hidden');
      this.container.style.display = 'flex';
      this.render();
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
    if (ganttLegend) ganttLegend.style.display = 'flex';
  }
}
