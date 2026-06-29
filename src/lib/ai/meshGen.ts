/**
 * Organic 3D mesh generation — the "mesh track" that complements the CSG /
 * OpenSCAD track. CSG can't do organic/sculptural shapes (animals, characters,
 * freeform surfaces); this routes text/image prompts to an external 3D-gen
 * provider that returns a GLB mesh.
 *
 * SCAFFOLD: provider-agnostic and DISABLED until a key is configured. Set one of
 *   - MESHY_API_KEY        → Meshy (text-to-3d / image-to-3d)
 *   - REPLICATE_API_TOKEN  → Replicate (+ REPLICATE_MESH_VERSION for the model)
 * With no key, generateMesh() returns { status: 'disabled' } so the UI can show a
 * clear "not configured" message instead of failing.
 */

export interface MeshGenRequest {
  prompt: string;
  /** optional data-URL or public image URL for image-to-3D */
  image?: string;
}

export type MeshGenStatus = 'disabled' | 'queued' | 'processing' | 'done' | 'error';

export interface MeshGenResult {
  ok: boolean;
  status: MeshGenStatus;
  provider?: 'meshy' | 'replicate';
  /** job id to poll while status is queued/processing */
  jobId?: string;
  /** final mesh URL (GLB) when status === 'done' */
  glbUrl?: string;
  error?: string;
}

export function meshGenProvider(): 'meshy' | 'replicate' | null {
  if (process.env.MESHY_API_KEY) return 'meshy';
  if (process.env.REPLICATE_API_TOKEN) return 'replicate';
  return null;
}

export function isMeshGenConfigured(): boolean {
  return meshGenProvider() !== null;
}

const DISABLED: MeshGenResult = {
  ok: false,
  status: 'disabled',
  error: 'Organic mesh generation is not configured. Set MESHY_API_KEY or REPLICATE_API_TOKEN to enable it.',
};

// ─── Meshy ───────────────────────────────────────────────────────────────────
async function meshyStart(req: MeshGenRequest): Promise<MeshGenResult> {
  const key = process.env.MESHY_API_KEY!;
  const useImage = !!req.image;
  const url = useImage
    ? 'https://api.meshy.ai/openapi/v1/image-to-3d'
    : 'https://api.meshy.ai/openapi/v2/text-to-3d';
  const body = useImage
    ? { image_url: req.image, enable_pbr: true }
    : { mode: 'preview', prompt: req.prompt, art_style: 'realistic', ai_model: 'meshy-4' };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { result?: string; id?: string; message?: string };
  if (!r.ok) return { ok: false, status: 'error', provider: 'meshy', error: j.message || `meshy ${r.status}` };
  return { ok: true, status: 'queued', provider: 'meshy', jobId: j.result ?? j.id };
}

async function meshyPoll(jobId: string): Promise<MeshGenResult> {
  const key = process.env.MESHY_API_KEY!;
  // text-to-3d and image-to-3d share a retrieve-by-id shape close enough for the
  // fields we read; try the v2 task endpoint first.
  const r = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${jobId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const j = (await r.json().catch(() => ({}))) as {
    status?: string; progress?: number; model_urls?: { glb?: string }; message?: string;
  };
  if (!r.ok) return { ok: false, status: 'error', provider: 'meshy', error: j.message || `meshy ${r.status}` };
  if (j.status === 'SUCCEEDED') return { ok: true, status: 'done', provider: 'meshy', jobId, glbUrl: j.model_urls?.glb };
  if (j.status === 'FAILED' || j.status === 'CANCELED') return { ok: false, status: 'error', provider: 'meshy', error: j.message || 'meshy job failed' };
  return { ok: true, status: 'processing', provider: 'meshy', jobId };
}

// ─── Replicate ───────────────────────────────────────────────────────────────
async function replicateStart(req: MeshGenRequest): Promise<MeshGenResult> {
  const key = process.env.REPLICATE_API_TOKEN!;
  const version = process.env.REPLICATE_MESH_VERSION;
  if (!version) return { ok: false, status: 'error', provider: 'replicate', error: 'REPLICATE_MESH_VERSION not set (the model version to run).' };
  const r = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, input: req.image ? { image: req.image } : { prompt: req.prompt } }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; detail?: string };
  if (!r.ok) return { ok: false, status: 'error', provider: 'replicate', error: j.detail || `replicate ${r.status}` };
  return { ok: true, status: 'queued', provider: 'replicate', jobId: j.id };
}

async function replicatePoll(jobId: string): Promise<MeshGenResult> {
  const key = process.env.REPLICATE_API_TOKEN!;
  const r = await fetch(`https://api.replicate.com/v1/predictions/${jobId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const j = (await r.json().catch(() => ({}))) as { status?: string; output?: unknown; error?: string };
  if (!r.ok) return { ok: false, status: 'error', provider: 'replicate', error: j.error || `replicate ${r.status}` };
  if (j.status === 'succeeded') {
    const out = j.output;
    const glbUrl = typeof out === 'string' ? out
      : Array.isArray(out) ? out.find(x => typeof x === 'string' && /\.glb($|\?)/i.test(x)) as string | undefined
      : (out as { glb?: string; mesh?: string })?.glb ?? (out as { mesh?: string })?.mesh;
    return { ok: true, status: 'done', provider: 'replicate', jobId, glbUrl };
  }
  if (j.status === 'failed' || j.status === 'canceled') return { ok: false, status: 'error', provider: 'replicate', error: j.error || 'replicate job failed' };
  return { ok: true, status: 'processing', provider: 'replicate', jobId };
}

// ─── Public API ──────────────────────────────────────────────────────────────
export async function generateMesh(req: MeshGenRequest): Promise<MeshGenResult> {
  const p = meshGenProvider();
  if (!p) return DISABLED;
  try {
    return p === 'meshy' ? await meshyStart(req) : await replicateStart(req);
  } catch (e) {
    return { ok: false, status: 'error', provider: p, error: e instanceof Error ? e.message : 'mesh-gen failed' };
  }
}

export async function pollMesh(jobId: string): Promise<MeshGenResult> {
  const p = meshGenProvider();
  if (!p) return DISABLED;
  try {
    return p === 'meshy' ? await meshyPoll(jobId) : await replicatePoll(jobId);
  } catch (e) {
    return { ok: false, status: 'error', provider: p, error: e instanceof Error ? e.message : 'poll failed' };
  }
}
