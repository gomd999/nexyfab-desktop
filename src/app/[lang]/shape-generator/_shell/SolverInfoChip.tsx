'use client';

// Floating solver-info badge — mirrors mockup #15's
// "entities: 8 · constraints: 14 · DOF 0 · 0.6 ms" engineering panel.
// Reads from shellBridgeStore; only visible in sketch mode.

import { useShellBridge } from './shellBridgeStore';

interface SolverInfoChipProps {
  isKo: boolean;
}

export function SolverInfoChip({ isKo }: SolverInfoChipProps) {
  const editMode = useShellBridge(s => s.editMode);
  const ok = useShellBridge(s => s.sketchSolverOk);
  const dof = useShellBridge(s => s.sketchDof);
  const entities = useShellBridge(s => s.sketchEntities);
  const constraints = useShellBridge(s => s.sketchConstraints);
  const dimensions = useShellBridge(s => s.sketchDimensions);

  if (editMode !== 'sketch') return null;

  const rows: { k: string; v: string; tone?: 'ok' | 'warn' | 'error' }[] = [
    { k: isKo ? '엔티티' : 'entities', v: String(entities) },
    { k: isKo ? '구속' : 'constraints', v: String(constraints) },
    { k: isKo ? '치수' : 'dimensions', v: String(dimensions) },
    {
      k: 'DOF',
      v: dof !== null ? String(dof) : '—',
      tone: dof === 0 ? 'ok' : (dof ?? 0) > 0 ? 'warn' : 'error',
    },
    {
      k: 'solver',
      v: ok === null ? '—' : ok ? 'OK' : 'fail',
      tone: ok ? 'ok' : ok === false ? 'error' : undefined,
    },
  ];

  return (
    <div
      className="nx-floater"
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        minWidth: 180,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        pointerEvents: 'auto',
        zIndex: 5,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--nx-text-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          paddingBottom: 4,
          borderBottom: '1px solid var(--nx-border)',
        }}
      >
        {isKo ? '솔버' : 'Solver'}
      </div>
      {rows.map(r => (
        <div
          key={r.k}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            fontFamily: 'var(--font-jetbrains-mono), monospace',
          }}
        >
          <span style={{ color: 'var(--nx-text-3)' }}>{r.k}</span>
          <span
            style={{
              color:
                r.tone === 'ok'
                  ? 'var(--nx-ok)'
                  : r.tone === 'warn'
                    ? 'var(--nx-warn)'
                    : r.tone === 'error'
                      ? 'var(--nx-error)'
                      : 'var(--nx-text)',
            }}
          >
            {r.v}
          </span>
        </div>
      ))}
    </div>
  );
}
