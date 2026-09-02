const fs = require('fs');
const content = fs.readFileSync('src/assemblyTree.js', 'utf8');

const replacement = `  getAllAssemblies() {
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
  }`;

const startRegex = /  getAllAssemblies\(\) \{/;
const endRegex = /  render\(\) \{/;

const lines = content.split('\n');
let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (startRegex.test(lines[i])) startIndex = i;
  if (endRegex.test(lines[i]) && startIndex !== -1 && endIndex === -1) endIndex = i;
}

if (startIndex !== -1 && endIndex !== -1) {
  const newLines = [
    ...lines.slice(0, startIndex),
    replacement,
    ...lines.slice(endIndex)
  ];
  fs.writeFileSync('src/assemblyTree.js', newLines.join('\n'));
  console.log('Patched successfully');
} else {
  console.log('Failed to find bounds:', startIndex, endIndex);
}
