'use client';

/**
 * QuickCostPreview.tsx — Pre-RFQ instant ballpark estimate.
 *
 * Renders a single-line "≈ ₩X / Y일 (±30%)" card from the existing
 * estimateCosts() engine, picking the cheapest applicable process for the
 * chosen material. Surface area is approximated from bounding box when an
 * exact mesh isn't available (RFQ context only carries volume + bbox).
 */

import React, { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  estimateCosts,
  formatCost,
  type CostCurrency,
  type GeometryMetrics,
  type ProcessType,
} from '../estimation/CostEstimator';

interface QuickCostPreviewProps {
  lang?: string;
  materialId: string;
  quantity: number;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  /** When known, prefer this process estimate over the cheapest applicable one. */
  preferProcess?: ProcessType;
  currency?: CostCurrency;
}

const dict = {
  ko: {
    empty: '⏳ 형상 분석 후 즉시 견적이 표시됩니다',
    label: '즉시 견적 (참고용)',
    pcs: '개',
    disclaimer: '실제 견적은 업체 회신 후 확정됩니다. 사양·수량 변경 시 변동될 수 있습니다.',
  },
  en: {
    empty: '⏳ Quick estimate appears after geometry analysis',
    label: 'Instant Estimate (ballpark)',
    pcs: ' pcs',
    disclaimer: 'Final price set after supplier response. Specs/quantity may shift this range.',
  },
  ja: {
    empty: '⏳ 形状解析後に即時見積もりが表示されます',
    label: '即時見積もり (参考)',
    pcs: '個',
    disclaimer: '最終価格はサプライヤーの回答後に確定します。仕様・数量の変更で変動することがあります。',
  },
  zh: {
    empty: '⏳ 形状分析后将显示即时报价',
    label: '即时报价 (参考)',
    pcs: '件',
    disclaimer: '最终价格在供应商回复后确认。规格/数量变更可能影响此范围。',
  },
  es: {
    empty: '⏳ Estimación rápida tras el análisis de geometría',
    label: 'Estimación Inmediata (aprox.)',
    pcs: ' uds',
    disclaimer: 'El precio final se fija tras la respuesta del proveedor. Cambios pueden variar el rango.',
  },
  ar: {
    empty: '⏳ يظهر التقدير الفوري بعد تحليل الشكل',
    label: 'تقدير فوري (تقريبي)',
    pcs: ' قطعة',
    disclaimer: 'السعر النهائي يُحدد بعد رد المورد. قد تتغير المواصفات/الكمية هذا النطاق.',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

function approxSurfaceArea_cm2(bbox?: { w: number; h: number; d: number }): number {
  if (!bbox) return 100;
  const w_cm = bbox.w / 10, h_cm = bbox.h / 10, d_cm = bbox.d / 10;
  return 2 * (w_cm * h_cm + w_cm * d_cm + h_cm * d_cm);
}

export default function QuickCostPreview({
  materialId, quantity, volume_cm3, bbox, preferProcess, currency = 'KRW',
}: QuickCostPreviewProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];

  const estimate = useMemo(() => {
    if (!volume_cm3 || volume_cm3 <= 0) return null;
    const metrics: GeometryMetrics = {
      volume_cm3,
      surfaceArea_cm2: approxSurfaceArea_cm2(bbox),
      boundingBox: bbox ?? { w: 50, h: 50, d: 50 },
      complexity: 0.5,
    };
    const all = estimateCosts(metrics, materialId, [quantity || 1], { currency });
    if (all.length === 0) return null;
    const preferred = preferProcess ? all.find(e => e.process === preferProcess) : null;
    return preferred ?? all.reduce((cheapest, cur) =>
      cur.totalCost < cheapest.totalCost ? cur : cheapest, all[0]);
  }, [materialId, quantity, volume_cm3, bbox, preferProcess, currency]);

  if (!estimate) {
    return (
      <div style={{
        padding: '8px 10px', borderRadius: 6, background: 'rgba(110,118,129,0.1)',
        border: '1px solid #30363d', color: '#8b949e', fontSize: 11,
      }}>
        {t.empty}
      </div>
    );
  }

  // ±30% range — flagged clearly so the user understands this is a ballpark, not the binding quote.
  const low  = Math.round(estimate.totalCost * 0.7);
  const high = Math.round(estimate.totalCost * 1.3);
  const lowStr  = formatCost(low,  estimate.currency);
  const highStr = formatCost(high, estimate.currency);

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'linear-gradient(135deg, rgba(63,185,80,0.08), rgba(56,139,253,0.08))',
      border: '1px solid #3fb950',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: '#3fb950', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {t.label}
        </span>
        <span style={{ fontSize: 9, color: '#8b949e' }}>±30%</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#c9d1d9' }}>
          {lowStr} ~ {highStr}
        </span>
        <span style={{ fontSize: 11, color: '#8b949e' }}>
          · {estimate.processName} · {estimate.leadTime}
          {quantity > 1 && ` · ${quantity}${t.pcs}`}
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: '#6e7681' }}>
        {t.disclaimer}
      </div>
    </div>
  );
}
