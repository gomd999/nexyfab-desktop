'use client';

import { use } from 'react';
import PricingCards from '@/components/nexyfab/PricingCards';
import VerificationBanner from '@/components/nexyfab/VerificationBanner';
import { useAuthStore } from '@/hooks/useAuth';
import { isKorean } from '@/lib/i18n/normalize';

export default function NexyfabPricingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);
  const user = useAuthStore(s => s.user);

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <VerificationBanner lang={isKo ? 'ko' : 'en'} />

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '60px 24px' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: '#388bfd', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            NexyFab Pricing
          </p>
          <h1 style={{ margin: '0 0 16px', fontSize: 36, fontWeight: 800, color: '#e6edf3', lineHeight: 1.2 }}>
            {isKo ? '브라우저에서 설계, AI가 판단, 제조사가 만든다' : 'Design. Analyze. Manufacture.'}
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: '#6e7681', maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
            {isKo
              ? '무료로 시작하고, 필요할 때 업그레이드하세요. 구독 취소는 언제든 가능합니다.'
              : 'Start free, upgrade when you\'re ready. Cancel anytime.'}
          </p>
        </div>

        {/* AI Features showcase */}
        <div style={{ marginBottom: 56 }}>
          <p style={{ textAlign: 'center', margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#a371f7', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {isKo ? '새로운 AI 기능' : 'New AI Features'}
          </p>
          <h2 style={{ textAlign: 'center', margin: '0 0 28px', fontSize: 22, fontWeight: 800, color: '#e6edf3' }}>
            {isKo ? '4가지 AI가 설계 → 견적 → 공급사를 한 번에' : 'Four AIs from design to supplier in one flow'}
          </h2>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12,
          }}>
            {[
              {
                icon: '🤖', accent: '#388bfd',
                titleKo: 'AI DFM 설명 + 단가 영향', titleEn: 'AI DFM Explainer + Cost Impact',
                descKo: 'DFM 이슈의 근본 원인과 각 수정안의 실시간 단가 변화를 보여줍니다.',
                descEn: 'Explains DFM root cause and shows real-time cost delta for each fix.',
              },
              {
                icon: '🧭', accent: '#a371f7',
                titleKo: 'AI 공정 라우터', titleEn: 'AI Process Router',
                descKo: '형상·재질·수량에 최적인 제조 공정을 추천하고 단가·리드타임을 비교합니다.',
                descEn: 'Recommends the optimal process for your shape and compares cost & lead time.',
              },
              {
                icon: '🎯', accent: '#39c5bb',
                titleKo: 'AI 공급사 Top 3', titleEn: 'AI Supplier Top-3',
                descKo: '재질·공정·수량을 분석해 최적 공급사 Top 3와 RFQ 작성 포인트를 제시합니다.',
                descEn: 'Top-3 suppliers ranked by fit with tailored RFQ talking points.',
              },
              {
                icon: '💰', accent: '#d29922',
                titleKo: '비용 절감 코파일럿', titleEn: 'Design-for-Cost Copilot',
                descKo: '"비용 20% 줄여줘" 같은 자연어로 설계·재료·공정 변경 제안을 받습니다.',
                descEn: 'Ask "cut cost by 20%" in plain language — get design / material / process changes.',
              },
            ].map((f) => (
              <div key={f.titleEn} style={{
                background: '#161b22', border: `1px solid ${f.accent}33`,
                borderRadius: 10, padding: '14px 16px',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{f.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: f.accent }}>
                    {isKo ? f.titleKo : f.titleEn}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.5 }}>
                  {isKo ? f.descKo : f.descEn}
                </p>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', margin: '14px 0 0', fontSize: 12, color: '#6e7681' }}>
            {isKo
              ? '무료 플랜은 각 기능 월 3-5회 체험 — Pro 부터 무제한'
              : 'Free plan: 3-5 trials/month per feature — Pro: unlimited'}
          </p>
        </div>

        {/* Pricing Cards */}
        <PricingCards lang={isKo ? 'ko' : 'en'} currentPlan={user?.plan} />

        {/* FAQ */}
        <div style={{ marginTop: 72 }}>
          <h2 style={{ textAlign: 'center', margin: '0 0 32px', fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>
            {isKo ? '자주 묻는 질문' : 'FAQ'}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640, margin: '0 auto' }}>
            {(isKo ? [
              { q: 'Free 플랜은 어디까지 쓸 수 있나요?', a: '3개 프로젝트까지 저장 가능하고, STL 내보내기와 기본 AI 채팅을 무료로 사용할 수 있습니다. DFM 분석, FEA, 비용 추정은 Pro부터 가능합니다.' },
              { q: 'Pro와 Team의 차이는?', a: 'Pro는 개인용으로 모든 분석 기능과 무제한 프로젝트를 제공합니다. Team은 실시간 협업, 팀원 초대, 공유 프로젝트 기능이 추가됩니다.' },
              { q: '3D 모델러 단독으로 사용하려면?', a: 'Pro 플랜(₩29,000/월)으로 이용 가능합니다. 단, NexyFab 매칭 서비스(50만원 플랜)를 이용하시면 Pro 3개월이 무료 포함되고, 100만원 플랜은 6개월이 포함됩니다.' },
              { q: '결제는 어떻게 이루어지나요?', a: 'Stripe를 통한 카드 결제입니다. 매월 자동 갱신되며, 언제든 해지하면 해당 기간까지만 사용 가능합니다.' },
              { q: 'Enterprise는 어떻게 신청하나요?', a: '하단의 Enterprise 문의 버튼을 통해 연락하시면 맞춤 견적을 제공해드립니다.' },
            ] : [
              { q: 'What does the Free plan include?', a: 'Up to 3 saved projects, STL export, and basic AI chat. DFM analysis, FEA, and cost estimation require Pro.' },
              { q: 'Difference between Pro and Team?', a: 'Pro is for individuals with all analysis features and unlimited projects. Team adds real-time collaboration and shared workspaces.' },
              { q: 'Can I use the 3D Modeler standalone?', a: 'Yes, the Pro plan ($20/mo) gives full 3D Modeler access. However, NexyFab matching plans already include it — 3 months with the $400 plan, 6 months with the $800 plan.' },
              { q: 'How does billing work?', a: 'Monthly Stripe card billing. Cancel anytime — access continues until the end of the billing period.' },
              { q: 'How do I get Enterprise?', a: 'Contact us via the Enterprise button below for a custom quote.' },
            ]).map((item, i) => (
              <div key={i} style={{
                background: '#161b22', border: '1px solid #30363d',
                borderRadius: 10, padding: '16px 20px',
              }}>
                <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 13, color: '#e6edf3' }}>Q. {item.q}</p>
                <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.6 }}>{item.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Enterprise CTA */}
        <div style={{
          marginTop: 56, textAlign: 'center', padding: '32px',
          background: '#161b22', border: '1px solid #30363d', borderRadius: 14,
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#e6edf3' }}>
            {isKo ? '대규모 팀이나 맞춤 계약이 필요하신가요?' : 'Need Enterprise or a custom contract?'}
          </p>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6e7681' }}>
            {isKo ? 'SSO, 감사 로그, 전용 서버, SLA 보장을 제공합니다.' : 'SSO, audit logs, dedicated servers, and SLA guarantees.'}
          </p>
          <a href="mailto:enterprise@nexyfab.com" style={{
            display: 'inline-block', padding: '10px 28px', borderRadius: 8,
            background: '#21262d', border: '1px solid #d29922',
            color: '#d29922', fontSize: 13, fontWeight: 700, textDecoration: 'none',
          }}>
            {isKo ? 'Enterprise 문의' : 'Contact Enterprise'}
          </a>
        </div>
      </div>
    </div>
  );
}
