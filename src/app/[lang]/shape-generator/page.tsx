import { redirect } from 'next/navigation';
import ShapeGeneratorClientPage from './ShapeGeneratorClientPage';

/**
 * Expert CAD 게이트.
 *
 * 전문가 3D 설계 스튜디오는 사람에게 직접 노출하지 않는다. 사용자는 채팅(랜딩
 * ChatHero)으로 진입하고, 실제 형상/연산은 AI가 /api/* 오케스트레이션으로 수행한다.
 * 이 페이지는 `?expert=1`(또는 true) 플래그가 있을 때에만 열리며, 그 외에는 채팅
 * 랜딩으로 되돌린다. AI 백엔드 라우트(shape-chat, scad-*, *-render 등)는 개방 유지.
 */
export default async function ShapeGeneratorPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang } = await params;
  const sp = await searchParams;
  const flag = sp?.expert;
  const enabled = flag === '1' || flag === 'true';
  // 1차 차단은 middleware(엣지 307). 이 서버 게이트는 방어적 백스톱이다.
  if (!enabled) redirect(`/${lang}#nf-chat`);
  return <ShapeGeneratorClientPage />;
}
