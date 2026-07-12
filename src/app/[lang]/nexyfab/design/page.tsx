import type { Metadata } from 'next';
import { Suspense } from 'react';
import DesignInner from './DesignInner';

export const metadata: Metadata = {
  title: 'NexyFab 설계 — 아이디어 → 설계 → 검증(상시) → 제조',
  description:
    '자연어로 설계를 설명하면 AI가 범용 형상을 조합하고, 그 자리에서 manifold 실렌더로 상시 검증한 뒤 STL·STEP·HTML 뷰어로 내보내고 제조 견적까지 연결합니다.',
};

export default async function DesignPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  // DesignInner uses useSearchParams(?domain=) → needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <DesignInner lang={lang} />
    </Suspense>
  );
}
