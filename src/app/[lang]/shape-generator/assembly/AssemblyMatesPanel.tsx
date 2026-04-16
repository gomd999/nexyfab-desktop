'use client';

import React, { useState, useCallback } from 'react';
import {
  solveAssembly,
  calculateDOF,
  type AssemblyState,
  type Mate,
  type MateType,
} from './matesSolver';

// ─── i18n labels ──────────────────────────────────────────────────────────────

const MATE_ICONS: Record<MateType, string> = {
  coincident:    '\u2295', // ⊕
  concentric:    '\u25CE', // ◎
  parallel:      '\u2AF6', // ⫶
  perpendicular: '\u22BE', // ⊾
  distance:      '\u2194', // ↔
  angle:         '\u2220', // ∠
  tangent:       '\u2312', // ⌒
  fixed:         '\uD83D\uDD12', // 🔒
};

const MATE_LABELS_EN: Record<MateType, string> = {
  coincident:    'Coincident',
  concentric:    'Concentric',
  parallel:      'Parallel',
  perpendicular: 'Perpendicular',
  distance:      'Distance',
  angle:         'Angle',
  tangent:       'Tangent',
  fixed:         'Fixed',
};

const MATE_LABELS_KO: Record<MateType, string> = {
  coincident:    '\uC77C\uCE58',    // 일치
  concentric:    '\uB3D9\uC2EC',    // 동심
  parallel:      '\ud3c9\ud589',    // 평행
  perpendicular: '\uc218\uc9c1',    // 수직
  distance:      '\uAC70\uB9AC',    // 거리
  angle:         '\uAC01\uB3C4',    // 각도
  tangent:       '\uc811\uc120',    // 접선
  fixed:         '\uACE0\uC815',    // 고정
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Theme {
  panelBg: string;
  border: string;
  text: string;
  textMuted: string;
  cardBg: string;
  accent: string;
  accentBright: string;
}

interface Props {
  theme: Theme;
  lang: string;
  assemblyState: AssemblyState;
  onAssemblyUpdate: (state: AssemblyState) => void;
}

type SolveResult = ReturnType<typeof solveAssembly>;

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssemblyMatesPanel({
  theme,
  lang,
  assemblyState,
  onAssemblyUpdate,
}: Props) {
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [solving, setSolving] = useState(false);

  const isKo = lang === 'ko';
  const labels = isKo ? MATE_LABELS_KO : MATE_LABELS_EN;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSolve = useCallback(async () => {
    setSolving(true);
    // Yield to allow the UI to repaint with "Solving..." before the
    // synchronous solver blocks the thread.
    await new Promise<void>(resolve => setTimeout(resolve, 10));

    const result = solveAssembly(assemblyState);
    setSolveResult(result);

    // Push updated positions/rotations back to the parent
    const updated: AssemblyState = {
      ...assemblyState,
      bodies: assemblyState.bodies.map((b, i) => ({
        ...b,
        position: result.bodies[i].position,
        rotation: result.bodies[i].rotation,
      })),
      // Mark conflicting mates so the list can highlight them
      mates: assemblyState.mates.map(m => ({
        ...m,
        conflict: result.conflicts.includes(m.id),
      })),
    };
    onAssemblyUpdate(updated);
    setSolving(false);
  }, [assemblyState, onAssemblyUpdate]);

  const toggleMate = useCallback((id: string) => {
    onAssemblyUpdate({
      ...assemblyState,
      mates: assemblyState.mates.map(m =>
        m.id === id ? { ...m, enabled: !m.enabled } : m,
      ),
    });
  }, [assemblyState, onAssemblyUpdate]);

  const deleteMate = useCallback((id: string) => {
    onAssemblyUpdate({
      ...assemblyState,
      mates: assemblyState.mates.filter(m => m.id !== id),
    });
  }, [assemblyState, onAssemblyUpdate]);

  // ── Derived values ────────────────────────────────────────────────────────

  const dof = calculateDOF(assemblyState);

  const dofColor =
    dof === 0 ? '#3fb950' :   // fully constrained — green
    dof >  0 ? '#e3b341' :    // under-constrained — yellow
               '#f85149';     // over-constrained  — red (dof < 0 shouldn't happen; shown as 0)

  const dofBg =
    dof === 0 ? '#16a34a22' :
    dof >  0 ? '#d2992222' :
               '#f8514922';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
          {isKo ? '\uC5B4\uC148\uBE14\uB9AC \uAD6C\uC18D' : 'Assembly Mates'}
        </div>
        <div style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 10,
          background: dofBg,
          color: dofColor,
          fontWeight: 700,
        }}>
          DOF: {dof}
        </div>
      </div>

      {/* Parts list */}
      {assemblyState.bodies.length > 0 && (
        <div style={{ background: theme.cardBg, borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 10, color: theme.textMuted, marginBottom: 4 }}>
            {isKo ? '\uD30C\uD2B8' : 'Parts'} ({assemblyState.bodies.length})
          </div>
          {assemblyState.bodies.map((body, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
              <span style={{ fontSize: 11, color: body.fixed ? '#e3b341' : theme.text }}>
                {body.fixed ? '\uD83D\uDD12' : '\u25CB'} {body.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Mates list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {assemblyState.mates.length === 0 ? (
          <div style={{
            fontSize: 11,
            color: theme.textMuted,
            textAlign: 'center',
            padding: 12,
            border: `1px dashed ${theme.border}`,
            borderRadius: 6,
          }}>
            {isKo
              ? '\uAD6C\uC18D \uC5C6\uC74C \u2014 \uBDF0\uD3EC\uD2B8\uC5D0\uC11C \uBA74\uC744 \uC120\uD0DD\uD558\uC138\uC694'
              : 'No mates \u2014 select faces in viewport'}
          </div>
        ) : (
          assemblyState.mates.map(mate => {
            const isUnsatisfied = solveResult?.unsatisfied.includes(mate.id);
            const isConflict = mate.conflict || solveResult?.conflicts.includes(mate.id);
            const borderColor = isConflict
              ? '#f85149'
              : isUnsatisfied
                ? '#e3b341'
                : theme.border;

            return (
              <div
                key={mate.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  background: theme.cardBg,
                  borderRadius: 6,
                  border: `1px solid ${borderColor}`,
                  opacity: mate.enabled ? 1 : 0.45,
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}
              >
                <span style={{ fontSize: 14, flexShrink: 0 }}>{MATE_ICONS[mate.type]}</span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.text }}>
                    {labels[mate.type]}
                    {mate.distance !== undefined && ` (${mate.distance}\u202Fmm)`}
                    {mate.angle    !== undefined && ` (${mate.angle}\u00B0)`}
                  </div>
                  <div style={{ fontSize: 10, color: theme.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isKo ? '\uD30C\uD2B8' : 'Part'}&nbsp;{mate.selections[0].bodyIndex + 1}
                    &nbsp;\u2194&nbsp;
                    {isKo ? '\uD30C\uD2B8' : 'Part'}&nbsp;{mate.selections[1].bodyIndex + 1}
                  </div>
                </div>

                {isConflict && (
                  <span style={{ fontSize: 10, color: '#f85149', flexShrink: 0 }} title="Conflict">
                    &#x26A0;
                  </span>
                )}

                <button
                  onClick={() => toggleMate(mate.id)}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${theme.border}`,
                    background: 'transparent',
                    color: theme.textMuted,
                    fontSize: 10,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {mate.enabled
                    ? (isKo ? '\uB044\uAE30' : 'Off')
                    : (isKo ? '\ucf1c\uae30' : 'On')}
                </button>

                <button
                  onClick={() => deleteMate(mate.id)}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#f8514922',
                    color: '#f85149',
                    fontSize: 10,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  &#x2715;
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Solve button */}
      <button
        onClick={handleSolve}
        disabled={solving || assemblyState.mates.length === 0}
        style={{
          padding: '8px 14px',
          borderRadius: 6,
          border: 'none',
          background: theme.accent,
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          cursor: assemblyState.mates.length === 0 ? 'not-allowed' : 'pointer',
          opacity: assemblyState.mates.length === 0 ? 0.4 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {solving
          ? (isKo ? '\uACC4\uC0B0 \uC911...' : 'Solving...')
          : (isKo ? '\uAD6C\uC18D \uACC4\uC0B0' : 'Solve Mates')}
      </button>

      {/* Solve result card */}
      {solveResult && (
        <div style={{
          background: theme.cardBg,
          borderRadius: 6,
          padding: 10,
          fontSize: 11,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          {/* Status */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: theme.textMuted }}>
              {isKo ? '\uC0C1\uD0DC' : 'Status'}
            </span>
            <span style={{
              color: solveResult.converged ? '#3fb950' : '#e3b341',
              fontWeight: 700,
            }}>
              {solveResult.converged
                ? (isKo ? '\uC218\uB834 \u2713' : 'Converged \u2713')
                : (isKo ? '\uC218\uB834 \uC2E4\uD328 \u26A0' : 'Not Converged \u26A0')}
            </span>
          </div>

          {/* Iterations */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: theme.textMuted }}>
              {isKo ? '\uBC18\uBCF5 \uD69F\uC218' : 'Iterations'}
            </span>
            <span style={{ color: theme.text }}>{solveResult.iterations}</span>
          </div>

          {/* Remaining DOF */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: theme.textMuted }}>
              {isKo ? '\uC794\uC5EC \uC790\uC720\uB3C4' : 'Remaining DOF'}
            </span>
            <span style={{ color: theme.text }}>{solveResult.remainingDOF}</span>
          </div>

          {/* Unsatisfied warning */}
          {solveResult.unsatisfied.length > 0 && (
            <div style={{ marginTop: 4, color: '#e3b341', fontSize: 10 }}>
              &#x26A0;&nbsp;{solveResult.unsatisfied.length}&nbsp;
              {isKo ? '\uAD6C\uC18D \uBBF8\uCDA9\uC871' : 'unsatisfied mate(s)'}
            </div>
          )}

          {/* Conflict warning */}
          {solveResult.conflicts.length > 0 && (
            <div style={{ color: '#f85149', fontSize: 10 }}>
              &#x2715;&nbsp;{solveResult.conflicts.length}&nbsp;
              {isKo ? '\uCDA9\uB3CC \uAD6C\uC18D' : 'conflicting mate(s)'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
