import { randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';

export interface SpatialCadIssueCandidate {
  candidateId: string;
  modelA: string;
  modelB: string;
  overlapMm: [number, number, number];
  severity: 'hard' | 'clearance';
  modelRevision: number;
  evidence: 'BOUNDS_PREVIEW';
  exactVerification: 'NOT_RUN';
}

export interface StoredSpatialCadIssue extends SpatialCadIssueCandidate {
  id: string;
  projectId: string;
  status: 'OPEN' | 'RESOLVED';
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export function validateSpatialCadIssueCandidate(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['invalid_issue_candidate'];
  const candidate = value as Partial<SpatialCadIssueCandidate>;
  const issues: string[] = [];
  if (!candidate.candidateId?.trim() || candidate.candidateId.length > 180) issues.push('invalid_candidate_id');
  if (!candidate.modelA?.trim() || !candidate.modelB?.trim() || candidate.modelA === candidate.modelB) issues.push('invalid_candidate_models');
  if (!Array.isArray(candidate.overlapMm) || candidate.overlapMm.length !== 3 || candidate.overlapMm.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) issues.push('invalid_candidate_overlap');
  if (candidate.severity !== 'hard' && candidate.severity !== 'clearance') issues.push('invalid_candidate_severity');
  if (!Number.isSafeInteger(candidate.modelRevision) || (candidate.modelRevision ?? -1) < 0) issues.push('invalid_model_revision');
  if (candidate.evidence !== 'BOUNDS_PREVIEW') issues.push('issue_evidence_must_be_bounds_preview');
  if (candidate.exactVerification !== 'NOT_RUN') issues.push('exact_verification_must_be_not_run');
  return issues;
}

export async function ensureSpatialCadIssueTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_spatial_cad_issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      model_a TEXT NOT NULL,
      model_b TEXT NOT NULL,
      overlap_json TEXT NOT NULL,
      severity TEXT NOT NULL,
      model_revision INTEGER NOT NULL,
      evidence TEXT NOT NULL,
      exact_verification TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(project_id, candidate_id, model_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_spatial_issue_project ON nf_spatial_cad_issues(project_id, updated_at DESC);
  `);
}

type IssueRow = {
  id: string; project_id: string; candidate_id: string; model_a: string; model_b: string;
  overlap_json: string; severity: 'hard' | 'clearance'; model_revision: number;
  evidence: 'BOUNDS_PREVIEW'; exact_verification: 'NOT_RUN'; status: 'OPEN' | 'RESOLVED';
  created_by: string; created_at: number; updated_at: number;
};

function rowToIssue(row: IssueRow): StoredSpatialCadIssue {
  return {
    id: row.id, projectId: row.project_id, candidateId: row.candidate_id,
    modelA: row.model_a, modelB: row.model_b, overlapMm: JSON.parse(row.overlap_json) as [number, number, number],
    severity: row.severity, modelRevision: row.model_revision, evidence: row.evidence,
    exactVerification: row.exact_verification, status: row.status, createdBy: row.created_by,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

export async function listSpatialCadIssues(db: DbAdapter, projectId: string): Promise<StoredSpatialCadIssue[]> {
  const rows = await db.queryAll<IssueRow>('SELECT * FROM nf_spatial_cad_issues WHERE project_id = ? ORDER BY updated_at DESC', projectId);
  return rows.map(rowToIssue);
}

export async function createSpatialCadIssue(db: DbAdapter, userId: string, projectId: string, input: SpatialCadIssueCandidate): Promise<{ ok: true; issue: StoredSpatialCadIssue } | { ok: false; code: 'INVALID_ISSUE'; issues: string[] }> {
  const issues = validateSpatialCadIssueCandidate(input);
  if (!projectId.trim()) issues.push('invalid_project_id');
  if (issues.length) return { ok: false, code: 'INVALID_ISSUE', issues: [...new Set(issues)] };
  const existing = await db.queryOne<IssueRow>('SELECT * FROM nf_spatial_cad_issues WHERE project_id = ? AND candidate_id = ? AND model_revision = ?', projectId, input.candidateId, input.modelRevision);
  if (existing) return { ok: true, issue: rowToIssue(existing) };
  const now = Date.now();
  const id = `SCI-${randomUUID()}`;
  await db.execute(
    `INSERT INTO nf_spatial_cad_issues
     (id, project_id, candidate_id, model_a, model_b, overlap_json, severity, model_revision, evidence, exact_verification, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, projectId, input.candidateId, input.modelA, input.modelB, JSON.stringify(input.overlapMm), input.severity,
    input.modelRevision, input.evidence, input.exactVerification, 'OPEN', userId, now, now,
  );
  return { ok: true, issue: { ...input, id, projectId, status: 'OPEN', createdBy: userId, createdAt: now, updatedAt: now } };
}

export async function updateSpatialCadIssueStatus(
  db: DbAdapter,
  projectId: string,
  issueId: string,
  status: 'OPEN' | 'RESOLVED',
  expectedUpdatedAt: number,
): Promise<{ ok: true; issue: StoredSpatialCadIssue } | { ok: false; code: 'ISSUE_NOT_FOUND' | 'ISSUE_CONFLICT' }> {
  const current = await db.queryOne<IssueRow>('SELECT * FROM nf_spatial_cad_issues WHERE id = ? AND project_id = ?', issueId, projectId);
  if (!current) return { ok: false, code: 'ISSUE_NOT_FOUND' };
  if (Number(current.updated_at) !== expectedUpdatedAt) return { ok: false, code: 'ISSUE_CONFLICT' };
  const updatedAt = Math.max(Date.now(), expectedUpdatedAt + 1);
  const updated = await db.execute('UPDATE nf_spatial_cad_issues SET status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND updated_at = ?', status, updatedAt, issueId, projectId, expectedUpdatedAt);
  if (updated.changes !== 1) return { ok: false, code: 'ISSUE_CONFLICT' };
  return { ok: true, issue: rowToIssue({ ...current, status, updated_at: updatedAt }) };
}
