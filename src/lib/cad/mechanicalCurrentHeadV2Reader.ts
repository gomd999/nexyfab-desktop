import type { DbAdapter } from '@/lib/db-adapter';
import {
  readCanonicalCadRevisionHead,
  type CanonicalCadRevisionHead,
} from './canonicalCadRevisionStore';
import {
  extractMechanicalSinglePartFeatureTreeV2,
  type MechanicalSinglePartFeatureTreeV2Decision,
} from './mechanicalSinglePartFeatureTreeV2Extractor';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type BoundMechanicalTreeV2 = Extract<
  MechanicalSinglePartFeatureTreeV2Decision,
  { status: 'CANONICAL_TREE_V2_BOUND' }
>;

export type MechanicalCurrentHeadV2Result =
  | {
      ok: true;
      authority: 'SERVER_CURRENT_CANONICAL_HEAD';
      verification: 'STRUCTURAL_ONLY';
      release: 'HOLD';
      head: CanonicalCadRevisionHead;
      bound: BoundMechanicalTreeV2;
    }
  | {
      ok: false;
      authority: 'SERVER_CURRENT_CANONICAL_HEAD';
      release: 'HOLD';
      code: 'INVALID_REQUEST' | 'MIGRATION_REQUIRED' | 'NOT_FOUND' | 'CORRUPT_SERVER_STATE' | 'HOLD' | 'SERVER_READ_FAILED';
      issues: readonly string[];
    };

/**
 * Version-isolated current-head reader for the exact three-node v2 slice.
 * The caller supplies identifiers only; revision and feature data always
 * come from the server's canonical head and remain release-blocked here.
 */
export async function readMechanicalCurrentHeadV2(
  db: DbAdapter,
  projectId: string,
  documentId: string,
): Promise<MechanicalCurrentHeadV2Result> {
  if (!SAFE_ID.test(projectId) || !SAFE_ID.test(documentId)) {
    return {
      ok: false,
      authority: 'SERVER_CURRENT_CANONICAL_HEAD',
      release: 'HOLD',
      code: 'INVALID_REQUEST',
      issues: ['project_or_document_id_invalid'],
    };
  }

  try {
    const current = await readCanonicalCadRevisionHead(db, projectId, documentId);
    if (!current.ok) {
      return {
        ok: false,
        authority: 'SERVER_CURRENT_CANONICAL_HEAD',
        release: 'HOLD',
        code: current.code,
        issues: current.issues,
      };
    }
    if (current.head.projectId !== projectId || current.head.documentId !== documentId) {
      return {
        ok: false,
        authority: 'SERVER_CURRENT_CANONICAL_HEAD',
        release: 'HOLD',
        code: 'CORRUPT_SERVER_STATE',
        issues: ['current_head_identity_mismatch'],
      };
    }

    const bound = extractMechanicalSinglePartFeatureTreeV2(current.head);
    if (bound.status !== 'CANONICAL_TREE_V2_BOUND') {
      return {
        ok: false,
        authority: 'SERVER_CURRENT_CANONICAL_HEAD',
        release: 'HOLD',
        code: 'HOLD',
        issues: bound.blockers,
      };
    }
    return {
      ok: true,
      authority: 'SERVER_CURRENT_CANONICAL_HEAD',
      verification: 'STRUCTURAL_ONLY',
      release: 'HOLD',
      head: current.head,
      bound,
    };
  } catch {
    return {
      ok: false,
      authority: 'SERVER_CURRENT_CANONICAL_HEAD',
      release: 'HOLD',
      code: 'SERVER_READ_FAILED',
      issues: ['canonical_head_read_failed'],
    };
  }
}
