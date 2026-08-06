import { NextRequest, NextResponse } from 'next/server';
import type { AssemblyAnimation } from '@/lib/assembly/assemblyAnimation';
import { validateAssemblyAnimation } from '@/lib/assembly/assemblyAnimation';
import { applyAssemblyAnimationCommand } from '@/lib/assembly/assemblyAnimationCommand';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-animation-command:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as {
    state?: AssemblyState;
    animation?: AssemblyAnimation;
    command?: string;
  } | null;
  if (!body?.state || !body.animation || typeof body.command !== 'string' || !body.command.trim()) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'state, animation and command are required' },
      { status: 400 },
    );
  }

  const existingErrors = validateAssemblyAnimation(body.animation, body.state);
  if (existingErrors.length) {
    return NextResponse.json({ ok: false, code: 'INVALID_ANIMATION', errors: existingErrors }, { status: 422 });
  }

  try {
    const result = applyAssemblyAnimationCommand(body.state, body.animation, body.command);
    const errors = validateAssemblyAnimation(result.animation, body.state);
    if (errors.length) {
      return NextResponse.json({ ok: false, code: 'INVALID_RESULT', errors }, { status: 422 });
    }
    return NextResponse.json({ ok: true, ...result, deterministic: true, quoteOrRfqSideEffects: false });
  } catch (error) {
    return NextResponse.json(
      { ok: false, code: 'UNSUPPORTED_COMMAND', message: error instanceof Error ? error.message : String(error) },
      { status: 422 },
    );
  }
}
