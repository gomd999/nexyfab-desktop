#!/usr/bin/env node
/**
 * 상용 로드맵 A → D 순서 (한 번에):
 *   1) Phase A 자동 게이트 — scripts/commercial-gate-phase-a.mjs
 *   2) Phase A~D 체크리스트 출력 — commercial-phase-checklists.mjs (수동 항목 안내)
 *
 * 용도: "A부터 D까지 순차적으로" 진행할 때 **먼저 A 자동 게이트를 통과**시키고,
 *       같은 터미널에서 B·C·D 할 일 목록을 순서대로 본다.
 *
 * 환경변수는 commercial-gate-phase-a.mjs 와 동일 (SKIP_INTEGRATION_SMOKE, SKIP_FULL_VITEST).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function runNode(script) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', script)], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
  });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  NexyFab 상용 로드맵 — Phase A(자동) → 체크리스트 A→D 출력 ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('── Step 1/2: Phase A 자동 게이트 (출하 신뢰) ──\n');
runNode('commercial-gate-phase-a.mjs');

console.log('\n── Step 2/2: Phase A → D 체크리스트 (수동·반자동 맵) ──\n');
runNode('commercial-phase-checklists.mjs');

console.log('✓ commercial-sequential: A 자동 게이트 통과 후 A→D 체크리스트 출력까지 완료.');
console.log('  Phase B 이후 자동 회귀 예: npm run m3 · npm run test:e2e:m3 (서버 필요 시 test:e2e:m3:serve)');
console.log('  Phase C/D: 각 npm run phase-c:checklist · phase-d:checklist\n');
