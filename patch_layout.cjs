const fs = require('fs');
const content = fs.readFileSync('src/assemblyTree.js', 'utf8');

const replacement = `    // Calculate layout positions
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
          expandBtnHtml = \`
            <button class="btn-tree-toggle" data-node-id="\${node.id}" style="position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); width: 22px; height: 22px; border-radius: 50%; background: #ffffff; border: 1.5px solid #2563eb; color: #2563eb; font-size: 13px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.15); z-index: 15;">
              \${isCollapsed ? '+' : '-'}
            </button>
          \`;
        } else {
          // Left side button for indented nodes
          expandBtnHtml = \`
            <button class="btn-tree-toggle" data-node-id="\${node.id}" style="position: absolute; left: -12px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 50%; background: #ffffff; border: 1.5px solid #2563eb; color: #2563eb; font-size: 13px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.15); z-index: 15;">
              \${isCollapsed ? '+' : '-'}
            </button>
          \`;
        }
      }

      nodesHtml += \`
        <div class="assembly-node-card" data-wo-id="\${node.id}" style="position: absolute; left: \${node.x}px; top: \${node.y}px; width: \${NODE_WIDTH}px; height: \${NODE_HEIGHT}px; background: \${bgGradient}; border: 1.5px solid \${borderColor}; border-radius: 2px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); cursor: pointer; padding: 6px 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; user-select: none; transition: transform 0.2s, box-shadow 0.2s;" title="คลิกเพื่อดูรายละเอียดขั้นตอนและแผนการผลิต: \${node.id}">
          <div style="font-weight: 800; font-size: 13px; color: #000000; letter-spacing: 0.2px; text-transform: uppercase;">\${node.id}</div>
          <div style="font-size: 9.5px; font-weight: 600; color: #334155; margin-top: 3px; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="\${node.partName}">
            \${node.partName}
          </div>
          <div style="font-size: 8.5px; font-weight: 500; color: \${statusTextColor}; margin-top: 2px; text-transform: uppercase;">
            \${node.stepNames}
          </div>
          \${expandBtnHtml}
        </div>
      \`;

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
    let svgHtml = \`
      <defs>
        <marker id="tree-arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 2 L 8 5 L 0 8 z" fill="#1e293b" />
        </marker>
      </defs>
    \`;

    connectors.forEach(conn => {
      if (conn.type === 'l0_to_l1') {
        // Drop down from root
        let pathD = \`M \${conn.parentBottomX} \${conn.parentBottomY} V \${conn.branchY}\`;
        // Horizontal spine
        pathD += \` M \${conn.firstX} \${conn.branchY} H \${conn.lastX}\`;
        // Drops to each L1 child
        conn.children.forEach(c => {
          pathD += \` M \${c.x} \${conn.branchY} V \${c.y - 2}\`;
        });
        svgHtml += \`<path d="\${pathD}" stroke="#1e293b" stroke-width="1.5" fill="none" />\`;
        conn.children.forEach(c => {
           svgHtml += \`<path d="M \${c.x} \${c.y - 2} L \${c.x} \${c.y}" stroke="none" fill="none" marker-end="url(#tree-arrow-blue)" />\`;
        });
      } else if (conn.type === 'indented') {
        // Vertical spine
        let pathD = \`M \${conn.parentLeftX} \${conn.parentBottomY} V \${conn.spineBottomY}\`;
        // Horizontal branches
        conn.children.forEach(c => {
          pathD += \` M \${conn.parentLeftX} \${c.y} H \${c.targetX - 2}\`;
        });
        svgHtml += \`<path d="\${pathD}" stroke="#1e293b" stroke-width="1.5" fill="none" />\`;
        conn.children.forEach(c => {
           svgHtml += \`<path d="M \${c.targetX - 2} \${c.y} L \${c.targetX} \${c.y}" stroke="none" fill="none" marker-end="url(#tree-arrow-blue)" />\`;
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

      this.svg.style.width = \`\${maxW}px\`;
      this.svg.style.height = \`\${maxH}px\`;
      if (this.nodesContainer) {
        this.nodesContainer.style.width = \`\${maxW}px\`;
        this.nodesContainer.style.height = \`\${maxH}px\`;
      }
    }
  }
}
`;

const startRegex = /    \/\/ Calculate layout positions/;
const endRegex = /^\}$/; // Last closing brace of the class

const lines = content.split('\n');
let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (startRegex.test(lines[i])) startIndex = i;
}
endIndex = lines.length - 1;
while(endIndex > 0 && lines[endIndex].trim() !== '}') endIndex--;

if (startIndex !== -1 && endIndex !== -1) {
  const newLines = [
    ...lines.slice(0, startIndex),
    replacement,
    ...lines.slice(endIndex + 1)
  ];
  fs.writeFileSync('src/assemblyTree.js', newLines.join('\n'));
  console.log('Patched layout successfully');
} else {
  console.log('Failed to find bounds:', startIndex, endIndex);
}
