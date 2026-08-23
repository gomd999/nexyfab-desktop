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
import { designLoc, designPair } from './designI18n';

interface InputSpec {
  name: string; labelKo: string; unit: string;
  default?: number; min?: number; max?: number; optional?: boolean; extraOnly?: boolean;
}
interface CalcSpec { id: string; labelKo: string; status: string; refs: string[]; userInputs: InputSpec[] }
interface DomainSpec { slug: string; labelKo: string; labelEn: string; note: string; calculators: CalcSpec[] }

interface MemberCand { index: number; id: string; kind: string; L: number; A: number; rmin: number }
interface Citation { clause: string; note: string | null; inCorpus: boolean; page?: number | null; title: string | null; publisher: string | null; url: string | null; license: string | null }
interface VerifyResult {
  ok: boolean;
  verdict?: 'PASS' | 'FAIL';
  checks?: Record<string, Record<string, number | boolean>>;
  intermediate?: Record<string, number | string>;
  member?: { id: string | null; kind: string; L: number; note?: string } | null;
  derived?: Record<string, number>;
  provenance?: { geometry: string[]; user: string[] };
  refs?: string[]; status?: string; disclaimer?: string; notes?: string[];
  needInputs?: InputSpec[]; gateError?: string; error?: string;
  candidates?: MemberCand[]; citations?: Citation[];
  drawingSvg?: string;
}

// 형상 파생값 단위(④): 계산기 입력은 mm 계열(길이 mm·면적 mm²·회전반경 mm·단면계수 mm³).
const DERIVED_UNIT: Record<string, string> = {
  Ag: 'mm²', A: 'mm²', Aw: 'mm²', L: 'mm', r: 'mm', rx: 'mm', ry: 'mm',
  Sx: 'mm³', Sy: 'mm³', Ix: 'mm⁴', Iy: 'mm⁴', b: 'mm', d: 'mm', h: 'mm',
};

const num = (v: number | boolean) => (typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(2)) : String(v));

export default function DomainVerifyPanel({ intent, lang, defaultDomain }: { intent: unknown; lang: string; defaultDomain?: string | null }) {
  const t = (copy: Parameters<typeof designLoc>[1]) => designLoc(lang, copy);
  const [domains, setDomains] = useState<DomainSpec[] | null>(null);
  const [domainSlug, setDomainSlug] = useState('');
  const [calcId, setCalcId] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [memberRef, setMemberRef] = useState<string | number | undefined>(undefined);
  const [candidates, setCandidates] = useState<MemberCand[]>([]);
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
        // 분야 진입(?domain=)이면 그 분야를 기본 선택, 아니면 첫 분야.
        const pick = (defaultDomain && d.domains.find((x) => x.slug === defaultDomain)) || d.domains[0];
        if (pick) { setDomainSlug(pick.slug); setCalcId(pick.calculators[0]?.id ?? ''); }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [defaultDomain]);

  const domain = useMemo(() => domains?.find((d) => d.slug === domainSlug) ?? null, [domains, domainSlug]);
  const calc = useMemo(() => domain?.calculators.find((c) => c.id === calcId) ?? null, [domain, calcId]);

  // 계산기 바뀌면 입력 기본값 리셋 + 부재 선택 초기화
  useEffect(() => {
    if (!calc) return;
    const init: Record<string, string> = {};
    for (const s of calc.userInputs) if (s.default !== undefined) init[s.name] = String(s.default);
    setParams(init);
    setResult(null);
    setErr(null);
    setMemberRef(undefined);
    setCandidates([]);
  }, [calc]);

  const run = useCallback(async (refOverride?: string | number, paramsOverride?: Record<string, string>) => {
    if (!intent || !domainSlug || !calcId) return;
    setLoading(true); setErr(null); setResult(null);
    const numParams: Record<string, number> = {};
    for (const [k, v] of Object.entries(paramsOverride ?? params)) {
      if (v.trim() === '') continue;
      const n = Number(v);
      if (Number.isFinite(n)) numParams[k] = n;
    }
    const ref = refOverride ?? memberRef;
    try {
      const res = await fetch('/api/nexyfab/drawing/verify-domain/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, domain: domainSlug, calculatorId: calcId, params: numParams, memberRef: ref }),
      });
      const data = (await res.json()) as VerifyResult;
      setResult(data);
      if (Array.isArray(data.candidates) && data.candidates.length) setCandidates(data.candidates);
      if (!data.ok && data.error && !data.needInputs) setErr(data.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [intent, domainSlug, calcId, params, memberRef]);

  if (!domains) return null;

  const needSet = new Set((result?.needInputs ?? []).map((s) => s.name));
  const draft = (calc?.status ?? '').startsWith('draft');

  return (
    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--nx-border, #dfe3e8)', paddingTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
        {t({ ko: '분야 검증 (선택)', en: 'Domain verification (optional)', ja: '分野検証（任意）', zh: '领域验证（可选）', es: 'Verificación del dominio (opcional)', ar: 'التحقق من المجال (اختياري)' })}
        <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
          {t({ ko: '형상 파생 + 하중 입력 → 계산기', en: 'geometry-derived + your loads → calculator', ja: '形状から導出 + 荷重入力 → 計算機', zh: '几何派生 + 荷载输入 → 计算器', es: 'geometría derivada + tus cargas → calculadora', ar: 'المشتق من الشكل + أحمالك → الحاسبة' })}
        </span>
      </div>

      {/* 분야 · 계산기 선택 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <select value={domainSlug} onChange={(e) => { setDomainSlug(e.target.value); const d = domains.find((x) => x.slug === e.target.value); setCalcId(d?.calculators[0]?.id ?? ''); }} style={selStyle}>
          {domains.map((d) => <option key={d.slug} value={d.slug}>{designPair(lang, d.labelKo, (d as DomainSpec & { labelEn?: string }).labelEn ?? d.labelKo)}</option>)}
        </select>
        <select value={calcId} onChange={(e) => setCalcId(e.target.value)} style={selStyle}>
          {domain?.calculators.map((c) => <option key={c.id} value={c.id}>{c.labelKo}</option>)}
        </select>
      </div>
      {domain?.note && <div style={{ fontSize: 11, color: 'var(--nx-text-3, #6b7684)', marginBottom: 8, lineHeight: 1.4 }}>{domain.note}</div>}

      {/* ④ 부재 선택 — 프리즘형 부재가 2개 이상이면 무엇을 검증할지 선택 */}
      {candidates.length > 1 && (
        <label style={{ display: 'block', fontSize: 11, marginBottom: 8 }}>
          <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{t({ ko: '검증 부재', en: 'Member to verify', ja: '検証部材', zh: '待验证构件', es: 'Elemento a verificar', ar: 'العنصر المطلوب التحقق منه' })}</span>
          <select
            value={String(memberRef ?? '')}
            onChange={(e) => { const v = e.target.value; const ref = v === '' ? undefined : v; setMemberRef(ref); run(ref); }}
            style={{ ...selStyle, marginTop: 2 }}
          >
            <option value="">{t({ ko: '자동(첫 부재)', en: 'Auto (first)', ja: '自動（最初の部材）', zh: '自动（第一个）', es: 'Automático (primero)', ar: 'تلقائي (الأول)' })}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.id} · {c.kind} · L{c.L}mm · A{c.A}mm²</option>
            ))}
          </select>
        </label>
      )}

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

      <button type="button" onClick={() => run()} disabled={loading} style={runStyle}>
        {loading ? t({ ko: '검증 중…', en: 'Verifying…', ja: '検証中…', zh: '验证中…', es: 'Verificando…', ar: 'جارٍ التحقق…' }) : t({ ko: '분야 검증 실행', en: 'Run domain check', ja: '分野検証を実行', zh: '运行领域验证', es: 'Ejecutar verificación', ar: 'تشغيل فحص المجال' })}
      </button>

      {err && <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fdecec', color: '#b42318', fontSize: 11.5 }}>{err}</div>}

      {/* 필수 입력 누락(하중 등) — 값을 지어내지 않음 */}
      {result && !result.ok && result.needInputs && (
        <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fff4e5', color: '#a15c00', fontSize: 11.5 }}>
          {t({ ko: '이 검토엔 다음 입력이 필요합니다(형상으론 알 수 없음): ', en: 'This check needs (not derivable from geometry): ', ja: 'この検証には次の入力が必要です（形状からは導出できません）：', zh: '此验证需要以下输入（无法从几何推导）：', es: 'Esta comprobación necesita (no se deriva de la geometría): ', ar: 'يتطلب هذا الفحص المدخلات التالية (لا يمكن اشتقاقها من الشكل): ' })}
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
                {t({ ko: '검증 부재: ', en: 'member: ', ja: '検証部材: ', zh: '验证构件：', es: 'elemento: ', ar: 'العنصر: ' })}{result.member.id ?? result.member.kind} · L={result.member.L}mm
              </span>
            )}
          </div>

          {/* 편집형 도면 — 파란 치수 클릭 → 파라미터 수정 → 자동 재검증 (값 소스는 폼 상태) */}
          {result.drawingSvg && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{ background: '#fff', borderRadius: 8, padding: 6, overflowX: 'auto' }}
                onClick={(e) => {
                  const node = (e.target as HTMLElement).closest('[data-param]');
                  const key = node?.getAttribute('data-param');
                  if (!key) return;
                  const spec = calc?.userInputs.find((s) => s.name === key);
                  const cur = params[key] ?? (spec?.default !== undefined ? String(spec.default) : '');
                  const label = spec ? `${spec.labelKo}${spec.unit ? ` (${spec.unit})` : ''}` : key;
                  const nv = window.prompt(t({ ko: '새 값 — ', en: 'New value — ', ja: '新しい値 — ', zh: '新值 — ', es: 'Nuevo valor — ', ar: 'قيمة جديدة — ' }) + label, cur);
                  if (nv === null || nv.trim() === '' || !Number.isFinite(Number(nv))) return;
                  const next = { ...params, [key]: nv };
                  setParams(next);
                  void run(memberRef, next);
                }}
                dangerouslySetInnerHTML={{ __html: result.drawingSvg }}
              />
              <div style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 2 }}>
                {t({ ko: '파란 치수 클릭 = 해당 값 수정 → 재검증·도면 재생성 (폼과 동일 단위)', en: 'Click a blue dimension to edit → auto re-verify & redraw (same units as form)', ja: '青い寸法をクリックして編集 → 自動で再検証・再描画', zh: '点击蓝色尺寸编辑 → 自动重新验证并重绘', es: 'Haz clic en una medida azul para editarla → reverificación y redibujo automáticos', ar: 'انقر على بُعد أزرق للتعديل → إعادة التحقق والرسم تلقائياً' })}
              </div>
            </div>
          )}

          {/* 형상 파생값(투명성) */}
          {result.derived && Object.keys(result.derived).length > 0 && (
            <div style={{ fontSize: 11, marginBottom: 8 }}>
              <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{t({ ko: '형상 파생 ', en: 'from geometry ', ja: '形状由来 ', zh: '来自几何 ', es: 'de la geometría ', ar: 'من الشكل ' })}</span>
              {Object.entries(result.derived).map(([k, v]) => (
                <span key={k} style={{ display: 'inline-block', margin: '0 6px 4px 0', padding: '1px 6px', borderRadius: 4, background: 'var(--nx-hover, #eef1f4)' }}>
                  {k}={num(v)}{DERIVED_UNIT[k] ? ` ${DERIVED_UNIT[k]}` : ''}
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
                        {t({ ko: '이용률 ', en: 'util ', ja: '利用率 ', zh: '利用率 ', es: 'util. ', ar: 'الاستخدام ' })}{(ratio * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ③ 구조화된 근거(인용) + draft 라벨 + disclaimer */}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)', fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>
            {draft && <div style={{ color: '#a15c00', fontWeight: 600 }}>⚠ {t({ ko: '비법정 참고 — 공개예제 게이트 미충족(draft)', en: 'Reference only — draft calculator', ja: '参考用 — ドラフト計算機', zh: '仅供参考 — 草稿计算器', es: 'Solo referencia — calculadora en borrador', ar: 'للمرجع فقط — حاسبة مسودة' })}</div>}
            {result.disclaimer && <div>{result.disclaimer}</div>}
            {result.citations && result.citations.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{t({ ko: '근거', en: 'Basis', ja: '根拠', zh: '依据', es: 'Base', ar: 'الأساس' })}</div>
                {result.citations.map((c, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>
                    <span style={{
                      display: 'inline-block', fontSize: 8.5, fontWeight: 700, padding: '0 3px', borderRadius: 3, marginRight: 4, verticalAlign: 'middle',
                      background: c.inCorpus ? '#dcfae6' : '#eef1f4', color: c.inCorpus ? '#067647' : '#6b7684',
                    }}>{c.inCorpus ? 'PD' : 'ref'}</span>
                    {c.clause}
                    {c.url ? (
                      <> — <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--nx-accent, #2563eb)' }}>{c.title}{c.page ? ` (p.${c.page})` : ''}</a></>
                    ) : c.title ? <> — {c.title}</> : c.note ? <> — {c.note}</> : null}
                  </div>
                ))}
                <div style={{ marginTop: 2, fontStyle: 'italic' }}>
                  {t({ ko: 'PD=미 연방 퍼블릭도메인 원문 링크. ref=조항 참조(원문 비수록). 전문 검색(RAG)은 별도.', en: 'PD=US-gov public-domain source link. ref=clause reference only.', ja: 'PD=米国政府のパブリックドメイン原文リンク。ref=条項参照。', zh: 'PD=美国政府公共领域原文链接。ref=条款引用。', es: 'PD=enlace a la fuente pública del gobierno de EE. UU.; ref=referencia de cláusula.', ar: 'PD=رابط مصدر حكومي أمريكي متاح للعامة؛ ref=مرجع البند.' })}
                </div>
              </div>
            )}
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
