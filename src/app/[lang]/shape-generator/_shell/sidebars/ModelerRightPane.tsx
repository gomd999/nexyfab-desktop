'use client';

// Modeling mode right pane — Inspector / Engineering / Nexy AI / Comments.
// All Inspector sections are LIVE (2026-06-10): the mockup-era hardcoded
// GEOMETRY (fake constant-radius rows) / EDGES (fabricated Edge.42…) /
// APPEARANCE (dead Aluminum button) blocks were replaced with real data —
//   edges       ← selected feature's edgeSelections (bridged via featureItems)
//   geometry    ← the live PARAMETERS rows, retitled for fillet/chamfer types
//   appearance  ← sceneStore materialId (editable, same path as material drop)
//   DFM meta    ← bridged dfmWarningCount from the auto-DFM worker run
//   badge       ← real open-comment count from CommentsPanel's storage
// ANALYZE rows open the BottomDrawer panels via `nexyfab:analyze-open`.

import { useEffect, useState } from 'react';
import { loc } from '@/lib/i18n/loc';
import { SidePanel, PropSection, PropRow, PropNumber, PropSelect, PropItemRow } from './';
import { I } from '../Icons';
import { useShellBridge } from '../shellBridgeStore';
import { useSceneStore } from '../../store/sceneStore';
import { MATERIAL_PRESETS } from '../../materials';
import { AiChatPanel } from './AiChatPanel';
import { CommentsPanel } from './CommentsPanel';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';
import type { FeatureRoute } from '../../featureCatalog/registry';
import { fmtShell, pickShellDict, type ShellDict } from '../shellDict';
import { toIsoLang } from '@/lib/i18n/normalize';
import { useDomainWorkspaceSelection } from '../domainWorkspaceStore';
import { DIRECT_PRECISION_ENTRY_DRAFT_KEY, parsePrecisionEntryDraft } from '@/lib/precisionEntryDraft';

export interface ModelerRightPaneProps {
  lang: string;
}

type Tab = 'inspector' | 'ai' | 'comments' | 'engineering';

// Engineering domains that have no dedicated shell mode of their own; the
// modeling workspace surfaces them through a single switchable catalog panel.
const ENGINEERING_ROUTES: FeatureRoute[] = ['modeling', 'cam', 'mold', 'sheet-metal', 'plant', 'hvac', 'cost', 'dfm'];

function engCatalogDict(d: ShellDict): CatalogPanelDict {
  return {
    catalogTitle: d.catEngTitle, catalogLoading: d.loading, catalogReady: d.catReady,
    catalogRun: d.catRun, catalogFailed: d.catFailed, catalogEmpty: d.catEmpty,
  };
}

// Real open-comment count for the Comments tab badge. CommentsPanel persists
// to localStorage under `nexyfab.comments.v1.<projectId|'local'>`; this pane
// mounts it without a projectId, so the namespace is deterministic. Re-reads
// on tab switches (same-tab edits) and `storage` events (other tabs).
const COMMENTS_STORAGE_KEY = 'nexyfab.comments.v1.local';

function useOpenCommentCount(activeTab: Tab): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const read = () => {
      try {
        const raw = window.localStorage.getItem(COMMENTS_STORAGE_KEY);
        if (!raw) { setCount(0); return; }
        const threads = JSON.parse(raw) as Array<{ resolved?: boolean }>;
        setCount(Array.isArray(threads) ? threads.filter(c => !c.resolved).length : 0);
      } catch { setCount(0); }
    };
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, [activeTab]);
  return count;
}

export function ModelerRightPane({ lang }: ModelerRightPaneProps) {
  const d = pickShellDict(lang);
  // Deferred sub-panels (AiChatPanel / CommentsPanel) are still ko/en-binary.
  const isKo = toIsoLang(lang) === 'ko';
  const [activeTab, setActiveTab] = useState<Tab>('inspector');
  const [domainWorkspace] = useDomainWorkspaceSelection();
  const selectedLabel = useShellBridge(s => s.selectedLabel);
  const selectionCount = useShellBridge(s => s.selectionCount);
  const volume = useShellBridge(s => s.volume);
  const triangleCount = useShellBridge(s => s.triangleCount);
  const baseShapeItem = useShellBridge(s => s.baseShapeItem);
  const featureItems = useShellBridge(s => s.featureItems);
  const selectedFeatureId = useShellBridge(s => s.selectedFeatureId);
  const openComments = useOpenCommentCount(activeTab);
  const selectedFeature = selectedFeatureId
    ? (baseShapeItem?.id === selectedFeatureId
        ? baseShapeItem
        : featureItems.find(f => f.id === selectedFeatureId))
    : null;

  useEffect(() => {
    setActiveTab(domainWorkspace.experience === 'guided' ? 'ai' : 'inspector');
  }, [domainWorkspace.experience]);

  useEffect(() => {
    if (parsePrecisionEntryDraft(window.sessionStorage.getItem(DIRECT_PRECISION_ENTRY_DRAFT_KEY), 'precision-cad')) setActiveTab('ai');
  }, []);

  useEffect(() => {
    const openPane = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: Tab }>).detail?.tab;
      if (tab === 'inspector' || tab === 'engineering' || tab === 'ai' || tab === 'comments') setActiveTab(tab);
    };
    window.addEventListener('nexyfab:open-right-pane', openPane);
    return () => window.removeEventListener('nexyfab:open-right-pane', openPane);
  }, []);

  return (
    <SidePanel
      side="right"
      tabs={[
        { id: 'inspector', label: d.tabInspector, icon: <I.tree size={12} /> },
        { id: 'engineering', label: d.tabEngineering, icon: <I.cog size={12} /> },
        { id: 'ai', label: 'Nexy AI', icon: <I.ai size={12} /> },
        { id: 'comments', label: d.tabComments, icon: <I.comments size={12} />, ...(openComments > 0 ? { badge: openComments } : {}) },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as Tab)}
    >
      {activeTab === 'inspector' && (
        <InspectorTab
          d={d}
          isKo={isKo}
          lang={lang}
          selectedLabel={selectedLabel}
          selectionCount={selectionCount}
          volume={volume}
          triangleCount={triangleCount}
          featureId={selectedFeature?.id ?? null}
          featureType={selectedFeature?.type ?? null}
          featureParams={selectedFeature?.params ?? null}
          featureParamDefs={selectedFeature?.paramDefs ?? null}
          featureEdges={selectedFeature?.edges ?? null}
        />
      )}
      {activeTab === 'engineering' && <EngineeringTab d={d} />}
      {activeTab === 'ai' && <AiTab isKo={isKo} />}
      {activeTab === 'comments' && <CommentsTab isKo={isKo} />}
    </SidePanel>
  );
}

// ─── Inspector tab ─────────────────────────────────────────────────────────

// Feature types whose params describe local geometry (radius / distance on
// picked edges). The live param section is titled GEOMETRY for these and
// PARAMETERS for everything else — one section, no duplicated rows.
const GEOMETRY_FEATURE_TYPES = new Set(['fillet', 'chamfer', 'variableFillet']);

function InspectorTab({
  d, isKo, lang, selectedLabel, selectionCount, volume, triangleCount,
  featureId, featureType, featureParams, featureEdges,
  featureParamDefs,
}: {
  d: ShellDict;
  isKo: boolean;
  /** ⚠ `isKo` 만으로는 6언어를 못 고른다 — 재질명이 ja·zh·es·ar 에서 영어로 떨어졌다. */
  lang: string;
  selectedLabel: string | null;
  selectionCount: number;
  volume: number | null;
  triangleCount: number;
  featureId: string | null;
  featureType: string | null;
  featureParams: Record<string, number> | null;
  featureParamDefs: Record<string, { label?: string; min?: number; max?: number; step?: number; unit?: string }> | null;
  featureEdges: { id: string; meta?: string }[] | null;
}) {
  const dfmWarningCount = useShellBridge(s => s.dfmWarningCount);
  // Empty state when nothing selected.
  if (!selectedLabel) {
    return (
      <div style={{ padding: '20px 16px', fontSize: 11, color: 'var(--nx-text-3)', textAlign: 'center', lineHeight: 1.5 }}>
        {d.selectToInspect}
      </div>
    );
  }

  return (
    <>
      {/* Header — selected entity summary */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--nx-border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--nx-accent-soft)' }}>
        <I.fillet size={16} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text)' }}>{selectedLabel}</div>
          {selectionCount > 0 && (
            <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
              {fmtShell(d.edgeGroup, { n: selectionCount })}
            </div>
          )}
        </div>
      </div>

      {/* EDGES — the feature's REAL click-time edge selections (fillet /
          chamfer / shell on picked edges). Hidden when the selected feature
          carries no edge selections. Removing an edge dispatches to Inner,
          which routes it through commandHistory (undoable); the last edge
          can't be removed because an empty selection silently reverts the
          feature to all-edges behaviour. */}
      {featureId && featureEdges && featureEdges.length > 0 && (
        <PropSection title={`${d.edgesTitle} (${featureEdges.length})`} defaultExpanded={false}>
          {featureEdges.map((edge, i) => (
            <PropItemRow
              key={`${edge.id}-${i}`}
              bullet="●"
              label={edge.id}
              meta={edge.meta}
              onRemove={featureEdges.length > 1 ? () => {
                if (typeof window === 'undefined') return;
                window.dispatchEvent(new CustomEvent('nexyfab:remove-feature-edge', {
                  detail: { featureId, edgeIndex: i },
                }));
              } : undefined}
            />
          ))}
        </PropSection>
      )}

      <AppearanceSection d={d} isKo={isKo} lang={lang} />

      {/* Live editable params — titled GEOMETRY for fillet/chamfer-type
          features (radius / distance on selected edges), PARAMETERS for the
          rest. Edits flow through nexyfab:update-feature-param → Inner's
          undoable updateFeatureParamCmd. */}
      <PropSection title={(featureType && GEOMETRY_FEATURE_TYPES.has(featureType))
        ? `${d.geometryTitle} · ${featureType}`
        : `${d.paramsTitle}${featureType ? ` · ${featureType}` : ''}`}>
        {featureId && featureParams && Object.keys(featureParams).length > 0 ? (
          Object.entries(featureParams).map(([key, value]) => {
            const def = featureParamDefs?.[key];
            const fieldId = `inspector-${featureId}-${key}`.replace(/[^a-zA-Z0-9_-]/g, '-');
            return (
            <PropRow key={key} label={def?.label ?? key}>
              <PropNumber
                value={value}
                ariaLabel={`${featureType ?? 'feature'} ${key}`}
                testId={`inspector-param-${key}`}
                inputId={fieldId}
                inputName={`${featureId}.${key}`}
                onChange={(v) => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('nexyfab:update-feature-param', {
                      detail: { id: featureId, key, value: v },
                    }));
                  }
                }}
                suffix={def?.unit ?? paramSuffix(key)}
                min={def?.min}
                max={def?.max}
                step={def?.step ?? paramStep(key)}
              />
            </PropRow>
            );
          })
        ) : (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
            {d.noEditableParams}
          </div>
        )}
      </PropSection>

      <PropSection title={d.analyzeTitle} defaultExpanded>
        {/* DFM meta = REAL warning count from the last auto-DFM run (bridged
            from Inner); "run" until the first analysis completes. */}
        <AnalyzeRow
          testId="shell-open-dfm"
          label={d.dfmCheck}
          meta={dfmWarningCount === null
            ? d.runLower
            : fmtShell(d.warnCount, { n: dfmWarningCount })}
          drawer="dfm"
        />
        <AnalyzeRow testId="shell-open-fea" label={d.feaRowLabel} meta={d.runLower} drawer="fea" />
        <AnalyzeRow label={d.costEstimate} meta={volume ? `≈ ${(volume * 0.003).toFixed(2)} g` : ''} drawer="cost" />
        <AnalyzeRow label={d.variantsTitle} drawer="variants" />
        <AnalyzeRow label={d.motionStudy} meta={d.simLower} drawer="motion" />
        <PropRow label={d.triangles}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {Math.round(triangleCount).toLocaleString()}
          </span>
        </PropRow>
      </PropSection>

      {/* CAM section — exposes the post-processor library */}
      <PropSection title="CAM" defaultExpanded={false}>
        <CamSection d={d} />
      </PropSection>
      {/* (Removed the no-op Cancel/Apply footer — parameter edits already apply
          live via nexyfab:update-feature-param, so those buttons did nothing
          and implied an apply/cancel model that doesn't exist. 2026-06-09) */}
    </>
  );
}

// APPEARANCE — live material straight from sceneStore (same store the
// viewport renderer reads). Editing the select swaps the actual rendered
// material via setMaterialId, matching the toolbar material-drop behaviour.
function AppearanceSection({ d, isKo: _isKo, lang }: { d: ShellDict; isKo: boolean; lang: string }) {
  const materialId = useSceneStore(s => s.materialId);
  const setMaterialId = useSceneStore(s => s.setMaterialId);
  const preset = MATERIAL_PRESETS.find(m => m.id === materialId);
  return (
    <PropSection title={d.appearance} defaultExpanded={false}>
      <PropRow label={d.material}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: preset?.color ?? 'var(--nx-border)', flex: '0 0 12px' }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <PropSelect
              value={materialId}
              onChange={setMaterialId}
              options={MATERIAL_PRESETS.map(m => ({ value: m.id, label: loc(lang, m.name) }))}
            />
          </span>
        </div>
      </PropRow>
    </PropSection>
  );
}

// Heuristic suffix per common param name. Most CAD params are mm.
function paramSuffix(key: string): string | undefined {
  const k = key.toLowerCase();
  if (k.includes('angle') || k.includes('rotation') || k.endsWith('deg')) return '°';
  if (k.includes('count') || k.includes('teeth') || k.includes('flutes') || k.includes('segment')) return '';
  if (k.includes('ratio') || k.includes('factor') || k.includes('roughness') || k.includes('metalness')) return '';
  return 'mm';
}

// Sensible step per param so sliders feel right.
function paramStep(key: string): number {
  const k = key.toLowerCase();
  if (k.includes('count') || k.includes('teeth') || k.includes('flutes')) return 1;
  if (k.includes('angle') || k.includes('rotation') || k.endsWith('deg')) return 1;
  if (k.includes('ratio') || k.includes('factor') || k.includes('roughness') || k.includes('metalness')) return 0.01;
  return 0.5;
}

function CamSection({ d }: { d: ShellDict }) {
  const [dialect, setDialect] = useState<'fanuc' | 'mach3' | 'haas' | 'linuxcnc' | 'siemens'>('fanuc');
  const [machine, setMachine] = useState('haas-vf2');
  const onExport = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:cam-export', {
        detail: { dialect, machine },
      }));
    }
  };
  return (
    <>
      <PropRow label={d.controller}>
        <PropSelect
          value={dialect}
          onChange={(v) => setDialect(v as typeof dialect)}
          options={[
            { value: 'fanuc', label: 'Fanuc' },
            { value: 'mach3', label: 'Mach3' },
            { value: 'haas', label: 'Haas' },
            { value: 'linuxcnc', label: 'LinuxCNC' },
            { value: 'siemens', label: 'Sinumerik' },
          ]}
        />
      </PropRow>
      <PropRow label={d.machine}>
        <PropSelect
          value={machine}
          onChange={(v) => setMachine(v as string)}
          options={[
            { value: 'haas-vf2', label: 'Haas VF-2' },
            { value: 'tormach-pcnc-440', label: 'Tormach PCNC 440' },
            { value: 'shopbot-prsalpha', label: 'ShopBot PRSα' },
            { value: 'sherline-5400', label: 'Sherline 5400' },
            { value: 'custom-3018', label: 'Custom 3018' },
          ]}
        />
      </PropRow>
      <button
        onClick={onExport}
        style={{
          marginTop: 6, width: '100%', height: 26, border: 0, borderRadius: 4,
          background: 'var(--nx-accent)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}
      >
        {d.exportGcode}
      </button>
    </>
  );
}

function AnalyzeRow({ label, meta, drawer, testId }: { label: string; meta?: string; drawer: 'dfm' | 'fea' | 'cost' | 'variants' | 'motion'; testId?: string }) {
  return (
    <div
      data-testid={testId}
      onClick={() => {
        // Dispatch a custom event the ModelerShell listens for to open the
        // BottomDrawer on the target tab.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:analyze-open', { detail: { drawer } }));
        }
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 0', cursor: 'pointer',
        color: 'var(--nx-text)',
      }}
    >
      <span style={{ flex: '0 0 auto', color: 'var(--nx-accent)' }}>◆</span>
      <span style={{ flex: 1, fontSize: 11 }}>{label}</span>
      {meta && <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{meta}</span>}
      <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>→</span>
    </div>
  );
}

// ─── Engineering tab ─────────────────────────────────────────────────────────
// Surfaces the registry-driven engineering calculators (CAM/mold/sheet-metal/
// plant/HVAC/cost/DFM/dynamics) that have no dedicated shell mode. One panel,
// switchable domain dropdown, click → lazy-load → run example.

function EngineeringTab({ d }: { d: ShellDict }) {
  return (
    <div style={{ padding: '10px 12px' }}>
      <FeatureCatalogPanel
        routes={ENGINEERING_ROUTES}
        routeLabels={d.engRoutes}
        license="pro"
        dict={engCatalogDict(d)}
        onRun={(featureId, entryFn) => {
           
          console.info(`[catalog] run ${featureId} via ${entryFn}()`);
        }}
      />
    </div>
  );
}

// ─── AI tab ────────────────────────────────────────────────────────────────
// Inline embedded chat instead of a launcher card — matches Cursor /
// Copilot patterns. Falls back to the modal when the network call fails.

function AiTab({ isKo }: { isKo: boolean }) {
  return <AiChatPanel isKo={isKo} />;
}

// ─── Comments tab ──────────────────────────────────────────────────────────

function CommentsTab({ isKo }: { isKo: boolean }) {
  return <CommentsPanel isKo={isKo} />;
}

