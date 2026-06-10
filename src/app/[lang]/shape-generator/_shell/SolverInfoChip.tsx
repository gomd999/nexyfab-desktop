'use client';

// Floating solver-info badge — mirrors mockup #15's
// "entities: 8 · constraints: 14 · DOF 0 · 0.6 ms" engineering panel.
// Reads from shellBridgeStore; only visible in sketch mode.
// Phase-floating: header click collapses to a single-row pill so it
// stops occluding the bottom-left of the viewport when not needed.

import { useState } from 'react';
import { useShellBridge } from './shellBridgeStore';
import { sketchStatusColor, sketchStatusLabel } from './sketchStatusUi';
import { pickShellDict } from './shellDict';

interface SolverInfoChipProps {
  lang: string;
}

export function SolverInfoChip({ lang }: SolverInfoChipProps) {
  const d = pickShellDict(lang);
  const [collapsed, setCollapsed] = useState(false);
  const editMode = useShellBridge(s => s.editMode);
  const status = useShellBridge(s => s.sketchStatus);
  const redundantCount = useShellBridge(s => s.sketchRedundantCount);
  const dof = useShellBridge(s => s.sketchDof);
  const entities = useShellBridge(s => s.sketchEntities);
  const constraints = useShellBridge(s => s.sketchConstraints);
  const dimensions = useShellBridge(s => s.sketchDimensions);

  if (editMode !== 'sketch') return null;

  const ok = status === null ? null : status === 'ok';
  const statusLabel = sketchStatusLabel(status, dof, redundantCount, d);
  const rows: { k: string; v: string; tone?: 'ok' | 'warn' | 'error' }[] = [
    { k: d.entitiesLower, v: String(entities) },
    { k: d.constraintsShort, v: String(constraints) },
    { k: d.dimensionsLower, v: String(dimensions) },
    {
      k: 'DOF',
      v: dof !== null ? String(dof) : '—',
      tone: dof === null ? undefined : dof === 0 ? 'ok' : dof > 0 ? 'warn' : 'error',
    },
    {
      k: d.statusLower,
      v: statusLabel ?? '—',
      tone: status === null ? undefined : status === 'ok' ? 'ok' : status === 'under-defined' ? 'warn' : 'error',
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
        onClick={() => setCollapsed(v => !v)}
        title={collapsed ? 'Expand solver info' : 'Collapse solver info'}
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--nx-text-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          paddingBottom: collapsed ? 0 : 4,
          borderBottom: collapsed ? 'none' : '1px solid var(--nx-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1 }}>{d.solver}</span>
        {collapsed && (
          <span style={{
            color: sketchStatusColor(status),
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            fontSize: 9,
          }}>
            DOF {dof ?? '—'} · {ok ? 'OK' : ok === false ? 'fail' : '—'}
          </span>
        )}
        <span style={{ color: 'var(--nx-text-3)' }}>{collapsed ? '▾' : '−'}</span>
      </div>
      {!collapsed && rows.map(r => (
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
