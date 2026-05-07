import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NexyFab 요금제 — Free, Pro, Team | 제조 설계 SaaS',
  description: '무료로 시작해 Pro 또는 Team 플랜으로 업그레이드하세요. DFM 분석, 비용 자동 추정, IP 보호 공유 링크 포함.',
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
