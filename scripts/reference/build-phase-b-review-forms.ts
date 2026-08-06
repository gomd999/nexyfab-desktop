import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const packetsPath = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-packets.json');
const outputDir = path.resolve(process.argv[3] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-forms');
type Packet = { caseId: string; family: string; tier: string; source: unknown; approvalTarget: { artifactSetHash: string; requiredAssertionIds: string[] }; evidence: unknown; decisions: { assertionReviews: Array<{ assertionId: string }> }; checklist: string[] };
const batch = JSON.parse(fs.readFileSync(packetsPath, 'utf8')) as { packets: Packet[] };
fs.mkdirSync(outputDir, { recursive: true });
const records = [];
for (const packet of batch.packets) {
  const form = {
    schema: 'nexyfab.ground-truth-review-form.v1', caseId: packet.caseId, family: packet.family, tier: packet.tier,
    immutableTarget: { source: packet.source, artifactSetHash: packet.approvalTarget.artifactSetHash, requiredAssertionIds: packet.approvalTarget.requiredAssertionIds, evidence: packet.evidence },
    instructions: { decisions: ['approved', 'rejected', 'changes_requested'], reviewerIdsMustBeRealAndNonEmpty: true, notesMustBeNonEmpty: true, timestampsMustBeIso8601: true, independentReviewerMustDiffer: true, independentReviewerMustNotAuthorAssertionReviews: true },
    submission: {
      revision: 1,
      licenseReview: { decision: null, reviewerId: null, note: null, reviewedAt: null },
      holdoutIsolationReview: { decision: null, reviewerId: null, note: null, reviewedAt: null },
      assertionReviews: packet.decisions.assertionReviews.map(item => ({ assertionId: item.assertionId, decision: null, reviewerId: null, note: null, reviewedAt: null })),
      signoffs: [
        { role: 'domain-reviewer', decision: null, reviewerId: null, note: null, reviewedAt: null, artifactSetHash: packet.approvalTarget.artifactSetHash, reviewedAssertionIds: packet.approvalTarget.requiredAssertionIds },
        { role: 'independent-reviewer', decision: null, reviewerId: null, note: null, reviewedAt: null, artifactSetHash: packet.approvalTarget.artifactSetHash, reviewedAssertionIds: packet.approvalTarget.requiredAssertionIds },
      ],
    },
    checklist: packet.checklist,
  };
  const text = `${JSON.stringify(form, null, 2)}\n`, file = `${packet.caseId}.review.json`;
  fs.writeFileSync(path.join(outputDir, file), text, 'utf8');
  records.push({ caseId: packet.caseId, family: packet.family, file, sha256: createHash('sha256').update(text).digest('hex'), status: 'blank' });
}
const index = { schema: 'nexyfab.ground-truth-review-form-index.v1', policy: { blankFormsGrantApproval: false, immutableTargetMustNotChange: true, dualIndependentSignoffRequired: true }, summary: { forms: records.length, blank: records.length, submitted: 0 }, forms: records };
fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), outputDir), ...index.summary }));
