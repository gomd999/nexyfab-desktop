import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807');
const corpusPath = path.resolve(process.argv[3] ?? 'docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json');
const output = path.resolve(process.argv[4] ?? path.join(root, 'phase-b-review-packets.json'));
const read = <T>(file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
type Priority = { selected: Array<{ rankInFamily: number; caseId: string; family: string; tier: string; priorityScore: number }> };
type Queue = { tasks: Array<{ caseId: string; sourceHash: string; artifactSetHash: string; requiredAssertionIds: string[] }> };
type Worklist = { tasks: Array<{ caseId: string; sourceHashPassed: boolean; automaticPasses: number; reviewerRequired: number; assertions: unknown[] }> };
type Validation = { cases: Array<{ caseId: string; status: string; releaseReady: boolean; axes: unknown[] }> };
type CorpusCase = { caseId: string; family: string; tier: string; sourceHash: string; holdoutGroup: string; assertions: Array<{ id: string; axis: string; required: boolean; tolerancePolicy: string; artifactHashes: string[] }> };
type Review = { family: string; selected: number; shortfall: number; structurallyRejected: Array<{ lineageGroup: string; relativePath: string; reason: string }>; items: Array<{ caseId: string; localLocator: string; extension: string; bytes: number; reviewChecklist: string[] }> };
const priority = read<Priority>(path.join(root, 'ground-truth-review-priority.json'));
const queue = read<Queue>(path.join(root, 'ground-truth-approval-queue.json'));
const worklist = read<Worklist>(path.join(root, 'review-worklist.json'));
const validation = read<Validation>(path.join(root, 'native-direct-validation.json'));
const corpus = read<CorpusCase[]>(corpusPath);
const families = ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'interior'];
const reviews = families.map(family => read<Review>(path.join(root, `${family}.review.json`)));
const packets = priority.selected.map(selected => {
  const caseValue = corpus.find(item => item.caseId === selected.caseId);
  const approval = queue.tasks.find(item => item.caseId === selected.caseId);
  const task = worklist.tasks.find(item => item.caseId === selected.caseId);
  const native = validation.cases.find(item => item.caseId === selected.caseId);
  const source = reviews.flatMap(item => item.items).find(item => item.caseId === selected.caseId);
  if (!caseValue || !approval || !task || !native || !source) throw new Error(`phase_b_packet_input_missing:${selected.caseId}`);
  return {
    schema: 'nexyfab.ground-truth-review-packet.v1',
    caseId: selected.caseId, family: selected.family, tier: selected.tier, rankInFamily: selected.rankInFamily, priorityScore: selected.priorityScore,
    source: { hash: caseValue.sourceHash, locator: source.localLocator, extension: source.extension, bytes: source.bytes, holdoutGroup: caseValue.holdoutGroup, hashPassed: task.sourceHashPassed },
    approvalTarget: { artifactSetHash: approval.artifactSetHash, requiredAssertionIds: approval.requiredAssertionIds },
    evidence: { automaticPasses: task.automaticPasses, reviewerRequired: task.reviewerRequired, assertions: task.assertions, nativeStatus: native.status, nativeReleaseReady: native.releaseReady, nativeAxes: native.axes },
    decisions: {
      licenseReview: { decision: null, reviewerId: null, note: null, reviewedAt: null },
      holdoutIsolationReview: { decision: null, reviewerId: null, note: null, reviewedAt: null },
      assertionReviews: caseValue.assertions.map(item => ({ assertionId: item.id, axis: item.axis, required: item.required, tolerancePolicy: item.tolerancePolicy, artifactHashes: item.artifactHashes, decision: null, reviewerId: null, note: null, reviewedAt: null })),
      signoffs: { domainReviewer: null, independentReviewer: null },
    },
    checklist: source.reviewChecklist,
  };
});
const rejected = reviews.flatMap(review => review.structurallyRejected.map(item => ({ family: review.family, ...item })));
const acquisition = reviews.filter(item => item.shortfall > 0).map(item => ({ family: item.family, selected: item.selected, target: 20, shortfall: item.shortfall, reusableRejected: 0, newIndependentSourcesRequired: item.shortfall }));
const artifact = {
  schema: 'nexyfab.phase-b-review-packet-batch.v1',
  policy: { packetsDoNotGrantApproval: true, decisionsMustBeHumanAuthored: true, dualIndependentSignoffRequired: true, structurallyRejectedSourcesNotReusableWithoutNewCadEvidence: true },
  summary: { packets: packets.length, families: new Set(packets.map(item => item.family)).size, pendingDecisions: packets.length, approved: 0, acquisitionRequired: acquisition.reduce((sum, item) => sum + item.shortfall, 0), reusableRejected: 0, structurallyRejected: rejected.length },
  acquisition, structurallyRejected: rejected, packets,
};
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
