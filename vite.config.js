import { defineConfig } from 'vite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compileVersion = '1.2';

function getTempCacheDir() {
  const dir = path.join(os.tmpdir(), 'pirom_pdplan');
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {}
  return dir;
}

function getGdriveCandidates() {
  const home = os.homedir();
  const candidates = [
    'G:\\My Drive\\staus overview',
    'G:\\My Drive\\status overview',
    'G:\\ไดรฟ์ของฉัน\\staus overview',
    'G:\\ไดรฟ์ของฉัน\\status overview',
    'H:\\My Drive\\staus overview',
    'H:\\My Drive\\status overview',
    path.join(home, 'Google Drive', 'My Drive', 'staus overview'),
    path.join(home, 'Google Drive', 'My Drive', 'status overview'),
    '/Users/pirom/Library/CloudStorage/GoogleDrive-pirom.c@gmail.com/My Drive/staus overview',
    '/Users/pirom/Library/CloudStorage/GoogleDrive-pirom.c@gmail.com/My Drive/status overview',
    '/Volumes/GoogleDrive/My Drive/staus overview',
    '/Volumes/GoogleDrive/My Drive/status overview'
  ];

  // Dynamically scan macOS ~/Library/CloudStorage/GoogleDrive-* for any account
  const macCloudStorage = path.join(home, 'Library', 'CloudStorage');
  if (fs.existsSync(macCloudStorage)) {
    try {
      const entries = fs.readdirSync(macCloudStorage, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('GoogleDrive')) {
          const gdRoot = path.join(macCloudStorage, entry.name);
          for (const sub of ['My Drive', 'ไดรฟ์ของฉัน']) {
            for (const folder of ['staus overview', 'status overview']) {
              const full = path.join(gdRoot, sub, folder);
              if (!candidates.includes(full)) candidates.push(full);
            }
          }
        }
      }
    } catch {}
  }

  return candidates;
}

export default defineConfig({
  base: '/pirom_pdplan/',
  define: {
    __APP_VERSION__: JSON.stringify(compileVersion)
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
    watch: {
      ignored: ['**/*.xlsx', '**/*.xls', '**/~$*']
    }
  },
  plugins: [
    {
      name: 'pd-storage-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const rawUrl = req.url || '';
          const cleanUrl = rawUrl.replace(/^\/pirom_pdplan/, '');

          const gdriveCandidates = getGdriveCandidates();
          const gdriveDir = gdriveCandidates.find(d => fs.existsSync(d)) || gdriveCandidates[0];
          const tempCacheDir = getTempCacheDir();
          const tempMatCachePath = path.join(tempCacheDir, 'plan_materials_cache.json');
          const localMatCachePath = path.resolve(__dirname, 'plan_materials_cache.json');
          const cloudConfigLocalPath = path.resolve(__dirname, 'cloud_config.json');
          const cloudConfigGdrivePath = path.join(gdriveDir, 'cloud_config.json');

          const readCloudConfig = () => {
            const cfg = {
              endpointUrl: 'https://script.google.com/macros/s/AKfycbzLDxqPOnJAC8aRVyr8-_oNLWLdXEbSvJqbGSh-5W-zFVo_cwdVhsQPISjUUF3NSpJJFg/exec',
              driveFolderUrl: 'https://drive.google.com/drive/folders/1Yt8drFmq0END9fAEWUy0No6sZ76H1dtA?lfhs=2',
              dwgFolderUrl: 'https://drive.google.com/drive/folders/1M-QDPilC7Nn-YW_5YxLQITUS6ZOYEyFm',
              statusOverviewFilename: 'LN Status Overview.xlsx'
            };
            for (const p of [cloudConfigLocalPath, cloudConfigGdrivePath]) {
              if (fs.existsSync(p)) {
                try {
                  const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
                  if (parsed && typeof parsed === 'object') {
                    if (parsed.endpointUrl && String(parsed.endpointUrl).trim()) cfg.endpointUrl = String(parsed.endpointUrl).trim();
                    if (parsed.driveFolderUrl) cfg.driveFolderUrl = String(parsed.driveFolderUrl).trim();
                    if (parsed.dwgFolderUrl) {
                      const rawDwg = String(parsed.dwgFolderUrl).trim();
                      const matches = [...rawDwg.matchAll(/folders\/([a-zA-Z0-9_-]+)/g)];
                      if (matches.length > 0) {
                        const lastId = matches[matches.length - 1][1];
                        cfg.dwgFolderUrl = lastId === '17w0vlhgTfMW18p2H0LRq2aB1fOSHEdvg'
                          ? 'https://drive.google.com/drive/folders/1M-QDPilC7Nn-YW_5YxLQITUS6ZOYEyFm'
                          : `https://drive.google.com/drive/folders/${lastId}`;
                      } else {
                        cfg.dwgFolderUrl = rawDwg;
                      }
                    }
                    if (parsed.statusOverviewFilename) cfg.statusOverviewFilename = String(parsed.statusOverviewFilename).trim();
                  }
                } catch {}
              }
            }
            return cfg;
          };

          const writeCloudConfig = (updates) => {
            const current = readCloudConfig();
            const merged = Object.assign({}, current, updates, { updatedAt: new Date().toISOString() });
            const jsonStr = JSON.stringify(merged, null, 2);
            try {
              fs.writeFileSync(cloudConfigLocalPath, jsonStr, 'utf-8');
            } catch {}
            try {
              const publicCfgPath = path.resolve(__dirname, 'public', 'cloud_config.json');
              if (fs.existsSync(path.dirname(publicCfgPath))) {
                fs.writeFileSync(publicCfgPath, jsonStr, 'utf-8');
              }
            } catch {}
            if (fs.existsSync(gdriveDir)) {
              try {
                fs.writeFileSync(cloudConfigGdrivePath, jsonStr, 'utf-8');
              } catch {}
            }
            return merged;
          };

          if (cleanUrl.startsWith('/api/')) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
            if (req.method === 'OPTIONS') {
              res.statusCode = 204;
              res.end();
              return;
            }
          }

          if (cleanUrl === '/api/cloud-config' || cleanUrl.startsWith('/api/cloud-config?')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (req.method === 'GET') {
              const cfg = readCloudConfig();
              res.statusCode = 200;
              res.end(JSON.stringify({
                status: 'success',
                gdriveDesktopMounted: fs.existsSync(gdriveDir),
                config: cfg
              }));
              return;
            }
            if (req.method === 'POST') {
              const chunks = [];
              req.on('data', c => chunks.push(c));
              req.on('end', () => {
                try {
                  const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
                  const saved = writeCloudConfig(body);
                  res.statusCode = 200;
                  res.end(JSON.stringify({ status: 'success', config: saved }));
                } catch (err) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ status: 'error', message: err.message }));
                }
              });
              return;
            }
          }

          if (cleanUrl === '/api/pd' || cleanUrl.startsWith('/api/pd?')) {
            const pdFilePath = path.resolve(__dirname, 'pd.md');
            const gdrivePdPath = path.join(gdriveDir, 'pd.md');
            const tempPdPath = path.join(tempCacheDir, 'pd.md');
            const urlObj = new URL(cleanUrl, 'http://localhost');
            const preferTemp = urlObj.searchParams.get('source') === 'temp';
            const tempOnly = urlObj.searchParams.get('tempOnly') === '1';
            
            if (req.method === 'GET') {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              const activePdPath = (preferTemp && fs.existsSync(tempPdPath))
                ? tempPdPath
                : (fs.existsSync(gdrivePdPath) && (!fs.existsSync(pdFilePath) || fs.statSync(gdrivePdPath).mtimeMs >= fs.statSync(pdFilePath).mtimeMs))
                  ? gdrivePdPath
                  : pdFilePath;
              if (fs.existsSync(activePdPath)) {
                try {
                  const content = fs.readFileSync(activePdPath, 'utf-8');
                  const regex = /```json\s+([\s\S]*?)\s+```/;
                  const match = content.match(regex);
                  if (match) {
                    res.statusCode = 200;
                    res.end(match[1]);
                    return;
                  }
                } catch (err) {
                  console.error('Error reading pd.md:', err);
                }
              }
              res.statusCode = 200;
              res.end(JSON.stringify([]));
              return;
            }
            
            if (req.method === 'POST') {
              const chunks = [];
              req.on('data', chunk => {
                chunks.push(chunk);
              });
              req.on('end', () => {
                try {
                  const body = Buffer.concat(chunks).toString('utf-8');
                  const workOrders = JSON.parse(body);
                  
                  // Format markdown content
                  let markdownContent = `# Production Order Backlog\n\n`;
                  markdownContent += `This file contains the persistent backlog of Production Orders. Do not modify the JSON block at the bottom unless you know what you are doing.\n\n`;
                  markdownContent += `| Production Order ID | Customer | Part Name | Qty | Priority | Target Due Date |\n`;
                  markdownContent += `| --- | --- | --- | --- | --- | --- |\n`;
                  
                  workOrders.forEach(wo => {
                    const formattedDate = new Date().toLocaleDateString('en-GB'); // Fallback or estimate
                    markdownContent += `| ${wo.id} | ${wo.customer} | ${wo.partName} | ${wo.qty} | ${wo.priority} | ${formattedDate} |\n`;
                  });
                  
                  markdownContent += `\n## Raw Data Block (Auto-generated)\n`;
                  markdownContent += `\`\`\`json\n${JSON.stringify(workOrders, null, 2)}\n\`\`\`\n`;
                  
                  // Always write working copy to OS Temp folder (Windows %TEMP%/pirom_pdplan & macOS $TMPDIR/pirom_pdplan)
                  try { fs.writeFileSync(tempPdPath, markdownContent, 'utf-8'); } catch (e) {}

                  if (!tempOnly) {
                    fs.writeFileSync(pdFilePath, markdownContent, 'utf-8');
                    if (fs.existsSync(gdriveDir)) {
                      try { fs.writeFileSync(gdrivePdPath, markdownContent, 'utf-8'); } catch (e) {}
                    }
                  }
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    savedTo: tempOnly ? 'temp' : 'cloud',
                    tempDir: tempCacheDir,
                    platform: process.platform
                  }));
                } catch (err) {
                  console.error('Error saving pd.md:', err);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }
          }

          if (cleanUrl === '/api/plan' || cleanUrl.startsWith('/api/plan?')) {
            const planFilePath = path.resolve(__dirname, 'Plan.json');
            const gdrivePlanPath = path.join(gdriveDir, 'Plan.json');
            const tempPlanPath = path.join(tempCacheDir, 'Plan.json');
            const machineFilePath = path.resolve(__dirname, 'machine_settings.json');
            const gdriveMachinePath = path.join(gdriveDir, 'machine_settings.json');
            const tempMachinePath = path.join(tempCacheDir, 'machine_settings.json');
            const completedFilePath = path.resolve(__dirname, 'completed_pds.json');
            const gdriveCompletedPath = path.join(gdriveDir, 'completed_pds.json');
            const tempCompletedPath = path.join(tempCacheDir, 'completed_pds.json');
            const tempPdPath = path.join(tempCacheDir, 'pd.md');
            const pdFilePath = path.resolve(__dirname, 'pd.md');
            const gdrivePdPath = path.join(gdriveDir, 'pd.md');
            
            if (req.method === 'GET') {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              const urlObj = new URL(cleanUrl, 'http://localhost');
              const preferTemp = urlObj.searchParams.get('source') === 'temp';
              let content = { scheduledJobs: [], nests: {}, completedPdHistory: {}, workCenters: {}, workCenterOrder: [] };
              // Auto-seed Google Drive Plan.json if missing
              if (fs.existsSync(gdriveDir) && !fs.existsSync(gdrivePlanPath) && fs.existsSync(planFilePath)) {
                try {
                  const localData = JSON.parse(fs.readFileSync(planFilePath, 'utf-8'));
                  const lightPlan = Object.assign({}, localData);
                  delete lightPlan.planMaterials;
                  delete lightPlan.dwgToPdMap;
                  delete lightPlan.pdOpStatusMap;
                  fs.writeFileSync(gdrivePlanPath, JSON.stringify(lightPlan, null, 2), 'utf-8');
                } catch (e) {}
              }
              const activePlanPath = (preferTemp && fs.existsSync(tempPlanPath))
                ? tempPlanPath
                : (fs.existsSync(gdrivePlanPath) && (!fs.existsSync(planFilePath) || fs.statSync(gdrivePlanPath).mtimeMs >= fs.statSync(planFilePath).mtimeMs))
                  ? gdrivePlanPath
                  : planFilePath;
              if (fs.existsSync(activePlanPath)) {
                try {
                  const raw = fs.readFileSync(activePlanPath, 'utf-8');
                  content = Object.assign(content, JSON.parse(raw));
                } catch (err) {
                  console.error('Error reading Plan.json:', err);
                }
              }
              const activeMachinePath = (preferTemp && fs.existsSync(tempMachinePath))
                ? tempMachinePath
                : (fs.existsSync(gdriveMachinePath) ? gdriveMachinePath : machineFilePath);
              if (fs.existsSync(activeMachinePath)) {
                try {
                  const mRaw = JSON.parse(fs.readFileSync(activeMachinePath, 'utf-8'));
                  if (mRaw.workCenters) content.workCenters = mRaw.workCenters;
                  if (mRaw.workCenterOrder) content.workCenterOrder = mRaw.workCenterOrder;
                } catch (e) {}
              }
              const activeCompletedPath = (preferTemp && fs.existsSync(tempCompletedPath))
                ? tempCompletedPath
                : (fs.existsSync(gdriveCompletedPath) ? gdriveCompletedPath : completedFilePath);
              if (fs.existsSync(activeCompletedPath)) {
                try {
                  const cRaw = JSON.parse(fs.readFileSync(activeCompletedPath, 'utf-8'));
                  if (Array.isArray(cRaw)) {
                    content.completedPdHistory = content.completedPdHistory || {};
                    cRaw.forEach(x => { const id = typeof x === 'string' ? x : (x.id || x.woId || x.pdId); if (id) content.completedPdHistory[id] = true; });
                  } else if (typeof cRaw === 'object') {
                    content.completedPdHistory = Object.assign(content.completedPdHistory || {}, cRaw);
                  }
                } catch (e) {}
              }
              res.statusCode = 200;
              res.end(JSON.stringify(content));
              return;
            }
            
            if (req.method === 'POST') {
              const urlObj = new URL(cleanUrl, 'http://localhost');
              const tempOnly = urlObj.searchParams.get('tempOnly') === '1';
              const forwardCloud = urlObj.searchParams.get('forwardCloud') === '1' || urlObj.searchParams.get('commitCloud') === '1';
              const chunks = [];
              req.on('data', chunk => {
                chunks.push(chunk);
              });
              req.on('end', () => {
                try {
                  const body = Buffer.concat(chunks).toString('utf-8');
                  const payload = JSON.parse(body);
                  delete payload.formattedRows; // Not needed in Plan.json
                  delete payload._includeMaterials;

                  // Best Practice: Keep plan_materials_cache.json in Temp Local Disk + Local Workspace only (never sync 14MB cache to Google Drive)
                  if (payload.planMaterials && Object.keys(payload.planMaterials).length > 0) {
                    const pmPayloadStr = JSON.stringify({
                      planMaterials: payload.planMaterials,
                      dwgToPdMap: payload.dwgToPdMap || {},
                      pdOpStatusMap: payload.pdOpStatusMap || {}
                    });
                    try { fs.writeFileSync(tempMatCachePath, pmPayloadStr, 'utf-8'); } catch (e) {}
                    try { fs.writeFileSync(localMatCachePath, pmPayloadStr, 'utf-8'); } catch (e) {}
                  }

                  const lightPlan = Object.assign({}, payload);
                  delete lightPlan.planMaterials;
                  delete lightPlan.dwgToPdMap;
                  delete lightPlan.pdOpStatusMap;
                  const lightPlanStr = JSON.stringify(lightPlan, null, 2);
                  
                  // 1. Always save working copy into OS Temp Folder (Windows %TEMP%/pirom_pdplan & macOS $TMPDIR/pirom_pdplan)
                  try { fs.writeFileSync(tempPlanPath, lightPlanStr, 'utf-8'); } catch (e) {}

                  if (payload.workCenters) {
                    const mPayload = {
                      updatedAt: new Date().toISOString(),
                      workCenters: payload.workCenters,
                      workCenterOrder: payload.workCenterOrder || Object.keys(payload.workCenters)
                    };
                    const mStr = JSON.stringify(mPayload, null, 2);
                    try { fs.writeFileSync(tempMachinePath, mStr, 'utf-8'); } catch (e) {}
                    if (!tempOnly) {
                      fs.writeFileSync(machineFilePath, mStr, 'utf-8');
                      if (fs.existsSync(gdriveDir)) {
                        try { fs.writeFileSync(path.join(gdriveDir, 'machine_settings.json'), mStr, 'utf-8'); } catch (e) {}
                      }
                    }
                  }

                  if (payload.completedPdHistory) {
                    const cStr = JSON.stringify(payload.completedPdHistory, null, 2);
                    try { fs.writeFileSync(tempCompletedPath, cStr, 'utf-8'); } catch (e) {}
                    if (!tempOnly) {
                      fs.writeFileSync(completedFilePath, cStr, 'utf-8');
                      if (fs.existsSync(gdriveDir)) {
                        try { fs.writeFileSync(path.join(gdriveDir, 'completed_pds.json'), cStr, 'utf-8'); } catch (e) {}
                      }
                    }
                  }

                  // 2. Only write to Local Project + Google Drive Desktop + Cloud when tempOnly is false (i.e., user clicked Save)
                  if (!tempOnly) {
                    fs.writeFileSync(planFilePath, lightPlanStr, 'utf-8');
                    if (fs.existsSync(gdriveDir)) {
                      try {
                        fs.writeFileSync(path.join(gdriveDir, 'Plan.json'), lightPlanStr, 'utf-8');
                      } catch (e) {}
                    }
                    if (fs.existsSync(tempPdPath)) {
                      try {
                        const tempPdContent = fs.readFileSync(tempPdPath, 'utf-8');
                        fs.writeFileSync(pdFilePath, tempPdContent, 'utf-8');
                        if (fs.existsSync(gdriveDir)) {
                          try { fs.writeFileSync(gdrivePdPath, tempPdContent, 'utf-8'); } catch (e) {}
                        }
                      } catch (e) {}
                    }
                    if (forwardCloud) {
                      const savedCfg = readCloudConfig();
                      const ep = (savedCfg.endpointUrl || '').trim();
                      if (ep && ep.startsWith('http') && !ep.includes('drive.google.com/drive/folders')) {
                        fetch(ep, {
                          method: 'POST',
                          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                          body: JSON.stringify(lightPlan)
                        }).catch(err => console.warn('Server-side forwardCloud failed:', err));
                      }
                    }
                  }
                  
                  // Also clean up old plan.md if it exists to keep workspace tidy
                  const oldPlanMd = path.resolve(__dirname, 'plan.md');
                  if (fs.existsSync(oldPlanMd)) {
                    fs.unlinkSync(oldPlanMd);
                  }
                  
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    savedTo: tempOnly ? 'temp' : 'cloud',
                    tempDir: tempCacheDir,
                    platform: process.platform
                  }));
                } catch (err) {
                  console.error('Error saving Plan.json:', err);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }
          }

          if (cleanUrl === '/api/qc-log' || cleanUrl.startsWith('/api/qc-log?')) {
            try {
              const fetchUrl = 'https://docs.google.com/spreadsheets/d/1w8B0DyG7PEy_YLHM5HCI_eVU_nt4HvA8xHWShuLRL_8/export?format=csv&gid=1814251242';
              const fetchRes = await fetch(fetchUrl);
              if (!fetchRes.ok) {
                res.statusCode = fetchRes.status;
                res.end(JSON.stringify({ error: `Google Sheets returned status ${fetchRes.status}` }));
                return;
              }
              const csvText = await fetchRes.text();
              res.setHeader('Content-Type', 'text/csv; charset=utf-8');
              res.statusCode = 200;
              res.end(csvText);
              return;
            } catch (err) {
              console.error('Error fetching QC Log from Google Sheets:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
              return;
            }
          }

          if (cleanUrl === '/api/plan-materials' || cleanUrl.startsWith('/api/plan-materials?')) {
            const urlObj = new URL(req.url, 'http://localhost');
            const requestedFile = urlObj.searchParams.get('filename') || 'LN Status Overview.xlsx';
            const force = urlObj.searchParams.get('force') === '1' || urlObj.searchParams.get('refresh') === 'true';
            const gdriveFile = path.join(gdriveDir, requestedFile);
            
            try {
              const checkPath = fs.existsSync(gdriveFile) ? gdriveFile : path.join(gdriveDir, 'LN Status Overview.xlsx');
              if (fs.existsSync(checkPath)) {
                const targetName = path.basename(checkPath);
                const localXlsx = path.resolve(__dirname, targetName);
                let needRefresh = false;
                if (!fs.existsSync(localXlsx) || (fs.existsSync(checkPath) && fs.statSync(checkPath).mtimeMs > fs.statSync(localXlsx).mtimeMs)) {
                  fs.copyFileSync(checkPath, localXlsx);
                  needRefresh = true;
                }
                if (force || needRefresh || (!fs.existsSync(tempMatCachePath) && !fs.existsSync(localMatCachePath))) {
                  const { execSync } = await import('child_process');
                  const scriptPath = path.resolve(__dirname, 'scripts', 'sync_plan_materials.py');
                  if (fs.existsSync(scriptPath)) {
                    const pyCommands = process.platform === 'win32'
                      ? [`python "${scriptPath}" "${targetName}"`, `py -3 "${scriptPath}" "${targetName}"`, `python3 "${scriptPath}" "${targetName}"`]
                      : [`python3 "${scriptPath}" "${targetName}"`, `python "${scriptPath}" "${targetName}"`];
                    for (const cmd of pyCommands) {
                      try {
                        execSync(cmd, { timeout: 45000 });
                        break;
                      } catch {}
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('Auto-sync from Google Drive error:', e.message);
            }

            // Ensure Temp Local Disk cache is seeded and up-to-date with local workspace cache
            if (fs.existsSync(localMatCachePath)) {
              try {
                if (!fs.existsSync(tempMatCachePath) || fs.statSync(localMatCachePath).mtimeMs > fs.statSync(tempMatCachePath).mtimeMs) {
                  fs.copyFileSync(localMatCachePath, tempMatCachePath);
                }
              } catch {}
            }

            const activeCachePath = fs.existsSync(tempMatCachePath)
              ? tempMatCachePath
              : (fs.existsSync(localMatCachePath) ? localMatCachePath : null);

            if (activeCachePath) {
              try {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('X-Cache-Location', activeCachePath === tempMatCachePath ? 'temp-local-disk' : 'local-workspace');
                const stream = fs.createReadStream(activeCachePath);
                stream.on('error', (err) => {
                  console.error('Error streaming plan_materials_cache.json:', err);
                  if (!res.headersSent) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: err.message }));
                  }
                });
                stream.pipe(res);
                return;
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
                return;
              }
            } else {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.statusCode = 200;
              res.end(JSON.stringify({ planMaterials: {}, dwgToPdMap: {}, pdOpStatusMap: {} }));
              return;
            }
          }

          if (cleanUrl === '/api/dwg-pdf' || cleanUrl.startsWith('/api/dwg-pdf?')) {
            const urlObj = new URL(req.url, 'http://localhost');
            const dwgNo = urlObj.searchParams.get('dwgNo') || '';
            const customDwgDir = (urlObj.searchParams.get('dwgDir') || '').trim();

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');

            if (!dwgNo) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ status: 'error', message: 'No dwgNo specified' }));
              return;
            }

            const cleanKey = dwgNo.replace(/[-_\s.]/g, '').toUpperCase();
            
            const candidateDirs = [];
            if (customDwgDir && !/^https?:\/\//i.test(customDwgDir)) {
              const resolvedCustom = path.isAbsolute(customDwgDir)
                ? customDwgDir
                : path.resolve(__dirname, customDwgDir);
              candidateDirs.push(resolvedCustom);
            }
            for (const gd of gdriveCandidates) {
              candidateDirs.push(path.join(gd, 'dwg'));
            }
            candidateDirs.push(
              path.resolve(__dirname, 'dwg'),
              path.resolve(__dirname, '..', 'dwg')
            );
            for (const gd of gdriveCandidates) {
              candidateDirs.push(gd);
            }

            let matchedFilePath = null;

            function searchDirRecursive(dir) {
              if (matchedFilePath || !fs.existsSync(dir)) return;
              try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const fullPath = path.join(dir, entry.name);
                  if (entry.isDirectory()) {
                    searchDirRecursive(fullPath);
                    if (matchedFilePath) return;
                  } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
                    const cleanName = entry.name.replace(/[-_\s.]/g, '').toUpperCase();
                    if (cleanName.includes(cleanKey)) {
                      matchedFilePath = fullPath;
                      return;
                    }
                  }
                }
              } catch (e) {}
            }

            for (const cDir of candidateDirs) {
              searchDirRecursive(cDir);
              if (matchedFilePath) break;
            }

            const preferCloud = urlObj.searchParams.get('preferCloud') === '1' && urlObj.searchParams.get('stream') !== '1';
            const tryCloudLookup = async () => {
              const savedCfg = readCloudConfig();
              const ep = (urlObj.searchParams.get('endpointUrl') || savedCfg.endpointUrl || '').trim();
              const dwgFolderId = (urlObj.searchParams.get('dwgFolderId') || '1M-QDPilC7Nn-YW_5YxLQITUS6ZOYEyFm').trim();
              if (ep && ep.startsWith('http') && !ep.includes('drive.google.com/drive/folders')) {
                try {
                  const sep = ep.includes('?') ? '&' : '?';
                  const cloudUrl = `${ep}${sep}action=find-dwg-pdf&dwgNo=${encodeURIComponent(dwgNo)}&dwgFolderId=${encodeURIComponent(dwgFolderId)}&t=${Date.now()}`;
                  const cr = await fetch(cloudUrl, { method: 'GET', redirect: 'follow' });
                  if (cr.ok) {
                    const cdata = await cr.json();
                    if (cdata && cdata.status === 'success') {
                      if (cdata.fileId) {
                        cdata.viewUrl = `https://drive.google.com/file/d/${cdata.fileId}/view`;
                        cdata.fileUrl = cdata.viewUrl;
                      }
                      return Object.assign({ source: 'cloud_api' }, cdata);
                    }
                  }
                } catch {}
              }
              return null;
            };

            if (preferCloud) {
              const cloudRes = await tryCloudLookup();
              if (cloudRes) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(cloudRes));
                return;
              }
            }

            if (matchedFilePath) {
              const fileName = path.basename(matchedFilePath);
              const dirParam = customDwgDir ? `&dwgDir=${encodeURIComponent(customDwgDir)}` : '';
              const streamUrl = `/pirom_pdplan/api/dwg-pdf?dwgNo=${encodeURIComponent(dwgNo)}${dirParam}&stream=1`;
              if (urlObj.searchParams.get('stream') === '1') {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
                fs.createReadStream(matchedFilePath).pipe(res);
                return;
              }
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({
                status: 'success',
                fileName: fileName,
                filename: fileName,
                matchedPath: matchedFilePath,
                fileUrl: streamUrl,
                viewUrl: streamUrl
              }));
              return;
            } else {
              // Fallback for machines without Drive G: query Cloud Web App API if configured
              const cloudRes = await tryCloudLookup();
              if (cloudRes) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(cloudRes));
                return;
              }
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ status: 'not_found', message: 'ไม่พบ file แบบ', searchedDirs: candidateDirs }));
              return;
            }
          }

          if (cleanUrl === '/api/browse-dwg-folder' || cleanUrl.startsWith('/api/browse-dwg-folder?')) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            try {
              const { execFile } = await import('child_process');
              if (process.platform === 'darwin') {
                const appleScript = 'POSIX path of (choose folder with prompt "เลือกโฟลเดอร์เก็บไฟล์ DWG / Drawing PDF")';
                execFile('osascript', ['-e', appleScript], { timeout: 120000 }, (err, stdout) => {
                  const selected = (stdout || '').trim();
                  if (err && !selected) {
                    res.statusCode = 200;
                    res.end(JSON.stringify({ status: 'cancelled' }));
                    return;
                  }
                  if (selected) {
                    res.statusCode = 200;
                    res.end(JSON.stringify({ status: 'success', folderPath: selected }));
                  } else {
                    res.statusCode = 200;
                    res.end(JSON.stringify({ status: 'cancelled' }));
                  }
                });
              } else {
                const psScript = [
                  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
                  "Add-Type -AssemblyName System.Windows.Forms;",
                  "$top = New-Object System.Windows.Forms.Form;",
                  "$top.TopMost = $true;",
                  "$f = New-Object System.Windows.Forms.FolderBrowserDialog;",
                  "$f.Description = 'เลือกโฟลเดอร์เก็บไฟล์ DWG / Drawing PDF';",
                  "$f.ShowNewFolderButton = $true;",
                  "if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
                  "$top.Dispose();"
                ].join(' ');
                execFile('powershell.exe', ['-NoProfile', '-Sta', '-Command', psScript], { timeout: 120000 }, (err, stdout) => {
                  const selected = (stdout || '').trim();
                  if (err && !selected) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ status: 'error', message: err.message }));
                    return;
                  }
                  if (selected) {
                    res.statusCode = 200;
                    res.end(JSON.stringify({ status: 'success', folderPath: selected }));
                  } else {
                    res.statusCode = 200;
                    res.end(JSON.stringify({ status: 'cancelled' }));
                  }
                });
              }
              return;
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ status: 'error', message: err.message }));
              return;
            }
          }

          if (cleanUrl === '/api/open-dwg-folder' || cleanUrl.startsWith('/api/open-dwg-folder?')) {
            const urlObj = new URL(req.url, 'http://localhost');
            const rawDir = (urlObj.searchParams.get('dir') || '').trim();
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            try {
              const defaultDwgDir = fs.existsSync(path.join(gdriveDir, 'dwg'))
                ? path.join(gdriveDir, 'dwg')
                : path.resolve(__dirname, 'dwg');
              const expandedRaw = rawDir.startsWith('~/') ? path.join(os.homedir(), rawDir.slice(2)) : rawDir;
              const resolvedDir = expandedRaw
                ? (path.isAbsolute(expandedRaw) ? expandedRaw : path.resolve(__dirname, expandedRaw))
                : defaultDwgDir;
              if (!fs.existsSync(resolvedDir)) {
                res.statusCode = 404;
                res.end(JSON.stringify({ status: 'not_found', message: `ไม่พบโฟลเดอร์ในเครื่อง: ${resolvedDir}`, resolvedDir }));
                return;
              }
              const { execFile } = await import('child_process');
              const openCmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'explorer.exe' : 'xdg-open');
              execFile(openCmd, [resolvedDir], () => {});
              res.statusCode = 200;
              res.end(JSON.stringify({ status: 'success', openedPath: resolvedDir }));
              return;
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ status: 'error', message: err.message }));
              return;
            }
          }

          if (cleanUrl === '/api/status-overview' || cleanUrl.startsWith('/api/status-overview?')) {
            const urlObj = new URL(req.url, 'http://localhost');
            const requestedFile = urlObj.searchParams.get('filename') || 'LN Status Overview.xlsx';

            if (req.method === 'POST') {
              const chunks = [];
              req.on('data', chunk => chunks.push(chunk));
              req.on('end', () => {
                try {
                  const buffer = Buffer.concat(chunks);
                  const targetPath = path.resolve(__dirname, requestedFile);
                  fs.writeFileSync(targetPath, buffer);
                  res.statusCode = 200;
                  res.end(JSON.stringify({ success: true, filename: requestedFile, size: buffer.length }));
                } catch (err) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }

            const candidateNames = [
              path.join(gdriveDir, requestedFile),
              path.resolve(__dirname, requestedFile),
              path.join(gdriveDir, 'LN Status Overview.xlsx'),
              path.resolve(__dirname, 'LN Status Overview.xlsx'),
              path.resolve(__dirname, 'LN Status Overview.xls'),
              'Week 38 26-09-15 Status Overview.xlsx',
              'Week 38 26-09-14 Status Overview.xlsx'
            ];
            let foundFile = null;
            for (const name of candidateNames) {
              const p = path.isAbsolute(name) ? name : path.resolve(__dirname, name);
              if (fs.existsSync(p)) {
                foundFile = p;
                break;
              }
            }
            if (foundFile) {
              try {
                const buf = fs.readFileSync(foundFile);
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('X-Filename', encodeURIComponent(path.basename(foundFile)));
                res.setHeader('Access-Control-Expose-Headers', 'X-Filename');
                res.statusCode = 200;
                res.end(buf);
                return;
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
                return;
              }
            } else {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'No Status Overview file found in workspace or Google Drive' }));
              return;
            }
          }

          if (cleanUrl === '/api/check-storage-status' || cleanUrl.startsWith('/api/check-storage-status?')) {
            const urlObj = new URL(req.url, 'http://localhost');
            const savedCfg = readCloudConfig();
            const statusFilename = (urlObj.searchParams.get('statusFilename') || savedCfg.statusOverviewFilename || 'LN Status Overview.xlsx').trim();
            const customDwgDir = (urlObj.searchParams.get('dwgDir') || '').trim();
            const driveUrl = (urlObj.searchParams.get('driveUrl') || savedCfg.driveFolderUrl || '').trim();
            const dwgUrl = (urlObj.searchParams.get('dwgUrl') || savedCfg.dwgFolderUrl || '').trim();
            const queryEndpoint = (urlObj.searchParams.get('endpointUrl') || '').trim();
            const endpointUrl = queryEndpoint || savedCfg.endpointUrl || '';
            if (queryEndpoint && queryEndpoint !== savedCfg.endpointUrl) {
              writeCloudConfig({ endpointUrl: queryEndpoint });
            }

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');

            const inspectFile = (candidates) => {
              for (const p of candidates) {
                if (p && fs.existsSync(p)) {
                  try {
                    const st = fs.statSync(p);
                    const lowerP = p.toLowerCase();
                    const isGd = lowerP.includes('my drive') || lowerP.includes('ไดรฟ์ของฉัน') || lowerP.includes('googledrive');
                    const isTemp = p.startsWith(tempCacheDir);
                    return {
                      exists: true,
                      path: p,
                      name: path.basename(p),
                      sizeBytes: st.size,
                      sizeKB: +(st.size / 1024).toFixed(1),
                      sizeMB: +(st.size / (1024 * 1024)).toFixed(2),
                      updatedAt: st.mtime.toISOString(),
                      inGoogleDrive: isGd,
                      inTempLocalDisk: isTemp,
                      sourceType: isTemp ? 'temp_local_disk' : (isGd ? 'gdrive_desktop' : 'local_workspace')
                    };
                  } catch {}
                }
              }
              return { exists: false };
            };

            const gdriveExists = fs.existsSync(gdriveDir);
            const gdrivePlanPath = path.join(gdriveDir, 'Plan.json');
            const localPlanPath = path.resolve(__dirname, 'Plan.json');
            if (gdriveExists && !fs.existsSync(gdrivePlanPath) && fs.existsSync(localPlanPath)) {
              try {
                const localData = JSON.parse(fs.readFileSync(localPlanPath, 'utf-8'));
                const lightPlan = Object.assign({}, localData);
                delete lightPlan.planMaterials;
                delete lightPlan.dwgToPdMap;
                delete lightPlan.pdOpStatusMap;
                fs.writeFileSync(gdrivePlanPath, JSON.stringify(lightPlan, null, 2), 'utf-8');
              } catch (e) {}
            }
            // Seed Temp Local Disk cache from local workspace if missing or older
            if (fs.existsSync(localMatCachePath)) {
              try {
                if (!fs.existsSync(tempMatCachePath) || fs.statSync(localMatCachePath).mtimeMs > fs.statSync(tempMatCachePath).mtimeMs) {
                  fs.copyFileSync(localMatCachePath, tempMatCachePath);
                }
              } catch (e) {}
            }

            const planInfo = inspectFile([gdrivePlanPath, localPlanPath]);
            const machineInfo = inspectFile([path.join(gdriveDir, 'machine_settings.json'), path.resolve(__dirname, 'machine_settings.json')]);
            const completedInfo = inspectFile([path.join(gdriveDir, 'completed_pds.json'), path.resolve(__dirname, 'completed_pds.json')]);
            const overviewInfo = inspectFile([
              path.join(gdriveDir, statusFilename),
              path.resolve(__dirname, statusFilename),
              path.join(gdriveDir, 'LN Status Overview.xlsx'),
              path.resolve(__dirname, 'LN Status Overview.xlsx')
            ]);
            const matCacheInfo = inspectFile([tempMatCachePath, localMatCachePath]);

            // Count PDF files in DWG directories
            const dwgDirsToCheck = [];
            if (customDwgDir && !/^https?:\/\//i.test(customDwgDir)) {
              const resolvedCustom = path.isAbsolute(customDwgDir) ? customDwgDir : path.resolve(__dirname, customDwgDir);
              if (fs.existsSync(resolvedCustom)) dwgDirsToCheck.push(resolvedCustom);
            }
            const gdriveDwg = path.join(gdriveDir, 'dwg');
            if (fs.existsSync(gdriveDwg) && !dwgDirsToCheck.includes(gdriveDwg)) {
              dwgDirsToCheck.push(gdriveDwg);
            }
            const localDwg = path.resolve(__dirname, 'dwg');
            if (fs.existsSync(localDwg) && !dwgDirsToCheck.includes(localDwg)) {
              dwgDirsToCheck.push(localDwg);
            }

            let pdfCount = 0;
            let dwgSubfolders = [];
            const activeDwgDir = dwgDirsToCheck[0] || '';

            const cacheNow = Date.now();
            if (
              activeDwgDir &&
              globalThis.__dwgScanCache &&
              globalThis.__dwgScanCache.dir === activeDwgDir &&
              cacheNow - globalThis.__dwgScanCache.ts < 300000
            ) {
              pdfCount = globalThis.__dwgScanCache.pdfCount;
              dwgSubfolders = globalThis.__dwgScanCache.subfolders;
            } else if (activeDwgDir) {
              const countPdfs = (dir, depth = 0) => {
                if (!dir || !fs.existsSync(dir)) return;
                try {
                  const entries = fs.readdirSync(dir, { withFileTypes: true });
                  for (const entry of entries) {
                    if (entry.isDirectory()) {
                      if (depth === 0) dwgSubfolders.push(entry.name);
                      countPdfs(path.join(dir, entry.name), depth + 1);
                    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
                      pdfCount++;
                    }
                  }
                } catch {}
              };
              countPdfs(activeDwgDir, 0);
              globalThis.__dwgScanCache = {
                dir: activeDwgDir,
                pdfCount,
                subfolders: dwgSubfolders,
                ts: cacheNow
              };
            }

            // Check Google Apps Script Cloud Web App API (works on ALL machines even without Drive G:)
            let cloudApi = {
              configured: Boolean(endpointUrl),
              endpointUrl: endpointUrl || '',
              ok: false,
              message: 'ยังไม่ได้ตั้งค่า Web App Sync API URL (จำเป็นสำหรับเครื่องที่ไม่มี Drive G:)',
              cloudFiles: null,
              cloudDwgFolder: null
            };
            if (endpointUrl) {
              if (endpointUrl.includes('drive.google.com/drive/folders')) {
                cloudApi.message = 'เป็นลิงก์โฟลเดอร์ Google Drive ไม่ใช่ Web App URL (https://script.google.com/macros/s/.../exec)';
              } else if (/\/dev(\?|$)/i.test(endpointUrl)) {
                cloudApi.message = 'ลิงก์ลงท้ายด้วย /dev (เป็นลิงก์ Test ใช้ผ่าน API ไม่ได้) กรุณากด Deploy > New deployment ตั้งสิทธิ์เป็น Anyone แล้วใช้ลิงก์ที่ลงท้ายด้วย /exec';
              } else if (endpointUrl.startsWith('http')) {
                try {
                  const dwgMatches = [...(dwgUrl || '').matchAll(/folders\/([a-zA-Z0-9_-]+)/g)];
                  let dwgFolderId = dwgMatches.length > 0 ? dwgMatches[dwgMatches.length - 1][1] : '1M-QDPilC7Nn-YW_5YxLQITUS6ZOYEyFm';
                  if (dwgFolderId === '17w0vlhgTfMW18p2H0LRq2aB1fOSHEdvg') dwgFolderId = '1M-QDPilC7Nn-YW_5YxLQITUS6ZOYEyFm';
                  const sep = endpointUrl.includes('?') ? '&' : '?';
                  const controller = new AbortController();
                  const timer = setTimeout(() => controller.abort(), 8000);
                  const r = await fetch(`${endpointUrl}${sep}action=check-cloud-status&statusFilename=${encodeURIComponent(statusFilename)}&dwgFolderId=${encodeURIComponent(dwgFolderId)}&t=${Date.now()}`, {
                    method: 'GET',
                    redirect: 'follow',
                    signal: controller.signal
                  });
                  clearTimeout(timer);
                  if (r.ok) {
                    const txt = await r.text();
                    const lowerTxt = txt.toLowerCase();
                    if (lowerTxt.includes('<!doctype') || lowerTxt.includes('<html') || lowerTxt.includes('accounts.google.com')) {
                      cloudApi.message = 'ติดหน้า Google Sign-In (กรุณาตั้งค่า Deploy -> ผู้ที่มีสิทธิ์เข้าถึง เป็น "ทุกคน / Anyone" และใช้ลิงก์ /exec)';
                    } else {
                      const parsed = JSON.parse(txt);
                      if (parsed && parsed.status === 'success') {
                        cloudApi.ok = true;
                        cloudApi.message = 'เชื่อมต่อ Google Drive Cloud API สำเร็จ (ใช้งานได้ทุกเครื่อง ไม่ต้องมี Drive G:)';
                        if (parsed.files) {
                          cloudApi.cloudFiles = parsed.files;
                          cloudApi.cloudDwgFolder = parsed.dwgFolder || null;
                        } else if (parsed.data) {
                          // Fallback for older deployed GAS script that returns default doGet payload
                          const d = parsed.data;
                          cloudApi.cloudFiles = {
                            planJson: { exists: Array.isArray(d.scheduledJobs), updatedAt: parsed.lastModified || null, tasksCount: (d.scheduledJobs || []).length },
                            machineSettings: { exists: Boolean(d.workCenters && Object.keys(d.workCenters).length > 0), wcCount: Object.keys(d.workCenters || {}).length },
                            completedPds: { exists: Boolean(d.completedPdHistory && Object.keys(d.completedPdHistory).length > 0), count: Object.keys(d.completedPdHistory || {}).length }
                          };
                        }
                      } else {
                        cloudApi.message = (parsed && parsed.message) || 'Google Apps Script ส่งคืนสถานะ error';
                      }
                    }
                  } else {
                    cloudApi.message = `HTTP ${r.status}`;
                  }
                } catch (err) {
                  cloudApi.message = `ไม่สามารถติดต่อ Cloud API ได้: ${err.message}`;
                }
              }
            }

            res.statusCode = 200;
            res.end(JSON.stringify({
              status: 'success',
              checkedAt: new Date().toISOString(),
              savedCloudConfig: readCloudConfig(),
              cloudApi,
              gdriveDesktop: {
                mounted: gdriveExists,
                path: gdriveExists ? gdriveDir : null
              },
              dwgStorage: {
                exists: Boolean(activeDwgDir),
                activePath: activeDwgDir,
                inGoogleDrive: activeDwgDir ? (activeDwgDir.toLowerCase().includes('my drive') || activeDwgDir.toLowerCase().includes('ไดรฟ์ของฉัน')) : false,
                pdfCount,
                subfolders: dwgSubfolders
              },
              files: {
                planJson: planInfo,
                machineSettings: machineInfo,
                completedPds: completedInfo,
                statusOverview: overviewInfo,
                planMaterialsCache: matCacheInfo
              }
            }));
            return;
          }
          next();
        });
      }
    }
  ]
});
