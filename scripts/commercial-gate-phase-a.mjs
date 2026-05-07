#!/usr/bin/env node
/**
 * 상용 로드맵 Phase A — 자동 게이트만 순차 실행 (CI `test` 잡과 동일 선상).
 * 근거: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase A
 *
 * 순서:
 *   1) verify:integration-smoke (typecheck ∥ route-security ∥ STEP 라운드트립)
 *   2) verify (M0–M7 + security:smoke)
 *   3) Vitest 전체 (npm run test)
 *
 * 옵션 환경변수:
 *   SKIP_INTEGRATION_SMOKE=1 — 1·2만 실행 (이미 스모크 통과 시)
 *   SKIP_FULL_VITEST=1 — 3 스킵 (시간 절약; CI와 완전 동일하지 않음)
 *   FORCE_VERIFY_STEP_ROUNDTRIP=1 — 스모크 후에도 verify 내 STEP 재실행 (기본은 생략해 중복 방지)
 *   DEDUPE_STEP_ROUNDTRIP=0 — 스모크가 돌았어도 verify에 VERIFY_STEP_ROUNDTRIP 유지(디버그용)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const gateEnv = {
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET || 'local-commercial-gate-secret-at-least-32-characters',
  NODE_ENV: process.env.NODE_ENV || 'test',
};

function run(npmScript, args = [], env = gateEnv) {
  const r = spawnSync('npm', ['run', npmScript, ...args], {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    env,
  });
  const code = r.status ?? 1;
  if (code !== 0) process.exit(code);
}

console.log('══════════════════════════════════════════════════════════════');
console.log(' commercial-gate-phase-a: Phase A 자동 게이트 (순차)');
console.log('══════════════════════════════════════════════════════════════\n');

const skipSmoke =
  process.env.SKIP_INTEGRATION_SMOKE === '1' || process.env.SKIP_INTEGRATION_SMOKE === 'true';

if (!skipSmoke) {
  console.log('[1/3] npm run verify:integration-smoke\n');
  run('verify:integration-smoke');
} else {
  console.log('[1/3] SKIP_INTEGRATION_SMOKE — 병렬 스모크 생략\n');
}

const smokeRan = !skipSmoke;
const dedupeStep =
  smokeRan &&
  process.env.FORCE_VERIFY_STEP_ROUNDTRIP !== '1' &&
  process.env.FORCE_VERIFY_STEP_ROUNDTRIP !== 'true' &&
  process.env.DEDUPE_STEP_ROUNDTRIP !== '0' &&
  process.env.DEDUPE_STEP_ROUNDTRIP !== 'false';

let verifyEnv = gateEnv;
console.log('\n[2/3] npm run verify (M0–M7 + security:smoke)\n');
if (dedupeStep && gateEnv.VERIFY_STEP_ROUNDTRIP) {
  verifyEnv = { ...gateEnv };
  delete verifyEnv.VERIFY_STEP_ROUNDTRIP;
  console.log(
    '     VERIFY_STEP_ROUNDTRIP 생략 (integration-smoke에서 이미 test:step-roundtrip). 재실행: FORCE_VERIFY_STEP_ROUNDTRIP=1\n',
  );
}

run('verify', [], verifyEnv);

const skipVitest = process.env.SKIP_FULL_VITEST === '1' || process.env.SKIP_FULL_VITEST === 'true';
if (!skipVitest) {
  console.log('\n[3/3] npm run test (Vitest 전체)\n');
  run('test');
} else {
  console.log('\n[3/3] SKIP_FULL_VITEST — Vitest 전체 생략\n');
}

console.log('\n✓ commercial-gate-phase-a: Phase A 자동 게이트 완료.');
console.log('  수동·체크리스트: npm run phase-a:checklist');
console.log('  다음 페이즈 안내: npm run commercial:sequential (이미 실행했다면 commercial:checklists)\n');
