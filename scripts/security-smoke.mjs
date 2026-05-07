#!/usr/bin/env node
/**
 * M7 — 보안 스모크: 프로덕션에서 데모 인증이 켜져 있으면 경고 후 비0 종료.
 * CI에서 `NODE_ENV=production`으로 빌드 검증 시 사용.
 */
const allow = process.env.ALLOW_DEMO_AUTH === 'true';
const nodeEnv = process.env.NODE_ENV || '';

if (nodeEnv === 'production' && allow) {
  console.error('[security-smoke] FAIL: ALLOW_DEMO_AUTH=true is unsafe with NODE_ENV=production.');
  process.exit(1);
}

console.log('[security-smoke] OK (no production+demo-auth combo detected).');
process.exit(0);
