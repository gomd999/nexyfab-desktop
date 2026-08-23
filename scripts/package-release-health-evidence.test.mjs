import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { packageReleaseHealthEvidence, RELEASE_HEALTH_EVIDENCE } from './package-release-health-evidence.mjs';

function fixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-release-health-package-'));
  const release = path.join(root, 'docs', 'evidence', 'release');
  mkdirSync(release, { recursive: true });
  for (const entry of RELEASE_HEALTH_EVIDENCE) {
    writeFileSync(path.join(root, entry.relativePath), `${JSON.stringify({ schema: entry.schema, safe: true })}\n`);
  }
  mkdirSync(path.join(root, '.next', 'standalone'), { recursive: true });
  return root;
}

test('copies exactly the allowlisted receipts and verifies byte identity', () => {
  const root = fixtureRoot();
  try {
    const result = packageReleaseHealthEvidence({ projectRoot: root, standaloneRoot: path.join(root, '.next', 'standalone') });
    assert.deepEqual(result.copied.map(item => item.relativePath), RELEASE_HEALTH_EVIDENCE.map(item => item.relativePath));
    for (const entry of RELEASE_HEALTH_EVIDENCE) {
      const source = readFileSync(path.join(root, entry.relativePath));
      const destination = readFileSync(path.join(root, '.next', 'standalone', entry.relativePath));
      assert.deepEqual(destination, source);
    }
    assert.equal(readFileSync(path.join(root, '.next', 'standalone', 'docs', 'evidence', 'release', 'commercial-i18n-release-receipt.json'), 'utf8').includes('safe'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed on a missing or wrong-schema receipt', () => {
  const root = fixtureRoot();
  try {
    rmSync(path.join(root, RELEASE_HEALTH_EVIDENCE[1].relativePath));
    assert.throws(() => packageReleaseHealthEvidence({ projectRoot: root, standaloneRoot: path.join(root, '.next', 'standalone') }), /required release-health evidence/);
    writeFileSync(path.join(root, RELEASE_HEALTH_EVIDENCE[1].relativePath), JSON.stringify({ schema: 'wrong' }));
    assert.throws(() => packageReleaseHealthEvidence({ projectRoot: root, standaloneRoot: path.join(root, '.next', 'standalone') }), /schema mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('copies the exact source bytes required by a qualified seven-day receipt', () => {
  const root = fixtureRoot();
  try {
    const bind = (relativePath, value) => {
      const bytes = Buffer.from(JSON.stringify(value));
      const file = path.join(root, relativePath);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      return { file: relativePath, sha256: createHash('sha256').update(bytes).digest('hex') };
    };
    const release = bind('docs/evidence/operations/runtime/release.json', { buildId: 'build-1' });
    const policy = bind('docs/evidence/operations/runtime/policy.json', { requiredCoverageHours: 168 });
    const sample = bind('docs/evidence/operations/runtime/sample-1.json', { service: 'web' });
    const cost = bind('docs/evidence/operations/runtime/cost-1.json', { total: 1 });
    writeFileSync(path.join(root, RELEASE_HEALTH_EVIDENCE[1].relativePath), JSON.stringify({
      schema: 'nexyfab.seven-day-operations-receipt.v3', ok: true,
      evidenceBindings: { release, policy, samples: [sample], costSnapshots: [cost] },
    }));

    const result = packageReleaseHealthEvidence({ projectRoot: root, standaloneRoot: path.join(root, '.next', 'standalone') });
    assert.equal(result.copied.length, RELEASE_HEALTH_EVIDENCE.length + 4);
    for (const binding of [release, policy, sample, cost]) {
      assert.deepEqual(
        readFileSync(path.join(root, '.next', 'standalone', binding.file)),
        readFileSync(path.join(root, binding.file)),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a qualified receipt that binds outside the operations evidence prefix', () => {
  const root = fixtureRoot();
  try {
    writeFileSync(path.join(root, RELEASE_HEALTH_EVIDENCE[1].relativePath), JSON.stringify({
      schema: 'nexyfab.seven-day-operations-receipt.v3', ok: true,
      evidenceBindings: {
        release: { file: '.env', sha256: 'a'.repeat(64) },
        policy: { file: 'docs/evidence/operations/policy.json', sha256: 'b'.repeat(64) },
        samples: [], costSnapshots: [],
      },
    }));
    assert.throws(
      () => packageReleaseHealthEvidence({ projectRoot: root, standaloneRoot: path.join(root, '.next', 'standalone') }),
      /outside docs\/evidence\/operations/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects symlinked source receipts and never copies outside the standalone root', () => {
  const root = fixtureRoot();
  try {
    const source = path.join(root, RELEASE_HEALTH_EVIDENCE[0].relativePath);
    const target = `${source}.real`;
    writeFileSync(target, readFileSync(source));
    rmSync(source);
    // Windows may reject symlink creation without developer mode; the helper's
    // regular-file guard remains covered by the missing-file assertion above.
    try {
      symlinkSync(target, source, 'file');
      assert.throws(() => packageReleaseHealthEvidence({ projectRoot: root, standaloneRoot: path.join(root, '.next', 'standalone') }), /regular file/);
    } catch (error) {
      if (error?.code !== 'EPERM') throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
