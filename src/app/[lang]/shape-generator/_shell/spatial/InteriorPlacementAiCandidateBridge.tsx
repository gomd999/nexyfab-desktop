'use client';

import type { InteriorPlacementAiCandidate } from '@/lib/ai/interiorPlacementAiCandidate';
import { langDir, toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export interface InteriorPlacementAiCandidateBridgeProps {
  candidate: InteriorPlacementAiCandidate | null;
  pending?: boolean;
  lang?: string;
  onApply: () => void;
  onDiscard: () => void;
}

type CandidateBridgeCopy = {
  title: string;
  object: string;
  scope: string;
  fingerprint: string;
  applying: string;
  apply: string;
  discard: string;
};

const COPY: Record<IsoLang, CandidateBridgeCopy> = {
  ko: { title: '선택 객체 AI 수정 검토', object: '대상', scope: '수정 범위', fingerprint: '검토 지문', applying: '적용 중…', apply: '검토 후 적용', discard: '폐기' },
  en: { title: 'Review selected-object AI patch', object: 'Object', scope: 'Scope', fingerprint: 'Review fingerprint', applying: 'Applying…', apply: 'Apply reviewed patch', discard: 'Discard' },
  ja: { title: '選択オブジェクトのAI修正を確認', object: '対象', scope: '修正範囲', fingerprint: 'レビュー指紋', applying: '適用中…', apply: '確認して適用', discard: '破棄' },
  zh: { title: '检查选定对象的 AI 修改', object: '对象', scope: '修改范围', fingerprint: '审查指纹', applying: '应用中…', apply: '审查后应用', discard: '丢弃' },
  es: { title: 'Revisar el cambio de IA del objeto seleccionado', object: 'Objeto', scope: 'Alcance', fingerprint: 'Huella de revisión', applying: 'Aplicando…', apply: 'Aplicar cambio revisado', discard: 'Descartar' },
  ar: { title: 'مراجعة تعديل الذكاء الاصطناعي للكائن المحدد', object: 'الكائن', scope: 'النطاق', fingerprint: 'بصمة المراجعة', applying: 'جارٍ التطبيق…', apply: 'تطبيق التعديل بعد المراجعة', discard: 'تجاهل' },
};

/** Review surface for placement patches. Applying is always an explicit action. */
export function InteriorPlacementAiCandidateBridge({ candidate, pending = false, lang = 'ko', onApply, onDiscard }: InteriorPlacementAiCandidateBridgeProps) {
  if (!candidate) return null;
  const locale = toIsoLang(lang);
  const t = COPY[locale];
  return (
    <section data-testid="interior-placement-ai-candidate" aria-live="polite" dir={langDir(lang)} style={{ marginTop: 10, padding: 10, border: '1px solid var(--nx-accent, #2563eb)', borderRadius: 8 }}>
      <div style={{ fontWeight: 650, fontSize: 12 }}>{t.title}</div>
      <div style={{ marginTop: 5, fontSize: 11 }}>
        {t.object}: <code>{candidate.selectedObjectId}</code> · {t.scope}: {candidate.parameterPaths.join(', ')}
      </div>
      <div style={{ marginTop: 4, fontSize: 10, opacity: .75 }}>{t.fingerprint}: <code>{candidate.reviewFingerprint.slice(0, 16)}…</code></div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button type="button" data-testid="interior-placement-ai-candidate-apply" onClick={onApply} disabled={pending}>{pending ? t.applying : t.apply}</button>
        <button type="button" data-testid="interior-placement-ai-candidate-discard" onClick={onDiscard} disabled={pending}>{t.discard}</button>
      </div>
    </section>
  );
}

export default InteriorPlacementAiCandidateBridge;
