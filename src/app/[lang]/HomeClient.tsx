'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { richText } from '@/lib/richText';
import type { homeDict } from './homeDict';
import { useSwipe } from '@/hooks/useSwipe';
import { EngDomains, EngDev, EngFaq } from './EngVertical';
import ChatHero from './ChatHero';
import { LineIcon } from './_lineIcons';

interface SiteStats {
  factoryCount: string;
  factoryQualifier: string;
}

export default function Home({ dict, langCode, siteStats }: {
  dict: (typeof homeDict)[keyof typeof homeDict];
  langCode: string;
  siteStats?: SiteStats;
}) {
  const router = useRouter();
  const validLangs = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
  const lang = validLangs.includes(langCode) ? langCode : 'en';
  const t = dict;
const [featTab, setFeatTab] = useState<'design' | 'analysis' | 'mfg'>('design');
  const FEAT_TABS: Array<'design' | 'analysis' | 'mfg'> = ['design', 'analysis', 'mfg'];
  const featSwipe = useSwipe(useCallback((dir) => {
    const idx = FEAT_TABS.indexOf(featTab);
    if (dir === 'left' && idx < FEAT_TABS.length - 1) setFeatTab(FEAT_TABS[idx + 1]);
    if (dir === 'right' && idx > 0) setFeatTab(FEAT_TABS[idx - 1]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featTab]));
  const [showOnboarding, setShowOnboarding] = useState(false);

  React.useEffect(() => {
    if (!localStorage.getItem('nf_onboarding_done')) {
      setShowOnboarding(true);
    }
  }, []);

  React.useEffect(() => {
    let observer: IntersectionObserver;
    const raf = requestAnimationFrame(() => {
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          // Reveal ONCE and stop observing. The previous version removed `active`
          // whenever an element scrolled out of view, so on a phone — where each
          // 1-column section fills the short viewport — almost everything reverted
          // to opacity:0 the moment you scrolled past it, making the page look
          // mostly blank. A one-time reveal keeps content visible.
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
      document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
    });
    // Safety net: if the observer never runs (very old browser / JS race), reveal
    // everything after a short delay so content is never permanently hidden.
    const fallback = setTimeout(() => {
      document.querySelectorAll('.reveal:not(.active)').forEach(el => el.classList.add('active'));
    }, 2500);
    return () => { cancelAnimationFrame(raf); clearTimeout(fallback); observer?.disconnect(); };
  }, []);

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem('nf_onboarding_done', '1');
  };

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Onboarding overlay — first visit only */}
      {showOnboarding && (
        <div className="nf-onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <div className="nf-onboarding-modal">
            <div aria-hidden="true" style={{ color: '#60a5fa', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><LineIcon name="rocket" size={40} /></div>
            <h2 id="onboarding-title" style={{ color: '#e6edf3', fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>
              {t.onboardingTitle}
            </h2>
            <p style={{ color: '#8b949e', fontSize: 13, margin: '0 0 28px' }}>
              {t.onboardingSub}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { iconName: 'palette' as const, label: t.onboardingPath1, desc: t.onboardingPath1Desc, action: () => { dismissOnboarding(); document.getElementById('nf-chat')?.scrollIntoView({ behavior: 'smooth' }); } },
                { iconName: 'factory' as const, label: t.onboardingPath2, desc: t.onboardingPath2Desc, action: () => { dismissOnboarding(); router.push(`/${langCode}/project-inquiry/`); } },
                { iconName: 'search' as const, label: t.onboardingPath3, desc: t.onboardingPath3Desc, action: () => { dismissOnboarding(); router.push(`/${langCode}/factories/`); } },
              ].map((path, i) => (
                <button key={i} onClick={path.action} className="nf-onboarding-path-btn">
                  <span aria-hidden="true" style={{ color: '#60a5fa', display: 'inline-flex' }}><LineIcon name={path.iconName} size={26} /></span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{path.label}</div>
                    <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{path.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={dismissOnboarding} style={{
              marginTop: 20, background: 'none', border: 'none',
              color: '#6e7681', fontSize: 12, cursor: 'pointer',
              textDecoration: 'underline',
            }}>
              {t.onboardingSkip}
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* PAGE 0: PLATFORM HERO — Design to Manufacturing */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* CHAT-FIRST HERO — 채팅 입력 + 분야 칩 (기존 히어로는 HomeClient_legacy.tsx 백업) */}
      <ChatHero langCode={langCode} />

      <EngDomains langCode={langCode} />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* WORKFLOW — 5 Steps (with Feature hints) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section style={{ background: '#f8fafc', padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.5, backgroundImage: 'radial-gradient(rgba(59,130,246,0.08) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
        <div style={{ maxWidth: '1100px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <header style={{ textAlign: 'center', marginBottom: '60px' }} className="reveal">
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#3b82f6', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>{t.wfKicker}</p>
            <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 40px)', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '12px' }}>{t.wfTitle}</h2>
            <p style={{ fontSize: '16px', color: '#64748b' }}>{t.wfSub}</p>
          </header>

          <div className="nf-workflow-steps" style={{ display: 'flex', gap: '0', justifyContent: 'center', flexWrap: 'wrap', position: 'relative' }}>
            {[
              { num: '01', title: t.wf1Title, desc: t.wf1Desc, hint: t.wf1Hint, iconName: 'palette' as const, color: '#3b82f6' },
              { num: '02', title: t.wf2Title, desc: t.wf2Desc, hint: t.wf2Hint, iconName: 'microscope' as const, color: '#8b5cf6' },
              { num: '03', title: t.wf3Title, desc: t.wf3Desc, hint: t.wf3Hint, iconName: 'dna' as const, color: '#06b6d4' },
              { num: '04', title: t.wf4Title, desc: t.wf4Desc, hint: t.wf4Hint, iconName: 'money' as const, color: '#f59e0b' },
              { num: '05', title: t.wf5Title, desc: t.wf5Desc, hint: t.wf5Hint, iconName: 'factory' as const, color: '#10b981' },
            ].map((step, i) => (
              <div key={i} className="reveal nf-workflow-step" style={{ flex: '1 1 180px', maxWidth: '220px', textAlign: 'center', padding: '20px 12px', position: 'relative' }}>
                {i < 4 && <div style={{ position: 'absolute', top: '38px', right: '-16px', width: '32px', height: '2px', background: 'rgba(59,130,246,0.25)' }} className="desktop-only" />}
                <div style={{
                  width: '56px', height: '56px', borderRadius: '16px', margin: '0 auto 16px',
                  background: `${step.color}20`, border: `2px solid ${step.color}40`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px',
                }}><span style={{ color: step.color, display: 'inline-flex' }}><LineIcon name={step.iconName} size={26} /></span></div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: step.color, marginBottom: '6px' }}>{step.num}</div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>{step.title}</h3>
                <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.5, marginBottom: '8px' }}>{step.desc}</p>
                <p style={{ fontSize: '10px', color: `${step.color}99`, lineHeight: 1.4, fontWeight: 600, letterSpacing: '0.01em' }}>{step.hint}</p>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* WHY NEXYFAB */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="Nexyfab-why-v3">
        <div className="hat-bg" aria-hidden="true"></div>
        <div className="hat-wrap">
          {/* Social Proof Badges */}
          <div className="reveal" style={{ display: 'flex', justifyContent: 'center', gap: '40px', flexWrap: 'wrap', marginBottom: '48px', paddingTop: '20px' }}>
            {[
              // Prefer the admin-set factoryCount over the dict's hardcoded
              // "300,000+" so the marketing number stays defensible — see
              // memory: feedback_landing_no_mock.md.
              { num: siteStats?.factoryCount ?? t.socialStat1, label: t.socialStat1Label },
              { num: t.socialStat2, label: t.socialStat2Label },
              { num: t.socialStat3, label: t.socialStat3Label },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: 'center', minWidth: '120px' }}>
                <div style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 900, color: '#0b5cff', lineHeight: 1.1, marginBottom: '4px' }}>{s.num}</div>
                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <header className="hat-head reveal">
            <p className="hat-kicker">{t.whyKicker}</p>
            <h2 className="hat-title">{t.whyTitle}</h2>
            <p className="hat-sub">{t.whySub}</p>
          </header>
          <div className="hat-grid">
            {[
              { iconName: 'check' as const, title: t.why1Title, desc: t.why1Desc },
              { iconName: 'brain' as const, title: t.why2Title, desc: t.why2Desc },
              { iconName: 'lock' as const, title: t.why3Title, desc: t.why3Desc },
              { iconName: 'bolt' as const, title: t.why4Title, desc: t.why4Desc },
            ].map((w, i) => (
              <article key={i} className="hat-card reveal">
                <div className="hat-ic" aria-hidden="true"><LineIcon name={w.iconName} size={24} /></div>
                <div className="hat-body">
                  <h3 className="hat-card-title">{w.title}</h3>
                  <p className="hat-card-desc">{w.desc}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="hat-cta-center reveal">
            <div className="hat-cta-title">{t.whyCtaTitle}</div>
            <Link prefetch className="hat-cta-btn" href={`/${langCode}/project-inquiry/`}>{t.whyCtaBtn}</Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* FEATURES — Tabbed Compact */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section style={{ background: '#f8fafc', padding: '90px 24px' }}>
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
          <header style={{ textAlign: 'center', marginBottom: '40px' }} className="reveal">
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#3b82f6', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>{t.featKicker}</p>
            <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 36px)', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>{t.featTitle}</h2>
            <p style={{ fontSize: '16px', color: '#64748b', marginTop: '12px', maxWidth: '600px', margin: '12px auto 0' }}>{t.featSub}</p>
          </header>

          {/* Tab Buttons */}
          <div className="reveal nf-feat-tabs" style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '36px' }}>
            {([
              { key: 'design' as const, label: t.featTabDesign, iconName: 'palette' as const },
              { key: 'analysis' as const, label: t.featTabAnalysis, iconName: 'chart' as const },
              { key: 'mfg' as const, label: t.featTabMfg, iconName: 'factory' as const },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setFeatTab(tab.key)}
                style={{
                  padding: '10px 24px',
                  fontSize: '14px',
                  fontWeight: featTab === tab.key ? 700 : 500,
                  border: featTab === tab.key ? '2px solid #3b82f6' : '2px solid #e2e8f0',
                  borderRadius: '999px',
                  background: featTab === tab.key ? '#eff6ff' : '#fff',
                  color: featTab === tab.key ? '#1d4ed8' : '#64748b',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><LineIcon name={tab.iconName} size={16} />{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content — 2 cards per tab; horizontal swipe cycles tabs on mobile */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }} className="reveal" {...featSwipe}>
            {featTab === 'design' && <>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#3b82f6', marginBottom: '12px' }}><LineIcon name="cube" size={28} /></div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat1Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat1Desc}</p>
              </div>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#3b82f6', marginBottom: '12px' }}><LineIcon name="dna" size={28} /></div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat3Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat3Desc}</p>
              </div>
            </>}
            {featTab === 'analysis' && <>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#3b82f6', marginBottom: '12px' }}><LineIcon name="ruler" size={28} /></div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat2Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat2Desc}</p>
              </div>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#3b82f6', marginBottom: '12px' }}><LineIcon name="thermometer" size={28} /></div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat4Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat4Desc}</p>
              </div>
            </>}
            {featTab === 'mfg' && <>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#3b82f6', marginBottom: '12px' }}><LineIcon name="shield" size={28} /></div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat5Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat5Desc}</p>
              </div>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#3b82f6', marginBottom: '12px' }}><LineIcon name="clipboard" size={28} /></div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat6Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat6Desc}</p>
              </div>
            </>}
          </div>

          {/* 하단 CTA 제거 — 히어로 platformCta1과 중복 (DeepSeek 검토: CTA 난립) */}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* USE CASES */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section id="Nexyfab-usecases" className="hat-usecases">
        <div className="hat-bg" aria-hidden="true"></div>
        <div className="hat-wrap">
          <header className="hat-head reveal">
            <p className="hat-kicker">{t.caseKicker}</p>
            <h2 className="hat-title">{t.caseTitle}</h2>
            <p className="hat-sub">{richText(t.caseSub)}</p>
          </header>
          <div className="hat-grid" role="list">
            {[
              { iconName: 'factory' as const, title: t.case1Title, desc: t.case1Desc, tags: [t.case1Tag1, t.case1Tag2, t.case1Tag3], pills: [t.case1Pill1, t.case1Pill2] },
              { iconName: 'puzzle' as const, title: t.case2Title, desc: t.case2Desc, tags: [t.case2Tag1, t.case2Tag2, t.case2Tag3], pills: [t.case2Pill1, t.case2Pill2] },
              { iconName: 'flask' as const, title: t.case3Title, desc: t.case3Desc, tags: [t.case3Tag1, t.case3Tag2, t.case3Tag3], pills: [t.case3Pill1, t.case3Pill2] },
              { iconName: 'crane' as const, title: t.case4Title, desc: t.case4Desc, tags: [t.case4Tag1, t.case4Tag2, t.case4Tag3], pills: [t.case4Pill1, t.case4Pill2] },
            ].map((c, i) => (
              <article key={i} className="hat-case reveal" role="listitem">
                <div className="hat-case-top">
                  <div className="hat-case-ic" aria-hidden="true"><LineIcon name={c.iconName} size={24} /></div>
                  <div>
                    <h3 className="hat-case-title">{c.title}</h3>
                    <p className="hat-case-desc">{richText(c.desc)}</p>
                  </div>
                </div>
                <div className="hat-tags" aria-label="example tags">
                  {c.tags.map((tag, j) => <span key={j} className="hat-tag">{tag}</span>)}
                </div>
                <div className="hat-meta">
                  {c.pills.map((pill, j) => <span key={j} className="hat-pill">{pill}</span>)}
                </div>
              </article>
            ))}
          </div>
          <div className="hat-note reveal">
            <div className="hat-note-title">{t.caseNoteTitle}</div>
            <div className="hat-note-sub">{richText(t.caseNoteSub)}</div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ENG VERTICAL — 검증 숫자(실측) + 개발자 섹션(API · MCP · CLI) */}
      {/* (라이브 데모 EngDemo 제거 — 좁은 계산기 데모는 "말로 설계" 메시지와 어긋남) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <EngDev langCode={langCode} />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* PERSONA CARDS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)', padding: '100px 24px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <header style={{ textAlign: 'center', marginBottom: '50px' }} className="reveal">
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#60a5fa', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>{t.personaKicker}</p>
            <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 36px)', fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.02em' }}>{t.personaTitle}</h2>
          </header>
          <div className="nf-persona-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            {[
              { iconName: 'tools' as const, title: t.persona1Title, desc: t.persona1Desc, cta: t.persona1Cta, href: '#nf-chat', color: '#3b82f6' },
              // persona2 견적 CTA도 챗 흐름으로(2026-07-16 IA — quick-quote 헤더 제거와 정합)
              { iconName: 'clipboard' as const, title: t.persona2Title, desc: t.persona2Desc, cta: t.persona2Cta, href: '#nf-chat', color: '#8b5cf6' },
              { iconName: 'rocket' as const, title: t.persona3Title, desc: t.persona3Desc, cta: t.persona3Cta, href: `/${langCode}/project-inquiry/`, color: '#10b981' },
            ].map((p, i) => (
              <article key={i} className="reveal" style={{
                background: 'rgba(255,255,255,0.05)', borderRadius: '20px', padding: '32px 28px',
                border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.3)'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              >
                <div style={{ color: p.color, marginBottom: '16px' }}><LineIcon name={p.iconName} size={30} /></div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f1f5f9', marginBottom: '8px' }}>{p.title}</h3>
                <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.6, flex: 1, marginBottom: '20px' }}>{p.desc}</p>
                <Link prefetch={p.href.includes('shape-generator')} href={p.href} style={{
                  display: 'inline-block', padding: '10px 20px', borderRadius: '10px',
                  background: p.color, color: '#fff', fontSize: '13px', fontWeight: 700,
                  textDecoration: 'none', textAlign: 'center', transition: 'opacity 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                >{p.cta}</Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MANUFACTURER SEARCH — Interactive Tool */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}


      {/* ENG VERTICAL — FAQ + schema.org FAQPage */}
      <EngFaq langCode={langCode} />

      {/* FINAL CTA */}
      <section id="Nexyfab-final-cta" className="hat-final-cta soft">
        <div className="hat-bg" aria-hidden="true"></div>
        <div className="hat-wrap">
          <p className="hat-kicker">{t.ctaKicker}</p>
          <h2 className="hat-title">{t.ctaTitle}</h2>
          <p className="hat-sub">{richText(t.ctaSub)}</p>
          <div className="hat-actions">
            <Link className="hat-btn-primary" href="#nf-chat">{t.platformCta1}</Link>
            <Link prefetch className="hat-btn-primary" href={`/${langCode}/project-inquiry/`}>{t.ctaBtn1}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
