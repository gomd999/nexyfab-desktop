#!/usr/bin/env node
/**
 * M7 대형 어셈블리 — 타입체크 + 스케일/뷰포트 정책 회귀(Vitest).
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
  console.log('M7: typecheck… (skipped — verify already ran)\n');
} else {
  console.log('M7: typecheck…');
  run('npm', ['run', 'typecheck']);
}

console.log('M7: vitest (assembly scale policy)…');
run('npx', ['vitest', 'run', 'src/test/m7']);

console.log('\n✓ M7 assembly-scale checks passed.');
console.log('  Roadmap: docs/strategy/CAD_FULLSTACK_MILESTONES.md — M7\n');
