#!/usr/bin/env node
/**
 * M5 시뮬레이션·DFM·CAM 브리지 v0 — 타입체크 + `src/test/m5` Vitest.
 * (FEA `runSimpleFEA`, DFM `analyzeDFM`, CAM `generateCAMToolpaths` + `toGcode` 스모크)
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
  console.log('M5: typecheck… (skipped — verify already ran)\n');
} else {
  console.log('M5: typecheck…');
  run('npm', ['run', 'typecheck']);
}

console.log('M5: vitest (simulation / DFM / CAM bridge smoke)…');
run('npx', ['vitest', 'run', 'src/test/m5']);

console.log('\n✓ M5 bridge smoke passed.');
console.log('  Roadmap: docs/strategy/CAD_FULLSTACK_MILESTONES.md — M5');
console.log('  Detail: docs/strategy/M5_SIMULATION_DFM_CAM.md\n');
