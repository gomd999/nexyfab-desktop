'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLandscapeConceptDocument, landscapeConceptIssues, landscapeViewerParts, normalizeLandscapeSpatialParameters, type LandscapeSpatialParameters } from '@/lib/cad/landscapeSpatialModel';
import { saveSpatialDesignBriefHandoff, SPATIAL_AI_HANDOFF_REQUEST_EVENT, takeSpatialDesignBriefHandoffAny, takeSpatialDesignCandidateReturnV2 } from '@/lib/ai/spatialDesignBriefHandoff';
import { createSpatialDocumentId, saveSpatialCadDraftHandoff } from '@/lib/ai/spatialDesignBriefBuilder';
import { spatialCadDocumentSnapshot, useSpatialCadContentHash } from '@/lib/ai/spatialDesignBriefBuilder';
import type { SpatialAiCandidate } from '@/lib/ai/spatialAiCandidate';
import { SPATIAL_CAD_COMMAND_EVENT, type SpatialCadCommandDetail } from './spatialCadCommands';
import { SpatialCadTransactionStatus, useSpatialCadTransaction } from './useSpatialCadTransaction';
import { SpatialPaneResizers } from './SpatialPaneResizers';
import { SpatialAiCandidateBridge } from './SpatialAiCandidateBridge';

const AssemblyViewer3D = dynamic(() => import('../../../nexyfab/design/AssemblyViewer3D'), { ssr: false });
type State = 'NOT_RUN' | 'PREVIEW' | 'BLOCKED';

const DEFAULTS: LandscapeSpatialParameters = { widthM: 30, depthM: 24, pathWidthM: 2.4, treeRows: 3, treeColumns: 4, canopyDiameterM: 4, installedHeightM: 3, soilDepthM: 1.2, gradePercent: 1.5 };
const field: React.CSSProperties = { width: '100%', height: 30, border: '1px solid var(--nx-border)', borderRadius: 5, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', padding: '0 8px', fontSize: 11 };
const panel: React.CSSProperties = { minWidth: 0, minHeight: 0, background: 'var(--nx-panel)', color: 'var(--nx-text)' };

const COPY = {
  ko: {
    browser: '조경 브라우저', project: '개념 조경 01', site: '승인 지형·좌표계 미연결', plan: '2D 배치', view3d: '3D 조경', properties: '조경 속성 · 권위 입력',
    widthM: '부지 폭 (m)', depthM: '부지 깊이 (m)', pathWidthM: '보행로 폭 (m)', treeRows: '수목 행', treeColumns: '수목 열', canopyDiameterM: '성목 수관 (m)', installedHeightM: '식재 높이 (m)', soilDepthM: '토심 (m)', gradePercent: '개념 경사 (%)',
    authority: '승인 측량 지형, 토양시험, 확정 수종·공급원, 관수 수리조건이 연결되지 않았습니다. 현재 결과는 배치 검토용 개념 모델이며 시공·출시 도면이 아닙니다.',
    run: '개념 문서 일관성 검사', reset: '개념값 초기화', notRun: 'NOT_RUN · 검사하지 않음', preview: 'PREVIEW · 개념 일관성 확인', blocked: 'BLOCKED · 개념 문서 오류', geometry: 'CONCEPT · 형상 미리보기',
    gates: '조경 검증 게이트', local: '문서·형상 일관성', terrain: '승인 지형·좌표', species: '수종·공급원 증빙', irrigation: '관수 수리 검증', notConnected: 'NOT_RUN · 권위 자료 미연결', mobile: '모바일은 조경 형상 검토용입니다. 치수·권위 입력은 데스크톱에서 진행하세요.', ai: 'AI 설계 브리프 검토',
  },
  en: {
    browser: 'Landscape browser', project: 'Concept Landscape 01', site: 'Approved terrain & CRS not connected', plan: '2D layout', view3d: '3D landscape', properties: 'Landscape properties & authority',
    widthM: 'Site width (m)', depthM: 'Site depth (m)', pathWidthM: 'Path width (m)', treeRows: 'Tree rows', treeColumns: 'Tree columns', canopyDiameterM: 'Mature canopy (m)', installedHeightM: 'Installed height (m)', soilDepthM: 'Soil depth (m)', gradePercent: 'Concept grade (%)',
    authority: 'Approved survey terrain, soil tests, confirmed species and nursery provenance, and irrigation hydraulics are not connected. This concept is for layout review, not construction or release.',
    run: 'Check concept consistency', reset: 'Reset concept', notRun: 'NOT_RUN · check has not run', preview: 'PREVIEW · concept is internally consistent', blocked: 'BLOCKED · concept document error', geometry: 'CONCEPT · geometry preview',
    gates: 'Landscape verification gates', local: 'Document & geometry consistency', terrain: 'Approved terrain & coordinates', species: 'Species & nursery evidence', irrigation: 'Irrigation hydraulics', notConnected: 'NOT_RUN · authority not connected', mobile: 'Mobile is for landscape review. Use desktop for dimensions and authority inputs.', ai: 'Review AI design brief',
  },
} as const;

const LANDSCAPE_COPY = {
  ...COPY,
  ja: { ...COPY.en, browser: 'ランドスケープブラウザー', project: 'コンセプト造園 01', site: '承認済み地形・座標系未接続', plan: '2D 配置', view3d: '3D ランドスケープ', properties: '造園プロパティと権限', widthM: '敷地幅 (m)', depthM: '敷地奥行き (m)', pathWidthM: '園路幅 (m)', treeRows: '樹木の行', treeColumns: '樹木の列', run: 'コンセプト整合性を検査', reset: 'コンセプトをリセット', gates: '造園検証ゲート', ai: 'AI 設計ブリーフを確認' },
  zh: { ...COPY.en, browser: '景观浏览器', project: '概念景观 01', site: '已批准地形和坐标系未连接', plan: '2D 布局', view3d: '3D 景观', properties: '景观属性与权限', widthM: '场地宽度 (m)', depthM: '场地深度 (m)', pathWidthM: '道路宽度 (m)', treeRows: '树木行数', treeColumns: '树木列数', run: '检查概念一致性', reset: '重置概念', gates: '景观验证门', ai: '查看 AI 设计简报' },
  es: { ...COPY.en, browser: 'Navegador de paisaje', project: 'Paisaje conceptual 01', site: 'Terreno y CRS aprobados sin conectar', plan: 'Diseño 2D', view3d: 'Paisaje 3D', properties: 'Propiedades y autoridad', widthM: 'Ancho del sitio (m)', depthM: 'Fondo del sitio (m)', pathWidthM: 'Ancho del sendero (m)', treeRows: 'Filas de árboles', treeColumns: 'Columnas de árboles', run: 'Comprobar coherencia', reset: 'Restablecer concepto', gates: 'Puertas de verificación del paisaje', ai: 'Revisar resumen de diseño IA' },
  ar: { ...COPY.en, browser: 'متصفح تنسيق الموقع', project: 'تنسيق تصوري 01', site: 'التضاريس ونظام الإحداثيات غير متصلين', plan: 'تخطيط ثنائي الأبعاد', view3d: 'تنسيق ثلاثي الأبعاد', properties: 'خصائص التنسيق والمرجعية', widthM: 'عرض الموقع (م)', depthM: 'عمق الموقع (م)', pathWidthM: 'عرض الممر (م)', treeRows: 'صفوف الأشجار', treeColumns: 'أعمدة الأشجار', run: 'فحص اتساق التصور', reset: 'إعادة ضبط التصور', gates: 'بوابات التحقق من التنسيق', ai: 'مراجعة موجز تصميم الذكاء الاصطناعي' },
} as const;

function landscapeLocale(lang: string): keyof typeof LANDSCAPE_COPY {
  if (lang === 'ko' || lang === 'kr') return 'ko';
  return lang === 'ja' || lang === 'zh' || lang === 'es' || lang === 'ar' ? lang : 'en';
}

function publish(state: State) {
  window.dispatchEvent(new CustomEvent('nexyfab:spatial-verification-status', { detail: { state } }));
}

function DraftNumber({ id, label, min, max, step, value, onCommit }: { id: string; label: string; min: number; max: number; step: number; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) setDraft(String(value));
    else onCommit(parsed);
  };
  return <input id={id} name={id} aria-label={label} type="number" min={min} max={max} step={step} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur(); } }} style={field} />;
}

export function LandscapeCadWorkspace({ lang, onAiDesign }: { lang: string; onAiDesign: () => void }) {
  const t = LANDSCAPE_COPY[landscapeLocale(lang)];
  const [params, setParams] = useState(DEFAULTS);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [state, setState] = useState<State>('NOT_RUN');
  const [issues, setIssues] = useState<string[]>([]);
  const restoreProjectDraft = useCallback((restored: LandscapeSpatialParameters) => {
    setParams(normalizeLandscapeSpatialParameters(restored));
    setState('NOT_RUN'); setIssues([]); publish('NOT_RUN');
  }, []);
  const transaction = useSpatialCadTransaction('landscape', DEFAULTS, { onRestore: restoreProjectDraft });
  const seedTransaction = transaction.seed;
  const documentIdRef = useRef(createSpatialDocumentId('landscape'));
  documentIdRef.current = transaction.currentDocumentId;
  const [aiCandidate, setAiCandidate] = useState<SpatialAiCandidate | null>(null);
  const [selectedParameterPath, setSelectedParameterPath] = useState<string | null>(null);
  const normalized = useMemo(() => normalizeLandscapeSpatialParameters(params), [params]);
  const document = useMemo(() => buildLandscapeConceptDocument(normalized), [normalized]);
  const viewerParts = useMemo(() => landscapeViewerParts(document, normalized), [document, normalized]);
  const currentDocument = useMemo(() => spatialCadDocumentSnapshot('landscape', transaction.state.revision, {
    widthM: normalized.widthM, depthM: normalized.depthM, pathWidthM: normalized.pathWidthM, treeRows: normalized.treeRows,
    treeColumns: normalized.treeColumns, canopyDiameterM: normalized.canopyDiameterM, installedHeightM: normalized.installedHeightM,
    soilDepthM: normalized.soilDepthM, gradePercent: normalized.gradePercent,
  }), [normalized, transaction.state.revision]);
  const currentContentHash = useSpatialCadContentHash(currentDocument);
  const invalidate = useCallback(() => { setState('NOT_RUN'); setIssues([]); publish('NOT_RUN'); }, []);
  const update = useCallback((key: keyof LandscapeSpatialParameters, value: number) => { const next = normalizeLandscapeSpatialParameters({ ...params, [key]: value }); if (Object.is(normalized[key], next[key])) return; setSelectedParameterPath(key === 'widthM' ? 'site width (m)' : key === 'depthM' ? 'site depth (m)' : key === 'pathWidthM' ? 'path width (m)' : key === 'treeRows' ? 'tree rows' : key === 'treeColumns' ? 'tree columns' : key === 'canopyDiameterM' ? 'mature canopy diameter (m)' : key === 'installedHeightM' ? 'installed height (m)' : key === 'soilDepthM' ? 'soil depth (m)' : 'concept grade (%)'); invalidate(); setParams(next); transaction.commit(next); }, [invalidate, normalized, params, transaction]);
  const run = useCallback(() => {
    const nextIssues = landscapeConceptIssues(document);
    setIssues(nextIssues);
    const next = nextIssues.length ? 'BLOCKED' : 'PREVIEW';
    setState(next); publish(next);
  }, [document]);

  useEffect(() => { publish('NOT_RUN'); }, []);
  useEffect(() => {
    const returned = takeSpatialDesignCandidateReturnV2(window.sessionStorage, 'landscape');
    const handoff = returned?.handoff ?? takeSpatialDesignBriefHandoffAny(window.sessionStorage, 'landscape');
    if (!handoff) return;
    const n = (key: string, fallback: number) => typeof handoff.parameters[key] === 'number' ? handoff.parameters[key] as number : fallback;
    const restored = normalizeLandscapeSpatialParameters({
      ...DEFAULTS,
      widthM: n('site width (m)', DEFAULTS.widthM), depthM: n('site depth (m)', DEFAULTS.depthM),
      pathWidthM: n('path width (m)', DEFAULTS.pathWidthM), treeRows: n('tree rows', DEFAULTS.treeRows),
      treeColumns: n('tree columns', DEFAULTS.treeColumns), canopyDiameterM: n('mature canopy diameter (m)', DEFAULTS.canopyDiameterM),
      installedHeightM: n('installed height (m)', DEFAULTS.installedHeightM), soilDepthM: n('soil depth (m)', DEFAULTS.soilDepthM),
      gradePercent: n('concept grade (%)', DEFAULTS.gradePercent),
    });
    seedTransaction(restored, 'baseDocumentRevision' in handoff ? handoff.baseDocumentRevision : 0, 'documentId' in handoff ? handoff.documentId : undefined);
    setAiCandidate(returned?.candidate ?? null);
    setParams(restored);
    setState('NOT_RUN');
    setIssues([]);
    publish('NOT_RUN');
  }, [seedTransaction]);
  useEffect(() => {
    const saveDraft = () => {
      void saveSpatialCadDraftHandoff({
        domain: 'landscape', unit: 'm', verification: state,
        parameters: {
          'site width (m)': normalized.widthM, 'site depth (m)': normalized.depthM,
          'path width (m)': normalized.pathWidthM, 'tree rows': normalized.treeRows,
          'tree columns': normalized.treeColumns, 'mature canopy diameter (m)': normalized.canopyDiameterM,
          'installed height (m)': normalized.installedHeightM, 'soil depth (m)': normalized.soilDepthM,
          'concept grade (%)': normalized.gradePercent,
        },
        missingAuthority: ['approved terrain and coordinate reference', 'species and nursery evidence', 'irrigation hydraulic inputs and results'],
        baseDocumentRevision: transaction.state.revision,
        documentId: documentIdRef.current,
        selectedParameterPath,
      });
    };
    const saveLegacyDraft = () => saveSpatialDesignBriefHandoff(window.sessionStorage, {
      domain: 'landscape', unit: 'm', verification: state,
      parameters: {
        'site width (m)': normalized.widthM, 'site depth (m)': normalized.depthM,
        'path width (m)': normalized.pathWidthM, 'tree rows': normalized.treeRows,
        'tree columns': normalized.treeColumns, 'mature canopy diameter (m)': normalized.canopyDiameterM,
        'installed height (m)': normalized.installedHeightM, 'soil depth (m)': normalized.soilDepthM,
        'concept grade (%)': normalized.gradePercent,
      },
      missingAuthority: ['approved terrain and coordinate reference', 'species and nursery evidence', 'irrigation hydraulic inputs and results'],
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
      else if (id === 'spatial.dimensions') globalThis.document.getElementById('landscape-widthM')?.focus();
      else if (id === 'spatial.add.tree-row') update('treeRows', normalized.treeRows + 1);
      else if (id === 'spatial.add.tree-column') update('treeColumns', normalized.treeColumns + 1);
      else if (id === 'spatial.verify') run();
      else if (id === 'spatial.ai') onAiDesign();
    };
    window.addEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
  }, [onAiDesign, normalized.treeRows, normalized.treeColumns, run, update]);

  const fields: Array<[keyof LandscapeSpatialParameters, string, number, number, number]> = [
    ['widthM', t.widthM, 6, 500, .5], ['depthM', t.depthM, 6, 500, .5], ['pathWidthM', t.pathWidthM, 1, 100, .1], ['treeRows', t.treeRows, 1, 20, 1], ['treeColumns', t.treeColumns, 1, 20, 1], ['canopyDiameterM', t.canopyDiameterM, .5, 20, .1], ['installedHeightM', t.installedHeightM, .5, 20, .1], ['soilDepthM', t.soilDepthM, .2, 5, .1], ['gradePercent', t.gradePercent, .2, 15, .1],
  ];
  const pathLeft = (normalized.widthM - normalized.pathWidthM) / 2;
  const stateText = state === 'NOT_RUN' ? t.notRun : state === 'PREVIEW' ? t.preview : t.blocked;
  return <div dir={landscapeLocale(lang) === 'ar' ? 'rtl' : 'ltr'} data-testid="landscape-spatial-cad" className="nx-landscape-workbench nx-spatial-resizable-grid" style={{ width: '100%', height: '100%', minHeight: 0, display: 'grid', overflow: 'hidden', background: 'var(--nx-bg)' }}>
    <aside className="nx-landscape-side" style={{ ...panel, borderRight: '1px solid var(--nx-border)', padding: 12, overflow: 'auto' }}>
      <b style={{ fontSize: 11 }}>{t.browser}</b><div style={{ marginTop: 10, fontSize: 11 }}>▾ {t.project}</div><div style={{ margin: '7px 0 0 10px', color: 'var(--nx-warn, #d97706)', fontSize: 10 }}>▸ {t.site}</div>
      <div style={{ margin: '7px 0 0 10px', fontSize: 10.5 }}>▸ Planting zone · {document.plants.length} trees</div><div style={{ margin: '7px 0 0 10px', fontSize: 10.5 }}>▸ Central path</div><div style={{ margin: '7px 0 0 10px', fontSize: 10.5 }}>▸ Concept flow path</div>
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--nx-border)', color: state === 'BLOCKED' ? 'var(--nx-danger, #dc2626)' : state === 'PREVIEW' ? 'var(--nx-accent)' : 'var(--nx-warn, #d97706)', fontSize: 10, fontWeight: 800 }}>{stateText}</div>
    </aside>
    <main data-spatial-drop-zone style={{ minWidth: 0, minHeight: 0, padding: 10, overflow: 'auto' }}>
      <div className="nx-landscape-mobile" style={{ display: 'none', marginBottom: 8, padding: 8, border: '1px solid var(--nx-warn, #d97706)', borderRadius: 6, color: 'var(--nx-warn, #d97706)', fontSize: 10.5 }}>{t.mobile}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}><div role="group" aria-label="Landscape view"><button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')} style={field}>{t.plan}</button><button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')} style={field}>{t.view3d}</button></div><small>{normalized.widthM} × {normalized.depthM} m · {document.plants.length} trees</small></div>
      {view === 'plan' ? <svg data-testid="landscape-plan" role="img" aria-label={t.plan} viewBox={`-1 -1 ${normalized.widthM + 2} ${normalized.depthM + 2}`} style={{ width: '100%', minHeight: 480, border: '1px solid var(--nx-border)', borderRadius: 8, background: 'var(--nx-panel)' }}>
        <rect x="0" y="0" width={normalized.widthM} height={normalized.depthM} fill="#dceccf" stroke="var(--nx-text)" strokeWidth=".15"/><rect x={pathLeft} y="0" width={normalized.pathWidthM} height={normalized.depthM} fill="#c7b9a2" stroke="#8b7355" strokeWidth=".08"/>
        {document.plants.map(plant => <g key={plant.id}><circle cx={plant.positionM[0]} cy={plant.positionM[1]} r={plant.matureCanopyDiameterM / 2} fill="#65a30d55" stroke="#3f6212" strokeWidth=".08"/><circle cx={plant.positionM[0]} cy={plant.positionM[1]} r=".12" fill="#713f12"/></g>)}
        <path d={`M ${normalized.widthM * .1} ${normalized.depthM} L ${normalized.widthM * .1} 0`} stroke="#38bdf8" strokeWidth=".12" strokeDasharray=".4 .25"/><text x={normalized.widthM / 2} y={normalized.depthM - .6} textAnchor="middle" fill="#334155" fontSize=".55">CONCEPT · LOCAL COORDINATES</text>
      </svg> : <div style={{ ...panel, border: '1px solid var(--nx-border)', borderRadius: 8, padding: 8 }}><AssemblyViewer3D parts={viewerParts} height={520} unit="mm"/><small>{t.geometry}</small></div>}
    </main>
    <aside className="nx-landscape-side" style={{ ...panel, borderLeft: '1px solid var(--nx-border)', padding: 12, overflow: 'auto' }}>
      <b style={{ fontSize: 11 }}>{t.properties}</b><SpatialCadTransactionStatus state={transaction.state} lang={lang} onUndo={transaction.undo} onRedo={transaction.redo}/><SpatialAiCandidateBridge candidate={aiCandidate} currentDocument={currentDocument} currentDocumentId={documentIdRef.current} currentContentHash={currentContentHash} currentLocks={transaction.currentLocks} onAuthoritativeCommit={transaction.commitReviewed} onCommit={next => { const n = (key: string, fallback: number) => typeof next[key] === 'number' ? next[key] as number : fallback; const normalizedNext = normalizeLandscapeSpatialParameters({ widthM: n('site width (m)', normalized.widthM), depthM: n('site depth (m)', normalized.depthM), pathWidthM: n('path width (m)', normalized.pathWidthM), treeRows: n('tree rows', normalized.treeRows), treeColumns: n('tree columns', normalized.treeColumns), canopyDiameterM: n('mature canopy diameter (m)', normalized.canopyDiameterM), installedHeightM: n('installed height (m)', normalized.installedHeightM), soilDepthM: n('soil depth (m)', normalized.soilDepthM), gradePercent: n('concept grade (%)', normalized.gradePercent) }); const committed = transaction.commit(normalizedNext, 'ai'); if (committed) setParams(normalizedNext); return committed; }} onDiscard={() => setAiCandidate(null)} lang={lang}/><div style={{ display: 'grid', gap: 6, marginTop: 10 }}>{fields.map(([key, label, min, max, step]) => <label key={key} htmlFor={`landscape-${key}`} style={{ display: 'grid', gridTemplateColumns: '1fr 104px', gap: 7, alignItems: 'center', fontSize: 10.5 }}><span>{label}</span><DraftNumber id={`landscape-${key}`} label={label} min={min} max={max} step={step} value={normalized[key]} onCommit={value => update(key, value)}/></label>)}</div>
      <div style={{ marginTop: 12, padding: 9, border: '1px solid var(--nx-warn, #d97706)', borderRadius: 6, fontSize: 10.5, lineHeight: 1.5 }}>{t.authority}</div><button type="button" data-testid="landscape-run-verify" onClick={run} style={{ marginTop: 10, minHeight: 36, width: '100%', border: 0, borderRadius: 6, background: 'var(--nx-accent)', fontWeight: 800 }}>{t.run}</button><button type="button" onClick={() => { invalidate(); setParams(DEFAULTS); transaction.commit(DEFAULTS); }} style={{ ...field, marginTop: 6 }}>{t.reset}</button>
      <section data-testid="landscape-verification" aria-live="polite" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--nx-border)', display: 'grid', gap: 5, fontSize: 10.5 }}><b>{t.gates}</b><span>{t.local}: <b>{state}</b></span><span>{t.terrain}: <b>NOT_RUN</b> · {t.notConnected}</span><span>{t.species}: <b>NOT_RUN</b> · {t.notConnected}</span><span>{t.irrigation}: <b>NOT_RUN</b> · {t.notConnected}</span>{issues.map(issue => <span key={issue} style={{ color: 'var(--nx-danger, #dc2626)' }}>{issue}</span>)}</section><button type="button" onClick={onAiDesign} style={{ ...field, marginTop: 10 }}>{t.ai}</button>
    </aside>
    <SpatialPaneResizers lang={lang} storageKey="landscape" leftDefault={220} rightDefault={292} />
    <style>{`@media (max-width:800px){.nx-landscape-workbench{grid-template-columns:minmax(0,1fr)!important}.nx-landscape-side{display:none!important}.nx-landscape-mobile{display:block!important}}`}</style>
  </div>;
}
