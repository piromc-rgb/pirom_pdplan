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
          if (req.url === '/api/pd' || req.url?.startsWith('/api/pd?')) {
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

          if (req.url === '/api/plan' || req.url?.startsWith('/api/plan?')) {
            const planFilePath = path.resolve(__dirname, 'Plan.json');
            
            if (req.method === 'GET') {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              if (fs.existsSync(planFilePath)) {
                try {
                  const content = fs.readFileSync(planFilePath, 'utf-8');
                  res.statusCode = 200;
                  res.end(content);
                  return;
                } catch (err) {
                  console.error('Error reading Plan.json:', err);
                }
              }
              res.statusCode = 200;
              res.end(JSON.stringify({ scheduledJobs: [], nests: {} }));
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
          next();
        });
      }
    }
  ]
});
