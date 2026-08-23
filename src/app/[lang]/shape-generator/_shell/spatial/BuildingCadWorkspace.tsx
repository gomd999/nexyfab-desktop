'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { buildBuildingArchitectureDocument, buildingViewerParts, normalizeBuildingSpatialParameters, type BuildingSpatialParameters } from '@/lib/cad/buildingSpatialModel';
import { saveSpatialDesignBriefHandoff, SPATIAL_AI_HANDOFF_REQUEST_EVENT, takeSpatialDesignBriefHandoffAny, takeSpatialDesignCandidateReturnV2 } from '@/lib/ai/spatialDesignBriefHandoff';
import { createSpatialDocumentId, saveSpatialCadDraftHandoff } from '@/lib/ai/spatialDesignBriefBuilder';
import { spatialCadDocumentSnapshot, useSpatialCadContentHash } from '@/lib/ai/spatialDesignBriefBuilder';
import type { SpatialAiCandidate } from '@/lib/ai/spatialAiCandidate';
import { SPATIAL_CAD_COMMAND_EVENT, type SpatialCadCommandDetail } from './spatialCadCommands';
import { SpatialCadTransactionStatus, useSpatialCadTransaction } from './useSpatialCadTransaction';
import { SpatialPaneResizers } from './SpatialPaneResizers';
import { SpatialAiCandidateBridge } from './SpatialAiCandidateBridge';
import { ArchitectureInteriorAgentStatusPanel } from './ArchitectureInteriorAgentStatusPanel';
import { ArchitectureInteriorSectionGaugePanel } from './ArchitectureInteriorSectionGaugePanel';
import { ArchitectureInteriorAiDesignPanel } from './ArchitectureInteriorAiDesignPanel';
import { ArchitectureInteriorPrecisionWorkflowPanel } from './ArchitectureInteriorPrecisionWorkflowPanel';
import { ArchitectureInteriorLiveInspector } from './ArchitectureInteriorLiveInspector';

const AssemblyViewer3D = dynamic(() => import('../../../nexyfab/design/AssemblyViewer3D'), { ssr: false });

type State = 'NOT_RUN' | 'RUNNING' | 'PREVIEW' | 'BLOCKED';

interface ArchitectureVerifyPayload {
  ok?: boolean;
  message?: string;
  error?: string;
  releaseReady?: boolean;
  topology?: { releaseReady: boolean; gates: Array<{ id: string; status: 'passed' | 'failed' | 'not_run'; reasons: string[] }>; spaceAreasMm2: Record<string, number> };
  circulation?: { status: 'passed' | 'failed' | 'not_run'; failures?: Array<{ code?: string }> };
}

const DEFAULT_BUILDING: BuildingSpatialParameters = {
  width: 12_000, depth: 8000, storeyCount: 2, storeyHeight: 3200, wallThickness: 200,
  slabThickness: 200, entranceWidth: 1200, windowWidth: 1800, windowCountPerStorey: 1, windowHeight: 1400, windowSill: 900,
};

type BuildingCadParameters = {
  'building width (mm)': number;
  'building depth (mm)': number;
  'storey count': number;
  'storey height (mm)': number;
  'wall thickness (mm)': number;
  'slab thickness (mm)': number;
  'entrance width (mm)': number;
  'window width (mm)': number;
  'windows per storey': number;
  'window height (mm)': number;
  'window sill (mm)': number;
};

function buildingCadParameters(input: BuildingSpatialParameters): BuildingCadParameters {
  return {
    'building width (mm)': input.width, 'building depth (mm)': input.depth,
    'storey count': input.storeyCount, 'storey height (mm)': input.storeyHeight,
    'wall thickness (mm)': input.wallThickness, 'slab thickness (mm)': input.slabThickness,
    'entrance width (mm)': input.entranceWidth, 'window width (mm)': input.windowWidth,
    'windows per storey': input.windowCountPerStorey, 'window height (mm)': input.windowHeight,
    'window sill (mm)': input.windowSill,
  };
}

function buildingSpatialParameters(input: BuildingCadParameters): BuildingSpatialParameters {
  return normalizeBuildingSpatialParameters({
    width: input['building width (mm)'], depth: input['building depth (mm)'],
    storeyCount: input['storey count'], storeyHeight: input['storey height (mm)'],
    wallThickness: input['wall thickness (mm)'], slabThickness: input['slab thickness (mm)'],
    entranceWidth: input['entrance width (mm)'], windowWidth: input['window width (mm)'],
    windowCountPerStorey: input['windows per storey'], windowHeight: input['window height (mm)'],
    windowSill: input['window sill (mm)'],
  });
}

const COPY = {
  ko: {
    browser: '건축 브라우저', project: '개념 건물 01', site: '대지 · 좌표계 미연결', properties: '건물 속성 · 권위 입력',
    plan: '2D 평면', view3d: '3D 건물', geometryPreview: 'CONCEPT · 형상 미리보기', width: '건물 폭', depth: '건물 깊이', storeys: '층 수', storeyHeight: '층고', wall: '벽 두께', slab: '슬래브 두께', entrance: '출입문 폭', window: '창 폭', windowCount: '층별 창 수', windowHeight: '창 높이', sill: '창턱 높이',
    authority: '현재 모델은 개념 입력입니다. 승인 대지경계·측량 좌표·구조/피난 기준이 연결되지 않아 출시 가능한 건축 도면이 아닙니다.',
    run: '건축 topology 검사', running: '검사 중…', reset: '개념값 초기화', notRun: 'NOT_RUN · 검사를 실행하지 않음', preview: 'PREVIEW · topology 계산됨', blocked: 'BLOCKED · 검사를 완료하지 못함',
    results: '건축 검증 게이트', circulation: '동선·계단·피난 모델', circulationMissing: 'NOT_RUN · circulation 모델과 법정 기준 미입력', auth: 'AUTH_REQUIRED · 로그인 후 CAD v1 검사를 실행하세요.', login: '로그인하고 다시 검사',
    mobile: '모바일은 건물 형상 검토용입니다. 치수·권위 입력과 topology 검증은 데스크톱에서 진행하세요.', ai: 'AI 설계 브리프 검토',
  },
  en: {
    browser: 'Building browser', project: 'Concept Building 01', site: 'Site · coordinate authority missing', properties: 'Building properties & authority',
    plan: '2D plan', view3d: '3D building', geometryPreview: 'CONCEPT · geometry preview', width: 'Building width', depth: 'Building depth', storeys: 'Storeys', storeyHeight: 'Storey height', wall: 'Wall thickness', slab: 'Slab thickness', entrance: 'Entrance width', window: 'Window width', windowCount: 'Windows per storey', windowHeight: 'Window height', sill: 'Window sill',
    authority: 'This is a concept model. It is not a releasable building drawing until approved site boundaries, survey coordinates, structural and egress rules are connected.',
    run: 'Run architecture topology', running: 'Checking…', reset: 'Reset concept', notRun: 'NOT_RUN · check has not run', preview: 'PREVIEW · topology calculated', blocked: 'BLOCKED · check could not complete',
    results: 'Architecture verification gates', circulation: 'Circulation, stairs & egress', circulationMissing: 'NOT_RUN · circulation model and governed rules are missing', auth: 'AUTH_REQUIRED · sign in to run the CAD v1 check.', login: 'Sign in and run again',
    mobile: 'Mobile is for building review. Use desktop for dimensions, authority inputs and topology verification.', ai: 'Review AI design brief',
  },
} as const;

const BUILDING_COPY = {
  ...COPY,
  ja: { ...COPY.en, browser: '建築ブラウザー', project: 'コンセプト建物 01', site: '敷地・座標系未接続', properties: '建物プロパティと権限', plan: '2D 平面図', view3d: '3D 建物', width: '建物幅', depth: '建物奥行き', storeys: '階数', storeyHeight: '階高', wall: '壁厚', slab: 'スラブ厚', windowCount: '各階の窓数', run: '建築トポロジーを検査', running: '検査中…', reset: 'コンセプトをリセット', results: '建築検証ゲート', ai: 'AI 設計ブリーフを確認' },
  zh: { ...COPY.en, browser: '建筑浏览器', project: '概念建筑 01', site: '场地和坐标系未连接', properties: '建筑属性与权限', plan: '2D 平面图', view3d: '3D 建筑', width: '建筑宽度', depth: '建筑深度', storeys: '楼层数', storeyHeight: '层高', wall: '墙厚', slab: '楼板厚度', windowCount: '每层窗户数', run: '检查建筑拓扑', running: '检查中…', reset: '重置概念', results: '建筑验证门', ai: '查看 AI 设计简报' },
  es: { ...COPY.en, browser: 'Navegador de edificios', project: 'Edificio conceptual 01', site: 'Sitio y coordenadas sin conectar', properties: 'Propiedades y autoridad', plan: 'Plano 2D', view3d: 'Edificio 3D', width: 'Ancho del edificio', depth: 'Fondo del edificio', storeys: 'Plantas', storeyHeight: 'Altura de planta', wall: 'Espesor de muro', slab: 'Espesor de losa', windowCount: 'Ventanas por planta', run: 'Comprobar topología', running: 'Comprobando…', reset: 'Restablecer concepto', results: 'Puertas de verificación', ai: 'Revisar resumen de diseño IA' },
  ar: { ...COPY.en, browser: 'متصفح المبنى', project: 'مبنى تصوري 01', site: 'الموقع ونظام الإحداثيات غير متصلين', properties: 'خصائص المبنى والمرجعية', plan: 'مخطط ثنائي الأبعاد', view3d: 'مبنى ثلاثي الأبعاد', width: 'عرض المبنى', depth: 'عمق المبنى', storeys: 'عدد الطوابق', storeyHeight: 'ارتفاع الطابق', wall: 'سماكة الجدار', slab: 'سماكة البلاطة', windowCount: 'النوافذ لكل طابق', run: 'فحص طوبولوجيا المبنى', running: 'جارٍ الفحص…', reset: 'إعادة ضبط التصور', results: 'بوابات التحقق المعماري', ai: 'مراجعة موجز تصميم الذكاء الاصطناعي' },
} as const;

function buildingLocale(lang: string): keyof typeof BUILDING_COPY {
  if (lang === 'ko' || lang === 'kr') return 'ko';
  return lang === 'ja' || lang === 'zh' || lang === 'es' || lang === 'ar' ? lang : 'en';
}

const field: React.CSSProperties = { width: '100%', height: 30, border: '1px solid var(--nx-border)', borderRadius: 5, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', padding: '0 8px', fontSize: 11 };
const panel: React.CSSProperties = { minWidth: 0, minHeight: 0, background: 'var(--nx-panel)', color: 'var(--nx-text)' };

function publish(state: 'NOT_RUN' | 'PREVIEW' | 'BLOCKED') {
  window.dispatchEvent(new CustomEvent('nexyfab:spatial-verification-status', { detail: { state } }));
}

function BuildingNumberInput({
  id, label, min, max, step, value, onCommit,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    onCommit(parsed);
  };

  return (
    <input
      id={id}
      name={id}
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
      style={field}
    />
  );
}

export function BuildingCadWorkspace({ lang, projectId, onAiDesign }: { lang: string; projectId?: string | null; onAiDesign: () => void }) {
  const t = BUILDING_COPY[buildingLocale(lang)];
  const token = useAuthStore(state => state.token);
  const [params, setParams] = useState(DEFAULT_BUILDING);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [state, setState] = useState<State>('NOT_RUN');
  const [result, setResult] = useState<ArchitectureVerifyPayload | null>(null);
  const restoreProjectDraft = useCallback((restored: BuildingCadParameters) => {
    setParams(buildingSpatialParameters(restored));
    setResult(null);
    setState('NOT_RUN');
    publish('NOT_RUN');
  }, []);
  const transaction = useSpatialCadTransaction('building', buildingCadParameters(DEFAULT_BUILDING), { onRestore: restoreProjectDraft });
  const seedTransaction = transaction.seed;
  const documentIdRef = useRef(createSpatialDocumentId('building'));
  documentIdRef.current = transaction.currentDocumentId;
  const [aiCandidate, setAiCandidate] = useState<SpatialAiCandidate | null>(null);
  const [selectedParameterPath, setSelectedParameterPath] = useState<string | null>(null);
  const normalized = useMemo(() => normalizeBuildingSpatialParameters(params), [params]);
  const currentDocument = useMemo(() => spatialCadDocumentSnapshot('building', transaction.state.revision, buildingCadParameters(normalized)), [normalized, transaction.state.revision]);
  const currentContentHash = useSpatialCadContentHash(currentDocument);
  const architecture = useMemo(() => buildBuildingArchitectureDocument(normalized), [normalized]);
  const viewerParts = useMemo(() => buildingViewerParts(architecture), [architecture]);

  const invalidate = useCallback(() => { setResult(null); setState('NOT_RUN'); publish('NOT_RUN'); }, []);
  const update = useCallback((key: keyof BuildingSpatialParameters, value: number) => {
    const next = normalizeBuildingSpatialParameters({ ...params, [key]: value });
    if (Object.is(normalized[key], next[key])) return;
    setSelectedParameterPath(key === 'width' ? 'building width (mm)' : key === 'depth' ? 'building depth (mm)' : key === 'storeyCount' ? 'storey count' : key === 'storeyHeight' ? 'storey height (mm)' : key === 'wallThickness' ? 'wall thickness (mm)' : key === 'slabThickness' ? 'slab thickness (mm)' : key === 'entranceWidth' ? 'entrance width (mm)' : key === 'windowWidth' ? 'window width (mm)' : key === 'windowCountPerStorey' ? 'windows per storey' : key === 'windowHeight' ? 'window height (mm)' : 'window sill (mm)');
    invalidate();
    setParams(next);
    transaction.commit(buildingCadParameters(next));
  }, [invalidate, normalized, params, transaction]);
  const run = useCallback(async () => {
    setState('RUNNING'); setResult(null);
    try {
      const response = await fetch('/api/cad/v1/architecture/verify/', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ architecture, topologyToleranceMm: 0.1 }),
      });
      const payload = await response.json() as ArchitectureVerifyPayload;
      if (!response.ok || payload.ok === false) {
        setResult(response.status === 401 ? { ...payload, message: t.auth } : payload);
        setState('BLOCKED'); publish('BLOCKED'); return;
      }
      setResult(payload); setState('PREVIEW'); publish('PREVIEW');
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) }); setState('BLOCKED'); publish('BLOCKED');
    }
  }, [architecture, t.auth, token]);

  useEffect(() => { publish('NOT_RUN'); }, []);
  useEffect(() => {
    const returned = takeSpatialDesignCandidateReturnV2(window.sessionStorage, 'building');
    const handoff = returned?.handoff ?? takeSpatialDesignBriefHandoffAny(window.sessionStorage, 'building');
    if (!handoff) return;
    const n = (key: string, fallback: number) => typeof handoff.parameters[key] === 'number' ? handoff.parameters[key] as number : fallback;
    const restored = normalizeBuildingSpatialParameters({
      ...DEFAULT_BUILDING,
      width: n('building width (mm)', DEFAULT_BUILDING.width), depth: n('building depth (mm)', DEFAULT_BUILDING.depth),
      storeyCount: n('storey count', DEFAULT_BUILDING.storeyCount), storeyHeight: n('storey height (mm)', DEFAULT_BUILDING.storeyHeight),
      wallThickness: n('wall thickness (mm)', DEFAULT_BUILDING.wallThickness), slabThickness: n('slab thickness (mm)', DEFAULT_BUILDING.slabThickness),
      entranceWidth: n('entrance width (mm)', DEFAULT_BUILDING.entranceWidth), windowWidth: n('window width (mm)', DEFAULT_BUILDING.windowWidth),
      windowHeight: n('window height (mm)', DEFAULT_BUILDING.windowHeight), windowSill: n('window sill (mm)', DEFAULT_BUILDING.windowSill),
      windowCountPerStorey: n('windows per storey', DEFAULT_BUILDING.windowCountPerStorey),
    });
    seedTransaction(buildingCadParameters(restored), 'baseDocumentRevision' in handoff ? handoff.baseDocumentRevision : 0, 'documentId' in handoff ? handoff.documentId : undefined);
    setAiCandidate(returned?.candidate ?? null);
    setParams(restored);
    setState('NOT_RUN');
    setResult(null);
    publish('NOT_RUN');
  }, [seedTransaction]);
  useEffect(() => {
    const saveDraft = () => {
      void saveSpatialCadDraftHandoff({
        domain: 'building', unit: 'mm', verification: state,
        parameters: {
          width: normalized.width, depth: normalized.depth, storeyCount: normalized.storeyCount,
          storeyHeight: normalized.storeyHeight, wallThickness: normalized.wallThickness, slabThickness: normalized.slabThickness,
          entranceWidth: normalized.entranceWidth, windowWidth: normalized.windowWidth, windowCountPerStorey: normalized.windowCountPerStorey,
          windowHeight: normalized.windowHeight, windowSill: normalized.windowSill,
        },
        missingAuthority: ['approved site boundary and survey coordinates', 'circulation criteria and release evidence', 'authenticated architecture verification'],
        baseDocumentRevision: transaction.state.revision,
        documentId: documentIdRef.current,
        selectedParameterPath,
      });
    };
    const saveLegacyDraft = () => saveSpatialDesignBriefHandoff(window.sessionStorage, {
      domain: 'building', unit: 'mm', verification: state,
      parameters: {
        'building width (mm)': normalized.width, 'building depth (mm)': normalized.depth,
        'storey count': normalized.storeyCount, 'storey height (mm)': normalized.storeyHeight,
        'wall thickness (mm)': normalized.wallThickness, 'slab thickness (mm)': normalized.slabThickness,
        'entrance width (mm)': normalized.entranceWidth, 'window width (mm)': normalized.windowWidth,
        'windows per storey': normalized.windowCountPerStorey,
        'window height (mm)': normalized.windowHeight, 'window sill (mm)': normalized.windowSill,
      },
      missingAuthority: ['approved site boundary and survey coordinates', 'circulation criteria and release evidence', 'authenticated architecture verification'],
    });
    window.addEventListener(SPATIAL_AI_HANDOFF_REQUEST_EVENT, saveDraft);
    window.addEventListener(SPATIAL_AI_HANDOFF_REQUEST_EVENT, saveLegacyDraft);
    return () => { window.removeEventListener(SPATIAL_AI_HANDOFF_REQUEST_EVENT, saveDraft); window.removeEventListener(SPATIAL_AI_HANDOFF_REQUEST_EVENT, saveLegacyDraft); };
  }, [normalized, selectedParameterPath, state, transaction.state.revision]);
  useEffect(() => {
    const onCommand = (event: Event) => {
      const id = (event as CustomEvent<SpatialCadCommandDetail>).detail?.id;
      if (id === 'spatial.plan') setView('plan');
      else if (id === 'spatial.3d') setView('3d');
      else if (id === 'spatial.dimensions') document.getElementById('building-width')?.focus();
      else if (id === 'spatial.add.storey') update('storeyCount', normalized.storeyCount + 1);
      else if (id === 'spatial.add.window') update('windowCountPerStorey', normalized.windowCountPerStorey + 1);
      else if (id === 'spatial.verify') void run();
      else if (id === 'spatial.ai') onAiDesign();
    };
    window.addEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
  }, [normalized.storeyCount, normalized.windowCountPerStorey, onAiDesign, run, update]);

  const fields: Array<[keyof BuildingSpatialParameters, string, number, number, number]> = [
    ['width', t.width, 3000, 100_000, 100], ['depth', t.depth, 3000, 100_000, 100], ['storeyCount', t.storeys, 1, 20, 1],
    ['storeyHeight', t.storeyHeight, 2200, 10_000, 50], ['wallThickness', t.wall, 80, 1000, 10], ['slabThickness', t.slab, 80, 2000, 10],
    ['entranceWidth', t.entrance, 700, 20_000, 50], ['windowWidth', t.window, 300, 20_000, 50], ['windowHeight', t.windowHeight, 300, 10_000, 50], ['windowSill', t.sill, 0, 10_000, 50],
    ['windowCountPerStorey', t.windowCount, 1, 12, 1],
  ];
  const statusText = state === 'NOT_RUN' ? t.notRun : state === 'RUNNING' ? t.running : state === 'PREVIEW' ? t.preview : t.blocked;
  return (
    <div dir={buildingLocale(lang) === 'ar' ? 'rtl' : 'ltr'} data-testid="building-spatial-cad" className="nx-building-workbench nx-spatial-resizable-grid" style={{ width: '100%', height: '100%', minHeight: 0, display: 'grid', overflow: 'hidden', background: 'var(--nx-bg)' }}>
      <aside className="nx-building-side" style={{ ...panel, borderRight: '1px solid var(--nx-border)', padding: 12, overflow: 'auto' }}>
        <b style={{ fontSize: 11 }}>{t.browser}</b>
        <div style={{ marginTop: 10, fontSize: 11 }}>▾ {t.project}</div>
        <div style={{ margin: '7px 0 0 10px', color: 'var(--nx-warn, #d97706)', fontSize: 10 }}>▸ {t.site}</div>
        {architecture.storeys.map(storey => <div key={storey.id} style={{ margin: '7px 0 0 10px', fontSize: 10.5 }}>▸ {storey.name} · {storey.elevationMm} mm</div>)}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--nx-border)', color: state === 'BLOCKED' ? 'var(--nx-danger, #dc2626)' : state === 'NOT_RUN' ? 'var(--nx-warn, #d97706)' : 'var(--nx-accent)', fontSize: 10, fontWeight: 800 }}>{statusText}</div>
      </aside>
      <main data-spatial-drop-zone style={{ minWidth: 0, minHeight: 0, padding: 10, overflow: 'auto' }}>
        <div className="nx-building-mobile" style={{ display: 'none', marginBottom: 8, padding: 8, border: '1px solid var(--nx-warn, #d97706)', borderRadius: 6, color: 'var(--nx-warn, #d97706)', fontSize: 10.5 }}>{t.mobile}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div role="group" aria-label="Building view"><button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')} style={field}>{t.plan}</button><button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')} style={field}>{t.view3d}</button></div>
          <small>{normalized.width} × {normalized.depth} mm · {normalized.storeyCount}F</small>
        </div>
        {view === 'plan' ? <svg data-testid="building-plan" role="img" aria-label={t.plan} viewBox={`-500 -500 ${normalized.width + 1000} ${normalized.depth + 1000}`} style={{ width: '100%', minHeight: 480, border: '1px solid var(--nx-border)', borderRadius: 8, background: 'var(--nx-panel)' }}>
          <rect x="0" y="0" width={normalized.width} height={normalized.depth} fill="color-mix(in srgb, var(--nx-accent) 5%, transparent)" stroke="var(--nx-text)" strokeWidth={normalized.wallThickness} />
          <line x1={normalized.width * .22 - normalized.entranceWidth / 2} y1="0" x2={normalized.width * .22 + normalized.entranceWidth / 2} y2="0" stroke="var(--nx-bg)" strokeWidth={normalized.wallThickness + 20} />
          <path d={`M ${normalized.width * .22 - normalized.entranceWidth / 2} 0 A ${normalized.entranceWidth} ${normalized.entranceWidth} 0 0 1 ${normalized.width * .22 - normalized.entranceWidth / 2 + normalized.entranceWidth} ${normalized.entranceWidth}`} fill="none" stroke="var(--nx-accent)" strokeWidth="35" />
          {Array.from({ length: normalized.windowCountPerStorey }, (_, index) => {
            const center = normalized.width * (index + 1) / (normalized.windowCountPerStorey + 1);
            const width = Math.min(normalized.windowWidth, normalized.width / (normalized.windowCountPerStorey + 1) * .72);
            return <line key={`plan-window-${index}`} x1={center - width / 2} y1="0" x2={center + width / 2} y2="0" stroke="#38bdf8" strokeWidth={normalized.wallThickness + 30} />;
          })}
          <text x={normalized.width / 2} y={normalized.depth / 2} textAnchor="middle" fill="var(--nx-text-2)" fontSize="360">{(normalized.width * normalized.depth / 1e6).toFixed(1)} m² / floor</text>
        </svg> : <div style={{ ...panel, border: '1px solid var(--nx-border)', borderRadius: 8, padding: 8 }}><AssemblyViewer3D parts={viewerParts} height={520} unit="mm" /><small>{t.geometryPreview}</small></div>}
        <ArchitectureInteriorSectionGaugePanel
          lang={lang}
          kind="building"
          widthMm={normalized.width}
          depthMm={normalized.depth}
          heightMm={normalized.storeyCount * normalized.storeyHeight}
          dimensions={[
            { id: 'width', label: t.width, value: normalized.width, min: 3000, max: 100_000, step: 100, unit: 'mm' },
            { id: 'depth', label: t.depth, value: normalized.depth, min: 3000, max: 100_000, step: 100, unit: 'mm' },
            { id: 'storeyHeight', label: t.storeyHeight, value: normalized.storeyHeight, min: 2200, max: 10_000, step: 50, unit: 'mm' },
            { id: 'wallThickness', label: t.wall, value: normalized.wallThickness, min: 80, max: 1000, step: 10, unit: 'mm' },
            { id: 'slabThickness', label: t.slab, value: normalized.slabThickness, min: 80, max: 2000, step: 10, unit: 'mm' },
          ]}
          onDimensionChange={(id, value) => {
            if (id === 'width' || id === 'depth' || id === 'storeyHeight' || id === 'wallThickness' || id === 'slabThickness') update(id, value);
          }}
        />
      </main>
      <aside className="nx-building-side" style={{ ...panel, borderLeft: '1px solid var(--nx-border)', padding: 12, overflow: 'auto' }}>
        <ArchitectureInteriorAgentStatusPanel
          lang={lang}
          track="ai_design"
          maturity="concept"
          geometryVerification={{ status: 'not_run' }}
          remoteProfile={{ exposable: true }}
        />
        <ArchitectureInteriorAiDesignPanel
          lang={lang}
          projectId={projectId}
          construction={{ wallThickness: normalized.wallThickness, slabThickness: normalized.slabThickness, ceilingThickness: null }}
          constraints={{ storeyCount: normalized.storeyCount, storeyHeight: normalized.storeyHeight, maximumFootprintWidth: normalized.width, maximumFootprintDepth: normalized.depth }}
        />
        <ArchitectureInteriorPrecisionWorkflowPanel lang={lang} projectId={projectId} />
        <ArchitectureInteriorLiveInspector lang={lang} projectId={projectId} />
        <b style={{ fontSize: 11 }}>{t.properties}</b>
        <SpatialCadTransactionStatus state={transaction.state} lang={lang} onUndo={transaction.undo} onRedo={transaction.redo} />
        <SpatialAiCandidateBridge candidate={aiCandidate} currentDocument={currentDocument} currentDocumentId={documentIdRef.current} currentContentHash={currentContentHash} currentLocks={transaction.currentLocks} onAuthoritativeCommit={async (next, operation, metadata) => { const n = (key: string, fallback: number) => typeof next[key] === 'number' ? next[key] as number : fallback; const normalizedNext = normalizeBuildingSpatialParameters({ width: n('building width (mm)', normalized.width), depth: n('building depth (mm)', normalized.depth), storeyCount: n('storey count', normalized.storeyCount), storeyHeight: n('storey height (mm)', normalized.storeyHeight), wallThickness: n('wall thickness (mm)', normalized.wallThickness), slabThickness: n('slab thickness (mm)', normalized.slabThickness), entranceWidth: n('entrance width (mm)', normalized.entranceWidth), windowWidth: n('window width (mm)', normalized.windowWidth), windowHeight: n('window height (mm)', normalized.windowHeight), windowSill: n('window sill (mm)', normalized.windowSill), windowCountPerStorey: n('windows per storey', normalized.windowCountPerStorey) }); const committed = await transaction.commitReviewed(buildingCadParameters(normalizedNext), operation, metadata); if (committed) setParams(normalizedNext); return committed; }} onCommit={next => { const n = (key: string, fallback: number) => typeof next[key] === 'number' ? next[key] as number : fallback; const normalizedNext = normalizeBuildingSpatialParameters({ width: n('building width (mm)', normalized.width), depth: n('building depth (mm)', normalized.depth), storeyCount: n('storey count', normalized.storeyCount), storeyHeight: n('storey height (mm)', normalized.storeyHeight), wallThickness: n('wall thickness (mm)', normalized.wallThickness), slabThickness: n('slab thickness (mm)', normalized.slabThickness), entranceWidth: n('entrance width (mm)', normalized.entranceWidth), windowWidth: n('window width (mm)', normalized.windowWidth), windowHeight: n('window height (mm)', normalized.windowHeight), windowSill: n('window sill (mm)', normalized.windowSill), windowCountPerStorey: n('windows per storey', normalized.windowCountPerStorey) }); const committed = transaction.commit(buildingCadParameters(normalizedNext), 'ai'); if (committed) setParams(normalizedNext); return committed; }} onDiscard={() => setAiCandidate(null)} lang={lang} />
        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>{fields.map(([key, label, min, max, step]) => <label key={key} htmlFor={`building-${key}`} style={{ display: 'grid', gridTemplateColumns: '1fr 104px', gap: 7, alignItems: 'center', fontSize: 10.5 }}><span>{label}</span><BuildingNumberInput id={`building-${key}`} label={label} min={min} max={max} step={step} value={normalized[key]} onCommit={value => update(key, value)} /></label>)}</div>
        <div style={{ marginTop: 12, padding: 9, border: '1px solid var(--nx-warn, #d97706)', borderRadius: 6, fontSize: 10.5, lineHeight: 1.5 }}>{t.authority}</div>
        <button type="button" data-testid="building-run-verify" onClick={() => void run()} disabled={state === 'RUNNING'} style={{ marginTop: 10, minHeight: 36, width: '100%', border: 0, borderRadius: 6, background: 'var(--nx-accent)', fontWeight: 800 }}>{state === 'RUNNING' ? t.running : t.run}</button>
        <button type="button" onClick={() => { invalidate(); setParams(DEFAULT_BUILDING); transaction.commit(buildingCadParameters(DEFAULT_BUILDING)); }} style={{ ...field, marginTop: 6 }}>{t.reset}</button>
        <section data-testid="building-verification" aria-live="polite" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--nx-border)', display: 'grid', gap: 5, fontSize: 10.5 }}>
          <b>{t.results}</b>
          {result?.topology?.gates.map(gate => <span key={gate.id}>{gate.id}: <b>{gate.status.toUpperCase()}</b>{gate.reasons.length ? ` · ${gate.reasons.join(' ')}` : ''}</span>)}
          <span>{t.circulation}: <b>{result?.circulation?.status.toUpperCase() ?? 'NOT_RUN'}</b>{result?.circulation?.status === 'not_run' || !result?.circulation ? ` · ${t.circulationMissing}` : ''}</span>
          {(result?.message || result?.error) && <span style={{ color: 'var(--nx-danger, #dc2626)' }}>{result.message ?? result.error}</span>}
          {result?.message === t.auth && <Link href="/login" style={{ color: 'var(--nx-accent)', fontWeight: 800 }}>{t.login}</Link>}
        </section>
        <button type="button" onClick={onAiDesign} style={{ ...field, marginTop: 10 }}>{t.ai}</button>
      </aside>
      <SpatialPaneResizers storageKey="architecture" leftDefault={220} rightDefault={292} />
      <style>{`@media (max-width: 800px){.nx-building-workbench{grid-template-columns:minmax(0,1fr)!important}.nx-building-side{display:none!important}.nx-building-mobile{display:block!important}}`}</style>
    </div>
  );
}
