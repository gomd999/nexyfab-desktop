#!/usr/bin/env node
/**
 * Phase B → C → D 체크리스트만 순서대로 출력 (Phase A 제외).
 * 근거: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase B–D
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function runPhase(script) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', script)], {
    stdio: 'inherit',
    cwd: root,
  });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

console.log('\n═══ 상용 로드맵 Phase B → C → D (수동·반자동 맵) ═══');
console.log('    (commercial-phase-checklists / commercial:sequential 에서도 동일 출력)\n');
runPhase('phase-b-commercial-checklist.mjs');
runPhase('phase-c-commercial-checklist.mjs');
runPhase('phase-d-commercial-checklist.mjs');
console.log('\n✓ commercial-checklists-bcd: B→C→D 출력 완료.\n');
