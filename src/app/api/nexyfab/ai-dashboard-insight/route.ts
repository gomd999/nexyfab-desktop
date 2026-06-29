import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { chatCompletion, AiNotConfiguredError, type ChatMessage } from '@/lib/ai';

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ insight: '' }, { status: 401 });

  const { summary, lang = 'ko' } = await req.json().catch(() => ({}));
  if (!summary) return NextResponse.json({ insight: '' });

  const isKo = lang === 'ko';
  const systemPrompt = isKo
    ? '당신은 제조 플랫폼 운영 현황을 분석하는 AI 비서입니다. 현황 데이터를 보고 가장 중요한 인사이트를 한 문장(40자 이내)으로만 답하세요. 추가 설명 없이 핵심만.'
    : 'You are an AI assistant analyzing manufacturing platform operations. Respond with ONE sentence insight (under 60 chars). No extra explanation.';

  const userContent = isKo
    ? `활성 프로젝트: ${summary.activeProjects}개, 대기 RFQ: ${summary.pendingRfqs}건, 진행 주문: ${summary.activeOrders}건, 이번달 지출: ₩${summary.monthlySpend?.toLocaleString() || 0}`
    : `Active projects: ${summary.activeProjects}, Pending RFQs: ${summary.pendingRfqs}, Active orders: ${summary.activeOrders}, Monthly spend: ₩${summary.monthlySpend?.toLocaleString() || 0}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await chatCompletion({
      messages,
      maxTokens: 80,
      temperature: 0.3,
      timeoutMs: 10_000,
      task: 'ai-dashboard-insight',
    });
    return NextResponse.json({ insight: result.text.trim() });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ insight: '' });
    }
    return NextResponse.json({ insight: '' });
  }
}
