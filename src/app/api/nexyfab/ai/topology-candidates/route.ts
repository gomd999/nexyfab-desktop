import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { generateTopologyCandidates, type TopologyGoal } from '@/lib/ai/topologyCandidates';
import { readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;

const goalSchema = z.object({
  massReductionTarget: z.number().min(0).max(0.95),
  stiffnessTolerance: z.number().min(0).max(0.95),
  process: z.enum(['machining', 'casting', 'sheet', 'fdm', 'sla', 'mim']),
  load: z.object({
    kind: z.enum(['bending', 'torsion', 'axial', 'thermal']),
    magnitudeN: z.number().optional(),
  }).optional(),
});

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => null);
  const parsed = goalSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid goal' },
      { status: 400 },
    );
  }
  const candidates = generateTopologyCandidates(parsed.data as TopologyGoal);
  return NextResponse.json({ candidates });
}
