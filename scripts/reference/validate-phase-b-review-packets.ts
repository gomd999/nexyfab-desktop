import fs from 'node:fs';
import path from 'node:path';
import { groundTruthArtifactSetHash } from '../../src/lib/ai/complexGroundTruthApproval';
import type { ComplexBenchmarkCaseV2 } from '../../src/lib/ai/complexProductBenchmarkV2';

const packetsPath = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-packets.json');
const corpusPath = path.resolve(process.argv[3] ?? 'docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json');
const output = path.resolve(process.argv[4] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-packets-validation.json');
type Packet = { caseId: string; family: string; rankInFamily: number; source: { hash: string; hashPassed: boolean }; approvalTarget: { artifactSetHash: string; requiredAssertionIds: string[] }; decisions: { licenseReview: { decision: null }; holdoutIsolationReview: { decision: null }; assertionReviews: Array<{ assertionId: string; decision: null }>; signoffs: { domainReviewer: null; independentReviewer: null } } };
const batch = JSON.parse(fs.readFileSync(packetsPath, 'utf8')) as { packets: Packet[]; summary: { acquisitionRequired: number; reusableRejected: number } };
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as ComplexBenchmarkCaseV2[];
const errors: string[] = [], ids = new Set<string>();
for (const packet of batch.packets) {
  if (ids.has(packet.caseId)) errors.push(`packet_duplicate:${packet.caseId}`); ids.add(packet.caseId);
  const caseValue = corpus.find(item => item.caseId === packet.caseId);
  if (!caseValue) { errors.push(`packet_case_missing:${packet.caseId}`); continue; }
  if (!packet.source.hashPassed || packet.source.hash !== caseValue.sourceHash) errors.push(`packet_source_hash_invalid:${packet.caseId}`);
  if (packet.approvalTarget.artifactSetHash !== groundTruthArtifactSetHash(caseValue)) errors.push(`packet_artifact_set_hash_invalid:${packet.caseId}`);
  const required = caseValue.assertions.filter(item => item.required).map(item => item.id).sort();
  if (packet.approvalTarget.requiredAssertionIds.slice().sort().join('|') !== required.join('|')) errors.push(`packet_required_assertions_invalid:${packet.caseId}`);
  if (packet.decisions.licenseReview.decision !== null || packet.decisions.holdoutIsolationReview.decision !== null || packet.decisions.signoffs.domainReviewer !== null || packet.decisions.signoffs.independentReviewer !== null || packet.decisions.assertionReviews.some(item => item.decision !== null)) errors.push(`packet_premature_decision:${packet.caseId}`);
}
for (const family of ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'interior']) {
  const rows = batch.packets.filter(item => item.family === family);
  if (rows.length !== 5 || rows.map(item => item.rankInFamily).sort((a, b) => a - b).join(',') !== '1,2,3,4,5') errors.push(`packet_family_priority_invalid:${family}`);
}
if (batch.summary.acquisitionRequired !== 32 || batch.summary.reusableRejected !== 0) errors.push('packet_acquisition_summary_invalid');
const artifact = { schema: 'nexyfab.phase-b-review-packet-validation.v1', status: errors.length ? 'fail' : 'pass', releaseReady: false, summary: { packets: batch.packets.length, uniqueCases: ids.size, errors: errors.length, prematureApprovals: errors.filter(item => item.startsWith('packet_premature_decision')).length }, errors };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary, status: artifact.status }));
if (errors.length) process.exitCode = 4;
