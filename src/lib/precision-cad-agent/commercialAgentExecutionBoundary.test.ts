import { describe, expect, it } from 'vitest';
import {
  InMemoryApprovalChallengeLedger,
  approvalChallengeMac,
  consumeApprovalChallenge,
  hashBoundaryArguments,
  issueApprovalChallenge,
  type ApprovalBindingInput,
  type ApprovalChallengeLedger,
} from './commercialAgentExecutionBoundary';

const SECRET = 'commercial-boundary-test-secret-012345678901234567';
const NOW = 1_800_000_000_000;
const binding = (overrides: Partial<ApprovalBindingInput> = {}): ApprovalBindingInput => ({
  actorId: 'user-1', role: 'editor', projectId: 'project-1', workspaceId: 'workspace-1', workspaceRevision: 7,
  workspaceContentHash: 'a'.repeat(64), tool: 'build_assembly', scope: 'apply', callId: 'call-1', arguments: { amount: 2, nested: { b: 2, a: 1 } }, ...overrides,
});

async function issued(input = binding()) {
  const ledger = new InMemoryApprovalChallengeLedger();
  const result = await issueApprovalChallenge(ledger, input, SECRET, NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('issue failed');
  return { ledger, result, input };
}

describe('commercial precision CAD execution boundary', () => {
  it('issues a verifier-bound challenge and consumes it exactly once', async () => {
    const { ledger, result, input } = await issued();
    const challenge = result.challenge;
    expect(challenge.argumentsHash).toBe(hashBoundaryArguments(input.arguments));
    const consumed = await consumeApprovalChallenge(ledger, { ...input, challengeId: challenge.challengeId, nonce: challenge.nonce, mac: challenge.mac }, SECRET, NOW + 1);
    expect(consumed).toMatchObject({ ok: true, challenge: { challengeId: challenge.challengeId } });
    const replay = await consumeApprovalChallenge(ledger, { ...input, challengeId: challenge.challengeId, nonce: challenge.nonce, mac: challenge.mac }, SECRET, NOW + 2);
    expect(replay).toEqual({ ok: false, code: 'REPLAY' });
  });

  it('rejects expiry, viewer approval, actor/revision/tool/argument substitution', async () => {
    const expired = await issued();
    expect(await consumeApprovalChallenge(expired.ledger, { ...expired.input, challengeId: expired.result.challenge.challengeId, nonce: expired.result.challenge.nonce, mac: expired.result.challenge.mac }, SECRET, expired.result.challenge.expiresAt + 1)).toEqual({ ok: false, code: 'EXPIRED' });
    const viewer = await issueApprovalChallenge(new InMemoryApprovalChallengeLedger(), binding({ role: 'viewer' }), SECRET, NOW);
    expect(viewer).toEqual({ ok: false, code: 'INVALID_INPUT' });
    const wrong = await issued();
    const base = { challengeId: wrong.result.challenge.challengeId, nonce: wrong.result.challenge.nonce, mac: wrong.result.challenge.mac };
    expect(await consumeApprovalChallenge(wrong.ledger, { ...binding({ actorId: 'other-user' }), ...base }, SECRET, NOW + 1)).toEqual({ ok: false, code: 'BINDING_MISMATCH' });
    expect(await consumeApprovalChallenge(wrong.ledger, { ...binding({ workspaceRevision: 8 }), ...base }, SECRET, NOW + 1)).toEqual({ ok: false, code: 'BINDING_MISMATCH' });
    expect(await consumeApprovalChallenge(wrong.ledger, { ...binding({ tool: 'loft_part' }), ...base }, SECRET, NOW + 1)).toEqual({ ok: false, code: 'BINDING_MISMATCH' });
    expect(await consumeApprovalChallenge(wrong.ledger, { ...binding({ arguments: { amount: 3 } }), ...base }, SECRET, NOW + 1)).toEqual({ ok: false, code: 'BINDING_MISMATCH' });
  });

  it('permits only one concurrent consume and detects stored-MAC tampering', async () => {
    const { ledger, result, input } = await issued();
    const request = { ...input, challengeId: result.challenge.challengeId, nonce: result.challenge.nonce, mac: result.challenge.mac };
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => consumeApprovalChallenge(ledger, request, SECRET, NOW + 1)));
    expect(outcomes.filter(item => item.ok)).toHaveLength(1);
    const tamperedChallenge = { ...result.challenge, mac: 'f'.repeat(16) };
    const tamperedLedger: ApprovalChallengeLedger = { insert: () => false, get: () => tamperedChallenge, consume: () => tamperedChallenge };
    const tampered = await consumeApprovalChallenge(tamperedLedger, request, SECRET, NOW + 1);
    expect(tampered).toEqual({ ok: false, code: 'MAC_INVALID' });
    const { mac: _mac, ...unsigned } = result.challenge;
    expect(approvalChallengeMac(SECRET, unsigned)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
