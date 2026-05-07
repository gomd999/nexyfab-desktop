#!/usr/bin/env node
/**
 * M6 PDM-lite v0 — 타입체크 + `src/test/m6` Vitest (nfab `nexyfabPdm` 메타).
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
  console.log('M6: typecheck… (skipped — verify already ran)\n');
} else {
  console.log('M6: typecheck…');
  run('npm', ['run', 'typecheck']);
}

console.log('M6: vitest (PDM-lite meta)…');
run('npx', ['vitest', 'run', 'src/test/m6']);

console.log('\n✓ M6 PDM-lite checks passed.');
console.log('  Roadmap: docs/strategy/CAD_FULLSTACK_MILESTONES.md — M6');
console.log('  Detail: docs/strategy/M6_PDM_LITE.md\n');
