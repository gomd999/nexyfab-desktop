/**
 * R (Stage 4 wired) — DocRef adapter using replicad's importSTEP/STL +
 * intentToScad's existing SCAD source loader. Resolves http(s):// URLs
 * via fetch and local relative paths via Node fs.
 *
 * v1 supports STEP / IGES / STL geometry imports (via OCCT) and SCAD
 * source imports (raw text). Other formats (3MF, OBJ) need additional
 * importers — raise typed errors for now.
 */
import type { DocRefAdapter } from './tools';

function inferFormat(source: string, override?: string): 'step' | 'iges' | 'stl' | 'scad' | null {
  if (override) {
    const v = override.toLowerCase();
    if (v === 'step' || v === 'iges' || v === 'stl' || v === 'scad') return v;
  }
  const lower = source.toLowerCase();
  if (lower.endsWith('.step') || lower.endsWith('.stp')) return 'step';
  if (lower.endsWith('.iges') || lower.endsWith('.igs')) return 'iges';
  if (lower.endsWith('.stl')) return 'stl';
  if (lower.endsWith('.scad')) return 'scad';
  return null;
}

async function fetchBlob(source: string): Promise<{ ok: true; blob: Blob } | { ok: false; reason: string }> {
  if (/^https?:\/\//i.test(source)) {
    try {
      const resp = await fetch(source, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) return { ok: false, reason: `HTTP ${resp.status} ${resp.statusText}` };
      return { ok: true, blob: await resp.blob() };
    } catch (e) {
      return { ok: false, reason: `fetch failed: ${(e as Error).message}` };
    }
  }
  // Local path — server-side fs read.
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const abs = path.isAbsolute(source) ? source : path.join(process.cwd(), source);
    if (!fs.existsSync(abs)) return { ok: false, reason: `local file not found: ${abs}` };
    const bytes = fs.readFileSync(abs);
    return { ok: true, blob: new Blob([bytes]) };
  } catch (e) {
    return { ok: false, reason: `local read failed: ${(e as Error).message}` };
  }
}

export const serverDocRefAdapter: DocRefAdapter = {
  async resolve(args) {
    const fmt = inferFormat(args.source, args.format);
    if (!fmt) return { ok: false, reason: `cannot infer format from source — pass format: 'step' | 'iges' | 'stl' | 'scad'` };

    if (fmt === 'scad') {
      // SCAD is plain text — no OCCT involvement.
      const fetched = await fetchBlob(args.source);
      if (!fetched.ok) return fetched;
      const scadSource = await fetched.blob.text();
      return { ok: true, scadSource, format: 'scad' };
    }

    // Geometry formats — feed through OCCT.
    try {
      const { ensureOcctReady, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      await ensureOcctReady();
      const fetched = await fetchBlob(args.source);
      if (!fetched.ok) return fetched;

      const replicad = await import('replicad') as Record<string, unknown> & {
        importSTEP?: (b: Blob) => Promise<unknown>;
        importSTL?: (b: Blob) => Promise<unknown>;
      };
      let shape: unknown;
      if (fmt === 'step') {
        if (!replicad.importSTEP) return { ok: false, reason: 'replicad.importSTEP not available' };
        shape = await replicad.importSTEP(fetched.blob);
      } else if (fmt === 'iges') {
        // replicad's importSTEP often handles IGES too — if not, error
        // surfaces here and the agent can fall back to user-supplied STEP.
        if (!replicad.importSTEP) return { ok: false, reason: 'replicad importer not available' };
        shape = await replicad.importSTEP(fetched.blob);
      } else if (fmt === 'stl') {
        if (!replicad.importSTL) return { ok: false, reason: 'replicad.importSTL not available' };
        shape = await replicad.importSTL(fetched.blob);
      } else {
        return { ok: false, reason: `unsupported format: ${fmt}` };
      }
      if (!shape) return { ok: false, reason: `${fmt} import returned null` };
      const handle = registerShape(shape);
      return { ok: true, brepHandle: handle, format: fmt };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },
};
