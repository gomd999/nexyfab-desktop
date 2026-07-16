/**
 * /nexyfab/ai — AI 설계 스튜디오 앱 창 (2026-07-16).
 * Gemini/Genspark형: 통합 사이드바(분야·채팅 내역·프로젝트) + 중앙 풀챗.
 * ChatHero appMode 재사용 — 스레드 저장소·?t= 딥링크·Studio 핸드오프 전부 랜딩 챗과 공유.
 */
import type { Metadata } from 'next';
import ChatHero from '../../ChatHero';
import AiThemeLock from './AiThemeLock';
import { buildMetadata } from '@/lib/metaHelper';

export async function generateMetadata(
  { params }: { params: Promise<{ lang: string }> }
): Promise<Metadata> {
  const { lang } = await params;
  return buildMetadata(lang, 'nexyfab');
}

export default async function NexyfabAiPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
      <AiThemeLock />
      <ChatHero langCode={lang} appMode />
    </div>
  );
}
