import { vi } from 'vitest';

// 환경변수 설정
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
// NODE_ENV is read-only in TS strict mode; vitest sets it to 'test' automatically

// crypto.randomUUID polyfill (Node.js 환경)
if (!globalThis.crypto?.randomUUID) {
  const { randomUUID } = await import('crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID, subtle: globalThis.crypto?.subtle },
  });
}
