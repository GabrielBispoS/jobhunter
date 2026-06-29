import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

const JWT_SECRET = process.env['JWT_SECRET'] || 'dev-secret-change-me-in-production';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Parse USERS="name:pass,name2:pass2"
// Falls back to AUTH_PASSWORD with user_id 'default' for backward compat
function parseUsers(): Map<string, string> {
  const map = new Map<string, string>();
  const usersEnv = process.env['USERS'];
  if (usersEnv) {
    for (const entry of usersEnv.split(',')) {
      const colonIdx = entry.indexOf(':');
      if (colonIdx < 1) continue;
      const name = entry.slice(0, colonIdx).trim();
      const pass = entry.slice(colonIdx + 1).trim();
      if (name && pass) map.set(name, pass);
    }
  }
  const legacyPass = process.env['AUTH_PASSWORD'];
  if (legacyPass && map.size === 0) {
    map.set('default', legacyPass);
  }
  return map;
}

const USERS = parseUsers();

export function isAuthEnabled(): boolean {
  return USERS.size > 0;
}

export function resolveUser(provided: string): string | null {
  if (!isAuthEnabled()) return 'default';
  const maxLen = 128;
  for (const [userId, password] of USERS) {
    const a = Buffer.alloc(maxLen);
    const b = Buffer.alloc(maxLen);
    Buffer.from(provided.slice(0, maxLen)).copy(a);
    Buffer.from(password.slice(0, maxLen)).copy(b);
    if (crypto.timingSafeEqual(a, b) && provided.length === password.length) {
      return userId;
    }
  }
  return null;
}

export function signToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now(), uid: userId, v: 2 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function getUserFromToken(token: string): string | null {
  try {
    const last = token.lastIndexOf('.');
    if (last < 1) return null;
    const payload = token.slice(0, last);
    const sig = token.slice(last + 1);
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.iat !== 'number' || Date.now() - data.iat >= TOKEN_TTL_MS) return null;
    // v1 tokens (no uid field) fall back to 'default'
    return (data.uid as string) || 'default';
  } catch {
    return null;
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) { req.userId = 'default'; next(); return; }
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = getUserFromToken(token);
  if (!userId) {
    res.status(401).json({ error: 'Não autenticado.' });
    return;
  }
  req.userId = userId;
  next();
}
