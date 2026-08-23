// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/platform', () => ({ downloadBlob: vi.fn().mockResolvedValue(undefined) }));
import RobotPrecisionHandoffPanel from './RobotPrecisionHandoffPanel';
import type { AiAssemblyProgram } from '@/lib/ai/aiAssemblyProgram';
import { downloadBlob } from '@/lib/platform';

const program = {
  version: '1.0', name: 'robot', units: 'mm',
  assembly: { parts: [{ id: 'base', definitionId: 'base', position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: true }], mates: [] },
  parts: [{ instanceId: 'base', definitionId: 'base', featureTree: { version: '1.0', name: 'base', units: 'mm', features: [] } }],
} as unknown as AiAssemblyProgram;

describe('RobotPrecisionHandoffPanel', () => {
  it('downloads a hash-bound NexyFab exact-CAD work packet without external CAD, source bytes, private keys, or release', async () => {
    vi.mocked(downloadBlob).mockClear(); const packet = { schema: 'nexyfab.robot-release-evidence-work-packet.v3' as const, packetHash: 'a'.repeat(64), programHash: 'b'.repeat(64), postIntegrationSha256: 'c'.repeat(64), integrationTargetHash: 'd'.repeat(64), catalogManifestSha256: 'e'.repeat(64), lineageId: 'robot-lineage', revision: 3, preciseReportHash: 'f'.repeat(64), applicationHash: '1'.repeat(64), applicationReceiptHash: '2'.repeat(64), housingSha256: '3'.repeat(64), externalCadRequired: false as const, sourceBytesEmbedded: false as const, privateKeysEmbedded: false as const, releaseReady: false as const, registryPreflight: { exactCadSignerKeys: 0, manufacturingReviewerKeys: 0, finalReview: { reviewerKeyCount: 0, domainEligibleCount: 0, independentEligibleCount: 0, distinctPairAvailable: false } }, exactCadTask: { outputSchema: 'nexyfab.robot-exact-cad-evidence.v3' as const, requiredChecks: [], requiredCounts: { jointCount: 6 as const, partCount: 29 as const }, signaturePayloadFunction: 'robotExactCadEvidencePayload' as const, trustedRegistryEnvironment: 'NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS' as const }, manufacturingTask: { outputSchema: 'nexyfab.robot-manufacturing-validation.v3' as const, requiredChecks: [], selectedComponentCount: 22 as const, driveComponentCount: 18 as const, auxiliaryComponentCount: 4 as const, signaturePayloadFunction: 'robotManufacturingEvidencePayloadV3' as const, trustedRegistryEnvironment: 'NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS' as const }, finalReviewTask: { startsOnlyAfterReleaseAuditReady: true as const, requiredRoles: ['domain-reviewer', 'independent-reviewer'] as ['domain-reviewer', 'independent-reviewer'], trustedRegistryEnvironment: 'NEXYFAB_CAD_REVIEWER_KEYS' as const, releaseExecutionIncluded: false as const }, errors: [] }; const buildReleaseWorkPacket = vi.fn().mockResolvedValue(packet); const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} buildReleaseWorkPacket={buildReleaseWorkPacket} />); const post = new File(['{}'], 'post.json'); fireEvent.change(view.getByTestId('robot-release-post-evidence'), { target: { files: [post] } }); fireEvent.click(view.getByTestId('robot-release-work-packet')); await waitFor(() => expect(view.getByTestId('robot-release-work-report').textContent).toContain('exact CAD keys 0')); expect(view.getByTestId('robot-release-work-report').textContent).toContain('external CAD false · source bytes false · private keys false · release false'); fireEvent.click(view.getByTestId('robot-release-work-download')); await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`robot-release-work-${'a'.repeat(64)}.json`, expect.any(Blob)));
  });

  it('audits NexyFab exact-CAD gaps and verifies final eligibility without executing release', async () => {
    vi.mocked(downloadBlob).mockClear(); const audit = { schema: 'nexyfab.robot-release-evidence-audit.v3' as const, status: 'ready_for_final_review' as const, releaseTargetHash: 'a'.repeat(64), programHash: 'b'.repeat(64), postIntegrationSha256: 'c'.repeat(64), exactCadEvidenceSha256: 'd'.repeat(64), manufacturingEvidenceSha256: 'e'.repeat(64), exactCadEvidenceValid: true, manufacturingEvidenceValid: true, externalCadRequired: false as const, releaseReady: false as const, errors: [], blockers: ['final_release_dual_signoff_required'], sideEffects: { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const } }; const decision = { schema: 'nexyfab.robot-final-release-decision.v1' as const, approved: true, releaseReady: true, releaseExecuted: false as const, targetHash: audit.releaseTargetHash, auditReportSha256: 'f'.repeat(64), errors: [], blockers: [], sideEffects: { persisted: false as const, cadModified: false as const, releasePublished: false as const, quoteCreated: false as const, rfqSent: false as const } }; const auditReleaseEvidence = vi.fn().mockResolvedValue(audit), validateFinalReleaseReview = vi.fn().mockResolvedValue(decision); const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} auditReleaseEvidence={auditReleaseEvidence} validateFinalReleaseReview={validateFinalReleaseReview} />); const post = new File(['{}'], 'post.json'), exactCad = new File(['{}'], 'exact-cad.json'), manufacturing = new File(['{}'], 'mfg.json'), auditFile = new File(['{}'], 'audit.json'), review = new File(['{}'], 'review.json'); fireEvent.change(view.getByTestId('robot-release-post-evidence'), { target: { files: [post] } }); fireEvent.change(view.getByTestId('robot-release-exact-cad-evidence'), { target: { files: [exactCad] } }); fireEvent.change(view.getByTestId('robot-release-manufacturing-evidence'), { target: { files: [manufacturing] } }); fireEvent.click(view.getByTestId('robot-release-audit')); await waitFor(() => expect(view.getByTestId('robot-release-audit-report').textContent).toContain('ready_for_final_review')); expect(view.getByTestId('robot-release-audit-report').textContent).toContain('external CAD false · release false'); expect(auditReleaseEvidence).toHaveBeenCalledWith(post, exactCad, manufacturing); fireEvent.change(view.getByTestId('robot-final-audit-file'), { target: { files: [auditFile] } }); fireEvent.change(view.getByTestId('robot-final-review-file'), { target: { files: [review] } }); fireEvent.click(view.getByTestId('robot-final-review')); await waitFor(() => expect(view.getByTestId('robot-final-decision').textContent).toContain('Release eligible')); expect(view.getByTestId('robot-final-decision').textContent).toContain('ready true · executed false'); expect(view.getByTestId('robot-final-decision').textContent).toContain('does not execute or publish'); expect(view.queryByTestId('robot-release-execute')).toBeNull(); fireEvent.click(view.getByTestId('robot-final-decision-download')); await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`robot-final-release-decision-${'a'.repeat(64)}.json`, expect.any(Blob)));
  });

  it('shows a passed post-integration gate while retaining exact-CAD, manufacturing and final-review blockers', async () => {
    vi.mocked(downloadBlob).mockClear(); const report = { schema: 'nexyfab.robot-post-integration-evidence.v1' as const, postIntegrationStatus: 'passed' as const, integrationAuthorized: true, selectedOccurrencesVerified: true, precisionStatus: 'passed' as const, lineageId: 'robot-lineage', revision: 3, programHash: 'a'.repeat(64), preciseReportHash: 'b'.repeat(64), applicationReceiptHash: 'f'.repeat(64), applicationHash: '1'.repeat(64), targetHash: 'c'.repeat(64), catalogManifestSha256: 'd'.repeat(64), housingSha256: 'e'.repeat(64), counts: { selectedOccurrences: 18, auxiliaryOccurrences: 4, appliedOccurrences: 22, catalogUnresolved: 0, motionFrames: 156, checkedMotionFrames: 156, collisionFrames: 0, coordinatedMotionFrames: 49, checkedCoordinatedMotionFrames: 49, coordinatedCollisionFrames: 0, preciseInterferences: 0 }, releaseReady: false as const, blockers: ['nexyfab_exact_cad_evidence_required', 'manufacturing_validation_required', 'final_expert_release_review_required'], errors: [], sideEffects: { persisted: false as const, sourceModified: false as const, workspaceModified: false as const, quoteCreated: false as const, rfqSent: false as const } }; const postVerifyIntegration = vi.fn().mockResolvedValue(report); const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} postVerifyIntegration={postVerifyIntegration} />); const file = (name: string) => new File(['{}'], name); const values = { program: file('program.json'), revision: file('revision.json'), precise: file('report.json'), receipt: file('receipt.json'), packet: file('packet.json'), review: file('review.json'), housing: file('housing.json'), requirements: file('requirements.json'), manifest: file('manifest.json'), artifact: new File(['x'], 'evidence.pdf') };
    fireEvent.change(view.getByTestId('robot-revision-program'), { target: { files: [values.program] } }); fireEvent.change(view.getByTestId('robot-revision-manifest'), { target: { files: [values.revision] } }); fireEvent.change(view.getByTestId('robot-housing-capacities'), { target: { files: [values.housing] } }); fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [values.requirements] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [values.manifest] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [values.artifact] } }); fireEvent.change(view.getByTestId('robot-integration-packet-file'), { target: { files: [values.packet] } }); fireEvent.change(view.getByTestId('robot-integration-review-file'), { target: { files: [values.review] } }); fireEvent.change(view.getByTestId('robot-integration-receipt'), { target: { files: [values.receipt] } }); fireEvent.change(view.getByTestId('robot-evidence-report'), { target: { files: [values.precise] } }); fireEvent.click(view.getByTestId('robot-post-integration-verify'));
    await waitFor(() => expect(view.getByTestId('robot-post-integration-report').textContent).toContain('Post-integration: passed')); expect(view.getByTestId('robot-post-integration-report').textContent).toContain('Drive: 18/18 occurrences · motion 156/156 · collisions 0 · interferences 0'); expect(view.getByTestId('robot-post-integration-report').textContent).toContain('Auxiliary: 4/4 occurrences · total 22/22 · unresolved 0'); expect(view.getByTestId('robot-post-integration-report').textContent).toContain('nexyfab_exact_cad_evidence_required'); expect(view.getByTestId('robot-post-integration-report').textContent).toContain('Exact-CAD validation · manufacturing validation · final expert approval remain required'); expect(view.getByTestId('robot-post-integration-report').textContent).toContain('release false'); fireEvent.click(view.getByTestId('robot-post-integration-download')); await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`robot-post-integration-${'c'.repeat(64)}-${'a'.repeat(64)}.json`, expect.any(Blob)));
  });

  it('rejects a contradictory passed post report instead of rendering or downloading it', async () => {
    const unsafe = { schema: 'nexyfab.robot-post-integration-evidence.v1' as const, postIntegrationStatus: 'passed' as const, integrationAuthorized: false, selectedOccurrencesVerified: true, precisionStatus: 'passed' as const, lineageId: 'robot-lineage', revision: 3, programHash: 'a'.repeat(64), preciseReportHash: 'b'.repeat(64), applicationReceiptHash: 'c'.repeat(64), applicationHash: 'd'.repeat(64), targetHash: 'e'.repeat(64), catalogManifestSha256: 'f'.repeat(64), housingSha256: '1'.repeat(64), counts: { selectedOccurrences: 18, auxiliaryOccurrences: 3, appliedOccurrences: 21, catalogUnresolved: 0, motionFrames: 156, checkedMotionFrames: 156, collisionFrames: 0, coordinatedMotionFrames: 49, checkedCoordinatedMotionFrames: 49, coordinatedCollisionFrames: 0, preciseInterferences: 0 }, releaseReady: false as const, blockers: ['nexyfab_exact_cad_evidence_required', 'manufacturing_validation_required', 'final_expert_release_review_required'], errors: [], sideEffects: { persisted: false as const, sourceModified: false as const, workspaceModified: false as const, quoteCreated: false as const, rfqSent: false as const } };
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} postVerifyIntegration={vi.fn().mockResolvedValue(unsafe)} />); const file = (name: string) => new File(['{}'], name);
    fireEvent.change(view.getByTestId('robot-revision-program'), { target: { files: [file('program.json')] } }); fireEvent.change(view.getByTestId('robot-revision-manifest'), { target: { files: [file('revision.json')] } }); fireEvent.change(view.getByTestId('robot-housing-capacities'), { target: { files: [file('housing.json')] } }); fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [file('requirements.json')] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [file('manifest.json')] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [file('artifact.bin')] } }); fireEvent.change(view.getByTestId('robot-integration-packet-file'), { target: { files: [file('packet.json')] } }); fireEvent.change(view.getByTestId('robot-integration-review-file'), { target: { files: [file('review.json')] } }); fireEvent.change(view.getByTestId('robot-integration-receipt'), { target: { files: [file('receipt.json')] } }); fireEvent.change(view.getByTestId('robot-evidence-report'), { target: { files: [file('precise.json')] } }); fireEvent.click(view.getByTestId('robot-post-integration-verify'));
    await waitFor(() => expect(view.getByTestId('robot-catalog-error').textContent).toContain('unsafe or contradictory post-integration evidence response'));
    expect(view.queryByTestId('robot-post-integration-report')).toBeNull(); expect(view.queryByTestId('robot-post-integration-download')).toBeNull();
  });

  it('verifies offline dual signoff but still requires a new CAD revision and reverification', async () => {
    vi.mocked(downloadBlob).mockClear(); const result = { schema: 'nexyfab.robot-cad-integration-review-validation.v1' as const, targetHash: 'a'.repeat(64), approved: true, integrationAuthorized: true, cadApplied: false as const, releaseReady: false as const, nextStep: 'create_new_cad_revision_then_reverify' as const, errors: [], sideEffects: { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const } }; const validateIntegrationReview = vi.fn().mockResolvedValue(result); const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} validateIntegrationReview={validateIntegrationReview} />); const packet = new File(['{}'], 'packet.json'); const review = new File(['{}'], 'review.json'); fireEvent.change(view.getByTestId('robot-integration-packet-file'), { target: { files: [packet] } }); fireEvent.change(view.getByTestId('robot-integration-review-file'), { target: { files: [review] } }); fireEvent.click(view.getByTestId('robot-integration-review'));
    await waitFor(() => expect(view.getByTestId('robot-integration-review-result').textContent).toContain('Integration work authorized')); expect(validateIntegrationReview).toHaveBeenCalledWith(packet, review); expect(view.getByTestId('robot-integration-review-result').textContent).toContain('CAD applied false · release false'); expect(view.getByTestId('robot-integration-review-result').textContent).toContain('create a new CAD revision');
    fireEvent.click(view.getByTestId('robot-integration-review-download')); await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`robot-cad-integration-review-validation-${'a'.repeat(64)}.json`, expect.any(Blob)));
  });

  it('builds a downloadable r+1 bundle only after approved review and leaves the workspace untouched', async () => {
    vi.mocked(downloadBlob).mockClear(); const targetHash = 'a'.repeat(64), programHash = 'b'.repeat(64); const reviewResult = { schema: 'nexyfab.robot-cad-integration-review-validation.v1' as const, targetHash, approved: true, integrationAuthorized: true, cadApplied: false as const, releaseReady: false as const, nextStep: 'create_new_cad_revision_then_reverify' as const, errors: [], sideEffects: { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const } }; const bundle = new Blob(['zip']); const applyIntegration = vi.fn().mockResolvedValue({ bundle, filename: `robot-cad-r3-${programHash}.zip`, targetHash, programHash, revision: 3, applicationHash: 'c'.repeat(64), applicationReceiptHash: 'd'.repeat(64), driveOccurrences: 18, auxiliaryOccurrences: 4, catalogUnresolved: 0, cadAppliedToWorkspace: false, releaseReady: false });
    const mount = { parentPartId: 'base', parentAxisRef: 'axis', parentPlaneRef: 'plane', positionMm: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
    const integrationPacket = { schema: 'nexyfab.robot-cad-integration-review-packet.v1' as const, targetHash, lineageId: 'robot-lineage', revision: 2, baseProgramHash: '1'.repeat(64), programHash: '2'.repeat(64), revisionManifestSha256: '3'.repeat(64), requirementsSha256: '4'.repeat(64), catalogManifestSha256: '5'.repeat(64), catalogArtifactSetSha256: '6'.repeat(64), housingSha256: '7'.repeat(64), readiness: 'review_pending' as const, expertReviewRequired: true as const, cadIntegrationStatus: 'not_applied' as const, releaseReady: false as const, replacements: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, placeholders: { motor: `J${index + 1}:motor:old`, reducer: `J${index + 1}:reducer:old`, bearing: `J${index + 1}:bearing:old` }, selected: { motor: 'M', reducer: 'R', bearing: 'B' }, fitStatus: 'passed' as const })), auxiliaryAdditions: [{ kind: 'brake' as const, pendingComponentId: 'brake' as const, selected: 'BRAKE', occurrenceId: 'AUX:brake:BRAKE', mount }, { kind: 'encoder' as const, pendingComponentId: 'encoder' as const, selected: 'ENCODER', occurrenceId: 'AUX:encoder:ENCODER', mount }, { kind: 'harness' as const, pendingComponentId: 'internal_harness' as const, selected: 'HARNESS', occurrenceId: 'AUX:harness:HARNESS', mount }, { kind: 'tool_connector' as const, pendingComponentId: 'tool_connector' as const, selected: 'TOOL', occurrenceId: 'AUX:tool_connector:TOOL', mount }], errors: [], sideEffects: { persisted: false as const, sourceModified: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const } };
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} prepareIntegration={vi.fn().mockResolvedValue(integrationPacket)} validateIntegrationReview={vi.fn().mockResolvedValue(reviewResult)} applyIntegration={applyIntegration} />); const files = { program: new File(['{}'], 'program.json'), revision: new File(['{}'], 'revision.json'), packet: new File(['{}'], 'packet.json'), review: new File(['{}'], 'review.json'), housing: new File(['{}'], 'housing.json'), requirements: new File(['{}'], 'requirements.json'), manifest: new File(['{}'], 'manifest.json'), artifact: new File(['x'], 'evidence.pdf') };
    fireEvent.change(view.getByTestId('robot-revision-program'), { target: { files: [files.program] } }); fireEvent.change(view.getByTestId('robot-revision-manifest'), { target: { files: [files.revision] } }); fireEvent.change(view.getByTestId('robot-integration-packet-file'), { target: { files: [files.packet] } }); fireEvent.change(view.getByTestId('robot-integration-review-file'), { target: { files: [files.review] } }); fireEvent.change(view.getByTestId('robot-housing-capacities'), { target: { files: [files.housing] } }); fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [files.requirements] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [files.manifest] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [files.artifact] } }); fireEvent.click(view.getByTestId('robot-integration-prepare')); await waitFor(() => expect(view.getByTestId('robot-integration-packet').textContent).toContain('Overall integration plan: 22/22 · review_pending')); expect(view.getByTestId('robot-integration-apply-revision')).toBeDisabled(); fireEvent.click(view.getByTestId('robot-integration-review')); await waitFor(() => expect(view.getByTestId('robot-integration-apply-revision')).not.toBeDisabled()); fireEvent.click(view.getByTestId('robot-integration-apply-revision'));
    await waitFor(() => expect(view.getByTestId('robot-integration-apply-message').textContent).toContain('applied evidence 22/22')); expect(view.getByTestId('robot-integration-apply-message').textContent).toContain('Generated r+1 catalog unresolved 0 · this is not release evidence before precise reverification'); expect(view.getByTestId('robot-integration-apply-message').textContent).toContain('Catalog unresolved may be 0, but exact-CAD validation, manufacturing validation and final expert approval are still required'); expect(view.getByTestId('robot-catalog-22-status').textContent).toContain('Overall applied: 22/22 · generated r+1 catalog unresolved 0, release blocked'); expect(applyIntegration).toHaveBeenCalledWith(files.program, files.revision, files.packet, files.review, files.housing, files.requirements, files.manifest, [files.artifact]); expect(downloadBlob).toHaveBeenCalledWith(`robot-cad-r3-${programHash}.zip`, bundle);
    fireEvent.change(view.getByTestId('robot-integration-packet-file'), { target: { files: [new File(['{"target":"changed"}'], 'changed-packet.json')] } });
    expect(view.queryByTestId('robot-integration-review-result')).toBeNull(); expect(view.queryByTestId('robot-integration-apply-message')).toBeNull(); expect(view.getByTestId('robot-catalog-22-status').textContent).toContain('Overall applied: 0/22 · blocked'); expect(view.getByTestId('robot-integration-apply-revision')).toBeDisabled();
  });

  it('downloads an immutable integration review target without exposing CAD apply', async () => {
    vi.mocked(downloadBlob).mockClear();
    const packet = { schema: 'nexyfab.robot-cad-integration-review-packet.v1' as const, targetHash: 'a'.repeat(64), lineageId: 'robot-lineage', revision: 2, baseProgramHash: 'b'.repeat(64), programHash: 'c'.repeat(64), revisionManifestSha256: 'd'.repeat(64), requirementsSha256: 'e'.repeat(64), catalogManifestSha256: 'f'.repeat(64), catalogArtifactSetSha256: '1'.repeat(64), housingSha256: '2'.repeat(64), readiness: 'review_pending' as const, expertReviewRequired: true as const, cadIntegrationStatus: 'not_applied' as const, releaseReady: false as const, replacements: Array.from({ length: 6 }, (_, i) => ({ joint: i + 1, placeholders: { motor: `J${i + 1}:motor:old`, reducer: `J${i + 1}:reducer:old`, bearing: `J${i + 1}:bearing:old` }, selected: { motor: 'M', reducer: 'R', bearing: 'B' }, fitStatus: 'passed' as const })), errors: [], sideEffects: { persisted: false as const, sourceModified: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const } };
    const prepareIntegration = vi.fn().mockResolvedValue(packet); const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} prepareIntegration={prepareIntegration} />); const program = new File(['{}'], 'program.json'); const revision = new File(['{}'], 'revision.json'); const housing = new File(['{}'], 'housing.json'); const requirements = new File(['{}'], 'requirements.json'); const manifest = new File(['{}'], 'manifest.json'); const artifact = new File(['x'], 'evidence.pdf');
    fireEvent.change(view.getByTestId('robot-revision-program'), { target: { files: [program] } }); fireEvent.change(view.getByTestId('robot-revision-manifest'), { target: { files: [revision] } }); fireEvent.change(view.getByTestId('robot-housing-capacities'), { target: { files: [housing] } }); fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [requirements] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [manifest] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [artifact] } }); fireEvent.click(view.getByTestId('robot-integration-prepare'));
    await waitFor(() => expect(view.getByTestId('robot-integration-packet').textContent).toContain('review_pending'));
    expect(view.getByTestId('robot-integration-packet').textContent).toContain('Drive integration plan: 18/18'); expect(view.getByTestId('robot-integration-packet').textContent).toContain('Auxiliary integration plan: 0/4'); expect(view.getByTestId('robot-integration-packet').textContent).toContain('Overall integration plan: 18/22 · blocked'); expect(view.getByTestId('robot-integration-packet').textContent).not.toContain('Overall integration plan: 22/22'); expect(view.getByTestId('robot-integration-packet').textContent).toContain('J6:motor:old / J6:reducer:old / J6:bearing:old → M / R / B'); expect(view.queryByTestId('robot-integration-apply')).toBeNull();
    fireEvent.click(view.getByTestId('robot-integration-download')); await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`robot-cad-integration-review-${'a'.repeat(64)}.json`, expect.any(Blob)));
  });

  it('shows required and available dimensions while keeping housing evaluation non-mutating', async () => {
    vi.mocked(downloadBlob).mockClear();
    const report = { schema: 'nexyfab.robot-housing-fit-evidence.v1' as const, housingSha256: 'a'.repeat(64), requirementsSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64), artifactSetSha256: 'd'.repeat(64), selectionReady: true, housingStatus: 'passed' as const, releaseReady: false as const, cadIntegrationStatus: 'not_run' as const, fits: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, status: 'passed' as const, requiredInternalMm: { x: 100, y: 100, z: 220 }, availableInternalMm: { x: 110, y: 110, z: 240 }, errors: [] })), errors: [], sideEffects: { persisted: false as const, catalogActivated: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const } };
    const evaluateHousing = vi.fn().mockResolvedValue(report); const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} evaluateHousing={evaluateHousing} />);
    const housing = new File(['{}'], 'housing.json'); const requirements = new File(['{}'], 'requirements.json'); const manifest = new File(['{}'], 'manifest.json'); const artifact = new File(['x'], 'evidence.pdf');
    fireEvent.change(view.getByTestId('robot-housing-capacities'), { target: { files: [housing] } }); fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [requirements] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [manifest] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [artifact] } }); fireEvent.click(view.getByTestId('robot-housing-fit'));
    await waitFor(() => expect(view.getByTestId('robot-housing-fit-report').textContent).toContain('Housing fit: passed'));
    expect(evaluateHousing).toHaveBeenCalledWith(housing, requirements, manifest, [artifact]); expect(view.getByTestId('robot-housing-fit-report').textContent).toContain('J6: passed · required 100×100×220 mm · available 110×110×240 mm'); expect(view.getByTestId('robot-housing-fit-report').textContent).toContain('does not modify CAD geometry');
    fireEvent.click(view.getByTestId('robot-housing-fit-download')); await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`housing-fit-${'a'.repeat(64)}-${'b'.repeat(64)}-${'c'.repeat(64)}.json`, expect.any(Blob)));
  });

  it('rejects a housing response that claims CAD side effects', async () => {
    const unsafe = { schema: 'nexyfab.robot-housing-fit-evidence.v1', housingSha256: 'a'.repeat(64), requirementsSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64), artifactSetSha256: 'd'.repeat(64), selectionReady: true, housingStatus: 'passed', releaseReady: false, cadIntegrationStatus: 'not_run', fits: [], errors: [], sideEffects: { persisted: false, catalogActivated: false, cadModified: true, quoteCreated: false, rfqSent: false } };
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} evaluateHousing={vi.fn().mockResolvedValue(unsafe)} />); const file = new File(['x'], 'x.json');
    fireEvent.change(view.getByTestId('robot-housing-capacities'), { target: { files: [file] } }); fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [file] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [file] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [file] } }); fireEvent.click(view.getByTestId('robot-housing-fit'));
    await waitFor(() => expect(view.getByTestId('robot-catalog-error').textContent).toContain('unsafe housing fit response'));
  });

  it('shows six-axis selection margins without applying CAD changes or release', async () => {
    vi.mocked(downloadBlob).mockClear();
    const selection = { schema: 'nexyfab.robot-catalog-selection.v1' as const, requirementsSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64), artifactSetSha256: 'c'.repeat(64), admissionEligible: true, selectionReady: true, selectionStatus: 'passed' as const, releaseReady: false as const, cadIntegrationStatus: 'not_run' as const, selections: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, motor: { id: 'M', model: 'M1', artifactHash: 'd'.repeat(64) }, reducer: { id: 'R', model: 'R1', artifactHash: 'd'.repeat(64) }, bearing: { id: 'B', model: 'B1', artifactHash: 'd'.repeat(64) }, margins: { torque: 2, speed: 1.5, bearingLoad: 3 }, evidence: [] })), auxiliarySelectionReady: false, auxiliarySelectionStatus: 'not_run' as const, auxiliarySelections: [], errors: [], sideEffects: { persisted: false as const, catalogActivated: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const } };
    const selectCatalog = vi.fn().mockResolvedValue(selection); const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} selectCatalog={selectCatalog} />);
    const requirements = new File(['{}'], 'requirements.json'); const manifest = new File(['{}'], 'manifest.json'); const artifactFile = new File(['x'], 'catalog.pdf');
    fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [requirements] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [manifest] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [artifactFile] } }); fireEvent.click(view.getByTestId('robot-catalog-select'));
    await waitFor(() => expect(view.getByTestId('robot-catalog-selection-report').textContent).toContain('Six-axis drive selection passed'));
    expect(view.getByTestId('robot-catalog-selection-report').textContent).toContain('Auxiliary selection: 0/4 · not_run'); expect(view.getByTestId('robot-catalog-selection-report').textContent).toContain('Overall selection: 18/22 · blocked'); expect(view.getByTestId('robot-catalog-selection-report').textContent).not.toContain('Overall selection: 22/22'); expect(view.getByTestId('robot-catalog-selection-report').textContent).toContain('J6: M1 + R1 + B1'); expect(view.getByTestId('robot-catalog-selection-report').textContent).toContain('CAD integration not_run · release false');
    fireEvent.click(view.getByTestId('robot-catalog-selection-download')); await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`catalog-selection-${'a'.repeat(64)}-${'b'.repeat(64)}.json`, expect.any(Blob)));
  });

  it('shows all four explicit auxiliary selections separately from the 18 drive occurrences', async () => {
    const mount = { parentPartId: 'base', parentAxisRef: 'axis', parentPlaneRef: 'plane', positionMm: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
    const components = [{ kind: 'brake' as const, pendingComponentId: 'brake' as const }, { kind: 'encoder' as const, pendingComponentId: 'encoder' as const }, { kind: 'harness' as const, pendingComponentId: 'internal_harness' as const }, { kind: 'tool_connector' as const, pendingComponentId: 'tool_connector' as const }];
    const selection = { schema: 'nexyfab.robot-catalog-selection.v1' as const, requirementsSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64), artifactSetSha256: 'c'.repeat(64), admissionEligible: true, selectionReady: true, selectionStatus: 'passed' as const, releaseReady: false as const, cadIntegrationStatus: 'not_run' as const, selections: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, motor: { id: 'M', model: 'M1', artifactHash: 'd'.repeat(64) }, reducer: { id: 'R', model: 'R1', artifactHash: 'd'.repeat(64) }, bearing: { id: 'B', model: 'B1', artifactHash: 'd'.repeat(64) }, margins: { torque: 2, speed: 1.5, bearingLoad: 3 }, evidence: [] })), auxiliarySelectionReady: true, auxiliarySelectionStatus: 'passed' as const, auxiliarySelections: components.map(item => ({ ...item, component: { id: item.kind.toUpperCase(), model: `${item.kind}-model`, artifactHash: 'e'.repeat(64) }, mount, evidence: [] })), errors: [], sideEffects: { persisted: false as const, catalogActivated: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const } };
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} selectCatalog={vi.fn().mockResolvedValue(selection)} />); const file = new File(['{}'], 'input.json');
    fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [file] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [file] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [file] } }); fireEvent.click(view.getByTestId('robot-catalog-select'));
    await waitFor(() => expect(view.getByTestId('robot-catalog-selection-report').textContent).toContain('Overall selection: 22/22 · passed'));
    expect(view.getByTestId('robot-catalog-selection-report').textContent).toContain('Auxiliary selection: 4/4 · passed'); expect(view.getByTestId('robot-catalog-selection-report').textContent).toContain('tool_connector: tool_connector-model · TOOL_CONNECTOR'); expect(view.getByTestId('robot-catalog-22-status').textContent).toContain('Overall applied: 0/22 · blocked'); expect(view.getByTestId('robot-catalog-release-boundary').textContent).toContain('Even with 22/22 applied and catalog unresolved at 0, release remains blocked');
  });

  it('rejects a legacy selection response that marks drive ready without auxiliary status', async () => {
    const unsafe = { schema: 'nexyfab.robot-catalog-selection.v1', requirementsSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64), artifactSetSha256: 'c'.repeat(64), admissionEligible: true, selectionReady: true, selectionStatus: 'passed', releaseReady: false, cadIntegrationStatus: 'not_run', selections: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, motor: { id: 'M', model: 'M1', artifactHash: 'd'.repeat(64) }, reducer: { id: 'R', model: 'R1', artifactHash: 'd'.repeat(64) }, bearing: { id: 'B', model: 'B1', artifactHash: 'd'.repeat(64) }, margins: { torque: 2, speed: 1.5, bearingLoad: 3 }, evidence: [] })), errors: [], sideEffects: { persisted: false, catalogActivated: false, cadModified: false, quoteCreated: false, rfqSent: false } };
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} selectCatalog={vi.fn().mockResolvedValue(unsafe)} />); const file = new File(['{}'], 'input.json');
    fireEvent.change(view.getByTestId('robot-catalog-requirements'), { target: { files: [file] } }); fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [file] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [file] } }); fireEvent.click(view.getByTestId('robot-catalog-select'));
    await waitFor(() => expect(view.getByTestId('robot-catalog-error').textContent).toContain('unsafe or incomplete catalog selection response'));
    expect(view.queryByTestId('robot-catalog-selection-report')).toBeNull();
  });

  it('validates catalog artifact bytes without activating or persisting the catalog', async () => {
    vi.mocked(downloadBlob).mockClear();
    const report = { schema: 'nexyfab.robot-component-catalog-admission.v1' as const, manifestSha256: 'b'.repeat(64), artifactSetSha256: 'c'.repeat(64), valid: true, productionEligible: true, selectionReady: false as const, selectionStatus: 'not_run' as const, componentCount: 1, artifactCount: 1, totalArtifactBytes: 8, artifacts: [{ name: 'motor.pdf', expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64), byteLength: 8, verified: true }], errors: [], sideEffects: { persisted: false as const, catalogActivated: false as const, quoteCreated: false as const, rfqSent: false as const } };
    const admitCatalog = vi.fn().mockResolvedValue(report);
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} admitCatalog={admitCatalog} />);
    const manifest = new File(['{}'], 'manifest.json'); const artifactFile = new File(['evidence'], 'motor.pdf');
    fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [manifest] } });
    fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [artifactFile] } });
    fireEvent.click(view.getByTestId('robot-catalog-admit'));
    await waitFor(() => expect(view.getByTestId('robot-catalog-report').textContent).toContain('Byte validation passed'));
    expect(admitCatalog).toHaveBeenCalledWith(manifest, [artifactFile]);
    expect(view.getByTestId('robot-catalog-report').textContent).toContain('does not activate the catalog');
    expect(view.getByTestId('robot-catalog-report').textContent).toContain('admitted catalog records, not 22 installed robot occurrences');
    expect(view.getByTestId('robot-catalog-report').textContent).toContain('Actual component selection has not run');
    fireEvent.click(view.getByTestId('robot-catalog-report-download'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`catalog-admission-${'b'.repeat(64)}.json`, expect.any(Blob)));
  });

  it('rejects a catalog admission response that claims side effects', async () => {
    const unsafe = { schema: 'nexyfab.robot-component-catalog-admission.v1', manifestSha256: 'a'.repeat(64), artifactSetSha256: 'b'.repeat(64), valid: true, productionEligible: true, selectionReady: false, selectionStatus: 'not_run', componentCount: 0, artifactCount: 0, totalArtifactBytes: 0, artifacts: [], errors: [], sideEffects: { persisted: true, catalogActivated: false, quoteCreated: false, rfqSent: false } };
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} admitCatalog={vi.fn().mockResolvedValue(unsafe)} />);
    const file = new File(['x'], 'x.json');
    fireEvent.change(view.getByTestId('robot-catalog-manifest'), { target: { files: [file] } }); fireEvent.change(view.getByTestId('robot-catalog-artifacts'), { target: { files: [file] } }); fireEvent.click(view.getByTestId('robot-catalog-admit'));
    await waitFor(() => expect(view.getByTestId('robot-catalog-error').textContent).toContain('unsafe catalog admission response'));
  });

  it('uploads a revision package, locally verifies the returned report, and downloads only a non-release report', async () => {
    vi.mocked(downloadBlob).mockClear();
    const verified = {
      reportHash: 'a'.repeat(64), programHash: 'b'.repeat(64), lineageId: 'robot-lineage', revision: 2, programArtifact: `editable-program-${'b'.repeat(64)}.json`,
      editableParts: 25, mates: 60, rankDoF: 6, allowedDoF: 6, flaggedInterferences: 1, collisionFrames: 13, motionFrames: 156, checkedMotionFrames: 156, motionConverged: true,
      motionAxes: Array.from({ length: 6 }, (_, index) => ({ mateId: `J${index + 1}`, rangeDeg: [-90, 90] as [number, number], allConverged: true, frameCount: 26, checkedFrames: 26, collisionFrameCount: index === 0 ? 13 : 0, segments: [{ direction: 'toward-min' as const, apiOk: true, allConverged: true, frameCount: 13, checkedFrames: 13, collisionFrameCount: index === 0 ? 13 : 0, firstFailureFrame: null, firstCollisionFrame: index === 0 ? 0 : null, maxPenetrationMm: index === 0 ? 2 : 0 }, { direction: 'toward-max' as const, apiOk: true, allConverged: true, frameCount: 13, checkedFrames: 13, collisionFrameCount: 0, firstFailureFrame: null, firstCollisionFrame: null, maxPenetrationMm: 0 }] })),
      catalogStatus: 'not_run', housingStatus: 'not_run', claimedReleaseReady: false, effectiveReleaseReady: false, blockers: ['motion_reverify_required'], interferenceQueue: [],
    };
    const verifyEvidence = vi.fn().mockResolvedValue(verified);
    const reverifyRevision = vi.fn().mockResolvedValue({ ok: true, releaseReady: false, quoteOrRfqSideEffects: false, report: { product: { lineageId: 'robot-lineage', revision: 2 } } });
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} verifyEvidence={verifyEvidence} reverifyRevision={reverifyRevision} />);
    const file = new File(['{}'], 'revision.json'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('{}').buffer });
    fireEvent.change(view.getByTestId('robot-revision-program'), { target: { files: [file] } });
    fireEvent.change(view.getByTestId('robot-revision-manifest'), { target: { files: [file] } });
    fireEvent.click(view.getByTestId('robot-revision-reverify'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`report-robot-lineage-r2-${'b'.repeat(64)}.json`, expect.any(Blob)));
    expect(reverifyRevision).toHaveBeenCalledWith(file, file);
    expect(verifyEvidence).toHaveBeenCalledOnce();
    expect(view.getByTestId('robot-evidence-summary').textContent).toContain('Effective release: false');
    expect(view.getByTestId('robot-motion-axes').textContent).toContain('J6 -90°..90° · 26/26 · 0 hit');
    expect(view.getByTestId('robot-motion-axes').textContent).toContain('min: ok · hit@0 / 2mm');
  });

  it('rejects a server response that claims release or side effects', async () => {
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} reverifyRevision={vi.fn().mockResolvedValue({ ok: true, releaseReady: true, quoteOrRfqSideEffects: false, report: {} })} />);
    const file = new File(['{}'], 'revision.json');
    fireEvent.change(view.getByTestId('robot-revision-program'), { target: { files: [file] } });
    fireEvent.change(view.getByTestId('robot-revision-manifest'), { target: { files: [file] } });
    fireEvent.click(view.getByTestId('robot-revision-reverify'));
    await waitFor(() => expect(view.getByTestId('robot-evidence-error').textContent).toContain('unsafe or malformed'));
  });

  it('requests and downloads a content-addressed next revision without side effects', async () => {
    vi.mocked(downloadBlob).mockClear();
    const baseline = {
      reportHash: 'a'.repeat(64), programHash: 'b'.repeat(64), lineageId: 'robot-lineage', revision: 1, programArtifact: `editable-program-${'b'.repeat(64)}.json`,
      editableParts: 1, mates: 0, rankDoF: 0, allowedDoF: 0, flaggedInterferences: 0, collisionFrames: 0, motionFrames: 1,
      catalogStatus: 'not_run', housingStatus: 'not_run', claimedReleaseReady: false, effectiveReleaseReady: false, blockers: [], interferenceQueue: [],
    };
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} verifyEvidence={vi.fn().mockResolvedValue(baseline)} />);
    const file = new File(['{}'], 'x.json'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('{}').buffer });
    fireEvent.change(view.getByTestId('robot-evidence-report'), { target: { files: [file] } });
    fireEvent.change(view.getByTestId('robot-evidence-program'), { target: { files: [file] } });
    fireEvent.click(view.getByTestId('robot-evidence-verify'));
    await waitFor(() => expect(view.getByTestId('robot-export-edited-revision')).toBeTruthy());
    const handler = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string }>).detail;
      const hash = 'c'.repeat(64);
      window.dispatchEvent(new CustomEvent('nexyfab:ai-assembly-revision-result', { detail: { requestId: request.requestId, ok: true, programBytes: new Uint8Array([1]), manifestBytes: new Uint8Array([2]), manifest: { schema: 'nexyfab.ai-assembly-revision-package.v1', lineageId: 'robot-lineage', revision: 2, baseProgramHash: 'b'.repeat(64), programHash: hash, programArtifact: `editable-program-${hash}.json`, createdAt: '2026-08-09T00:00:00.000Z', sideEffects: { sourceModified: false, quoteCreated: false, rfqSent: false } } } }));
    };
    window.addEventListener('nexyfab:ai-assembly-revision-request', handler);
    fireEvent.click(view.getByTestId('robot-export-edited-revision'));
    await waitFor(() => expect(view.getByTestId('robot-revision-export-message').textContent).toContain('r2'));
    expect(downloadBlob).toHaveBeenCalledTimes(2);
    window.removeEventListener('nexyfab:ai-assembly-revision-request', handler);
  });

  it('marks a pair resolved only after a different hash-bound revision is reverified', async () => {
    const base = {
      reportHash: 'a'.repeat(64), programHash: 'b'.repeat(64), lineageId: 'robot-lineage', revision: 1, programArtifact: `editable-program-${'b'.repeat(64)}.json`,
      editableParts: 2, mates: 1, rankDoF: 1, allowedDoF: 1, flaggedInterferences: 1,
      collisionFrames: 1, motionFrames: 1, catalogStatus: 'not_run', housingStatus: 'not_run',
      claimedReleaseReady: false, effectiveReleaseReady: false, blockers: ['precise_interferences_present'],
      interferenceQueue: [{ id: 'interference-1', pairKey: 'arm\u0000motor', partA: 'motor', partB: 'arm', penetrationMm: 12, category: 'drive-structural' as const, priority: 'high' as const, recommendedAction: 'resize_or_reselect_drive' as const }],
    };
    const revised = { ...base, reportHash: 'c'.repeat(64), programHash: 'd'.repeat(64), revision: 2, programArtifact: `editable-program-${'d'.repeat(64)}.json`, flaggedInterferences: 0, collisionFrames: 0, interferenceQueue: [] };
    const verifyEvidence = vi.fn().mockResolvedValueOnce(base).mockResolvedValueOnce(revised);
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} verifyEvidence={verifyEvidence} />);
    const selectFiles = (suffix: string) => {
      const report = new File(['{}'], `report-${suffix}.json`); const editable = new File(['{}'], `editable-${suffix}.json`);
      Object.defineProperty(report, 'arrayBuffer', { value: async () => new TextEncoder().encode('{}').buffer });
      Object.defineProperty(editable, 'arrayBuffer', { value: async () => new TextEncoder().encode('{}').buffer });
      fireEvent.change(view.getByTestId('robot-evidence-report'), { target: { files: [report] } });
      fireEvent.change(view.getByTestId('robot-evidence-program'), { target: { files: [editable] } });
    };
    selectFiles('base'); fireEvent.click(view.getByTestId('robot-evidence-verify'));
    await waitFor(() => expect(view.getByTestId('robot-interference-queue')).toBeTruthy());
    selectFiles('revised'); fireEvent.click(view.getByTestId('robot-evidence-verify'));
    await waitFor(() => expect(view.getByTestId('robot-remediation-transitions').textContent).toContain('resolved_reverified: 1'));
  });

  it('shows a locally verified evidence summary without converting it to approval', async () => {
    const verifyEvidence = vi.fn().mockResolvedValue({
      reportHash: 'a'.repeat(64), programHash: 'b'.repeat(64), lineageId: 'robot-lineage', revision: 1, programArtifact: 'editable.json',
      editableParts: 25, mates: 60, rankDoF: 6, allowedDoF: 6, flaggedInterferences: 22,
      collisionFrames: 13, motionFrames: 13, catalogStatus: 'not_run', housingStatus: 'not_run',
      claimedReleaseReady: false, effectiveReleaseReady: false, blockers: ['expert_approval_not_granted'],
      interferenceQueue: [{ id: 'interference-1', pairKey: 'arm\u0000motor', partA: 'motor', partB: 'arm', penetrationMm: 12, category: 'drive-structural', priority: 'high', recommendedAction: 'resize_or_reselect_drive' }],
    });
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} verifyEvidence={verifyEvidence} />);
    const report = new File(['{}'], 'report.json', { type: 'application/json' });
    const editable = new File(['{}'], 'editable.json', { type: 'application/json' });
    Object.defineProperty(report, 'arrayBuffer', { value: async () => new TextEncoder().encode('{}').buffer });
    Object.defineProperty(editable, 'arrayBuffer', { value: async () => new TextEncoder().encode('{}').buffer });
    fireEvent.change(view.getByTestId('robot-evidence-report'), { target: { files: [report] } });
    fireEvent.change(view.getByTestId('robot-evidence-program'), { target: { files: [editable] } });
    fireEvent.click(view.getByTestId('robot-evidence-verify'));
    await waitFor(() => expect(view.getByTestId('robot-evidence-summary').textContent).toContain('Effective release: false'));
    expect(view.getByTestId('robot-evidence-summary').textContent).toContain('Static precise interference: 22');
    expect(view.getByTestId('robot-interference-queue').textContent).toContain('motor ↔ arm');
    const focusRequest = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<{ queueItemId: string }>).detail;
      window.dispatchEvent(new CustomEvent('nexyfab:assembly-focus-result', { detail: { queueItemId: detail.queueItemId, selectedPartIds: ['motor', 'arm'], missingPartIds: [] } }));
    });
    window.addEventListener('nexyfab:assembly-focus-parts', focusRequest);
    fireEvent.click(view.getByTestId('robot-focus-interference-1'));
    await waitFor(() => expect(view.getByTestId('robot-focus-result').textContent).toContain('2 selected'));
    window.removeEventListener('nexyfab:assembly-focus-parts', focusRequest);
    expect(verifyEvidence).toHaveBeenCalledOnce();
  });

  it('keeps an editable preview separate from production release', async () => {
    const onHandoff = vi.fn();
    const generate = vi.fn().mockResolvedValue({
      ok: true, program,
      selectionRequirements: { ok: true, requirements: Array(6).fill({}) },
      catalogEvidence: { status: 'not_supplied', previewOnly: true, productionEligible: false },
      housingFit: { status: 'not_run', reason: 'traceable selection required' },
      engineering: { designOk: false, selfCollision: { count: 3 }, errors: ['collision'] },
      releaseReady: false,
      releaseBlockers: ['offline manifest required'],
    });
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={onHandoff} generate={generate} />);
    expect(view.queryByTestId('robot-handoff')).toBeNull();
    fireEvent.click(view.getByTestId('robot-generate'));
    await waitFor(() => expect(view.getByTestId('robot-gate-geometry').textContent).toContain('passed'));
    expect(view.getByTestId('robot-gate-catalog').textContent).toContain('blocked');
    expect(view.getByTestId('robot-gate-catalog').textContent).toContain('preview-only');
    expect(view.getByTestId('robot-gate-housing').textContent).toContain('not_run');
    expect(view.getByTestId('robot-gate-interference').textContent).toContain('failed');
    expect(view.getByTestId('robot-gate-release').textContent).toContain('blocked');
    fireEvent.click(view.getByTestId('robot-handoff'));
    expect(onHandoff).toHaveBeenCalledWith(program);
  });

  it('does not expose the precision handoff when generation fails', async () => {
    const view = render(<RobotPrecisionHandoffPanel lang="en" onHandoff={vi.fn()} generate={vi.fn().mockRejectedValue(new Error('invalid robot'))} />);
    fireEvent.click(view.getByTestId('robot-generate'));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('invalid robot'));
    expect(view.queryByTestId('robot-handoff')).toBeNull();
  });
});
