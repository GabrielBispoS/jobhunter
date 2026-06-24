import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env['JWT_SECRET'] || 'dev-secret-change-me-in-production';
const AUTH_PASSWORD = process.env['AUTH_PASSWORD'] || '';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function isAuthEnabled(): boolean {
  return !!AUTH_PASSWORD;
}

export function validatePassword(provided: string): boolean {
  if (!AUTH_PASSWORD) return true;
  const maxLen = 128;
  const a = Buffer.alloc(maxLen);
  const b = Buffer.alloc(maxLen);
  Buffer.from(provided.slice(0, maxLen)).copy(a);
  Buffer.from(AUTH_PASSWORD.slice(0, maxLen)).copy(b);
  const bytesMatch = crypto.timingSafeEqual(a, b);
  return bytesMatch && provided.length === AUTH_PASSWORD.length;
}

export function signToken(): string {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now(), v: 1 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): boolean {
  try {
    const last = token.lastIndexOf('.');
    if (last < 1) return false;
    const payload = token.slice(0, last);
    const sig = token.slice(last + 1);
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
    if (sig.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof data.iat === 'number' && Date.now() - data.iat < TOKEN_TTL_MS;
  } catch {
    return false;
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) { next(); return; }
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: 'Não autenticado.' });
    return;
  }
  next();
}
