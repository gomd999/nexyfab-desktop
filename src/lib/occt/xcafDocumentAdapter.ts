import type { CanonicalCadDomain, CanonicalCadDocumentV2ConsumerDraft, CanonicalCadCoordinateFrame, CanonicalCadTolerancePolicy } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { buildXcafCanonicalBinding, validateXcafInspection, type XcafCanonicalBinding, type XcafInspectionResult } from './xcafCanonicalBinding';

export const XCAF_DOCUMENT_ADAPTER_SCHEMA = 'nexyfab.precision-cad.xcaf-document-adapter-consumer-draft.v1' as const;

export interface XcafDocumentAdapterInput {
  projectId: string;
  documentId: string;
  namespace: CanonicalCadDomain;
  revisionId: string;
  sequence: number;
  sourceFormat?: 'STEP' | 'IGES' | string;
  tolerancePolicy?: CanonicalCadTolerancePolicy;
  coordinateFrame?: CanonicalCadCoordinateFrame;
  inspection: unknown;
}

export interface XcafDocumentAdapterSuccess {
  ok: true;
  schema: typeof XCAF_DOCUMENT_ADAPTER_SCHEMA;
  status: 'CONSUMER_DRAFT';
  authority: 'CONSUMER_DRAFT';
  verification: 'NOT_RUN';
  release: 'HOLD';
  binding: XcafCanonicalBinding;
  document: CanonicalCadDocumentV2ConsumerDraft;
  issues: [];
}

export interface XcafDocumentAdapterFailure {
  ok: false;
  schema: typeof XCAF_DOCUMENT_ADAPTER_SCHEMA;
  status: 'HOLD';
  authority: 'CONSUMER_DRAFT';
  verification: 'NOT_RUN';
  release: 'HOLD';
  binding: null;
  document: null;
  issues: string[];
}

export type XcafDocumentAdapterResult = XcafDocumentAdapterSuccess | XcafDocumentAdapterFailure;

function failure(issues: string[]): XcafDocumentAdapterFailure {
  return { ok: false, schema: XCAF_DOCUMENT_ADAPTER_SCHEMA, status: 'HOLD', authority: 'CONSUMER_DRAFT', verification: 'NOT_RUN', release: 'HOLD', binding: null, document: null, issues: [...new Set(issues)] };
}

export function adaptXcafInspectionToCanonicalDraft(input: XcafDocumentAdapterInput): XcafDocumentAdapterResult {
  try {
    if (input.sourceFormat !== undefined && input.sourceFormat !== 'STEP') {
      return failure([input.sourceFormat === 'IGES' ? 'format_unsupported:IGES' : 'format_unsupported']);
    }
    const inspection = input.inspection as XcafInspectionResult;
    const issues = validateXcafInspection(inspection);
    if (issues.length) return failure(issues);
    const result = buildXcafCanonicalBinding({ ...input, inspection });
    return {
      ok: true,
      schema: XCAF_DOCUMENT_ADAPTER_SCHEMA,
      status: 'CONSUMER_DRAFT',
      authority: 'CONSUMER_DRAFT',
      verification: 'NOT_RUN',
      release: 'HOLD',
      binding: result.binding,
      document: result.document,
      issues: [],
    };
  } catch (error) {
    return failure([error instanceof Error ? error.message : 'xcaf_adapter_failed']);
  }
}
