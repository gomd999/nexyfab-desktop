import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildComplexBenchmarkReportV2, type ComplexBenchmarkAssertionV2, type ComplexBenchmarkCaseV2, type ComplexBenchmarkRunV2 } from '../../src/lib/ai/complexProductBenchmarkV2';

const args = process.argv.slice(2), evidenceDirectory = path.resolve(args.find(arg => !arg.startsWith('--')) ?? 'docs/evidence/mearm-snapshot-10');
const outputDirectory = path.resolve(args.find(arg => arg.startsWith('--output='))?.slice(9) ?? evidenceDirectory);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function load(name: string) { const bytes = await readFile(path.join(evidenceDirectory, name)); return { value: JSON.parse(bytes.toString('utf8')) as Record<string, unknown>, hash: sha256(bytes) }; }
const reviewed = (id: string, axis: ComplexBenchmarkAssertionV2['axis'], tolerancePolicy: string, artifactHashes: string[]): ComplexBenchmarkAssertionV2 => ({ id, axis, required: true, kpiEligible: true, provenance: 'authoritative-cad', tolerancePolicy, artifactHashes });
const candidate = (id: string, axis: ComplexBenchmarkAssertionV2['axis'], artifactHashes: string[]): ComplexBenchmarkAssertionV2 => ({ id, axis, required: true, kpiEligible: false, provenance: 'legacy-unreviewed', tolerancePolicy: 'ground-truth-review-or-native-extractor-required', artifactHashes });

async function main() {
  const bundle = await load('bundle.json'), mesh = await load('mesh-occurrences.json'), fusion = await load('fusion.json'), native = await load('native-assembly.json');
  if (bundle.value.schema !== 'nexyfab.cad-product-bundle.v1' || mesh.value.schema !== 'nexyfab.cad-mesh-occurrence-evidence.v1' || fusion.value.schema !== 'nexyfab.cad-assembly-fusion.v1') throw new Error('mearm_evidence_schema_invalid');
  const members = bundle.value.members as Array<{ role: string; sha256: string }>, source = members.find(item => item.role === 'authoritative_geometry'); if (!source) throw new Error('mearm_authoritative_source_missing');
  const artifacts = [bundle.hash, mesh.hash, fusion.hash, native.hash], assertions: ComplexBenchmarkAssertionV2[] = [
    reviewed('occurrences:exported-mesh-count', 'occurrences', 'exact-count-and-source-hash', [mesh.hash, bundle.hash]),
    candidate('part-definitions:semantic-groups', 'part_definitions', [fusion.hash]),
    candidate('body-membership:x_t-to-part', 'body_membership', [fusion.hash]),
    candidate('hierarchy:native-subassemblies', 'hierarchy', [native.hash]),
    candidate('transforms:native-occurrences', 'transforms', [native.hash]),
    candidate('joints:native-mates', 'joints', [native.hash]),
    candidate('motion:joint-operating-range', 'motion', [native.hash]),
    candidate('collision-clearance:operating-range', 'collision_clearance', [native.hash, mesh.hash]),
    candidate('manufacturing:material-mass', 'manufacturing', [bundle.hash]),
    candidate('step-roundtrip:assembly-preservation', 'step_roundtrip', [bundle.hash]),
  ];
  const meshSummary = mesh.value.summary as { total?: number; pass?: number; fail?: number; notRun?: number }, fusionOccurrences = Array.isArray(fusion.value.occurrences) ? fusion.value.occurrences.length : 0;
  const occurrencePass = meshSummary.total === 93 && fusionOccurrences === 93 && meshSummary.fail === 0;
  const caseValue: ComplexBenchmarkCaseV2 = { schema: 'nexyfab.complex-benchmark-case.v2', caseId: 'mearm-snapshot-10', family: 'robot', tier: 'T2', holdoutGroup: String(bundle.value.lineageId), sourceHash: source.sha256, split: 'holdout', assertions };
  const runValue: ComplexBenchmarkRunV2 = { schema: 'nexyfab.complex-benchmark-run.v2', subject: 'reference_ground_truth', caseId: caseValue.caseId, campaign: 1, repeat: 1, usedForTuning: false, requiredGatesPassed: false, verified: false, falseVerified: false, falseClear: false, destructivePartMerge: false, assertions: assertions.map(assertion => assertion.id === 'occurrences:exported-mesh-count' ? { assertionId: assertion.id, status: occurrencePass ? 'pass' : 'fail', reason: occurrencePass ? '93 hash-bound STL exports agree with 93 fusion occurrences.' : `Occurrence evidence mismatch: mesh=${meshSummary.total ?? 'unknown'}, fusion=${fusionOccurrences}, failures=${meshSummary.fail ?? 'unknown'}.`, artifactHashes: assertion.artifactHashes } : { assertionId: assertion.id, status: 'not_run', reason: assertion.id.startsWith('part-definitions') ? '35 semantic filename groups are inferred and are not approved native definitions.' : 'Authoritative native extractor or reviewed ground truth is unavailable.', artifactHashes: assertion.artifactHashes }) };
  const report = buildComplexBenchmarkReportV2([caseValue], [runValue]);
  await writeFile(path.join(outputDirectory, 'benchmark-v2-cases.json'), `${JSON.stringify([caseValue], null, 2)}\n`); await writeFile(path.join(outputDirectory, 'benchmark-v2-reference-runs.json'), `${JSON.stringify([runValue], null, 2)}\n`); await writeFile(path.join(outputDirectory, 'benchmark-v2-baseline.json'), `${JSON.stringify({ ...report, sourceEvidenceArtifactHashes: artifacts }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ caseId: caseValue.caseId, referenceAssertions: runValue.assertions.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {} as Record<string, number>), kpiEligibleAssertions: assertions.filter(item => item.kpiEligible).length, reportEligible: report.eligible, outputDirectory })}\n`);
  process.exitCode = report.eligible ? 0 : 4;
}
main().catch(error => { process.stderr.write(`MeArm benchmark v2 conversion failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
