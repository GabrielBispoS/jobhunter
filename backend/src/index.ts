import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import { router } from './routes';
import { getDb } from './db';
import { startCronJobs } from './cron';

const app = express();
const PORT = process.env['PORT'] || 3001;

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(cors({ origin: process.env['FRONTEND_URL'] || '*' }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};
  try { await getDb(); checks['db'] = 'ok'; } catch { checks['db'] = 'error'; }
  const { isMailConfigured } = await import('./mailer');
  checks['mail'] = isMailConfigured() ? 'configured' : 'not_configured';
  const allOk = Object.values(checks).every(v => v === 'ok' || v === 'configured' || v === 'not_configured');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', ts: new Date().toISOString(), checks });
});

app.use('/api', router);

// Serve frontend static files (dev mode without Docker)
const frontendDir = path.join(__dirname, '../../frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
  app.get('/', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
}

getDb().then(async () => {
  console.log('✅ Database initialized');
  await startCronJobs();
  app.listen(PORT, () => {
    console.log(`🚀 JobHunter API running at http://localhost:${PORT}`);
  });
}).catch((err: Error) => {
  console.error('❌ Startup error:', err);
  process.exit(1);
});

export default app;
