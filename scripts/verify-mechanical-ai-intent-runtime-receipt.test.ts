import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyMechanicalAiIntentRuntimeReceipt } from './verify-mechanical-ai-intent-runtime-receipt';

const root = process.cwd();
const sourceEvidence = path.join(root, 'docs', 'evidence', 'cad-independent', 'local', 'mechanical-ai-intent-runtime-260823');
let fixture = '';

function hash(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function read(relative: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(fixture, relative), 'utf8')) as Record<string, unknown>;
}

function write(relative: string, value: Record<string, unknown>): void {
  fs.writeFileSync(path.join(fixture, relative), `${JSON.stringify(value, null, 2)}\n`);
}

function refreshReceipt(): void {
  const receipt = read('receipt.json');
  const artifacts = receipt.artifactBindings as Array<Record<string, unknown>>;
  for (const [relative, filename] of [['intent-runtime-results.json', 'intent-runtime-results.json'], ['runtime-axis-evidence.json', 'runtime-axis-evidence.json']] as const) {
    const absolute = path.join(fixture, relative);
    const binding = artifacts.find(item => String(item.path).endsWith(filename))!;
    const bytes = fs.readFileSync(absolute);
    binding.path = path.relative(root, absolute).replaceAll('\\', '/');
    binding.sha256 = hash(bytes);
    binding.bytes = bytes.byteLength;
  }
  write('receipt.json', receipt);
  const receiptBytes = fs.readFileSync(path.join(fixture, 'receipt.json'));
  fs.writeFileSync(path.join(fixture, 'receipt.sha256'), `${hash(receiptBytes)}  receipt.json\n`);
}

function refreshCaseArtifact(feature: string, filename: string): void {
  const absolute = path.join(fixture, 'runtime', feature, filename);
  const bytes = fs.readFileSync(absolute);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  const results = read('intent-runtime-results.json');
  const item = (results.cases as Array<Record<string, unknown>>).find(candidate => candidate.feature === feature)!;
  const binding = (item.artifactBindings as Array<Record<string, unknown>>).find(candidate => String(candidate.path).endsWith(`/${feature}/${filename}`))!;
  binding.path = relative;
  binding.sha256 = hash(bytes);
  binding.bytes = bytes.byteLength;
  write('intent-runtime-results.json', results);
  const axisReceipt = read('runtime-axis-evidence.json');
  const runs = axisReceipt.runs as Array<Record<string, unknown>>;
  for (const run of runs.filter(candidate => candidate.feature === feature)) {
    for (const axisBinding of run.evidence as Array<Record<string, unknown>>) {
      if (String(axisBinding.path).endsWith(`/${feature}/${filename}`)) {
        axisBinding.path = relative;
        axisBinding.sha256 = hash(bytes);
        axisBinding.bytes = bytes.byteLength;
      }
    }
  }
  write('runtime-axis-evidence.json', axisReceipt);
  refreshReceipt();
}

beforeEach(() => {
  const parent = path.join(root, 'docs', 'evidence', 'cad-independent', 'local');
  fixture = fs.mkdtempSync(path.join(parent, '.intent-runtime-verify-'));
  fs.cpSync(sourceEvidence, fixture, { recursive: true });
  refreshReceipt();
  const results = read('intent-runtime-results.json');
  for (const item of results.cases as Array<Record<string, unknown>>) {
    const feature = String(item.feature);
    for (const binding of item.artifactBindings as Array<Record<string, unknown>>) {
      const filename = path.basename(String(binding.path));
      binding.path = path.relative(root, path.join(fixture, 'runtime', feature, filename)).replaceAll('\\', '/');
    }
  }
  write('intent-runtime-results.json', results);
  const axisReceipt = read('runtime-axis-evidence.json');
  for (const run of axisReceipt.runs as Array<Record<string, unknown>>) {
    const feature = String(run.feature);
    for (const binding of run.evidence as Array<Record<string, unknown>>) {
      const oldPath = String(binding.path);
      if (!oldPath.includes('/runtime/')) continue;
      binding.path = path.relative(root, path.join(fixture, 'runtime', feature, path.basename(oldPath))).replaceAll('\\', '/');
    }
  }
  write('runtime-axis-evidence.json', axisReceipt);
  refreshReceipt();
});

afterEach(() => {
  if (fixture && fs.existsSync(fixture)) fs.rmSync(fixture, { recursive: true, force: true });
});

describe('mechanical AI intent runtime receipt check-only verifier', () => {
  it('verifies the immutable 10-case and 70-axis bundle without executing geometry', () => {
    expect(verifyMechanicalAiIntentRuntimeReceipt(fixture)).toMatchObject({
      ok: true,
      casesChecked: 10,
      axesChecked: 70,
      issues: [],
      claimBoundary: { aiModelCall: 'NOT_RUN', externalCommercialCampaign: 'NOT_RUN', releaseEligible: false },
    });
  });

  it('rejects tampered, missing, and stale source bindings', () => {
    fs.appendFileSync(path.join(fixture, 'runtime', 'hole', 'create.json'), 'tamper');
    let result = verifyMechanicalAiIntentRuntimeReceipt(fixture);
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.includes('sha256_mismatch'))).toBe(true);

    fs.rmSync(path.join(fixture, 'runtime', 'hole', 'edit.json'));
    result = verifyMechanicalAiIntentRuntimeReceipt(fixture);
    expect(result.issues.some(issue => issue.includes('file_missing') || issue.includes('missing'))).toBe(true);

    const receipt = read('receipt.json');
    (receipt.sourceBindings as Array<Record<string, unknown>>)[0]!.sha256 = '0'.repeat(64);
    write('receipt.json', receipt);
    const receiptBytes = fs.readFileSync(path.join(fixture, 'receipt.json'));
    fs.writeFileSync(path.join(fixture, 'receipt.sha256'), `${hash(receiptBytes)}  receipt.json\n`);
    result = verifyMechanicalAiIntentRuntimeReceipt(fixture);
    expect(result.issues.some(issue => issue.includes('source_revision_stale_or_tampered') || issue.includes('source:'))).toBe(true);
  });

  it('rejects traversal and symlinked inputs', () => {
    const receipt = read('receipt.json');
    (receipt.artifactBindings as Array<Record<string, unknown>>)[0]!.path = '../intent-runtime-results.json';
    write('receipt.json', receipt);
    const receiptBytes = fs.readFileSync(path.join(fixture, 'receipt.json'));
    fs.writeFileSync(path.join(fixture, 'receipt.sha256'), `${hash(receiptBytes)}  receipt.json\n`);
    expect(verifyMechanicalAiIntentRuntimeReceipt(fixture).issues.some(issue => issue.includes('path_unsafe'))).toBe(true);

    const link = `${fixture}-link`;
    fs.symlinkSync(fixture, link, 'junction');
    try {
      expect(verifyMechanicalAiIntentRuntimeReceipt(link).issues).toContain('input_symlink_rejected');
    } finally {
      fs.unlinkSync(link);
    }
  });

  it('rejects an exact bounds claim beyond the independent 1e-5 mm tolerance', () => {
    const create = read(path.join('runtime', 'hole', 'create.json'));
    const assertion = create.intentDimensionAssertion as Record<string, unknown>;
    const extents = assertion.extentsMm as number[];
    extents[0] = 100.00002;
    write(path.join('runtime', 'hole', 'create.json'), create);
    refreshCaseArtifact('hole', 'create.json');
    const result = verifyMechanicalAiIntentRuntimeReceipt(fixture);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('case:ko_practical-01-hole:exact_dimension_tolerance_exceeded');
  });

  it('rejects unit, revision, axis, and commercial claim promotions', () => {
    const results = read('intent-runtime-results.json');
    const first = (results.cases as Array<Record<string, unknown>>)[0]!;
    (first.authoritativeInput as Record<string, unknown>).sourceUnits = ['in'];
    ((first.candidate as Record<string, unknown>).baseRevision) = '0'.repeat(64);
    (first.runtimeAxes as Record<string, unknown>).edit = 'NOT_RUN';
    const commercial = results.commercialCampaign as Record<string, unknown>;
    commercial.status = 'PASS';
    commercial.releaseEligible = true;
    write('intent-runtime-results.json', results);
    refreshReceipt();
    const result = verifyMechanicalAiIntentRuntimeReceipt(fixture);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'case:ko_practical-01-hole:candidate_revision_invalid',
      'case:ko_practical-01-hole:authoritative_dimensions_or_units_invalid',
      'case:ko_practical-01-hole:runtime_axes_invalid',
      'external_commercial_claim_boundary_invalid',
    ]));
  });

  it('rejects an unrecognized axis run appended to a complete receipt', () => {
    const axisReceipt = read('runtime-axis-evidence.json');
    const runs = axisReceipt.runs as Array<Record<string, unknown>>;
    runs.push({
      ...runs[0],
      feature: 'unrecognized-feature',
      axis: 'create',
    });
    runs.push('not-an-axis-run' as unknown as Record<string, unknown>);
    write('runtime-axis-evidence.json', axisReceipt);
    refreshReceipt();

    const result = verifyMechanicalAiIntentRuntimeReceipt(fixture);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'axis_run_invalid:unrecognized-feature:create',
      'axis_run_invalid:non_object',
    ]));
  });

  it('rejects a false PASS or duplicate for a contract feature outside the executed first ten', () => {
    const axisReceipt = read('runtime-axis-evidence.json');
    const runs = axisReceipt.runs as Array<Record<string, unknown>>;
    const notRun = runs.find(run => run.feature === 'variableFillet' && run.axis === 'create')!;
    notRun.status = 'PASS';
    notRun.executedAt = axisReceipt.generatedAt;
    runs.push({ ...notRun });
    write('runtime-axis-evidence.json', axisReceipt);
    refreshReceipt();

    const result = verifyMechanicalAiIntentRuntimeReceipt(fixture);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'axis_run_claim_invalid:variableFillet:create',
      'axis_run_duplicate:variableFillet:create',
    ]));
  });
});
