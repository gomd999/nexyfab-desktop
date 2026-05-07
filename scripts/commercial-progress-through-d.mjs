#!/usr/bin/env node
/**
 * 상용 로드맵 **자동 회귀를 Phase D까지** 한 경로로 실행한 뒤, Phase B·C·D 체크리스트를 출력한다.
 *
 * 1) Phase A CI 동등: `commercial-gate-phase-a.mjs` (integration-smoke → verify → Vitest 전체)
 * 2) STEP(A2): 스모크가 실행되면 **integration-smoke** 안의 `test:step-roundtrip`으로 충족.
 *    부모가 `VERIFY_STEP_ROUNDTRIP=1`을 넘겨도 gate-a는 **중복 방지**를 위해 verify 자식에서 제거(기본).
 *    스모크 생략 시에만 verify가 STEP 실행 — `SKIP_VERIFY_STEP_ROUNDTRIP=1`로 끌 수 있음.
 *    강제 이중 실행: `FORCE_VERIFY_STEP_ROUNDTRIP=1`
 * 3) Phase B·C·D **자동** 부분은 `verify`에 이미 포함: M3(어셈블리)·M4·M5·M6·M7·security:smoke
 * 4) Phase B·C·D **수동** 항목: `commercial-checklists-bcd.mjs`
 *
 * 환경변수: commercial-gate-phase-a.mjs 와 동일 (SKIP_INTEGRATION_SMOKE, SKIP_FULL_VITEST).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const skipRt =
  process.env.SKIP_VERIFY_STEP_ROUNDTRIP === '1' ||
  process.env.SKIP_VERIFY_STEP_ROUNDTRIP === 'true';

const env = {
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET || 'local-commercial-gate-secret-at-least-32-characters',
  NODE_ENV: process.env.NODE_ENV || 'test',
};
if (!skipRt) {
  env.VERIFY_STEP_ROUNDTRIP = '1';
}

function runNode(script) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', script)], {
    stdio: 'inherit',
    cwd: root,
    env,
  });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  NexyFab 상용 로드맵 — 자동 게이트(A2 포함) → 체크 B·C·D   ║');
console.log('╚════════════════════════════════════════════════════════════╝');
if (!skipRt && !process.env.SKIP_INTEGRATION_SMOKE) {
  console.log('  VERIFY_STEP_ROUNDTRIP=1 → verify 전 스모크에서 STEP 처리; verify 내 STEP은 기본 생략(중복 없음)\n');
} else if (skipRt) {
  console.log('  SKIP_VERIFY_STEP_ROUNDTRIP — 부모에서 STEP 플래그 없음\n');
} else {
  console.log('  SKIP_INTEGRATION_SMOKE — verify만으로 STEP(플래그 유지 시)\n');
}

console.log('── [1/2] Phase A 자동 (M0–M7·security + 전체 Vitest; verify에 M3–M7 포함) ──\n');
runNode('commercial-gate-phase-a.mjs');

console.log('\n── [2/2] Phase B·C·D 수동·반자동 맵 (문서·실측·bm-matrix 등) ──\n');
runNode('commercial-checklists-bcd.mjs');

console.log('✓ commercial-progress-through-d: 자동 회귀 완료 후 B→C→D 체크리스트 출력까지 끝.');
console.log('  갭 추적(D4): docs/strategy/BM_MATRIX_CODE_GAP.md');
console.log('  전 페이즈 목록(A 포함): npm run commercial:checklists\n');
