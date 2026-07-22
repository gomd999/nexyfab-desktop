'use client';

/**
 * BriefClarifier — MINIMAL UI hook for the clarify→structure pre-pass.
 *
 * Self-contained on purpose: it is NOT yet mounted. It plugs into DesignInner's
 * "무엇을 설계할까요?" free-text box (the <textarea> feeding `run(prompt)` at
 * ~L1324/L1338). Drop it directly ABOVE the "설계 생성 + 검증" button and wire:
 *
 *   <BriefClarifier lang={lang} rawText={prompt} onUseRefined={(t) => setPrompt(t)} />
 *
 * It calls POST /api/nexyfab/brief-expand, then shows (a) the clarifying
 * questions and (b) a source-labelled draft (given / 가정 / 확인필요). The user
 * edits their prompt and re-runs the EXISTING generate flow — this component
 * never generates geometry itself. It is deliberately small; expand only if the
 * team decides the pre-pass should become the default entry.
 */

import { useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface BriefParam {
  key: string;
  value: number | string | null;
  unit: string | null;
  source: 'given' | 'assumption' | 'needs_input';
  note?: string;
}
interface BriefComponent { name: string; params: BriefParam[] }
interface StructuredBrief {
  title: string;
  domain: string;
  components: BriefComponent[];
  questions: string[];
  assumptions: string[];
  raw: string;
}
interface ExpandResp {
  ok: boolean;
  brief?: StructuredBrief;
  plannerBrief?: { id: string; text: string; params: Record<string, number | string> };
  error?: string;
}

const SRC_STYLE: Record<BriefParam['source'], { ko: string; en: string; bg: string; fg: string }> = {
  given:       { ko: '입력', en: 'given', bg: 'rgba(34,197,94,0.14)', fg: '#15803d' },
  assumption:  { ko: '가정', en: 'assumed', bg: 'rgba(245,158,11,0.16)', fg: '#b45309' },
  needs_input: { ko: '확인필요', en: 'needs input', bg: 'rgba(239,68,68,0.14)', fg: '#b91c1c' },
};

export default function BriefClarifier({
  lang,
  rawText,
  onUseRefined,
}: {
  lang: string;
  rawText: string;
  /** Push the structured planner text back into the prompt box. */
  onUseRefined: (text: string) => void;
}) {
  const ko = isKorean(lang);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resp, setResp] = useState<ExpandResp | null>(null);

  const run = async () => {
    const text = rawText.trim();
    if (text.length < 4) return;
    setBusy(true); setErr(null); setResp(null);
    try {
      const r = await fetch('/api/nexyfab/brief-expand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = (await r.json()) as ExpandResp;
      if (!data.ok) { setErr(data.error ?? (ko ? '정리에 실패했습니다.' : 'Failed to structure.')); return; }
      setResp(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const brief = resp?.brief;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        disabled={busy || rawText.trim().length < 4}
        onClick={() => void run()}
        style={{
          padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
          border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text-2, #46505e)',
        }}
      >
        {busy ? (ko ? '정리 중…' : 'Structuring…') : (ko ? '🧭 브리프 정리 (질문 먼저)' : '🧭 Clarify brief (ask first)')}
      </button>

      {err && <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{err}</div>}

      {brief && (
        <div style={{ marginTop: 10, border: '1px solid var(--nx-border, #dfe3e8)', borderRadius: 9, padding: 12 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>{brief.title}</div>

          {brief.questions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--nx-text-3, #6b7684)' }}>
                {ko ? '먼저 확인이 필요해요' : 'A few things to confirm'}
              </div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                {brief.questions.map((q, i) => <li key={i} style={{ marginTop: 2 }}>{q}</li>)}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {brief.components.map((c) => (
              <div key={c.name}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{c.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 3 }}>
                  {c.params.map((p) => {
                    const s = SRC_STYLE[p.source];
                    const val = p.value !== null ? `${p.value}${p.unit ?? ''}` : (ko ? '미정' : 'TBD');
                    return (
                      <span key={p.key} title={p.note ?? ''}
                        style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '3px 8px', borderRadius: 999, fontSize: 11.5, background: s.bg, color: s.fg }}>
                        <b style={{ fontWeight: 700 }}>{p.key}</b>
                        <span>{val}</span>
                        <span style={{ opacity: 0.8 }}>· {ko ? s.ko : s.en}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {resp?.plannerBrief && (
            <button
              type="button"
              onClick={() => onUseRefined(resp.plannerBrief!.text)}
              style={{
                marginTop: 12, padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 700,
              }}
            >
              {ko ? '이 구조로 프롬프트 채우기' : 'Fill prompt with this structure'}
            </button>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nx-text-3, #6b7684)' }}>
            {ko ? '가정값은 추정이며 실측이 아닙니다 — 생성 전에 확인해 주세요.' : 'Assumed values are defaults, not measurements — please confirm before generating.'}
          </div>
        </div>
      )}
    </div>
  );
}