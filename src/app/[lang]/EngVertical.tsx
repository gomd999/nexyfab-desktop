'use client';

/**
 * 엔지니어링 검증 버티컬 섹션 4종 (랜딩 개편 — 기준 5원칙, docs/strategy/landing-refs/README.md):
 *  <EngDemo/>    — 라이브 데모 패널: 키 없이 실제 검증 엔진(/v1/demo/calc) 호출
 *  <EngDomains/> — 분야 카드 3장 + 해시태그 (실재하는 분야만 — 빈 약속 칸 금지)
 *  <EngDev/>     — 검증 숫자 4종(전부 실측) + REST/MCP 개발자 섹션
 *  <EngFaq/>     — FAQ + schema.org FAQPage JSON-LD
 * 정직성: 계산은 결정론 엔진, 결과는 비법정 참고자료 — 모든 문구에 한계 명시.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { engDict } from './engDict';

const ENG_API = 'https://nexyfab-eng-api.gomd999.workers.dev';

/** KS D 3502 대표 단면 (엔진 카탈로그 ks-h-beams.json과 동일 수치, draft) */
const H_BEAMS = [
  { name: 'H-100x100x6x8', Sx: 76500, Ix: 3830000, Aw: 600 },
  { name: 'H-150x75x5x7', Sx: 88800, Ix: 6660000, Aw: 750 },
  { name: 'H-200x100x5.5x8', Sx: 184000, Ix: 18400000, Aw: 1100 },
  { name: 'H-250x125x6x9', Sx: 324000, Ix: 40500000, Aw: 1500 },
  { name: 'H-300x150x6.5x9', Sx: 481000, Ix: 72100000, Aw: 1950 },
  { name: 'H-350x175x7x11', Sx: 775000, Ix: 136000000, Aw: 2450 },
  { name: 'H-400x200x8x13', Sx: 1190000, Ix: 237000000, Aw: 3200 },
  { name: 'H-500x200x10x16', Sx: 1910000, Ix: 478000000, Aw: 5000 },
];

type EngLang = keyof typeof engDict;
const toEngLang = (lang: string): EngLang => (lang === 'kr' ? 'ko' : (lang in engDict ? (lang as EngLang) : 'en'));

interface CheckRow { name: string; pass: boolean; detail: string }

function parseChecks(checks: Record<string, Record<string, unknown>>, t: (typeof engDict)['ko']): CheckRow[] {
  return Object.entries(checks ?? {}).map(([key, c]) => {
    let detail = '';
    if (typeof c.ratio === 'number') detail = `${t.usageLabel} ${(c.ratio * 100).toFixed(0)}%`;
    else if (typeof c.FS === 'number') detail = `FS ${(c.FS as number).toFixed(2)}${typeof c.min === 'number' ? ` / ≥${c.min}` : ''}`;
    else if (typeof c.qmax_kPa === 'number') detail = `q_max ${(c.qmax_kPa as number).toFixed(0)} kPa${typeof c.allow_kPa === 'number' ? ` / ≤${c.allow_kPa}` : ''}`;
    else if (typeof c.e_m === 'number') detail = `e ${(c.e_m as number).toFixed(2)} m${typeof c.limit_m === 'number' ? ` / ≤${(c.limit_m as number).toFixed(2)}` : ''}`;
    return { name: t.checkNames[key] ?? key, pass: c.pass === true, detail };
  });
}

const fld: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1',
  fontSize: '14px', color: '#0f172a', background: '#fff', boxSizing: 'border-box',
};
const fldLabel: React.CSSProperties = { fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '6px', display: 'block' };

/* ═══════════════ 1. 라이브 데모 패널 ═══════════════ */
export function EngDemo({ langCode }: { langCode: string }) {
  const t = engDict[toEngLang(langCode)];
  const [tab, setTab] = useState<'beam' | 'wall'>('beam');
  const [beam, setBeam] = useState({ section: 6, spanM: 6, w: 12 });
  const [wall, setWall] = useState({ H: 4, phi: 30, gamma: 18, surcharge: 10, bearing: 300 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<null | { verdict: string; checks: CheckRow[]; refs: string[]; remaining?: number }>(null);

  const run = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      let id: string, input: Record<string, number>;
      if (tab === 'beam') {
        const s = H_BEAMS[beam.section];
        id = 'simple_beam';
        input = { L: beam.spanM * 1000, w: beam.w, Fy: 275, Sx: s.Sx, Ix: s.Ix, Aw: s.Aw };
      } else {
        const H = wall.H;
        const baseWidth = +(0.8 * H).toFixed(2);
        id = 'retaining_wall_stability';
        input = {
          H, gammaBackfill: wall.gamma, phiBackfill: wall.phi, surcharge: wall.surcharge,
          allowableBearing: wall.bearing,
          stemThickness: +Math.max(0.3, H / 12).toFixed(2), baseWidth,
          baseThickness: +Math.max(0.4, H / 10).toFixed(2), toeLength: +(baseWidth / 3).toFixed(2),
          baseFriction: 0.5,
        };
      }
      const res = await fetch(`${ENG_API}/v1/demo/calc/${id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || t.demoError); return; }
      setResult({
        verdict: j.verdict, checks: parseChecks(j.checks, t),
        refs: (j.refs ?? []).slice(0, 3), remaining: j.remainingToday,
      });
    } catch {
      setError(t.demoError);
    } finally { setLoading(false); }
  };

  const pass = result?.verdict === 'PASS';
  return (
    <section id="eng-demo" style={{ background: '#fff', padding: '90px 24px', borderBottom: '1px solid #e2e8f0' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: '36px' }} className="reveal">
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#3b82f6', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>{t.demoKicker}</p>
          <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 38px)', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '10px', wordBreak: 'keep-all' }}>{t.demoTitle}</h2>
          <p style={{ fontSize: '15px', color: '#64748b', maxWidth: '620px', margin: '0 auto', wordBreak: 'keep-all' }}>{t.demoSub}</p>
        </header>

        <div className="reveal" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '28px', boxShadow: '0 8px 32px rgba(15,23,42,0.06)' }}>
          {/* 탭 */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
            {([['beam', t.demoTabBeam], ['wall', t.demoTabWall]] as const).map(([key, label]) => (
              <button key={key} onClick={() => { setTab(key); setResult(null); setError(''); }} style={{
                padding: '9px 20px', borderRadius: '999px', fontSize: '13px', cursor: 'pointer', transition: 'all .2s',
                fontWeight: tab === key ? 700 : 500,
                border: tab === key ? '2px solid #3b82f6' : '2px solid #e2e8f0',
                background: tab === key ? '#eff6ff' : '#fff', color: tab === key ? '#1d4ed8' : '#64748b',
              }}>{label}</button>
            ))}
          </div>

          {/* 입력 폼 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            {tab === 'beam' ? (<>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={fldLabel}>{t.fldSection}</label>
                <select style={fld} value={beam.section} onChange={e => setBeam({ ...beam, section: +e.target.value })}>
                  {H_BEAMS.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={fldLabel}>{t.fldSpan}</label>
                <input style={fld} type="number" min={1} max={30} step={0.5} value={beam.spanM} onChange={e => setBeam({ ...beam, spanM: +e.target.value })} />
              </div>
              <div>
                <label style={fldLabel}>{t.fldLoad}</label>
                <input style={fld} type="number" min={0} max={500} step={1} value={beam.w} onChange={e => setBeam({ ...beam, w: +e.target.value })} />
              </div>
            </>) : (<>
              <div>
                <label style={fldLabel}>{t.fldWallH}</label>
                <input style={fld} type="number" min={1} max={12} step={0.5} value={wall.H} onChange={e => setWall({ ...wall, H: +e.target.value })} />
              </div>
              <div>
                <label style={fldLabel}>{t.fldPhi}</label>
                <input style={fld} type="number" min={15} max={45} step={1} value={wall.phi} onChange={e => setWall({ ...wall, phi: +e.target.value })} />
              </div>
              <div>
                <label style={fldLabel}>{t.fldGamma}</label>
                <input style={fld} type="number" min={10} max={24} step={0.5} value={wall.gamma} onChange={e => setWall({ ...wall, gamma: +e.target.value })} />
              </div>
              <div>
                <label style={fldLabel}>{t.fldSurcharge}</label>
                <input style={fld} type="number" min={0} max={100} step={1} value={wall.surcharge} onChange={e => setWall({ ...wall, surcharge: +e.target.value })} />
              </div>
              <div>
                <label style={fldLabel}>{t.fldBearing}</label>
                <input style={fld} type="number" min={50} max={2000} step={10} value={wall.bearing} onChange={e => setWall({ ...wall, bearing: +e.target.value })} />
              </div>
            </>)}
          </div>

          <button onClick={run} disabled={loading} style={{
            width: '100%', padding: '14px', borderRadius: '12px', border: 'none', cursor: loading ? 'wait' : 'pointer',
            fontSize: '15px', fontWeight: 800, color: '#fff',
            background: loading ? '#94a3b8' : 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
            boxShadow: '0 4px 20px rgba(59,130,246,0.35)', transition: 'all .2s',
          }}>{loading ? t.running : `▶ ${t.runBtn}`}</button>

          {error && <p style={{ marginTop: '16px', color: '#dc2626', fontSize: '13px', fontWeight: 600 }}>{error}</p>}

          {/* 결과 */}
          {result && (
            <div style={{ marginTop: '24px', background: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <span style={{
                  padding: '6px 16px', borderRadius: '999px', fontSize: '14px', fontWeight: 800,
                  background: pass ? '#dcfce7' : '#fee2e2', color: pass ? '#15803d' : '#b91c1c',
                }}>{pass ? `✓ ${t.verdictPass}` : `✕ ${t.verdictFail}`}</span>
                {typeof result.remaining === 'number' && (
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t.demoQuota.replace('{n}', String(result.remaining))}</span>
                )}
              </div>
              <div style={{ display: 'grid', gap: '8px' }}>
                {result.checks.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '9px 12px', borderRadius: '9px', background: c.pass ? '#f0fdf4' : '#fef2f2', border: `1px solid ${c.pass ? '#bbf7d0' : '#fecaca'}` }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{c.pass ? '✓' : '✕'} {c.name}</span>
                    <span style={{ fontSize: '12px', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{c.detail}</span>
                  </div>
                ))}
              </div>
              {result.refs.length > 0 && (
                <p style={{ marginTop: '14px', fontSize: '11px', color: '#64748b', lineHeight: 1.6 }}>
                  <strong style={{ color: '#475569' }}>{t.demoRefs}:</strong> {result.refs.join(' · ')}
                </p>
              )}
              <p style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>{t.demoDisclaimer}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════ 2. 분야 카드 3장 ═══════════════ */
export function EngDomains({ langCode }: { langCode: string }) {
  const t = engDict[toEngLang(langCode)];
  const cards = [
    { title: t.dom1Title, desc: t.dom1Desc, tags: t.dom1Tags, icon: '⚙️', href: `/${langCode}/shape-generator/`, color: '#3b82f6' },
    { title: t.dom2Title, desc: t.dom2Desc, tags: t.dom2Tags, icon: '🏗️', href: '#eng-demo', color: '#8b5cf6' },
    { title: t.dom3Title, desc: t.dom3Desc, tags: t.dom3Tags, icon: '🧱', href: '#eng-demo', color: '#10b981' },
    { title: t.dom4Title, desc: t.dom4Desc, tags: t.dom4Tags, icon: '🏢', href: '#eng-demo', color: '#f59e0b' },
    { title: t.dom5Title, desc: t.dom5Desc, tags: t.dom5Tags, icon: '🌳', href: '#eng-demo', color: '#22c55e' },
  ];
  return (
    <section style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)', padding: '90px 24px' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: '46px' }} className="reveal">
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#60a5fa', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>{t.domKicker}</p>
          <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 36px)', fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.02em', marginBottom: '10px', wordBreak: 'keep-all' }}>{t.domTitle}</h2>
          <p style={{ fontSize: '14px', color: '#94a3b8', maxWidth: '620px', margin: '0 auto', wordBreak: 'keep-all' }}>{t.domSub}</p>
        </header>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          {cards.map((c, i) => (
            <Link key={i} href={c.href} className="reveal" style={{
              background: 'rgba(255,255,255,0.05)', borderRadius: '20px', padding: '30px 26px',
              border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none',
              display: 'flex', flexDirection: 'column', transition: 'transform .2s, background .2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <span style={{ fontSize: '30px' }}>{c.icon}</span>
                <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>● {t.domLive}</span>
              </div>
              <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#f1f5f9', marginBottom: '8px', wordBreak: 'keep-all' }}>{c.title}</h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, flex: 1, marginBottom: '16px', wordBreak: 'keep-all' }}>{c.desc}</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {c.tags.map((tag, j) => (
                  <span key={j} style={{ fontSize: '11px', fontWeight: 600, color: c.color, background: `${c.color}18`, border: `1px solid ${c.color}35`, padding: '3px 10px', borderRadius: '999px' }}>{tag}</span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════ 3. 검증 숫자 + 개발자/API ═══════════════ */
export function EngDev({ langCode }: { langCode: string }) {
  const t = engDict[toEngLang(langCode)];
  const stats = [
    { num: t.ver1Num, label: t.ver1Label }, { num: t.ver2Num, label: t.ver2Label },
    { num: t.ver3Num, label: t.ver3Label }, { num: t.ver4Num, label: t.ver4Label },
  ];
  const curl = `curl -X POST ${ENG_API}/v1/calc/retaining_wall_stability \\
  -H "Authorization: Bearer nxk_..." \\
  -d '{"input":{"H":4,"gammaBackfill":18,"phiBackfill":30,...}}'
# → verdict, checks, KDS clause refs`;
  const mcp = `{ "mcpServers": { "nexyfab-eng": {
    "command": "node",
    "args": ["mcp-server.mjs"]
} } }  // 8 tools: calc ×5 + rag_search + optimize + frame2d`;
  return (
    <section style={{ background: '#f8fafc', padding: '90px 24px' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: '40px' }} className="reveal">
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#3b82f6', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>{t.devKicker}</p>
          <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 36px)', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '10px', wordBreak: 'keep-all' }}>{t.devTitle}</h2>
          <p style={{ fontSize: '15px', color: '#64748b', maxWidth: '620px', margin: '0 auto', wordBreak: 'keep-all' }}>{t.devSub}</p>
        </header>

        {/* 검증 숫자 — 전부 실측 (골든벤치/재현/원문대조/코퍼스) */}
        <div className="reveal" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '40px' }}>
          {stats.map((s, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '22px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 'clamp(26px, 3.5vw, 34px)', fontWeight: 900, color: '#1d4ed8', lineHeight: 1.1, marginBottom: '6px', fontVariantNumeric: 'tabular-nums' }}>{s.num}</div>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, wordBreak: 'keep-all' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* REST + MCP */}
        <div className="reveal" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '28px' }}>
          <div style={{ background: '#0d1117', borderRadius: '16px', padding: '22px', border: '1px solid #1e293b' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#e2e8f0', marginBottom: '12px' }}>⌨️ {t.devCurlTitle}</h3>
            <pre style={{ margin: 0, fontSize: '11px', lineHeight: 1.6, color: '#7dd3fc', overflowX: 'auto', fontFamily: 'ui-monospace, monospace' }}>{curl}</pre>
          </div>
          <div style={{ background: '#0d1117', borderRadius: '16px', padding: '22px', border: '1px solid #1e293b' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#e2e8f0', marginBottom: '12px' }}>🤖 {t.devMcpTitle}</h3>
            <pre style={{ margin: '0 0 10px', fontSize: '11px', lineHeight: 1.6, color: '#86efac', overflowX: 'auto', fontFamily: 'ui-monospace, monospace' }}>{mcp}</pre>
            <p style={{ margin: 0, fontSize: '12px', color: '#8b949e', lineHeight: 1.6, wordBreak: 'keep-all' }}>{t.devMcpDesc}</p>
          </div>
        </div>

        <div className="reveal" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href={`/${langCode}/contact/`} style={{
              display: 'inline-block', padding: '12px 30px', borderRadius: '12px', fontSize: '14px', fontWeight: 800,
              background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', color: '#fff', textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(59,130,246,0.35)',
            }}>{t.devKeyCta} →</Link>
            <Link href={`/${langCode}/nexyfab/pricing/`} style={{
              display: 'inline-block', padding: '12px 30px', borderRadius: '12px', fontSize: '14px', fontWeight: 700,
              background: '#fff', color: '#1d4ed8', border: '2px solid #3b82f6', textDecoration: 'none',
            }}>{t.pricingCta}</Link>
          </div>
          <p style={{ marginTop: '16px', fontSize: '11px', color: '#94a3b8', wordBreak: 'keep-all' }}>{t.devAttribution}</p>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════ 4. FAQ + schema.org ═══════════════ */
export function EngFaq({ langCode }: { langCode: string }) {
  const t = engDict[toEngLang(langCode)];
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: t.faqs.map(f => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  return (
    <section style={{ background: '#fff', padding: '90px 24px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div style={{ maxWidth: '760px', margin: '0 auto' }}>
        <h2 className="reveal" style={{ fontSize: 'clamp(24px, 3.5vw, 34px)', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em', textAlign: 'center', marginBottom: '36px', wordBreak: 'keep-all' }}>{t.faqTitle}</h2>
        <div style={{ display: 'grid', gap: '12px' }}>
          {t.faqs.map((f, i) => (
            <details key={i} className="reveal" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px 22px' }}>
              <summary style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', cursor: 'pointer', wordBreak: 'keep-all' }}>{f.q}</summary>
              <p style={{ marginTop: '12px', fontSize: '14px', color: '#475569', lineHeight: 1.7, wordBreak: 'keep-all' }}>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
