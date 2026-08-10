import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCadDeliverableReviewPacket,
  cadDeliverableSignoffPayload,
  cadRoundtripEvidenceSha256,
  evaluateCadDeliverableRelease,
  type CadArtifactRoundtripReceipt,
  type CadDeliverableSignoff,
} from './cad-deliverable-release';

const sha = (char: string) => char.repeat(64);
const revisionSha256 = sha('a');
const executedAt = '2026-08-10T00:00:00.000Z';
const checks = {
  step: ['geometry', 'topology', 'dimensions'],
  ifc: ['guid', 'spatial_hierarchy', 'placement', 'properties', 'quantities'],
  bom: ['part_identity', 'quantity', 'material'],
  drawing: ['revision', 'views', 'dimensions'],
} as const;

const roundtrips = (): CadArtifactRoundtripReceipt[] => Object.entries(checks).map(([kind, ids], index) => ({
  schema: 'nexyfab.cad-artifact-roundtrip.v1',
  kind: kind as CadArtifactRoundtripReceipt['kind'],
  revisionSha256,
  exportedArtifactSha256: (index + 1).toString(16).repeat(64),
  reimportedArtifactSha256: (index + 5).toString(16).repeat(64),
  status: 'pass',
  checks: ids.map(id => ({ id, status: 'pass' as const })),
  executedAt,
}));

describe('CAD deliverable release decision', () => {
  it('blocks a claimed manufacturing status without four roundtrips and real registered signatures', () => {
    const receipts = roundtrips().slice(0, 3);
    const decision = evaluateCadDeliverableRelease({
      workflowStatus: 'manufacturing_or_construction_approved',
      purpose: 'manufacturing_or_construction',
      domain: 'mechanical',
      revisionId: 'r-17',
      revisionSha256,
      roundtrips: receipts,
    });
    expect(decision.status).toBe('blocked');
    expect(decision.blockers).toEqual(expect.arrayContaining(['review:packet_missing', 'roundtrip:drawing:missing']));
  });

  it('passes only with hash-bound roundtrips and distinct trusted reviewer signatures', () => {
    const receipts = roundtrips();
    const packet = buildCadDeliverableReviewPacket({
      domain: 'building', revisionId: 'r-42', revisionSha256, roundtrips: receipts,
      requestedStatus: 'manufacturing_or_construction_approved',
    });
    const domain = generateKeyPairSync('ed25519');
    const independent = generateKeyPairSync('ed25519');
    const make = (
      reviewerId: string,
      role: CadDeliverableSignoff['role'],
      privateKey: typeof domain.privateKey,
    ): CadDeliverableSignoff => {
      const unsigned = {
        schema: 'nexyfab.cad-deliverable-signoff.v1' as const,
        targetSha256: packet.targetSha256,
        reviewerId,
        role,
        decision: 'approved' as const,
        reviewedAt: executedAt,
      };
      return { ...unsigned, signature: sign(null, Buffer.from(cadDeliverableSignoffPayload(unsigned)), privateKey).toString('base64') };
    };
    const input = {
      workflowStatus: 'manufacturing_or_construction_approved' as const,
      purpose: 'manufacturing_or_construction' as const,
      domain: 'building' as const,
      revisionId: 'r-42', revisionSha256, roundtrips: receipts, reviewPacket: packet,
      signoffs: [make('building-expert', 'domain-reviewer', domain.privateKey), make('independent-expert', 'independent-reviewer', independent.privateKey)],
    };
    const trusted = {
      'building-expert': { publicKey: domain.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['domain-reviewer' as const] },
      'independent-expert': { publicKey: independent.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['independent-reviewer' as const] },
    };
    const decision = evaluateCadDeliverableRelease(input, trusted, Date.parse('2026-08-10T01:00:00.000Z'));
    expect(decision).toMatchObject({ status: 'pass', blockers: [], validReviewerIds: ['building-expert', 'independent-expert'] });
  });

  it('invalidates approval when any roundtrip evidence is changed after review', () => {
    const receipts = roundtrips();
    const packet = buildCadDeliverableReviewPacket({
      domain: 'interior', revisionId: 'r-9', revisionSha256, roundtrips: receipts,
      requestedStatus: 'expert_approved',
    });
    receipts[1] = { ...receipts[1]!, reimportedArtifactSha256: sha('f') };
    const decision = evaluateCadDeliverableRelease({
      workflowStatus: 'expert_approved', purpose: 'expert_review', domain: 'interior',
      revisionId: 'r-9', revisionSha256, roundtrips: receipts, reviewPacket: packet, signoffs: [],
    });
    expect(packet.roundtripEvidenceSha256).not.toBe(cadRoundtripEvidenceSha256(receipts));
    expect(decision.blockers).toContain('review:roundtrip_evidence_mismatch');
    expect(decision.status).toBe('blocked');
  });
});
