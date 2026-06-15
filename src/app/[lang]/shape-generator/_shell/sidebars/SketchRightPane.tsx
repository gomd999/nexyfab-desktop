'use client';

// Sketch mode right pane — ACTIVE SELECTION / CONSTRAINTS ON SELECTION /
// PARAMETERS / SOLVER sections. All sections are LIVE (2026-06-10): the
// previous hardcoded mockup (fake "4× ∅6.5 hole pattern", fake d4/d5
// params) was replaced with real data from the shell bridge —
//   selection      ← sketchSelectedEntityId (SketchCanvas select tool)
//   constraints    ← sketchConstraintList filtered to the selection
//   parameters     ← sketchDimensionList filtered to the selection
//   solver         ← live read-only diagnostic solve (sketchStatusLive)

import type { ReactNode } from 'react';
import { SidePanel, PropSection, PropRow, PropCheck } from './';
import { useShellBridge } from '../shellBridgeStore';
import { sketchStatusColor, sketchStatusLabel } from '../sketchStatusUi';
import { CONSTRAINT_GLYPH, DimensionEditableRow } from './SketchLeftPane';
import { I } from '../Icons';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';
import { pickShellDict, type ShellDict } from '../shellDict';

function sketchCatalogDict(d: ShellDict): CatalogPanelDict {
  return {
    catalogTitle: d.catSketchTitle, catalogLoading: d.loading, catalogReady: d.catReady,
    catalogRun: d.catRun, catalogFailed: d.catFailed, catalogEmpty: d.catEmpty,
  };
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
      {children}
    </div>
  );
}

export interface SketchRightPaneProps {
  lang: string;
}

export function SketchRightPane({ lang }: SketchRightPaneProps) {
  const d = pickShellDict(lang);
  const entities = useShellBridge(s => s.sketchEntities);
  const constraints = useShellBridge(s => s.sketchConstraints);
  const dof = useShellBridge(s => s.sketchDof);
  const status = useShellBridge(s => s.sketchStatus);
  const redundantCount = useShellBridge(s => s.sketchRedundantCount);
  const solveMs = useShellBridge(s => s.sketchSolveMs);
  const entityList = useShellBridge(s => s.sketchEntityList);
  const constraintList = useShellBridge(s => s.sketchConstraintList);
  const dimensionList = useShellBridge(s => s.sketchDimensionList);
  const selectedEntityId = useShellBridge(s => s.sketchSelectedEntityId);

  const selected = selectedEntityId
    ? entityList.find(e => e.id === selectedEntityId) ?? null
    : null;
  // Constraints / dimensions can reference the segment id OR its point ids.
  const selectedIds = selected
    ? new Set<string>([selected.id, ...(selected.pointIds ?? [])])
    : null;
  const selConstraints = selectedIds
    ? constraintList.filter(c => c.entityIds?.some(id => selectedIds.has(id)))
    : [];
  const selDims = selectedIds
    ? dimensionList.filter(d => d.entityIds?.some(id => selectedIds.has(id)))
    : [];

  const typeLabel = selected
    ? (d.entityTypes[selected.type as keyof ShellDict['entityTypes']] ?? selected.type)
    : null;

  return (
    <SidePanel
      side="right"
      title={d.sketchProps}
      titleIcon={<I.sketch size={12} />}
    >
      <PropSection title={d.activeSelection}>
        {!selected ? (
          <Hint>
            {d.clickEntity}
          </Hint>
        ) : (
          <>
            <PropRow label={d.selectedLabel}>
              <span style={{ fontSize: 11, color: 'var(--nx-accent)' }}>{selected.label}</span>
            </PropRow>
            <PropRow label={d.typeLabel}>
              <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{typeLabel}</span>
            </PropRow>
            {selected.meta && (
              <PropRow label={d.infoLabel}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{selected.meta}</span>
              </PropRow>
            )}
            <PropRow label={d.construction}>
              <PropCheck
                checked={selected.construction === true}
                onChange={() => {
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('nexyfab:toggle-sketch-construction', {
                    detail: { id: selected.id },
                  }));
                }}
                label={d.yes}
              />
            </PropRow>
          </>
        )}
      </PropSection>

      <PropSection title={d.constraintsOnSel}>
        {!selected ? (
          <Hint>{d.noSelection}</Hint>
        ) : selConstraints.length === 0 ? (
          <Hint>{d.noConstraintsOnEntity}</Hint>
        ) : (
          selConstraints.map(c => (
            <div
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11 }}
            >
              <span style={{ flex: '0 0 auto', color: 'var(--nx-accent)' }}>
                {CONSTRAINT_GLYPH[c.type] ?? '◦'}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--nx-text)' }}>
                {c.type}
              </span>
              {c.satisfied === false && (
                <span
                  title={d.unsatisfied}
                  style={{ fontSize: 10, color: 'var(--nx-error, #f85149)' }}
                >
                  ⚠
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('nexyfab:delete-sketch-constraint', {
                    detail: { id: c.id },
                  }));
                }}
                aria-label={d.removeConstraint}
                style={{
                  width: 16, height: 16, border: 0, background: 'transparent',
                  color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 12,
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </PropSection>

      <PropSection title={d.paramsTitle}>
        {!selected ? (
          <Hint>{d.noSelection}</Hint>
        ) : selDims.length === 0 ? (
          <Hint>
            {d.noDimsOnEntity}
          </Hint>
        ) : (
          selDims.map(dim => (
            <DimensionEditableRow key={dim.id} dim={dim} d={d} />
          ))
        )}
      </PropSection>

      <PropSection title={d.solver}>
        <PropRow label={d.statusLower}>
          <span className="mono" style={{ fontSize: 11, color: sketchStatusColor(status) }}>
            {sketchStatusLabel(status, dof, redundantCount, d) ?? '—'}
          </span>
        </PropRow>
        <PropRow label={d.entitiesLower}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{entities}</span>
        </PropRow>
        <PropRow label={d.constraintsLower}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{constraints}</span>
        </PropRow>
        <PropRow label="DOF">
          <span className="mono" style={{ fontSize: 11, color: sketchStatusColor(status) }}>
            {dof ?? '—'}
          </span>
        </PropRow>
        <PropRow label={d.redundantLower}>
          <span className="mono" style={{ fontSize: 11, color: redundantCount > 0 ? 'var(--nx-error, #f85149)' : 'var(--nx-text-2)' }}>
            {redundantCount}
          </span>
        </PropRow>
        <PropRow label={d.solveTime}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {solveMs != null ? `${solveMs.toFixed(1)} ms` : '—'}
          </span>
        </PropRow>
      </PropSection>

      {/* Advanced pro tools — collapsed by default so the property inspector
          stays focused on the live selection. Descriptions are suppressed to
          keep the rail compact; users expand on demand (full launcher is also
          on ⌘K). (2026-06-12 declutter) */}
      <PropSection title={d.sketchToolsLive} defaultExpanded={false}>
        <FeatureCatalogPanel
          route="sketch"
          license="pro"
          dict={sketchCatalogDict(d)}
          showDescriptions={false}
          onRun={(featureId, entryFn) => {

            console.info(`[catalog] run ${featureId} via ${entryFn}()`);
          }}
        />
      </PropSection>
    </SidePanel>
  );
}
