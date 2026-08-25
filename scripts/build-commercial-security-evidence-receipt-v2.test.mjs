import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCommercialSecurityEvidenceReceipt,
  SECURITY_SOURCE_SPECS,
  verifyCommercialSecurityEvidenceReceipt,
} from './build-commercial-security-evidence-receipt-v2.mjs';
import { SECRET_SCAN_EXCLUDED_DERIVED_RECEIPTS, SECRET_SCAN_SCOPE } from './scan-secrets.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const release = { buildId: 'security-build', deploymentId: 'security-deployment', gitHead: 'a'.repeat(40) };

function fixtureDocuments() {
  const generatedAt = new Date().toISOString();
  const route = {
    route: '/api/example', methods: ['GET'], mutation: false, classification: 'public', gaps: [],
    controls: { publicMutationPolicy: null },
    file: 'src/app/api/example/route.ts', sourceSha256: null,
  };
  return {
    routeSecurityMatrix: {
      schema: 'nexyfab.route-security-matrix.v1', generatedAt, status: 'pass',
      summary: {
        routeFiles: 1, exportedHandlers: 1, classifiedRoutes: 1, unknownClassifications: 0,
        routesWithGaps: 0, gapCounts: {},
        byClassification: { public: 1, authenticated: 0, admin: 0, webhook: 0, 'internal-worker': 0, disabled: 0 },
        publicMutationPolicies: 0, policyConfigIssues: [],
      }, routes: [route],
    },
    cadApiControls: {
      schema: 'nexyfab.cad-api-control-evidence.v1', generatedAt, status: 'pass', externalCadRequired: false,
      routeFiles: 1, exportedHandlers: 1, documentedCadOperations: 1,
      publicExceptions: [{ method: 'GET', path: '/api/cad/v1/capabilities' }],
      commercialRuntimeRequirements: ['JWT_SECRET'],
      controls: { authentication: 'required', authorization: 'required', rateLimit: 'required', metering: 'required' },
      checks: {
        allCadRoutesBehindActiveProxy: true, onlyCapabilityGetIsPublic: true, accountQuotaPresent: true,
        distributedQuotaFailClosedInCommercial: true, productionAccessMeteringPresent: true,
        openApiHasNoAnonymousCadOverride: true, everyDocumentedCadOperationUsesBearer: true,
        allCadRequestBodiesUseBoundedReaders: true, allCadMutationRoutesDeclareBoundedIngress: true,
        regressionTestsCoverBoundary: true,
      }, issues: [], sources: [{ file: 'src/proxy.ts', sha256: 'b'.repeat(64) }],
    },
    secretScan: {
      schema: 'nexyfab-secret-scan-v1', generatedAt, status: 'pass', filesScanned: 1, bytesScanned: 10,
      scope: SECRET_SCAN_SCOPE,
      excludedDerivedReceipts: [...SECRET_SCAN_EXCLUDED_DERIVED_RECEIPTS],
      findingCount: 0, findings: [],
    },
    dependencyAudit: {
      schema: 'nexyfab-dependency-audit-v1', generatedAt, status: 'pass', command: 'npm audit --audit-level=low --json',
      packageLockSha256: 'c'.repeat(64),
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      dependencies: { prod: 1, dev: 1, optional: 0, peer: 0, peerOptional: 0, total: 2 },
    },
  };
}

function fixtureRoot(documents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-security-v2-'));
  const write = (relative, value) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    return hash(Buffer.from(value));
  };
  documents.routeSecurityMatrix.routes[0].sourceSha256 = write('src/app/api/example/route.ts', 'export function GET() {}\n');
  documents.cadApiControls.sources[0].sha256 = write('src/proxy.ts', 'export const proxy = true;\n');
  documents.dependencyAudit.packageLockSha256 = write('package-lock.json', '{"lockfileVersion":3}\n');
  for (const [id, relative] of Object.entries(SECURITY_SOURCE_SPECS)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(documents[id], null, 2)}\n`);
  }
  return root;
}

test('builds and verifies a fresh immutable receipt from all local source bindings', () => {
  const documents = fixtureDocuments();
  const root = fixtureRoot(documents);
  try {
    const generatedAt = new Date().toISOString();
    const receipt = buildCommercialSecurityEvidenceReceipt({ root, release, generatedAt });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'PASS');
    assert.equal(receipt.target, 'production');
    assert.equal(receipt.sourceBindings.length, 5);
    assert.ok(receipt.sourceBindings.every(item => Number.isInteger(item.bytes) && item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256)));
    assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(verifyCommercialSecurityEvidenceReceipt(receipt, {
      root, expectedRelease: { buildId: release.buildId, deploymentId: release.deploymentId, head: release.gitHead },
    }), { ok: true, blockers: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('derives HOLD from raw gaps and vulnerabilities even when aggregate status says pass', () => {
  const documents = fixtureDocuments();
  documents.routeSecurityMatrix.routes[0].gaps = ['MUTATION_RATE_LIMIT_MISSING'];
  documents.routeSecurityMatrix.summary.routesWithGaps = 0;
  documents.dependencyAudit.vulnerabilities.high = 1;
  documents.dependencyAudit.vulnerabilities.total = 1;
  documents.cadApiControls.checks.allCadRequestBodiesUseBoundedReaders = false;
  const root = fixtureRoot(documents);
  try {
    const receipt = buildCommercialSecurityEvidenceReceipt({ root, release, documents });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.status, 'HOLD');
    assert.ok(receipt.blockers.includes('routeSecurityMatrix:route_gaps_present'));
    assert.ok(receipt.blockers.includes('routeSecurityMatrix:route_summary_inconsistent'));
    assert.ok(receipt.blockers.includes('dependencyAudit:vulnerabilities_present'));
    assert.ok(receipt.blockers.includes('cadApiControls:cad_checks_incomplete'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects source replay or tampering during verification', () => {
  const documents = fixtureDocuments();
  const root = fixtureRoot(documents);
  try {
    const receipt = buildCommercialSecurityEvidenceReceipt({ root, release, documents });
    const target = path.join(root, SECURITY_SOURCE_SPECS.secretScan);
    fs.writeFileSync(target, `${JSON.stringify({ ...documents.secretScan, findings: [{ file: 'leak.env' }], findingCount: 1, status: 'fail' }, null, 2)}\n`);
    const result = verifyCommercialSecurityEvidenceReceipt(receipt, { root });
    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes('source_bindings_mismatch'));
    assert.ok(result.blockers.includes('evidence_derivation_mismatch'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed when a secret scan broadens or omits the exact derived receipt exclusions', () => {
  const documents = fixtureDocuments();
  documents.secretScan.excludedDerivedReceipts = ['docs/evidence/release/commercial-security-evidence-receipt.json'];
  const root = fixtureRoot(documents);
  try {
    const receipt = buildCommercialSecurityEvidenceReceipt({ root, release });
    assert.equal(receipt.ok, false);
    assert.ok(receipt.blockers.includes('secretScan:derived_receipt_exclusions_invalid'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
