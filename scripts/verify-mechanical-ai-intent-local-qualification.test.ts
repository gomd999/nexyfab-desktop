import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeMechanicalAiIntentLocalQualification } from './mechanical-ai-intent-local-qualification';
import { verifyMechanicalAiIntentLocalQualification } from './verify-mechanical-ai-intent-local-qualification';
import { canonicalTextBinding, canonicalTextSha256 } from './canonical-text-binding.mjs';

const GENERATED_AT = '2026-08-13T00:00:00.000Z';
let fixtureRoot = '';

function rewriteReceipt(mutator: (receipt: Record<string, unknown>) => void): void {
  const receiptPath = path.join(fixtureRoot, 'receipt.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
  mutator(receipt);
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(receiptPath, text);
  fs.writeFileSync(path.join(fixtureRoot, 'receipt.sha256'), `${canonicalTextSha256(text)}  receipt.json\n`);
}

function rewriteResults(mutator: (results: Record<string, unknown>) => void): void {
  const resultsPath = path.join(fixtureRoot, 'results.json');
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as Record<string, unknown>;
  mutator(results);
  const text = `${JSON.stringify(results, null, 2)}\n`;
  fs.writeFileSync(resultsPath, text);
  rewriteReceipt(receipt => {
    const bindings = receipt.artifactBindings as Array<Record<string, unknown>>;
    const binding = bindings.find(item => item.path === path.relative(process.cwd(), resultsPath).replaceAll('\\', '/'))!;
    Object.assign(binding, canonicalTextBinding(text));
  });
}

beforeEach(() => {
  const fixtureParent = path.join(process.cwd(), 'docs', 'evidence', 'cad-independent', 'local');
  fs.mkdirSync(fixtureParent, { recursive: true });
  fixtureRoot = fs.mkdtempSync(path.join(fixtureParent, '.intent-verify-test-'));
  writeMechanicalAiIntentLocalQualification(fixtureRoot, GENERATED_AT);
});

afterEach(() => {
  if (fixtureRoot && fs.existsSync(fixtureRoot)) fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('mechanical AI intent qualification check-only verifier', () => {
  it('independently verifies the complete fixed local bundle', () => {
    const result = verifyMechanicalAiIntentLocalQualification(fixtureRoot);
    expect(result).toMatchObject({
      ok: true,
      checkedCases: 150,
      issues: [],
      remainingNotRun: { aiModelCall: 150, geometry: 150, verification: 150, commercialCampaign: true },
    });
  });

  it('verifies the same receipt after every bound JSON is materialized with CRLF', () => {
    for (const file of ['corpus.json', 'results.json', 'receipt.json']) {
      const absolute = path.join(fixtureRoot, file);
      const crlf = fs.readFileSync(absolute, 'utf8').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
      fs.writeFileSync(absolute, crlf);
    }
    expect(verifyMechanicalAiIntentLocalQualification(fixtureRoot)).toMatchObject({ ok: true, issues: [] });
  });

  it('rejects missing and SHA-tampered artifacts', () => {
    fs.appendFileSync(path.join(fixtureRoot, 'corpus.json'), 'tampered');
    let result = verifyMechanicalAiIntentLocalQualification(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.includes('sha256_mismatch'))).toBe(true);

    fs.rmSync(path.join(fixtureRoot, 'results.json'));
    result = verifyMechanicalAiIntentLocalQualification(fixtureRoot);
    expect(result.issues).toContain('results_missing');
  });

  it('rejects traversal and stale source bindings even with a refreshed receipt SHA', () => {
    rewriteReceipt(receipt => {
      const artifacts = receipt.artifactBindings as Array<Record<string, unknown>>;
      artifacts[0]!.path = '../corpus.json';
      const sources = receipt.sourceBindings as Array<Record<string, unknown>>;
      sources[0]!.sha256 = '0'.repeat(64);
    });
    const result = verifyMechanicalAiIntentLocalQualification(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('receipt_artifact_binding_path_unsafe');
    expect(result.issues).toContain('source:scripts/mechanical-ai-intent-local-qualification.ts_sha256_mismatch');
  });

  it('rejects a symlinked input directory', () => {
    const link = `${fixtureRoot}-link`;
    fs.symlinkSync(fixtureRoot, link, 'junction');
    try {
      const result = verifyMechanicalAiIntentLocalQualification(link);
      expect(result.ok).toBe(false);
      expect(result.issues).toContain('input_symlink_rejected');
    } finally {
      fs.unlinkSync(link);
    }
  });

  it('does not promote geometry or verification PASS claims into local qualification', () => {
    rewriteResults(results => {
      const first = (results.cases as Array<Record<string, unknown>>)[0]!;
      (first.geometry as Record<string, unknown>).execution = 'PASS';
      (first.geometry as Record<string, unknown>).status = 'PASS';
      (first.verification as Record<string, unknown>).execution = 'PASS';
      (first.verification as Record<string, unknown>).status = 'PASS';
    });
    const result = verifyMechanicalAiIntentLocalQualification(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.includes('case_geometry_execution_not_not_run'))).toBe(true);
    expect(result.issues.some(issue => issue.includes('case_verification_not_blocked_not_run'))).toBe(true);
  });

  it('rejects a claimed commercial promotion even when receipt and results agree', () => {
    rewriteResults(results => {
      const commercial = results.commercialCampaign as Record<string, unknown>;
      commercial.status = 'PASS';
      commercial.releaseEligible = true;
    });
    rewriteReceipt(receipt => {
      const commercial = receipt.commercialCampaign as Record<string, unknown>;
      commercial.status = 'PASS';
      commercial.releaseEligible = true;
    });
    const result = verifyMechanicalAiIntentLocalQualification(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'results_commercial_boundary_invalid',
      'receipt_commercial_boundary_invalid',
    ]));
  });
});
