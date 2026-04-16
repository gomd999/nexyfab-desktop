'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { homeDict } from '../homeDict';

// ─── FAQ 아코디언 컴포넌트 ─────────────────────────────────────────────

interface FaqItem {
  q: string;
  a: string;
}

function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {items.map((item, idx) => {
        const isOpen = openIdx === idx;
        return (
          <div
            key={idx}
            style={{
              border: `1.5px solid ${isOpen ? '#0b5cff' : '#e2e8f0'}`,
              borderRadius: '14px',
              background: isOpen ? '#f0f5ff' : '#fff',
              overflow: 'hidden',
              transition: 'border-color 0.2s, background 0.2s',
            }}
          >
            <button
              onClick={() => setOpenIdx(isOpen ? null : idx)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                gap: '12px',
              }}
            >
              <span style={{ fontSize: '15px', fontWeight: 600, color: isOpen ? '#0b5cff' : '#1A1F36' }}>
                Q. {item.q}
              </span>
              <span style={{
                fontSize: '18px',
                color: isOpen ? '#0b5cff' : '#94a3b8',
                transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                flexShrink: 0,
              }}>
                +
              </span>
            </button>
            {isOpen && (
              <div style={{
                padding: '0 20px 16px',
                fontSize: '14px',
                color: '#475569',
                lineHeight: 1.7,
                borderTop: '1px solid #dbeafe',
                marginTop: '0',
              }}>
                A. {item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 3단계 인터랙티브 가이드 컴포넌트 ──────────────────────────────────

interface GuideStep {
  icon: string;
  title: string;
  desc: string;
  ctaLabel: string;
  ctaHref: string;
  customContent?: React.ReactNode;
}

function InteractiveGuide({ steps, langCode }: { steps: GuideStep[]; langCode: string }) {
  const [activeStep, setActiveStep] = useState(0);
  const step = steps[activeStep];

  return (
    <div style={{
      background: '#fff',
      border: '1.5px solid #e2e8f0',
      borderRadius: '20px',
      overflow: 'hidden',
    }}>
      {/* 탭 헤더 */}
      <div style={{ display: 'flex', borderBottom: '1.5px solid #e2e8f0' }}>
        {steps.map((s, idx) => {
          const isActive = idx === activeStep;
          return (
            <button
              key={idx}
              onClick={() => setActiveStep(idx)}
              style={{
                flex: 1,
                padding: '14px 8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                background: isActive ? '#eff6ff' : 'transparent',
                border: 'none',
                borderBottom: isActive ? '2.5px solid #0b5cff' : '2.5px solid transparent',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '20px' }}>{s.icon}</span>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                color: isActive ? '#0b5cff' : '#94a3b8',
                whiteSpace: 'nowrap',
              }}>
                Step {idx + 1}
              </span>
            </button>
          );
        })}
      </div>

      {/* 콘텐츠 */}
      <div style={{ padding: '32px 28px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>{step.icon}</div>
        <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A1F36', marginBottom: '10px' }}>
          {step.title}
        </h3>
        {step.customContent ? (
          <div style={{ marginTop: '16px' }}>{step.customContent}</div>
        ) : (
          <>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.75, marginBottom: '24px', maxWidth: '380px', margin: '0 auto 24px' }}>
              {step.desc}
            </p>
            <a
              href={step.ctaHref.replace('[lang]', langCode)}
              style={{
                display: 'inline-block',
                padding: '12px 28px',
                background: '#0b5cff',
                color: '#fff',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '14px',
                textDecoration: 'none',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#053fb0')}
              onMouseLeave={e => (e.currentTarget.style.background = '#0b5cff')}
            >
              {step.ctaLabel} →
            </a>
          </>
        )}
      </div>

      {/* 진행 점 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '0 0 20px' }}>
        {steps.map((_, idx) => (
          <button
            key={idx}
            onClick={() => setActiveStep(idx)}
            style={{
              width: idx === activeStep ? '24px' : '8px',
              height: '8px',
              borderRadius: '4px',
              background: idx === activeStep ? '#0b5cff' : '#cbd5e1',
              border: 'none',
              cursor: 'pointer',
              transition: 'width 0.3s, background 0.2s',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── 임베디드 검색 위젯 ────────────────────────────────────────────────────────

function EmbeddedSearch({ langCode }: { langCode: string }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; industry: string; score: number }> | null>(null);
  const [error, setError] = useState('');

  const placeholder = langCode === 'ko' || langCode === 'kr' ? '예: 배터리 자동화 설비'
    : langCode === 'ja' ? '例: バッテリー自動化設備'
    : langCode === 'cn' ? '例: 电池自动化设备'
    : langCode === 'es' ? 'Ej: equipos de automatización'
    : langCode === 'ar' ? 'مثال: معدات أتمتة البطاريات'
    : 'e.g. battery automation equipment';

  const btnLabel = langCode === 'ko' || langCode === 'kr' ? '검색'
    : langCode === 'ja' ? '検索'
    : langCode === 'cn' ? '搜索'
    : langCode === 'es' ? 'Buscar'
    : langCode === 'ar' ? 'بحث'
    : 'Search';

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) throw new Error('search failed');
      const data = await res.json();
      const allResults = [...(data.ko || []), ...(data.cn || [])].slice(0, 5);
      setResults(allResults);
    } catch {
      setError(langCode === 'ko' || langCode === 'kr' ? '검색 중 오류가 발생했습니다.' : 'Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '440px', margin: '0 auto', textAlign: 'left' }}>
      <form
        onSubmit={e => { e.preventDefault(); handleSearch(); }}
        style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}
      >
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1, padding: '12px 16px', borderRadius: '10px',
            border: '1.5px solid #e2e8f0', fontSize: '14px',
            outline: 'none', background: '#f8fafc',
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 20px', borderRadius: '10px',
            background: loading ? '#93c5fd' : '#0b5cff',
            color: '#fff', border: 'none', fontWeight: 700,
            fontSize: '14px', cursor: loading ? 'default' : 'pointer',
            whiteSpace: 'nowrap', transition: 'background 0.2s',
          }}
        >
          {loading ? '...' : btnLabel}
        </button>
      </form>

      {error && (
        <p style={{ fontSize: '13px', color: '#ef4444', margin: '0 0 8px' }}>{error}</p>
      )}

      {results && results.length === 0 && (
        <p style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center', margin: '12px 0' }}>
          {langCode === 'ko' || langCode === 'kr' ? '검색 결과가 없습니다.' : 'No results found.'}
        </p>
      )}

      {results && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {results.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderRadius: '10px',
              background: '#f0f5ff', border: '1px solid #dbeafe',
            }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A1F36' }}>{r.name || '—'}</div>
                {r.industry && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{r.industry}</div>}
              </div>
              {r.score != null && (
                <div style={{
                  fontSize: '13px', fontWeight: 800, color: '#0b5cff',
                  background: '#eff6ff', padding: '4px 10px', borderRadius: '20px',
                }}>
                  {r.score}%
                </div>
              )}
            </div>
          ))}
          <a
            href={`/${langCode}/project-inquiry/`}
            style={{
              display: 'block', textAlign: 'center', marginTop: '8px',
              padding: '10px', borderRadius: '10px',
              background: '#0b5cff', color: '#fff',
              fontSize: '13px', fontWeight: 700, textDecoration: 'none',
            }}
          >
            {langCode === 'ko' || langCode === 'kr' ? '전체 결과 및 문의하기 →'
              : langCode === 'ja' ? '全結果・お問い合わせ →'
              : langCode === 'cn' ? '查看全部并咨询 →'
              : 'View all & Inquire →'}
          </a>
        </div>
      )}
    </div>
  );
}

export default function HowItWorksPage() {
    const pathname = usePathname();
    const langCode = pathname?.split('/')[1] || 'en';
    const validLangs = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
    const lang = validLangs.includes(langCode) ? langCode : 'en';

    const langMap: Record<string, keyof typeof homeDict> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
    const d = homeDict[langMap[lang]];
    const t = d.howPage;

    useEffect(() => {
        const observerOptions = {
            threshold: 0.1
        };

        let observer: IntersectionObserver;
        const raf = requestAnimationFrame(() => {
          observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                entry.target.classList.add('active');
              }
            });
          }, observerOptions);
          document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
        });

        return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
    }, []);

    return (
        <main id="Nexyfab-how-it-works">
            {/* HERO */}
            <section className="hat-how-hero">
                <p className="hat-kicker reveal" dangerouslySetInnerHTML={{ __html: d.howKicker }} />
                <h1 className="hat-title reveal" dangerouslySetInnerHTML={{ __html: t.heroTitle }} />
                <p className="hat-sub reveal" dangerouslySetInnerHTML={{ __html: t.heroSub }} />
            </section>

            {/* WORKFLOW DIAGRAM */}
            <section className="hat-inner reveal" style={{ marginTop: '40px' }}>
                <div className="hat-workflow-diagram-wrap">
                    <div className="hat-diagram-header">
                        <h2 className="hat-title" style={{ fontSize: '24px' }}>{t.diagramTitle}</h2>
                    </div>
                    {/* SVG Diagram Placeholder */}
                    {/* Desktop SVG Diagram (Hidden on Mobile) */}
                    <div className="hat-diagram-box desktop-only">
                        <svg viewBox="0 0 810 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="hat-workflow-svg">
                            <rect x="10" y="50" width="220" height="100" rx="20" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="2" />
                            <text x="120" y="98" textAnchor="middle" fill="#1A1F36" fontWeight="800" fontSize="14">{t.diagramStep1}</text>
                            <text x="120" y="118" textAnchor="middle" fill="#64748b" fontWeight="500" fontSize="12">{t.diagramStep1Sub}</text>

                            <path d="M230 100 H280" stroke="#0B5CFF" strokeWidth="3" strokeDasharray="6 4">
                                <animate attributeName="stroke-dashoffset" values="40;0" dur="2s" repeatCount="indefinite" />
                            </path>
                            <circle cx="285" cy="100" r="4" fill="#0B5CFF" />

                            <rect x="295" y="50" width="220" height="100" rx="20" fill="url(#blue-grad)" stroke="#0B5CFF" strokeWidth="2">
                                <animate attributeName="rx" values="20;25;20" dur="3s" repeatCount="indefinite" />
                            </rect>
                            <text x="405" y="98" textAnchor="middle" fill="#FFFFFF" fontWeight="800" fontSize="14">{t.diagramStep2}</text>
                            <text x="405" y="118" textAnchor="middle" fill="#E2E8F0" fontWeight="500" fontSize="12">{t.diagramStep2Sub}</text>

                            <path d="M515 100 H565" stroke="#0B5CFF" strokeWidth="3" strokeDasharray="6 4">
                                <animate attributeName="stroke-dashoffset" values="40;0" dur="2s" repeatCount="indefinite" />
                            </path>
                            <circle cx="570" cy="100" r="4" fill="#0B5CFF" />

                            <rect x="580" y="50" width="220" height="100" rx="20" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="2" />
                            <text x="690" y="98" textAnchor="middle" fill="#1A1F36" fontWeight="800" fontSize="14">{t.diagramStep3}</text>
                            <text x="690" y="118" textAnchor="middle" fill="#64748b" fontWeight="500" fontSize="12">{t.diagramStep3Sub}</text>

                            <defs>
                                <linearGradient id="blue-grad" x1="0" y1="0" x2="1" y2="1">
                                    <stop offset="0%" stopColor="#0B5CFF" />
                                    <stop offset="100%" stopColor="#053fb0" />
                                </linearGradient>
                            </defs>
                        </svg>
                    </div>

                    {/* Mobile Vertical Diagram (Shown on Mobile) */}
                    <div className="hat-diagram-mobile mobile-only">
                        <div className="hat-mobile-step">
                            <div className="hat-ms-card">
                                <strong>{t.diagramStep1}</strong>
                                <span>{t.diagramStep1Sub}</span>
                            </div>
                            <div className="hat-ms-arrow">
                                <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
                                    <path d="M1 0V30" stroke="#0B5CFF" strokeWidth="2" strokeDasharray="4 3" />
                                </svg>
                            </div>
                        </div>

                        <div className="hat-mobile-step">
                            <div className="hat-ms-card highlight">
                                <strong>{t.diagramStep2}</strong>
                                <span>{t.diagramStep2Sub}</span>
                            </div>
                            <div className="hat-ms-arrow">
                                <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
                                    <path d="M1 0V30" stroke="#0B5CFF" strokeWidth="2" strokeDasharray="4 3" />
                                </svg>
                            </div>
                        </div>

                        <div className="hat-mobile-step">
                            <div className="hat-ms-card">
                                <strong>{t.diagramStep3}</strong>
                                <span>{t.diagramStep3Sub}</span>
                            </div>
                        </div>
                    </div>

                </div>
            </section>

            {/* ROADMAP */}
            <section className="hat-inner">
                <div className="hat-roadmap">
                    {/* STEP 1 */}
                    <div id="step-1" className="hat-step-card reveal" style={{ scrollMarginTop: '100px' }}>
                        <span className="hat-step-tag">{t.step1Tag}</span>
                        <div className="hat-step-icon">
                            <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                                <path d="M10 7v3m0 0v3m0-3h3m-3 0H7"></path>
                            </svg>
                        </div>
                        <h2 className="hat-step-title">{t.step1Title}</h2>
                        <p className="hat-step-desc" dangerouslySetInnerHTML={{ __html: t.step1Desc }} />
                    </div>

                    {/* STEP 2 */}
                    <div id="step-2" className="hat-step-card reveal" style={{ transitionDelay: '0.1s', scrollMarginTop: '100px' }}>
                        <span className="hat-step-tag">{t.step2Tag}</span>
                        <div className="hat-step-icon">
                            <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                        </div>
                        <h2 className="hat-step-title">{t.step2Title}</h2>
                        <p className="hat-step-desc" dangerouslySetInnerHTML={{ __html: t.step2Desc }} />
                    </div>

                    {/* STEP 3 */}
                    <div id="step-3" className="hat-step-card reveal" style={{ transitionDelay: '0.2s', scrollMarginTop: '100px' }}>
                        <span className="hat-step-tag">{t.step3Tag}</span>
                        <div className="hat-step-icon">
                            <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                            </svg>
                        </div>
                        <h2 className="hat-step-title">{t.step3Title}</h2>
                        <p className="hat-step-desc" dangerouslySetInnerHTML={{ __html: t.step3Desc }} />
                    </div>
                </div>
            </section>

            {/* WHY US */}
            <section className="hat-why-us reveal">
                <div className="hat-inner">
                    <h2 className="hat-title" style={{ fontSize: '32px', textAlign: 'center' }}>{t.whyTitle}</h2>
                    <div className="hat-why-grid">
                        <div className="hat-why-card">
                            <div className="hat-why-icon">
                                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path d="M9.663 17h4.674a1 1 0 00.995-.858l.63-4.2a1 1 0 00-.995-1.142H8.328a1 1 0 00-.995 1.142l.63 4.2a1 1 0 00.995.858z"></path>
                                    <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707"></path>
                                </svg>
                            </div>
                            <div className="hat-why-content">
                                <h3>{t.why1Title}</h3>
                                <p>{t.why1Desc}</p>
                            </div>
                        </div>
                        <div className="hat-why-card">
                            <div className="hat-why-icon">
                                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                                </svg>
                            </div>
                            <div className="hat-why-content">
                                <h3>{t.why2Title}</h3>
                                <p>{t.why2Desc}</p>
                            </div>
                        </div>
                        <div className="hat-why-card">
                            <div className="hat-why-icon">
                                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                                </svg>
                            </div>
                            <div className="hat-why-content">
                                <h3>{t.why3Title}</h3>
                                <p dangerouslySetInnerHTML={{ __html: t.why3Desc }}></p>
                            </div>
                        </div>
                        <div className="hat-why-card">
                            <div className="hat-why-icon">
                                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                                </svg>
                            </div>
                            <div className="hat-why-content">
                                <h3>{t.why4Title}</h3>
                                <p dangerouslySetInnerHTML={{ __html: t.why4Desc }}></p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* NEW PAGE: REVENUE MODEL */}
            <section id="Nexyfab-revenue-v1">
                <div className="hat-bg" aria-hidden="true"></div>
                <div className="hat-wrap">
                    <header className="hat-head reveal">
                        <p className="hat-kicker">{d.revenueKicker}</p>
                        <h2 className="hat-title">{d.revenueTitle}</h2>
                        <p className="hat-sub">{d.revenueSub}</p>
                    </header>

                    {/* Timeline Visual Flow */}
                    <div className="hat-revenue-flow reveal">
                        <div className="hat-flow-item">
                            <div className="hat-flow-box">{d.revenueFlow1}</div>
                        </div>
                        <div className="hat-flow-arrow">
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path d="M13 7l5 5-5 5M6 7l5 5-5 5"></path>
                            </svg>
                        </div>
                        <div className="hat-flow-item">
                            <div className="hat-flow-box">{d.revenueFlow2}</div>
                        </div>
                        <div className="hat-flow-arrow">
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path d="M13 7l5 5-5 5M6 7l5 5-5 5"></path>
                            </svg>
                        </div>
                        <div className="hat-flow-item highlight">
                            <div className="hat-flow-box">{d.revenueFlow3}</div>
                            <div className="hat-flow-badge">BENEFIT</div>
                        </div>
                    </div>

                    <div className="hat-grid">
                        <article className="hat-card">
                            <div className="hat-card-step">STEP 01</div>
                            <div className="hat-card-icon">
                                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                                </svg>
                            </div>
                            <h3 className="hat-card-title">{d.revenueStep1Title}</h3>
                            <div className="hat-card-price">{d.revenueStep1Price}</div>
                            <div className="hat-card-value">{d.revenueStep1Value}</div>
                            <p className="hat-card-desc">{d.revenueStep1Desc}</p>
                        </article>

                        <article className="hat-card">
                            <div className="hat-card-step">STEP 02</div>
                            <div className="hat-card-icon" style={{ background: '#eff6ff', color: '#3b82f6', borderColor: 'rgba(59, 130, 246, 0.1)' }}>
                                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                                </svg>
                            </div>
                            <h3 className="hat-card-title">{d.revenueStep2Title}</h3>
                            <div className="hat-card-price">{d.revenueStep2Rate}</div>
                            <div className="hat-card-value">{d.revenueStep2Value}</div>
                            <p className="hat-card-desc">{d.revenueStep2Desc}</p>
                        </article>

                        <article className="hat-card">
                            <div className="hat-card-step" style={{ background: '#ecfdf5', color: '#10b981' }}>STEP 03</div>
                            <div className="hat-card-icon" style={{ background: '#ecfdf5', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.1)' }}>
                                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.407 2.67 1M12 8V7m0 1c-1.11 0-2.08.407-2.67 1M12 8V7m0 11c1.657 0 3-.895 3-2s-1.343-2-3-2-3-.895-3-2 1.343-2 3-2m0 8c1.11 0 2.08.407 2.67 1M12 18v1m0-1c-1.11 0-2.08-.407-2.67-1M12 18v1"></path>
                                </svg>
                            </div>
                            <h3 className="hat-card-title">{d.revenueStep3Title}</h3>
                            <div className="hat-card-price">{d.revenueStep3Reward}</div>
                            <div className="hat-card-value">{d.revenueStep3Value}</div>
                            <p className="hat-card-desc">{d.revenueStep3Desc}</p>
                        </article>
                    </div>

                    <div className="hat-footer-notes reveal">
                        {d.revenueFooterNote1 && (
                            <div className="hat-note-item">
                                <span>•</span>
                                <p>{d.revenueFooterNote1}</p>
                            </div>
                        )}
                        {d.revenueFooterNote2 && (
                            <div className="hat-note-item">
                                <span>•</span>
                                <p>{d.revenueFooterNote2}</p>
                            </div>
                        )}
                        <div className="hat-note-item">
                            <span>•</span>
                            <p>{d.revenueFooterNote3}</p>
                        </div>
                        {d.revenueFooterNote4 && (
                            <div className="hat-note-item">
                                <span>•</span>
                                <p>{d.revenueFooterNote4}</p>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* ─── 3단계 인터랙티브 온보딩 가이드 ─── */}
            <section className="reveal hat-inner" style={{ marginTop: '60px', marginBottom: '0' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: '#0b5cff', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px' }}>
                        QUICK START GUIDE
                    </p>
                    <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#1A1F36', marginBottom: '10px' }}>
                        3단계로 시작하는 Nexyfab
                    </h2>
                    <p style={{ fontSize: '14px', color: '#64748b' }}>
                        검색부터 납품까지, 전 과정을 함께합니다.
                    </p>
                </div>
                <InteractiveGuide
                    langCode={langCode}
                    steps={[
                        {
                            icon: '🔍',
                            title: '키워드 검색으로 파트너 탐색',
                            desc: '제품 키워드를 입력하면 30만 한·중 공장 DB에서 관련 제조사를 바로 검색합니다. 검색은 무료이며 몇 초 안에 결과를 확인할 수 있습니다.',
                            ctaLabel: '키워드 검색',
                            ctaHref: '/[lang]/',
                            customContent: <EmbeddedSearch langCode={langCode} />,
                        },
                        {
                            icon: '🏭',
                            title: '매칭 신청 및 기술 검토',
                            desc: '적합한 파트너가 있다면 매칭을 신청하세요. 전문가가 기술 검토를 통해 최적 파트너를 선별합니다. 적합한 파트너를 찾지 못하면 신청금을 환불해 드립니다.',
                            ctaLabel: '프로젝트 문의',
                            ctaHref: '/[lang]/project-inquiry/',
                        },
                        {
                            icon: '📋',
                            title: '계약 체결부터 납품까지',
                            desc: '계약 체결 후 전담 오퍼레이터가 일정 관리, 품질 확인, 이슈 대응 등 납품 완료까지 파트너사와 함께 도움을 드립니다.',
                            ctaLabel: '이용 방법 문의',
                            ctaHref: '/[lang]/project-inquiry/',
                        },
                    ]}
                />
            </section>

            {/* ─── FAQ 아코디언 ─── */}
            <section className="reveal hat-inner" style={{ marginTop: '60px', marginBottom: '0' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: '#0b5cff', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px' }}>
                        FAQ
                    </p>
                    <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#1A1F36', marginBottom: '10px' }}>
                        자주 묻는 질문
                    </h2>
                </div>
                <FaqAccordion items={[
                    {
                        q: '키워드 검색은 무료인가요?',
                        a: '네, 키워드 검색과 AI 파트너 추천은 무료입니다. 검색 결과를 확인하신 후, 실제 매칭을 원하실 때 매칭 신청금(50만 원, VAT 별도)이 발생합니다.',
                    },
                    {
                        q: '매칭 신청금은 어떻게 되나요?',
                        a: '매칭 신청금은 50만 원(VAT 별도)이며, 전문 기술 검토 및 파트너 선별 비용입니다. 적합한 파트너를 찾지 못할 경우 전액 환불해 드립니다.',
                    },
                    {
                        q: '수수료는 얼마인가요?',
                        a: '계약 체결 시 계약금 규모에 따라 4~7%의 수수료가 적용됩니다. 매칭 신청금(50만 원)은 수수료에서 100% 공제되므로 추가 부담 없이 시작하실 수 있습니다.',
                    },
                    {
                        q: '매칭에 얼마나 걸리나요?',
                        a: '매칭 신청 후 영업일 기준 3~5일 이내에 적합 파트너 후보를 선별하여 안내드립니다. 프로젝트 특성에 따라 다소 차이가 있을 수 있습니다.',
                    },
                    {
                        q: '계약 후에도 지원을 받을 수 있나요?',
                        a: '네, 계약 체결 이후에도 전담 오퍼레이터가 일정 관리, 품질 확인, 이슈 대응 등 납품 완료까지 파트너사와 함께 도움을 드립니다.',
                    },
                ]} />
            </section>

            {/* STATS + CTA unified section */}
            <section className="reveal" id="Nexyfab-how-cta" style={{
                textAlign: 'center',
                padding: '80px 24px 100px',
            }}>
                {/* Stats */}
                <h2 className="hat-title" style={{ fontSize: '28px', marginBottom: '10px' }}>{t.statsTitle}</h2>
                <p style={{ fontSize: '15px', color: '#64748b', marginBottom: '40px' }}>{t.statsSub}</p>
                <div className="hat-stats-grid" style={{ marginBottom: '48px' }}>
                    <div className="hat-stat-item">
                        <span className="hat-stat-number">{t.statsFactories}</span>
                        <span className="hat-stat-label">{t.statsFactoriesLabel}</span>
                    </div>
                </div>

                {/* Divider */}
                <div style={{ width: '48px', height: '2px', background: '#0b5cff22', margin: '0 auto 44px' }} />

                {/* CTA */}
                <h2 style={{ fontSize: '26px', fontWeight: 700, marginBottom: '14px', color: '#1A1F36' }} dangerouslySetInnerHTML={{ __html: d.ctaTitle }} />
                <p style={{ fontSize: '15px', color: '#64748b', marginBottom: '32px', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: d.ctaSub }} />
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <a
                        href={`/${langCode}/project-inquiry/`}
                        className="hat-btn-primary"
                        style={{ padding: '14px 32px', fontSize: '15px', fontWeight: 600, minWidth: '160px', textAlign: 'center' }}
                    >{d.ctaBtn1}</a>
                    <a
                        href={`/${langCode}#nexyfab-ui`}
                        className="hat-btn-primary"
                        style={{ padding: '14px 32px', fontSize: '15px', fontWeight: 600, minWidth: '160px', textAlign: 'center', background: '#fff', color: '#0b5cff', border: '2px solid #0b5cff' }}
                    >{d.ctaBtn2}</a>
                </div>
            </section>
        </main>
    );
}
