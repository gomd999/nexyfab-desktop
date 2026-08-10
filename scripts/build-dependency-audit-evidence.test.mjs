import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDependencyAuditReport } from './build-dependency-audit-evidence.mjs';

const lockBytes = Buffer.from('{"lockfileVersion":3}');

test('dependency audit evidence requires a complete npm audit report', () => {
  assert.throws(
    () => buildDependencyAuditReport({ error: { code: 'ENETUNREACH' } }, lockBytes),
    /DEPENDENCY_AUDIT_INCOMPLETE:ENETUNREACH/,
  );
  assert.throws(
    () => buildDependencyAuditReport({ metadata: { vulnerabilities: {} }, vulnerabilities: {} }, lockBytes),
    /DEPENDENCY_AUDIT_INCOMPLETE/,
  );
});

test('dependency audit evidence binds complete zero-finding metadata to the lockfile', () => {
  const report = buildDependencyAuditReport({
    vulnerabilities: {},
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      dependencies: { prod: 10, dev: 2, optional: 0, peer: 0, peerOptional: 0, total: 12 },
    },
  }, lockBytes, '2026-08-11T00:00:00.000Z');
  assert.equal(report.status, 'pass');
  assert.equal(report.vulnerabilities.total, 0);
  assert.equal(report.dependencies.total, 12);
  assert.match(report.packageLockSha256, /^[a-f0-9]{64}$/);
});
