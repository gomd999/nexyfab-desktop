'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { getAssemblyLoadGuidance } from '@/lib/assemblyLoadPolicy';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import type { AssemblyMate, MateType } from './AssemblyMates';
import { MATE_TYPE_LABELS, generateMateId } from './AssemblyMates';
import type { InterferenceResult } from './InterferenceDetection';
import type { PlacedPart } from './PartPlacementPanel';
import {
  bomPartResultsAndAssemblyMatesToSolverState,
  placedPartsAndAssemblyMatesToSolverState,
  reportPlacedAssemblyMateMapping,
  reportBomAssemblyMateMapping,
} from './mateSelectionMapping';
import type { BomPartResult } from '../ShapePreview';
import { useAssemblyState } from './useAssemblyState';
import { mateGraphSummary, preflightAssemblyMates } from '@/lib/assemblyMatePreflight';
import { useUIStore } from '../store/uiStore';

// Dynamically import the solver panel to avoid pulling Three.js into the initial bundle
const AssemblyMatesPanel = dynamic(() => import('./AssemblyMatesPanel'), { ssr: false });

// ─── i18n ───────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    assembly: '어셈블리', mates: '메이트', solver: '구속 계산',
    addMate: '메이트 추가', removeMate: '삭제', lockMate: '잠금', unlockMate: '잠금 해제',
    interference: '간섭 탐지', runCheck: '간섭 검사 실행',
    noInterference: '간섭 없음', interferenceFound: '간섭 발견',
    volume: '체적', explodedView: '분해도', assembled: '조립 상태', exploded: '분해 상태',
    selectFaces: '두 면을 클릭하여 메이트를 설정합니다',
    partA: '파트 A', partB: '파트 B', faceA: '면 A', faceB: '면 B',
    value: '값', type: '유형', close: '닫기', cancel: '취소',
    applyMatesPlacement: '메이트를 배치에 적용',
    syncSolverFromBom: 'BOM에서 솔버 동기화',
    solverTabHint: '「BOM에서 솔버 동기화」로 배치 파트 또는 멀티 바디 BOM(각 2개 이상)과 위 메이트 목록을 아래 구속 솔버에 올립니다. 씬에서 파트를 실제로 움직이려면 「메이트」 탭의 배치 적용을 사용하세요.',
    solverMateEditHint: '메이트 목록을 바꾼 뒤에는 「BOM에서 솔버 동기화」를 다시 눌러 구속 솔버와 맞추세요. 씬 배치만 갱신하려면 「메이트」 탭의 배치 적용을 사용합니다.',
    partsLabel: '파트', pairChecksLabel: '쌍 비교',
    interferenceHintHeavy: '부하가 큽니다. 완료까지 수십 초 걸릴 수 있습니다.',
    interferenceHintExtreme: '극단적으로 무거운 검사입니다. UI가 길게 멈출 수 있습니다.',
    solverSyncSkipped: '{{count}}개 메이트는 솔버에 올리지 못했습니다. 파트 이름·메시를 확인하세요.',
    viewportLoadWarn: '다수의 파트가 있습니다. 뷰포트·메시 부하가 커질 수 있으니 저해상 LOD·간단한 뷰를 권장합니다.',
    viewportLoadHeavy: '대형 어셈블리입니다. 조작이 느려질 수 있습니다.',
    viewportLoadExtreme: '극단적으로 큰 어셈블리입니다. 작업을 나누거나 범위를 줄이는 것을 검토하세요.',
    viewportPerfNote: '성능(Perf) 패널에서 프레임·워커 시간을 확인할 수 있습니다.',
    viewportOpenPerfButton: '성능 패널 열기',
    interferencePreambleBanner: '쌍 비교가 많습니다. 검사 전 저장하고 실행 시간을 고려하세요.',
  },
  en: {
    assembly: 'Assembly', mates: 'Mates', solver: 'Solver',
    addMate: 'Add Mate', removeMate: 'Delete', lockMate: 'Lock', unlockMate: 'Unlock',
    interference: 'Interference', runCheck: 'Run Check',
    noInterference: 'No interference', interferenceFound: 'Interference found',
    volume: 'Volume', explodedView: 'Exploded View', assembled: 'Assembled', exploded: 'Exploded',
    selectFaces: 'Click two faces to create a mate',
    partA: 'Part A', partB: 'Part B', faceA: 'Face A', faceB: 'Face B',
    value: 'Value', type: 'Type', close: 'Close', cancel: 'Cancel',
    applyMatesPlacement: 'Apply mates to placement',
    syncSolverFromBom: 'Sync solver from BOM',
    solverTabHint: 'Use “Sync solver from BOM” to load placed parts (2+), multi-body BOM rows (2+), and the mates list into the solver below. To move parts in the scene, use “Apply mates to placement” on the Mates tab.',
    solverMateEditHint: 'After changing the mate list, press “Sync solver from BOM” again so the constraint solver matches. To refresh scene placement only, use “Apply mates to placement” on the Mates tab.',
    partsLabel: 'parts', pairChecksLabel: 'pair checks',
    interferenceHintHeavy: 'Heavy workload — may take tens of seconds.',
    interferenceHintExtreme: 'Extreme workload — the UI may freeze for a long period.',
    solverSyncSkipped: 'Could not load {{count}} mate(s) into the solver — check part names or geometry.',
    viewportLoadWarn: 'Many parts — the viewport and meshes may be heavy; prefer aggressive LOD and simpler views.',
    viewportLoadHeavy: 'Large assembly — expect slower interaction on modest hardware.',
    viewportLoadExtreme: 'Very large assembly — consider splitting the job or reducing scope.',
    viewportPerfNote: 'Open the Performance panel to watch frame and worker timings.',
    viewportOpenPerfButton: 'Open Performance HUD',
    interferencePreambleBanner: 'Pairwise checks grow quickly — save work before running on large assemblies.',
  },
  ja: {
    assembly: 'アセンブリ', mates: 'メイト', solver: 'ソルバー',
    addMate: 'メイト追加', removeMate: '削除', lockMate: 'ロック', unlockMate: 'ロック解除',
    interference: '干渉検出', runCheck: '干渉チェック実行',
    noInterference: '干渉なし', interferenceFound: '干渉を検出',
    volume: '体積', explodedView: '分解図', assembled: '組立状態', exploded: '分解状態',
    selectFaces: '2つの面をクリックしてメイトを作成',
    partA: 'パーツ A', partB: 'パーツ B', faceA: '面 A', faceB: '面 B',
    value: '値', type: 'タイプ', close: '閉じる', cancel: 'キャンセル',
    applyMatesPlacement: 'メイトを配置に適用',
    syncSolverFromBom: 'BOMからソルバー同期',
    solverTabHint: '「BOMからソルバー同期」で配置パーツまたはマルチボディBOM(各2個以上)と上のメイト一覧を下のソルバーに読み込みます。シーン上のパーツを動かすには「メイト」タブの配置適用を使ってください。',
    solverMateEditHint: 'メイト一覧を変更したら「BOMからソルバー同期」を再度押してソルバーと一致させてください。シーン配置だけ更新する場合は「メイト」タブの配置適用を使います。',
    partsLabel: 'パーツ', pairChecksLabel: 'ペア比較',
    interferenceHintHeavy: '負荷が高いです。数十秒かかる場合があります。',
    interferenceHintExtreme: '非常に重い検査です。UIが長時間停止することがあります。',
    solverSyncSkipped: '{{count}} 件のメイトをソルバーに読み込めませんでした。パーツ名・メッシュを確認してください。',
    viewportLoadWarn: 'パーツ数が多いです。ビューポート負荷が高いため、低解像度LODとシンプルな表示を推奨します。',
    viewportLoadHeavy: '大規模アセンブリです。操作が重くなる場合があります。',
    viewportLoadExtreme: '非常に大規模です。作業分割や範囲の見直しを検討してください。',
    viewportPerfNote: 'パフォーマンスパネルでフレーム・ワーカー時間を確認できます。',
    viewportOpenPerfButton: 'パフォーマンスを開く',
    interferencePreambleBanner: 'ペア比較が増えるため、実行前に保存し時間に余裕を持ってください。',
  },
  zh: {
    assembly: '装配', mates: '配合', solver: '求解器',
    addMate: '添加配合', removeMate: '删除', lockMate: '锁定', unlockMate: '解锁',
    interference: '干涉检测', runCheck: '运行干涉检查',
    noInterference: '无干涉', interferenceFound: '发现干涉',
    volume: '体积', explodedView: '爆炸视图', assembled: '组装状态', exploded: '分解状态',
    selectFaces: '点击两个面创建配合',
    partA: '零件 A', partB: '零件 B', faceA: '面 A', faceB: '面 B',
    value: '值', type: '类型', close: '关闭', cancel: '取消',
    applyMatesPlacement: '将配合应用到放置',
    syncSolverFromBom: '从 BOM 同步到求解器',
    solverTabHint: '使用「从 BOM 同步到求解器」将已放置零件（≥2）或多实体 BOM（≥2）与上方配合列表载入下方求解器。要在场景中移动零件，请使用「配合」标签上的应用到放置。',
    solverMateEditHint: '修改配合列表后，请再次点击「从 BOM 同步到求解器」以使求解器一致。若仅更新场景放置，请使用「配合」标签上的应用到放置。',
    partsLabel: '零件', pairChecksLabel: '对比较',
    interferenceHintHeavy: '负载较高，可能需要数十秒。',
    interferenceHintExtreme: '极高负载，界面可能长时间无响应。',
    solverSyncSkipped: '有 {{count}} 个配合无法载入求解器 — 请检查零件名或几何。',
    viewportLoadWarn: '零件较多，视口与网格可能偏慢，建议使用低分辨率 LOD 与更简视图。',
    viewportLoadHeavy: '大型装配体，在性能较弱的设备上可能明显卡顿。',
    viewportLoadExtreme: '超大型装配体，建议拆分任务或缩小工作范围。',
    viewportPerfNote: '可在性能面板中查看帧与 worker 时间。',
    viewportOpenPerfButton: '打开性能监视',
    interferencePreambleBanner: '成对比较增长很快 — 大型装配体请先保存再运行检查。',
  },
  es: {
    assembly: 'Ensamblaje', mates: 'Relaciones', solver: 'Resolvedor',
    addMate: 'Añadir Relación', removeMate: 'Eliminar', lockMate: 'Bloquear', unlockMate: 'Desbloquear',
    interference: 'Interferencia', runCheck: 'Ejecutar Verificación',
    noInterference: 'Sin interferencia', interferenceFound: 'Interferencia encontrada',
    volume: 'Volumen', explodedView: 'Vista Explosionada', assembled: 'Ensamblado', exploded: 'Explosionado',
    selectFaces: 'Haga clic en dos caras para crear una relación',
    partA: 'Pieza A', partB: 'Pieza B', faceA: 'Cara A', faceB: 'Cara B',
    value: 'Valor', type: 'Tipo', close: 'Cerrar', cancel: 'Cancelar',
    applyMatesPlacement: 'Aplicar relaciones a la colocación',
    syncSolverFromBom: 'Sincronizar resolvedor desde BOM',
    solverTabHint: 'Use “Sincronizar resolvedor desde BOM” para cargar piezas colocadas (2+), filas BOM multi-cuerpo (2+) y la lista de relaciones en el resolvedor. Para mover piezas en la escena, use “Aplicar relaciones a la colocación” en la pestaña Relaciones.',
    solverMateEditHint: 'Si cambia la lista de relaciones, pulse de nuevo “Sincronizar resolvedor desde BOM”. Para actualizar solo la colocación en la escena, use “Aplicar relaciones a la colocación”.',
    partsLabel: 'piezas', pairChecksLabel: 'comparaciones',
    interferenceHintHeavy: 'Carga alta: puede tardar decenas de segundos.',
    interferenceHintExtreme: 'Carga extrema: la UI puede congelarse mucho tiempo.',
    solverSyncSkipped: 'No se pudieron cargar {{count}} relación(es) en el resolvedor — revise nombres o geometría.',
    viewportLoadWarn: 'Muchas piezas: el viewport puede ir pesado; use LOD agresivo y vistas simples.',
    viewportLoadHeavy: 'Ensamblaje grande: espere más latencia en hardware modesto.',
    viewportLoadExtreme: 'Ensamblaje muy grande: considere dividir el trabajo o reducir el alcance.',
    viewportPerfNote: 'Abra el panel de rendimiento para ver tiempos de fotograma y del worker.',
    viewportOpenPerfButton: 'Abrir rendimiento',
    interferencePreambleBanner: 'Las comparaciones por pares crecen rápido — guarde antes en conjuntos grandes.',
  },
  ar: {
    assembly: 'التجميع', mates: 'العلاقات', solver: 'الحلال',
    addMate: 'إضافة علاقة', removeMate: 'حذف', lockMate: 'قفل', unlockMate: 'إلغاء القفل',
    interference: 'كشف التداخل', runCheck: 'تشغيل الفحص',
    noInterference: 'لا يوجد تداخل', interferenceFound: 'تم العثور على تداخل',
    volume: 'الحجم', explodedView: 'عرض منفصل', assembled: 'مُجمع', exploded: 'منفصل',
    selectFaces: 'انقر على وجهين لإنشاء علاقة',
    partA: 'الجزء A', partB: 'الجزء B', faceA: 'الوجه A', faceB: 'الوجه B',
    value: 'القيمة', type: 'النوع', close: 'إغلاق', cancel: 'إلغاء',
    applyMatesPlacement: 'تطبيق العلاقات على الموضع',
    syncSolverFromBom: 'مزامنة الحلّال من BOM',
    solverTabHint: 'استخدم «مزامنة الحلّال من BOM» لتحميل القطع الموضوعة (٢+) أو صفوف BOM متعددة الأجسام (٢+) وقائمة العلاقات إلى الحلّال. لتحريك القطع في المشهد استخدم «تطبيق العلاقات على الموضع» في تبويب العلاقات.',
    solverMateEditHint: 'بعد تعديل قائمة العلاقات اضغط «مزامنة الحلّال من BOM» مرة أخرى. لتحديث الموضع في المشهد فقط استخدم «تطبيق العلاقات على الموضع».',
    partsLabel: 'قطع', pairChecksLabel: 'مقارنات أزواج',
    interferenceHintHeavy: 'عبء عالٍ — قد يستغرق عشرات الثواني.',
    interferenceHintExtreme: 'عبء شديد — قد تتجمد الواجهة لفترة طويلة.',
    solverSyncSkipped: 'تعذر تحميل {{count}} علاقة/علاقات إلى الحلّال — تحقق من الأسماء أو الهندسة.',
    viewportLoadWarn: 'عدد كبير من القطع — قد يثقل العرض؛ يُفضّل LOD أخف ومناظر أبسط.',
    viewportLoadHeavy: 'تجميع كبير — قد تبطؤ التفاعلات على أجهزة متوسطة.',
    viewportLoadExtreme: 'تجميع ضخم جدًا — فكّر بتقسيم العمل أو تقليل النطاق.',
    viewportPerfNote: 'افتح لوحة الأداء لمراقبة زمن الإطار والعامل (worker).',
    viewportOpenPerfButton: 'فتح لوحة الأداء',
    interferencePreambleBanner: 'تتزايد مقارنات الأزواج بسرعة — احفظ العمل قبل التشغيل على التجميعات الكبيرة.',
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface AssemblyPanelProps {
  mates: AssemblyMate[];
  onAddMate: (mate: AssemblyMate) => void;
  onRemoveMate: (id: string) => void;
  onUpdateMate: (id: string, updates: Partial<AssemblyMate>) => void;
  onDetectInterference: () => void;
  /** 로딩 중 간섭 검사 취소(메인 스레드 폴백 시 `AbortSignal`) */
  onCancelInterference?: () => void;
  interferenceResults: InterferenceResult[];
  interferenceLoading: boolean;
  explodeFactor: number;
  onExplodeFactorChange: (factor: number) => void;
  partNames: string[];
  /** 간섭 검사 대상 파트 수(부모에서 placed→body→bom 순으로 계산) */
  interferenceCheckPartCount: number;
  isKo: boolean;
  onClose: () => void;
  /** Apply geometry-based mate solver to part placement (transforms). */
  onApplyMatesToPlacement?: () => void;
  /** When length ≥ 2, Solver tab can sync `matesSolver` state from placement + `mates`. */
  placedParts?: PlacedPart[];
  /** 멀티 바디 / 메시 BOM — 배치 파트가 2개 미만일 때 솔버 동기화에 사용. */
  solverBomParts?: BomPartResult[];
  /**
   * `handleApplyMatesToPlacement` 성공 후 부모가 증가시키면 Solver 탭의 `AssemblyState`를
   * 배치·메이트와 다시 맞춤 (Phase B1 — solveMates 결과 → solveAssembly 미러).
   */
  solverResyncNonce?: number;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  text: '#c9d1d9',
  textDim: '#8b949e',
  danger: '#f85149',
  success: '#3fb950',
  warning: '#f0883e',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AssemblyPanel({
  mates,
  onAddMate,
  onRemoveMate,
  onUpdateMate,
  onDetectInterference,
  onCancelInterference,
  interferenceResults,
  interferenceLoading,
  explodeFactor,
  onExplodeFactorChange,
  partNames,
  interferenceCheckPartCount,
  isKo,
  onClose,
  onApplyMatesToPlacement,
  placedParts,
  solverBomParts,
  solverResyncNonce,
}: AssemblyPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const resolvedLang = langMap[seg] ?? (isKo ? 'ko' : 'en');
  const t = dict[resolvedLang];
  const setShowPerf = useUIStore(s => s.setShowPerf);
  const interferenceLoad = useMemo(
    () => getAssemblyLoadGuidance(Math.max(0, interferenceCheckPartCount)),
    [interferenceCheckPartCount],
  );
  // MATE_TYPE_LABELS external dict only has ko/en. Non-ko/en langs fall back to English (industry-standard constraint names).
  const mateLabels = resolvedLang === 'ko' ? MATE_TYPE_LABELS.ko : MATE_TYPE_LABELS.en;

  const [addMode, setAddMode] = useState(false);
  const [newMateType, setNewMateType] = useState<MateType>('coincident');
  const [newPartA, setNewPartA] = useState(partNames[0] ?? '');
  const [newPartB, setNewPartB] = useState(partNames[1] ?? partNames[0] ?? '');
  const [newValue, setNewValue] = useState(10);
  const [activeSection, setActiveSection] = useState<'mates' | 'interference' | 'explode' | 'solver'>('mates');

  // Solver tab: local `AssemblyState` until user clicks Sync from BOM (`mateSelectionMapping`).
  const {
    assembly: solverAssembly,
    setAssembly: setSolverAssembly,
  } = useAssemblyState();
  const [solverSyncNotice, setSolverSyncNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!solverSyncNotice) return undefined;
    const tmr = window.setTimeout(() => setSolverSyncNotice(null), 14_000);
    return () => window.clearTimeout(tmr);
  }, [solverSyncNotice]);

  const canSyncSolverFromBom = Boolean(
    (placedParts && placedParts.length >= 2) || (solverBomParts && solverBomParts.length >= 2),
  );

  const runSolverSyncFromBom = useCallback(() => {
    const mateRows = mates.map(m => ({ id: m.id, partA: m.partA, partB: m.partB, type: m.type }));
    const pf = preflightAssemblyMates(mateRows);
    if (!pf.ok) {
      setSolverSyncNotice(pf.issues.join(' · '));
      return;
    }
    const graph = mateGraphSummary(mateRows);
    const graphHint = graph.warnings.length > 0 ? graph.warnings.join(' ') : '';

    if (placedParts && placedParts.length >= 2) {
      const rep = reportPlacedAssemblyMateMapping(placedParts, mates);
      setSolverAssembly(placedPartsAndAssemblyMatesToSolverState(placedParts, mates));
      const skipMsg =
        rep.failures.length > 0
          ? t.solverSyncSkipped.replace(/\{\{count\}\}/g, String(rep.failures.length))
          : null;
      setSolverSyncNotice([graphHint, skipMsg].filter(Boolean).join('\n') || null);
      return;
    }
    if (solverBomParts && solverBomParts.length >= 2) {
      const rep = reportBomAssemblyMateMapping(solverBomParts, mates);
      setSolverAssembly(bomPartResultsAndAssemblyMatesToSolverState(solverBomParts, mates));
      const skipMsg =
        rep.failures.length > 0
          ? t.solverSyncSkipped.replace(/\{\{count\}\}/g, String(rep.failures.length))
          : null;
      setSolverSyncNotice([graphHint, skipMsg].filter(Boolean).join('\n') || null);
    }
  }, [placedParts, solverBomParts, mates, setSolverAssembly, t]);

  const handleSyncSolverFromBom = useCallback(() => {
    runSolverSyncFromBom();
  }, [runSolverSyncFromBom]);

  useEffect(() => {
    if (solverResyncNonce == null || solverResyncNonce < 1) return;
    runSolverSyncFromBom();
  }, [solverResyncNonce, runSolverSyncFromBom]);

  // Theme-compatible object for AssemblyMatesPanel
  const solverTheme = {
    panelBg: C.bg,
    border: C.border,
    text: C.text,
    textMuted: C.textDim,
    cardBg: C.card,
    accent: C.accent,
    accentBright: C.accent,
  };

  const handleAddMate = useCallback(() => {
    if (!newPartA || !newPartB) return;
    const mate: AssemblyMate = {
      id: generateMateId(),
      type: newMateType,
      partA: newPartA,
      partB: newPartB,
      value: newMateType === 'distance' || newMateType === 'angle' ? newValue : undefined,
      locked: false,
    };
    onAddMate(mate);
    setAddMode(false);
  }, [newMateType, newPartA, newPartB, newValue, onAddMate]);

  const MATE_TYPES: MateType[] = ['coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent'];

  const sectionBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '6px 4px',
    borderRadius: 6,
    border: 'none',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    background: active ? C.accent : C.card,
    color: active ? '#fff' : C.textDim,
    transition: 'all 0.15s',
  });

  return (
    <div style={{
      width: 320,
      flexShrink: 0,
      borderLeft: `1px solid ${C.border}`,
      background: C.bg,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 12px',
        borderBottom: `1px solid ${C.border}`,
        gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>&#x2699;&#xFE0F;</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: C.text }}>{t.assembly}</span>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: C.card,
            cursor: 'pointer',
            fontSize: 12,
            color: C.textDim,
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          &#x2715;
        </button>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 3, padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
        <button type="button" data-testid="assembly-tab-mates" onClick={() => setActiveSection('mates')} style={sectionBtnStyle(activeSection === 'mates')}>
          {t.mates}
        </button>
        <button type="button" data-testid="assembly-tab-solver" onClick={() => setActiveSection('solver')} style={sectionBtnStyle(activeSection === 'solver')}>
          {t.solver}
        </button>
        <button type="button" data-testid="assembly-tab-interference" onClick={() => setActiveSection('interference')} style={sectionBtnStyle(activeSection === 'interference')}>
          {t.interference}
        </button>
        <button type="button" data-testid="assembly-tab-explode" onClick={() => setActiveSection('explode')} style={sectionBtnStyle(activeSection === 'explode')}>
          {t.explodedView}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>

        {interferenceLoad.suggestAggressiveViewportLOD && (
          <div
            data-testid="assembly-viewport-load-banner"
            role="status"
            style={{
              marginBottom: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid rgba(240,136,62,0.35)',
              background: 'rgba(240,136,62,0.08)',
              fontSize: 11,
              lineHeight: 1.45,
              color: C.text,
            }}
          >
            <div>
              {interferenceLoad.viewportBand === 'extreme'
                ? t.viewportLoadExtreme
                : interferenceLoad.viewportBand === 'heavy'
                  ? t.viewportLoadHeavy
                  : t.viewportLoadWarn}
            </div>
            {interferenceLoad.suggestOpenPerfPanel && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ fontSize: 10, color: C.textDim }}>{t.viewportPerfNote}</div>
                <button
                  type="button"
                  data-testid="assembly-open-perf-button"
                  onClick={() => setShowPerf(true)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: `1px solid ${C.accent}`,
                    background: '#0d1117',
                    color: C.accent,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t.viewportOpenPerfButton}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Mates Section ── */}
        {activeSection === 'mates' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {onApplyMatesToPlacement && mates.length > 0 && partNames.length >= 2 && (
              <button
                type="button"
                onClick={onApplyMatesToPlacement}
                style={{
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: `1px solid ${C.accent}`,
                  background: '#0d1117',
                  color: C.accent,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t.applyMatesPlacement}
              </button>
            )}
            {/* Existing mates */}
            {mates.length === 0 && !addMode && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ color: C.textDim, fontSize: 12, margin: 0 }}>{t.selectFaces}</p>
              </div>
            )}

            {mates.map(mate => (
              <div key={mate.id} style={{
                background: C.card,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                padding: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    background: C.accent,
                    borderRadius: 4,
                    padding: '1px 6px',
                  }}>
                    {mateLabels[mate.type]}
                  </span>
                  <span style={{ flex: 1, fontSize: 11, color: C.textDim, fontWeight: 600 }}>
                    {mate.partA} &#x2194; {mate.partB}
                  </span>
                  <button
                    onClick={() => onUpdateMate(mate.id, { locked: !mate.locked })}
                    title={mate.locked ? t.unlockMate : t.lockMate}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: mate.locked ? C.warning : C.textDim,
                      padding: '0 3px',
                    }}
                  >
                    {mate.locked ? '\uD83D\uDD12' : '\uD83D\uDD13'}
                  </button>
                  <button
                    onClick={() => onRemoveMate(mate.id)}
                    title={t.removeMate}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: C.danger,
                      padding: '0 3px',
                    }}
                  >
                    &#x2715;
                  </button>
                </div>
                {(mate.type === 'distance' || mate.type === 'angle') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>{t.value}:</span>
                    <input
                      type="number"
                      value={mate.value ?? 0}
                      onChange={e => onUpdateMate(mate.id, { value: parseFloat(e.target.value) || 0 })}
                      style={{
                        width: 70,
                        padding: '3px 6px',
                        borderRadius: 4,
                        border: `1px solid ${C.border}`,
                        background: '#0d1117',
                        color: C.text,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                    <span style={{ fontSize: 10, color: C.textDim }}>{mate.type === 'distance' ? 'mm' : 'deg'}</span>
                  </div>
                )}
              </div>
            ))}

            {/* Add mate form */}
            {addMode ? (
              <div style={{
                background: '#0d1117',
                borderRadius: 8,
                border: `1px solid ${C.accent}`,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                {/* Mate type */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, display: 'block', marginBottom: 3 }}>{t.type}</label>
                  <select
                    value={newMateType}
                    onChange={e => setNewMateType(e.target.value as MateType)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: C.card,
                      color: C.text,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {MATE_TYPES.map(mt => (
                      <option key={mt} value={mt}>{mateLabels[mt]}</option>
                    ))}
                  </select>
                </div>

                {/* Part A */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, display: 'block', marginBottom: 3 }}>{t.partA}</label>
                  <select
                    value={newPartA}
                    onChange={e => setNewPartA(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: C.card,
                      color: C.text,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {partNames.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Part B */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, display: 'block', marginBottom: 3 }}>{t.partB}</label>
                  <select
                    value={newPartB}
                    onChange={e => setNewPartB(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: C.card,
                      color: C.text,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {partNames.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Value (for distance/angle) */}
                {(newMateType === 'distance' || newMateType === 'angle') && (
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, display: 'block', marginBottom: 3 }}>
                      {t.value} ({newMateType === 'distance' ? 'mm' : 'deg'})
                    </label>
                    <input
                      type="number"
                      value={newValue}
                      onChange={e => setNewValue(parseFloat(e.target.value) || 0)}
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: 6,
                        border: `1px solid ${C.border}`,
                        background: C.card,
                        color: C.text,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleAddMate}
                    style={{
                      flex: 1,
                      padding: '7px',
                      borderRadius: 6,
                      border: 'none',
                      background: C.accent,
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {t.addMate}
                  </button>
                  <button
                    onClick={() => setAddMode(false)}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: 'transparent',
                      color: C.textDim,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddMode(true)}
                style={{
                  padding: '9px',
                  borderRadius: 8,
                  border: `1px dashed ${C.border}`,
                  background: 'transparent',
                  color: C.accent,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                + {t.addMate}
              </button>
            )}
          </div>
        )}

        {/* ── Solver Section ── */}
        {activeSection === 'solver' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: C.textDim, fontWeight: 600 }}>
              {t.solverTabHint}
            </p>
            {mates.length > 0 ? (
              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: C.textDim, fontWeight: 600 }}>
                {t.solverMateEditHint}
              </p>
            ) : null}
            <button
              type="button"
              disabled={!canSyncSolverFromBom}
              title={
                !canSyncSolverFromBom
                  ? (resolvedLang === 'ko'
                    ? '배치 파트 2개 이상 또는 멀티 바디 BOM 2행 이상일 때 사용'
                    : 'Requires at least two placed parts or two multi-body BOM rows')
                  : undefined
              }
              onClick={handleSyncSolverFromBom}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${canSyncSolverFromBom ? C.accent : C.border}`,
                background: canSyncSolverFromBom ? '#0d1117' : C.card,
                color: canSyncSolverFromBom ? C.accent : C.textDim,
                fontSize: 11,
                fontWeight: 700,
                cursor: canSyncSolverFromBom ? 'pointer' : 'not-allowed',
                opacity: canSyncSolverFromBom ? 1 : 0.55,
              }}
            >
              {t.syncSolverFromBom}
            </button>
            {solverSyncNotice ? (
              <p
                role="status"
                style={{
                  margin: 0,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: C.warning,
                  fontWeight: 600,
                }}
              >
                {solverSyncNotice}
              </p>
            ) : null}
            <AssemblyMatesPanel
              theme={solverTheme}
              lang={resolvedLang}
              assemblyState={solverAssembly}
              onAssemblyUpdate={setSolverAssembly}
            />
          </div>
        )}

        {/* ── Interference Section ── */}
        {activeSection === 'interference' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {interferenceLoad.suggestInterferencePreambleToast && interferenceCheckPartCount >= 2 && (
              <div
                data-testid="assembly-interference-preamble"
                role="status"
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.card,
                  fontSize: 10,
                  lineHeight: 1.45,
                  color: C.textDim,
                }}
              >
                {t.interferencePreambleBanner}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <button
                type="button"
                data-testid="assembly-run-interference"
                onClick={onDetectInterference}
                disabled={interferenceLoading}
                title={
                  interferenceLoading
                    ? undefined
                    : `${t.runCheck}: ${interferenceCheckPartCount} ${t.partsLabel} · ${interferenceLoad.pairwiseComparisons} ${t.pairChecksLabel}`
                }
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: 8,
                  border: `1px solid ${C.accent}`,
                  background: interferenceLoading ? C.card : '#0d1117',
                  color: C.accent,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: interferenceLoading ? 'default' : 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {interferenceLoading ? (
                  <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(56,139,253,0.3)', borderTopColor: C.accent, borderRadius: '50%', animation: 'nf-spin 0.8s linear infinite' }} />
                ) : null}
                {t.runCheck}
              </button>
              {interferenceLoading && onCancelInterference ? (
                <button
                  type="button"
                  onClick={onCancelInterference}
                  title={t.cancel}
                  style={{
                    flexShrink: 0,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.card,
                    color: C.textDim,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {t.cancel}
                </button>
              ) : null}
            </div>

            {interferenceCheckPartCount >= 2 && (
              <p style={{ margin: 0, fontSize: 10, lineHeight: 1.45, color: C.textDim }}>
                {interferenceCheckPartCount} {t.partsLabel} · {interferenceLoad.pairwiseComparisons} {t.pairChecksLabel}
                {(interferenceLoad.interferenceBand === 'heavy' || interferenceLoad.interferenceBand === 'extreme') && (
                  <span style={{
                    display: 'block',
                    marginTop: 4,
                    fontWeight: 600,
                    color: interferenceLoad.interferenceBand === 'extreme' ? C.warning : C.textDim,
                  }}>
                    {interferenceLoad.interferenceBand === 'extreme' ? t.interferenceHintExtreme : t.interferenceHintHeavy}
                  </span>
                )}
              </p>
            )}

            {interferenceResults.length === 0 && !interferenceLoading && (
              <div style={{
                textAlign: 'center',
                padding: 16,
                background: C.card,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
              }}>
                <span style={{ fontSize: 20, display: 'block', marginBottom: 6 }}>&#x2705;</span>
                <p style={{ color: C.success, fontSize: 12, fontWeight: 700, margin: 0 }}>
                  {t.noInterference}
                </p>
              </div>
            )}

            {interferenceResults.map((res, i) => (
              <div key={i} style={{
                background: '#1a0808',
                borderRadius: 8,
                border: `1px solid ${C.danger}`,
                padding: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>&#x26A0;&#xFE0F;</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.danger }}>
                    {t.interferenceFound}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.text, fontWeight: 600, marginBottom: 2 }}>
                  {res.partA} &#x2194; {res.partB}
                </div>
                <div style={{ fontSize: 10, color: C.textDim }}>
                  {t.volume}: {res.volume.toFixed(3)} cm&#xB3;
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Exploded View Section ── */}
        {activeSection === 'explode' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              background: C.card,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              padding: 12,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                  {t.explodedView}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: explodeFactor > 0 ? C.warning : C.success,
                  background: explodeFactor > 0 ? '#2a1a08' : '#0a1a08',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}>
                  {explodeFactor > 0 ? t.exploded : t.assembled}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(explodeFactor * 100)}
                onChange={e => onExplodeFactorChange(parseInt(e.target.value, 10) / 100)}
                style={{
                  width: '100%',
                  accentColor: C.accent,
                  height: 6,
                  cursor: 'pointer',
                }}
              />

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 6,
                fontSize: 10,
                color: C.textDim,
                fontWeight: 600,
              }}>
                <span>0%</span>
                <span style={{
                  fontFamily: 'monospace',
                  color: C.text,
                  fontSize: 12,
                  fontWeight: 800,
                }}>
                  {Math.round(explodeFactor * 100)}%
                </span>
                <span>100%</span>
              </div>
            </div>

            {/* Quick presets */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 0.25, 0.5, 0.75, 1].map(v => (
                <button
                  key={v}
                  onClick={() => onExplodeFactorChange(v)}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: 4,
                    border: 'none',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: Math.abs(explodeFactor - v) < 0.01 ? C.accent : C.card,
                    color: Math.abs(explodeFactor - v) < 0.01 ? '#fff' : C.textDim,
                    transition: 'all 0.12s',
                  }}
                >
                  {Math.round(v * 100)}%
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
