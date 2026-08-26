'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import type { DesignDomainId, UserExperienceLevel } from '@/lib/ai/domainProfile';
import { saveSpatialDesignBriefHandoff, SPATIAL_AI_HANDOFF_REQUEST_EVENT, takeSpatialDesignBriefHandoffAny, takeSpatialDesignCandidateReturnV2 } from '@/lib/ai/spatialDesignBriefHandoff';
import { createSpatialDocumentId, saveSpatialCadDraftHandoff, spatialCadDocumentSnapshot, useSpatialCadContentHash } from '@/lib/ai/spatialDesignBriefBuilder';
import type { SpatialAiCandidate } from '@/lib/ai/spatialAiCandidate';
import {
  buildInteriorSpatialAssembly,
  interiorViewerParts,
  normalizeInteriorSpatialParameters,
  type InteriorFurnitureItem,
  type InteriorSpatialParameters,
} from '@/lib/cad/interiorSpatialModel';
import { INTERIOR_PLACEMENT_CATALOG } from '@/lib/cad/interiorPlacementDocument';
import {
  buildInteriorBoundaryCheckInput,
  buildInteriorDoorSwingCheckInput,
  buildInteriorEgressCheckInput,
} from '@/lib/cad/interiorGovernedChecks';
import type { InteriorOverlayData, InteriorPlanPlacementController, Furn } from '../../../nexyfab/design/InteriorPlanEditor';
import { dispatchSpatialCadCommand, SPATIAL_CAD_COMMAND_EVENT, type SpatialCadCommandDetail } from './spatialCadCommands';
import { BuildingCadWorkspace } from './BuildingCadWorkspace';
import { LandscapeCadWorkspace } from './LandscapeCadWorkspace';
import { CivilCadWorkspaceTyped } from './CivilCadWorkspaceTyped';
import { SpatialPaneResizers, SpatialResizableHost } from './SpatialPaneResizers';
import { SpatialCadTransactionStatus, useSpatialCadTransaction } from './useSpatialCadTransaction';
import { SpatialActionDock } from './SpatialActionDock';
import { SpatialAiCandidateBridge } from './SpatialAiCandidateBridge';
import { useInteriorPlacementTransaction } from './useInteriorPlacementTransaction';
import { createInteriorPlacementDocument, roomCenteredToTopLeftMm, topLeftToRoomCenteredMm, type InteriorPlacementObject } from '@/lib/cad/interiorPlacementDocument';
import { InteriorPlacementInspector, InteriorPlacementTransactionStatus } from './InteriorPlacementInspector';
import InteriorPlacementAiCandidateBridge from './InteriorPlacementAiCandidateBridge';
import { saveInteriorPlacementAiHandoff, takeInteriorPlacementAiHandoff } from '@/lib/ai/interiorPlacementAiHandoff';
import { INTERIOR_PLACEMENT_AI_CANDIDATE_EVENT, isInteriorPlacementAiCandidate, type InteriorPlacementAiCandidate } from '@/lib/ai/interiorPlacementAiCandidate';
import { ArchitectureInteriorAgentStatusPanel } from './ArchitectureInteriorAgentStatusPanel';
import { ArchitectureInteriorSectionGaugePanel } from './ArchitectureInteriorSectionGaugePanel';
import { ArchitectureInteriorAiDesignPanel } from './ArchitectureInteriorAiDesignPanel';
import { ArchitectureInteriorPrecisionWorkflowPanel } from './ArchitectureInteriorPrecisionWorkflowPanel';
import { ArchitectureInteriorInspector } from './ArchitectureInteriorInspector';
import { ArchitectureInteriorLiveInspector } from './ArchitectureInteriorLiveInspector';
import { DomainProductQualificationPanel } from './DomainProductQualificationPanel';
import type { ArchitectureInteriorSelection, ArchitectureInteriorSelectionSource, ResolvedArchitectureInteriorSelection } from '@/lib/ai/architectureInteriorSelection';

const InteriorPlanEditor = dynamic(() => import('../../../nexyfab/design/InteriorPlanEditor'), { ssr: false });
const AssemblyViewer3D = dynamic(() => import('../../../nexyfab/design/AssemblyViewer3D'), { ssr: false });

type SpatialDomain = Exclude<DesignDomainId, 'mechanical'>;
type ArchitectureInteriorInspectorProps = {
  selection?: ArchitectureInteriorSelection | null;
  source?: ArchitectureInteriorSelectionSource | null;
  onCommit?: (resolved: ResolvedArchitectureInteriorSelection, patch: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;
  onInvalidSelection?: () => void;
};
type VerificationState = 'NOT_RUN' | 'RUNNING' | 'PREVIEW' | 'BLOCKED';

interface InteriorCheckResult extends InteriorOverlayData {
  ok?: boolean;
  error?: string;
  travel?: (NonNullable<InteriorOverlayData['travel']> & { limitM?: number; unreachableM2?: number }) | null;
  egress?: (NonNullable<InteriorOverlayData['egress']> & { verdict?: string; unavailable?: unknown }) | null;
  finishes?: { floorM2?: number; wallM2?: number; ceilingM2?: number; baseboardM?: number } | null;
  disclaimer?: string;
}

interface GovernedGate {
  state: VerificationState;
  passed?: boolean;
  authRequired?: boolean;
  detail: string;
}

interface GovernedChecks {
  boundary: GovernedGate;
  doorSwing: GovernedGate;
  egress: GovernedGate;
}

interface BoundaryApiPayload {
  ok?: boolean;
  message?: string;
  result?: { closed: boolean; openBoundaries: number; loopCount: number; loopAreasMm2: number[]; conservative: boolean };
}

interface DoorSwingApiPayload {
  ok?: boolean;
  message?: string;
  result?: { clear: boolean; minimumEnvelopeDistanceMm: number; requiredEnvelopeDistanceMm: number; collidingObstacleIds: string[]; conservative: boolean };
}

interface EgressApiPayload {
  ok?: boolean;
  message?: string;
  result?: { passed: boolean; reachableExitCount: number; requiredIndependentExits: number; failures: string[]; conservative: boolean };
}

const initialGovernedChecks = (): GovernedChecks => ({
  boundary: { state: 'NOT_RUN', detail: 'NOT_RUN' },
  doorSwing: { state: 'NOT_RUN', detail: 'NOT_RUN' },
  egress: { state: 'NOT_RUN', detail: 'NOT_RUN' },
});

const DEFAULT_INTERIOR: InteriorSpatialParameters = {
  width: 8000,
  depth: 6000,
  ceilingHeight: 2700,
  doorWidth: 1000,
  exitCount: 1,
  rows: 2,
  cols: 3,
  furniture: null,
};

type InteriorCadScalarParameters = Pick<InteriorSpatialParameters, 'width' | 'depth' | 'ceilingHeight' | 'doorWidth' | 'exitCount' | 'rows' | 'cols'>;
const interiorCadScalars = (input: InteriorSpatialParameters): InteriorCadScalarParameters => ({
  width: input.width,
  depth: input.depth,
  ceilingHeight: input.ceilingHeight,
  doorWidth: input.doorWidth,
  exitCount: input.exitCount,
  rows: input.rows,
  cols: input.cols,
});

const INTERIOR_ROOM_DOCUMENT_ID = 'interior-room:v1';
const INTERIOR_PLACEMENT_DOCUMENT_ID = `${INTERIOR_ROOM_DOCUMENT_ID}:placement:v1`;

function seedInteriorPlacementObjects(parameters: InteriorSpatialParameters): InteriorPlacementObject[] {
  const source = parameters.furniture ?? Array.from({ length: Math.min(40, Math.max(1, parameters.rows) * Math.max(1, parameters.cols)) }, (_, index) => ({
    kind: 'table4' as const,
    x: Math.round(800 + ((parameters.width - 1600) / Math.max(1, parameters.cols)) * (index % Math.max(1, parameters.cols) + 0.5) - 600),
    y: Math.round(800 + ((parameters.depth - 2400) / Math.max(1, parameters.rows)) * (Math.floor(index / Math.max(1, parameters.cols)) + 0.5) - 400),
  }));
  return source.slice(0, 40).map((item, index) => {
    const dimensionsMm = INTERIOR_PLACEMENT_CATALOG[item.kind].dimensionsMm;
    return { id: `${INTERIOR_ROOM_DOCUMENT_ID}:object:${index + 1}`, catalogType: item.kind, spaceId: INTERIOR_ROOM_DOCUMENT_ID, pose: { positionMm: topLeftToRoomCenteredMm([item.x, item.y], [parameters.width, parameters.depth, parameters.ceilingHeight], dimensionsMm), rotationDeg: [0, 0, 0] }, dimensionsMm, clearanceMm: [0, 0, 0] };
  });
}

function placementToLegacyFurniture(objects: readonly InteriorPlacementObject[], width: number, depth: number): Furn[] {
  return objects.map(object => {
    const kind = (object.catalogType in INTERIOR_PLACEMENT_CATALOG ? object.catalogType : 'table4') as Furn['kind'];
    const [x, y] = roomCenteredToTopLeftMm(object.pose.positionMm, [width, depth, Math.max(1, object.dimensionsMm[2])], object.dimensionsMm, object.pose.rotationDeg, object.clearanceMm);
    return { id: object.id, kind, x, y };
  });
}

const COPY = {
  ko: {
    preview: 'PREVIEW · 실측/호스트 도면 권한 미확인', notRun: 'NOT_RUN · 검증을 실행하지 않음',
    checked: 'PREVIEW · 계산 실행됨 (출시 검증 아님)', blocked: 'BLOCKED · 계산을 완료하지 못함',
    tree: '공간 브라우저', room: '카페 공간 01', level: '레벨 01', floor: '바닥', walls: '벽 · 개구부', furniture: '가구',
    plan: '2D 평면', view3d: '3D 공간', properties: '속성 · 권위 입력', width: '실내 폭', depth: '실내 깊이', ceiling: '천장고', door: '주 출입문 폭', exits: '출구 수',
    authority: '현재 치수는 개념 설계 입력입니다. 현장 실측값이나 승인된 건축 호스트 도면을 연결하기 전에는 정밀·출시 상태가 아닙니다.',
    checkBasis: '검토 기준 입력', occupancy: '1인당 점유면적 (m²/인)', travelLimit: '보행거리 한계 (m)', targetLux: '목표 조도 (lx)', lumen: '등기구 광속 (lm)', doorThickness: '문짝 두께 (mm)', doorClearance: '문 회전 추가 여유 (mm)', minimumClearWidth: '법정 최소 통로폭 (mm)', requiredIndependentExits: '요구 독립 출구 수',
    run: '공간 검사 실행', running: '계산 중…', reset: '개념값 초기화', results: '계산 결과', governed: '보수적 검증 게이트', boundary: '공간 경계 폐합', doorSwing: '문 회전 여유', egressGraph: '피난 route graph',
    travel: '최원점 보행거리', egress: '피난폭', finishes: '마감 물량', missingDensity: '점유면적을 입력해야 피난폭 PASS/FAIL을 계산합니다.',
    missingDoorThickness: '문짝 두께를 입력해야 문 회전 검사를 실행합니다.', missingRouteGraph: '법정 최소 통로폭과 요구 독립 출구 수를 입력해야 route graph를 생성합니다.', authRequired: 'AUTH_REQUIRED · 로그인 후 v1 검사를 실행하세요.', login: '로그인하고 다시 검사',
    mobile: '모바일은 배치 검토용입니다. 치수·권위 입력과 검증 실행은 데스크톱에서 진행하세요.',
    domainBeta: '공간 CAD Beta · 현재 도메인 전용 형상 편집기는 아직 구현되지 않았습니다.',
    noMechanical: '기계 CAD 형상을 대신 표시하지 않습니다. 아래 계약·필수 입력·증빙 게이트만 제공하며, 형상 도구는 구현 전까지 노출하지 않습니다.',
    requirements: '권위 입력', evidence: '검증 축', deliverables: '산출물', schemas: '문서 스키마', manualTools: '계획된 수동 도구 (NOT_IMPLEMENTED)', ai: 'AI 설계 브리프로 계속',
  },
  en: {
    preview: 'PREVIEW · field/host authority not confirmed', notRun: 'NOT_RUN · checks have not been run',
    checked: 'PREVIEW · calculations run (not release verification)', blocked: 'BLOCKED · calculation could not complete',
    tree: 'Spatial browser', room: 'Cafe Space 01', level: 'Level 01', floor: 'Floor', walls: 'Walls & openings', furniture: 'Furniture',
    plan: '2D plan', view3d: '3D spatial', properties: 'Properties & authority', width: 'Interior width', depth: 'Interior depth', ceiling: 'Ceiling height', door: 'Main door width', exits: 'Exit count',
    authority: 'These dimensions are concept inputs. The model is not precise or releasable until field measurements or an approved host drawing is connected.',
    checkBasis: 'Check-basis inputs', occupancy: 'Occupant area (m²/person)', travelLimit: 'Travel limit (m)', targetLux: 'Target illuminance (lx)', lumen: 'Luminaire flux (lm)', doorThickness: 'Door-leaf thickness (mm)', doorClearance: 'Extra door clearance (mm)', minimumClearWidth: 'Governed minimum clear width (mm)', requiredIndependentExits: 'Required independent exits',
    run: 'Run spatial checks', running: 'Calculating…', reset: 'Reset concept', results: 'Calculation results', governed: 'Conservative verification gates', boundary: 'Space-boundary closure', doorSwing: 'Door-swing clearance', egressGraph: 'Egress route graph',
    travel: 'Farthest travel', egress: 'Egress width', finishes: 'Finish quantities', missingDensity: 'Enter occupant area to calculate an egress-width PASS/FAIL.',
    missingDoorThickness: 'Enter door-leaf thickness to run the door-swing check.', missingRouteGraph: 'Enter governed minimum clear width and required independent exits to build the route graph.', authRequired: 'AUTH_REQUIRED · sign in to run the v1 check.', login: 'Sign in and run again',
    mobile: 'Mobile is for layout review. Use desktop for dimensions, authority inputs and verification runs.',
    domainBeta: 'Spatial CAD Beta · a domain-specific geometry editor is not implemented yet.',
    noMechanical: 'Mechanical CAD geometry is not substituted. Only the contract, required inputs and evidence gates are shown until the spatial tools exist.',
    requirements: 'Authoritative inputs', evidence: 'Evidence axes', deliverables: 'Deliverables', schemas: 'Document schemas', manualTools: 'Planned manual tools (NOT_IMPLEMENTED)', ai: 'Continue in AI design brief',
  },
} as const;

const SPATIAL_COPY = {
  ...COPY,
  ja: { ...COPY.en, tree: '空間ブラウザー', room: 'カフェ空間 01', level: 'レベル 01', floor: '床', walls: '壁と開口部', furniture: '家具', plan: '2D 平面図', view3d: '3D 空間', properties: 'プロパティと権限', width: '室内幅', depth: '室内奥行き', ceiling: '天井高', door: '主出入口幅', exits: '出口数', run: '空間検査を実行', running: '計算中…', reset: 'コンセプトをリセット', results: '計算結果', requirements: '権威ある入力', evidence: '証拠軸', deliverables: '成果物', ai: 'AI 設計ブリーフへ進む' },
  zh: { ...COPY.en, tree: '空间浏览器', room: '咖啡空间 01', level: '楼层 01', floor: '地板', walls: '墙体和开口', furniture: '家具', plan: '2D 平面图', view3d: '3D 空间', properties: '属性与权限', width: '室内宽度', depth: '室内深度', ceiling: '层高', door: '主入口宽度', exits: '出口数', run: '运行空间检查', running: '计算中…', reset: '重置概念', results: '计算结果', requirements: '权威输入', evidence: '证据维度', deliverables: '交付物', ai: '继续 AI 设计简报' },
  es: { ...COPY.en, tree: 'Navegador espacial', room: 'Espacio Café 01', level: 'Nivel 01', floor: 'Suelo', walls: 'Muros y aberturas', furniture: 'Mobiliario', plan: 'Plano 2D', view3d: 'Espacio 3D', properties: 'Propiedades y autoridad', width: 'Ancho interior', depth: 'Fondo interior', ceiling: 'Altura de techo', door: 'Ancho de puerta principal', exits: 'Número de salidas', run: 'Ejecutar comprobaciones', running: 'Calculando…', reset: 'Restablecer concepto', results: 'Resultados del cálculo', requirements: 'Entradas autorizadas', evidence: 'Ejes de evidencia', deliverables: 'Entregables', ai: 'Continuar con el resumen de diseño IA' },
  ar: { ...COPY.en, tree: 'متصفح المساحة', room: 'مساحة مقهى 01', level: 'المستوى 01', floor: 'الأرضية', walls: 'الجدران والفتحات', furniture: 'الأثاث', plan: 'مخطط ثنائي الأبعاد', view3d: 'مساحة ثلاثية الأبعاد', properties: 'الخصائص والمرجعية', width: 'العرض الداخلي', depth: 'العمق الداخلي', ceiling: 'ارتفاع السقف', door: 'عرض المدخل الرئيسي', exits: 'عدد المخارج', run: 'تشغيل فحوص المساحة', running: 'جارٍ الحساب…', reset: 'إعادة ضبط التصور', results: 'نتائج الحساب', requirements: 'المدخلات المعتمدة', evidence: 'محاور الأدلة', deliverables: 'المخرجات', ai: 'المتابعة إلى موجز تصميم الذكاء الاصطناعي' },
} as const;

function locale(lang: string): keyof typeof SPATIAL_COPY {
  if (lang === 'ko' || lang === 'kr') return 'ko';
  return lang === 'ja' || lang === 'zh' || lang === 'es' || lang === 'ar' ? lang : 'en';
}

const panel: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  background: 'var(--nx-panel)',
  borderColor: 'var(--nx-border)',
  color: 'var(--nx-text)',
};

const fieldStyle: React.CSSProperties = {
  width: '100%', height: 30, borderRadius: 5, border: '1px solid var(--nx-border)',
  background: 'var(--nx-panel-2)', color: 'var(--nx-text)', padding: '0 8px', fontSize: 12,
};

function StatusBadge({ state, label }: { state: VerificationState | 'PREVIEW'; label: string }) {
  const color = state === 'BLOCKED' ? 'var(--nx-danger, #dc2626)' : state === 'NOT_RUN' ? 'var(--nx-warn, #d97706)' : 'var(--nx-accent)';
  return <span data-testid={`spatial-status-${state.toLowerCase()}`} style={{ display: 'inline-flex', padding: '3px 8px', border: `1px solid ${color}`, borderRadius: 12, color, fontSize: 10, fontWeight: 800 }}>{label}</span>;
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function SpatialNumberInput({ value, min, max, step = 50, testId, inputRef, onCommit }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  testId: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const normalized = Math.min(max, Math.max(min, parsed));
    setDraft(String(normalized));
    if (normalized !== value) onCommit(normalized);
  };
  return (
    <input
      ref={inputRef}
      id={testId}
      name={testId}
      data-testid={testId}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur(); } }}
      style={fieldStyle}
    />
  );
}

function publishSpatialVerification(state: 'NOT_RUN' | 'PREVIEW' | 'BLOCKED'): void {
  window.dispatchEvent(new CustomEvent('nexyfab:spatial-verification-status', { detail: { state } }));
}

function InteriorWorkspace({ lang, experience, architectureInteriorInspector }: { lang: string; experience: UserExperienceLevel; architectureInteriorInspector?: ArchitectureInteriorInspectorProps }) {
  const t = SPATIAL_COPY[locale(lang)];
  const token = useAuthStore(state => state.token);
  const sessionStatus = useAuthStore(state => state.sessionStatus);
  const [params, setParams] = useState<InteriorSpatialParameters>(DEFAULT_INTERIOR);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [result, setResult] = useState<InteriorCheckResult | null>(null);
  const [verification, setVerification] = useState<VerificationState>('NOT_RUN');
  const [governed, setGoverned] = useState<GovernedChecks>(initialGovernedChecks);
  const [basis, setBasis] = useState({ occupantDensityM2: 0, travelLimitM: 30, targetLux: 0, lampLumen: 0, doorThicknessMm: 0, requiredDoorClearanceMm: 0, minimumClearWidthMm: 0, minimumIndependentExits: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const dimensionRef = useRef<HTMLInputElement | null>(null);
  const ceilingRef = useRef<HTMLInputElement | null>(null);
  const planRef = useRef<HTMLDivElement | null>(null);
  const restoreProjectDraft = useCallback((restored: InteriorCadScalarParameters) => {
    setParams(current => normalizeInteriorSpatialParameters({ ...current, ...restored }));
    setResult(null); setGoverned(initialGovernedChecks()); setVerification('NOT_RUN'); publishSpatialVerification('NOT_RUN');
  }, []);
  const transaction = useSpatialCadTransaction('interior', interiorCadScalars(DEFAULT_INTERIOR), { onRestore: restoreProjectDraft });
  const seedTransaction = transaction.seed;
  const documentIdRef = useRef(createSpatialDocumentId('interior'));
  documentIdRef.current = transaction.currentDocumentId;
  const [aiCandidate, setAiCandidate] = useState<SpatialAiCandidate | null>(null);
  const [selectedParameterPath, setSelectedParameterPath] = useState<string | null>(null);

  const invalidate = useCallback(() => {
    abortRef.current?.abort();
    setResult(null);
    setGoverned(initialGovernedChecks());
    setVerification('NOT_RUN');
    publishSpatialVerification('NOT_RUN');
  }, []);

  const normalized = useMemo(() => normalizeInteriorSpatialParameters(params), [params]);
  const placementSeed = useMemo(() => createInteriorPlacementDocument({ documentId: INTERIOR_PLACEMENT_DOCUMENT_ID, roomDocumentId: INTERIOR_ROOM_DOCUMENT_ID, roomSizeMm: [DEFAULT_INTERIOR.width, DEFAULT_INTERIOR.depth, DEFAULT_INTERIOR.ceilingHeight], objects: seedInteriorPlacementObjects(DEFAULT_INTERIOR) }), []);
  const projectId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('project') ?? new URLSearchParams(window.location.search).get('projectId');
  const placementTransaction = useInteriorPlacementTransaction(placementSeed, { projectId, roomBasis: { roomDocumentId: INTERIOR_ROOM_DOCUMENT_ID, roomSizeMm: [normalized.width, normalized.depth, normalized.ceilingHeight] } });
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [placementAiCandidate, setPlacementAiCandidate] = useState<InteriorPlacementAiCandidate | null>(null);
  const placementFurniture = useMemo(() => placementToLegacyFurniture(placementTransaction.currentDocument.objects, normalized.width, normalized.depth), [normalized.depth, normalized.width, placementTransaction.currentDocument.objects]);
  const legacyNormalized = useMemo(() => ({ ...normalized, furniture: placementFurniture }), [normalized, placementFurniture]);
  const placementController = useMemo<InteriorPlanPlacementController>(() => ({
    objects: placementTransaction.currentDocument.objects,
    selectedObjectId,
    onSelectObject: setSelectedObjectId,
    onPreviewMove: (objectId, positionMm) => { placementTransaction.previewMove(objectId, positionMm); },
    onCommitMove: async (objectId, positionMm) => { if (await placementTransaction.moveObject(objectId, positionMm)) { invalidate(); setSelectedObjectId(objectId); } },
    onAddObject: async (kind, positionMm) => {
      if (placementTransaction.currentDocument.objects.length >= 40) return;
      const dimensionsMm = INTERIOR_PLACEMENT_CATALOG[kind].dimensionsMm;
      if (await placementTransaction.addObject({ id: '', catalogType: kind, spaceId: INTERIOR_ROOM_DOCUMENT_ID, pose: { positionMm: positionMm ?? [0, 0, 0], rotationDeg: [0, 0, 0] }, dimensionsMm, clearanceMm: [0, 0, 0] })) invalidate();
    },
    onDeleteObject: async objectId => { if (await placementTransaction.deleteObject(objectId)) { invalidate(); setSelectedObjectId(null); } },
  }), [invalidate, placementTransaction, selectedObjectId]);
  const selectedPlacementObject = placementTransaction.currentDocument.objects.find(object => object.id === selectedObjectId) ?? null;
  useEffect(() => { if (selectedObjectId && !selectedPlacementObject) setSelectedObjectId(null); }, [selectedObjectId, selectedPlacementObject]);
  const assembly = useMemo(() => buildInteriorSpatialAssembly(legacyNormalized), [legacyNormalized]);
  const viewerParts = useMemo(() => interiorViewerParts(assembly), [assembly]);
  const currentDocument = useMemo(() => spatialCadDocumentSnapshot('interior', transaction.state.revision, interiorCadScalars(normalized)), [normalized, transaction.state.revision]);
  const currentContentHash = useSpatialCadContentHash(currentDocument);

  const updateParam = useCallback((key: keyof InteriorSpatialParameters, value: number) => {
    const next = normalizeInteriorSpatialParameters({ ...params, [key]: value });
    if (Object.is(normalized[key], next[key])) return;
    setSelectedParameterPath(String(key));
    invalidate();
    setParams(next); transaction.commit(interiorCadScalars(next));
  }, [invalidate, normalized, params, transaction]);

  const onFurnitureChange = useCallback((furniture: InteriorFurnitureItem[] | null) => {
    invalidate();
    void furniture;
  }, [invalidate]);

  const runChecks = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setVerification('RUNNING');
    setResult(null);
    const boundaryInput = buildInteriorBoundaryCheckInput(legacyNormalized);
    const doorInput = buildInteriorDoorSwingCheckInput(legacyNormalized, assembly, basis.doorThicknessMm, basis.requiredDoorClearanceMm);
    const egressInput = buildInteriorEgressCheckInput(legacyNormalized, assembly, basis.travelLimitM * 1000, basis.minimumClearWidthMm, basis.minimumIndependentExits);
    setGoverned({
      boundary: { state: 'RUNNING', detail: t.running },
      doorSwing: doorInput ? { state: 'RUNNING', detail: t.running } : { state: 'NOT_RUN', detail: t.missingDoorThickness },
      egress: egressInput ? { state: 'RUNNING', detail: t.running } : { state: 'NOT_RUN', detail: t.missingRouteGraph },
    });
    try {
      const request = (url: string, body: unknown) => fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(url.startsWith('/api/cad/v1/') && token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      const [response, boundaryResponse, doorResponse, egressResponse] = await Promise.all([
        request('/api/nexyfab/drawing/interior-check/', {
          assembly,
          params: {
            returnGrid: true,
            ceilingHmm: normalized.ceilingHeight,
            travelLimitMm: basis.travelLimitM * 1000,
            ...(basis.occupantDensityM2 > 0 ? { occupantDensityM2: basis.occupantDensityM2 } : {}),
            ...(basis.targetLux > 0 ? { targetLux: basis.targetLux } : {}),
            ...(basis.lampLumen > 0 ? { lampLumen: basis.lampLumen } : {}),
          },
        }),
        request('/api/cad/v1/interior/space-boundary/verify/', boundaryInput),
        doorInput ? request('/api/cad/v1/interior/door-swing/verify/', doorInput) : Promise.resolve(null),
        egressInput ? request('/api/cad/v1/interior/egress/verify/', egressInput) : Promise.resolve(null),
      ]);
      const [payload, boundaryPayload, doorPayload, egressPayload] = await Promise.all([
        response.json() as Promise<InteriorCheckResult>,
        boundaryResponse.json() as Promise<BoundaryApiPayload>,
        doorResponse ? doorResponse.json() as Promise<DoorSwingApiPayload> : Promise.resolve(null),
        egressResponse ? egressResponse.json() as Promise<EgressApiPayload> : Promise.resolve(null),
      ]);
      const boundaryValid = boundaryResponse.ok && boundaryPayload.ok !== false && !!boundaryPayload.result;
      const doorValid = !doorResponse || (doorResponse.ok && doorPayload?.ok !== false && !!doorPayload?.result);
      const egressValid = !egressResponse || (egressResponse.ok && egressPayload?.ok !== false && !!egressPayload?.result);
      // A successful HTTP response is not a passed gate. A real, executed
      // false result must keep the workspace BLOCKED until the user changes
      // the draft and reruns the governed check.
      const boundaryPassed = boundaryValid && boundaryPayload.result!.closed;
      const doorPassed = !doorResponse || (doorValid && doorPayload!.result!.clear);
      const egressPassed = !egressResponse || (egressValid && egressPayload!.result!.passed);
      setGoverned({
        boundary: boundaryValid
          ? { state: 'PREVIEW', passed: boundaryPayload.result!.closed, detail: `${boundaryPayload.result!.loopCount} loop · ${boundaryPayload.result!.openBoundaries} open` }
          : { state: 'BLOCKED', authRequired: boundaryResponse.status === 401, detail: boundaryResponse.status === 401 ? t.authRequired : boundaryPayload.message ?? `HTTP ${boundaryResponse.status}` },
        doorSwing: !doorInput
          ? { state: 'NOT_RUN', detail: t.missingDoorThickness }
          : doorValid
            ? { state: 'PREVIEW', passed: doorPayload!.result!.clear, detail: doorPayload!.result!.collidingObstacleIds.length ? doorPayload!.result!.collidingObstacleIds.join(', ') : `${doorPayload!.result!.minimumEnvelopeDistanceMm.toFixed(1)} mm min` }
            : { state: 'BLOCKED', authRequired: doorResponse?.status === 401, detail: doorResponse?.status === 401 ? t.authRequired : doorPayload?.message ?? `HTTP ${doorResponse?.status ?? 0}` },
        egress: !egressInput
          ? { state: 'NOT_RUN', detail: t.missingRouteGraph }
          : egressValid
            ? { state: 'PREVIEW', passed: egressPayload!.result!.passed, detail: `${egressPayload!.result!.reachableExitCount}/${egressPayload!.result!.requiredIndependentExits} exits${egressPayload!.result!.failures.length ? ` · ${egressPayload!.result!.failures.join(', ')}` : ''}` }
            : { state: 'BLOCKED', authRequired: egressResponse?.status === 401, detail: egressResponse?.status === 401 ? t.authRequired : egressPayload?.message ?? `HTTP ${egressResponse?.status ?? 0}` },
      });
      if (!response.ok || payload.ok === false || !boundaryValid || !doorValid || !egressValid || !boundaryPassed || !doorPassed || !egressPassed) {
        const errors = [
          !response.ok || payload.ok === false ? payload.error ?? `HTTP ${response.status}` : '',
          !boundaryValid ? boundaryResponse.status === 401 ? t.authRequired : boundaryPayload.message ?? `Boundary HTTP ${boundaryResponse.status}` : !boundaryPassed ? 'Boundary gate failed' : '',
          !doorValid ? doorResponse?.status === 401 ? t.authRequired : doorPayload?.message ?? `Door HTTP ${doorResponse?.status ?? 0}` : !doorPassed ? 'Door-swing gate failed' : '',
          !egressValid ? egressResponse?.status === 401 ? t.authRequired : egressPayload?.message ?? `Egress HTTP ${egressResponse?.status ?? 0}` : !egressPassed ? 'Egress gate failed' : '',
        ].filter(Boolean);
        setResult({ ...payload, ok: false, error: errors.join(' · ') });
        setVerification('BLOCKED');
        publishSpatialVerification('BLOCKED');
        return;
      }
      setResult(payload);
      setVerification('PREVIEW');
      publishSpatialVerification('PREVIEW');
    } catch (error) {
      if (controller.signal.aborted) return;
      setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
      setGoverned(current => ({
        boundary: current.boundary.state === 'RUNNING' ? { state: 'BLOCKED', detail: error instanceof Error ? error.message : String(error) } : current.boundary,
        doorSwing: current.doorSwing.state === 'RUNNING' ? { state: 'BLOCKED', detail: error instanceof Error ? error.message : String(error) } : current.doorSwing,
        egress: current.egress.state === 'RUNNING' ? { state: 'BLOCKED', detail: error instanceof Error ? error.message : String(error) } : current.egress,
      }));
      setVerification('BLOCKED');
      publishSpatialVerification('BLOCKED');
    }
  }, [assembly, basis, legacyNormalized, normalized, t, token]);

  useEffect(() => {
    publishSpatialVerification('NOT_RUN');
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    const returned = takeSpatialDesignCandidateReturnV2(window.sessionStorage, 'interior');
    const handoff = returned?.handoff ?? takeSpatialDesignBriefHandoffAny(window.sessionStorage, 'interior');
    if (!handoff) return;
    const n = (key: keyof InteriorCadScalarParameters, legacy: string, fallback: number) => typeof handoff.parameters[key] === 'number' ? handoff.parameters[key] as number : typeof handoff.parameters[legacy] === 'number' ? handoff.parameters[legacy] as number : fallback;
    const restored = normalizeInteriorSpatialParameters({
      ...DEFAULT_INTERIOR,
      width: n('width', 'room width (mm)', DEFAULT_INTERIOR.width), depth: n('depth', 'room depth (mm)', DEFAULT_INTERIOR.depth),
      ceilingHeight: n('ceilingHeight', 'ceiling height (mm)', DEFAULT_INTERIOR.ceilingHeight), doorWidth: n('doorWidth', 'door width (mm)', DEFAULT_INTERIOR.doorWidth),
      exitCount: n('exitCount', 'exit count', DEFAULT_INTERIOR.exitCount), rows: n('rows', 'furniture rows', DEFAULT_INTERIOR.rows), cols: n('cols', 'furniture columns', DEFAULT_INTERIOR.cols),
    });
    seedTransaction(interiorCadScalars(restored), 'baseDocumentRevision' in handoff ? handoff.baseDocumentRevision : 0, 'documentId' in handoff ? handoff.documentId : undefined);
    setAiCandidate(returned?.candidate ?? null);
    setParams(restored);
    setBasis(current => ({ ...current, travelLimitM: typeof handoff.parameters['travel limit (m)'] === 'number' ? handoff.parameters['travel limit (m)'] as number : current.travelLimitM }));
    setResult(null);
    setGoverned(initialGovernedChecks());
    setVerification('NOT_RUN');
    publishSpatialVerification('NOT_RUN');
  }, [seedTransaction]);
  useEffect(() => {
    const saveDraft = () => {
      const missingAuthority = [
        !basis.occupantDensityM2 && 'occupant density',
        (!basis.targetLux || !basis.lampLumen) && 'lighting target and lamp output',
        (!basis.doorThicknessMm || !basis.requiredDoorClearanceMm) && 'door thickness and required swing clearance',
        (!basis.minimumClearWidthMm || !basis.minimumIndependentExits) && 'egress clear width and required independent exits',
        'authenticated governed-check evidence',
      ].filter(Boolean) as string[];
      const legacyParameters = {
        'room width (mm)': normalized.width, 'room depth (mm)': normalized.depth,
        'ceiling height (mm)': normalized.ceilingHeight, 'door width (mm)': normalized.doorWidth,
        'exit count': normalized.exitCount, 'furniture rows': normalized.rows,
        'furniture columns': normalized.cols, 'furniture item count': normalized.furniture?.length ?? assembly.furniture[0].count,
        'travel limit (m)': basis.travelLimitM,
      };
      const parameters = interiorCadScalars(normalized);
      saveSpatialDesignBriefHandoff(window.sessionStorage, { domain: 'interior', unit: 'mm', verification, parameters: legacyParameters, missingAuthority });
      void saveSpatialCadDraftHandoff({
        domain: 'interior', unit: 'mm', verification,
        parameters,
        missingAuthority,
        baseDocumentRevision: transaction.state.revision,
        documentId: documentIdRef.current,
        selectedParameterPath,
      });
      if (sessionStatus === 'authenticated' && projectId && selectedPlacementObject && placementTransaction.projectRevision >= 0 && placementTransaction.contentHash) {
        saveInteriorPlacementAiHandoff(window.sessionStorage, {
          projectId,
          placementDocumentId: placementTransaction.currentDocument.documentId,
          roomDocumentId: placementTransaction.currentDocument.roomDocumentId,
          docRevision: placementTransaction.currentDocument.revision,
          projectRevision: placementTransaction.projectRevision,
          contentHash: placementTransaction.contentHash,
          selectedObjectId: selectedPlacementObject.id,
          parameterPaths: ['pose.positionMm', 'pose.rotationDeg', 'dimensionsMm', 'clearanceMm'],
          currentLocks: placementTransaction.currentLocks,
        });
      }
    };
    window.addEventListener(SPATIAL_AI_HANDOFF_REQUEST_EVENT, saveDraft);
    return () => window.removeEventListener(SPATIAL_AI_HANDOFF_REQUEST_EVENT, saveDraft);
  }, [assembly.furniture, basis, normalized, placementTransaction, projectId, selectedParameterPath, selectedPlacementObject, sessionStatus, transaction.state.revision, verification]);
  useEffect(() => {
    // Placement packets are consumed independently from scalar CAD briefs.
    // They are intentionally not projected into `params` or the scalar bridge.
    const handoff = takeInteriorPlacementAiHandoff(window.sessionStorage);
    if (!handoff || handoff.projectId !== projectId || handoff.placementDocumentId !== placementTransaction.currentDocument.documentId) return;
    const selected = placementTransaction.currentDocument.objects.find(object => object.id === handoff.selectedObjectId);
    if (!selected) return;
    setSelectedObjectId(selected.id);
  }, [placementTransaction.currentDocument.documentId, placementTransaction.currentDocument.objects, projectId]);
  useEffect(() => {
    const receiveCandidate = (event: Event) => {
      const candidate = (event as CustomEvent<unknown>).detail;
      if (!isInteriorPlacementAiCandidate(candidate) || candidate.projectId !== projectId || candidate.placementDocumentId !== placementTransaction.currentDocument.documentId) return;
      setPlacementAiCandidate(candidate);
    };
    window.addEventListener(INTERIOR_PLACEMENT_AI_CANDIDATE_EVENT, receiveCandidate);
    return () => window.removeEventListener(INTERIOR_PLACEMENT_AI_CANDIDATE_EVENT, receiveCandidate);
  }, [placementTransaction.currentDocument.documentId, projectId]);
  useEffect(() => {
    const onCommand = (event: Event) => {
      const id = (event as CustomEvent<SpatialCadCommandDetail>).detail?.id;
      if (id === 'spatial.plan') setView('plan');
      else if (id === 'spatial.3d') setView('3d');
      else if (id === 'spatial.dimensions') dimensionRef.current?.focus();
      else if (id === 'spatial.furniture') { setView('plan'); window.setTimeout(() => planRef.current?.focus(), 0); }
      else if (id === 'spatial.ceiling') ceilingRef.current?.focus();
      else if (id === 'spatial.verify') void runChecks();
      else if (id === 'spatial.add.table2' || id === 'spatial.add.table4' || id === 'spatial.add.sofa') {
        const kind = id.slice('spatial.add.'.length) as InteriorFurnitureItem['kind'];
        const dimensions = INTERIOR_PLACEMENT_CATALOG[kind].dimensionsMm;
        const topLeft: [number, number] = [Math.max(0, Math.round((normalized.width - dimensions[0]) / 2 / 50) * 50), Math.max(0, Math.round((normalized.depth - dimensions[1]) / 2 / 50) * 50)];
        const positionMm = topLeftToRoomCenteredMm(topLeft, [normalized.width, normalized.depth, normalized.ceilingHeight], dimensions);
        void placementController.onAddObject(kind, positionMm);
        setView('plan');
        window.setTimeout(() => planRef.current?.focus(), 0);
      }
    };
    window.addEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
  }, [normalized, placementController, runChecks]);

  const statusLabel = verification === 'NOT_RUN' ? t.notRun : verification === 'RUNNING' ? t.running : verification === 'BLOCKED' ? t.blocked : t.checked;
  const property = (label: string, key: keyof InteriorSpatialParameters, min: number, max: number, ref?: React.RefObject<HTMLInputElement | null>) => (
    <label style={{ display: 'grid', gridTemplateColumns: '1fr 104px', gap: 8, alignItems: 'center', fontSize: 11 }}>
      <span>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <SpatialNumberInput inputRef={ref} testId={`spatial-input-${String(key)}`} min={min} max={max} value={Number(params[key])} onCommit={value => updateParam(key, value)} />
        <small style={{ color: 'var(--nx-text-3)' }}>mm</small>
      </span>
    </label>
  );

  return (
    <div dir={locale(lang) === 'ar' ? 'rtl' : 'ltr'} className="nx-spatial-workbench nx-spatial-resizable-grid" data-testid="interior-spatial-cad" data-experience={experience} style={{ width: '100%', height: '100%', minHeight: 0, display: 'grid', overflow: 'hidden', background: 'var(--nx-bg)' }}>
      <aside className="nx-spatial-side" style={{ ...panel, borderRight: '1px solid var(--nx-border)', padding: 12, overflow: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 12 }}>{t.tree}</div>
        {[['site', 'Site'], ['level', t.level], ['room', t.room], ['floor', t.floor], ['walls', t.walls], ['furniture', `${t.furniture} (${assembly.furniture[0].count})`]].map(([id, label], index) => (
          <div key={id} style={{ padding: '6px 5px', marginLeft: Math.max(0, index - 1) * 9, borderLeft: index > 0 ? '1px solid var(--nx-border)' : undefined, color: index === 2 ? 'var(--nx-accent)' : 'var(--nx-text-2)', fontSize: 11, fontWeight: index === 2 ? 750 : 500 }}>▸ {label}</div>
        ))}
        <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--nx-border)', display: 'grid', gap: 7 }}>
          <StatusBadge state="PREVIEW" label={t.preview} />
          <StatusBadge state={verification} label={statusLabel} />
        </div>
      </aside>

      <main style={{ minWidth: 0, minHeight: 0, padding: 10, overflow: 'auto', background: 'var(--nx-bg)' }}>
        <div className="nx-spatial-mobile-notice" style={{ display: 'none', marginBottom: 8, padding: 8, border: '1px solid var(--nx-warn, #d97706)', borderRadius: 6, color: 'var(--nx-warn, #d97706)', background: 'var(--nx-panel)', fontSize: 10.5, fontWeight: 700 }}>{t.mobile}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <div role="group" aria-label={t.tree} style={{ display: 'inline-flex', border: '1px solid var(--nx-border)', borderRadius: 6, overflow: 'hidden' }}>
            <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')} style={{ ...fieldStyle, width: 'auto', border: 0, borderRadius: 0, background: view === 'plan' ? 'var(--nx-accent)' : 'var(--nx-panel)' }}>{t.plan}</button>
            <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')} style={{ ...fieldStyle, width: 'auto', border: 0, borderLeft: '1px solid var(--nx-border)', borderRadius: 0, background: view === '3d' ? 'var(--nx-accent)' : 'var(--nx-panel)' }}>{t.view3d}</button>
          </div>
          <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{normalized.width} × {normalized.depth} × {normalized.ceilingHeight} mm · {assembly.floorAreaM2} m²</span>
        </div>
        {view === 'plan' ? (
          <div ref={planRef} data-spatial-drop-zone tabIndex={-1} style={{ ...panel, border: '1px solid var(--nx-border)', borderRadius: 8, padding: 10 }}>
            <InteriorPlanEditor lang={lang} width={normalized.width} depth={normalized.depth} height={normalized.ceilingHeight} doorWidth={normalized.doorWidth} exitCount={normalized.exitCount} rows={normalized.rows} cols={normalized.cols} furniture={placementFurniture} onChange={(list) => onFurnitureChange(list)} placement={placementController} result={result} unit="mm" />
          </div>
        ) : (
          <div style={{ ...panel, border: '1px solid var(--nx-border)', borderRadius: 8, padding: 8 }}>
            <AssemblyViewer3D parts={viewerParts} height={520} unit="mm" />
            <div style={{ padding: '7px 3px 1px', color: 'var(--nx-text-3)', fontSize: 10 }}>{t.preview}</div>
          </div>
        )}
        <ArchitectureInteriorSectionGaugePanel
          lang={lang}
          kind="interior"
          widthMm={normalized.width}
          depthMm={normalized.depth}
          heightMm={normalized.ceilingHeight}
          dimensions={[
            { id: 'width', label: t.width, value: normalized.width, min: 2000, max: 100_000, step: 100, unit: 'mm' },
            { id: 'depth', label: t.depth, value: normalized.depth, min: 2000, max: 100_000, step: 100, unit: 'mm' },
            { id: 'ceilingHeight', label: t.ceiling, value: normalized.ceilingHeight, min: 1800, max: 20_000, step: 50, unit: 'mm' },
            { id: 'doorWidth', label: t.door, value: normalized.doorWidth, min: 600, max: Math.min(20_000, Math.max(600, normalized.width - 400)), step: 50, unit: 'mm' },
          ]}
          onDimensionChange={(id, value) => {
            if (id === 'width' || id === 'depth' || id === 'ceilingHeight' || id === 'doorWidth') updateParam(id, value);
          }}
        />
      </main>

      <aside className="nx-spatial-side" style={{ ...panel, borderLeft: '1px solid var(--nx-border)', padding: 12, overflow: 'auto' }}>
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
          construction={{ wallThickness: null, slabThickness: null, ceilingThickness: null }}
          constraints={{ maximumFootprintWidth: normalized.width, maximumFootprintDepth: normalized.depth }}
        />
        <ArchitectureInteriorPrecisionWorkflowPanel lang={lang} projectId={projectId} />
        <ArchitectureInteriorLiveInspector lang={lang} projectId={projectId} />
        <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 10 }}>{t.properties}</div>
        <SpatialCadTransactionStatus state={transaction.state} lang={lang} onUndo={transaction.undo} onRedo={transaction.redo} />
        <InteriorPlacementTransactionStatus state={placementTransaction.state} lang={lang} onUndo={async () => { const ok = await placementTransaction.undo(); if (ok) invalidate(); return ok; }} onRedo={async () => { const ok = await placementTransaction.redo(); if (ok) invalidate(); return ok; }} />
        <InteriorPlacementInspector object={selectedPlacementObject} roomSizeMm={placementTransaction.currentDocument.roomSizeMm} lang={lang} pending={placementTransaction.state.persistence === 'RUNNING'} roomBasisStale={placementTransaction.state.issues.includes('room_basis_stale')} onCommit={async changes => { if (!selectedPlacementObject) return false; const ok = await placementTransaction.updateObject(selectedPlacementObject.id, changes); if (ok) invalidate(); return ok; }} />
        {(architectureInteriorInspector?.selection || architectureInteriorInspector?.source) && <ArchitectureInteriorInspector
          selection={architectureInteriorInspector.selection ?? null}
          source={architectureInteriorInspector.source ?? null}
          lang={lang}
          pending={placementTransaction.state.persistence === 'RUNNING'}
          onCommit={architectureInteriorInspector.onCommit}
          onInvalidSelection={architectureInteriorInspector.onInvalidSelection}
        />}
        <InteriorPlacementAiCandidateBridge candidate={placementAiCandidate} pending={placementTransaction.state.persistence === 'RUNNING'} lang={lang} onApply={async () => { if (placementAiCandidate && await placementTransaction.commitReviewedCandidate(placementAiCandidate, selectedObjectId)) { setPlacementAiCandidate(null); invalidate(); } }} onDiscard={() => setPlacementAiCandidate(null)} />
        <SpatialAiCandidateBridge candidate={aiCandidate} currentDocument={currentDocument} currentDocumentId={documentIdRef.current} currentContentHash={currentContentHash} currentLocks={transaction.currentLocks} onCommit={next => { const n = (key: keyof InteriorCadScalarParameters, fallback: number) => typeof next[key] === 'number' ? next[key] as number : fallback; const normalizedNext = normalizeInteriorSpatialParameters({ ...params, width: n('width', normalized.width), depth: n('depth', normalized.depth), ceilingHeight: n('ceilingHeight', normalized.ceilingHeight), doorWidth: n('doorWidth', normalized.doorWidth), exitCount: n('exitCount', normalized.exitCount), rows: n('rows', normalized.rows), cols: n('cols', normalized.cols) }); const committed = transaction.commit(interiorCadScalars(normalizedNext), 'ai'); if (committed) setParams(normalizedNext); return committed; }} onAuthoritativeCommit={(next, operation, metadata) => { const n = (key: keyof InteriorCadScalarParameters, fallback: number) => typeof next[key] === 'number' ? next[key] as number : fallback; const normalizedNext = normalizeInteriorSpatialParameters({ ...params, width: n('width', normalized.width), depth: n('depth', normalized.depth), ceilingHeight: n('ceilingHeight', normalized.ceilingHeight), doorWidth: n('doorWidth', normalized.doorWidth), exitCount: n('exitCount', normalized.exitCount), rows: n('rows', normalized.rows), cols: n('cols', normalized.cols) }); return transaction.commitReviewed(interiorCadScalars(normalizedNext), operation, metadata); }} onDiscard={() => setAiCandidate(null)} lang={lang} />
        <div style={{ display: 'grid', gap: 8 }}>
          {property(t.width, 'width', 2000, 100000, dimensionRef)}
          {property(t.depth, 'depth', 2000, 100000)}
          {property(t.ceiling, 'ceilingHeight', 1800, 20000, ceilingRef)}
          {property(t.door, 'doorWidth', 600, Math.min(20_000, params.width - 400))}
          <label style={{ display: 'grid', gridTemplateColumns: '1fr 104px', gap: 8, alignItems: 'center', fontSize: 11 }}>
            <span>{t.exits}</span>
            <select id="spatial-exit-count" name="spatial-exit-count" value={params.exitCount} onChange={event => updateParam('exitCount', Number(event.target.value))} style={fieldStyle}><option value={1}>1</option><option value={2}>2</option></select>
          </label>
        </div>
        <div style={{ marginTop: 12, padding: 9, border: '1px solid var(--nx-warn, #d97706)', borderRadius: 7, color: 'var(--nx-text-2)', background: 'color-mix(in srgb, var(--nx-warn, #d97706) 8%, transparent)', fontSize: 10.5, lineHeight: 1.5 }}>{t.authority}</div>

        <div style={{ fontSize: 11, fontWeight: 800, margin: '16px 0 9px' }}>{t.checkBasis}</div>
        <div style={{ display: 'grid', gap: 7 }}>
          {([
            ['occupantDensityM2', t.occupancy, 0.1, 100], ['travelLimitM', t.travelLimit, 0.1, 1000],
            ['targetLux', t.targetLux, 1, 100_000], ['lampLumen', t.lumen, 1, 10_000_000],
            ['doorThicknessMm', t.doorThickness, 1, 1000], ['requiredDoorClearanceMm', t.doorClearance, 1, 5000],
            ['minimumClearWidthMm', t.minimumClearWidth, 1, 20_000], ['minimumIndependentExits', t.requiredIndependentExits, 1, 10],
          ] as const).map(([key, label, step, max]) => (
            <label key={key} htmlFor={`spatial-basis-${key}`} style={{ display: 'grid', gap: 3, fontSize: 10.5 }}><span>{label}</span><input id={`spatial-basis-${key}`} name={`spatial-basis-${key}`} type="number" min={0} max={max} step={step} value={basis[key] || ''} placeholder={key === 'occupantDensityM2' ? t.missingDensity : key === 'doorThicknessMm' ? t.missingDoorThickness : undefined} onChange={event => { invalidate(); setBasis(current => ({ ...current, [key]: numberValue(event.target.value, 0) })); }} style={fieldStyle} /></label>
          ))}
        </div>
        <button type="button" data-testid="spatial-run-interior-check" onClick={() => void runChecks()} disabled={verification === 'RUNNING'} style={{ marginTop: 10, width: '100%', minHeight: 36, border: 0, borderRadius: 6, background: 'var(--nx-accent)', color: 'var(--nx-on-accent, #071a17)', fontWeight: 800, cursor: 'pointer' }}>{verification === 'RUNNING' ? t.running : t.run}</button>
        <button type="button" onClick={() => { invalidate(); setParams(DEFAULT_INTERIOR); transaction.commit(interiorCadScalars(DEFAULT_INTERIOR)); setBasis({ occupantDensityM2: 0, travelLimitM: 30, targetLux: 0, lampLumen: 0, doorThicknessMm: 0, requiredDoorClearanceMm: 0, minimumClearWidthMm: 0, minimumIndependentExits: 0 }); }} style={{ marginTop: 6, width: '100%', minHeight: 30, border: '1px solid var(--nx-border)', borderRadius: 6, background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)', cursor: 'pointer' }}>{t.reset}</button>

        <section data-testid="spatial-governed-checks" aria-live="polite" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--nx-border)', display: 'grid', gap: 6, fontSize: 10.5 }}>
          <b>{t.governed}</b>
          {([
            [t.boundary, governed.boundary],
            [t.doorSwing, governed.doorSwing],
            [t.egressGraph, governed.egress],
          ] as const).map(([label, gate]) => (
            <span key={label}>{label}: <b>{gate.state === 'PREVIEW' ? gate.passed ? 'PASS' : 'FAIL' : gate.state}</b> · {gate.detail}</span>
          ))}
          {(governed.boundary.authRequired || governed.doorSwing.authRequired || governed.egress.authRequired) && <Link href="/login" style={{ color: 'var(--nx-accent)', fontWeight: 800 }}>{t.login}</Link>}
        </section>

        {result && (
          <section aria-live="polite" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--nx-border)', display: 'grid', gap: 6, fontSize: 10.5 }}>
            <b>{t.results}</b>
            {result.error && <span style={{ color: 'var(--nx-danger, #dc2626)' }}>{result.error}</span>}
            {result.travel && <span>{t.travel}: <b>{result.travel.maxTravelM ?? '—'} m / {result.travel.limitM ?? basis.travelLimitM} m</b> · {result.travel.pass === true ? 'PASS' : result.travel.pass === false ? 'FAIL' : 'NOT_RUN'}</span>}
            <span>{t.egress}: <b>{result.egress?.verdict ?? 'NOT_RUN'}</b>{!basis.occupantDensityM2 && ` · ${t.missingDensity}`}</span>
            {result.finishes && <span>{t.finishes}: {result.finishes.floorM2 ?? '—'} / {result.finishes.wallM2 ?? '—'} / {result.finishes.ceilingM2 ?? '—'} m²</span>}
            <small style={{ color: 'var(--nx-text-3)', lineHeight: 1.45 }}>{t.checked}</small>
          </section>
        )}
      </aside>
      <SpatialPaneResizers lang={lang} storageKey="interior" leftDefault={220} rightDefault={292} />
      <style>{`@media (max-width: 800px) { .nx-spatial-workbench { grid-template-columns: minmax(0, 1fr) !important; } .nx-spatial-side { display: none !important; } .nx-spatial-mobile-notice { display: block !important; } }`}</style>
    </div>
  );
}

export function SpatialCadWorkspace({ domain, lang, experience, onAiDesign, architectureInteriorInspector }: { domain: SpatialDomain; lang: string; experience: UserExperienceLevel; onAiDesign: (instruction?: string) => void; architectureInteriorInspector?: ArchitectureInteriorInspectorProps }) {
  const projectId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('project') ?? new URLSearchParams(window.location.search).get('projectId');
  const workspace = domain === 'interior'
    ? <InteriorWorkspace lang={lang} experience={experience} architectureInteriorInspector={architectureInteriorInspector} />
    : domain === 'building'
      ? <BuildingCadWorkspace lang={lang} projectId={projectId} onAiDesign={onAiDesign} />
      : domain === 'landscape'
        ? <LandscapeCadWorkspace lang={lang} onAiDesign={onAiDesign} />
        : <div dir={locale(lang) === 'ar' ? 'rtl' : 'ltr'} data-spatial-drop-zone style={{ width: '100%', height: '100%', minHeight: 0 }}><SpatialResizableHost lang={lang} storageKey="civil"><CivilCadWorkspaceTyped lang={lang} onAiDesign={onAiDesign} /></SpatialResizableHost></div>;
  const allowedObjects: Record<SpatialDomain, string[]> = {
    building: ['storey', 'window'], civil: ['inlet'], landscape: ['tree-row', 'tree-column'], interior: ['table2', 'table4', 'sofa'],
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('application/x-nexyfab-spatial-object') && (event.target as HTMLElement).closest('[data-spatial-drop-zone]')) event.preventDefault();
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const id = event.dataTransfer.getData('application/x-nexyfab-spatial-object');
    if (!allowedObjects[domain].includes(id) || !(event.target as HTMLElement).closest('[data-spatial-drop-zone]')) return;
    event.preventDefault();
    // Interior owns its SVG drop so it can preserve the physical pointer
    // coordinate. The shared shell must not turn a missed/bubbled drop into a
    // second centre-placement command.
    if (domain === 'interior') return;
    dispatchSpatialCadCommand(`spatial.add.${id}`);
  };
  return <div data-testid="spatial-workspace-shell" onDragOver={onDragOver} onDrop={onDrop} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
    {workspace}
    <aside
      data-testid="spatial-product-qualification-layer"
      style={{ position: 'absolute', insetBlockStart: 12, insetInlineEnd: 12, zIndex: 28, width: 'min(320px, calc(100% - 24px))', maxHeight: 'calc(100% - 96px)', overflow: 'auto', background: 'var(--nx-panel)', borderRadius: 8, boxShadow: '0 10px 28px rgba(0,0,0,.2)' }}
    >
      <DomainProductQualificationPanel lang={lang} projectId={projectId} domain={domain} />
    </aside>
    <SpatialActionDock domain={domain} lang={lang} onAiDesign={onAiDesign} />
  </div>;
}
