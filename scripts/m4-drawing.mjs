#!/usr/bin/env node
/**
 * M4 도면/MBD v0 — 타입체크 + `generateDrawing` + PDF/DXF export 스모크(Vitest).
 * 전체 M3는 `npm run m3`; M4는 2D 도출 파이프만 점진 확장.
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
  console.log('M4: typecheck… (skipped — verify already ran)\n');
} else {
  console.log('M4: typecheck…');
  run('npm', ['run', 'typecheck']);
}

console.log('M4: vitest (auto drawing smoke)…');
run('npx', ['vitest', 'run', 'src/test/m4']);

console.log('\n✓ M4 drawing smoke passed.');
console.log('  Roadmap: docs/strategy/CAD_FULLSTACK_MILESTONES.md — M4');
console.log('  Detail: docs/strategy/M4_DRAWING.md\n');
