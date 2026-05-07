'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { richText } from '@/lib/richText';
import type { homeDict } from './homeDict';

export default function Home({ dict, langCode }: { dict: (typeof homeDict)['ko']; langCode: string }) {
  const router = useRouter();
  const validLangs = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
  const lang = validLangs.includes(langCode) ? langCode : 'en';
  const t = dict;
const [featTab, setFeatTab] = useState<'design' | 'analysis' | 'mfg'>('design');
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
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
          } else {
            entry.target.classList.remove('active');
          }
        });
      }, { threshold: 0.1 });
      document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
    });
    return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
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
            <div aria-hidden="true" style={{ fontSize: 36, marginBottom: 12 }}>🚀</div>
            <h2 id="onboarding-title" style={{ color: '#e6edf3', fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>
              {t.onboardingTitle}
            </h2>
            <p style={{ color: '#8b949e', fontSize: 13, margin: '0 0 28px' }}>
              {t.onboardingSub}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { icon: '🎨', label: t.onboardingPath1, desc: t.onboardingPath1Desc, action: () => { dismissOnboarding(); router.push(`/${langCode}/shape-generator/`); } },
                { icon: '🏭', label: t.onboardingPath2, desc: t.onboardingPath2Desc, action: () => { dismissOnboarding(); router.push(`/${langCode}/project-inquiry/`); } },
                { icon: '🔍', label: t.onboardingPath3, desc: t.onboardingPath3Desc, action: () => { dismissOnboarding(); router.push(`/${langCode}/factories/`); } },
              ].map((path, i) => (
                <button key={i} onClick={path.action} className="nf-onboarding-path-btn">
                  <span aria-hidden="true" style={{ fontSize: 28 }}>{path.icon}</span>
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
      <section style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1b3e 40%, #0b1a38 100%)',
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '120px 24px 80px',
      }}>
        {/* Animated grid background */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.06, backgroundImage: 'linear-gradient(rgba(59,130,246,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.5) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
        {/* Glow orb */}
        <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(80px)' }} />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: '1100px', width: '100%', textAlign: 'center' }}>
          {/* Badges */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '28px' }}>
            {[t.platformBadge1, t.platformBadge2, t.platformBadge3, t.platformBadge4].map((badge, i) => (
              <span key={i} style={{
                padding: '5px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.02em',
                background: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)',
              }}>{badge}</span>
            ))}
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 900, lineHeight: 1.15,
            color: '#f0f4ff', letterSpacing: '-0.03em', marginBottom: '20px',
            whiteSpace: 'pre-line', wordBreak: 'keep-all',
          }}>
            {(t.platformTitle || '').replace(/<br\s*\/?>/g, '\n')}
          </h1>

          {/* Sub */}
          <p style={{
            fontSize: 'clamp(15px, 2vw, 18px)', lineHeight: 1.7, color: 'rgba(203,213,225,0.85)',
            maxWidth: '720px', margin: '0 auto 40px', whiteSpace: 'pre-line', wordBreak: 'keep-all',
          }}>
            {(t.platformSub || '').replace(/<br\s*\/?>/g, '\n')}
          </p>

          {/* Micro copy */}
          <p style={{ fontSize: '13px', color: 'rgba(147,197,253,0.7)', marginBottom: '24px', fontWeight: 500 }}>
            {t.platformMicro}
          </p>

          {/* CTA Buttons */}
          <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '24px' }}>
            <Link prefetch href={`/${langCode}/shape-generator/`} style={{
              padding: '14px 36px', borderRadius: '14px', fontSize: '16px', fontWeight: 800,
              background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', color: '#fff',
              textDecoration: 'none', boxShadow: '0 4px 24px rgba(59,130,246,0.4)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(59,130,246,0.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(59,130,246,0.4)'; }}
            >
              {t.platformCta1}
            </Link>
            <Link prefetch href={`/${langCode}/project-inquiry/`} style={{
              padding: '14px 36px', borderRadius: '14px', fontSize: '16px', fontWeight: 800,
              background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)',
              textDecoration: 'none', transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            >
              {t.platformCta2}
            </Link>
          </div>

          {/* Demo → signup migration reassurance */}
          <p style={{
            fontSize: '12px', color: 'rgba(147,197,253,0.85)', marginBottom: '28px',
            fontWeight: 600, letterSpacing: '0.01em',
          }}>
            {t.platformDemoMigrate}
          </p>

          {/* Find Factories CTA */}
          <div style={{ margin: '0 auto 50px', textAlign: 'center' }}>
            <Link prefetch href={`/${langCode}/factories/`} style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '12px 28px', borderRadius: '14px',
              background: 'rgba(255,255,255,0.08)', color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.15)',
              fontSize: '14px', fontWeight: 700, textDecoration: 'none',
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            >
              🏭 {t.factories}
            </Link>
          </div>

          {/* Mock 3D Viewport Preview */}
          <div style={{
            maxWidth: '900px', margin: '0 auto', borderRadius: '16px', overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            background: '#0d1117', aspectRatio: '16/9', position: 'relative',
          }}>
            {/* Toolbar mockup */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', background: '#161b22', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '6px' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f87171' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#fbbf24' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#34d399' }} />
              <span style={{ marginLeft: '16px', fontSize: '11px', color: '#6e7681', fontWeight: 600 }}>NexyFab — Shape Generator</span>
            </div>
            {/* Grid + 3D illusion */}
            <div style={{ padding: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100% - 36px)' }}>
              <div style={{
                width: '180px', height: '180px', position: 'relative',
                transform: 'rotateX(15deg) rotateY(-25deg)', transformStyle: 'preserve-3d', perspective: '800px',
              }}>
                {/* 3D box faces */}
                <div style={{ position: 'absolute', width: '100%', height: '100%', border: '2px solid rgba(59,130,246,0.5)', borderRadius: '4px', background: 'rgba(59,130,246,0.05)' }} />
                <div style={{ position: 'absolute', width: '100%', height: '60px', bottom: '-30px', left: '30px', border: '2px solid rgba(99,102,241,0.4)', borderRadius: '4px', background: 'rgba(99,102,241,0.05)', transform: 'skewX(-20deg)' }} />
                <div style={{ position: 'absolute', width: '60px', height: '100%', right: '-30px', top: '-30px', border: '2px solid rgba(139,92,246,0.4)', borderRadius: '4px', background: 'rgba(139,92,246,0.05)', transform: 'skewY(-20deg)' }} />
                {/* Axis lines */}
                <div style={{ position: 'absolute', bottom: '0', left: '0', width: '2px', height: '220px', background: 'linear-gradient(to top, #ef4444, transparent)' }} />
                <div style={{ position: 'absolute', bottom: '0', left: '0', width: '220px', height: '2px', background: 'linear-gradient(to right, #22c55e, transparent)' }} />
              </div>
              {/* Side panel mockup */}
              <div className="nf-hero-side-panel" style={{ position: 'absolute', right: '16px', top: '52px', bottom: '16px', width: '200px', background: 'rgba(22,27,34,0.9)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', padding: '12px' }}>
                <div style={{ fontSize: '10px', color: '#8b949e', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Parameters</div>
                {['Width', 'Height', 'Depth', 'Fillet'].map((label, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '10px', color: '#6e7681' }}>{label}</span>
                    <div style={{ width: '80px', height: '4px', background: '#21262d', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${60 + i * 10}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #6366f1)', borderRadius: '2px' }} />
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: '16px', fontSize: '10px', color: '#8b949e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Analysis</div>
                {['FEA', 'DFM', 'Modal'].map((label, i) => (
                  <div key={i} style={{ marginTop: '4px', padding: '4px 8px', borderRadius: '4px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', fontSize: '9px', color: '#60a5fa', fontWeight: 600 }}>{label}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

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
              { num: '01', title: t.wf1Title, desc: t.wf1Desc, hint: t.wf1Hint, icon: '🎨', color: '#3b82f6' },
              { num: '02', title: t.wf2Title, desc: t.wf2Desc, hint: t.wf2Hint, icon: '🔬', color: '#8b5cf6' },
              { num: '03', title: t.wf3Title, desc: t.wf3Desc, hint: t.wf3Hint, icon: '🧬', color: '#06b6d4' },
              { num: '04', title: t.wf4Title, desc: t.wf4Desc, hint: t.wf4Hint, icon: '💰', color: '#f59e0b' },
              { num: '05', title: t.wf5Title, desc: t.wf5Desc, hint: t.wf5Hint, icon: '🏭', color: '#10b981' },
            ].map((step, i) => (
              <div key={i} className="reveal nf-workflow-step" style={{ flex: '1 1 180px', maxWidth: '220px', textAlign: 'center', padding: '20px 12px', position: 'relative' }}>
                {i < 4 && <div style={{ position: 'absolute', top: '38px', right: '-16px', width: '32px', height: '2px', background: 'rgba(59,130,246,0.25)' }} className="desktop-only" />}
                <div style={{
                  width: '56px', height: '56px', borderRadius: '16px', margin: '0 auto 16px',
                  background: `${step.color}20`, border: `2px solid ${step.color}40`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px',
                }}>{step.icon}</div>
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
              { num: t.socialStat1, label: t.socialStat1Label },
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
              { icon: '✅', title: t.why1Title, desc: t.why1Desc },
              { icon: '🧠', title: t.why2Title, desc: t.why2Desc },
              { icon: '🔒', title: t.why3Title, desc: t.why3Desc },
              { icon: '⚡', title: t.why4Title, desc: t.why4Desc },
            ].map((w, i) => (
              <article key={i} className="hat-card reveal">
                <div className="hat-ic" aria-hidden="true">{w.icon}</div>
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
              { key: 'design' as const, label: t.featTabDesign, icon: '🎨' },
              { key: 'analysis' as const, label: t.featTabAnalysis, icon: '📊' },
              { key: 'mfg' as const, label: t.featTabMfg, icon: '🏭' },
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
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content — 2 cards per tab */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }} className="reveal">
            {featTab === 'design' && <>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>🧊</div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat1Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat1Desc}</p>
              </div>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>🧬</div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat3Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat3Desc}</p>
              </div>
            </>}
            {featTab === 'analysis' && <>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>📐</div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat2Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat2Desc}</p>
              </div>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>🌡️</div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat4Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat4Desc}</p>
              </div>
            </>}
            {featTab === 'mfg' && <>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>🛡️</div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat5Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat5Desc}</p>
              </div>
              <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>📋</div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{t.feat6Title}</h3>
                <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>{t.feat6Desc}</p>
              </div>
            </>}
          </div>

          {/* CTA */}
          <div style={{ textAlign: 'center', marginTop: '40px' }} className="reveal">
            <Link prefetch href={`/${langCode}/shape-generator/`} style={{ display: 'inline-block', padding: '12px 28px', border: '2px solid #3b82f6', color: '#1d4ed8', borderRadius: '12px', fontWeight: 700, fontSize: '14px', textDecoration: 'none', transition: 'all 0.2s', background: 'transparent' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#3b82f6'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#1d4ed8'; }}
            >
              {t.platformCta1} →
            </Link>
          </div>
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
              { icon: '🏭', title: t.case1Title, desc: t.case1Desc, tags: [t.case1Tag1, t.case1Tag2, t.case1Tag3], pills: [t.case1Pill1, t.case1Pill2] },
              { icon: '🧩', title: t.case2Title, desc: t.case2Desc, tags: [t.case2Tag1, t.case2Tag2, t.case2Tag3], pills: [t.case2Pill1, t.case2Pill2] },
              { icon: '🧪', title: t.case3Title, desc: t.case3Desc, tags: [t.case3Tag1, t.case3Tag2, t.case3Tag3], pills: [t.case3Pill1, t.case3Pill2] },
              { icon: '🏗️', title: t.case4Title, desc: t.case4Desc, tags: [t.case4Tag1, t.case4Tag2, t.case4Tag3], pills: [t.case4Pill1, t.case4Pill2] },
            ].map((c, i) => (
              <article key={i} className="hat-case reveal" role="listitem">
                <div className="hat-case-top">
                  <div className="hat-case-ic" aria-hidden="true">{c.icon}</div>
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
              { icon: '🛠️', title: t.persona1Title, desc: t.persona1Desc, cta: t.persona1Cta, href: `/${langCode}/shape-generator/`, color: '#3b82f6' },
              { icon: '📋', title: t.persona2Title, desc: t.persona2Desc, cta: t.persona2Cta, href: `/${langCode}/quick-quote/`, color: '#8b5cf6' },
              { icon: '🚀', title: t.persona3Title, desc: t.persona3Desc, cta: t.persona3Cta, href: `/${langCode}/project-inquiry/`, color: '#10b981' },
            ].map((p, i) => (
              <article key={i} className="reveal" style={{
                background: 'rgba(255,255,255,0.05)', borderRadius: '20px', padding: '32px 28px',
                border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.3)'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              >
                <div style={{ fontSize: '32px', marginBottom: '16px' }}>{p.icon}</div>
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


      {/* FINAL CTA */}
      <section id="Nexyfab-final-cta" className="hat-final-cta soft">
        <div className="hat-bg" aria-hidden="true"></div>
        <div className="hat-wrap">
          <p className="hat-kicker">{t.ctaKicker}</p>
          <h2 className="hat-title">{t.ctaTitle}</h2>
          <p className="hat-sub">{richText(t.ctaSub)}</p>
          <div className="hat-actions">
            <Link prefetch className="hat-btn-primary" href={`/${langCode}/shape-generator/`}>{t.platformCta1}</Link>
            <Link prefetch className="hat-btn-primary" href={`/${langCode}/project-inquiry/`}>{t.ctaBtn1}</Link>
            <Link prefetch className="hat-btn-secondary" href={`/${langCode}/factories/`}>{t.ctaBtn2}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
