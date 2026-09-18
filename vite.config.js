import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const today = new Date();
const yy = String(today.getFullYear()).slice(-2);
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const compileVersion = `${yy}${mm}${dd}`;

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

          if (cleanUrl === '/api/pd' || cleanUrl.startsWith('/api/pd?')) {
            const pdFilePath = path.resolve(__dirname, 'pd.md');
            
            if (req.method === 'GET') {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              if (fs.existsSync(pdFilePath)) {
                try {
                  const content = fs.readFileSync(pdFilePath, 'utf-8');
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
              let body = '';
              req.on('data', chunk => {
                body += chunk;
              });
              req.on('end', () => {
                try {
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
                  
                  fs.writeFileSync(pdFilePath, markdownContent, 'utf-8');
                  res.statusCode = 200;
                  res.end(JSON.stringify({ success: true }));
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
            const machineFilePath = path.resolve(__dirname, 'machine_settings.json');
            const completedFilePath = path.resolve(__dirname, 'completed_pds.json');
            
            if (req.method === 'GET') {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              let content = { scheduledJobs: [], nests: {}, completedPdHistory: {}, workCenters: {}, workCenterOrder: [] };
              if (fs.existsSync(planFilePath)) {
                try {
                  const raw = fs.readFileSync(planFilePath, 'utf-8');
                  content = Object.assign(content, JSON.parse(raw));
                } catch (err) {
                  console.error('Error reading Plan.json:', err);
                }
              }
              if (fs.existsSync(machineFilePath)) {
                try {
                  const mRaw = JSON.parse(fs.readFileSync(machineFilePath, 'utf-8'));
                  if (mRaw.workCenters) content.workCenters = mRaw.workCenters;
                  if (mRaw.workCenterOrder) content.workCenterOrder = mRaw.workCenterOrder;
                } catch (e) {}
              }
              if (fs.existsSync(completedFilePath)) {
                try {
                  const cRaw = JSON.parse(fs.readFileSync(completedFilePath, 'utf-8'));
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
              let body = '';
              req.on('data', chunk => {
                body += chunk;
              });
              req.on('end', () => {
                try {
                  const payload = JSON.parse(body);
                  delete payload.formattedRows; // Not needed in Plan.json
                  
                  fs.writeFileSync(planFilePath, JSON.stringify(payload, null, 2), 'utf-8');

                  if (payload.workCenters) {
                    const mPayload = {
                      updatedAt: new Date().toISOString(),
                      workCenters: payload.workCenters,
                      workCenterOrder: payload.workCenterOrder || Object.keys(payload.workCenters)
                    };
                    fs.writeFileSync(machineFilePath, JSON.stringify(mPayload, null, 2), 'utf-8');
                  }

                  if (payload.completedPdHistory) {
                    fs.writeFileSync(completedFilePath, JSON.stringify(payload.completedPdHistory, null, 2), 'utf-8');
                  }
                  
                  // Also clean up old plan.md if it exists to keep workspace tidy
                  const oldPlanMd = path.resolve(__dirname, 'plan.md');
                  if (fs.existsSync(oldPlanMd)) {
                    fs.unlinkSync(oldPlanMd);
                  }
                  
                  res.statusCode = 200;
                  res.end(JSON.stringify({ success: true }));
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

          if (cleanUrl === '/api/status-overview' || cleanUrl.startsWith('/api/status-overview?')) {
            const candidateNames = [
              'LN Status Overview.xls',
              'LN Status Overview.xlsx',
              'Week 38 26-09-15 Status Overview.xlsx',
              'Week 38 26-09-14 Status Overview.xlsx'
            ];
            let foundFile = null;
            for (const name of candidateNames) {
              const p = path.resolve(__dirname, name);
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
              res.end(JSON.stringify({ error: 'No LN Status Overview file found in workspace' }));
              return;
            }
          }
          next();
        });
      }
    }
  ]
});
