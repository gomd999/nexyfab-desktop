import type { DesignDomainId } from './domainProfile';
import type { DesignWorkMode } from './designWorkspaceRevision';

/**
 * A capability boundary and a result from the current design session are
 * deliberately different things. For example, an exact kernel may be
 * available while interference checking for the open model is still NOT_RUN.
 */
export type StudioCapabilitySupport = 'verified' | 'preview' | 'approximate' | 'unsupported';
export type StudioCapabilityFidelity = 'exact' | 'semantic' | 'approximate' | 'concept';
export type StudioTruthState = 'EXACT' | 'PREVIEW' | 'APPROXIMATE' | 'NOT_RUN' | 'AUTH_REQUIRED' | 'BLOCKED' | 'VERIFIED';

export interface StudioAuthoringCapability {
  domain: DesignDomainId;
  support: StudioCapabilitySupport;
  fidelity: StudioCapabilityFidelity;
  releaseClaimAllowed: boolean;
  note: string;
}

export const STUDIO_AUTHORING_CAPABILITIES = {
  mechanical: {
    domain: 'mechanical',
    support: 'verified',
    fidelity: 'exact',
    releaseClaimAllowed: false,
    note: 'Parametric feature-tree and exact-kernel paths are available. A model still needs per-session verification evidence.',
  },
  building: {
    domain: 'building',
    support: 'preview',
    fidelity: 'semantic',
    releaseClaimAllowed: false,
    note: 'Semantic building documents and validators exist, but the complete production authoring surface is not release-evidenced.',
  },
  civil: {
    domain: 'civil',
    support: 'preview',
    fidelity: 'semantic',
    releaseClaimAllowed: false,
    note: 'Civil document contracts are available; corridor, CRS and terrain depth remain preview-gated.',
  },
  landscape: {
    domain: 'landscape',
    support: 'preview',
    fidelity: 'semantic',
    releaseClaimAllowed: false,
    note: 'Landscape semantic authoring is preview-only until terrain, irrigation and schedule evidence is complete.',
  },
  interior: {
    domain: 'interior',
    support: 'preview',
    fidelity: 'semantic',
    releaseClaimAllowed: false,
    note: 'Interior semantic authoring is preview-only until field, clearance, ceiling/MEP and drawing evidence is complete.',
  },
} as const satisfies Record<DesignDomainId, StudioAuthoringCapability>;

export interface WorkspaceTruthSnapshot {
  authoring: StudioTruthState;
  verification: StudioTruthState;
  release: StudioTruthState;
  releaseReady: false;
  note: string;
}

export interface WorkspaceTruthInput {
  domain: DesignDomainId;
  workMode: DesignWorkMode;
  /** null means no DFM result exists for the open revision. */
  dfmWarningCount?: number | null;
  /** External exact workers may require a user or service credential. */
  exactWorkerAuthorization?: 'not_required' | 'authorized' | 'required';
  /** Result state for the open revision. Spatial calculators may report
   * PREVIEW, but must not promote concept geometry to VERIFIED. */
  sessionVerification?: StudioTruthState;
}

/**
 * Returns UI-safe truth labels. It never upgrades a static capability into a
 * current-session VERIFIED result and never marks a workspace release-ready.
 */
export function getWorkspaceTruthSnapshot(input: WorkspaceTruthInput): WorkspaceTruthSnapshot {
  const capability: StudioAuthoringCapability = STUDIO_AUTHORING_CAPABILITIES[input.domain];
  const authoring: StudioTruthState = input.workMode !== 'precision_cad'
    ? 'PREVIEW'
    : capability.support === 'verified' && capability.fidelity === 'exact'
      ? 'EXACT'
      : capability.support === 'approximate' || capability.fidelity === 'approximate'
        ? 'APPROXIMATE'
        : 'PREVIEW';

  const verification: StudioTruthState = input.exactWorkerAuthorization === 'required'
    ? 'AUTH_REQUIRED'
    : input.sessionVerification ?? (input.domain !== 'mechanical' || input.dfmWarningCount === null || input.dfmWarningCount === undefined
      ? 'NOT_RUN'
      : input.dfmWarningCount > 0
        ? 'BLOCKED'
        : 'VERIFIED');

  return {
    authoring,
    verification,
    release: 'BLOCKED',
    releaseReady: false,
    note: capability.note,
  };
}
