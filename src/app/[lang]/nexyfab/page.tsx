'use client';

import { use, useState } from 'react';

const MOCK_MANUFACTURERS = [
  'Korea Precision', 'AdditiveMind', 'ProtoLabs KR', 'HanwhaQ&C', 'SFA Engineering',
  'Doosan Machining', 'LS Metal', 'Sungwoo Hitech', 'Hyundai WIA', 'SNT Dynamics',
];

const FEATURES = [
  {
    icon: '🔬',
    titleKo: 'DFM 분석',
    titleEn: 'DFM Analysis',
    descKo: 'AI가 실시간으로 설계 가능성을 분석하고 개선 방향을 제안합니다.',
    descEn: 'AI analyzes manufacturability in real-time and suggests improvements.',
  },
  {
    icon: '💰',
    titleKo: '비용 추정',
    titleEn: 'Cost Estimation',
    descKo: '재료비, 가공비, 수량 할인을 고려한 즉시 견적을 확인하세요.',
    descEn: 'Instant estimates with material, machining, and volume discount factors.',
  },
  {
    icon: '🧮',
    titleKo: '위상 최적화',
    titleEn: 'Topology Optimization',
    descKo: '하중 조건에 맞춰 최소 재료로 최대 강도를 달성합니다.',
    descEn: 'Achieve maximum strength with minimum material for your load cases.',
  },
  {
    icon: '🔐',
    titleKo: 'IP 공유 제어',
    titleEn: 'IP Share Control',
    descKo: '설계 파일의 공개 범위를 세밀하게 제어하고 안전하게 공유합니다.',
    descEn: 'Fine-grained control over design file visibility and secure sharing.',
  },
  {
    icon: '🤝',
    titleKo: '제조사 매칭',
    titleEn: 'Manufacturer Matching',
    descKo: '공정별 전문 제조사와 자동으로 연결됩니다.',
    descEn: 'Automatically matched to process-specialist manufacturers.',
  },
  {
    icon: '🔩',
    titleKo: 'COTS 카탈로그',
    titleEn: 'COTS Catalog',
    descKo: '규격 볼트·베어링·너트를 설계에 직접 추가하고 견적에 포함하세요.',
    descEn: 'Add standard bolts, bearings, and nuts directly to your design and quote.',
  },
];

const FLOW_STEPS = [
  {
    icon: '✏️',
    titleKo: '브라우저에서 설계',
    titleEn: 'Browser-based CAD',
    descKo: '설치 없이 브라우저에서 바로 3D 형상을 파라미터로 정의합니다.',
    descEn: 'Define 3D geometry parametrically in your browser — no install needed.',
    color: '#388bfd',
  },
  {
    icon: '🔬',
    titleKo: 'AI 제조 판단',
    titleEn: 'AI DFM Analysis',
    descKo: 'AI가 가공성, 비용, 위상 최적화를 즉시 분석합니다.',
    descEn: 'AI instantly analyzes machinability, cost, and topology optimization.',
    color: '#a371f7',
  },
  {
    icon: '🤝',
    titleKo: '제조사 연결',
    titleEn: 'Manufacturer Connection',
    descKo: '검증된 제조 파트너에게 견적을 요청하고 주문을 진행합니다.',
    descEn: 'Request quotes from verified manufacturing partners and place orders.',
    color: '#3fb950',
  },
];

const PLANS = [
  {
    name: 'Free',
    priceKo: '무료',
    priceEn: 'Free',
    color: '#6e7681',
    features: {
      ko: ['프로젝트 3개', '기본 DFM 분석', 'COTS 카탈로그'],
      en: ['3 projects', 'Basic DFM analysis', 'COTS catalog'],
    },
  },
  {
    name: 'Pro',
    priceKo: '₩29,000/월',
    priceEn: '₩29,000/mo',
    color: '#388bfd',
    highlight: true,
    features: {
      ko: ['무제한 프로젝트', '고급 DFM + 위상 최적화', '비용 추정', '제조사 매칭'],
      en: ['Unlimited projects', 'Advanced DFM + topology', 'Cost estimation', 'Manufacturer matching'],
    },
  },
  {
    name: 'Team',
    priceKo: '₩42,000/월',
    priceEn: '₩42,000/mo',
    color: '#a371f7',
    features: {
      ko: ['Pro 모든 기능', '팀 협업', '우선 제조사 매칭', 'API 접근'],
      en: ['All Pro features', 'Team collaboration', 'Priority matching', 'API access'],
    },
  },
];

export default function NexyfabHomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = lang === 'ko';
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d1117',
      color: '#e6edf3',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflowX: 'hidden',
    }}>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section style={{
        padding: '80px 40px 60px',
        maxWidth: 860,
        margin: '0 auto',
        textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-block',
          fontSize: 11,
          fontWeight: 700,
          color: '#388bfd',
          background: '#388bfd1a',
          borderRadius: 20,
          padding: '4px 14px',
          marginBottom: 24,
          letterSpacing: '0.06em',
          border: '1px solid #388bfd40',
        }}>
          {isKo ? '브라우저 기반 제조 플랫폼' : 'Browser-Based Manufacturing Platform'}
        </div>

        <h1 style={{
          margin: '0 0 20px',
          fontSize: 'clamp(32px, 5vw, 52px)',
          fontWeight: 900,
          lineHeight: 1.15,
          letterSpacing: '-0.03em',
          color: '#e6edf3',
        }}>
          {isKo
            ? (<>브라우저에서 설계,<br /><span style={{ background: 'linear-gradient(135deg, #388bfd, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AI 제조 판단</span>, 제조사 연결</>)
            : (<>Browser-based CAD,<br /><span style={{ background: 'linear-gradient(135deg, #388bfd, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AI DFM Analysis</span>, Manufacturer Connection</>)
          }
        </h1>

        <p style={{
          margin: '0 auto 36px',
          maxWidth: 580,
          fontSize: 17,
          color: '#8b949e',
          lineHeight: 1.65,
        }}>
          {isKo
            ? 'NexyFab은 설계부터 제조까지 하나의 플랫폼에서 처리합니다. 설치 없이 브라우저에서 3D 설계 후 AI 분석, 견적, 제조사 연결까지 한 번에.'
            : 'NexyFab handles everything from design to manufacturing in a single platform. Design 3D parts in the browser, get AI analysis, quotes, and manufacturer connections — all at once.'}
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href={`/${lang}/shape-generator`}
            style={{
              padding: '13px 32px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              textDecoration: 'none',
              transition: 'opacity 0.15s, transform 0.15s',
              display: 'inline-block',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            ✏️ {isKo ? '무료로 시작' : 'Start for Free'}
          </a>
          <a
            href={`/${lang}/nexyfab/dashboard`}
            style={{
              padding: '13px 32px',
              borderRadius: 10,
              border: '1px solid #30363d',
              background: 'transparent',
              color: '#c9d1d9',
              fontSize: 15,
              fontWeight: 600,
              textDecoration: 'none',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.background = '#21262d'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.background = 'transparent'; }}
          >
            {isKo ? '데모 보기 →' : 'View Demo →'}
          </a>
        </div>
      </section>

      {/* ── Flow 3단계 ──────────────────────────────────────────────── */}
      <section style={{
        padding: '0 40px 60px',
        maxWidth: 960,
        margin: '0 auto',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 20,
        }}>
          {FLOW_STEPS.map((step, i) => (
            <div key={i} style={{
              background: '#161b22',
              border: `1px solid ${step.color}40`,
              borderRadius: 14,
              padding: '28px 24px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: step.color,
                borderRadius: '14px 14px 0 0',
              }} />
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: `${step.color}18`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                marginBottom: 14,
              }}>
                {step.icon}
              </div>
              <div style={{
                fontSize: 10,
                fontWeight: 800,
                color: step.color,
                letterSpacing: '0.08em',
                marginBottom: 6,
              }}>
                STEP {i + 1}
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#e6edf3' }}>
                {isKo ? step.titleKo : step.titleEn}
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: '#8b949e', lineHeight: 1.55 }}>
                {isKo ? step.descKo : step.descEn}
              </p>
              {i < FLOW_STEPS.length - 1 && (
                <div style={{
                  position: 'absolute',
                  right: -12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 18,
                  color: '#30363d',
                  zIndex: 2,
                }}>
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── 기능 그리드 ─────────────────────────────────────────────── */}
      <section style={{
        padding: '0 40px 60px',
        maxWidth: 960,
        margin: '0 auto',
      }}>
        <h2 style={{
          margin: '0 0 8px',
          fontSize: 26,
          fontWeight: 800,
          textAlign: 'center',
          letterSpacing: '-0.02em',
        }}>
          {isKo ? '모든 제조 워크플로우를 한 곳에' : 'Every manufacturing workflow, in one place'}
        </h2>
        <p style={{ margin: '0 0 32px', textAlign: 'center', color: '#6e7681', fontSize: 14 }}>
          {isKo ? '설계부터 납품까지 필요한 모든 도구' : 'All the tools you need from design to delivery'}
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
        }}>
          {FEATURES.map((feat, i) => (
            <div
              key={i}
              style={{
                background: hoveredFeature === i ? '#1c2128' : '#161b22',
                border: `1px solid ${hoveredFeature === i ? '#388bfd' : '#30363d'}`,
                borderRadius: 12,
                padding: '22px 20px',
                transition: 'all 0.15s',
                cursor: 'default',
              }}
              onMouseEnter={() => setHoveredFeature(i)}
              onMouseLeave={() => setHoveredFeature(null)}
            >
              <div style={{ fontSize: 26, marginBottom: 12 }}>{feat.icon}</div>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>
                {isKo ? feat.titleKo : feat.titleEn}
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: '#6e7681', lineHeight: 1.55 }}>
                {isKo ? feat.descKo : feat.descEn}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 플랜 비교 ───────────────────────────────────────────────── */}
      <section style={{
        padding: '0 40px 60px',
        maxWidth: 820,
        margin: '0 auto',
      }}>
        <h2 style={{
          margin: '0 0 8px',
          fontSize: 26,
          fontWeight: 800,
          textAlign: 'center',
          letterSpacing: '-0.02em',
        }}>
          {isKo ? '플랜 비교' : 'Plan Comparison'}
        </h2>
        <p style={{ margin: '0 0 32px', textAlign: 'center', color: '#6e7681', fontSize: 14 }}>
          {isKo ? '필요에 맞는 플랜을 선택하세요' : 'Choose the plan that fits your needs'}
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}>
          {PLANS.map(plan => (
            <div
              key={plan.name}
              style={{
                background: plan.highlight ? '#161b22' : '#0d1117',
                border: `1px solid ${plan.highlight ? plan.color : '#30363d'}`,
                borderRadius: 14,
                padding: '24px 20px',
                position: 'relative',
                boxShadow: plan.highlight ? `0 0 0 1px ${plan.color}40, 0 8px 32px rgba(56,139,253,0.12)` : 'none',
              }}
            >
              {plan.highlight && (
                <div style={{
                  position: 'absolute',
                  top: -11,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: plan.color,
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '3px 12px',
                  borderRadius: 20,
                  letterSpacing: '0.06em',
                }}>
                  {isKo ? '인기' : 'POPULAR'}
                </div>
              )}
              <div style={{
                fontSize: 12,
                fontWeight: 800,
                color: plan.color,
                marginBottom: 8,
                letterSpacing: '0.05em',
              }}>
                {plan.name}
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#e6edf3', marginBottom: 16 }}>
                {isKo ? plan.priceKo : plan.priceEn}
              </div>
              <ul style={{ margin: '0 0 20px', padding: 0, listStyle: 'none' }}>
                {(isKo ? plan.features.ko : plan.features.en).map((f, i) => (
                  <li key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: '#c9d1d9',
                    padding: '4px 0',
                  }}>
                    <span style={{ color: '#3fb950', fontSize: 12 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href={`/${lang}/shape-generator`}
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '9px 0',
                  borderRadius: 8,
                  background: plan.highlight ? `linear-gradient(135deg, ${plan.color}, #8b5cf6)` : 'transparent',
                  border: plan.highlight ? 'none' : `1px solid ${plan.color}60`,
                  color: plan.highlight ? '#fff' : plan.color,
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: 'none',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                {isKo ? '시작하기' : 'Get started'}
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* ── 제조사 로고 ─────────────────────────────────────────────── */}
      <section style={{
        padding: '0 40px 80px',
        maxWidth: 860,
        margin: '0 auto',
        textAlign: 'center',
      }}>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#6e7681', fontWeight: 600, letterSpacing: '0.05em' }}>
          {isKo ? '검증된 제조 파트너' : 'VERIFIED MANUFACTURING PARTNERS'}
        </p>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'center',
        }}>
          {MOCK_MANUFACTURERS.map(name => (
            <div key={name} style={{
              padding: '8px 16px',
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 8,
              fontSize: 13,
              color: '#6e7681',
              fontWeight: 500,
              transition: 'all 0.12s',
              cursor: 'default',
            }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.borderColor = '#58a6ff'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#6e7681'; e.currentTarget.style.borderColor = '#30363d'; }}
            >
              {name}
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA Footer ──────────────────────────────────────────────── */}
      <section style={{
        padding: '48px 40px',
        background: '#161b22',
        borderTop: '1px solid #21262d',
        textAlign: 'center',
      }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>
          {isKo ? '지금 바로 설계를 시작하세요' : 'Start designing right now'}
        </h2>
        <p style={{ margin: '0 0 28px', color: '#6e7681', fontSize: 14 }}>
          {isKo ? '신용카드 불필요 · 무료로 3개 프로젝트 · 언제든 업그레이드' : 'No credit card · 3 free projects · Upgrade anytime'}
        </p>
        <a
          href={`/${lang}/shape-generator`}
          style={{
            display: 'inline-block',
            padding: '13px 40px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            textDecoration: 'none',
            transition: 'opacity 0.15s, transform 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          ✏️ {isKo ? '무료로 시작' : 'Get started for free'}
        </a>
      </section>
    </div>
  );
}
