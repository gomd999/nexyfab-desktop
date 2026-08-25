import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syntheticCampaignReceiptEligible } from './commercialization-readiness-gate.mjs';
import {
  COMMERCIAL_DOMAINS,
  COMMERCIAL_SYNTHETIC_REQUIRED_AXES,
  buildCommercialSyntheticCampaignReceipt,
} from './build-commercial-synthetic-campaign-receipt.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-synthetic-receipt-'));
  const cases = [];
  const corpusCases = [];
  const runs = [];
  for (const domain of COMMERCIAL_DOMAINS) {
    for (let index = 1; index <= 20; index++) {
      const caseId = `${domain}-case-${index}`;
      const sourceHash = hash(`${domain}:${index}`);
      const identity = {
        caseId,
        domain,
        sourceHash,
        templateId: `template-${index}`,
        parameters: { index },
        artifactHash: hash(`artifact:${domain}:${index}`),
        artifactSummary: { partCount: index, roles: ['fixture'] },
      };
      corpusCases.push({ schema: 'nexyfab.domain-accuracy-candidate.v1', split: 'candidate', ...identity });
      cases.push({
        schema: 'nexyfab.commercial-synthetic-campaign-case.v1',
        split: 'synthetic',
        syntheticRequiredAxes: [...COMMERCIAL_SYNTHETIC_REQUIRED_AXES],
        ...identity,
      });
      for (let campaign = 1; campaign <= 3; campaign++) {
        for (let repeat = 1; repeat <= 5; repeat++) {
          runs.push({
            schema: 'nexyfab.commercial-synthetic-campaign-run.v1',
            subject: 'template_rebuild',
            caseId,
            domain,
            campaign,
            repeat,
            usedForTuning: false,
            sourceHash,
            requiredGatesPassed: true,
            falseVerified: false,
            falseClear: false,
            destructivePartMerge: false,
            assertions: COMMERCIAL_SYNTHETIC_REQUIRED_AXES.map(axis => ({ axis, status: 'pass', reason: `${axis}_measured` })),
          });
        }
      }
    }
  }
  const files = (name, value) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
    return path.relative(root, file);
  };
  const sourcePath = files('source.json', { cases });
  const resultPath = files('results.json', { results: runs });
  const corpusPath = files('commercial-validation-corpus.json', {
    schema: 'nexyfab.commercial-validation-corpus.v1',
    lanes: { synthetic: { cases: corpusCases } },
  });
  const executorSourcePath = files('executor.mjs', { source: 'bound executor fixture' });
  const now = Date.now();
  const release = { buildId: 'build-1', deploymentId: 'deployment-1', head: 'a'.repeat(40) };
  return {
    root,
    sourcePath,
    resultPath,
    corpusPath,
    executorSourcePaths: [executorSourcePath],
    release,
    generatedAt: new Date(now - 1000).toISOString(),
    now,
  };
}

test('derives complete campaigns from source/result JSON and passes the v3 gate', () => {
  const input = fixture();
  const receipt = buildCommercialSyntheticCampaignReceipt(input);
  const expectedRelease = { buildId: input.release.buildId, deploymentId: input.release.deploymentId, head: input.release.head };
  assert.equal(receipt.schema, 'nexyfab.commercial-synthetic-campaign-receipt.v3');
  assert.equal(receipt.certificationEvidence, false);
  assert.equal(receipt.totalRuns, 1500);
  assert.equal(receipt.totalGatePasses, 1500);
  assert.deepEqual(receipt.executor.requiredAxes, COMMERCIAL_SYNTHETIC_REQUIRED_AXES);
  assert.equal(syntheticCampaignReceiptEligible(receipt, expectedRelease, {
    root: input.root,
    now: input.now,
    expectedCorpusSha256: receipt.corpus.sha256,
  }), true);
  assert.deepEqual(receipt, buildCommercialSyntheticCampaignReceipt(input));
});

test('rejects count-only/legacy and inconsistent run evidence', () => {
  const input = fixture();
  assert.throws(() => buildCommercialSyntheticCampaignReceipt({
    ...input,
    campaignResultPaths: undefined,
    resultPath: undefined,
    sourcePaths: undefined,
    sourcePath: undefined,
    campaignResults: [{ domain: 'mechanical', cases: 20, campaigns: 3, repeats: 5, runs: 300, gatePasses: 300 }],
    sourceCases: [{ domain: 'mechanical', cases: 20 }],
  }), /campaign_result_path_missing|campaign_result_paths_missing/);

  const result = JSON.parse(fs.readFileSync(path.join(input.root, input.resultPath), 'utf8'));
  result.results.pop();
  fs.writeFileSync(path.join(input.root, input.resultPath), JSON.stringify(result));
  assert.throws(() => buildCommercialSyntheticCampaignReceipt(input), /run_aggregate_inconsistent|repeat_shape_inconsistent/);
});

test('rejects failed gates, stale freshness, and duplicate local bindings', () => {
  const input = fixture();
  const resultFile = path.join(input.root, input.resultPath);
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  result.results[0].assertions[0].status = 'fail';
  fs.writeFileSync(resultFile, JSON.stringify(result));
  assert.throws(() => buildCommercialSyntheticCampaignReceipt(input), /campaign_run_assertions_invalid/);

  const stale = fixture();
  assert.throws(() => buildCommercialSyntheticCampaignReceipt({
    ...stale,
    generatedAt: new Date(stale.now - 25 * 60 * 60_000).toISOString(),
  }), /generated_at_not_fresh/);
  assert.throws(() => buildCommercialSyntheticCampaignReceipt({
    ...stale,
    sourcePaths: [stale.resultPath],
  }), /source_case|source_binding_duplicate|source_binding_path_duplicate/);
});

test('rejects boolean-only runs, corpus transplant, and executor tampering', () => {
  const input = fixture();
  const resultFile = path.join(input.root, input.resultPath);
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  delete result.results[0].assertions;
  fs.writeFileSync(resultFile, JSON.stringify(result));
  assert.throws(() => buildCommercialSyntheticCampaignReceipt(input), /campaign_run_observation_invalid/);

  const transplanted = fixture();
  const sourceFile = path.join(transplanted.root, transplanted.sourcePath);
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  source.cases[0].parameters.index = 999;
  fs.writeFileSync(sourceFile, JSON.stringify(source));
  assert.throws(() => buildCommercialSyntheticCampaignReceipt(transplanted), /source_corpus_case_mismatch/);

  const bound = fixture();
  const receipt = buildCommercialSyntheticCampaignReceipt(bound);
  fs.writeFileSync(path.join(bound.root, bound.executorSourcePaths[0]), 'changed executor bytes');
  assert.equal(syntheticCampaignReceiptEligible(receipt, bound.release, {
    root: bound.root,
    now: bound.now,
    expectedCorpusSha256: receipt.corpus.sha256,
  }), false);
});
