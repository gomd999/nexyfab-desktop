import { useState, useCallback, useEffect, useRef } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ShapeResult } from '../shapes';
import type { DFMResult } from '../analysis/dfmAnalysis';
import type { PlanLimits } from '../freemium/planLimits';
import type { Toast } from '../useToast';
import { useAuthStore } from '@/hooks/useAuth';
import { estimateCosts } from '../estimation/CostEstimator';
import { KRW_PER_USD } from '@/lib/currency';

type AddToast = (type: Toast['type'], msg: string) => void;

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
      setUpgradeFeature('견적 요청');
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
      const shapeName = sketchResult ? 'Custom Sketch' : selectedId;
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

      let rfqData: any = {};
      try { rfqData = await rfqRes.json(); } catch { /* ignore */ }

      // ── 현재 사용자 정보 ──────────────────────────────────────────────────
      let currentUser: { name?: string; email?: string } = {};
      if (typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('currentUser');
          if (stored) currentUser = JSON.parse(stored);
        } catch { /* ignore */ }
      }

      const dateStr = new Date().toLocaleDateString('ko-KR');
      const projectName = sketchResult
        ? `Custom Sketch - ${dateStr}`
        : `${shapeName} - ${dateStr}`;

      // ── 구조화된 메시지 (공장이 실제로 견적 낼 수 있는 정보) ──────────────
      const structuredMessage = [
        `[형상] ${shapeName}`,
        `[소재] ${materialId} (밀도 ${density} g/cm³)`,
        `[치수] W${effectiveResult.bbox.w.toFixed(1)} × H${effectiveResult.bbox.h.toFixed(1)} × D${effectiveResult.bbox.d.toFixed(1)} mm`,
        `[부피] ${effectiveResult.volume_cm3.toFixed(2)} cm³`,
        `[표면적] ${effectiveResult.surface_area_cm2.toFixed(1)} cm²`,
        `[무게] ${weight_g < 1000 ? weight_g.toFixed(1) + 'g' : (weight_g / 1000).toFixed(2) + 'kg'}`,
        `[수량] ${quantity}개`,
        `[권장 공정] ${bestEstimate?.process ?? '미정'}`,
        `[예상 단가] ${bestEstimate ? '₩' + Math.round(bestEstimate.unitCost * KRW_PER_USD).toLocaleString('ko-KR') : '미정'}`,
        `[리드타임] ${bestEstimate?.leadTime ?? '미정'}`,
        dfmScore !== null ? `[DFM 점수] ${dfmScore}/100 (이슈 ${dfmIssueCount}건, 오류 ${dfmErrors}건)` : '',
        dfmTopIssues.length > 0 ? `[주요 DFM 이슈]\n${dfmTopIssues.map(i => '  - ' + i).join('\n')}` : '',
        rfqData.rfqId ? `[RFQ ID] ${rfqData.rfqId}` : '',
      ].filter(Boolean).join('\n');

      // ── 대시보드 inquiry 등록 ─────────────────────────────────────────────
      await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: currentUser.name || '사용자',
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

      addToast('success', lang === 'ko'
        ? 'RFQ가 생성되었습니다. 견적 요청 페이지에서 확인하세요.'
        : 'RFQ created. Check your quote requests.');

      setShowManufacturerMatch(true);

      // Redirect to RFQ list after 1.5s
      setTimeout(() => {
        router.push(`/${langSeg}/nexyfab/rfq`);
      }, 1500);
    } catch {
      addToast('error', lang === 'ko' ? 'RFQ 생성 실패' : 'RFQ creation failed');
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
