#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const COMMERCIAL_MIGRATIONS = ['2026082202', '2026082203', '2026082204', '2026082205', '2026082206', '2026082207', '2026082208'];
const DEFAULT_RELEASE_ENDPOINT = '/api/health/release';

export function evaluateRollbackResponses(responses, expectedBuild) {
  const issues = [];
  const normalizedExpectedBuild = typeof expectedBuild === 'string' ? expectedBuild.trim() : '';
  if (!normalizedExpectedBuild) issues.push('expected build ID is required for commercial rollback verification');
  if (responses.live?.status !== 'ok') issues.push('health/live status is not ok');
  if (!responses.live?.build || responses.live.build === 'unknown') issues.push('health/live build is unknown');
  if (normalizedExpectedBuild && responses.live?.build !== normalizedExpectedBuild) {
    issues.push(`build mismatch: expected ${normalizedExpectedBuild}, received ${responses.live?.build ?? 'missing'}`);
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
  if (!responses.release) issues.push('commercial release evidence is missing');
  else {
    if (responses.release.migrationVersion !== 2026082208) issues.push('release latest migration is not 2026082208');
    for (const version of COMMERCIAL_MIGRATIONS) {
      if (!/^[a-f0-9]{64}$/.test(responses.release.migrationChecksums?.[version] ?? '')) issues.push(`release migration ${version}/checksum is missing`);
    }
    if (responses.release.registryRoles !== 3 || responses.release.registryFingerprintsUnique !== true) issues.push('release trust registry is incomplete');
    const i18n = responses.release.i18n;
    if (i18n?.status !== 'QUALIFIED'
      || !Number.isInteger(i18n.sourcePairs)
      || i18n.sourcePairs < 2711
      || i18n.translatedPairs !== i18n.sourcePairs) {
      issues.push('release i18n receipt does not qualify the complete translated catalog');
    }
    if (responses.release.sevenDay?.status !== 'QUALIFIED') issues.push('seven-day external operations receipt is missing');
  }
  return issues;
}

export async function readJson(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl), {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response.json();
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function releaseContractValue(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const value = payload.release;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : payload;
}

function migrationContractValue(payload) {
  const value = releaseContractValue(payload);
  const migrationReceipt = value.migrationReceipt ?? payload?.migrationReceipt;
  const migrations = Array.isArray(value.migrations)
    ? value.migrations
    : Array.isArray(migrationReceipt?.migrations)
      ? migrationReceipt.migrations
      : Array.isArray(payload?.migrations) ? payload.migrations : [];
  const migrationChecksums = { ...(value.migrationChecksums ?? {}) };
  for (const migration of migrations) {
    const version = String(migration?.version ?? '');
    const checksum = firstString(migration?.databaseChecksum, migration?.sourceSha256, migration?.checksum);
    if (COMMERCIAL_MIGRATIONS.includes(version) && checksum) migrationChecksums[version] = checksum;
  }
  const latestMigration = Number(value.migrationVersion ?? migrationReceipt?.migrationVersion ?? payload?.migrationVersion);
  const migrationVersion = Number.isInteger(latestMigration)
    ? latestMigration
    : migrations.reduce((latest, migration) => Math.max(latest, Number(migration?.version) || 0), 0);
  return { ...value, migrationVersion, migrationChecksums };
}

function i18nContractValue(payload) {
  const value = releaseContractValue(payload);
  const receipt = value.i18n ?? value.i18nReceipt ?? payload?.i18n ?? payload?.i18nReceipt ?? payload;
  const catalog = receipt?.catalog ?? {};
  return {
    ...(value.i18n ?? {}),
    status: firstString(receipt?.status, receipt?.automatedStatus, catalog?.status, catalog?.qualified === true ? 'QUALIFIED' : '') || undefined,
    sourcePairs: Number(receipt?.sourcePairs ?? catalog?.sourcePairs),
    translatedPairs: Number(receipt?.translatedPairs ?? catalog?.translatedPairs),
  };
}

function sevenDayContractValue(payload) {
  const value = releaseContractValue(payload);
  const receipt = value.sevenDay ?? value.sevenDayReceipt ?? payload?.sevenDay ?? payload?.sevenDayReceipt ?? payload;
  return {
    ...(value.sevenDay ?? {}),
    status: firstString(receipt?.status, receipt?.ok === true ? 'QUALIFIED' : '') || undefined,
  };
}

function normalizeReleaseResponse(releaseResponse, receiptResponse) {
  const release = migrationContractValue(releaseResponse);
  const receipt = receiptResponse ? migrationContractValue(receiptResponse) : {};
  const i18nSource = releaseResponse?.i18n || receiptResponse?.i18n ? releaseResponse : receiptResponse;
  const sevenDaySource = releaseResponse?.sevenDay || receiptResponse?.sevenDay ? releaseResponse : receiptResponse;
  return {
    ...release,
    ...(receiptResponse ? receipt : {}),
    migrationVersion: Math.max(Number(release.migrationVersion) || 0, Number(receipt.migrationVersion) || 0),
    migrationChecksums: { ...(release.migrationChecksums ?? {}), ...(receipt.migrationChecksums ?? {}) },
    i18n: i18nContractValue(i18nSource ?? releaseResponse),
    sevenDay: sevenDayContractValue(sevenDaySource ?? releaseResponse),
  };
}

function receiptFromReleaseResponse(releaseResponse) {
  if (!releaseResponse || typeof releaseResponse !== 'object') return null;
  return releaseResponse.receipt
    ?? releaseResponse.releaseReceipt
    ?? releaseResponse.receiptBinding
    ?? releaseResponse.binding
    ?? releaseResponse.receipts?.release
    ?? releaseResponse.receipts?.rollback
    ?? releaseContractValue(releaseResponse).receiptBinding
    ?? releaseContractValue(releaseResponse).binding
    ?? null;
}

function receiptEndpointFromReleaseResponse(releaseResponse) {
  const release = releaseContractValue(releaseResponse);
  return firstString(
    process.env.ROLLBACK_RECEIPT_ENDPOINT,
    process.env.ROLLBACK_RECEIPT_URL,
    process.env.ROLLBACK_RELEASE_RECEIPT_ENDPOINT,
    process.env.RELEASE_RECEIPT_ENDPOINT,
    releaseResponse?.receiptEndpoint,
    releaseResponse?.receiptUrl,
    release?.receiptEndpoint,
    release?.receiptUrl,
    release?.receiptBinding?.releaseEndpoint,
    release?.binding?.releaseEndpoint,
  );
}

function verifyReceiptBinding(releaseResponse, receiptResponse, live, expectedBuild, baseUrl, releaseEndpoint) {
  const issues = [];
  const receipt = receiptResponse && typeof receiptResponse === 'object'
    ? (receiptResponse.receipt ?? receiptResponse)
    : null;
  if (!receipt) {
    issues.push('commercial release receipt is missing');
    return issues;
  }
  const release = releaseContractValue(releaseResponse);
  const receiptRelease = releaseContractValue(receipt);
  const receiptBuild = firstString(
    receipt?.buildId,
    receipt?.build,
    receiptRelease?.buildId,
    receiptRelease?.build,
    release?.buildId,
    release?.build,
  );
  const targetBuild = firstString(expectedBuild, live?.build);
  if (!receiptBuild) issues.push('commercial release receipt build binding is missing');
  else if (!targetBuild || receiptBuild !== targetBuild) issues.push(`commercial release receipt build mismatch: expected ${targetBuild || 'missing'}, received ${receiptBuild}`);
  const boundEndpoint = firstString(receipt?.releaseEndpoint, receipt?.endpoint, receiptRelease?.releaseEndpoint);
  if (boundEndpoint && !boundEndpoint.startsWith('/api/') && !/^https?:\/\//.test(boundEndpoint)) {
    issues.push('commercial release receipt endpoint binding is invalid');
  } else if (boundEndpoint && baseUrl && releaseEndpoint) {
    try {
      if (new URL(boundEndpoint, baseUrl).href !== new URL(releaseEndpoint, baseUrl).href) issues.push('commercial release receipt endpoint binding mismatch');
    } catch {
      issues.push('commercial release receipt endpoint binding is invalid');
    }
  }
  return issues;
}

export async function collectRollbackResponses(baseUrl, expectedBuild) {
  const [live, ready, occt] = await Promise.all([
    readJson(baseUrl, '/api/health/live'),
    readJson(baseUrl, '/api/health/ready'),
    readJson(baseUrl, '/api/occt/diagnostic'),
  ]);
  const releaseEndpoint = process.env.ROLLBACK_RELEASE_ENDPOINT
    || process.env.ROLLBACK_RELEASE_URL
    || process.env.RELEASE_EVIDENCE_URL
    || process.env.RELEASE_ENDPOINT
    || DEFAULT_RELEASE_ENDPOINT;
  const releaseResponse = await readJson(baseUrl, releaseEndpoint);
  let receiptResponse = receiptFromReleaseResponse(releaseResponse);
  const receiptEndpoint = receiptEndpointFromReleaseResponse(releaseResponse);
  if (!receiptResponse && receiptEndpoint) receiptResponse = await readJson(baseUrl, receiptEndpoint);
  const release = normalizeReleaseResponse(releaseResponse, receiptResponse);
  const bindingIssues = verifyReceiptBinding(releaseResponse, receiptResponse, live, expectedBuild, baseUrl, releaseEndpoint);
  return { live, ready, occt, release, releaseBindingIssues: bindingIssues };
}

async function main() {
  const baseUrl = process.env.ROLLBACK_BASE_URL || process.argv[2];
  const expectedBuild = process.env.EXPECTED_BUILD_ID;
  if (!baseUrl) throw new Error('Set ROLLBACK_BASE_URL or pass the target URL as the first argument');
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Rollback target must use HTTP(S)');

  const responses = await collectRollbackResponses(parsed, expectedBuild);
  const issues = [...responses.releaseBindingIssues, ...evaluateRollbackResponses(responses, expectedBuild)];
  if (issues.length) {
    process.stderr.write('[rollback-verify] FAILED\n');
    for (const issue of issues) process.stderr.write(`- ${issue}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, build: responses.live.build, db: responses.ready.db, occt: {
    mode: responses.occt.mode, wasmBytes: responses.occt.wasm.sizeBytes, wasmSha256: responses.occt.wasm.sha256,
  } })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`[rollback-verify] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
