'use client';

// G1 — Integrated user guide page.
//
// 7 categorized cards covering the end-to-end NexyFab journey:
// design → quote → order → review. Each card expands inline (no
// nested routes — keeps the URL flat for sharing/bookmarking).
//
// Search & inline tooltips are deliberate non-goals: real usage data
// should drive what to elaborate on. This page is the "is the door
// open?" first response, not a full documentation system.

import React, { useState } from 'react';
import { useParams } from 'next/navigation';

interface Step {
  text_ko: string;
  text_en: string;
}

interface Section {
  id: string;
  emoji: string;
  title_ko: string;
  title_en: string;
  blurb_ko: string;
  blurb_en: string;
  steps: Step[];
  cta?: { label_ko: string; label_en: string; href: string };
}

const SECTIONS: Section[] = [
  {
    id: 'first-design',
    emoji: '✏️',
    title_ko: '첫 설계 만들기',
    title_en: 'Create your first design',
    blurb_ko: '브라우저에서 바로 3D 모델을 만듭니다. 설치 불필요.',
    blurb_en: '3D model right in the browser — no install.',
    steps: [
      { text_ko: '홈(허브) 또는 기계 분야의 "전문가형 CAD" 카드 클릭 → shape generator 열림', text_en: 'Open it from the Hub or the "Expert CAD" card on the Mechanical page.' },
      { text_ko: '왼쪽 패널에서 시작 도형 (큐브/원기둥/구 등) 선택', text_en: 'Pick a starter shape (cube/cylinder/sphere) from the left panel.' },
      { text_ko: '파라미터 슬라이더로 치수 조절. 실시간으로 3D 뷰 갱신', text_en: 'Drag parameter sliders — the 3D view updates live.' },
      { text_ko: '오른쪽 위 메뉴 → "STL 내보내기" 또는 "STEP 내보내기"로 다운로드', text_en: 'Top-right → "Export STL" or "Export STEP" to download.' },
    ],
    cta: { label_ko: '3D 모델러 열기', label_en: 'Open 3D Modeler', href: 'shape-generator' },
  },
  {
    id: 'ai-agent',
    emoji: '🤖',
    title_ko: 'AI 에이전트 사용하기',
    title_en: 'Using the AI agent',
    blurb_ko: '"M8 50mm 볼트 4개 들어가는 마운트" 같은 자연어로 직접 설계.',
    blurb_en: 'Design via natural language: "mount with 4 M8 50mm bolt holes".',
    steps: [
      { text_ko: '3D 모델러 페이지에서 우상단 "AI Agent" 토글 활성화 (Pro 플랜)', text_en: '3D Modeler page → top-right "AI Agent" toggle (Pro plan).' },
      { text_ko: '플로팅 패널 등장. "🎨 템플릿" 버튼으로 12+ 시작 템플릿 둘러보기', text_en: 'Floating panel appears. Browse 12+ starter templates via "🎨 Templates".' },
      { text_ko: '또는 "💡 무엇을 시킬 수 있나요?" 클릭 → 카테고리별 예시 프롬프트', text_en: 'Or click "💡 What can I ask?" for category-grouped example prompts.' },
      { text_ko: '입력창에 자연어로 요청 → 에이전트가 SCAD 코드 작성 + 자가 검증', text_en: 'Type your request — agent writes SCAD + self-verifies.' },
      { text_ko: '결과는 "↗ canvas" 버튼으로 메인 뷰포트에 띄우거나 STEP/도면 export', text_en: 'Use "↗ canvas" to display in the main viewport, or export STEP/drawing.' },
      { text_ko: '체크포인트 자동 저장 → 언제든 이전 시점으로 되돌리기 가능', text_en: 'Checkpoints save automatically — revert any time.' },
    ],
  },
  {
    id: 'send-rfq',
    emoji: '📤',
    title_ko: 'RFQ (견적 요청) 보내기',
    title_en: 'Send an RFQ (quote request)',
    blurb_ko: 'STEP 파일 또는 모델러 결과를 제조사에 보냅니다.',
    blurb_en: 'Send your STEP file or modeler output to manufacturers.',
    steps: [
      { text_ko: '"빠른 견적" 페이지에서 STEP/STL 업로드 → AI가 즉시 1차 추정 제시 (B4)', text_en: '"Quick Quote" page → upload STEP/STL → AI gives an instant first estimate (B4).' },
      { text_ko: '재질/공정/수량 직접 조정 또는 AI 추천 그대로 사용', text_en: 'Tweak material/process/quantity or use the AI pick as-is.' },
      { text_ko: '"견적 요청" 클릭 → RFQ 자동 작성 → 매칭 제조사들에게 알림 발송', text_en: 'Click "Request Quote" — RFQ auto-drafted, matched factories notified.' },
      { text_ko: '특정 제조사 한 곳에만 보내려면 /factories에서 회사 선택 → 직접 발송 (M3)', text_en: 'To send to one specific factory: pick from /factories → direct quote (M3).' },
      { text_ko: '자주 쓰는 RFQ는 "템플릿으로 저장" → 다음에 재발주 빠르게 (B7)', text_en: 'Save frequent RFQs as templates for quick re-quote (B7).' },
    ],
    cta: { label_ko: '빠른 견적 시작', label_en: 'Start Quick Quote', href: 'quick-quote' },
  },
  {
    id: 'compare-quotes',
    emoji: '🏆',
    title_ko: '견적 비교 + 수락',
    title_en: 'Compare quotes + accept',
    blurb_ko: '여러 제조사가 견적을 보내면 차원별로 비교해서 결정.',
    blurb_en: 'When multiple factories quote, compare by dimension and decide.',
    steps: [
      { text_ko: 'RFQ 페이지에서 본인 RFQ 선택 → 도착한 견적 목록 표시', text_en: 'RFQ page → pick your RFQ → see arrived quotes.' },
      { text_ko: '2개 이상 견적 시 "🏆 견적 비교" 카드 자동 표시 (B5)', text_en: 'When 2+ quotes arrive, "🏆 Quote Comparison" card auto-shows (B5).' },
      { text_ko: '가격/납기/제조사명으로 정렬. 최저가·최단납기 자동 강조', text_en: 'Sort by price/lead/name. Lowest + fastest auto-highlighted.' },
      { text_ko: '제조사 이름 클릭 → 평가, 인증, 최근 리뷰까지 미리보기 (M2)', text_en: 'Click a factory name → preview rating, certs, recent reviews (M2).' },
      { text_ko: '"✓ 수락" 클릭 → 주문 자동 생성 + "주문 진행 상황 보기" 링크 (B6)', text_en: '"✓ Accept" → order auto-created + "View order progress" link (B6).' },
    ],
  },
  {
    id: 'track-order',
    emoji: '🚚',
    title_ko: '주문 추적 + 메시지',
    title_en: 'Track order + messaging',
    blurb_ko: '진행 상황 사진과 양방향 대화로 끝까지 가시성 확보.',
    blurb_en: 'Photos + two-way chat keep you in the loop end-to-end.',
    steps: [
      { text_ko: '/nexyfab/orders에서 주문 클릭 → 상세 drawer 열림', text_en: 'Click an order in /nexyfab/orders — detail drawer opens.' },
      { text_ko: '"마일스톤" 탭: 단계별 진행 + 파트너가 올린 사진/노트 (M4)', text_en: '"Milestones" tab: step progress + partner-uploaded photos/notes (M4).' },
      { text_ko: '"💬 대화" 탭: 파트너와 직접 메시지. 첨부 URL도 가능 (M1)', text_en: '"💬 Messages" tab: chat directly. Attachment URLs supported (M1).' },
      { text_ko: '파트너가 이메일로 답해도 메시지 thread에 자동 도착 (M5, 설정 필요)', text_en: 'Partner email replies auto-route into the thread (M5, requires setup).' },
      { text_ko: '"배송 추적" 탭: 트래킹 번호 + 운송장 상태', text_en: '"Shipment" tab: tracking number + carrier status.' },
    ],
  },
  {
    id: 'review',
    emoji: '⭐',
    title_ko: '주문 리뷰 작성',
    title_en: 'Review the order',
    blurb_ko: '납기/품질/소통을 차원별로 평가. 다음 구매자에게 도움.',
    blurb_en: 'Rate deadline/quality/comms separately. Helps next buyer.',
    steps: [
      { text_ko: '주문 상태가 "delivered"가 되면 "⭐ 리뷰 작성" 탭 활성화', text_en: 'Once order status is "delivered", "⭐ Review" tab unlocks.' },
      { text_ko: '종합 평점 + 납기 + 품질 + 소통 4개 차원 별점 (B8)', text_en: 'Overall + Deadline + Quality + Communication, 4 axes (B8).' },
      { text_ko: '낮은 평가 (≤3점) 시 의견 입력 권유 — 제조사에 전달', text_en: 'Low ratings (≤3) prompt comment box — passed to the partner.' },
      { text_ko: '단일 합산 점수가 아닌 차원별 점수가 다른 구매자에게 표시됨', text_en: 'Buyers see dimensional scores (no single composite — per spec).' },
      { text_ko: '이메일 알림 링크로 직접 이동 가능: /nexyfab/review/{orderId}', text_en: 'Email link goes straight to /nexyfab/review/{orderId}.' },
    ],
  },
  {
    id: 'pro-tips',
    emoji: '💎',
    title_ko: 'Pro+ 기능 알아두기',
    title_en: 'Pro+ feature highlights',
    blurb_ko: '결제 활성 후 사용 가능한 고급 기능들.',
    blurb_en: 'Advanced features unlocked after subscribing.',
    steps: [
      { text_ko: 'AI 에이전트 풀 사용 (Free는 잠금)', text_en: 'Full AI agent (Free is locked).' },
      { text_ko: '시뮬레이션 6종: CFD/MBD/CAM/Mold/Optics/Thermal — Pro 월 20회, Team 100회', text_en: '6 simulations: CFD/MBD/CAM/Mold/Optics/Thermal — Pro 20/mo, Team 100/mo.' },
      { text_ko: 'PMI/MBD STEP AP242 export (GD&T 풀 스펙 + 데이텀 타겟 + 표면조도)', text_en: 'PMI/MBD STEP AP242 export (full GD&T + datum targets + surface finish).' },
      { text_ko: '엔지니어링 카탈로그 RAG: 베어링/시일/재료 자문', text_en: 'Engineering catalog RAG: bearings/seals/materials advisory.' },
      { text_ko: '신뢰성 자료 (테스트 통과율, OCCT burn-in) → /trust 페이지 참조', text_en: 'Trust evidence (test pass rate, OCCT burn-in) → see /trust page.' },
    ],
    cta: { label_ko: '요금제 보기', label_en: 'See pricing', href: 'nexyfab/pricing' },
  },
];

const dict = {
  ko: {
    title: '사용 가이드',
    subtitle: '첫 설계부터 리뷰까지 — NexyFab 전체 흐름을 한눈에',
    expand: '펼치기',
    collapse: '접기',
    cta: '관련 페이지 →',
    contact: '도움이 더 필요하시면',
    contactLink: 'nexyfab@nexysys.com',
    intro: '7개 카드 중 궁금한 것을 펼쳐보세요. 카드 안에 단계별 안내가 있고, 관련 페이지로 바로 가는 버튼도 있습니다.',
    trust: '기술 신뢰성 자료가 궁금하다면',
    trustLink: '신뢰성 페이지',
  },
  en: {
    title: 'User Guide',
    subtitle: 'First design to review — NexyFab end-to-end in one page',
    expand: 'Expand',
    collapse: 'Collapse',
    cta: 'Related page →',
    contact: 'Need more help?',
    contactLink: 'nexyfab@nexysys.com',
    intro: 'Expand whichever card answers your question. Each has step-by-step instructions and a button to jump straight to the relevant page.',
    trust: 'For technical credibility data, see the',
    trustLink: 'Trust page',
  },
};

export default function HelpClient() {
  const params = useParams();
  const langRaw = (params?.lang as string) ?? 'ko';
  const lang: 'ko' | 'en' = (langRaw === 'kr' || langRaw === 'ko') ? 'ko' : 'en';
  const t = dict[lang];
  const [open, setOpen] = useState<Set<string>>(new Set([SECTIONS[0].id])); // first section open by default
  const langPrefix = lang === 'ko' ? 'kr' : 'en';

  const toggle = (id: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main style={pageStyle}>
      <h1 style={titleStyle}>{t.title}</h1>
      <p style={subtitleStyle}>{t.subtitle}</p>
      <p style={introStyle}>{t.intro}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SECTIONS.map(s => {
          const isOpen = open.has(s.id);
          return (
            <div key={s.id} style={cardStyle}>
              <button onClick={() => toggle(s.id)} style={cardHeaderBtn} aria-expanded={isOpen}>
                <span style={{ fontSize: 22, marginRight: 10 }}>{s.emoji}</span>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={cardTitleStyle}>{lang === 'ko' ? s.title_ko : s.title_en}</div>
                  <div style={cardBlurbStyle}>{lang === 'ko' ? s.blurb_ko : s.blurb_en}</div>
                </div>
                <span style={{ color: '#6b7280', fontSize: 18 }}>{isOpen ? '−' : '+'}</span>
              </button>

              {isOpen && (
                <div style={cardBodyStyle}>
                  <ol style={stepListStyle}>
                    {s.steps.map((st, i) => (
                      <li key={i} style={stepItemStyle}>
                        {lang === 'ko' ? st.text_ko : st.text_en}
                      </li>
                    ))}
                  </ol>
                  {s.cta && (
                    <a href={`/${langPrefix}/${s.cta.href}`} style={ctaBtnStyle}>
                      {lang === 'ko' ? s.cta.label_ko : s.cta.label_en} →
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={footerNoticeStyle}>
        <div style={{ marginBottom: 8 }}>
          {t.trust}{' '}
          <a href={`/${langPrefix}/trust`} style={linkStyle}>{t.trustLink}</a>
        </div>
        <div>
          {t.contact}{' '}
          <a href={`mailto:${t.contactLink}`} style={linkStyle}>{t.contactLink}</a>
        </div>
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 880, margin: '0 auto', padding: '48px 24px',
  fontFamily: 'system-ui, sans-serif', color: '#1f2937',
};
const titleStyle: React.CSSProperties = { fontSize: 32, fontWeight: 800, marginBottom: 6 };
const subtitleStyle: React.CSSProperties = { color: '#6b7280', marginTop: 0, marginBottom: 8, fontSize: 15 };
const introStyle: React.CSSProperties = {
  color: '#475569', marginTop: 0, marginBottom: 32, fontSize: 13, lineHeight: 1.6,
  padding: '12px 16px', background: '#f8fafc', borderRadius: 8, borderLeft: '3px solid #3b82f6',
};
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
  overflow: 'hidden', transition: 'border-color 0.15s',
};
const cardHeaderBtn: React.CSSProperties = {
  width: '100%', padding: '14px 18px',
  display: 'flex', alignItems: 'center', gap: 4,
  background: 'transparent', border: 'none',
  cursor: 'pointer', textAlign: 'left',
};
const cardTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: '#111827' };
const cardBlurbStyle: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 2 };
const cardBodyStyle: React.CSSProperties = {
  padding: '0 18px 18px 56px',
  borderTop: '1px solid #f3f4f6',
};
const stepListStyle: React.CSSProperties = {
  margin: '14px 0 12px', padding: '0 0 0 18px',
  fontSize: 13, lineHeight: 1.7, color: '#374151',
};
const stepItemStyle: React.CSSProperties = { marginBottom: 6 };
const ctaBtnStyle: React.CSSProperties = {
  display: 'inline-block', marginTop: 6,
  padding: '6px 14px', fontSize: 12, fontWeight: 600,
  background: '#3b82f6', color: '#fff',
  borderRadius: 6, textDecoration: 'none',
};
const footerNoticeStyle: React.CSSProperties = {
  marginTop: 48, padding: 16,
  background: '#eff6ff', border: '1px solid #bfdbfe',
  borderRadius: 8, fontSize: 13, color: '#1e40af',
};
const linkStyle: React.CSSProperties = {
  color: '#1e40af', fontWeight: 600, textDecoration: 'underline',
};
