#!/usr/bin/env node
/**
 * M1 교환: 타입체크 + STEP export / import 오류 매핑·분류 회귀 (기본은 WASM STEP 파싱 제외).
 * - 항상: M0 골든, M1 exchange, `classifyCadImportError` 단위 테스트.
 * - 선택: `RUN_STEP_IMPORT=1` 이면 OCCT STEP 라운드트립(`stepRoundtrip.guarded.test.ts`)까지 실행.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    env: Object.keys(env).length ? { ...process.env, ...env } : process.env,
  });
  const code = r.status ?? 1;
  if (code !== 0) process.exit(code);
}

const skipTc =
  process.env.MILESTONE_SKIP_TYPECHECK === '1' || process.env.MILESTONE_SKIP_TYPECHECK === 'true';
if (skipTc) {
  console.log('M1: typecheck… (skipped — verify already ran)\n');
} else {
  console.log('M1: typecheck…');
  run('npm', ['run', 'typecheck']);
}

console.log('M1: vitest (M0 golden + M1 exchange + import error classify)…');
run('npx', [
  'vitest', 'run',
  'src/test/m0/nfabGolden.test.ts',
  'src/test/m1/exchange.test.ts',
  'src/test/m1/cadImportClassify.test.ts',
]);

const wantStepImport = process.env.RUN_STEP_IMPORT === '1' || process.env.RUN_STEP_IMPORT === 'true';
if (wantStepImport) {
  console.log('\nM1: vitest STEP round-trip (RUN_STEP_IMPORT=1, OCCT WASM)…');
  run('npx', ['vitest', 'run', 'src/test/m1/stepRoundtrip.guarded.test.ts']);
} else {
  console.log('\nM1: skip STEP mesh round-trip (set RUN_STEP_IMPORT=1 to enable).');
}

console.log('\n✓ M1 automated checks passed (includes M0 baseline).');
console.log('  Docs: docs/strategy/M1_EXCHANGE.md');
console.log('  Manual: docs/strategy/M1_RELEASE_CHECKLIST.md');
console.log('  Optional: npm run test:step-roundtrip — full STEP import after export\n');
