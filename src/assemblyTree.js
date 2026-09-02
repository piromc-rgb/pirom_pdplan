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
    const L1_H_GAP = 30;
    const L1_V_GAP = 50;  // Gap from L0 to L1
    
    const INDENT_X = 40;  // How far right to indent children
    const INDENT_Y_GAP = 20; // Vertical gap between sibling indented nodes

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

    // 1. Calculate dimensions for vertical subtrees (everything below L1)
    const computeIndentedDims = (node) => {
      node.indentedWidth = NODE_WIDTH;
      node.indentedHeight = NODE_HEIGHT;
      if (this.collapsedNodes.has(node.id)) return;
      
      const visibleChildren = node.children.filter(isVisible);
      if (visibleChildren.length === 0) return;

      let childMaxW = 0;
      let totalH = 0;
      visibleChildren.forEach(child => {
        computeIndentedDims(child);
        childMaxW = Math.max(childMaxW, child.indentedWidth);
        totalH += child.indentedHeight + INDENT_Y_GAP;
      });
      node.indentedWidth = Math.max(NODE_WIDTH, INDENT_X + childMaxW);
      node.indentedHeight = NODE_HEIGHT + totalH;
    };

    // 2. Assign Positions
    const START_X = 100;
    const START_Y = 40;

    let totalL1Width = 0;
    const l1Children = tree.children.filter(isVisible);
    const l1Widths = [];
    if (!this.collapsedNodes.has(tree.id)) {
      l1Children.forEach(l1 => {
        computeIndentedDims(l1);
        const w = l1.indentedWidth;
        l1Widths.push(w);
        totalL1Width += w;
      });
      if (l1Children.length > 0) {
        totalL1Width += (l1Children.length - 1) * L1_H_GAP;
      }
    }
    
    tree.x = START_X + (totalL1Width / 2) - (NODE_WIDTH / 2);
    if (totalL1Width === 0) tree.x = START_X;
    tree.y = START_Y;
    
    const assignIndentedPositions = (node, startX, startY) => {
      node.x = startX;
      node.y = startY;
      if (this.collapsedNodes.has(node.id)) return;
      
      const visibleChildren = node.children.filter(isVisible);
      let currentY = startY + NODE_HEIGHT + INDENT_Y_GAP;
      visibleChildren.forEach(child => {
        assignIndentedPositions(child, startX + INDENT_X, currentY);
        currentY += child.indentedHeight + INDENT_Y_GAP;
      });
    };

    if (!this.collapsedNodes.has(tree.id) && l1Children.length > 0) {
      let currentX = START_X;
      l1Children.forEach((l1, idx) => {
        assignIndentedPositions(l1, currentX, tree.y + NODE_HEIGHT + L1_V_GAP);
        currentX += l1Widths[idx] + L1_H_GAP;
      });
    }

    // Render HTML Nodes & SVG Connectors
    let nodesHtml = '';
    const connectors = [];

    const collectRenderData = (node) => {
      if (!isVisible(node)) return;
      
      // Node Card Color Gradient based on status
      let bgGradient = 'linear-gradient(to bottom, #ffffff 0%, #f1f5f9 100%)';
      let borderColor = '#475569';
      let statusTextColor = '#334155';

      if (node.status === 'working') {
        bgGradient = 'linear-gradient(to bottom, #ffffff 0%, #fef08a 40%, #fde047 100%)';
        borderColor = '#854d0e';
        statusTextColor = '#713f12';
      } else if (node.status === 'waiting') {
        bgGradient = 'linear-gradient(to bottom, #ffffff 0%, #fecaca 40%, #f87171 100%)';
        borderColor = '#991b1b';
        statusTextColor = '#7f1d1d';
      } else if (node.status === 'released') {
        bgGradient = 'linear-gradient(to bottom, #ffffff 0%, #dcfce7 40%, #86efac 100%)';
        borderColor = '#166534';
        statusTextColor = '#14532d';
      }

      const isCollapsed = this.collapsedNodes.has(node.id);
      
      let expandBtnHtml = '';
      if (node.hasChildren) {
        if (node === tree) {
          // Bottom center button for root node
          expandBtnHtml = `
            <button class="btn-tree-toggle" data-node-id="${node.id}" style="position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); width: 22px; height: 22px; border-radius: 50%; background: #ffffff; border: 1.5px solid #2563eb; color: #2563eb; font-size: 13px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.15); z-index: 15;">
              ${isCollapsed ? '+' : '-'}
            </button>
          `;
        } else {
          // Left side button for indented nodes
          expandBtnHtml = `
            <button class="btn-tree-toggle" data-node-id="${node.id}" style="position: absolute; left: -12px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 50%; background: #ffffff; border: 1.5px solid #2563eb; color: #2563eb; font-size: 13px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.15); z-index: 15;">
              ${isCollapsed ? '+' : '-'}
            </button>
          `;
        }
      }

      nodesHtml += `
        <div class="assembly-node-card" data-wo-id="${node.id}" style="position: absolute; left: ${node.x}px; top: ${node.y}px; width: ${NODE_WIDTH}px; height: ${NODE_HEIGHT}px; background: ${bgGradient}; border: 1.5px solid ${borderColor}; border-radius: 2px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); cursor: pointer; padding: 6px 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; user-select: none; transition: transform 0.2s, box-shadow 0.2s;" title="คลิกเพื่อดูรายละเอียดขั้นตอนและแผนการผลิต: ${node.id}">
          <div style="font-weight: 800; font-size: 13px; color: #000000; letter-spacing: 0.2px; text-transform: uppercase;">${node.id}</div>
          <div style="font-size: 9.5px; font-weight: 600; color: #334155; margin-top: 3px; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${node.partName}">
            ${node.partName}
          </div>
          <div style="font-size: 8.5px; font-weight: 500; color: ${statusTextColor}; margin-top: 2px; text-transform: uppercase;">
            ${node.stepNames}
          </div>
          ${expandBtnHtml}
        </div>
      `;

      // Collect connectors
      if (!isCollapsed) {
        const visibleChildren = node.children.filter(isVisible);
        if (visibleChildren.length > 0) {
          
          if (node === tree) { // L0 -> L1 (Horizontal spread)
            const parentBottomX = node.x + (NODE_WIDTH / 2);
            const parentBottomY = node.y + NODE_HEIGHT;
            const branchY = parentBottomY + (L1_V_GAP / 2);
            
            const firstChild = visibleChildren[0];
            const lastChild = visibleChildren[visibleChildren.length - 1];
            const firstX = firstChild.x + (NODE_WIDTH / 2);
            const lastX = lastChild.x + (NODE_WIDTH / 2);
            
            connectors.push({
              type: 'l0_to_l1',
              parentBottomX,
              parentBottomY,
              branchY,
              firstX,
              lastX,
              children: visibleChildren.map(c => ({ x: c.x + (NODE_WIDTH / 2), y: c.y }))
            });
          } else {
            // Indented tree connectors
            const parentLeftX = node.x + 15; // drop a line from inside the left edge
            const parentBottomY = node.y + NODE_HEIGHT;
            
            const lastChild = visibleChildren[visibleChildren.length - 1];
            const spineBottomY = lastChild.y + (NODE_HEIGHT / 2);
            
            connectors.push({
              type: 'indented',
              parentLeftX,
              parentBottomY,
              spineBottomY,
              children: visibleChildren.map(c => ({
                y: c.y + (NODE_HEIGHT / 2),
                targetX: c.x
              }))
            });
          }
          
          visibleChildren.forEach(child => collectRenderData(child));
        }
      }
    };

    collectRenderData(tree);

    // Draw SVG Lines
    let svgHtml = `
      <defs>
        <marker id="tree-arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 2 L 8 5 L 0 8 z" fill="#1e293b" />
        </marker>
      </defs>
    `;

    connectors.forEach(conn => {
      if (conn.type === 'l0_to_l1') {
        // Drop down from root
        let pathD = `M ${conn.parentBottomX} ${conn.parentBottomY} V ${conn.branchY}`;
        // Horizontal spine
        pathD += ` M ${conn.firstX} ${conn.branchY} H ${conn.lastX}`;
        // Drops to each L1 child
        conn.children.forEach(c => {
          pathD += ` M ${c.x} ${conn.branchY} V ${c.y - 2}`;
        });
        svgHtml += `<path d="${pathD}" stroke="#1e293b" stroke-width="1.5" fill="none" />`;
        conn.children.forEach(c => {
           svgHtml += `<path d="M ${c.x} ${c.y - 2} L ${c.x} ${c.y}" stroke="none" fill="none" marker-end="url(#tree-arrow-blue)" />`;
        });
      } else if (conn.type === 'indented') {
        // Vertical spine
        let pathD = `M ${conn.parentLeftX} ${conn.parentBottomY} V ${conn.spineBottomY}`;
        // Horizontal branches
        conn.children.forEach(c => {
          pathD += ` M ${conn.parentLeftX} ${c.y} H ${c.targetX - 2}`;
        });
        svgHtml += `<path d="${pathD}" stroke="#1e293b" stroke-width="1.5" fill="none" />`;
        conn.children.forEach(c => {
           svgHtml += `<path d="M ${c.targetX - 2} ${c.y} L ${c.targetX} ${c.y}" stroke="none" fill="none" marker-end="url(#tree-arrow-blue)" />`;
        });
      }
    });

    if (this.nodesContainer) this.nodesContainer.innerHTML = nodesHtml;
    if (this.svg) {
      this.svg.innerHTML = svgHtml;
      
      // Expand SVG canvas to fit
      let maxW = totalL1Width + 300;
      let maxH = 1000; // Need better maxH calculation but fixed is ok for scrolling
      
      const computeMaxH = (node) => {
        if (!isVisible(node)) return 0;
        let mh = node.y + NODE_HEIGHT;
        node.children.forEach(c => mh = Math.max(mh, computeMaxH(c)));
        return mh;
      };
      maxH = Math.max(800, computeMaxH(tree) + 200);
      maxW = Math.max(1200, START_X + totalL1Width + 400);

      this.svg.style.width = `${maxW}px`;
      this.svg.style.height = `${maxH}px`;
      if (this.nodesContainer) {
        this.nodesContainer.style.width = `${maxW}px`;
        this.nodesContainer.style.height = `${maxH}px`;
      }
    }
  }
}

