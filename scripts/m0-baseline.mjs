#!/usr/bin/env node
/**
 * M0 기준선: 타입체크 + 골든 nfab 파싱 회귀.
 * 릴리스 전에는 docs/strategy/M0_RELEASE_CHECKLIST.md 수동 항목도 완료.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    ...opts,
  });
  const code = r.status ?? 1;
  if (code !== 0) process.exit(code);
}

const skipTc =
  process.env.MILESTONE_SKIP_TYPECHECK === '1' || process.env.MILESTONE_SKIP_TYPECHECK === 'true';
if (skipTc) {
  console.log('M0 baseline: typecheck… (skipped — verify already ran)\n');
} else {
  console.log('M0 baseline: typecheck…');
  run('npm', ['run', 'typecheck']);
}

console.log('M0 baseline: vitest golden nfab + snapshot guards…');
run('npx', ['vitest', 'run', 'src/test/m0/nfabGolden.test.ts', 'src/test/m0/assemblySnapshotGuards.test.ts']);

console.log('\n✓ M0 automated checks passed.');
console.log('  Next: complete manual checklist in docs/strategy/M0_RELEASE_CHECKLIST.md\n');
