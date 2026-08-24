import { describe, expect, it } from 'vitest';
import { assessAiDesignCandidateQuality } from './aiDesignCandidateQuality';

describe('AI Design candidate quality', () => {
  it('accepts distinct concept strategies without claiming exact verification', () => {
    const report = assessAiDesignCandidateQuality([
      { id: 'compact', title: 'Compact bracket', summary: 'Minimize envelope', parameterKeys: ['thickness'], featureKeys: ['body', 'rib'] },
      { id: 'serviceable', title: 'Serviceable bracket', summary: 'Prioritize tool access', parameterKeys: ['clearance'], featureKeys: ['body', 'access-cut'] },
    ]);
    expect(report).toMatchObject({ conceptPublishable: true, criticStatus: 'NOT_RUN', exactVerificationStatus: 'NOT_RUN' });
    expect(report.diversityScore).toBeGreaterThan(0);
  });

  it('rejects one-card comparison and near-duplicate variants', () => {
    expect(assessAiDesignCandidateQuality([{ id: 'only', title: 'Only', summary: 'One', parameterKeys: ['width'], featureKeys: ['body'] }]).issues).toContain('candidate_comparison_requires_two_or_more');
    const report = assessAiDesignCandidateQuality([
      { id: 'a', title: 'Bracket A', summary: 'Same body', parameterKeys: ['width'], featureKeys: ['body'] },
      { id: 'b', title: 'Bracket B', summary: 'Same strategy', parameterKeys: ['width'], featureKeys: ['body'] },
    ]);
    expect(report.conceptPublishable).toBe(false);
    expect(report.issues.some(issue => issue.startsWith('candidate_near_duplicate'))).toBe(true);
  });
});
