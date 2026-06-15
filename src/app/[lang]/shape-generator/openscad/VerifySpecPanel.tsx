'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  type SpecVerificationResult,
  formatSpecCritique,
} from '@/lib/ai/scad-agent/specVerification';

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: 'var(--nx-panel)',
  card: 'var(--nx-panel-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  textDim: 'var(--nx-text-2)',
  accent: 'var(--nx-accent)',
  green: 'var(--nx-ok)',
  red: 'var(--nx-error)',
};

/* ─── i18n ───────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '사양 검증 결과',
    empty: '아직 검증을 실행하지 않았습니다.',
    specOk: '사양 일치',
    issues: '건의 문제',
    skipped: '건너뜀',
    expand: '자세히 보기',
    collapse: '접기',
    layerBbox: '치수 (BBox)',
    layerHoleCount: '관통 구멍 수',
    layerVolume: '체적',
    layerSurfaceArea: '표면적',
    layerHolePositions: '구멍 위치',
    layerFillet: '필렛 적용',
    layerThreads: '나사산 (ISO)',
    layerIntent: '의도 일관성',
    summaryBbox: (w: number, h: number, d: number) =>
      `${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} mm`,
    summaryBboxSkip: '치수 예측 불가',
    summaryHoleCount: (e: number, d: number | null) =>
      d === null ? `예상 ${e}, 검출 불가` : `예상 ${e}, 검출 ${d}`,
    summaryVolume: (e: number, a: number) => `${a.toFixed(0)} / 예상 ${e.toFixed(0)} mm³`,
    summarySurfaceArea: (e: number, a: number) => `${a.toFixed(0)} / 예상 ${e.toFixed(0)} mm²`,
    summaryHolePositions: (n: number, ok: boolean) => `${n}개 구멍 · ${ok ? '일치' : '불일치'}`,
    summaryFillet: (sharp: number, max: number) =>
      `샤프 에지 ${sharp} · 최대 이면각 ${max.toFixed(1)}°`,
    summaryThreads: (n: number, ok: boolean) => `${n}개 나사 · ${ok ? 'ISO 일치' : 'ISO 불일치'}`,
    summaryIntent: (ok: boolean) => (ok ? '의도 일관' : '의도 충돌 발견'),
    notRunYet: '검증 안 함',
  },
  en: {
    title: 'Spec Verification',
    empty: 'No verification run yet.',
    specOk: 'spec ok',
    issues: 'issues',
    skipped: 'skipped',
    expand: 'Show detail',
    collapse: 'Hide detail',
    layerBbox: 'BBox dimensions',
    layerHoleCount: 'Through-hole count',
    layerVolume: 'Volume',
    layerSurfaceArea: 'Surface area',
    layerHolePositions: 'Hole positions',
    layerFillet: 'Fillet application',
    layerThreads: 'Threads (ISO)',
    layerIntent: 'Intent self-consistency',
    summaryBbox: (w: number, h: number, d: number) =>
      `${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} mm`,
    summaryBboxSkip: 'bbox prediction unavailable',
    summaryHoleCount: (e: number, d: number | null) =>
      d === null ? `expected ${e}, not detectable` : `expected ${e}, detected ${d}`,
    summaryVolume: (e: number, a: number) => `${a.toFixed(0)} / expected ${e.toFixed(0)} mm³`,
    summarySurfaceArea: (e: number, a: number) => `${a.toFixed(0)} / expected ${e.toFixed(0)} mm²`,
    summaryHolePositions: (n: number, ok: boolean) =>
      `${n} hole${n === 1 ? '' : 's'} · ${ok ? 'matched' : 'not matched'}`,
    summaryFillet: (sharp: number, max: number) =>
      `sharp edges ${sharp} · max dihedral ${max.toFixed(1)}°`,
    summaryThreads: (n: number, ok: boolean) =>
      `${n} thread${n === 1 ? '' : 's'} · ${ok ? 'ISO ok' : 'ISO mismatch'}`,
    summaryIntent: (ok: boolean) => (ok ? 'consistent' : 'conflicts found'),
    notRunYet: 'not checked',
  },
  ja: {
    title: '仕様検証結果',
    empty: 'まだ検証を実行していません。',
    specOk: '仕様一致',
    issues: '件の問題',
    skipped: 'スキップ',
    expand: '詳細を表示',
    collapse: '詳細を非表示',
    layerBbox: '寸法 (BBox)',
    layerHoleCount: '貫通穴数',
    layerVolume: '体積',
    layerSurfaceArea: '表面積',
    layerHolePositions: '穴位置',
    layerFillet: 'フィレット適用',
    layerThreads: 'ねじ (ISO)',
    layerIntent: '意図一貫性',
    summaryBbox: (w: number, h: number, d: number) =>
      `${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} mm`,
    summaryBboxSkip: '寸法予測不可',
    summaryHoleCount: (e: number, d: number | null) =>
      d === null ? `予想 ${e}, 検出不可` : `予想 ${e}, 検出 ${d}`,
    summaryVolume: (e: number, a: number) => `${a.toFixed(0)} / 予想 ${e.toFixed(0)} mm³`,
    summarySurfaceArea: (e: number, a: number) => `${a.toFixed(0)} / 予想 ${e.toFixed(0)} mm²`,
    summaryHolePositions: (n: number, ok: boolean) => `${n}個の穴 · ${ok ? '一致' : '不一致'}`,
    summaryFillet: (sharp: number, max: number) =>
      `鋭エッジ ${sharp} · 最大二面角 ${max.toFixed(1)}°`,
    summaryThreads: (n: number, ok: boolean) =>
      `${n}個ねじ · ${ok ? 'ISO適合' : 'ISO不適合'}`,
    summaryIntent: (ok: boolean) => (ok ? '一貫' : '衝突あり'),
    notRunYet: '未検証',
  },
  zh: {
    title: '规格验证结果',
    empty: '尚未运行验证。',
    specOk: '规格符合',
    issues: '个问题',
    skipped: '跳过',
    expand: '查看详情',
    collapse: '隐藏详情',
    layerBbox: '尺寸 (BBox)',
    layerHoleCount: '通孔数量',
    layerVolume: '体积',
    layerSurfaceArea: '表面积',
    layerHolePositions: '孔位置',
    layerFillet: '圆角应用',
    layerThreads: '螺纹 (ISO)',
    layerIntent: '意图一致性',
    summaryBbox: (w: number, h: number, d: number) =>
      `${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} mm`,
    summaryBboxSkip: '尺寸预测不可用',
    summaryHoleCount: (e: number, d: number | null) =>
      d === null ? `预期 ${e}, 无法检测` : `预期 ${e}, 检测 ${d}`,
    summaryVolume: (e: number, a: number) => `${a.toFixed(0)} / 预期 ${e.toFixed(0)} mm³`,
    summarySurfaceArea: (e: number, a: number) => `${a.toFixed(0)} / 预期 ${e.toFixed(0)} mm²`,
    summaryHolePositions: (n: number, ok: boolean) => `${n}个孔 · ${ok ? '匹配' : '不匹配'}`,
    summaryFillet: (sharp: number, max: number) =>
      `锐边 ${sharp} · 最大二面角 ${max.toFixed(1)}°`,
    summaryThreads: (n: number, ok: boolean) =>
      `${n}个螺纹 · ${ok ? 'ISO 符合' : 'ISO 不符'}`,
    summaryIntent: (ok: boolean) => (ok ? '一致' : '发现冲突'),
    notRunYet: '未检查',
  },
  es: {
    title: 'Verificación de especificación',
    empty: 'Aún no se ha ejecutado verificación.',
    specOk: 'spec ok',
    issues: 'problemas',
    skipped: 'omitido',
    expand: 'Mostrar detalle',
    collapse: 'Ocultar detalle',
    layerBbox: 'Dimensiones BBox',
    layerHoleCount: 'Conteo de agujeros pasantes',
    layerVolume: 'Volumen',
    layerSurfaceArea: 'Área superficial',
    layerHolePositions: 'Posiciones de agujeros',
    layerFillet: 'Aplicación de fillet',
    layerThreads: 'Roscas (ISO)',
    layerIntent: 'Consistencia de intención',
    summaryBbox: (w: number, h: number, d: number) =>
      `${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} mm`,
    summaryBboxSkip: 'predicción de bbox no disponible',
    summaryHoleCount: (e: number, d: number | null) =>
      d === null ? `esperado ${e}, no detectable` : `esperado ${e}, detectado ${d}`,
    summaryVolume: (e: number, a: number) => `${a.toFixed(0)} / esperado ${e.toFixed(0)} mm³`,
    summarySurfaceArea: (e: number, a: number) => `${a.toFixed(0)} / esperado ${e.toFixed(0)} mm²`,
    summaryHolePositions: (n: number, ok: boolean) =>
      `${n} agujero${n === 1 ? '' : 's'} · ${ok ? 'coincide' : 'no coincide'}`,
    summaryFillet: (sharp: number, max: number) =>
      `aristas vivas ${sharp} · diedro máx ${max.toFixed(1)}°`,
    summaryThreads: (n: number, ok: boolean) =>
      `${n} rosca${n === 1 ? '' : 's'} · ${ok ? 'ISO ok' : 'ISO no coincide'}`,
    summaryIntent: (ok: boolean) => (ok ? 'consistente' : 'conflictos encontrados'),
    notRunYet: 'no verificado',
  },
  ar: {
    title: 'التحقق من المواصفات',
    empty: 'لم يتم تشغيل التحقق بعد.',
    specOk: 'المواصفات مطابقة',
    issues: 'مشكلات',
    skipped: 'تم التخطي',
    expand: 'عرض التفاصيل',
    collapse: 'إخفاء التفاصيل',
    layerBbox: 'أبعاد BBox',
    layerHoleCount: 'عدد الثقوب النافذة',
    layerVolume: 'الحجم',
    layerSurfaceArea: 'مساحة السطح',
    layerHolePositions: 'مواقع الثقوب',
    layerFillet: 'تطبيق التدوير',
    layerThreads: 'الأسنان (ISO)',
    layerIntent: 'اتساق النية',
    summaryBbox: (w: number, h: number, d: number) =>
      `${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} مم`,
    summaryBboxSkip: 'تنبؤ BBox غير متاح',
    summaryHoleCount: (e: number, d: number | null) =>
      d === null ? `متوقع ${e}، غير قابل للكشف` : `متوقع ${e}، مكتشف ${d}`,
    summaryVolume: (e: number, a: number) => `${a.toFixed(0)} / متوقع ${e.toFixed(0)} مم³`,
    summarySurfaceArea: (e: number, a: number) =>
      `${a.toFixed(0)} / متوقع ${e.toFixed(0)} مم²`,
    summaryHolePositions: (n: number, ok: boolean) =>
      `${n} ثقب · ${ok ? 'مطابق' : 'غير مطابق'}`,
    summaryFillet: (sharp: number, max: number) =>
      `حواف حادة ${sharp} · أقصى زاوية ${max.toFixed(1)}°`,
    summaryThreads: (n: number, ok: boolean) =>
      `${n} سن · ${ok ? 'متطابق ISO' : 'غير متطابق ISO'}`,
    summaryIntent: (ok: boolean) => (ok ? 'متسق' : 'تعارضات موجودة'),
    notRunYet: 'لم يتم الفحص',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

/* ─── Props ──────────────────────────────────────────────────────────────── */

interface VerifySpecPanelProps {
  lang: string;
  result: SpecVerificationResult | null;
}

/* ─── Layer model ────────────────────────────────────────────────────────── */

type LayerStatus = 'ok' | 'mismatch' | 'skipped';

type LayerKey =
  | 'bbox'
  | 'holeCount'
  | 'volume'
  | 'surfaceArea'
  | 'holePositions'
  | 'fillet'
  | 'threads'
  | 'intent';

interface LayerRow {
  key: LayerKey;
  label: string;
  status: LayerStatus;
  summary: string;
  /** Sub-result formatted via formatSpecCritique on a focused projection. */
  detail: string;
}

type Tt = (typeof dict)[keyof typeof dict];

/**
 * Build the 8 layer rows from the verification result.
 *
 * Each layer projects the result down to a single sub-aspect (e.g. only
 * bbox mismatches, or only the volume sub-field) and re-runs
 * `formatSpecCritique` against that projection so the expandable detail
 * carries the same wording the agent sees.
 */
function buildLayers(result: SpecVerificationResult, tt: Tt): LayerRow[] {
  const layers: LayerRow[] = [];

  /** Project the result down to a focused sub-aspect, then format. */
  function focusedCritique(focus: Partial<SpecVerificationResult>): string {
    const base: SpecVerificationResult = {
      ok: false,
      verifiable: result.verifiable,
      mismatches: [],
      ...(result.skipReason !== undefined ? { skipReason: result.skipReason } : {}),
      ...(result.expected !== undefined ? { expected: result.expected } : {}),
      ...(result.measured !== undefined ? { measured: result.measured } : {}),
      ...focus,
    };
    return formatSpecCritique(base);
  }

  // 1. BBox — never skipped when verifiable; when !verifiable, mark skipped.
  if (!result.verifiable) {
    layers.push({
      key: 'bbox',
      label: tt.layerBbox,
      status: 'skipped',
      summary: tt.summaryBboxSkip,
      detail: result.skipReason ?? '',
    });
  } else {
    const m = result.measured;
    const bboxOk = result.mismatches.length === 0;
    layers.push({
      key: 'bbox',
      label: tt.layerBbox,
      status: bboxOk ? 'ok' : 'mismatch',
      summary: m ? tt.summaryBbox(m.wMm, m.hMm, m.dMm) : '—',
      detail: focusedCritique({ mismatches: result.mismatches, ok: bboxOk }),
    });
  }

  // 2. Hole count.
  if (result.holeCount === undefined) {
    layers.push({
      key: 'holeCount',
      label: tt.layerHoleCount,
      status: 'skipped',
      summary: tt.notRunYet,
      detail: '',
    });
  } else {
    const hc = result.holeCount;
    const ok = hc.mismatch === null && hc.detected !== null;
    layers.push({
      key: 'holeCount',
      label: tt.layerHoleCount,
      status: ok ? 'ok' : hc.mismatch ? 'mismatch' : 'skipped',
      summary: tt.summaryHoleCount(hc.expected, hc.detected),
      detail: focusedCritique({ holeCount: hc, ok }),
    });
  }

  // 3. Volume.
  if (result.volume === undefined) {
    layers.push({
      key: 'volume',
      label: tt.layerVolume,
      status: 'skipped',
      summary: tt.notRunYet,
      detail: '',
    });
  } else {
    const v = result.volume;
    const ok = v.mismatch === null;
    layers.push({
      key: 'volume',
      label: tt.layerVolume,
      status: ok ? 'ok' : 'mismatch',
      summary: tt.summaryVolume(v.expectedMm3, v.actualMm3),
      detail: focusedCritique({ volume: v, ok }),
    });
  }

  // 4. Surface area.
  if (result.surfaceArea === undefined) {
    layers.push({
      key: 'surfaceArea',
      label: tt.layerSurfaceArea,
      status: 'skipped',
      summary: tt.notRunYet,
      detail: '',
    });
  } else {
    const s = result.surfaceArea;
    const ok = s.mismatch === null;
    layers.push({
      key: 'surfaceArea',
      label: tt.layerSurfaceArea,
      status: ok ? 'ok' : 'mismatch',
      summary: tt.summarySurfaceArea(s.expectedMm2, s.actualMm2),
      detail: focusedCritique({ surfaceArea: s, ok }),
    });
  }

  // 5. Hole positions.
  if (result.holePositions === undefined) {
    layers.push({
      key: 'holePositions',
      label: tt.layerHolePositions,
      status: 'skipped',
      summary: tt.notRunYet,
      detail: '',
    });
  } else {
    const hp = result.holePositions;
    const ok = hp.allMatched;
    layers.push({
      key: 'holePositions',
      label: tt.layerHolePositions,
      status: ok ? 'ok' : 'mismatch',
      summary: tt.summaryHolePositions(hp.matches.length, ok),
      detail: focusedCritique({ holePositions: hp, ok }),
    });
  }

  // 6. Fillet.
  if (result.fillet === undefined) {
    layers.push({
      key: 'fillet',
      label: tt.layerFillet,
      status: 'skipped',
      summary: tt.notRunYet,
      detail: '',
    });
  } else {
    const f = result.fillet;
    const ok = f.applied;
    layers.push({
      key: 'fillet',
      label: tt.layerFillet,
      status: ok ? 'ok' : 'mismatch',
      summary: tt.summaryFillet(f.sharpEdgeCount, f.maxDihedralDeg),
      detail: focusedCritique({ fillet: f, ok }),
    });
  }

  // 7. Threads.
  if (result.threads === undefined) {
    layers.push({
      key: 'threads',
      label: tt.layerThreads,
      status: 'skipped',
      summary: tt.notRunYet,
      detail: '',
    });
  } else {
    const t = result.threads;
    const ok = t.allOk;
    layers.push({
      key: 'threads',
      label: tt.layerThreads,
      status: ok ? 'ok' : 'mismatch',
      summary: tt.summaryThreads(t.perThread.length, ok),
      detail: focusedCritique({ threads: t, ok }),
    });
  }

  // 8. Intent self-consistency. The shape of the result is: presence in
  // `intentIssues` implies ok=false (only attached on failure per
  // verifyAgainstSpec). When undefined, it ran and was consistent.
  if (result.intentIssues === undefined) {
    layers.push({
      key: 'intent',
      label: tt.layerIntent,
      status: 'ok',
      summary: tt.summaryIntent(true),
      detail: focusedCritique({ ok: true }),
    });
  } else {
    layers.push({
      key: 'intent',
      label: tt.layerIntent,
      status: 'mismatch',
      summary: tt.summaryIntent(false),
      detail: focusedCritique({ intentIssues: result.intentIssues, ok: false }),
    });
  }

  return layers;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function VerifySpecPanel({ lang, result }: VerifySpecPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const tt = dict[langMap[seg] ?? (langMap[lang] ?? 'en')];

  const [expanded, setExpanded] = useState<Set<LayerKey>>(new Set());

  const toggle = useCallback((key: LayerKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const layers = useMemo<LayerRow[]>(
    () => (result ? buildLayers(result, tt) : []),
    [result, tt],
  );
  const issueCount = useMemo(
    () => layers.filter((l) => l.status === 'mismatch').length,
    [layers],
  );

  /* ─── Styles ─ */
  const panelStyle: React.CSSProperties = {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    color: C.text,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    boxShadow: '0 8px 32px rgba(0,0,0,.6)',
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    borderBottom: `1px solid ${C.border}`,
    fontWeight: 600,
    fontSize: 15,
  };

  const bannerStyle = (ok: boolean): React.CSSProperties => ({
    padding: '10px 16px',
    borderBottom: `1px solid ${C.border}`,
    fontSize: 13,
    fontWeight: 700,
    color: ok ? C.green : C.red,
    background: ok ? 'rgba(46,160,67,0.08)' : 'rgba(248,81,73,0.08)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  });

  const rowStyle: React.CSSProperties = {
    padding: '10px 16px',
    borderBottom: `1px solid ${C.border}`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    background: C.bg,
  };

  const iconStyle = (status: LayerStatus): React.CSSProperties => ({
    fontWeight: 700,
    fontSize: 14,
    width: 16,
    textAlign: 'center',
    color: status === 'ok' ? C.green : status === 'mismatch' ? C.red : C.textDim,
    flexShrink: 0,
  });

  const labelStyle: React.CSSProperties = {
    fontWeight: 600,
    fontSize: 12,
    color: C.text,
    minWidth: 0,
    flex: '0 0 160px',
  };

  const summaryStyle: React.CSSProperties = {
    fontSize: 12,
    color: C.textDim,
    flex: 1,
    minWidth: 0,
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const expandHintStyle: React.CSSProperties = {
    fontSize: 10,
    color: C.textDim,
    flexShrink: 0,
    marginLeft: 8,
  };

  const detailStyle: React.CSSProperties = {
    padding: '8px 16px 12px 42px',
    borderBottom: `1px solid ${C.border}`,
    fontSize: 11,
    fontFamily: 'monospace',
    color: C.textDim,
    background: C.card,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  };

  /* ─── Empty state ─ */
  if (result === null) {
    return (
      <div style={panelStyle} data-testid="verify-spec-panel">
        <div style={headerStyle}>{tt.title}</div>
        <div
          data-testid="verify-spec-empty"
          style={{
            padding: 32,
            textAlign: 'center',
            color: C.textDim,
            fontSize: 13,
          }}
        >
          {tt.empty}
        </div>
      </div>
    );
  }

  const overallOk = result.ok;

  return (
    <div style={panelStyle} data-testid="verify-spec-panel">
      <div style={headerStyle}>{tt.title}</div>

      {/* Overall banner */}
      <div
        data-testid={overallOk ? 'verify-banner-ok' : 'verify-banner-fail'}
        style={bannerStyle(overallOk)}
        role="status"
      >
        <span aria-hidden="true">{overallOk ? '✓' : '✗'}</span>
        <span>
          {overallOk ? tt.specOk : `${issueCount} ${tt.issues}`}
        </span>
      </div>

      {/* Layer rows */}
      {layers.map((layer) => {
        const isOpen = expanded.has(layer.key);
        const icon = layer.status === 'ok' ? '✓' : layer.status === 'mismatch' ? '✗' : '—';
        return (
          <React.Fragment key={layer.key}>
            <div
              role="button"
              tabIndex={0}
              data-testid={`verify-row-${layer.key}`}
              data-status={layer.status}
              style={rowStyle}
              onClick={() => toggle(layer.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(layer.key);
                }
              }}
            >
              <span
                aria-hidden="true"
                data-testid={`verify-icon-${layer.key}`}
                style={iconStyle(layer.status)}
              >
                {icon}
              </span>
              <span style={labelStyle}>{layer.label}</span>
              <span style={summaryStyle}>{layer.summary}</span>
              <span style={expandHintStyle}>
                {isOpen ? tt.collapse : tt.expand}
              </span>
            </div>
            {isOpen && (
              <div
                data-testid={`verify-detail-${layer.key}`}
                style={detailStyle}
              >
                {layer.detail || tt.notRunYet}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
