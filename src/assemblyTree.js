// Assembly Parts Tree Diagram Controller
// Implements full GoDiagram-style Visual Parts Tree Hierarchy (BOM Tree)

export class AssemblyTreeController {
  constructor(state, ganttController) {
    this.state = state;
    this.gantt = ganttController;
    this.container = document.getElementById('assembly-tree-view-wrapper');
    this.canvasContainer = document.getElementById('assembly-tree-canvas-container');
    this.zoomPlane = document.getElementById('assembly-tree-zoom-plane');
    this.svg = document.getElementById('assembly-tree-svg');
    this.nodesContainer = document.getElementById('assembly-tree-nodes-container');
    this.selectWO = document.getElementById('assembly-tree-select-wo');
    
    this.headerPartNo = document.getElementById('tree-header-partno');
    this.headerDesc = document.getElementById('tree-header-desc');

    this.selectedWoId = null;
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
    // Select Assembly Dropdown
    if (this.selectWO) {
      this.selectWO.addEventListener('change', (e) => {
        this.selectedWoId = e.target.value;
        this.collapsedNodes.clear();
        this.render();
        this.fitView();
      });
    }

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

  fitView() {
    this.panX = 180;
    this.panY = 20;
    this.scale = 0.95;
    this.applyTransform();
  }

  getAllAssemblies() {
    const allWoIds = new Set([
      ...this.state.workOrders.map(w => w.id),
      ...this.state.scheduledJobs.map(j => j.woId).filter(Boolean)
    ]);

    const childSet = new Set();
    if (this.state.assemblyLinks) {
      this.state.assemblyLinks.forEach(link => {
        const fromWo = link.from.split('-')[0];
        if (fromWo) childSet.add(fromWo);
      });
    }
    allWoIds.forEach(id => {
      if (id.includes('-')) childSet.add(id);
    });

    // Find Root Assemblies
    const assemblies = [];
    allWoIds.forEach(woId => {
      if (!childSet.has(woId)) {
        const jobs = this.state.scheduledJobs.filter(j => j.woId === woId);
        const backlog = this.state.workOrders.find(w => w.id === woId);
        const partName = jobs[0]?.partName || backlog?.partName || woId;
        assemblies.push({ id: woId, partName: partName });
      }
    });

    if (assemblies.length === 0 && allWoIds.size > 0) {
      const first = Array.from(allWoIds)[0];
      assemblies.push({ id: first, partName: first });
    }
    return assemblies;
  }

  getAssemblyFamily(rootWoId) {
    if (!rootWoId) return [];
    const allWoIds = new Set([
      ...this.state.workOrders.map(w => w.id),
      ...this.state.scheduledJobs.map(j => j.woId).filter(Boolean)
    ]);

    const childrenMap = new Map();
    const parentMap = new Map();

    const addLink = (parentId, childId) => {
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, new Set());
      childrenMap.get(parentId).add(childId);
      parentMap.set(childId, parentId);
    };

    if (this.state.assemblyLinks) {
      this.state.assemblyLinks.forEach(link => {
        const fromWo = link.from.split('-')[0];
        const toWo = link.to.split('-')[0];
        if (fromWo && toWo && fromWo !== toWo) {
          addLink(toWo, fromWo);
        }
      });
    }

    allWoIds.forEach(id => {
      if (id.includes('-')) {
        const lastDash = id.lastIndexOf('-');
        const parentPrefix = id.substring(0, lastDash);
        if (!parentMap.has(id) && allWoIds.has(parentPrefix)) {
          addLink(parentPrefix, id);
        }
      }
    });

    const familyIds = new Set([rootWoId]);
    const queue = [rootWoId];
    const depths = new Map();
    depths.set(rootWoId, 0);

    while (queue.length > 0) {
      const current = queue.shift();
      if (childrenMap.has(current)) {
        for (const child of childrenMap.get(current)) {
          if (!familyIds.has(child) && allWoIds.has(child)) {
            familyIds.add(child);
            queue.push(child);
            depths.set(child, depths.get(current) + 1);
          }
        }
      }
    }

    const familyArray = Array.from(familyIds);
    familyArray.sort((a, b) => {
      if (depths.get(a) !== depths.get(b)) return depths.get(a) - depths.get(b);
      return a.localeCompare(b);
    });

    const nodes = familyArray.map(id => {
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

      const depth = depths.get(id) || 0;
      const parentId = depth === 0 ? null : parentMap.get(id);
      
      let hasChildren = false;
      if (childrenMap.has(id)) {
         hasChildren = Array.from(childrenMap.get(id)).some(c => allWoIds.has(c));
      }

      const stepNames = jobs.map(j => j.machine || j.stepName).filter(Boolean);

      return {
        id,
        partName,
        dwgNo,
        depth,
        parentId,
        hasChildren,
        status,
        totalSteps,
        completedSteps,
        stepNames: stepNames.length > 0 ? stepNames.slice(0, 3).join(', ') : 'ASSEMBLY, DCE',
        qty: jobs[0]?.qty || backlog?.qty || 1
      };
    });

    return nodes;
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

    // Populate dropdown
    if (this.selectWO) {
      const currentVal = this.selectedWoId || assemblies[0].id;
      this.selectWO.innerHTML = assemblies.map(a => `<option value="${a.id}" ${a.id === currentVal ? 'selected' : ''}>${a.id} - ${a.partName}</option>`).join('');
      this.selectedWoId = currentVal;
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
