import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import { router } from './routes';
import { getDb } from './db';
import { startCronJobs } from './cron';
import { authMiddleware, resolveUser, signToken, isAuthEnabled } from './auth';

const app = express();
const PORT = process.env['PORT'] || 3001;

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── Security headers ──────────────────────────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigin = process.env['FRONTEND_URL'] || 'http://localhost:3001';
app.use(cors({
  origin: allowedOrigin === '*' ? true : allowedOrigin,
  credentials: true,
}));

// ── Rate limiter (in-memory, no packages) ─────────────────────────────────────
const rlStore = new Map<string, { n: number; resetAt: number }>();
function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = (req.ip || 'unknown');
    const now = Date.now();
    const entry = rlStore.get(key);
    if (!entry || now > entry.resetAt) {
      rlStore.set(key, { n: 1, resetAt: now + windowMs });
      next(); return;
    }
    if (entry.n >= max) {
      res.status(429).json({ error: 'Muitas requisições. Aguarde e tente novamente.' });
      return;
    }
    entry.n++;
    next();
  };
}

// Purge stale rate limit entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rlStore.entries()) {
    if (now > entry.resetAt) rlStore.delete(key);
  }
}, 10 * 60 * 1000);

app.use(express.json({ limit: '10mb' }));

// ── Public endpoints ──────────────────────────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};
  try { await getDb(); checks['db'] = 'ok'; } catch { checks['db'] = 'error'; }
  const { isMailConfigured } = await import('./mailer');
  checks['mail'] = isMailConfigured() ? 'configured' : 'not_configured';
  const allOk = Object.values(checks).every(v => v === 'ok' || v === 'configured' || v === 'not_configured');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', ts: new Date().toISOString(), checks });
});

// Login — strict rate limit: 10 attempts per 15 minutes per IP
app.post('/api/auth/login', rateLimit(10, 15 * 60 * 1000), (req: Request, res: Response) => {
  if (!isAuthEnabled()) {
    res.json({ token: '', message: 'Autenticação não configurada.' });
    return;
  }
  const { password } = req.body as { password?: string };
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: 'Senha obrigatória.' });
    return;
  }
  const userId = resolveUser(password);
  if (!userId) {
    res.status(401).json({ error: 'Senha incorreta.' });
    return;
  }
  res.json({ token: signToken(userId) });
});

// ── Protected API routes ──────────────────────────────────────────────────────
// General rate limit: 300 requests per minute per IP
app.use('/api', rateLimit(300, 60 * 1000), authMiddleware, router);

// ── Serve frontend static files ───────────────────────────────────────────────
const frontendDir = path.join(__dirname, '../../frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
  app.get('/', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
}

getDb().then(async () => {
  console.log('✅ Database initialized');
  if (isAuthEnabled()) {
    console.log('🔐 Authentication enabled — AUTH_PASSWORD is set');
  } else {
    console.log('⚠️  Authentication disabled — set AUTH_PASSWORD in .env to enable');
  }
  await startCronJobs();
  app.listen(PORT, () => {
    console.log(`🚀 JobHunter API running at http://localhost:${PORT}`);
  });
}).catch((err: Error) => {
  console.error('❌ Startup error:', err);
  process.exit(1);
});

export default app;
