#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export function evaluateRollbackResponses(responses, expectedBuild) {
  const issues = [];
  if (responses.live?.status !== 'ok') issues.push('health/live status is not ok');
  if (!responses.live?.build || responses.live.build === 'unknown') issues.push('health/live build is unknown');
  if (expectedBuild && responses.live?.build !== expectedBuild) {
    issues.push(`build mismatch: expected ${expectedBuild}, received ${responses.live?.build ?? 'missing'}`);
  }
  if (responses.ready?.status !== 'ok' || responses.ready?.db?.status !== 'ok') {
    issues.push('health/ready database is not ready');
  }
  if (responses.occt?.ok !== true || responses.occt?.mode !== 'wasm') {
    issues.push('OCCT diagnostic is not real wasm');
  }
  if (!responses.occt?.wasm?.sha256 || responses.occt.wasm.sha256.length !== 64) {
    issues.push('OCCT wasm sha256 is missing or invalid');
  }
  return issues;
}

async function readJson(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl), {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const baseUrl = process.env.ROLLBACK_BASE_URL || process.argv[2];
  const expectedBuild = process.env.EXPECTED_BUILD_ID;
  if (!baseUrl) throw new Error('Set ROLLBACK_BASE_URL or pass the target URL as the first argument');
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Rollback target must use HTTP(S)');

  const [live, ready, occt] = await Promise.all([
    readJson(parsed, '/api/health/live'),
    readJson(parsed, '/api/health/ready'),
    readJson(parsed, '/api/occt/diagnostic'),
  ]);
  const issues = evaluateRollbackResponses({ live, ready, occt }, expectedBuild);
  if (issues.length) {
    process.stderr.write('[rollback-verify] FAILED\n');
    for (const issue of issues) process.stderr.write(`- ${issue}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, build: live.build, db: ready.db, occt: {
    mode: occt.mode, wasmBytes: occt.wasm.sizeBytes, wasmSha256: occt.wasm.sha256,
  } })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`[rollback-verify] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
