import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ShapeResult } from '../shapes';
import type { DFMResult } from '../analysis/dfmAnalysis';
import type { PlanLimits } from '../freemium/planLimits';
import type { Toast } from '../useToast';
import { useAuthStore } from '@/hooks/useAuth';
import { estimateCosts } from '../estimation/CostEstimator';
import { KRW_PER_USD } from '@/lib/currency';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { loc } from '@/lib/i18n/loc';

type AddToast = (type: Toast['type'], msg: string) => void;

function manufacturingCopy(lang: string) {
  const L = (ko: string, en: string, ja: string, zh: string, es: string, ar: string) =>
    loc(lang, { ko, en, ja, zh, es, ar });
  return {
    upgrade: L('견적 요청', 'Request quote', '見積依頼', '请求报价', 'Solicitar presupuesto', 'طلب عرض سعر'),
    customSketch: L('사용자 스케치', 'Custom Sketch', 'カスタムスケッチ', '自定义草图', 'Boceto personalizado', 'رسم مخصص'),
    user: L('사용자', 'User', 'ユーザー', '用户', 'Usuario', 'المستخدم'),
    shape: L('형상', 'Shape', '形状', '形状', 'Forma', 'الشكل'), material: L('소재', 'Material', '材料', '材料', 'Material', 'المادة'),
    density: L('밀도', 'density', '密度', '密度', 'densidad', 'الكثافة'), dimensions: L('치수', 'Dimensions', '寸法', '尺寸', 'Dimensiones', 'الأبعاد'),
    volume: L('부피', 'Volume', '体積', '体积', 'Volumen', 'الحجم'), surface: L('표면적', 'Surface area', '表面積', '表面积', 'Área superficial', 'مساحة السطح'),
    weight: L('무게', 'Weight', '重量', '重量', 'Peso', 'الوزن'), quantity: L('수량', 'Quantity', '数量', '数量', 'Cantidad', 'الكمية'),
    process: L('권장 공정', 'Recommended process', '推奨工程', '推荐工艺', 'Proceso recomendado', 'العملية الموصى بها'),
    unitCost: L('예상 단가', 'Estimated unit cost', '推定単価', '预计单价', 'Coste unitario estimado', 'تكلفة الوحدة المقدّرة'),
    leadTime: L('리드타임', 'Lead time', 'リードタイム', '交付周期', 'Plazo de entrega', 'مدة التسليم'),
    unset: L('미정', 'Not set', '未設定', '未设置', 'Sin definir', 'غير محدد'),
    score: L('DFM 점수', 'DFM score', 'DFMスコア', 'DFM评分', 'Puntuación DFM', 'درجة DFM'),
    issues: L('이슈', 'issues', '問題', '问题', 'problemas', 'مشكلات'), errors: L('오류', 'errors', 'エラー', '错误', 'errores', 'أخطاء'),
    topIssues: L('주요 DFM 이슈', 'Top DFM issues', '主なDFM問題', '主要DFM问题', 'Principales problemas DFM', 'أهم مشكلات DFM'),
    success: L('RFQ가 생성되었습니다. 견적 요청 페이지에서 확인하세요.', 'RFQ created. Check your quote requests.', 'RFQを作成しました。見積依頼ページで確認してください。', 'RFQ已创建，请在报价请求页面查看。', 'RFQ creada. Revise sus solicitudes de presupuesto.', 'تم إنشاء طلب عرض السعر. راجعه في صفحة طلبات الأسعار.'),
    failed: L('RFQ 생성 실패', 'RFQ creation failed', 'RFQの作成に失敗しました', 'RFQ创建失败', 'Error al crear la RFQ', 'فشل إنشاء طلب عرض السعر'),
  };
}

export interface ManufacturingFlowDeps {
  effectiveResult: ShapeResult | null;
  selectedId: string;
  sketchResult: ShapeResult | null;
  materialId: string;
  quantity?: number;
  dfmResults: DFMResult[] | null;
  planLimits: PlanLimits;
  lang: string;
  langSeg: string;
  addToast: AddToast;
  router: AppRouterInstance;
  setShowUpgradePrompt: (v: boolean) => void;
  setUpgradeFeature: (f: string) => void;
  shareToken?: string | null;
}

export function useManufacturingFlow(deps: ManufacturingFlowDeps) {
  const {
    effectiveResult,
    selectedId,
    sketchResult,
    materialId,
    quantity = 1,
    dfmResults,
    planLimits,
    lang,
    langSeg,
    addToast,
    router,
    setShowUpgradePrompt,
    setUpgradeFeature,
    shareToken,
  } = deps;
  const copy = useMemo(() => manufacturingCopy(lang), [lang]);

  const [showManufacturingCard, setShowManufacturingCard] = useState(false);
  const [showManufacturerMatch, setShowManufacturerMatch] = useState(false);
  const [rfqPending, setRfqPending] = useState(false);

  // Auto-popup ManufacturingReadyCard the first time a result is generated.
  const didAutoPopup = useRef(false);
  useEffect(() => {
    if (effectiveResult && !didAutoPopup.current) {
      didAutoPopup.current = true;
      const timer = setTimeout(() => setShowManufacturingCard(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [effectiveResult]);

  const handleGetQuote = useCallback(async () => {
    if (!effectiveResult) return;
    if (!planLimits.rfq) {
      setUpgradeFeature(copy.upgrade);
      setShowUpgradePrompt(true);
      return;
    }
    setRfqPending(true);
    try {
      const token = useAuthStore.getState().token;

      // ── 비용 추정 (최적 공정 찾기) ─────────────────────────────────────────
      const costEstimates = estimateCosts(
        {
          volume_cm3: effectiveResult.volume_cm3,
          surfaceArea_cm2: effectiveResult.surface_area_cm2,
          boundingBox: effectiveResult.bbox,
          complexity: Math.min(1, (effectiveResult.geometry.attributes.position?.count ?? 1000) / 10000),
        },
        materialId,
        [quantity],
      );
      const bestEstimate = costEstimates.length > 0
        ? costEstimates.reduce((a, b) => a.unitCost < b.unitCost ? a : b)
        : null;

      // ── DFM 요약 ──────────────────────────────────────────────────────────
      const dfmScore = dfmResults?.[0]?.score ?? null;
      const dfmIssueCount = dfmResults?.reduce((s, r) => s + r.issues.length, 0) ?? 0;
      const dfmErrors = dfmResults?.reduce(
        (s, r) => s + r.issues.filter(i => i.severity === 'error').length, 0,
      ) ?? 0;
      const dfmTopIssues = dfmResults
        ?.flatMap(r => r.issues)
        .slice(0, 3)
        .map(i => `[${i.severity}] ${i.description}`) ?? [];

      // ── 무게 추정 (밀도 기반) ──────────────────────────────────────────────
      const DENSITY_MAP: Record<string, number> = {
        aluminum: 2.7, steel: 7.85, stainless_steel: 8.0,
        titanium: 4.5, copper: 8.96, brass: 8.5,
        abs: 1.05, pla: 1.24, nylon: 1.14, pc: 1.2,
      };
      const density = DENSITY_MAP[materialId] ?? 2.7;
      const weight_g = effectiveResult.volume_cm3 * density;

      // ── RFQ API 호출 ──────────────────────────────────────────────────────
      const shapeName = sketchResult ? copy.customSketch : selectedId;
      const rfqRes = await fetch('/api/nexyfab/rfq', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          shapeId: selectedId,
          shapeName,
          materialId,
          quantity,
          volume_cm3: effectiveResult.volume_cm3,
          surface_area_cm2: effectiveResult.surface_area_cm2,
          bbox: effectiveResult.bbox,
          weight_g,
          dfmResults: dfmResults ?? undefined,
          recommendedProcess: bestEstimate?.process,
          estimatedUnitCost_krw: bestEstimate ? Math.round(bestEstimate.unitCost * KRW_PER_USD) : null,
          shareToken: shareToken ?? undefined,
          dfmScore: dfmScore ?? undefined,
          dfmProcess: dfmResults?.[0]?.process ?? undefined,
        }),
      });

      let rfqData: { rfqId?: string } = {};
      try { rfqData = await rfqRes.json(); } catch { /* ignore */ }

      // ── Attach the actual CAD files (STEP + STL) to the RFQ ───────────────
      // Previously an RFQ carried only metrics + a /view/ viewer link, so a
      // partner had no manufacturable file to quote/produce from. Generate the
      // STEP + STL headlessly and upload them against the rfqId (stored in
      // nf_files, ref_type='rfq'). Non-blocking: a failure must not fail RFQ
      // creation. (2026-06-09 design→manufacturing continuity.)
      if (rfqData.rfqId && effectiveResult.geometry) {
        const rfqId = rfqData.rfqId;
        const geo = effectiveResult.geometry;
        void (async () => {
          try {
            const [{ exportToStepAsync }, { buildBinaryStl }] = await Promise.all([
              import('../io/stepExporter'),
              import('../io/stlEncode'),
            ]);
            const stepText = await exportToStepAsync(geo, shapeName);
            const stlBuf = buildBinaryStl(geo);
            const fd = new FormData();
            fd.append('rfqId', rfqId);
            fd.append('file', new Blob([stepText], { type: 'application/step' }), `${shapeName}.step`);
            fd.append('file', new Blob([stlBuf], { type: 'model/stl' }), `${shapeName}.stl`);
            await fetch('/api/quick-quote/upload', {
              method: 'POST',
              headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: fd,
            });
          } catch { /* non-blocking — the RFQ itself is already created */ }
        })();
      }

      // ── 현재 사용자 정보 ──────────────────────────────────────────────────
      let currentUser: { name?: string; email?: string } = {};
      if (typeof window !== 'undefined') {
        try {
          const stored = sessionStorage.getItem('currentUser');
          if (stored) currentUser = JSON.parse(stored);
        } catch { /* ignore */ }
      }

      const dateStr = formatDate(new Date(), lang) ?? '';
      const projectName = sketchResult
        ? `${copy.customSketch} - ${dateStr}`
        : `${shapeName} - ${dateStr}`;

      // ── 구조화된 메시지 (공장이 실제로 견적 낼 수 있는 정보) ──────────────
      const structuredMessage = [
        `[${copy.shape}] ${shapeName}`,
        `[${copy.material}] ${materialId} (${copy.density} ${density} g/cm³)`,
        `[${copy.dimensions}] W${effectiveResult.bbox.w.toFixed(1)} × H${effectiveResult.bbox.h.toFixed(1)} × D${effectiveResult.bbox.d.toFixed(1)} mm`,
        `[${copy.volume}] ${effectiveResult.volume_cm3.toFixed(2)} cm³`,
        `[${copy.surface}] ${effectiveResult.surface_area_cm2.toFixed(1)} cm²`,
        `[${copy.weight}] ${weight_g < 1000 ? weight_g.toFixed(1) + 'g' : (weight_g / 1000).toFixed(2) + 'kg'}`,
        `[${copy.quantity}] ${quantity}`,
        `[${copy.process}] ${bestEstimate?.process ?? copy.unset}`,
        `[${copy.unitCost}] ${bestEstimate ? '₩' + (formatNumber(Math.round(bestEstimate.unitCost * KRW_PER_USD), lang) ?? '0') : copy.unset}`,
        `[${copy.leadTime}] ${bestEstimate?.leadTime ?? copy.unset}`,
        dfmScore !== null ? `[${copy.score}] ${dfmScore}/100 (${copy.issues} ${dfmIssueCount}, ${copy.errors} ${dfmErrors})` : '',
        dfmTopIssues.length > 0 ? `[${copy.topIssues}]\n${dfmTopIssues.map(i => '  - ' + i).join('\n')}` : '',
        rfqData.rfqId ? `[RFQ ID] ${rfqData.rfqId}` : '',
      ].filter(Boolean).join('\n');

      // ── 대시보드 inquiry 등록 ─────────────────────────────────────────────
      await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: currentUser.name || copy.user,
          email: currentUser.email || '',
          projectName,
          message: structuredMessage,
          rfqId: rfqData.rfqId,
          shapeId: selectedId,
          materialId,
          quantity,
          // 구조화 데이터 (API에서 저장/검색 가능)
          rfqData: {
            shapeName,
            bbox: effectiveResult.bbox,
            volume_cm3: effectiveResult.volume_cm3,
            surface_area_cm2: effectiveResult.surface_area_cm2,
            weight_g,
            toleranceClass: 'm',       // ISO 2768-m (기본값)
            generalRoughness: 'N7',    // Ra 1.6µm (기본 기계가공)
            recommendedProcess: bestEstimate?.process,
            estimatedUnitCost_krw: bestEstimate ? Math.round(bestEstimate.unitCost * KRW_PER_USD) : null,
            leadTime: bestEstimate?.leadTime,
            dfmScore,
            dfmIssueCount,
            dfmErrors,
          },
        }),
      });

      addToast('success', copy.success);

      setShowManufacturerMatch(true);

      // Redirect to RFQ list after 1.5s
      setTimeout(() => {
        router.push(`/${langSeg}/nexyfab/rfq`);
      }, 1500);
    } catch {
      addToast('error', copy.failed);
    } finally {
      setRfqPending(false);
    }
  }, [
    effectiveResult,
    selectedId,
    sketchResult,
    materialId,
    dfmResults,
    planLimits.rfq,
    addToast,
    lang,
    setUpgradeFeature,
    setShowUpgradePrompt,
    shareToken,
    router,
    langSeg,
    quantity,
    copy,
  ]);

  return {
    showManufacturingCard,
    setShowManufacturingCard,
    showManufacturerMatch,
    setShowManufacturerMatch,
    rfqPending,
    handleGetQuote,
  };
}
