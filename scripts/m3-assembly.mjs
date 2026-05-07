#!/usr/bin/env node
/**
 * M3 어셈블리: 타입체크 + src/test/m3 (+ tests/golden/m3-assembly-minimal.nfab.json).
 * 전체 M2 회귀는 `npm run m2` — M3는 어셈블리 전용으로 점진 확장.
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
  console.log('M3: typecheck… (skipped — verify already ran)\n');
} else {
  console.log('M3: typecheck…');
  run('npm', ['run', 'typecheck']);
}

console.log('M3: vitest assembly tests (snapshots, solvers, interference, BOM, JSON round-trip)…');
run('npx', ['vitest', 'run', 'src/test/m3']);

console.log('\n✓ M3 assembly checks passed.');
console.log('  Roadmap: docs/strategy/M3_ASSEMBLY.md\n');
