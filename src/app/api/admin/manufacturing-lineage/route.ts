import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-guard';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import {
  evaluateCadDeliverableRelease,
  parseTrustedCadDeliverableReviewers,
  type CadDeliverableReleaseInput,
} from '@/lib/cad-deliverable-release';
import { ensureCadWorkspaceRevisionTables } from '@/lib/cad/workspaceRevisionStore';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const authorizeSchema = z.object({
  action: z.literal('authorize'),
  lineageId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  documentVersionId: z.string().min(1).max(200),
  generationRunId: z.string().min(1).max(200),
  verificationRunId: z.string().min(1).max(200),
  artifactId: z.string().min(1).max(200),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  releaseInput: z.unknown(),
});

const revokeSchema = z.object({
  action: z.literal('revoke'),
  lineageId: z.string().min(1).max(200),
  reason: z.string().min(3).max(1000),
});

const schema = z.discriminatedUnion('action', [authorizeSchema, revokeSchema]);

interface ExistingLineage {
  lineage_id: string;
  user_id: string;
  project_id: string;
  document_version_id: string;
  generation_run_id: string;
  verification_run_id: string;
  artifact_id: string;
  artifact_sha256: string;
  release_status: string;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  let input: unknown;
  try { input = await readBoundedJson(req, 2 * 1024 * 1024); }
  catch (error) {
    if (boundedJsonError(error)?.status === 413) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    input = null;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  if (parsed.data.action === 'revoke') {
    const result = await db.execute(
      `UPDATE nf_manufacturing_lineage
          SET release_status = 'revoked', invalidated_at = ?, invalidation_reason = ?, updated_at = ?
        WHERE lineage_id = ? AND release_status <> 'revoked'`,
      now, parsed.data.reason, now, parsed.data.lineageId,
    );
    if (!result.changes) return NextResponse.json({ error: 'Lineage not found or already revoked' }, { status: 404 });
    await logAudit({
      userId: guard.user.userId,
      action: 'manufacturing_lineage.revoke',
      resourceId: parsed.data.lineageId,
      metadata: { reason: parsed.data.reason },
      ip: getTrustedClientIpOrUndefined(req.headers),
    });
    return NextResponse.json({ ok: true, lineageId: parsed.data.lineageId, releaseStatus: 'revoked' });
  }

  const data = parsed.data;
  await ensureCadWorkspaceRevisionTables(db);
  const revision = await db.queryOne<{ id: string; project_id: string; content_hash: string; created_by: string }>(
    'SELECT id, project_id, content_hash, created_by FROM nf_cad_workspace_revisions WHERE id = ?',
    data.documentVersionId,
  );
  if (!revision || revision.project_id !== data.projectId) {
    return NextResponse.json({ error: 'CAD workspace revision not found', code: 'LINEAGE_REVISION_NOT_FOUND' }, { status: 409 });
  }
  const project = await db.queryOne<{ user_id: string }>('SELECT user_id FROM nf_projects WHERE id = ?', data.projectId);
  if (!project || project.user_id !== data.userId) {
    return NextResponse.json({ error: 'CAD revision owner mismatch', code: 'LINEAGE_REVISION_OWNER_MISMATCH' }, { status: 409 });
  }
  const releaseInput = data.releaseInput as CadDeliverableReleaseInput;
  if (!releaseInput || typeof releaseInput !== 'object'
    || releaseInput.schema !== 'nexyfab.cad-deliverable-release-input.v2'
    || !Array.isArray(releaseInput.roundtrips)) {
    return NextResponse.json({ error: 'Complete releaseInput v2 is required', code: 'LINEAGE_RELEASE_EVIDENCE_INVALID' }, { status: 409 });
  }
  const releaseDecision = evaluateCadDeliverableRelease(
    releaseInput,
    parseTrustedCadDeliverableReviewers(process.env.NEXYFAB_CAD_REVIEWER_KEYS),
  );
  const stepReceipt = Array.isArray(releaseInput?.roundtrips)
    ? releaseInput.roundtrips.find(receipt => receipt.kind === 'step')
    : undefined;
  if (releaseInput?.schema !== 'nexyfab.cad-deliverable-release-input.v2'
    || releaseInput.domain !== 'mechanical'
    || releaseInput.revisionId !== data.documentVersionId
    || releaseInput.revisionSha256 !== revision.content_hash
    || releaseInput.purpose !== 'manufacturing_or_construction'
    || releaseDecision.status !== 'pass'
    || stepReceipt?.exportedArtifactSha256 !== data.artifactSha256) {
    return NextResponse.json({
      error: 'Mechanical manufacturing release evidence is incomplete or mismatched.',
      code: 'LINEAGE_RELEASE_EVIDENCE_INVALID',
      blockers: releaseDecision.blockers,
    }, { status: 409 });
  }
  const existing = await db.queryOne<ExistingLineage>(
    'SELECT * FROM nf_manufacturing_lineage WHERE lineage_id = ? OR artifact_id = ? LIMIT 1',
    data.lineageId, data.artifactId,
  );
  if (existing) {
    const immutableMatch = existing.lineage_id === data.lineageId
      && existing.user_id === data.userId
      && existing.project_id === data.projectId
      && existing.document_version_id === data.documentVersionId
      && existing.generation_run_id === data.generationRunId
      && existing.verification_run_id === data.verificationRunId
      && existing.artifact_id === data.artifactId
      && existing.artifact_sha256 === data.artifactSha256;
    if (!immutableMatch) {
      return NextResponse.json(
        { error: '기존 lineage 또는 artifact와 불변 식별자가 충돌합니다.', code: 'LINEAGE_IMMUTABLE_CONFLICT' },
        { status: 409 },
      );
    }
    if (existing.release_status === 'revoked') {
      return NextResponse.json(
        { error: '취소된 lineage는 재승인할 수 없습니다. 새 문서 버전과 lineage를 생성하세요.', code: 'REVOKED_LINEAGE_REAUTH_FORBIDDEN' },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, lineageId: data.lineageId, releaseStatus: existing.release_status, idempotent: true });
  }

  await db.execute(
    `INSERT INTO nf_manufacturing_lineage
      (lineage_id, user_id, project_id, document_version_id, generation_run_id,
       verification_run_id, artifact_id, artifact_sha256, release_status,
       authorized_at, authorized_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'authorized', ?, ?, ?, ?)`,
    data.lineageId, data.userId, data.projectId, data.documentVersionId,
    data.generationRunId, data.verificationRunId, data.artifactId, data.artifactSha256,
    now, guard.user.userId, now, now,
  );
  await logAudit({
    userId: guard.user.userId,
    action: 'manufacturing_lineage.authorize',
    resourceId: data.lineageId,
    metadata: {
      ownerUserId: data.userId,
      artifactId: data.artifactId,
      artifactSha256: data.artifactSha256,
      documentVersionId: data.documentVersionId,
      generationRunId: data.generationRunId,
      verificationRunId: data.verificationRunId,
      releaseRoundtripEvidenceSha256: releaseDecision.roundtripEvidenceSha256,
      releaseReviewerIds: releaseDecision.validReviewerIds,
    },
    ip: getTrustedClientIpOrUndefined(req.headers),
  });
  return NextResponse.json({ ok: true, lineageId: data.lineageId, releaseStatus: 'authorized' }, { status: 201 });
}
