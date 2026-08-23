import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { generateMesh, retextureMesh, pollMesh, isMeshGenConfigured } from '@/lib/ai/meshGen';
import { readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;

// Organic 3D mesh-generation track (text/image → GLB) — the complement to the
// CSG/OpenSCAD track for shapes CSG can't do (animals, characters, freeform).
// SCAFFOLD: returns 501 until a provider key (MESHY_API_KEY / REPLICATE_API_TOKEN)
// is configured. POST starts a job; GET ?job=<id> polls it.

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isMeshGenConfigured()) {
    return NextResponse.json(
      { status: 'disabled', error: 'Organic mesh generation is not configured. Set MESHY_API_KEY or REPLICATE_API_TOKEN.' },
      { status: 501 },
    );
  }
  const body = (await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => ({}))) as {
    action?: 'generate' | 'refine' | 'retexture'; prompt?: string; image?: string; seed?: number; modelUrl?: string;
  };
  // Retexture: shape fixed, surface regenerated from a style prompt.
  if (body.action === 'retexture') {
    if (!body.modelUrl || !body.prompt) return NextResponse.json({ error: 'modelUrl and prompt are required' }, { status: 400 });
    const r = await retextureMesh({ modelUrl: body.modelUrl, prompt: body.prompt });
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  }
  // Generate / refine (refine = edited prompt + pinned seed so it stays close).
  const prompt = (body.prompt ?? '').trim();
  if (!prompt && !body.image) return NextResponse.json({ error: 'prompt or image is required' }, { status: 400 });
  const result = await generateMesh({ prompt, image: body.image, seed: body.seed });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isMeshGenConfigured()) {
    return NextResponse.json({ status: 'disabled', error: 'Organic mesh generation is not configured.' }, { status: 501 });
  }
  const jobId = req.nextUrl.searchParams.get('job');
  if (!jobId) return NextResponse.json({ error: 'job query param is required' }, { status: 400 });
  const result = await pollMesh(jobId);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
