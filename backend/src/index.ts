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

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.use('/api', router);

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
