'use client';

/**
 * 분야 검증 패널(②-UI) — 설계 형상(intent) + 분야 계산기.
 *
 * design-domain-ia.md §5: 검증은 별도 메뉴가 아니라 설계 흐름의 상시 게이트. manifold/
 * 치수(공통 코어)는 이미 상위 VerifyRow가 담당하고, 여기서는 "그 분야가 무엇을 검증하고
 * 무엇을 인용하는가"를 얹는다. 형상이 줄 수 있는 입력(단면·경간)은 서버가 결정론 파생하고,
 * 하중·재료만 사용자가 입력 → 진짜 engineering-core 계산기(POST verify-domain).
 *
 * 정직성: 계산기는 draft(비법정 참고) — status·disclaimer·근거(refs)를 그대로 노출.
 * 하중 미입력 시 서버가 needInputs를 주면 그 필드를 강조(값을 지어내지 않음). 어떤 부재를
 * 검증했는지(member) 표시해 오검증을 사용자가 알아채게 한다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface InputSpec {
  name: string; labelKo: string; unit: string;
  default?: number; min?: number; max?: number; optional?: boolean; extraOnly?: boolean;
}
interface CalcSpec { id: string; labelKo: string; status: string; refs: string[]; userInputs: InputSpec[] }
interface DomainSpec { slug: string; labelKo: string; labelEn: string; note: string; calculators: CalcSpec[] }

interface VerifyResult {
  ok: boolean;
  verdict?: 'PASS' | 'FAIL';
  checks?: Record<string, Record<string, number | boolean>>;
  intermediate?: Record<string, number | string>;
  member?: { id: string | null; kind: string; L: number; note?: string } | null;
  derived?: Record<string, number>;
  provenance?: { geometry: string[]; user: string[] };
  refs?: string[]; status?: string; disclaimer?: string; notes?: string[];
  needInputs?: InputSpec[]; gateError?: string; error?: string; candidates?: unknown[];
}

const num = (v: number | boolean) => (typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(2)) : String(v));

export default function DomainVerifyPanel({ intent, lang }: { intent: unknown; lang: string }) {
  const ko = isKorean(lang);
  const [domains, setDomains] = useState<DomainSpec[] | null>(null);
  const [domainSlug, setDomainSlug] = useState('');
  const [calcId, setCalcId] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 분야 카탈로그 1회 로드
  useEffect(() => {
    let alive = true;
    fetch('/api/nexyfab/drawing/verify-domain/')
      .then((r) => r.json())
      .then((d: { ok: boolean; domains?: DomainSpec[] }) => {
        if (!alive || !d.ok || !d.domains) return;
        setDomains(d.domains);
        if (d.domains[0]) { setDomainSlug(d.domains[0].slug); setCalcId(d.domains[0].calculators[0]?.id ?? ''); }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const domain = useMemo(() => domains?.find((d) => d.slug === domainSlug) ?? null, [domains, domainSlug]);
  const calc = useMemo(() => domain?.calculators.find((c) => c.id === calcId) ?? null, [domain, calcId]);

  // 계산기 바뀌면 입력 기본값 리셋
  useEffect(() => {
    if (!calc) return;
    const init: Record<string, string> = {};
    for (const s of calc.userInputs) if (s.default !== undefined) init[s.name] = String(s.default);
    setParams(init);
    setResult(null);
    setErr(null);
  }, [calc]);

  const run = useCallback(async () => {
    if (!intent || !domainSlug || !calcId) return;
    setLoading(true); setErr(null); setResult(null);
    const numParams: Record<string, number> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v.trim() === '') continue;
      const n = Number(v);
      if (Number.isFinite(n)) numParams[k] = n;
    }
    try {
      const res = await fetch('/api/nexyfab/drawing/verify-domain/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, domain: domainSlug, calculatorId: calcId, params: numParams }),
      });
      const data = (await res.json()) as VerifyResult;
      setResult(data);
      if (!data.ok && data.error && !data.needInputs) setErr(data.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [intent, domainSlug, calcId, params]);

  if (!domains) return null;

  const needSet = new Set((result?.needInputs ?? []).map((s) => s.name));
  const draft = (calc?.status ?? '').startsWith('draft');

  return (
    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--nx-border, #dfe3e8)', paddingTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
        {ko ? '분야 검증 (선택)' : 'Domain verification (optional)'}
        <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
          {ko ? '형상 파생 + 하중 입력 → 계산기' : 'geometry-derived + your loads → calculator'}
        </span>
      </div>

      {/* 분야 · 계산기 선택 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <select value={domainSlug} onChange={(e) => { setDomainSlug(e.target.value); const d = domains.find((x) => x.slug === e.target.value); setCalcId(d?.calculators[0]?.id ?? ''); }} style={selStyle}>
          {domains.map((d) => <option key={d.slug} value={d.slug}>{d.labelKo}</option>)}
        </select>
        <select value={calcId} onChange={(e) => setCalcId(e.target.value)} style={selStyle}>
          {domain?.calculators.map((c) => <option key={c.id} value={c.id}>{c.labelKo}</option>)}
        </select>
      </div>
      {domain?.note && <div style={{ fontSize: 11, color: 'var(--nx-text-3, #6b7684)', marginBottom: 8, lineHeight: 1.4 }}>{domain.note}</div>}

      {/* 입력 폼 (하중·재료) */}
      {calc && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          {calc.userInputs.map((s) => (
            <label key={s.name} style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: needSet.has(s.name) ? '#b42318' : 'var(--nx-text-2, #46505e)' }}>
                {s.labelKo}{s.unit ? ` (${s.unit})` : ''}{s.optional ? '' : ' *'}
              </span>
              <input
                type="number" inputMode="decimal"
                value={params[s.name] ?? ''}
                onChange={(e) => setParams((p) => ({ ...p, [s.name]: e.target.value }))}
                placeholder={s.default !== undefined ? String(s.default) : ''}
                style={{ ...inpStyle, borderColor: needSet.has(s.name) ? '#f04438' : 'var(--nx-border, #dfe3e8)' }}
              />
            </label>
          ))}
        </div>
      )}

      <button type="button" onClick={run} disabled={loading} style={runStyle}>
        {loading ? (ko ? '검증 중…' : 'Verifying…') : ko ? '분야 검증 실행' : 'Run domain check'}
      </button>

      {err && <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fdecec', color: '#b42318', fontSize: 11.5 }}>{err}</div>}

      {/* 필수 입력 누락(하중 등) — 값을 지어내지 않음 */}
      {result && !result.ok && result.needInputs && (
        <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fff4e5', color: '#a15c00', fontSize: 11.5 }}>
          {ko ? '이 검토엔 다음 입력이 필요합니다(형상으론 알 수 없음): ' : 'This check needs (not derivable from geometry): '}
          <b>{result.needInputs.map((s) => s.labelKo).join(', ')}</b>
        </div>
      )}

      {/* 결과 */}
      {result && result.ok && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 800, color: '#fff',
              background: result.verdict === 'PASS' ? '#12b76a' : '#f04438',
            }}>{result.verdict}</span>
            {result.member && (
              <span style={{ fontSize: 11, color: 'var(--nx-text-3, #6b7684)' }}>
                {ko ? '검증 부재: ' : 'member: '}{result.member.id ?? result.member.kind} · L={result.member.L}mm
              </span>
            )}
          </div>

          {/* 형상 파생값(투명성) */}
          {result.derived && Object.keys(result.derived).length > 0 && (
            <div style={{ fontSize: 11, marginBottom: 8 }}>
              <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{ko ? '형상 파생 ' : 'from geometry '}</span>
              {Object.entries(result.derived).map(([k, v]) => (
                <span key={k} style={{ display: 'inline-block', margin: '0 6px 4px 0', padding: '1px 6px', borderRadius: 4, background: 'var(--nx-hover, #eef1f4)' }}>
                  {k}={num(v)}
                </span>
              ))}
            </div>
          )}

          {/* 검토 항목 */}
          {result.checks && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(result.checks).map(([name, c]) => {
                const hasPass = typeof c.pass === 'boolean';
                const ratio = typeof c.ratio === 'number' ? c.ratio : undefined;
                return (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 8px', background: hasPass ? (c.pass ? '#12b76a' : '#f04438') : '#9aa4b0' }} />
                      {name}
                    </span>
                    {ratio !== undefined && (
                      <span style={{ fontWeight: 600, color: ratio <= 1 ? 'var(--nx-text, #1a2230)' : '#b42318' }}>
                        {ko ? '이용률 ' : 'util '}{(ratio * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 근거 + draft 라벨 + disclaimer */}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)', fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>
            {draft && <div style={{ color: '#a15c00', fontWeight: 600 }}>⚠ {ko ? '비법정 참고 — 공개예제 게이트 미충족(draft)' : 'Reference only — draft calculator'}</div>}
            {result.disclaimer && <div>{result.disclaimer}</div>}
            {result.refs && result.refs.length > 0 && <div>{ko ? '근거: ' : 'Refs: '}{result.refs.join(' · ')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const selStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 6, fontSize: 11.5,
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)',
};
const inpStyle: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 6, fontSize: 12, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
};
const runStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--nx-accent, #2563eb)',
  background: 'transparent', color: 'var(--nx-accent, #2563eb)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
};
