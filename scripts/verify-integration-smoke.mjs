#!/usr/bin/env node
/**
 * 통합 스모크 — 서로 독립인 게이트를 **병렬** 실행한 뒤 한 번에 성공/실패를 판정한다.
 *
 * 용도: 병렬 개발 중에도 PR·로컬에서 **짧은 주기**로 신호를 받기 (로드맵 Phase A 권장과 정합).
 * - 기본: typecheck + route-security Vitest + STEP OCCT 라운드트립 (동시 실행).
 * - 선택: VERIFY_INTEGRATION_E2E=1 이면 Playwright `commercial-release-smoke` 추가
 *   (CI=true면 webServer가 빌드+standalone 기동 — 느림; 로컬은 E2E_BASE_URL+PW_REUSE_DEV 권장).
 *
 * 사용:
 *   npm run verify:integration-smoke
 *   VERIFY_INTEGRATION_E2E=1 npm run verify:integration-smoke
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} label @param {string} command */
function runShell(label, command) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code, signal) => {
      resolve({ label, code: code ?? (signal ? 1 : 0), signal: signal ?? null });
    });
    child.on('error', (err) => {
      console.error(`[${label}] spawn error:`, err.message);
      resolve({ label, code: 1, signal: null });
    });
  });
}

async function main() {
  const tasks = [
    { label: 'typecheck', cmd: 'npm run typecheck' },
    {
      label: 'route-security',
      cmd: 'npx vitest run src/app/api/__tests__/route-security.test.ts',
    },
    { label: 'step-roundtrip', cmd: 'npm run test:step-roundtrip' },
  ];

  const wantE2e =
    process.env.VERIFY_INTEGRATION_E2E === '1' ||
    process.env.VERIFY_INTEGRATION_E2E === 'true';

  if (wantE2e) {
    const ci = process.env.CI === 'true' || process.env.CI === '1';
    const extra = ci
      ? 'CI=true npx playwright test e2e/commercial-release-smoke.spec.ts --project=chromium'
      : 'npx playwright test e2e/commercial-release-smoke.spec.ts --project=chromium';
    tasks.push({ label: 'playwright-commercial-smoke', cmd: extra });
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log(` verify-integration-smoke: ${tasks.length} tasks in parallel`);
  console.log('══════════════════════════════════════════════════════════════\n');
  for (const t of tasks) {
    console.log(`  → ${t.label}`);
  }
  if (!wantE2e) {
    console.log(
      '\n  (E2E 스킵: 재생하려면 VERIFY_INTEGRATION_E2E=1 — CI에서는 느리고, 로컬은 E2E_BASE_URL+PW_REUSE_DEV 권장)\n',
    );
  } else {
    console.log('');
  }

  const started = Date.now();
  const results = await Promise.all(tasks.map((t) => runShell(t.label, t.cmd)));
  const ms = Date.now() - started;

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(` verify-integration-smoke: done in ${(ms / 1000).toFixed(1)}s`);
  console.log('──────────────────────────────────────────────────────────────');
  let failed = false;
  for (const r of results) {
    const ok = r.code === 0;
    if (!ok) failed = true;
    console.log(`  ${ok ? '✓' : '✗'} ${r.label} (exit ${r.code}${r.signal ? ` signal ${r.signal}` : ''})`);
  }
  console.log('');

  if (failed) {
    console.error('verify-integration-smoke: one or more tasks failed.\n');
    process.exit(1);
  }
  console.log('verify-integration-smoke: all tasks passed.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
