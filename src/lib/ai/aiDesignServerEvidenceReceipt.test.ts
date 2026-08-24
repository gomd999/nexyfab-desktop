import { describe, expect, it } from 'vitest';
import { issueAiDesignServerEvidenceReceipt, verifyAiDesignServerEvidenceReceipt } from './aiDesignServerEvidenceReceipt';

const secret = 'ai-design-server-evidence-secret-at-least-32-bytes';
const hash = (char: string) => char.repeat(64);
const now = new Date('2026-08-24T04:00:00.000Z');

const input = {
  projectId: 'project-1', sessionId: 'session-1', commandId: 'command-1', checkpointId: 'checkpoint-1',
  checkpointDigest: hash('a'), runtimeRevision: 3, generationRevision: 2, stage: 'planning' as const,
  outcome: 'PASS' as const, inputDigest: hash('b'), outputDigest: hash('c'), source: 'ai-design-worker-v2', codes: ['schema_valid'],
};

describe('AI Design server evidence receipt', () => {
  it('binds a signed PASS to the exact server scope and revisions', () => {
    const receipt = issueAiDesignServerEvidenceReceipt(input, secret, now);
    expect(verifyAiDesignServerEvidenceReceipt(receipt, input, secret, new Date(now.getTime() + 1_000))).toEqual([]);
    expect(receipt).toMatchObject({ producer: 'ai-design-server-runtime-v2', outcome: 'PASS', stage: 'planning' });
  });

  it('rejects client mutation, replay to another command, and expiry', () => {
    const receipt = issueAiDesignServerEvidenceReceipt(input, secret, now, 1_000);
    expect(verifyAiDesignServerEvidenceReceipt({ ...receipt, outputDigest: hash('d') }, input, secret, now)).toContain('AI_DESIGN_EVIDENCE_SIGNATURE_INVALID');
    expect(verifyAiDesignServerEvidenceReceipt(receipt, { ...input, commandId: 'command-2' }, secret, now)).toContain('AI_DESIGN_EVIDENCE_SCOPE_MISMATCH');
    expect(verifyAiDesignServerEvidenceReceipt(receipt, input, secret, new Date(now.getTime() + 1_001))).toContain('AI_DESIGN_EVIDENCE_EXPIRED');
  });

  it('fails closed for weak secrets and malformed authoritative input', () => {
    expect(() => issueAiDesignServerEvidenceReceipt(input, 'weak', now)).toThrow('AI_DESIGN_EVIDENCE_SIGNING_SECRET_WEAK');
    expect(() => issueAiDesignServerEvidenceReceipt({ ...input, outputDigest: 'client-pass' }, secret, now)).toThrow('AI_DESIGN_EVIDENCE_DIGEST_INVALID');
  });
});
