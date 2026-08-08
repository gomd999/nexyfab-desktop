'use client';

/**
 * RefRelinkPanel — R5: lost-reference list + one-click relink UI.
 *
 * Renders the output of `refRelink.collectLostRefs` + `suggestRelinkCandidates`
 * as a floating panel: one card per lost reference (consumer, ref, WHY it was
 * lost), each with its ranked relink candidates and the gate numbers the
 * engine measured (score · margin · distance). Clicking a candidate emits
 * `onApply` — the HOST performs the actual `applyRelink` + rebuild; nothing is
 * mutated here and nothing is ever auto-applied.
 *
 * Honesty in the UI (ADR-017 D1):
 *   - A candidate the calibrated gate would accept is badged ★; when NO
 *     candidate clears the gate the card says so explicitly ("확신 후보 없음")
 *     instead of silently promoting the nearest one.
 *   - Named-channel candidates are labelled as distance-only ranking (근사).
 *   - A loss with no rankable candidates shows a re-select call-to-action.
 *
 * Self-contained + props-injected (page mounting is the orchestrator's job);
 * pure presentation over tested engine data → jsdom-testable.
 */

import * as React from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import type {
  LostRef,
  RelinkRecord,
  RelinkSuggestion,
  RelinkTarget,
  LostRefReason,
} from '../features/refRelink';

export interface RefRelinkItem {
  lostRef: LostRef;
  suggestion: RelinkSuggestion;
}

export interface RefRelinkPanelProps {
  lang?: string;
  items: RefRelinkItem[];
  /** Apply one candidate (host runs applyRelink + rebuild). */
  onApply: (lostRef: LostRef, target: RelinkTarget) => void;
  /** Optional: jump to viewport re-selection for this lost ref. */
  onReselect?: (lostRef: LostRef) => void;
  /** Optional hover feedback: host highlights the candidate anchor in 3D. */
  onHighlight?: (anchor: [number, number, number] | null) => void;
  onClose?: () => void;
  /** Already-applied relinks (audit trail), newest last. */
  history?: readonly RelinkRecord[];
}

interface Dict {
  title: string;
  noConfident: string;
  gateOk: string;
  reselect: string;
  apply: string;
  history: string;
  distanceOnly: string;
  noCandidates: string;
  noPriorAnchor: string;
  score: string;
  margin: string;
  dist: string;
  reason: (r: LostRefReason) => string;
}

const REASON_EN: Record<LostRefReason, string> = {
  name_gone: 'the edge’s generative-history name no longer exists after the rebuild',
  ambiguous: 'several current edges match equally well',
  low_confidence: 'no current edge resembles it closely enough',
  no_parallel_candidate: 'no current edge runs in the same direction',
  no_candidates: 'the rebuilt solid reported no edges',
  unknown: 'the name no longer exists in this topology',
  'legacy-role': 'positional (pre-W1-B) name — cannot be reinterpreted safely',
  'legacy-seam': 'positional seam ordinal (pre-W3-A) — cannot be reinterpreted safely',
  'unresolved-ref': 'the reference does not resolve in the current topology',
};

const REASON_KO: Record<LostRefReason, string> = {
  name_gone: '리빌드 후 생성-이력 이름이 더 이상 존재하지 않음',
  ambiguous: '현재 형상의 여러 엣지가 동점으로 일치 — 판별 불가',
  low_confidence: '충분히 유사한 현재 엣지 없음',
  no_parallel_candidate: '같은 방향의 현재 엣지 없음',
  no_candidates: '리빌드 결과에 엣지가 없음',
  unknown: '현재 토폴로지에 존재하지 않는 이름',
  'legacy-role': '구식 위치기반(pre-W1-B) 이름 — 안전한 재해석 불가',
  'legacy-seam': '구식 심 순번(pre-W3-A) 이름 — 안전한 재해석 불가',
  'unresolved-ref': '현재 토폴로지에서 해석되지 않는 참조',
};

const REASON_JA: Record<LostRefReason, string> = {
  name_gone: 'リビルド後、生成履歴の名前が存在しなくなった',
  ambiguous: '現在の形状の複数エッジが同点で一致 — 判別不能',
  low_confidence: '十分に類似する現在のエッジがない',
  no_parallel_candidate: '同じ方向の現在のエッジがない',
  no_candidates: 'リビルド結果にエッジがない',
  unknown: '現在のトポロジーに存在しない名前',
  'legacy-role': '旧式の位置ベース (pre-W1-B) 名 — 安全な再解釈が不可',
  'legacy-seam': '旧式のシーム順序 (pre-W3-A) 名 — 安全な再解釈が不可',
  'unresolved-ref': '現在のトポロジーで解決できない参照',
};

const REASON_ZH: Record<LostRefReason, string> = {
  name_gone: '重建后该边的生成历史名称已不存在',
  ambiguous: '当前形状的多条边同分匹配 — 无法判别',
  low_confidence: '没有足够相似的当前边',
  no_parallel_candidate: '没有同方向的当前边',
  no_candidates: '重建结果中没有边',
  unknown: '当前拓扑中不存在的名称',
  'legacy-role': '旧式基于位置 (pre-W1-B) 的名称 — 无法安全重解析',
  'legacy-seam': '旧式接缝序号 (pre-W3-A) 名称 — 无法安全重解析',
  'unresolved-ref': '在当前拓扑中无法解析的引用',
};

const REASON_ES: Record<LostRefReason, string> = {
  name_gone: 'El nombre de historial generativo de la arista ya no existe tras la reconstrucción',
  ambiguous: 'Varias aristas actuales empatan en la coincidencia: no se puede discriminar',
  low_confidence: 'No hay ninguna arista actual suficientemente similar',
  no_parallel_candidate: 'No hay ninguna arista actual con la misma dirección',
  no_candidates: 'La reconstrucción no ha dejado aristas',
  unknown: 'Nombre inexistente en la topología actual',
  'legacy-role': 'Nombre antiguo basado en posición (pre-W1-B): no se puede reinterpretar con seguridad',
  'legacy-seam': 'Nombre antiguo por orden de costura (pre-W3-A): no se puede reinterpretar con seguridad',
  'unresolved-ref': 'Referencia no resoluble en la topología actual',
};

const REASON_AR: Record<LostRefReason, string> = {
  name_gone: 'لم يعد اسم سجل الإنشاء للحافة موجودًا بعد إعادة البناء',
  ambiguous: 'تتساوى عدة حواف في الشكل الحالي في التطابق — يتعذّر التمييز',
  low_confidence: 'لا توجد حافة حالية مشابهة بدرجة كافية',
  no_parallel_candidate: 'لا توجد حافة حالية بالاتجاه نفسه',
  no_candidates: 'لم تُنتج إعادة البناء أي حواف',
  unknown: 'اسم غير موجود في الطوبولوجيا الحالية',
  'legacy-role': 'اسم قديم قائم على الموضع (قبل W1-B) — يتعذّر إعادة تفسيره بأمان',
  'legacy-seam': 'اسم قديم بترتيب الخياطة (قبل W3-A) — يتعذّر إعادة تفسيره بأمان',
  'unresolved-ref': 'مرجع لا يمكن حلّه في الطوبولوجيا الحالية',
};

const DICT: Record<string, Dict> = {
  en: {
    title: 'Lost references',
    noConfident: 'No confident candidate — confirm manually or re-select',
    gateOk: 'gate-confident',
    reselect: 'Re-select in viewport',
    apply: 'Relink',
    history: 'Relink history',
    distanceOnly: 'ranked by distance only (approximate)',
    noCandidates: 'No candidates in the current topology',
    noPriorAnchor: 'No prior anchor — list is unranked',
    score: 'score',
    margin: 'margin',
    dist: 'dist',
    reason: (r) => REASON_EN[r],
  },
  ko: {
    title: '참조 상실',
    noConfident: '확신 후보 없음 — 직접 확인 후 적용하거나 재선택하세요',
    gateOk: '게이트 통과',
    reselect: '뷰포트에서 재선택',
    apply: '재지정',
    history: '재지정 이력',
    distanceOnly: '거리 기준 정렬 (근사)',
    noCandidates: '현재 토폴로지에 후보 없음',
    noPriorAnchor: '이전 앵커 정보 없음 — 목록은 순위 없음',
    score: '점수',
    margin: '마진',
    dist: '거리',
    reason: (r) => REASON_KO[r],
  },
  ja: {
    title: '参照の喪失',
    noConfident: '確信できる候補なし — 直接確認して適用するか再選択してください',
    gateOk: 'ゲート通過',
    reselect: 'ビューポートで再選択',
    apply: '再指定',
    history: '再指定履歴',
    distanceOnly: '距離基準の並べ替え (近似)',
    noCandidates: '現在のトポロジーに候補なし',
    noPriorAnchor: '以前のアンカー情報なし — 一覧は順位なし',
    score: 'スコア',
    margin: 'マージン',
    dist: '距離',
    reason: (r) => REASON_JA[r],
  },
  zh: {
    title: '参照丢失',
    noConfident: '没有可信候选 — 请人工确认后应用，或重新选择',
    gateOk: '通过校验',
    reselect: '在视口中重新选择',
    apply: '重新指定',
    history: '重新指定历史',
    distanceOnly: '按距离排序（近似）',
    noCandidates: '当前拓扑中没有候选',
    noPriorAnchor: '没有先前锚点信息 — 列表无排序',
    score: '分数',
    margin: '差值',
    dist: '距离',
    reason: (r) => REASON_ZH[r],
  },
  es: {
    title: 'Referencia perdida',
    noConfident: 'Ningún candidato fiable: verifíquelo y aplique, o vuelva a seleccionar',
    gateOk: 'Verificación superada',
    reselect: 'Volver a seleccionar en la vista',
    apply: 'Reasignar',
    history: 'Historial de reasignaciones',
    distanceOnly: 'Ordenado por distancia (aproximado)',
    noCandidates: 'No hay candidatos en la topología actual',
    noPriorAnchor: 'Sin anclaje previo: la lista no está ordenada',
    score: 'Puntuación',
    margin: 'Margen',
    dist: 'Distancia',
    reason: (r) => REASON_ES[r],
  },
  ar: {
    title: 'مرجع مفقود',
    noConfident: 'لا يوجد مرشّح موثوق — تحقّق يدوياً ثم طبّق، أو أعد الاختيار',
    gateOk: 'اجتاز التحقق',
    reselect: 'إعادة الاختيار من العرض',
    apply: 'إعادة التعيين',
    history: 'سجل إعادة التعيين',
    distanceOnly: 'ترتيب حسب المسافة (تقريبي)',
    noCandidates: 'لا توجد مرشّحات في الطوبولوجيا الحالية',
    noPriorAnchor: 'لا توجد معلومات مرساة سابقة — القائمة غير مرتّبة',
    score: 'الدرجة',
    margin: 'الفارق',
    dist: 'المسافة',
    reason: (r) => REASON_AR[r],
  },
};

function pickDict(lang?: string): Dict {
  // ⚠ 260802: `kr → ko` 만 정규화해 `cn` 이 zh 로 안 갔다. toIsoLang 로 통일한다.
  return DICT[toIsoLang(lang)] ?? DICT.en!;
}

const C = {
  bg: 'var(--nx-panel)', card: 'var(--nx-panel-2)', border: 'var(--nx-border)',
  text: 'var(--nx-text)', dim: 'var(--nx-text-2)', accent: 'var(--nx-accent)',
  warn: 'var(--nx-warn)', ok: 'var(--nx-ok)',
};

const fmt = (n: number): string => String(Number(n.toFixed(3)));
const fmtAnchor = (a: [number, number, number]): string => `(${fmt(a[0])}, ${fmt(a[1])}, ${fmt(a[2])})`;

function refLabel(ref: LostRef): string {
  if (ref.kind === 'named') return ref.name ?? '?';
  const p = ref.anchor?.position;
  return p ? `edge ${fmtAnchor(p)}` : 'edge (multi-selection)';
}

export default function RefRelinkPanel({
  lang, items, onApply, onReselect, onHighlight, onClose, history,
}: RefRelinkPanelProps): React.ReactElement | null {
  const t = pickDict(lang);
  if (items.length === 0) return null;

  return (
    <div
      data-testid="refrelink-panel"
      style={{
        position: 'fixed', top: 60, right: 16, width: 340, maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto', background: C.bg, border: `1px solid ${C.warn}`, borderRadius: 10,
        zIndex: 850, color: C.text, fontSize: 13,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        boxShadow: '0 8px 32px rgba(0,0,0,.45)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontWeight: 700, color: C.warn }}>⚠ {t.title} ({items.length})</span>
        {onClose ? (
          <button data-testid="refrelink-close" onClick={onClose} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        ) : null}
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item, i) => {
          const { lostRef, suggestion } = item;
          const empty = suggestion.candidates.length === 0;
          return (
            <div
              key={lostRef.id}
              data-testid={`refrelink-item-${i}`}
              style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                {lostRef.consumer.label}
                <span style={{ color: C.dim, fontWeight: 400 }}> · </span>
                <code style={{ fontFamily: 'monospace', fontSize: 12 }}>{refLabel(lostRef)}</code>
              </div>
              <div data-testid={`refrelink-${i}-reason`} style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>
                {t.reason(lostRef.reason)}
              </div>

              {!suggestion.hasConfidentCandidate ? (
                <div data-testid={`refrelink-${i}-noconfident`} style={{ fontSize: 11, color: C.warn, marginBottom: 6 }}>
                  {t.noConfident}
                </div>
              ) : null}
              {suggestion.note === 'midpoint-only-ranking' ? (
                <div data-testid={`refrelink-${i}-approx`} style={{ fontSize: 10, color: C.dim, marginBottom: 6 }}>
                  {t.distanceOnly}
                </div>
              ) : null}
              {suggestion.note === 'no-prior-anchor' && !empty ? (
                <div style={{ fontSize: 10, color: C.dim, marginBottom: 6 }}>{t.noPriorAnchor}</div>
              ) : null}

              {empty ? (
                <div data-testid={`refrelink-${i}-empty`} style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>
                  {t.noCandidates}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                  {suggestion.candidates.map((cand, j) => (
                    <button
                      key={j}
                      data-testid={`refrelink-${i}-candidate-${j}`}
                      data-confident={cand.confident ? 'true' : 'false'}
                      onClick={() => onApply(lostRef, cand.target)}
                      onMouseEnter={() => onHighlight?.(cand.anchor)}
                      onMouseLeave={() => onHighlight?.(null)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
                        padding: '5px 8px', background: 'transparent',
                        border: `1px solid ${cand.confident ? C.accent : C.border}`, borderRadius: 6,
                        color: C.text, cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        {t.apply}{' '}
                        <code style={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {cand.target.kind === 'name' ? cand.target.name : fmtAnchor(cand.anchor)}
                        </code>
                        <span style={{ display: 'block', fontSize: 10, color: C.dim }}>
                          {cand.score !== null ? `${t.score} ${fmt(cand.score)}` : null}
                          {cand.score !== null && cand.confident && suggestion.margin !== null
                            ? ` · ${t.margin} ${fmt(suggestion.margin)}` : null}
                          {cand.distance !== null
                            ? `${cand.score !== null ? ' · ' : ''}${t.dist} ${fmt(cand.distance)}mm` : null}
                        </span>
                      </span>
                      {cand.confident ? (
                        <span data-testid={`refrelink-${i}-confident-${j}`} style={{ fontSize: 10, color: C.ok, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          ★ {t.gateOk}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}

              {onReselect ? (
                <button
                  data-testid={`refrelink-${i}-reselect`}
                  onClick={() => onReselect(lostRef)}
                  style={{ width: '100%', padding: '5px 0', background: 'transparent', color: C.accent, border: `1px dashed ${C.accent}`, borderRadius: 6, cursor: 'pointer', fontSize: 11 }}
                >
                  {t.reselect}
                </button>
              ) : null}
            </div>
          );
        })}

        {history && history.length > 0 ? (
          <div data-testid="refrelink-history" style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: C.dim, fontWeight: 600, marginBottom: 4 }}>{t.history} ({history.length})</div>
            {history.map((r, k) => (
              <div key={k} data-testid={`refrelink-history-${k}`} style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>
                {r.from} → {r.to}{r.confident ? ' ★' : ''}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
