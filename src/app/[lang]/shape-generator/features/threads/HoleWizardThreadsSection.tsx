'use client';

/**
 * HoleWizardThreadsSection — Wave 2 Phase 2 Track D6 (W6).
 *
 * Self-contained threads sub-section embedded in the Size tab of
 * `HoleWizardModalV2`. Lives in its own file so the C6 i18n full pass
 * (running in parallel) doesn't need to merge through this UI surface.
 *
 * HoleWizardModalV2 imports + mounts this component inside a clearly-marked
 * boundary block:
 *
 *     // === D6 THREADS BOUNDARY START ===
 *     {(holeType === 'tap' || holeType === 'pipeTap') && (
 *       <HoleWizardThreadsSection ... />
 *     )}
 *     // === D6 THREADS BOUNDARY END ===
 *
 * That single touchpoint is the entire modification to HoleWizardModalV2.tsx.
 *
 * Section visible only when `holeType === 'tap' | 'pipeTap'` (the two
 * threaded hole types). Provides:
 *
 *   - Thread series picker (4 main groups: ISO M / UTS / NPT / BSP) with
 *     sub-tabs for fine variants.
 *   - Designation picker (filtered by selected series, from threadCatalog).
 *   - Tolerance class picker (series-dependent, sourced from row.classCandidates).
 *   - Length input + start-offset input (mm).
 *   - Direction toggle (right_hand / left_hand).
 *   - Mode badge (cosmetic = clickable, geometric = grayed-out + W7 hint).
 *
 * On change the component invokes `onChange(currentThreadSpec)` so the host
 * (HoleWizardModalV2 or StandaloneThreadModal) can commit the resolved spec
 * to its own state.
 *
 * Spec: §10.1 (hole-wizard threads section), §10.5 (i18n).
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  THREAD_CATALOG,
  allRowsInSeries,
  findThreadRow,
  defaultThreadClass,
  type ThreadSeries,
  type ThreadStandardRow,
} from './threadCatalog';
import type {
  ThreadDirection,
  ThreadKind,
  ThreadMode,
} from './threadFeature';
import {
  pickThreadsDict,
  seriesLabel,
  type ThreadsDict,
} from './i18n';

// ─── Series-group taxonomy ─────────────────────────────────────────────────

/**
 * Four user-facing groups per spec §10.1. The picker shows these as the
 * top-level tabs; inside ISO M and UTS a sub-tab toggles the fine variant.
 */
type SeriesGroup = 'ISO_M' | 'UTS' | 'NPT' | 'BSP';

const SERIES_BY_GROUP: Record<SeriesGroup, readonly ThreadSeries[]> = {
  ISO_M: ['ISO_M_COARSE', 'ISO_M_FINE'],
  UTS: ['UNC', 'UNF'],
  NPT: ['NPT'],
  BSP: ['BSP_PARALLEL', 'BSP_TAPERED'],
};

function groupForSeries(series: ThreadSeries): SeriesGroup {
  for (const g of Object.keys(SERIES_BY_GROUP) as SeriesGroup[]) {
    if (SERIES_BY_GROUP[g].includes(series)) return g;
  }
  return 'ISO_M';
}

// ─── Section state shape ───────────────────────────────────────────────────

/**
 * The composite spec the section publishes via `onChange`. Mirrors the
 * subset of `ThreadFeature` fields the host needs to construct the feature
 * — `id` / `parentFeatureId` / `featureType` are stamped by the host.
 */
export interface ThreadsSectionSpec {
  series: ThreadSeries;
  designation: string;
  class: string;
  threadKind: ThreadKind;
  threadDirection: ThreadDirection;
  mode: ThreadMode;
  length: number;
  startOffset: number;
}

// ─── Public props ──────────────────────────────────────────────────────────

export interface HoleWizardThreadsSectionProps {
  /** Initial state for the picker. Optional — defaults to M8 / 6H / cosmetic. */
  initialSpec?: Partial<ThreadsSectionSpec>;
  /** Active language code. Mirrors HoleWizardModalV2's lang prop. */
  lang: string;
  /** Fires whenever the user changes any field. */
  onChange?: (spec: ThreadsSectionSpec) => void;
  /**
   * When true, hide the kind toggle (internal-vs-external). Used inside the
   * hole-wizard where the type is always 'internal' (tapped hole). The
   * standalone modal exposes it.
   */
  hideKindToggle?: boolean;
}

// ─── Defaults ──────────────────────────────────────────────────────────────

const FALLBACK_DEFAULT: ThreadsSectionSpec = {
  series: 'ISO_M_COARSE',
  designation: 'M8',
  class: '6H',
  threadKind: 'internal',
  threadDirection: 'right_hand',
  mode: 'cosmetic',
  length: 20,
  startOffset: 0,
};

function resolveInitialSpec(
  initial: Partial<ThreadsSectionSpec> | undefined,
): ThreadsSectionSpec {
  const series = initial?.series ?? FALLBACK_DEFAULT.series;
  const rows = allRowsInSeries(series);
  // Prefer the canonical default designation (e.g. M8 for ISO_M_COARSE) when
  // it exists in the catalog; otherwise fall through to the first row.
  // ISO_M_COARSE was augmented in D5 (M2 / M2.5 / M7) and the row order can't
  // be relied on for "sensible UI default".
  const hasFallbackDesignation = rows.some(
    r => r.designation === FALLBACK_DEFAULT.designation,
  );
  const firstRow =
    (hasFallbackDesignation
      ? FALLBACK_DEFAULT.designation
      : rows[0]?.designation) ?? FALLBACK_DEFAULT.designation;
  const designation = initial?.designation ?? firstRow;
  const row = findThreadRow(series, designation);
  const candidates = row?.classCandidates ?? [defaultThreadClass(series)];
  const cls =
    initial?.class && candidates.includes(initial.class)
      ? initial.class
      : defaultThreadClass(series);

  return {
    series,
    designation,
    class: cls,
    threadKind: initial?.threadKind ?? FALLBACK_DEFAULT.threadKind,
    threadDirection: initial?.threadDirection ?? FALLBACK_DEFAULT.threadDirection,
    mode: initial?.mode ?? FALLBACK_DEFAULT.mode,
    length:
      initial?.length !== undefined && Number.isFinite(initial.length)
        ? initial.length
        : FALLBACK_DEFAULT.length,
    startOffset:
      initial?.startOffset !== undefined && Number.isFinite(initial.startOffset)
        ? initial.startOffset
        : FALLBACK_DEFAULT.startOffset,
  };
}

// ─── Styling helpers (kept inline to match HoleWizardModalV2 idiom) ────────

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 10px',
  background: active ? '#0ea5e9' : 'var(--nx-border-strong)',
  color: active ? '#fff' : 'var(--nx-panel-2)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
});

const tileBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 4px',
  background: active ? '#0ea5e9' : 'var(--nx-border-strong)',
  color: active ? '#fff' : 'var(--nx-panel-2)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
});

const inputStyle: React.CSSProperties = {
  padding: '4px 6px',
  background: 'var(--nx-bg)',
  border: '1px solid var(--nx-border-strong)',
  borderRadius: 4,
  color: 'var(--nx-text)',
  fontSize: 12,
  width: '100%',
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function HoleWizardThreadsSection({
  initialSpec,
  lang,
  onChange,
  hideKindToggle,
}: HoleWizardThreadsSectionProps): React.ReactElement {
  const dict: ThreadsDict = pickThreadsDict(lang);

  const [spec, setSpec] = useState<ThreadsSectionSpec>(() => resolveInitialSpec(initialSpec));

  // Publish every change. We do this in an effect so consumers see the
  // post-render value (matches React's "controlled by parent" idiom even
  // though we own the state here).
  useEffect(() => {
    onChange?.(spec);
  }, [spec, onChange]);

  // Current series group derived from the active series.
  const activeGroup: SeriesGroup = useMemo(() => groupForSeries(spec.series), [spec.series]);

  const rows: readonly ThreadStandardRow[] = useMemo(
    () => allRowsInSeries(spec.series),
    [spec.series],
  );

  const selectedRow: ThreadStandardRow | null = useMemo(
    () => findThreadRow(spec.series, spec.designation),
    [spec.series, spec.designation],
  );

  /** Switch to a new series — auto-snap designation to first row, class to default. */
  function switchSeries(next: ThreadSeries): void {
    const r = allRowsInSeries(next);
    const first = r[0];
    if (!first) return;
    setSpec((s) => ({
      ...s,
      series: next,
      designation: first.designation,
      class: defaultThreadClass(next),
    }));
  }

  /** Switch group — pick the first series in the group. */
  function switchGroup(group: SeriesGroup): void {
    const list = SERIES_BY_GROUP[group];
    const next = list[0];
    if (next) switchSeries(next);
  }

  function setDesignation(designation: string): void {
    const row = findThreadRow(spec.series, designation);
    if (!row) return;
    setSpec((s) => ({
      ...s,
      designation,
      class: row.classCandidates.includes(s.class)
        ? s.class
        : defaultThreadClass(s.series),
    }));
  }

  function setClass(next: string): void {
    setSpec((s) => ({ ...s, class: next }));
  }

  function setDirection(next: ThreadDirection): void {
    setSpec((s) => ({ ...s, threadDirection: next }));
  }

  function setKind(next: ThreadKind): void {
    setSpec((s) => ({ ...s, threadKind: next }));
  }

  function setMode(next: ThreadMode): void {
    // W7 (D7) enables both modes — geometric builds real V-thread mesh via
    // `applyThreadGeometric`. The picker no longer disables geometric.
    setSpec((s) => ({ ...s, mode: next }));
  }

  function setLength(raw: string): void {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) return;
    setSpec((s) => ({ ...s, length: n }));
  }

  function setStartOffset(raw: string): void {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) return;
    setSpec((s) => ({ ...s, startOffset: n }));
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const allGroups: SeriesGroup[] = ['ISO_M', 'UTS', 'NPT', 'BSP'];

  return (
    <div
      data-testid="hole-wizard-threads-section"
      style={{
        marginTop: 16,
        padding: 10,
        background: 'var(--nx-panel-2)',
        border: '1px solid var(--nx-border-strong)',
        borderRadius: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 12, color: 'var(--nx-text-1)' }}>
          {dict.sectionTitle}
        </strong>
        <span
          data-testid="hole-wizard-threads-mode-badge"
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
            // D7: geometric mode is now active — pick a distinct accent so the
            // user can see at a glance which path the wizard is on.
            background: spec.mode === 'cosmetic' ? '#10b981' : '#8b5cf6',
            color: '#fff',
          }}
        >
          {spec.mode === 'cosmetic' ? dict.badgeCosmetic : dict.badgeGeometric}
        </span>
      </div>

      {/* Series group tabs (4 main) */}
      <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 4 }}>
        {dict.labelSeries}
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {allGroups.map((g) => (
          <button
            key={g}
            data-testid={`threads-group-${g}`}
            type="button"
            onClick={() => switchGroup(g)}
            style={tabBtnStyle(activeGroup === g)}
          >
            {g === 'ISO_M'
              ? dict.seriesGroupIsoM
              : g === 'UTS'
              ? dict.seriesGroupUts
              : g === 'NPT'
              ? dict.seriesGroupNpt
              : dict.seriesGroupBsp}
          </button>
        ))}
      </div>

      {/* Series sub-tab (within a group) — only shown when the group has more than one series */}
      {SERIES_BY_GROUP[activeGroup].length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {SERIES_BY_GROUP[activeGroup].map((s) => (
            <button
              key={s}
              data-testid={`threads-series-${s}`}
              type="button"
              onClick={() => switchSeries(s)}
              style={{
                ...tabBtnStyle(spec.series === s),
                fontSize: 11,
                padding: '4px 8px',
              }}
            >
              {seriesLabel(dict, s)}
            </button>
          ))}
        </div>
      )}

      {/* Designation picker (grid of rows for current series) */}
      <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 4 }}>
        {dict.labelDesignation}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 4,
          marginBottom: 8,
          maxHeight: 120,
          overflowY: 'auto',
        }}
      >
        {rows.map((r) => (
          <button
            key={r.designation}
            data-testid={`threads-designation-${r.designation}`}
            type="button"
            onClick={() => setDesignation(r.designation)}
            style={tileBtnStyle(spec.designation === r.designation)}
          >
            {r.designation}
          </button>
        ))}
      </div>

      {/* Class picker */}
      {selectedRow && selectedRow.classCandidates.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 4 }}>
            {dict.labelClass}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {selectedRow.classCandidates.map((c) => (
              <button
                key={c}
                data-testid={`threads-class-${c}`}
                type="button"
                onClick={() => setClass(c)}
                style={{
                  ...tabBtnStyle(spec.class === c),
                  padding: '4px 8px',
                  fontSize: 11,
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Length + Start offset row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <label style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>
          {dict.labelLength}
          <input
            data-testid="threads-length-input"
            type="number"
            min={0}
            step={0.1}
            value={spec.length}
            onChange={(e) => setLength(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>
          {dict.labelStartOffset}
          <input
            data-testid="threads-startoffset-input"
            type="number"
            min={0}
            step={0.1}
            value={spec.startOffset}
            onChange={(e) => setStartOffset(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      {/* Direction toggle */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 4 }}>
          {dict.labelDirection}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            data-testid="threads-direction-right_hand"
            type="button"
            onClick={() => setDirection('right_hand')}
            style={{
              ...tabBtnStyle(spec.threadDirection === 'right_hand'),
              flex: 1,
            }}
          >
            {dict.directionRight}
          </button>
          <button
            data-testid="threads-direction-left_hand"
            type="button"
            onClick={() => setDirection('left_hand')}
            style={{
              ...tabBtnStyle(spec.threadDirection === 'left_hand'),
              flex: 1,
            }}
          >
            {dict.directionLeft}
          </button>
        </div>
      </div>

      {/* Kind toggle (internal / external) — hidden in hole wizard */}
      {!hideKindToggle && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 4 }}>
            {dict.labelKind}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              data-testid="threads-kind-internal"
              type="button"
              onClick={() => setKind('internal')}
              style={{ ...tabBtnStyle(spec.threadKind === 'internal'), flex: 1 }}
            >
              {dict.kindInternal}
            </button>
            <button
              data-testid="threads-kind-external"
              type="button"
              onClick={() => setKind('external')}
              style={{ ...tabBtnStyle(spec.threadKind === 'external'), flex: 1 }}
            >
              {dict.kindExternal}
            </button>
          </div>
        </div>
      )}

      {/* Mode picker */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 4 }}>
          {dict.labelMode}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            data-testid="threads-mode-cosmetic"
            type="button"
            onClick={() => setMode('cosmetic')}
            style={{ ...tabBtnStyle(spec.mode === 'cosmetic'), flex: 1 }}
          >
            {dict.modeCosmetic}
          </button>
          <button
            data-testid="threads-mode-geometric"
            type="button"
            onClick={() => setMode('geometric')}
            style={{ ...tabBtnStyle(spec.mode === 'geometric'), flex: 1 }}
          >
            {dict.modeGeometric}
          </button>
        </div>
      </div>

      {/* Resolved-row numerics preview */}
      {selectedRow && (
        <div
          data-testid="threads-row-preview"
          style={{
            padding: 8,
            background: 'var(--nx-bg)',
            border: '1px solid #374151',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 11,
            color: 'var(--nx-text)',
          }}
        >
          <div>
            {dict.hintMajorDia}: <b>{selectedRow.nominalDia.toFixed(3)} mm</b>
          </div>
          <div>
            {dict.hintPitch}: <b>{selectedRow.pitch.toFixed(3)} mm</b>
          </div>
          <div>
            {dict.hintMinorDia}: <b>{selectedRow.minorDiameter.toFixed(3)} mm</b>
          </div>
          <div>
            {dict.hintTapDrill}: <b>{selectedRow.tapDrill.toFixed(2)} mm</b>
          </div>
        </div>
      )}

      {/* Cosmetic-only hint — geometric mode produces a real V-cut mesh and
          doesn't need the magenta dashed-circle viewport indicator. */}
      {spec.mode === 'cosmetic' && (
        <div
          data-testid="threads-mode-cosmetic-magenta-hint"
          style={{
            fontSize: 10,
            color: '#ff00ff',
            marginTop: 6,
            fontStyle: 'italic',
          }}
        >
          {dict.hintViewportMagenta}
        </div>
      )}
    </div>
  );
}

// ─── Public exports — series taxonomy used by host modals & tests ─────────

export { SERIES_BY_GROUP, groupForSeries };
export type { SeriesGroup };
// Re-export THREAD_CATALOG so tests can import it from the same module path
// (keeps the catalog a single source of truth without forcing call sites to
// touch the lower-level catalog module).
export { THREAD_CATALOG };
