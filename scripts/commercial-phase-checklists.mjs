#!/usr/bin/env node
/**
 * Phase A → D 상용 체크리스트를 순서대로 출력 (콘솔만, CI 부담 없음).
 * B·C·D 세 절은 commercial-checklists-bcd.mjs 단일 구현을 재사용해 중복 없음.
 * 근거: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function runPhase(script) {
  console.log('\n');
  const r = spawnSync(process.execPath, [join(root, 'scripts', script)], {
    stdio: 'inherit',
    cwd: root,
  });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

runPhase('phase-a-commercial-checklist.mjs');

const rBcd = spawnSync(process.execPath, [join(root, 'scripts', 'commercial-checklists-bcd.mjs')], {
  stdio: 'inherit',
  cwd: root,
});
if ((rBcd.status ?? 1) !== 0) process.exit(rBcd.status ?? 1);

console.log('\n✓ commercial-phase-checklists: A→D 순서 출력 완료.\n');
