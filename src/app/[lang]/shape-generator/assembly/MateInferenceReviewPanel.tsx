'use client';

/**
 * MateInferenceReviewPanel — Phase 5.2.3 advanced review surface for the
 * STEP-import mate inference pipeline.
 *
 * RELATIONSHIP TO `SuggestedMatesPanel`
 * -------------------------------------
 * `SuggestedMatesPanel` is the lightweight list-view consumed by the modal
 * integration. This panel is its sibling — a standalone, table-shaped
 * review surface for users who want to triage a long inference batch
 * (50–500 suggestions) with extra metadata:
 *   - per-row CONFIDENCE bar (sourced from the algorithm's score)
 *   - per-row REASON text (why the heuristic flagged this pair)
 *   - threshold slider + "Accept all above threshold" bulk action
 *   - column sorting (confidence / kind / part-A name)
 *   - kind filtering (coincident / concentric / parallel checkboxes)
 *
 * Design choice — table over list:
 *   - SuggestedMatesPanel's list keeps the visual surface compact for the
 *     modal (3–5 visible rows). This panel assumes the user opened a
 *     dedicated review page and has the screen real estate for a 6-column
 *     table. The two views are complementary; neither replaces the other.
 *
 * Standalone-by-design (same contract as SuggestedMatesPanel):
 *   - No dependency on AssemblyBrowserModal, mateSolver, or any state
 *     store. Pure presentation + accept/reject/threshold-bulk callbacks.
 *   - DOES NOT modify `mate.ts`, `stepAssemblyMateInference.ts`, or
 *     `SuggestedMatesPanel.tsx`.
 *   - Wrapper integration (page route, run-inference button, name
 *     resolution) is intentionally deferred to the next batch.
 *
 * Confidence semantics:
 *   - Each suggestion may carry a confidence score in [0, 1] via the
 *     optional `confidence` prop (keyed by mate id). When the lookup is
 *     missing for a given id we treat that suggestion as confidence = 1
 *     ("fully trusted") so callers that haven't wired confidences yet
 *     don't see every row hidden behind the default threshold. The bar is
 *     suppressed entirely when the score is missing — the cell shows an
 *     em-dash so reviewers know "no score provided" vs "score is zero".
 *
 * Threshold policy:
 *   - Slider range: 0.0 → 1.0 in 0.05 steps. Default = 0.5. Threshold is
 *     UI-local state (not a prop) — parents that want to persist it can
 *     wire `onAcceptAllAboveThreshold` and stash the last value
 *     themselves.
 *   - "Accept all above threshold" fires `onAcceptAllAboveThreshold(t)`
 *     when provided; otherwise the panel falls back to dispatching one
 *     `onAccept` per qualifying mate id.
 *   - Rows below the threshold remain VISIBLE (with a dimmed style) so
 *     the user can still review / reject them individually. This is a
 *     review tool, not a hard filter — that's the kind-checkbox row's
 *     job.
 *
 * Sort policy:
 *   - Default: confidence DESC (most-confident at the top, easiest to
 *     accept). Ties broken by mate id for deterministic ordering.
 *   - Alternative sorts: kind (alphabetical), partA name (alphabetical).
 *   - Sorting is stable across re-renders within the same suggestion
 *     batch.
 *
 * Test surface (data-testids):
 *   mate-inference-review-panel
 *   mate-inference-review-empty
 *   mate-inference-review-table
 *   mate-inference-review-row-${id}
 *   mate-inference-review-row-${id}-accept
 *   mate-inference-review-row-${id}-reject
 *   mate-inference-review-row-${id}-confidence
 *   mate-inference-review-row-${id}-reason
 *   mate-inference-review-threshold-slider
 *   mate-inference-review-threshold-value
 *   mate-inference-review-accept-above-threshold
 *   mate-inference-review-sort-select
 *   mate-inference-review-kind-filter-${kind}
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { Mate, MateKind } from '@/lib/assembly/mate';
import { MATE_KIND_ICONS } from './SuggestedMatesPanel';

// ─── i18n ─────────────────────────────────────────────────────────────────

export type ReviewPanelLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface ReviewDict {
  header: string;
  empty: string;
  colKind: string;
  colParts: string;
  colRefs: string;
  colConfidence: string;
  colReason: string;
  colActions: string;
  accept: string;
  reject: string;
  thresholdLabel: string;
  acceptAboveThreshold: string;
  sortLabel: string;
  sortConfidence: string;
  sortKind: string;
  sortPart: string;
  filterLabel: string;
  noScore: string;
  noReason: string;
  kindNames: Record<MateKind, string>;
}

/**
 * Localized labels. Mate-kind names mirror the engineering-standard
 * vocabulary established in SuggestedMatesPanel so the two surfaces speak
 * the same dialect.
 */
const dict: Record<ReviewPanelLang, ReviewDict> = {
  ko: {
    header: '메이트 추론 검토',
    empty: '검토할 추천 메이트가 없습니다',
    colKind: '종류',
    colParts: '부품',
    colRefs: '참조',
    colConfidence: '신뢰도',
    colReason: '근거',
    colActions: '작업',
    accept: '적용',
    reject: '거부',
    thresholdLabel: '신뢰도 임계값',
    acceptAboveThreshold: '임계값 이상 모두 적용',
    sortLabel: '정렬',
    sortConfidence: '신뢰도순',
    sortKind: '종류순',
    sortPart: '부품 A순',
    filterLabel: '종류 필터',
    noScore: '점수 없음',
    noReason: '근거 없음',
    kindNames: {
      coincident: '일치',
      concentric: '동심',
      parallel: '평행',
      perpendicular: '수직',
      distance: '거리',
      angle: '각도',
      tangent: '접선',
      hinge: '힌지',
      slot: '슬롯',
      gear: '기어',
      rack_pinion: '랙피니언',
    },
  },
  en: {
    header: 'Mate Inference Review',
    empty: 'No mate suggestions to review',
    colKind: 'Kind',
    colParts: 'Parts',
    colRefs: 'Refs',
    colConfidence: 'Confidence',
    colReason: 'Reason',
    colActions: 'Actions',
    accept: 'Accept',
    reject: 'Reject',
    thresholdLabel: 'Confidence threshold',
    acceptAboveThreshold: 'Accept all above threshold',
    sortLabel: 'Sort',
    sortConfidence: 'Confidence',
    sortKind: 'Kind',
    sortPart: 'Part A',
    filterLabel: 'Filter by kind',
    noScore: 'No score',
    noReason: 'No reason provided',
    kindNames: {
      coincident: 'Coincident',
      concentric: 'Concentric',
      parallel: 'Parallel',
      perpendicular: 'Perpendicular',
      distance: 'Distance',
      angle: 'Angle',
      tangent: 'Tangent',
      hinge: 'Hinge',
      slot: 'Slot',
      gear: 'Gear',
      rack_pinion: 'Rack & Pinion',
    },
  },
  ja: {
    header: '合致推論レビュー',
    empty: 'レビュー対象の推奨合致はありません',
    colKind: '種類',
    colParts: '部品',
    colRefs: '参照',
    colConfidence: '信頼度',
    colReason: '根拠',
    colActions: '操作',
    accept: '適用',
    reject: '拒否',
    thresholdLabel: '信頼度しきい値',
    acceptAboveThreshold: 'しきい値以上をすべて適用',
    sortLabel: '並び替え',
    sortConfidence: '信頼度',
    sortKind: '種類',
    sortPart: '部品 A',
    filterLabel: '種類で絞り込み',
    noScore: 'スコアなし',
    noReason: '根拠なし',
    kindNames: {
      coincident: '一致',
      concentric: '同心',
      parallel: '平行',
      perpendicular: '直角',
      distance: '距離',
      angle: '角度',
      tangent: '接線',
      hinge: 'ヒンジ',
      slot: 'スロット',
      gear: 'ギア',
      rack_pinion: 'ラック&ピニオン',
    },
  },
  zh: {
    header: '配合推断审阅',
    empty: '没有可审阅的配合建议',
    colKind: '类型',
    colParts: '零件',
    colRefs: '参考',
    colConfidence: '置信度',
    colReason: '理由',
    colActions: '操作',
    accept: '接受',
    reject: '拒绝',
    thresholdLabel: '置信度阈值',
    acceptAboveThreshold: '接受所有高于阈值的项',
    sortLabel: '排序',
    sortConfidence: '置信度',
    sortKind: '类型',
    sortPart: '零件 A',
    filterLabel: '按类型筛选',
    noScore: '无分数',
    noReason: '无理由',
    kindNames: {
      coincident: '重合',
      concentric: '同心',
      parallel: '平行',
      perpendicular: '垂直',
      distance: '距离',
      angle: '角度',
      tangent: '相切',
      hinge: '铰链',
      slot: '滑槽',
      gear: '齿轮',
      rack_pinion: '齿轮齿条',
    },
  },
  es: {
    header: 'Revisión de inferencia de restricciones',
    empty: 'No hay sugerencias para revisar',
    colKind: 'Tipo',
    colParts: 'Piezas',
    colRefs: 'Referencias',
    colConfidence: 'Confianza',
    colReason: 'Razón',
    colActions: 'Acciones',
    accept: 'Aceptar',
    reject: 'Rechazar',
    thresholdLabel: 'Umbral de confianza',
    acceptAboveThreshold: 'Aceptar todo por encima del umbral',
    sortLabel: 'Ordenar',
    sortConfidence: 'Confianza',
    sortKind: 'Tipo',
    sortPart: 'Pieza A',
    filterLabel: 'Filtrar por tipo',
    noScore: 'Sin puntaje',
    noReason: 'Sin razón',
    kindNames: {
      coincident: 'Coincidente',
      concentric: 'Concéntrico',
      parallel: 'Paralelo',
      perpendicular: 'Perpendicular',
      distance: 'Distancia',
      angle: 'Ángulo',
      tangent: 'Tangente',
      hinge: 'Bisagra',
      slot: 'Ranura',
      gear: 'Engranaje',
      rack_pinion: 'Cremallera y piñón',
    },
  },
  ar: {
    header: 'مراجعة استنتاج القيود',
    empty: 'لا توجد قيود مقترحة للمراجعة',
    colKind: 'النوع',
    colParts: 'الأجزاء',
    colRefs: 'المراجع',
    colConfidence: 'الثقة',
    colReason: 'السبب',
    colActions: 'الإجراءات',
    accept: 'قبول',
    reject: 'رفض',
    thresholdLabel: 'عتبة الثقة',
    acceptAboveThreshold: 'قبول الكل فوق العتبة',
    sortLabel: 'فرز',
    sortConfidence: 'الثقة',
    sortKind: 'النوع',
    sortPart: 'الجزء أ',
    filterLabel: 'تصفية حسب النوع',
    noScore: 'لا توجد درجة',
    noReason: 'لا يوجد سبب',
    kindNames: {
      coincident: 'تطابق',
      concentric: 'متمركز',
      parallel: 'متوازي',
      perpendicular: 'متعامد',
      distance: 'المسافة',
      angle: 'الزاوية',
      tangent: 'مماس',
      hinge: 'مفصلة',
      slot: 'مزلاج',
      gear: 'ترس',
      rack_pinion: 'ترس ومسنن',
    },
  },
};

// ─── Props ────────────────────────────────────────────────────────────────

export type SortMode = 'confidence' | 'kind' | 'partA';

export interface MateInferenceReviewPanelProps {
  /** Active editor language. */
  lang: ReviewPanelLang;
  /** Inferred mates from `inferMatesFromPlacements`. */
  suggestions: ReadonlyArray<Mate>;
  /**
   * Confidence score per suggestion id, in [0, 1]. Missing entries are
   * treated as 1 ("fully trusted") so panels wired before scores exist
   * don't hide every row. The bar cell renders an em-dash to signal
   * "no score" vs "score is zero".
   */
  confidence?: Record<string, number>;
  /**
   * Optional per-mate explanation surfaced from the inference algorithm
   * (e.g., "normals antiparallel, gap 0.04mm"). Missing entries show a
   * subdued "No reason provided" placeholder.
   */
  reasons?: Record<string, string>;
  /** Fires when the user accepts a single suggestion. */
  onAccept: (mateId: string) => void;
  /** Fires when the user rejects a single suggestion. */
  onReject: (mateId: string) => void;
  /**
   * Optional bulk accept callback. Receives the threshold the user
   * selected. When omitted, the panel falls back to dispatching one
   * `onAccept(id)` per qualifying mate id.
   */
  onAcceptAllAboveThreshold?: (threshold: number) => void;
  /**
   * Optional lookup for friendly part names. Receives the raw `partId`
   * stored on each MateRef and returns the display name. When the function
   * is absent OR returns an empty / nullish string the panel falls back to
   * the raw partId — keeps the panel useful even before the wrapper has
   * resolved names.
   */
  partNameById?: (partId: string) => string | undefined | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────

/** Default confidence threshold — see policy note in the file header. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/** Slider granularity. 0.05 keeps the slider snappy without burying the
 *  user in 100 indistinguishable stops. */
export const CONFIDENCE_SLIDER_STEP = 0.05;

/** Sentinel confidence used when the caller omits a score. */
const CONFIDENCE_UNSET = -1;

/**
 * Resolve a confidence score for a mate id. Returns the sentinel
 * `CONFIDENCE_UNSET` when no score is provided so the consumer can render
 * "—" instead of a misleading "0%" bar.
 */
function resolveConfidence(
  id: string,
  confidence: Record<string, number> | undefined,
): number {
  if (!confidence) return CONFIDENCE_UNSET;
  const raw = confidence[id];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return CONFIDENCE_UNSET;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Effective confidence used for threshold comparisons. Missing scores are
 * treated as 1 (fully trusted) so a caller that has not wired confidence
 * yet doesn't see every row vanish behind a 0.5 threshold.
 */
function effectiveConfidence(score: number): number {
  return score === CONFIDENCE_UNSET ? 1 : score;
}

function nameOf(
  partId: string,
  partNameById: MateInferenceReviewPanelProps['partNameById'],
): string {
  if (!partNameById) return partId;
  const resolved = partNameById(partId);
  return resolved && resolved.length > 0 ? resolved : partId;
}

function formatRefs(mate: Mate): string {
  return `${mate.a.refId} → ${mate.b.refId}`;
}

function formatParts(
  mate: Mate,
  partNameById: MateInferenceReviewPanelProps['partNameById'],
): string {
  return `${nameOf(mate.a.partId, partNameById)} / ${nameOf(mate.b.partId, partNameById)}`;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function MateInferenceReviewPanel(
  props: MateInferenceReviewPanelProps,
): React.ReactElement {
  const {
    lang,
    suggestions,
    confidence,
    reasons,
    onAccept,
    onReject,
    onAcceptAllAboveThreshold,
    partNameById,
  } = props;

  const t = dict[lang] ?? dict.en;

  // ── threshold ────────────────────────────────────────────────────────
  const [threshold, setThreshold] = useState<number>(
    DEFAULT_CONFIDENCE_THRESHOLD,
  );

  // ── sort ─────────────────────────────────────────────────────────────
  const [sortMode, setSortMode] = useState<SortMode>('confidence');

  // ── kind filter ──────────────────────────────────────────────────────
  // Kinds available in the current batch. We surface checkboxes only for
  // kinds actually present so a batch of 100 concentrics doesn't render
  // 11 stale toggles.
  const presentKinds = useMemo<MateKind[]>(() => {
    const set = new Set<MateKind>();
    for (const m of suggestions) set.add(m.kind);
    // Stable order = alphabetical so the checkbox row doesn't reshuffle
    // between batches.
    return [...set].sort();
  }, [suggestions]);

  const [excludedKinds, setExcludedKinds] = useState<ReadonlySet<MateKind>>(
    new Set(),
  );

  const toggleKind = useCallback((kind: MateKind): void => {
    setExcludedKinds((cur) => {
      const next = new Set(cur);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  // ── filtered + sorted view ───────────────────────────────────────────
  const visible = useMemo<ReadonlyArray<Mate>>(() => {
    const filtered = suggestions.filter((m) => !excludedKinds.has(m.kind));
    const copy = [...filtered];
    switch (sortMode) {
      case 'confidence': {
        // DESC by effective confidence, tiebreak by id for stability.
        copy.sort((a, b) => {
          const ca = effectiveConfidence(resolveConfidence(a.id, confidence));
          const cb = effectiveConfidence(resolveConfidence(b.id, confidence));
          if (cb !== ca) return cb - ca;
          return a.id.localeCompare(b.id);
        });
        break;
      }
      case 'kind': {
        copy.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
          return a.id.localeCompare(b.id);
        });
        break;
      }
      case 'partA': {
        copy.sort((a, b) => {
          const na = nameOf(a.a.partId, partNameById);
          const nb = nameOf(b.a.partId, partNameById);
          if (na !== nb) return na.localeCompare(nb);
          return a.id.localeCompare(b.id);
        });
        break;
      }
    }
    return copy;
  }, [suggestions, excludedKinds, sortMode, confidence, partNameById]);

  // ── bulk accept above threshold ──────────────────────────────────────
  const handleAcceptAboveThreshold = useCallback((): void => {
    if (onAcceptAllAboveThreshold) {
      onAcceptAllAboveThreshold(threshold);
      return;
    }
    // Fall back to per-mate dispatch over the FULL suggestion set (not
    // just `visible`) — the threshold action ignores the kind filter on
    // purpose so reviewers don't accidentally accept hidden rows.
    // Snapshot the ids first so a parent that mutates `suggestions` mid-
    // loop doesn't skip entries.
    const ids: string[] = [];
    for (const m of suggestions) {
      const c = effectiveConfidence(resolveConfidence(m.id, confidence));
      if (c >= threshold) ids.push(m.id);
    }
    for (const id of ids) onAccept(id);
  }, [
    onAcceptAllAboveThreshold,
    onAccept,
    suggestions,
    confidence,
    threshold,
  ]);

  const isEmpty = suggestions.length === 0;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <div
      data-testid="mate-inference-review-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        background: 'var(--nx-card-bg, #1a1a1a)',
        border: '1px solid var(--nx-border, #333)',
        borderRadius: 8,
        color: 'var(--nx-text, #eee)',
        fontSize: 12,
      }}
      dir={dir}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          {t.header} ({suggestions.length})
        </div>
      </div>

      {isEmpty ? (
        <div
          data-testid="mate-inference-review-empty"
          style={{
            padding: 16,
            textAlign: 'center',
            color: 'var(--nx-text-muted, #888)',
            fontSize: 11,
            border: '1px dashed var(--nx-border, #333)',
            borderRadius: 6,
          }}
        >
          {t.empty}
        </div>
      ) : (
        <>
          {/* Controls row: threshold slider + sort + accept-above-threshold */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 12,
              padding: '8px 10px',
              background: 'var(--nx-bg, #111)',
              border: '1px solid var(--nx-border, #333)',
              borderRadius: 6,
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
              }}
            >
              <span>{t.thresholdLabel}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={CONFIDENCE_SLIDER_STEP}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                data-testid="mate-inference-review-threshold-slider"
                aria-label={t.thresholdLabel}
                style={{ width: 140 }}
              />
              <span
                data-testid="mate-inference-review-threshold-value"
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 36,
                  textAlign: 'right',
                }}
              >
                {threshold.toFixed(2)}
              </span>
            </label>

            <button
              type="button"
              data-testid="mate-inference-review-accept-above-threshold"
              onClick={handleAcceptAboveThreshold}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 4,
                border: '1px solid #16a34a55',
                background: '#16a34a22',
                color: '#22c55e',
                cursor: 'pointer',
              }}
            >
              {t.acceptAboveThreshold}
            </button>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
              }}
            >
              <span>{t.sortLabel}</span>
              <select
                data-testid="mate-inference-review-sort-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                aria-label={t.sortLabel}
                style={{
                  background: 'var(--nx-card-bg, #1a1a1a)',
                  color: 'var(--nx-text, #eee)',
                  border: '1px solid var(--nx-border, #333)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 11,
                }}
              >
                <option value="confidence">{t.sortConfidence}</option>
                <option value="kind">{t.sortKind}</option>
                <option value="partA">{t.sortPart}</option>
              </select>
            </label>

            {presentKinds.length > 1 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                }}
              >
                <span>{t.filterLabel}</span>
                {presentKinds.map((kind) => (
                  <label
                    key={kind}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid={`mate-inference-review-kind-filter-${kind}`}
                      checked={!excludedKinds.has(kind)}
                      onChange={() => toggleKind(kind)}
                      aria-label={t.kindNames[kind] ?? kind}
                    />
                    <span>{t.kindNames[kind] ?? kind}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table
              data-testid="mate-inference-review-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 11,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--nx-bg, #111)',
                    textAlign: dir === 'rtl' ? 'right' : 'left',
                  }}
                >
                  <th style={cellHeadStyle}>{t.colKind}</th>
                  <th style={cellHeadStyle}>{t.colParts}</th>
                  <th style={cellHeadStyle}>{t.colRefs}</th>
                  <th style={cellHeadStyle}>{t.colConfidence}</th>
                  <th style={cellHeadStyle}>{t.colReason}</th>
                  <th style={cellHeadStyle}>{t.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((mate) => {
                  const score = resolveConfidence(mate.id, confidence);
                  const eff = effectiveConfidence(score);
                  const belowThreshold = eff < threshold;
                  const icon = MATE_KIND_ICONS[mate.kind];
                  const kindLabel = t.kindNames[mate.kind] ?? mate.kind;
                  const reason = reasons?.[mate.id];
                  return (
                    <tr
                      key={mate.id}
                      data-testid={`mate-inference-review-row-${mate.id}`}
                      data-below-threshold={belowThreshold ? 'true' : 'false'}
                      style={{
                        borderTop: '1px solid var(--nx-border, #333)',
                        opacity: belowThreshold ? 0.55 : 1,
                      }}
                    >
                      <td style={cellStyle}>
                        <span aria-hidden="true" style={{ marginInlineEnd: 4 }}>
                          {icon}
                        </span>
                        {kindLabel}
                      </td>
                      <td style={cellStyle}>
                        {formatParts(mate, partNameById)}
                      </td>
                      <td style={cellStyle}>
                        {formatRefs(mate)}
                      </td>
                      <td style={cellStyle}>
                        {score === CONFIDENCE_UNSET ? (
                          <span
                            data-testid={`mate-inference-review-row-${mate.id}-confidence`}
                            title={t.noScore}
                            style={{ color: 'var(--nx-text-muted, #888)' }}
                          >
                            —
                          </span>
                        ) : (
                          <ConfidenceBar
                            score={score}
                            testId={`mate-inference-review-row-${mate.id}-confidence`}
                          />
                        )}
                      </td>
                      <td style={cellStyle}>
                        <span
                          data-testid={`mate-inference-review-row-${mate.id}-reason`}
                          style={
                            reason
                              ? undefined
                              : {
                                  color: 'var(--nx-text-muted, #888)',
                                  fontStyle: 'italic',
                                }
                          }
                        >
                          {reason ?? t.noReason}
                        </span>
                      </td>
                      <td style={cellStyle}>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button
                            type="button"
                            data-testid={`mate-inference-review-row-${mate.id}-accept`}
                            onClick={() => onAccept(mate.id)}
                            aria-label={t.accept}
                            title={t.accept}
                            style={{
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 700,
                              borderRadius: 4,
                              border: '1px solid #16a34a55',
                              background: '#16a34a22',
                              color: '#22c55e',
                              cursor: 'pointer',
                            }}
                          >
                            {'✓'}
                          </button>
                          <button
                            type="button"
                            data-testid={`mate-inference-review-row-${mate.id}-reject`}
                            onClick={() => onReject(mate.id)}
                            aria-label={t.reject}
                            title={t.reject}
                            style={{
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 700,
                              borderRadius: 4,
                              border: '1px solid #dc262655',
                              background: '#dc262622',
                              color: '#ef4444',
                              cursor: 'pointer',
                            }}
                          >
                            {'✕'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Internal: confidence bar ─────────────────────────────────────────────

interface ConfidenceBarProps {
  /** Score in [0, 1]. Caller guarantees it's not the UNSET sentinel. */
  score: number;
  testId: string;
}

function ConfidenceBar({
  score,
  testId,
}: ConfidenceBarProps): React.ReactElement {
  const pct = Math.round(score * 100);
  // Colour grades: red < 0.33, amber < 0.66, green ≥ 0.66. Matches the
  // "traffic light" convention used elsewhere in the app (e.g.,
  // CgEnvelopeChecker confidence bar).
  const colour = score >= 0.66 ? '#22c55e' : score >= 0.33 ? '#f59e0b' : '#ef4444';
  return (
    <div
      data-testid={testId}
      data-confidence={score.toFixed(2)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 88,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 6,
          background: '#2a2a2a',
          borderRadius: 3,
          overflow: 'hidden',
          minWidth: 50,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: colour,
          }}
        />
      </div>
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          fontSize: 10,
          color: 'var(--nx-text-muted, #aaa)',
          minWidth: 26,
          textAlign: 'right',
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

// ─── Internal: table cell styles ──────────────────────────────────────────

const cellHeadStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontWeight: 600,
  fontSize: 11,
  color: 'var(--nx-text-muted, #aaa)',
  borderBottom: '1px solid var(--nx-border, #333)',
};

const cellStyle: React.CSSProperties = {
  padding: '6px 8px',
  verticalAlign: 'middle',
};
