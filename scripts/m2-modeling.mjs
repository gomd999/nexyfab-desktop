#!/usr/bin/env node
/**
 * M2 모델링 신뢰: 타입체크 + M0·M1·M2 Vitest 회귀.
 * - `VERIFY_AFTER_M0_M1=1`: M0/M1과 겹치는 Vitest 파일(nfabGolden, exchange, cadImportClassify) 생략 — `verify-milestones` 전용.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: root });
  const code = r.status ?? 1;
  if (code !== 0) process.exit(code);
}

const skipTc =
  process.env.MILESTONE_SKIP_TYPECHECK === '1' || process.env.MILESTONE_SKIP_TYPECHECK === 'true';
if (skipTc) {
  console.log('M2: typecheck… (skipped — verify already ran)\n');
} else {
  console.log('M2: typecheck…');
  run('npm', ['run', 'typecheck']);
}

const afterM0M1 =
  process.env.VERIFY_AFTER_M0_M1 === '1' || process.env.VERIFY_AFTER_M0_M1 === 'true';
const m0m1Files = [
  'src/test/m0/nfabGolden.test.ts',
  'src/test/m1/exchange.test.ts',
  'src/test/m1/cadImportClassify.test.ts',
];
const m2CoreFiles = [
  'src/test/m4/drawingRevisionPolicy.test.ts',
  'src/test/m2/pipelineDiagnostics.test.ts',
  'src/test/m2/pipelineScenarios.test.ts',
  'src/lib/__tests__/featurePipelineTelemetry.test.ts',
  'src/app/[lang]/shape-generator/__tests__/pipeline.test.ts',
];
const vitestFiles = afterM0M1 ? m2CoreFiles : [...m0m1Files, ...m2CoreFiles];

console.log(
  afterM0M1
    ? 'M2: vitest (M2 + pipeline regression; M0/M1 files skipped — verify ran m0+m1)…'
    : 'M2: vitest (M0 + M1 + M2 + pipeline regression)…',
);
run('npx', ['vitest', 'run', ...vitestFiles]);

console.log(
  `\n✓ M2 automated checks passed (${afterM0M1 ? 'M2 core only — M0/M1 ran earlier in verify' : 'includes M0 + M1 baseline tests'}).`,
);
console.log('  Docs: docs/strategy/M2_MODELING.md (v1 complete definition §5, ops §7)');
console.log('  Release gate: docs/strategy/M2_RELEASE_CHECKLIST.md\n');
