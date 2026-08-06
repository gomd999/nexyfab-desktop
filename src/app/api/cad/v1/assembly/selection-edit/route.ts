import { NextRequest, NextResponse } from 'next/server';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  planAssemblySelectionEdits,
  type AssemblySelectionRef,
} from '@/lib/ai/assemblySelectionEdit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAssemblySelectionEditBrep } from '@/lib/ai/assemblySelectionEditBrepEvidence';
import { invalidateGenerationForEdit, type GenerationRunState } from '@/lib/ai/generationRunState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-selection-edit:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  }
  const body = await req.json().catch(() => null) as {
    state?: AssemblyState;
    featureTrees?: Record<string, FeatureTree>;
    selection?: AssemblySelectionRef[];
    selectedMateIds?: string[];
    command?: string;
    verifyBrep?: boolean;
    generationState?: GenerationRunState;
  } | null;
  if (!body?.state || !body.featureTrees || !Array.isArray(body.selection) || typeof body.command !== 'string' || !body.command.trim()) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'state, featureTrees, selection and command are required' }, { status: 400 });
  }
  try {
    let preview = planAssemblySelectionEdits({
      state: body.state,
      featureTrees: body.featureTrees,
      selection: body.selection,
      selectedMateIds: body.selectedMateIds,
      command: body.command,
    });
    if (body.verifyBrep === true) {
      preview = await verifyAssemblySelectionEditBrep(preview, body.featureTrees);
    }
    const generationState = body.generationState
      ? invalidateGenerationForEdit(body.generationState, preview.transaction)
      : undefined;
    return NextResponse.json({ ok: true, preview, ...(generationState ? { generationState } : {}), deterministic: true, quoteOrRfqSideEffects: false });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'UNSUPPORTED_EDIT', message: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
