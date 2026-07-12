import type { Metadata } from 'next';
import DesignInner from './DesignInner';

export const metadata: Metadata = {
  title: 'NexyFab 설계 — 아이디어 → 설계 → 검증(상시) → 제조',
  description:
    '자연어로 설계를 설명하면 AI가 범용 형상을 조합하고, 그 자리에서 manifold 실렌더로 상시 검증한 뒤 STL·STEP·HTML 뷰어로 내보내고 제조 견적까지 연결합니다.',
};

// 서버에서 ?domain= 을 읽어 prop으로 전달 → 클라이언트 useSearchParams/Suspense 불필요, SSR 유지.
export default async function DesignPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ domain?: string }>;
}) {
  const { lang } = await params;
  const { domain } = await searchParams;
  return <DesignInner lang={lang} initialDomain={domain ?? null} />;
}
