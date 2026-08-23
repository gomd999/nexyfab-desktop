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

const roundtrips = (domain: CadArtifactRoundtripReceipt['domain'] = 'mechanical'): CadArtifactRoundtripReceipt[] => Object.entries(checks).map(([kind, ids], index) => ({
  schema: 'nexyfab.cad-artifact-roundtrip.v2',
  domain,
  kind: kind as CadArtifactRoundtripReceipt['kind'],
  revisionSha256,
  exportedArtifactSha256: (index + 1).toString(16).repeat(64),
  reimportedArtifactSha256: (index + 5).toString(16).repeat(64),
  status: 'pass',
  checks: ids.map(id => ({ id, status: 'pass' as const })),
  executedAt,
}));

describe('CAD deliverable release decision', () => {
  it('blocks a claimed manufacturing status without its domain-required roundtrips and real registered signatures', () => {
    const receipts = roundtrips().slice(0, 3);
    const decision = evaluateCadDeliverableRelease({
      schema: 'nexyfab.cad-deliverable-release-input.v2',
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
    const receipts = roundtrips('building');
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
        schema: 'nexyfab.cad-deliverable-signoff.v2' as const,
        targetSha256: packet.targetSha256,
        reviewerId,
        role,
        decision: 'approved' as const,
        reviewedAt: executedAt,
      };
      return { ...unsigned, signature: sign(null, Buffer.from(cadDeliverableSignoffPayload(unsigned)), privateKey).toString('base64') };
    };
    const input = {
      schema: 'nexyfab.cad-deliverable-release-input.v2' as const,
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
    const receipts = roundtrips('interior');
    const packet = buildCadDeliverableReviewPacket({
      domain: 'interior', revisionId: 'r-9', revisionSha256, roundtrips: receipts,
      requestedStatus: 'expert_approved',
    });
    receipts[1] = { ...receipts[1]!, reimportedArtifactSha256: sha('f') };
    const decision = evaluateCadDeliverableRelease({
      schema: 'nexyfab.cad-deliverable-release-input.v2',
      workflowStatus: 'expert_approved', purpose: 'expert_review', domain: 'interior',
      revisionId: 'r-9', revisionSha256, roundtrips: receipts, reviewPacket: packet, signoffs: [],
    });
    expect(packet.roundtripEvidenceSha256).not.toBe(cadRoundtripEvidenceSha256(receipts));
    expect(decision.blockers).toContain('review:roundtrip_evidence_mismatch');
    expect(decision.status).toBe('blocked');
  });

  it('requires STEP but not IFC for mechanical manufacturing release', () => {
    const receipts = roundtrips('mechanical').filter(receipt => receipt.kind !== 'ifc');
    const decision = evaluateCadDeliverableRelease({
      schema: 'nexyfab.cad-deliverable-release-input.v2',
      workflowStatus: 'auto_verified',
      purpose: 'manufacturing_or_construction',
      domain: 'mechanical',
      revisionId: 'r-mechanical',
      revisionSha256,
      roundtrips: receipts,
    });
    expect(decision.profile).toBe('mechanical');
    expect(decision.requiredRoundtrips).toEqual(['step', 'bom', 'drawing']);
    expect(decision.blockers).not.toContain('roundtrip:ifc:missing');
    expect(decision.blockers).not.toContain('roundtrip:step:missing');
  });

  it('requires IFC but not STEP for spatial manufacturing release', () => {
    const receipts = roundtrips('building').filter(receipt => receipt.kind !== 'step');
    const decision = evaluateCadDeliverableRelease({
      schema: 'nexyfab.cad-deliverable-release-input.v2',
      workflowStatus: 'auto_verified',
      purpose: 'manufacturing_or_construction',
      domain: 'building',
      revisionId: 'r-spatial',
      revisionSha256,
      roundtrips: receipts,
    });
    expect(decision.profile).toBe('spatial');
    expect(decision.requiredRoundtrips).toEqual(['ifc', 'bom', 'drawing']);
    expect(decision.blockers).not.toContain('roundtrip:step:missing');
    expect(decision.blockers).not.toContain('roundtrip:ifc:missing');
  });

  it('rejects every v1 receipt instead of reinterpreting it as v2 evidence', () => {
    const receipts = roundtrips('mechanical').filter(receipt => receipt.kind !== 'ifc');
    const legacy = { ...receipts[0]!, schema: 'nexyfab.cad-artifact-roundtrip.v1' } as unknown as CadArtifactRoundtripReceipt;
    const decision = evaluateCadDeliverableRelease({
      schema: 'nexyfab.cad-deliverable-release-input.v2',
      workflowStatus: 'auto_verified',
      purpose: 'manufacturing_or_construction',
      domain: 'mechanical',
      revisionId: 'r-legacy',
      revisionSha256,
      roundtrips: [legacy, ...receipts.slice(1)],
    });
    expect(decision.status).toBe('blocked');
    expect(decision.blockers).toContain('roundtrip:step:schema');
  });
});
