import { commercialReadinessIssues } from '../src/lib/commercial-readiness';
import { commercialReleaseEvidenceIssues } from '../src/lib/commercial-release-evidence';
import { domainAccuracyReleaseIssues } from '../src/lib/ai/domainAccuracyReleaseGate';

async function main() {
  const issues = [
    ...commercialReadinessIssues(process.env),
    ...commercialReleaseEvidenceIssues(process.env),
    ...await domainAccuracyReleaseIssues(process.env.DOMAIN_ACCURACY_EVIDENCE_DIR),
  ];

  if (issues.length) {
    console.error('[commercial-release] BLOCKED');
    for (const issue of issues) console.error(`- ${issue.code}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }

  console.log('[commercial-release] PASS — configuration and operating evidence are current');
}

void main();
