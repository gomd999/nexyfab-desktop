import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dbGetMessages, dbInsertMessage, type DbMessage } from '@/app/lib/db';
import { sanitizeText } from '@/app/lib/sanitize';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const messageSchema = z.object({
  contractId: z.string().min(1).max(100),
  sender: z.string().min(1).max(200),
  senderType: z.enum(['admin', 'partner', 'customer']),
  text: z.string().min(1).max(2000),
});

// GET /api/messages?contractId=xxx
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const contractId = searchParams.get('contractId');

  if (!contractId) {
    return NextResponse.json({ error: 'contractId가 필요합니다.' }, { status: 400 });
  }

  const messages = dbGetMessages(contractId);
  return NextResponse.json({ messages });
}

// POST /api/messages
// body: { contractId, sender, senderType, text }
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' },
        { status: 400 },
      );
    }
    const { contractId, sender, senderType, text } = parsed.data;

    const message: DbMessage = {
      id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contractId,
      sender,
      senderType,
      text: sanitizeText(text, 2000),
      createdAt: new Date().toISOString(),
    };

    dbInsertMessage(message);
    return NextResponse.json({ message }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '메시지 저장에 실패했습니다.' }, { status: 500 });
  }
}
