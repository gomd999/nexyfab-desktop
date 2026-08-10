import fs from 'node:fs';
import path from 'node:path';
import { evaluateJointEvidenceRelease } from '../../src/lib/reference/jointEvidenceReleaseGate';
import type { ComplexNativeExtractionRequest, ComplexNativeExtractionResult } from '../../src/lib/reference/complexNativeExtraction';

const root = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807');
const output = path.resolve(process.argv[3] ?? path.join(root, 'joint-evidence-boundary-report.json'));
const requests = JSON.parse(fs.readFileSync(path.join(root, 'native-extraction-requests.json'), 'utf8')) as { requests: ComplexNativeExtractionRequest[] };
const extracted = JSON.parse(fs.readFileSync(path.join(root, 'native-direct-results-merged.json'), 'utf8')) as { results: ComplexNativeExtractionResult[] };
const byCase = new Map(extracted.results.map(item => [item.caseId, item]));
const cases = requests.requests.map(request => {
  const result = byCase.get(request.caseId);
  if (!result) return { caseId: request.caseId, status: 'not_run', reason: 'native_extraction_unavailable', geometryStructureAvailable: false, nativeJointCount: 0, nativeKpiEligible: false, manufacturingReleaseEligible: false };
  const verdict = evaluateJointEvidenceRelease({ provenance: 'native-cad', sourceHash: result.sourceHash, artifactHashes: [result.artifactHash], jointDefinitionHash: result.artifactHash, verificationInputHash: result.artifactHash, revision: 1, jointCount: result.joints.length, semanticsComplete: result.jointSemanticsComplete });
  return { caseId: request.caseId, status: verdict.status, reason: result.jointSemanticsComplete ? 'native_joint_review_required' : 'native_joint_semantics_incomplete', geometryStructureAvailable: true, nativeJointCount: result.joints.length, nativeKpiEligible: verdict.nativeKpiEligible, manufacturingReleaseEligible: verdict.manufacturingReleaseEligible, errors: verdict.errors };
});
const artifact = { schema: 'nexyfab.joint-evidence-boundary-report.v1', releaseReady: cases.every(item => item.manufacturingReleaseEligible), policy: { inferredGeometryUsage: 'visualization-only', userConfirmedUsage: 'editable-unverified', onlyReviewedCompleteNativeCadCountsForKpi: true, emptyNativeJointSetDoesNotReleaseManufacturing: true }, summary: { cases: cases.length, geometryStructureAvailable: cases.filter(item => item.geometryStructureAvailable).length, nativeSemanticsComplete: extracted.results.filter(item => item.jointSemanticsComplete).length, nativeJointCount: extracted.results.reduce((sum, item) => sum + item.joints.length, 0), nativeKpiEligible: cases.filter(item => item.nativeKpiEligible).length, manufacturingReleaseEligible: cases.filter(item => item.manufacturingReleaseEligible).length, notRun: cases.filter(item => item.status === 'not_run').length, fail: cases.filter(item => item.status === 'fail').length }, cases };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary, releaseReady: artifact.releaseReady }));
