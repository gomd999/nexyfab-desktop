'use client';

/**
 * RfqResponderPanel — partner-side AI quote drafting modal (Phase 7-3).
 *
 * Pops over the existing respond modal as a draft helper. Partner clicks
 * "🤖 AI 회신 초안", reviews/edits the AI suggestion, then "초안 적용" prefills
 * the parent's respondForm with estimatedAmount/estimatedDays/note.
 */

import { useEffect, useState } from 'react';
import { draftRfqResponse, type RfqResponseDraft, type RfqBrief, type PartnerCapacity } from './rfqResponder';

interface Props {
  rfq: RfqBrief;
  defaultPartner?: PartnerCapacity;
  /** QuoteAccuracy 분석 결과 전체 편향% — 양수면 과대견적, 음수면 과소견적 */
  accuracyAdjustment?: number | null;
  onApply: (next: { estimatedAmount: string; estimatedDays: string; note: string }) => void;
  onClose: () => void;
}

function won(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

export default function RfqResponderPanel({ rfq, defaultPartner, accuracyAdjustment, onApply, onClose }: Props) {
  const [partner, setPartner] = useState<PartnerCapacity>({
    hourlyRateKrw: defaultPartner?.hourlyRateKrw ?? 80000,
    materialMargin: defaultPartner?.materialMargin ?? 0.35,
    leadCapacityDays: defaultPartner?.leadCapacityDays,
    certifications: defaultPartner?.certifications ?? [],
    processes: defaultPartner?.processes ?? [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RfqResponseDraft | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [editDays, setEditDays] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');
  const [showKo, setShowKo] = useState(true);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const result = await draftRfqResponse({ rfq, partner });
      setDraft(result);
      // QuoteAccuracy 보정 적용: 과대견적(양수)이면 금액 낮추고, 과소(음수)면 높임
      const adj = accuracyAdjustment != null && Math.abs(accuracyAdjustment) >= 3
        ? Math.round(result.estimatedAmount * (1 - accuracyAdjustment / 100) / 1000) * 1000
        : result.estimatedAmount;
      setEditAmount(String(adj));
      setEditDays(String(result.estimatedDays));
      setEditNote(showKo ? result.noteKo : result.note);
    } catch (e) {
      const err = e as Error & { requiresPro?: boolean };
      setError(err.requiresPro ? 'Pro 플랜으로 업그레이드해주세요.' : (err.message || '초안 생성 실패'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApply() {
    onApply({ estimatedAmount: editAmount, estimatedDays: editDays, note: editNote });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">🤖 AI 회신 초안</h2>
            <p className="text-xs text-purple-100 mt-0.5">{rfq.projectName ?? rfq.partName ?? 'RFQ'}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* Partner capacity inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">시간당 단가 (KRW/hr)</label>
              <input
                type="number"
                value={partner.hourlyRateKrw ?? 0}
                onChange={e => setPartner(p => ({ ...p, hourlyRateKrw: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-purple-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">재료 마진 (0-1)</label>
              <input
                type="number"
                step="0.05"
                value={partner.materialMargin ?? 0.35}
                onChange={e => setPartner(p => ({ ...p, materialMargin: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-purple-400"
              />
            </div>
          </div>
          <button
            onClick={() => void generate()}
            disabled={loading}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50"
          >
            {loading ? '생성 중...' : '🔄 다시 생성'}
          </button>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}

          {draft && (
            <>
              {accuracyAdjustment != null && Math.abs(accuracyAdjustment) >= 3 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-center gap-2">
                  <span>📊</span>
                  <span>
                    견적 정확도 분석 결과 적용됨: 편향 {accuracyAdjustment > 0 ? '+' : ''}{accuracyAdjustment}% →
                    금액이 {accuracyAdjustment > 0 ? '하향' : '상향'} 보정되었습니다.
                  </span>
                </div>
              )}
              <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 space-y-1.5">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-purple-700 font-semibold">AI 추정 금액</span>
                  <span className="text-lg font-black text-purple-900">{won(draft.estimatedAmount)}</span>
                </div>
                <div className="flex justify-between text-xs text-purple-700">
                  <span>예상 납기</span>
                  <span className="font-bold">{draft.estimatedDays}일</span>
                </div>
                <div className="flex justify-between text-xs text-purple-700">
                  <span>신뢰도</span>
                  <span className="font-bold">{Math.round(draft.confidence * 100)}%</span>
                </div>
              </div>

              {draft.breakdown.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">비용 분해</p>
                  <div className="bg-gray-50 rounded-lg divide-y divide-gray-100">
                    {draft.breakdown.map((b, i) => (
                      <div key={i} className="flex justify-between text-sm px-3 py-1.5">
                        <span className="text-gray-600">{showKo ? b.labelKo : b.label}</span>
                        <span className="font-semibold text-gray-800">{won(b.amountKrw)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {draft.caveats.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-700 uppercase mb-1.5">⚠️ 주의 사항</p>
                  <ul className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 space-y-0.5 text-xs text-amber-800">
                    {(showKo ? draft.caveatsKo : draft.caveats).map((c, i) => <li key={i}>• {c}</li>)}
                  </ul>
                </div>
              )}

              <div className="border-t border-gray-100 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 uppercase">편집 가능 (적용 시 모달에 채워짐)</p>
                  <button
                    onClick={() => {
                      const next = !showKo;
                      setShowKo(next);
                      setEditNote(next ? draft.noteKo : draft.note);
                    }}
                    className="text-[11px] font-semibold text-purple-700 hover:text-purple-900"
                  >
                    {showKo ? 'EN' : 'KO'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">금액 (원)</label>
                    <input
                      type="number"
                      value={editAmount}
                      onChange={e => setEditAmount(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-purple-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">납기 (일)</label>
                    <input
                      type="number"
                      value={editDays}
                      onChange={e => setEditDays(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-purple-400"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1">메모 ({showKo ? 'KO' : 'EN'})</label>
                  <textarea
                    value={editNote}
                    onChange={e => setEditNote(e.target.value)}
                    rows={4}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-purple-400 resize-none"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-100 px-6 py-3 flex gap-2">
          <button
            onClick={handleApply}
            disabled={!draft || !editAmount}
            className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
          >
            ✓ 초안 적용
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
