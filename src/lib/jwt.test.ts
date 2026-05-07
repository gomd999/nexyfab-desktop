import { describe, it, expect, beforeAll } from 'vitest';
import { signJWT, verifyJWT } from './jwt';

describe('JWT', () => {
  describe('signJWT', () => {
    it('should create a valid JWT string', async () => {
      const token = await signJWT({ sub: 'user-1', email: 'test@example.com', plan: 'free' });
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('should include correct payload', async () => {
      const token = await signJWT({ sub: 'user-1', email: 'test@example.com', plan: 'pro' });
      const payload = await verifyJWT(token);
      expect(payload?.sub).toBe('user-1');
      expect(payload?.email).toBe('test@example.com');
      expect(payload?.plan).toBe('pro');
    });

    it('should respect custom expiry', async () => {
      const token = await signJWT(
        { sub: 'user-1', email: 'test@example.com', plan: 'free' },
        3600,
      );
      const payload = await verifyJWT(token);
      const now = Math.floor(Date.now() / 1000);
      expect(payload?.exp).toBeGreaterThan(now + 3590);
      expect(payload?.exp).toBeLessThan(now + 3610);
    });
  });

  describe('verifyJWT', () => {
    it('should return null for invalid token', async () => {
      const result = await verifyJWT('invalid.token.here');
      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      const token = await signJWT(
        { sub: 'user-1', email: 'test@example.com', plan: 'free' },
        -1, // 이미 만료
      );
      const result = await verifyJWT(token);
      expect(result).toBeNull();
    });

    it('should return null for tampered token', async () => {
      const token = await signJWT({ sub: 'user-1', email: 'test@example.com', plan: 'free' });
      const parts = token.split('.');
      // payload 조작 (plan을 enterprise로)
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      payload.plan = 'enterprise';
      parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tampered = parts.join('.');
      const result = await verifyJWT(tampered);
      expect(result).toBeNull();
    });
  });
});
