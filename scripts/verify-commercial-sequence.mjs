#!/usr/bin/env node
/**
 * 경량 순차 게이트: verify-milestones + STEP 단독 (integration-smoke·전체 Vitest 없음).
 * CI 동등·병렬 스모크 포함 상용 Phase A는 `npm run commercial:gate-a` 권장.
 *
 *  1) `verify-milestones` — typecheck + M0–M7 + security:smoke (+옵션 Tauri/E2E는 부모 env 따름)
 *  2) `npm run test:step-roundtrip` — OCCT WASM + 샘플 STEP import (RUN_STEP_IMPORT 내장)
 *
 * E2E만 추가로: `cross-env VERIFY_E2E=1 CI=true node scripts/verify-commercial-sequence.mjs`
 * Tauri까지: `VERIFY_TAURI=1` 을 함께 설정.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, envExtra = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    env: Object.keys(envExtra).length ? { ...process.env, ...envExtra } : process.env,
  });
  const code = r.status ?? 1;
  if (code !== 0) process.exit(code);
}

console.log('═══ verify-commercial-sequence [1/2] milestone + security ═══\n');
run('node', ['scripts/verify-milestones.mjs']);

console.log('\n═══ verify-commercial-sequence [2/2] STEP OCCT import (sample .stp) ═══\n');
run('npm', ['run', 'test:step-roundtrip']);

console.log('\n✓ verify-commercial-sequence: 완료 (milestones + STEP OCCT smoke).');
console.log('  다음: npm run commercial:checklists  (Phase A→D 수동 맵)\n');
