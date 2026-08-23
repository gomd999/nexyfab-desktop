'use client';

import type { DesignDomainId } from '@/lib/ai/domainProfile';
import type { DesignWorkMode } from '@/lib/ai/designWorkspaceRevision';
import { getWorkspaceTruthSnapshot, type StudioTruthState } from '@/lib/ai/studioTruthContract';

const TONE: Record<StudioTruthState, { color: string; background: string }> = {
  EXACT: { color: '#79d7ff', background: 'rgba(14,165,233,0.13)' },
  VERIFIED: { color: 'var(--nx-ok, #4ade80)', background: 'rgba(34,197,94,0.13)' },
  PREVIEW: { color: 'var(--nx-warn, #fbbf24)', background: 'rgba(245,158,11,0.13)' },
  APPROXIMATE: { color: 'var(--nx-warn, #fbbf24)', background: 'rgba(245,158,11,0.13)' },
  NOT_RUN: { color: 'var(--nx-text-3)', background: 'rgba(148,163,184,0.10)' },
  AUTH_REQUIRED: { color: 'var(--nx-warn, #fbbf24)', background: 'rgba(245,158,11,0.13)' },
  BLOCKED: { color: 'var(--nx-error, #f87171)', background: 'rgba(239,68,68,0.12)' },
};

function TruthChip({ label, state }: { label: string; state: StudioTruthState }) {
  const tone = TONE[state];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 9, color: tone.color, background: tone.background, fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap' }}>
      <span style={{ color: 'var(--nx-text-3)', fontWeight: 650 }}>{label}</span>
      {' '}{state}
    </span>
  );
}

export function WorkspaceTruthStrip({
  domain,
  workMode,
  dfmWarningCount,
  compact = false,
  sessionVerification,
}: {
  domain: DesignDomainId;
  workMode: DesignWorkMode;
  dfmWarningCount: number | null;
  compact?: boolean;
  sessionVerification?: StudioTruthState;
}) {
  const snapshot = getWorkspaceTruthSnapshot({ domain, workMode, dfmWarningCount, sessionVerification });
  return (
    <div
      data-testid="workspace-truth-strip"
      aria-label="Workspace capability and verification status"
      title={snapshot.note}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
    >
      <TruthChip label="CAD" state={snapshot.authoring} />
      <TruthChip label="CHECK" state={snapshot.verification} />
      {!compact && <TruthChip label="RELEASE" state={snapshot.release} />}
    </div>
  );
}
