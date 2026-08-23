import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { chatCompletion, AiNotConfiguredError, type ChatMessage } from '@/lib/ai';
import { resolveServerLocale } from '@/lib/i18n/serverLocale';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ insight: '' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await readBoundedJson<Record<string, unknown>>(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ insight: '' }, { status: 413 });
  }
  const locale = resolveServerLocale(req, body.lang, 'kr');
  const summary = body.summary as Record<string, unknown> | undefined;
  if (!summary) return NextResponse.json({ insight: '' });

  const systemPrompt = `You are an AI assistant analyzing manufacturing platform operations. Respond with ONE concise sentence in ${locale.languageName} (under 60 characters where practical). No extra explanation.`;
  const numberFormat = new Intl.NumberFormat(locale.iso);
  const value = (key: string) => {
    const raw = summary[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  };
  const userContent = `Active projects: ${value('activeProjects')}, Pending RFQs: ${value('pendingRfqs')}, Active orders: ${value('activeOrders')}, Monthly spend: KRW ${numberFormat.format(value('monthlySpend'))}`;

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
    return NextResponse.json({ insight: result.text.trim(), outputLanguage: locale.route });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ insight: '' });
    }
    return NextResponse.json({ insight: '' });
  }
}
