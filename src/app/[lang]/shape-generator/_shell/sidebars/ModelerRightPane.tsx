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
import { SidePanel, PropSection, PropRow, PropNumber, PropSelect, PropItemRow } from './';
import { I } from '../Icons';
import { useShellBridge } from '../shellBridgeStore';
import { useSceneStore } from '../../store/sceneStore';
import { MATERIAL_PRESETS } from '../../materials';
import { AiChatPanel } from './AiChatPanel';
import { CommentsPanel } from './CommentsPanel';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';
import type { FeatureRoute } from '../../featureCatalog/registry';

export interface ModelerRightPaneProps {
  isKo: boolean;
}

type Tab = 'inspector' | 'ai' | 'comments' | 'engineering';

// Engineering domains that have no dedicated shell mode of their own; the
// modeling workspace surfaces them through a single switchable catalog panel.
const ENGINEERING_ROUTES: FeatureRoute[] = ['modeling', 'cam', 'mold', 'sheet-metal', 'plant', 'hvac', 'cost', 'dfm'];

const ENG_ROUTE_LABELS_KO: Partial<Record<FeatureRoute, string>> = {
  modeling: '모델링/역학', cam: 'CAM 가공', mold: '금형', 'sheet-metal': '판금',
  plant: '플랜트 배관', hvac: '공조', cost: '견적/원가', dfm: 'DFM',
};
const ENG_ROUTE_LABELS_EN: Partial<Record<FeatureRoute, string>> = {
  modeling: 'Modeling/Dynamics', cam: 'CAM', mold: 'Mold', 'sheet-metal': 'Sheet Metal',
  plant: 'Plant Piping', hvac: 'HVAC', cost: 'Cost/Estimate', dfm: 'DFM',
};

const ENG_CATALOG_DICT_KO: CatalogPanelDict = {
  catalogTitle: '엔지니어링 계산기', catalogLoading: '불러오는 중…', catalogReady: '준비됨',
  catalogRun: '실행', catalogFailed: '불러오기 실패', catalogEmpty: '해당 기능이 없습니다',
};
const ENG_CATALOG_DICT_EN: CatalogPanelDict = {
  catalogTitle: 'Engineering Calculators', catalogLoading: 'Loading…', catalogReady: 'Ready',
  catalogRun: 'Run', catalogFailed: 'Load failed', catalogEmpty: 'No matching feature',
};

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

export function ModelerRightPane({ isKo }: ModelerRightPaneProps) {
  const [activeTab, setActiveTab] = useState<Tab>('inspector');
  const selectedLabel = useShellBridge(s => s.selectedLabel);
  const selectionCount = useShellBridge(s => s.selectionCount);
  const volume = useShellBridge(s => s.volume);
  const triangleCount = useShellBridge(s => s.triangleCount);
  const featureItems = useShellBridge(s => s.featureItems);
  const selectedFeatureId = useShellBridge(s => s.selectedFeatureId);
  const openComments = useOpenCommentCount(activeTab);
  const selectedFeature = selectedFeatureId
    ? featureItems.find(f => f.id === selectedFeatureId)
    : null;

  return (
    <SidePanel
      side="right"
      tabs={[
        { id: 'inspector', label: isKo ? '인스펙터' : 'Inspector', icon: <I.tree size={12} /> },
        { id: 'engineering', label: isKo ? '엔지니어링' : 'Engineering', icon: <I.cog size={12} /> },
        { id: 'ai', label: isKo ? 'Nexy AI' : 'Nexy AI', icon: <I.ai size={12} /> },
        { id: 'comments', label: isKo ? '코멘트' : 'Comments', icon: <I.comments size={12} />, ...(openComments > 0 ? { badge: openComments } : {}) },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as Tab)}
    >
      {activeTab === 'inspector' && (
        <InspectorTab
          isKo={isKo}
          selectedLabel={selectedLabel}
          selectionCount={selectionCount}
          volume={volume}
          triangleCount={triangleCount}
          featureId={selectedFeature?.id ?? null}
          featureType={selectedFeature?.type ?? null}
          featureParams={selectedFeature?.params ?? null}
          featureEdges={selectedFeature?.edges ?? null}
        />
      )}
      {activeTab === 'engineering' && <EngineeringTab isKo={isKo} />}
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
  isKo, selectedLabel, selectionCount, volume, triangleCount,
  featureId, featureType, featureParams, featureEdges,
}: {
  isKo: boolean;
  selectedLabel: string | null;
  selectionCount: number;
  volume: number | null;
  triangleCount: number;
  featureId: string | null;
  featureType: string | null;
  featureParams: Record<string, number> | null;
  featureEdges: { id: string; meta?: string }[] | null;
}) {
  const dfmWarningCount = useShellBridge(s => s.dfmWarningCount);
  // Empty state when nothing selected.
  if (!selectedLabel) {
    return (
      <div style={{ padding: '20px 16px', fontSize: 11, color: 'var(--nx-text-3)', textAlign: 'center', lineHeight: 1.5 }}>
        {isKo ? '피처나 엣지를 선택해 속성을 표시합니다.' : 'Select a feature or edge to inspect.'}
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
              {isKo ? `${selectionCount}개 엣지 · 엣지 그룹` : `Edge group · ${selectionCount} edges`}
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
        <PropSection title={isKo ? `엣지 (${featureEdges.length})` : `Edges (${featureEdges.length})`} defaultExpanded={false}>
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

      <AppearanceSection isKo={isKo} />

      {/* Live editable params — titled GEOMETRY for fillet/chamfer-type
          features (radius / distance on selected edges), PARAMETERS for the
          rest. Edits flow through nexyfab:update-feature-param → Inner's
          undoable updateFeatureParamCmd. */}
      <PropSection title={(featureType && GEOMETRY_FEATURE_TYPES.has(featureType))
        ? (isKo ? `지오메트리 · ${featureType}` : `Geometry · ${featureType}`)
        : (isKo ? `파라미터${featureType ? ` · ${featureType}` : ''}` : `Parameters${featureType ? ` · ${featureType}` : ''}`)}>
        {featureId && featureParams && Object.keys(featureParams).length > 0 ? (
          Object.entries(featureParams).map(([key, value]) => (
            <PropRow key={key} label={key}>
              <PropNumber
                value={value}
                onChange={(v) => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('nexyfab:update-feature-param', {
                      detail: { id: featureId, key, value: v },
                    }));
                  }
                }}
                suffix={paramSuffix(key)}
                step={paramStep(key)}
              />
            </PropRow>
          ))
        ) : (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
            {isKo ? '편집 가능한 파라미터 없음' : 'No editable parameters'}
          </div>
        )}
      </PropSection>

      <PropSection title={isKo ? '분석' : 'Analyze'} defaultExpanded>
        {/* DFM meta = REAL warning count from the last auto-DFM run (bridged
            from Inner); "run" until the first analysis completes. */}
        <AnalyzeRow
          label={isKo ? 'DFM 검사' : 'DFM check'}
          meta={dfmWarningCount === null
            ? (isKo ? '실행' : 'run')
            : (isKo ? `경고 ${dfmWarningCount}개` : `${dfmWarningCount} warns`)}
          drawer="dfm"
        />
        <AnalyzeRow label={isKo ? 'FEA · 정적/비선형/모달' : 'FEA — linear/nonlinear/modal'} meta={isKo ? '실행' : 'run'} drawer="fea" />
        <AnalyzeRow label={isKo ? '비용 예상' : 'Cost estimate'} meta={volume ? `≈ ${(volume * 0.003).toFixed(2)} g` : ''} drawer="cost" />
        <AnalyzeRow label={isKo ? '설계 변형' : 'Design variants'} drawer="variants" />
        <AnalyzeRow label={isKo ? '모션 스터디' : 'Motion study'} meta={isKo ? '시뮬' : 'sim'} drawer="motion" />
        <PropRow label={isKo ? '삼각형' : 'Triangles'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {Math.round(triangleCount).toLocaleString()}
          </span>
        </PropRow>
      </PropSection>

      {/* CAM section — exposes the post-processor library */}
      <PropSection title={isKo ? 'CAM' : 'CAM'} defaultExpanded={false}>
        <CamSection isKo={isKo} />
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
function AppearanceSection({ isKo }: { isKo: boolean }) {
  const materialId = useSceneStore(s => s.materialId);
  const setMaterialId = useSceneStore(s => s.setMaterialId);
  const preset = MATERIAL_PRESETS.find(m => m.id === materialId);
  return (
    <PropSection title={isKo ? '외형' : 'Appearance'} defaultExpanded={false}>
      <PropRow label={isKo ? '재질' : 'Material'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: preset?.color ?? 'var(--nx-border)', flex: '0 0 12px' }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <PropSelect
              value={materialId}
              onChange={setMaterialId}
              options={MATERIAL_PRESETS.map(m => ({ value: m.id, label: isKo ? m.name.ko : m.name.en }))}
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

function CamSection({ isKo }: { isKo: boolean }) {
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
      <PropRow label={isKo ? '컨트롤러' : 'Controller'}>
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
      <PropRow label={isKo ? '머신' : 'Machine'}>
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
        {isKo ? 'G-code 내보내기' : 'Export G-code'}
      </button>
    </>
  );
}

function AnalyzeRow({ label, meta, drawer }: { label: string; meta?: string; drawer: 'dfm' | 'fea' | 'cost' | 'variants' | 'motion' }) {
  return (
    <div
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

function EngineeringTab({ isKo }: { isKo: boolean }) {
  return (
    <div style={{ padding: '10px 12px' }}>
      <FeatureCatalogPanel
        routes={ENGINEERING_ROUTES}
        routeLabels={isKo ? ENG_ROUTE_LABELS_KO : ENG_ROUTE_LABELS_EN}
        license="pro"
        dict={isKo ? ENG_CATALOG_DICT_KO : ENG_CATALOG_DICT_EN}
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

