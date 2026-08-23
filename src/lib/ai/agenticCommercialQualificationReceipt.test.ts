import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DurableExecutionJournal, InMemoryExecutionJournalStore, type ExecutionCommand, type UserApproval } from '@/lib/precision-cad-agent/executionJournal';
import {
  agenticCommercialArtifactManifestSha256,
  agenticCommercialActorSignaturePayload,
  agenticCommercialCanonicalBytes,
  agenticCommercialParserSignaturePayload,
  agenticCommercialSha256,
  agenticCommercialSignaturePayload,
  type AgenticArtifact,
  type AgenticCommercialQualificationReceipt,
  type AgenticTrustedIdentity,
  verifyAgenticCommercialQualificationReceipt,
} from './agenticCommercialQualificationReceipt';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const text = (value: string) => new Uint8Array(Buffer.from(value, 'utf8'));
const keyPair = () => generateKeyPairSync('ed25519');

function identity(identityId: string, role: AgenticTrustedIdentity['role'], keys: ReturnType<typeof keyPair>): AgenticTrustedIdentity {
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprintSha256 = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  return { identityId, role, publicKeyPem, fingerprintSha256 };
}

type Fixture = {
  receipt: AgenticCommercialQualificationReceipt;
  registry: AgenticTrustedIdentity[];
  keys: { actor: KeyObject; parser: KeyObject; verifier: KeyObject };
};

function resignVerifier(receipt: AgenticCommercialQualificationReceipt, verifier: KeyObject): void {
  receipt.verifier.signatureBase64 = sign(null, agenticCommercialSignaturePayload(receipt), verifier).toString('base64');
  receipt.receiptSha256 = agenticCommercialSha256(agenticCommercialSignaturePayload(receipt));
}

async function fixture(): Promise<Fixture> {
  const actorKeys = keyPair(), parserKeys = keyPair(), verifierKeys = keyPair();
  const registry = [identity('agent-a', 'agent', actorKeys), identity('parser-a', 'native_parser', parserKeys), identity('verifier-a', 'independent_verifier', verifierKeys)];
  const qualificationObject = {
    schema: 'nexyfab.architecture-interior-commercial-qualification.v1',
    status: 'QUALIFIED' as const,
    releaseReady: true,
    building: { targetSha256: hash('building-target'), status: 'QUALIFIED', releaseReady: true, blockers: [], runtimeEvidenceBoundary: { externalEvidenceRequired: true, externalEvidencePresent: true } },
    interior: { targetSha256: hash('interior-target'), status: 'QUALIFIED', releaseReady: true, blockers: [], runtimeEvidenceBoundary: { externalEvidenceRequired: true, externalEvidencePresent: true } },
    blockers: [],
  };
  const qualificationBytes = agenticCommercialCanonicalBytes(qualificationObject);
  const targetSha256 = agenticCommercialSha256(qualificationBytes);
  const artifactBytes = text('step');
  const artifacts: AgenticArtifact[] = [{ artifactId: 'step-1', role: 'step', targetSha256, bytes: artifactBytes, sha256: agenticCommercialSha256(artifactBytes), size: artifactBytes.length, external: true }];
  const artifactManifestSha256 = agenticCommercialArtifactManifestSha256(artifacts);
  const command: ExecutionCommand = {
    domain: 'mechanical', operation: 'build_assembly',
    arguments: { targetSha256, modelContentHash: hash('model'), artifactManifestSha256, generationRunId: 'generation-a', generationStateRevision: 11, generationProgramSha256: hash('program') },
  };
  const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), () => '2026-08-20T00:00:00.000Z');
  const planned = journal.plan({ idempotencyKey: 'agentic-fixture-a', command, workspace: { projectId: 'project-a', workspaceId: 'workspace-a', revision: 3, contentHash: hash('before') } });
  if (!planned.ok) throw new Error(planned.message);
  const approval: UserApproval = {
    approvalId: 'approval-a', actorId: 'user-approver', approved: true, approvedAt: '2026-08-20T00:00:00.000Z',
    commandHash: planned.receipt.commandHash, workspaceBindingHash: planned.receipt.workspaceBindingHash, userInitiated: true,
  };
  const approved = journal.approve(planned.receipt.executionId, approval);
  if (!approved.ok) throw new Error(approved.message);
  const persistenceObject = { persisted: true, revision: 4 };
  const verificationObject = { verified: true, targetSha256 };
  const completed = await journal.execute({
    executionId: planned.receipt.executionId, ownerId: 'worker-a',
    prepare: () => ({
      ok: true,
      workspaceAfter: { projectId: 'project-a', workspaceId: 'workspace-a', revision: 4, contentHash: hash('content') },
      affectedObjects: [{ objectId: 'object-a', beforeRevision: 3, afterRevision: 4 }],
      artifacts: [{ artifactId: 'step-1', kind: 'step', sha256: artifacts[0]!.sha256 }],
      persistenceReceipt: persistenceObject, verificationReceipt: verificationObject,
    }),
    commitWorkspace: candidate => ({ ok: true, workspaceAfter: candidate }),
  });
  if (!completed.ok) throw new Error(completed.message);
  const journalObject = JSON.parse(JSON.stringify(completed.receipt)) as typeof completed.receipt;
  const commandBytes = agenticCommercialCanonicalBytes(journalObject.command);
  const approvalBytes = agenticCommercialCanonicalBytes(journalObject.approval);
  const journalBytes = agenticCommercialCanonicalBytes(journalObject);
  const persistenceBytes = agenticCommercialCanonicalBytes(persistenceObject);
  const verificationBytes = agenticCommercialCanonicalBytes(verificationObject);
  const parserOutput = text('parser-output');
  const parserCore = {
    schema: 'nexyfab.native-parser-receipt.v1', identityId: 'parser-a', targetSha256,
    projectId: 'project-a', workspaceId: 'workspace-a', revision: 4, artifactManifestSha256,
    format: 'step', result: 'verified' as const, buildSha256: hash('parser-build'), outputSha256: agenticCommercialSha256(parserOutput),
  };
  const parserReceiptBytes = agenticCommercialCanonicalBytes(parserCore);
  const receipt: AgenticCommercialQualificationReceipt = {
    schema: 'nexyfab.agentic-commercial-qualification-receipt.v1', executionId: planned.receipt.executionId, generationRunId: 'generation-a', generationStateRevision: 11, generationProgramSha256: hash('program'), targetSha256, externalEvidence: true,
    actor: { identityId: 'agent-a', role: 'agent', keyFingerprintSha256: registry[0]!.fingerprintSha256, signatureBase64: '' },
    project: { projectId: 'project-a', workspaceId: 'workspace-a', revision: 4, contentHash: hash('content'), modelContentHash: hash('model') },
    command: { bytes: commandBytes, sha256: agenticCommercialSha256(commandBytes), size: commandBytes.length },
    approval: { bytes: approvalBytes, sha256: agenticCommercialSha256(approvalBytes), size: approvalBytes.length },
    executionJournal: { bytes: journalBytes, sha256: agenticCommercialSha256(journalBytes), size: journalBytes.length },
    persistenceReceipt: { bytes: persistenceBytes, sha256: agenticCommercialSha256(persistenceBytes), size: persistenceBytes.length },
    verificationReceipt: { bytes: verificationBytes, sha256: agenticCommercialSha256(verificationBytes), size: verificationBytes.length },
    artifacts, artifactManifestSha256,
    parser: {
      identityId: 'parser-a', role: 'native_parser', keyFingerprintSha256: registry[1]!.fingerprintSha256, targetSha256,
      projectId: 'project-a', workspaceId: 'workspace-a', revision: 4, artifactManifestSha256,
      format: 'step', result: 'verified', buildSha256: parserCore.buildSha256,
      outputBytes: parserOutput, outputSha256: parserCore.outputSha256,
      receiptBytes: parserReceiptBytes, receiptSha256: agenticCommercialSha256(parserReceiptBytes), signatureBase64: '',
    },
    qualification: { schema: qualificationObject.schema, status: 'QUALIFIED', releaseReady: true, targetSha256, receiptBytes: qualificationBytes, receiptBytesSha256: agenticCommercialSha256(qualificationBytes) },
    issuedAt: '2026-08-20T00:00:00.000Z', expiresAt: '2026-08-30T00:00:00.000Z',
    verifier: { identityId: 'verifier-a', role: 'independent_verifier', keyFingerprintSha256: registry[2]!.fingerprintSha256, signatureBase64: '' }, receiptSha256: hash('placeholder'),
  };
  receipt.actor.signatureBase64 = sign(null, agenticCommercialActorSignaturePayload(receipt), actorKeys.privateKey).toString('base64');
  receipt.parser.signatureBase64 = sign(null, agenticCommercialParserSignaturePayload(receipt.parser), parserKeys.privateKey).toString('base64');
  resignVerifier(receipt, verifierKeys.privateKey);
  return { receipt, registry, keys: { actor: actorKeys.privateKey, parser: parserKeys.privateKey, verifier: verifierKeys.privateKey } };
}

const context = (registry: AgenticTrustedIdentity[], mode: 'fixture' | 'runtime' = 'fixture') => ({ trustedRegistry: registry, now: new Date('2026-08-22T00:00:00.000Z'), mode });

describe('agentic commercial qualification receipt', () => {
  it('accepts a complete signed fixture with an actual committed durable journal', async () => {
    const { receipt, registry } = await fixture();
    expect(verifyAgenticCommercialQualificationReceipt(receipt, context(registry))).toMatchObject({ ok: true, releaseReady: true, status: 'QUALIFIED' });
    expect(verifyAgenticCommercialQualificationReceipt(receipt, context(registry, 'runtime'))).toMatchObject({ ok: true, releaseReady: true, status: 'QUALIFIED' });
  });

  it('rejects minimal fake qualification results and target substitution', async () => {
    const { receipt, registry, keys } = await fixture();
    const forged = structuredClone(receipt);
    const fake = { schema: forged.qualification.schema, status: 'QUALIFIED', releaseReady: true, blockers: [] };
    forged.qualification.receiptBytes = agenticCommercialCanonicalBytes(fake);
    forged.qualification.receiptBytesSha256 = agenticCommercialSha256(forged.qualification.receiptBytes);
    resignVerifier(forged, keys.verifier);
    expect(verifyAgenticCommercialQualificationReceipt(forged, context(registry)).issues).toContain('domain_qualification_receipt_bytes_noncanonical');
    const transplanted = structuredClone(receipt); transplanted.targetSha256 = hash('other'); resignVerifier(transplanted, keys.verifier);
    expect(verifyAgenticCommercialQualificationReceipt(transplanted, context(registry)).issues).toContain('actor_trust_or_signature_invalid');
  });

  it('rejects journal, revision, artifact, and parser receipt replay', async () => {
    const { receipt, registry, keys } = await fixture();
    const revisionReplay = structuredClone(receipt); revisionReplay.project.revision = 5; resignVerifier(revisionReplay, keys.verifier);
    expect(verifyAgenticCommercialQualificationReceipt(revisionReplay, context(registry)).issues).toEqual(expect.arrayContaining(['actor_trust_or_signature_invalid', 'execution_journal_binding_invalid']));
    const artifactReplay = structuredClone(receipt);
    artifactReplay.artifacts[0]!.bytes = text('replayed-step');
    artifactReplay.artifacts[0]!.sha256 = agenticCommercialSha256(artifactReplay.artifacts[0]!.bytes);
    artifactReplay.artifacts[0]!.size = artifactReplay.artifacts[0]!.bytes.length;
    artifactReplay.artifactManifestSha256 = agenticCommercialArtifactManifestSha256(artifactReplay.artifacts);
    resignVerifier(artifactReplay, keys.verifier);
    expect(verifyAgenticCommercialQualificationReceipt(artifactReplay, context(registry)).issues).toEqual(expect.arrayContaining(['actor_trust_or_signature_invalid', 'execution_journal_binding_invalid']));
    const parserReplay = structuredClone(receipt); parserReplay.parser.format = 'ifc'; resignVerifier(parserReplay, keys.verifier);
    expect(verifyAgenticCommercialQualificationReceipt(parserReplay, context(registry)).issues).toContain('parser_build_output_or_signature_invalid');
  });

  it('rejects stale receipts, identity/key reuse, malformed and oversized evidence', async () => {
    const { receipt, registry } = await fixture();
    expect(verifyAgenticCommercialQualificationReceipt(receipt, { ...context(registry), now: new Date('2026-09-01T00:00:00.000Z') }).issues).toContain('receipt_issue_or_expiry_invalid');
    const reused = structuredClone(receipt); reused.parser.identityId = reused.actor.identityId; reused.parser.keyFingerprintSha256 = reused.actor.keyFingerprintSha256;
    expect(verifyAgenticCommercialQualificationReceipt(reused, context(registry)).issues).toContain('identity_or_key_reuse');
    const malformed = structuredClone(receipt); malformed.command.bytes = new Uint8Array(8 * 1024 * 1024 + 1);
    expect(verifyAgenticCommercialQualificationReceipt(malformed, context(registry)).releaseReady).toBe(false);
  });
});
