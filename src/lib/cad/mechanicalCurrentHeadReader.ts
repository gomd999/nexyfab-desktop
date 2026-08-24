import type { DbAdapter } from '@/lib/db-adapter';
import {
  readCanonicalCadRevisionHead,
  type CanonicalCadRevisionHead,
} from './canonicalCadRevisionStore';
import {
  extractMechanicalSinglePartFeatureTree,
  type MechanicalSinglePartFeatureTreeDecision,
} from './mechanicalSinglePartFeatureTreeExtractor';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type BoundMechanicalTree = Extract<
  MechanicalSinglePartFeatureTreeDecision,
  { status: 'CANONICAL_TREE_BOUND' }
>;

export type MechanicalCurrentHeadResult =
  | {
      ok: true;
      authority: 'SERVER_CURRENT_CANONICAL_HEAD';
      release: 'HOLD';
      head: CanonicalCadRevisionHead;
      bound: BoundMechanicalTree;
    }
  | {
      ok: false;
      authority: 'SERVER_CURRENT_CANONICAL_HEAD';
      release: 'HOLD';
      code: 'INVALID_REQUEST' | 'MIGRATION_REQUIRED' | 'NOT_FOUND' | 'CORRUPT_SERVER_STATE' | 'HOLD' | 'SERVER_READ_FAILED';
      issues: readonly string[];
    };

/**
 * Read-only authority boundary. Caller-supplied revision data is never accepted:
 * the current server head is loaded first and then structurally extracted.
 */
export async function readMechanicalCurrentHead(
  db: DbAdapter,
  projectId: string,
  documentId: string,
): Promise<MechanicalCurrentHeadResult> {
  if (!SAFE_ID.test(projectId) || !SAFE_ID.test(documentId)) {
    return {
      ok: false, authority: 'SERVER_CURRENT_CANONICAL_HEAD', release: 'HOLD',
      code: 'INVALID_REQUEST', issues: ['project_or_document_id_invalid'],
    };
  }
  try {
    const current = await readCanonicalCadRevisionHead(db, projectId, documentId);
    if (!current.ok) {
      return {
        ok: false, authority: 'SERVER_CURRENT_CANONICAL_HEAD', release: 'HOLD',
        code: current.code, issues: current.issues,
      };
    }
    if (current.head.projectId !== projectId || current.head.documentId !== documentId) {
      return {
        ok: false, authority: 'SERVER_CURRENT_CANONICAL_HEAD', release: 'HOLD',
        code: 'CORRUPT_SERVER_STATE', issues: ['current_head_identity_mismatch'],
      };
    }
    const bound = extractMechanicalSinglePartFeatureTree(current.head);
    if (bound.status !== 'CANONICAL_TREE_BOUND') {
      return {
        ok: false, authority: 'SERVER_CURRENT_CANONICAL_HEAD', release: 'HOLD',
        code: 'HOLD', issues: bound.blockers,
      };
    }
    return {
      ok: true,
      authority: 'SERVER_CURRENT_CANONICAL_HEAD',
      release: 'HOLD',
      head: current.head,
      bound,
    };
  } catch {
    return {
      ok: false, authority: 'SERVER_CURRENT_CANONICAL_HEAD', release: 'HOLD',
      code: 'SERVER_READ_FAILED', issues: ['canonical_head_read_failed'],
    };
  }
}
