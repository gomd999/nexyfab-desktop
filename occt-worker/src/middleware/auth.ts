/**
 * Auth middleware — verifies the JWT from the main app so /occt routes
 * are only callable by authenticated clients.
 *
 * Uses the same JWT_SECRET as the main app — set on the Railway service
 * env. ADR-007 open question "auth on the worker": same JWT, validated
 * here. Worker-only scope tokens deferred until we see abuse signal.
 */

import type { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AuthedRequest extends Request {
  userId?: string;
  email?: string;
}

function base64UrlDecode(input: string): Buffer {
  // Match Node's base64url buffer mode (introduced in 16.x).
  return Buffer.from(input, 'base64url');
}

function verifyHs256(token: string, secret: string): { sub?: string; email?: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  // Verify signature first. timingSafeEqual avoids leaking byte-by-byte
  // match info via response timing.
  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = base64UrlDecode(signatureB64);
  if (expected.length !== provided.length) return null;
  try {
    if (!timingSafeEqual(expected, provided)) return null;
  } catch {
    return null;
  }

  // Parse payload.
  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as {
      sub?: string;
      email?: string;
      exp?: number;
    };
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    console.error('[occt-worker] JWT_SECRET is missing or too short');
    res.status(500).json({ error: 'auth not configured' });
    return;
  }

  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = verifyHs256(token, secret);
  if (!payload || !payload.sub) {
    res.status(401).json({ error: 'invalid token' });
    return;
  }

  (req as AuthedRequest).userId = payload.sub;
  if (payload.email) (req as AuthedRequest).email = payload.email;
  next();
}
