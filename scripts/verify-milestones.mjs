#!/usr/bin/env node
/**
 * M0–M7 + 보안 스모크 자동 게이트 일괄 실행.
 * - 기본: `typecheck` 1회 → `m0` → `m1` → `m2`…`m7` → `security:smoke`
 *   (`m0`–`m7` 내부 타입체크는 MILESTONE_SKIP_TYPECHECK로 생략; `m2`는 VERIFY_AFTER_M0_M1로 M0/M1 Vitest 중복 생략).
 * - `m3`에 간섭 파이프·broad-phase·cooperative 폴백 Vitest(`interferenceBroadPhase` 등) 포함.
 * - M7 이후: `security:smoke` — `NODE_ENV=production` + `ALLOW_DEMO_AUTH=true` 조합 차단.
 * - VERIFY_TAURI=1: `cargo test` in `src-tauri`(Rust 설치 필요). 기본 게이트에서는 생략.
 * - VERIFY_E2E=1: Playwright 스모크(chromium). M6 팀 ACL 전체 플로우는 `E2E_M6_*` 환경변수 없으면 해당 스펙만 스킵.
 * - STEP OCCT 라운드트립: `npm run test:step-roundtrip` (별도; WASM). `VERIFY_STEP_ROUNDTRIP=1`이면 M1 직후 본 스크립트에서 실행(Phase A2).
 * - 상용 Phase A/B 수동 맵: `npm run phase-a:checklist` / `npm run phase-b:checklist` → CAD_COMMERCIAL_COMPLETION_ROADMAP.md
 *
 * 수동 체크리스트(A절)는 대체하지 않음 — 저장 대화상자·클라우드 등은 문서 유지.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {Record<string, string>} [envExtra] */
function run(cmd, args, envExtra = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    env: Object.keys(envExtra).length ? { ...process.env, ...envExtra } : process.env,
  });
  const code = r.status ?? 1;
  if (code !== 0) process.exit(code);
}

const skipTc = { MILESTONE_SKIP_TYPECHECK: '1' };
const skipTcAndM0M1 = { ...skipTc, VERIFY_AFTER_M0_M1: '1' };

console.log('══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: TypeScript (once for M0–M7 + security)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'typecheck']);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: M0 (baseline + snapshot guards)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'm0'], skipTc);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: M1 (exchange + import classify)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'm1'], skipTc);

const wantStepRoundtrip =
  process.env.VERIFY_STEP_ROUNDTRIP === '1' || process.env.VERIFY_STEP_ROUNDTRIP === 'true';
if (wantStepRoundtrip) {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' verify-milestones: STEP OCCT round-trip (VERIFY_STEP_ROUNDTRIP — Phase A2)');
  console.log('══════════════════════════════════════════════════════════════\n');
  run('npm', ['run', 'test:step-roundtrip'], skipTc);
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: M2 (모델링 파이프 — M0/M1 Vitest는 위에서 이미 실행)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'm2'], skipTcAndM0M1);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: M3 (어셈블리)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'm3'], skipTc);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: M4 (2D 도면 스모크)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'm4'], skipTc);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: M5 (시뮬·DFM·CAM 브리지 스모크)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'm5'], skipTc);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: M6 (PDM-lite 메타)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'm6'], skipTc);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: M7 (대형 어셈블리 정책)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'm7'], skipTc);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' verify-milestones: security smoke (M7 enterprise gate)');
console.log('══════════════════════════════════════════════════════════════\n');
run('npm', ['run', 'security:smoke'], skipTc);

const wantTauri = process.env.VERIFY_TAURI === '1' || process.env.VERIFY_TAURI === 'true';
if (wantTauri) {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' verify-milestones: Tauri crate unit tests (desktop I/O parity)');
  console.log('══════════════════════════════════════════════════════════════\n');
  run('npm', ['run', 'test:tauri-unit'], skipTc);
}

const wantE2e = process.env.VERIFY_E2E === '1' || process.env.VERIFY_E2E === 'true';
if (wantE2e) {
  const canE2e = !!process.env.E2E_BASE_URL || !!process.env.CI;
  if (!canE2e) {
    console.warn(
      '\n⚠ VERIFY_E2E 스킵: E2E_BASE_URL(예: http://127.0.0.1:3334) 또는 CI=true 가 없습니다.',
    );
    console.warn('   프로덕션 서버 예: npm run test:e2e:m3:serve → 다른 터미널에서 E2E_BASE_URL=... npm run verify:e2e\n');
  } else {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' verify-milestones: Playwright (commercial + shape-generator + M3 + M4 + M6 API + M6 team env)');
    console.log('══════════════════════════════════════════════════════════════\n');
    run('npx', [
      'playwright',
      'test',
      'e2e/commercial-release-smoke.spec.ts',
      'e2e/shape-generator.spec.ts',
      'e2e/m3-assembly-load.spec.ts',
      'e2e/m4-auto-drawing.spec.ts',
      'e2e/m6-project-members-api.spec.ts',
      'e2e/m6-team-members.spec.ts',
      '--project=chromium',
    ]);
  }
}

console.log('\n✓ verify-milestones: 자동 게이트 완료.');
console.log('  병렬 스모크(짧은 주기): npm run verify:integration-smoke  (주간: .github/workflows/integration-smoke.yml)');
console.log('  CI build 재현(로컬): npm run ci:replicate-build  (.github/workflows/ci.yml build 잡 env와 동일)');
console.log('  수동 항목: docs/strategy/M0_RELEASE_CHECKLIST.md, M1/M2/M3_*_RELEASE_CHECKLIST.md (M4 도면·M5 FEA/CAM 실측·M6 팀/ACL은 별도 수동)');
console.log('  상용 체크리스트: npm run commercial:checklists  (Phase A→D 순서 출력)');
console.log('  상용 순차( A 자동 게이트 → A→D 목록 ): npm run commercial:sequential');
console.log('  상용 A→D( verify에 STEP 포함 → B·C·D 맵만 추가 ): npm run commercial:through-d');
console.log('    또는 개별: phase-a:checklist · phase-b:checklist · phase-c:checklist · phase-d:checklist');
console.log('  문서: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md');
console.log('  마일스톤 + STEP OCCT 연속: npm run verify:seq\n');
