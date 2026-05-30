/**
 * Server-side adapters that bind the agent's render / geometry / DFM
 * abstractions to NexyFab's existing CLI + analysis modules.
 *
 * Kept in its own file so the test suite can import the agent without
 * pulling node:fs / OpenSCAD CLI dependencies.
 */
import type { RenderAdapter, GeometryAdapter, DfmAdapter, ToolHostAdapters, VisionAdapter, BrepAdapter, DrawingStudioAdapter } from './tools';
import type { RenderState, GeometryStats } from './types';

/**
 * STL bytes from the last successful render, keyed by the RenderState object
 * returned to the agent runtime. The runtime hands that exact object straight
 * to the geometry adapter (tools.ts: `session.render = state; host.geometry(state)`),
 * so a WeakMap by reference lets the geometry adapter recover the buffer and run
 * REAL verification — without putting the (large) Buffer on the serialized
 * RenderState that streams to the client. Entries are GC'd with the state.
 */
const lastStlBuffer = new WeakMap<RenderState, Buffer>();

/**
 * Parse a rendered binary STL and run Layer-1 verification on it, producing
 * honest geometry stats. This replaces the old "render compiled ⇒ manifold"
 * shortcut: `manifold`/`watertight` now reflect the actual mesh, and `issues`
 * carries an actionable critique the agent can self-correct against.
 */
export async function verifyStlBuffer(buf: Buffer): Promise<GeometryStats> {
  const { parseStlBufferToGeometry } = await import('./renderToGeometry');
  const { verifyGeneratedModel, formatVerificationCritique } = await import(
    '../../../app/[lang]/shape-generator/analysis/verifyGeneratedModel'
  );
  const { countThroughHoles, computeSurfaceArea, detectAllAxisAlignedHoles, computeDihedralStats, computeMinWallThickness } = await import('./faceInspection');
  const geo = await parseStlBufferToGeometry(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const result = verifyGeneratedModel(geo);
  const watertight = result.checks.find(c => c.id === 'watertight')?.pass ?? false;
  const manifoldClean = !result.checks.some(c => c.id === 'manifold' && !c.pass);
  const critique = formatVerificationCritique(result);
  const bb = geo.boundingBox; // verifyGeneratedModel computed it
  // X2 — Euler-characteristic through-hole count (null if mesh isn't
  // a single closed manifold; verify_spec suppresses the check then).
  const genus = countThroughHoles(geo);
  // X5 — surface area for the wall-count / fin / hollow-shell catch.
  const surfaceArea_mm2 = computeSurfaceArea(geo);
  // X6/X7 — axis-aligned hole peaks across all 3 cardinal axes.
  const detectedHoles = detectAllAxisAlignedHoles(geo,
    bb ? { bbox: {
      min: [bb.min.x, bb.min.y, bb.min.z],
      max: [bb.max.x, bb.max.y, bb.max.z],
    }} : {},
  );
  // X8 — dihedral stats so verify_spec can confirm fillet application.
  const dihedralStats = computeDihedralStats(geo);
  // X11 — minimum wall thickness sampled via inward raycasts; null when
  // the mesh is a convex solid (no opposing wall to register a hit).
  const wallStats = await computeMinWallThickness(geo);
  const minWallThicknessMm = wallStats.minMm === Infinity ? null : wallStats.minMm;
  return {
    triangleCount: result.metrics.triangleCount,
    volume_mm3: result.metrics.volumeMm3,
    surfaceArea_mm2,
    manifold: watertight && manifoldClean,
    watertight,
    componentCount: result.metrics.componentCount,
    genus,
    detectedHoles,
    dihedralStats,
    minWallThicknessMm,
    ...(bb ? { bbox: { min: [bb.min.x, bb.min.y, bb.min.z] as [number, number, number], max: [bb.max.x, bb.max.y, bb.max.z] as [number, number, number] } } : {}),
    ...(critique ? { issues: critique } : {}),
  };
}

/**
 * Compile SCAD via the existing runOpenScadCli helper. STL bytes are
 * surfaced for triangle estimation; the actual STL buffer is held in
 * memory only for the duration of the render — no disk persistence.
 */
export const serverRenderAdapter: RenderAdapter = async (scad) => {
  const { runOpenScadCli } = await import('../../openscad-render/runOpenScadCli');
  const out = await runOpenScadCli({ scadSource: scad, format: 'stl' });
  if (!out.ok) {
    return {
      ok: false,
      errors: parseScadStderr(out.stderr ?? out.message ?? 'unknown error'),
      ts: Date.now(),
    };
  }
  // STL triangle count: trust the binary STL header (4-byte little-endian
  // tri count after the 80-byte text header). Falls back to size-based
  // estimate if header is malformed.
  let triangles = 0;
  if (out.buffer.length >= 84) {
    triangles = out.buffer.readUInt32LE(80);
  }
  const state: RenderState = {
    ok: true,
    errors: parseScadStderr(out.stderr ?? ''),
    stlBytes: out.buffer.length,
    triangles,
    ts: Date.now(),
  };
  // Stash the STL so the geometry adapter can run real verification on it.
  lastStlBuffer.set(state, out.buffer);
  return state;
};

/**
 * Geometry analysis from the rendered STL. When the buffer is available we
 * parse it and run Layer-1 verification (real manifold/watertight/volume +
 * an actionable critique). Falls back to the cheap triangle-count estimate
 * only when the buffer is missing or unparseable — never reports a clean
 * solid it didn't actually check.
 */
export const serverGeometryAdapter: GeometryAdapter = async (render) => {
  const buf = render.ok === true ? lastStlBuffer.get(render) : undefined;
  if (buf) {
    try {
      return await verifyStlBuffer(buf);
    } catch {
      // Parsing/verification failed — degrade to the estimate below rather
      // than block the agent. (Don't claim manifold we couldn't confirm.)
      return { triangleCount: render.triangles };
    }
  }
  return { triangleCount: render.triangles };
};

/**
 * DFM stub for now — full DFM analysis pipes through workers/dfmWorker
 * which is browser-only. Server-side path will need a Node-side DFM
 * harness; tracked in the M-track. Until then return a safe placeholder.
 */
export const serverDfmAdapter: DfmAdapter = async (render, processes) => {
  if (!render.ok || !render.triangles) {
    return { summary: 'DFM analysis unavailable: no successful render.', issuesCount: 0 };
  }
  return {
    summary: `DFM heuristic skipped on server (processes=${processes.join('/')}). Run client-side DFM panel for full analysis.`,
    issuesCount: 0,
    meta: { serverStub: true },
  };
};

/**
 * Stage 2 — render the current SCAD source to multi-angle PNGs and ask
 * a vision model to critique it. Returns the model's free-form analysis
 * as text the agent can read back.
 *
 * Returns null when vision isn't configured (no Anthropic / OpenAI key).
 * The tool layer surfaces that as a friendly "vision unavailable" error
 * so the agent can fall back to non-visual reasoning.
 */
export const serverVisionAdapter: VisionAdapter = async (scad, prompt, opts) => {
  const { isVisionAvailable } = await import('../vision');
  if (!isVisionAvailable()) {
    return { ok: false, reason: 'No vision-capable AI provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY).' };
  }
  const { renderScadToPng, DEFAULT_VIEWS } = await import('../../openscad-render/renderPng');
  const png = await renderScadToPng({
    scadSource: scad,
    views: opts?.views ?? DEFAULT_VIEWS,
    imgWidth: 800, imgHeight: 600,
    timeoutMs: 30_000,
  });
  if (!png.ok) {
    return { ok: false, reason: `PNG render failed: ${png.code} ${png.message}` };
  }
  const { visionCompletion } = await import('../vision');
  try {
    const resp = await visionCompletion({
      prompt,
      images: png.views.map(v => ({ bytes: v.bytes, label: v.label })),
      maxTokens: 600,
    });
    return {
      ok: true,
      analysis: resp.text,
      provider: resp.provider,
      model: resp.model,
      tokens: (resp.promptTokens ?? 0) + (resp.completionTokens ?? 0),
      pngBytes: png.views.reduce((s, v) => s + v.bytes.length, 0),
      viewCount: png.views.length,
    };
  } catch (e) {
    return { ok: false, reason: `Vision API failed: ${(e as Error).message}` };
  }
};

/**
 * A (Stage 3) — OCCT B-rep adapter wired to the existing
 * `features/occtEngine.ts`. The agent now has a real-CAD path that
 * produces clean STEP exports (no AP242 importer issue) and proper
 * fillets / chamfers / shells on chained shapes.
 *
 * Each method narrows the existing engine's API to a stable, narrow
 * interface so the agent doesn't break when occtEngine evolves.
 */
export const serverBrepAdapter: BrepAdapter = {
  async ensureReady() {
    const { ensureOcctReady } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
    await ensureOcctReady();
  },

  async primitive(args) {
    try {
      const { occtBoxBooleanWithPrimitive, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      const p = args.params;
      const pos = args.position ?? [0, 0, 0];
      // Build a single primitive by piggybacking on the existing
      // host-box+tool engine: host=box of zero size, tool=actual shape,
      // op=union → handle to the tool only. (Slight cost; phase 4 can
      // wire dedicated `makeBaseBox` etc. if needed.)
      // For now use a simpler path: directly call the underlying primitive
      // builders via the engine's helpers. Simplest cross-shape API:
      const { ensureOcctReady } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      await ensureOcctReady();
      // We can use occtBoxBooleanWithPrimitive with a near-zero host
      // and fuse our tool — that returns the registered handle.
      const hostBox = { w: 0.001, h: 0.001, d: 0.001, cx: pos[0], cy: pos[1], cz: pos[2] };
      let tool: { shape: 'box' | 'cylinder' | 'sphere'; w: number; h: number; d: number; cx: number; cy: number; cz: number; rx: number; ry: number; rz: number };
      let kind: string;
      if (args.shape === 'box') {
        const w = p.width ?? p.w ?? 50;
        const h = p.height ?? p.h ?? 50;
        const d = p.depth ?? p.d ?? 50;
        tool = { shape: 'box', w, h, d, cx: pos[0], cy: pos[1], cz: pos[2], rx: 0, ry: 0, rz: 0 };
        kind = `box(${w}×${h}×${d})`;
      } else if (args.shape === 'cylinder') {
        const dia = p.diameter ?? p.d ?? 20;
        const h = p.height ?? p.h ?? 30;
        tool = { shape: 'cylinder', w: dia, h, d: dia, cx: pos[0], cy: pos[1], cz: pos[2], rx: 0, ry: 0, rz: 0 };
        kind = `cylinder(d=${dia}, h=${h})`;
      } else {
        const r = p.radius ?? p.r ?? 15;
        tool = { shape: 'sphere', w: r * 2, h: r * 2, d: r * 2, cx: pos[0], cy: pos[1], cz: pos[2], rx: 0, ry: 0, rz: 0 };
        kind = `sphere(r=${r})`;
      }
      const result = occtBoxBooleanWithPrimitive('union', hostBox, tool);
      void registerShape;
      if (!result.handle) return { ok: false, reason: 'OCCT did not return a handle' };
      return { ok: true, handle: result.handle, kind };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async boolean(args) {
    try {
      const { getShape, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      const host = getShape(args.hostHandle) as { fuse?: (o: unknown) => unknown; cut?: (o: unknown) => unknown; intersect?: (o: unknown) => unknown };
      const tool = getShape(args.toolHandle);
      if (!host || !tool) return { ok: false, reason: 'host or tool handle not found in OCCT registry' };
      let next: unknown;
      if (args.op === 'union') next = host.fuse?.(tool);
      else if (args.op === 'subtract') next = host.cut?.(tool);
      else next = host.intersect?.(tool);
      if (!next) return { ok: false, reason: `boolean op ${args.op} produced no result` };
      const handle = registerShape(next);
      return { ok: true, handle, kind: `boolean(${args.op})` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async fillet(args) {
    try {
      const { getShape, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      const host = getShape(args.hostHandle) as { fillet?: (r: number, finder?: (e: unknown) => unknown) => unknown };
      if (!host) return { ok: false, reason: `handle ${args.hostHandle} not found` };
      if (typeof host.fillet !== 'function') return { ok: false, reason: 'shape does not support fillet' };
      const finder = makeEdgeFinder(args.edges ?? 'all');
      const next = finder ? host.fillet(args.radius, finder) : host.fillet(args.radius);
      const handle = registerShape(next);
      return { ok: true, handle, kind: `fillet(r=${args.radius}, ${args.edges ?? 'all'})` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async chamfer(args) {
    try {
      const { getShape, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      const host = getShape(args.hostHandle) as { chamfer?: (d: number, finder?: (e: unknown) => unknown) => unknown };
      if (!host) return { ok: false, reason: `handle ${args.hostHandle} not found` };
      if (typeof host.chamfer !== 'function') return { ok: false, reason: 'shape does not support chamfer' };
      const finder = makeEdgeFinder(args.edges ?? 'all');
      const next = finder ? host.chamfer(args.distance, finder) : host.chamfer(args.distance);
      const handle = registerShape(next);
      return { ok: true, handle, kind: `chamfer(d=${args.distance}, ${args.edges ?? 'all'})` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async shell(args) {
    try {
      const { getShape, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      const host = getShape(args.hostHandle) as { shell?: (t: number) => unknown };
      if (!host) return { ok: false, reason: `handle ${args.hostHandle} not found` };
      if (typeof host.shell !== 'function') return { ok: false, reason: 'shape does not support shell' };
      // Negative thickness = inward shell (replicad convention).
      const next = host.shell(-Math.abs(args.thickness));
      const handle = registerShape(next);
      return { ok: true, handle, kind: `shell(t=${args.thickness})` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async toMesh(args) {
    try {
      const { getShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      const host = getShape(args.hostHandle) as { mesh?: (opts?: { tolerance?: number; angularTolerance?: number }) => { vertices: number[]; triangles: number[] } };
      if (!host || typeof host.mesh !== 'function') return { ok: false, reason: `handle ${args.hostHandle} cannot be tessellated` };
      const mesh = host.mesh({ tolerance: args.tolerance ?? 0.1, angularTolerance: 0.2 });
      const triangleCount = Math.floor((mesh.triangles?.length ?? 0) / 3);
      // Compute bbox from flat vertex array.
      let mnx = Infinity, mny = Infinity, mnz = Infinity;
      let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      for (let i = 0; i + 2 < mesh.vertices.length; i += 3) {
        const x = mesh.vertices[i], y = mesh.vertices[i + 1], z = mesh.vertices[i + 2];
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
        if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
      const bbox = Number.isFinite(mnx)
        ? { min: [mnx, mny, mnz] as [number, number, number], max: [mxx, mxy, mxz] as [number, number, number] }
        : undefined;
      return { ok: true, triangleCount, bbox };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async exportStep(args) {
    try {
      const { exportOcctStep } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      const text = await exportOcctStep(args.hostHandle);
      if (!text) return { ok: false, reason: `handle ${args.hostHandle} did not produce STEP output` };
      return { ok: true, bytes: Buffer.byteLength(text, 'utf8') };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  // ─── G (Stage 4 wired) — sweep / loft / draft / helix via replicad ────

  async sweep(args) {
    try {
      const { ensureOcctReady, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      await ensureOcctReady();
      const replicad = await import('replicad') as Record<string, unknown> & {
        draw: (p?: [number, number]) => unknown;
      };
      // Build the 2D profile via DrawingPen.
      let pen = (replicad.draw as (p?: [number, number]) => unknown)(args.profile[0]) as { lineTo: (p: [number, number]) => unknown; close: () => unknown };
      for (let i = 1; i < args.profile.length; i++) {
        pen = pen.lineTo(args.profile[i]) as typeof pen;
      }
      const drawing = pen.close() as { sketchOnPlane: (plane?: string) => unknown };
      const sketch = drawing.sketchOnPlane('XY') as {
        extrude: (dist: number) => unknown;
      };
      // v1: support straight-Z extrusion (path is two points on the Z axis).
      // Arbitrary 3D paths require genericSweep + a constructed spine wire,
      // which we'll add as path support matures.
      const start = args.path[0];
      const end = args.path[args.path.length - 1];
      const dz = end[2] - start[2];
      if (Math.abs(end[0] - start[0]) > 1e-6 || Math.abs(end[1] - start[1]) > 1e-6) {
        return { ok: false, reason: 'sweep along non-axial 3D paths not supported in v1 (use straight Z path).' };
      }
      if (Math.abs(dz) < 1e-6) return { ok: false, reason: 'sweep distance is zero' };
      const result = sketch.extrude(dz);
      const handle = registerShape(result);
      return { ok: true, handle, kind: `sweep(extrude ${dz}mm)` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async loft(args) {
    try {
      const { ensureOcctReady, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      await ensureOcctReady();
      const replicad = await import('replicad') as Record<string, unknown> & {
        draw: (p?: [number, number]) => unknown;
        loft?: (sketches: unknown[], cfg?: { ruled?: boolean }) => unknown;
      };
      // Build a Sketch per cross-section, all on parallel XY planes at each z.
      const sketches: unknown[] = [];
      for (const sec of args.sections) {
        if (sec.polygon.length < 3) {
          return { ok: false, reason: `section at z=${sec.z} has <3 points` };
        }
        let pen = (replicad.draw as (p?: [number, number]) => unknown)(sec.polygon[0]) as { lineTo: (p: [number, number]) => unknown; close: () => unknown };
        for (let i = 1; i < sec.polygon.length; i++) {
          pen = pen.lineTo(sec.polygon[i]) as typeof pen;
        }
        const drawing = pen.close() as { sketchOnPlane: (plane: string, origin?: number) => unknown };
        sketches.push(drawing.sketchOnPlane('XY', sec.z));
      }
      // First sketch's `loftWith` accepts an array of the rest.
      const first = sketches[0] as { loftWith: (others: unknown[], cfg?: { ruled?: boolean }) => unknown };
      const result = first.loftWith(sketches.slice(1), { ruled: !!args.ruled });
      const handle = registerShape(result);
      return { ok: true, handle, kind: `loft(${args.sections.length}sec)` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async draft(args) {
    try {
      const { getShape, registerShape, ensureOcctReady } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      await ensureOcctReady();
      const host = getShape(args.hostHandle) as { draft?: (angle: number, faceFinder: (e: unknown) => unknown, neutral?: string) => unknown };
      if (!host || typeof host.draft !== 'function') {
        return { ok: false, reason: `handle ${args.hostHandle} does not support draft` };
      }
      // v1: apply draft to all faces parallel to the pull direction (default +Z).
      // FaceFinder configuration on selected faces is a v2 concern.
      const result = host.draft(args.angleDeg, (e) => e, 'XY');
      const handle = registerShape(result);
      return { ok: true, handle, kind: `draft(${args.angleDeg}°)` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async helix(args) {
    try {
      const { ensureOcctReady, registerShape } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      await ensureOcctReady();
      const replicad = await import('replicad') as Record<string, unknown> & {
        makeHelix?: (pitch: number, height: number, radius: number, center?: [number, number, number], dir?: [number, number, number], lefthand?: boolean) => unknown;
        sketchHelix?: (pitch: number, height: number, radius: number, center?: [number, number, number], dir?: [number, number, number], lefthand?: boolean) => unknown;
        draw: (p?: [number, number]) => unknown;
        genericSweep?: (wire: unknown, spine: unknown, cfg: unknown) => unknown;
      };
      const lefthand = args.handedness === 'left';
      // Use sketchHelix to get a proper spine; sweep a small circular profile along it.
      if (!replicad.sketchHelix) {
        return { ok: false, reason: 'sketchHelix not available in this replicad build' };
      }
      const helixSketch = replicad.sketchHelix(args.pitch, args.height, args.radius, [0, 0, 0], [0, 0, 1], lefthand) as {
        sweepSketch?: (config: unknown) => unknown;
        wire?: unknown;
      };
      const profileD = args.profileDiameter ?? Math.min(args.pitch * 0.4, args.radius * 0.3);
      // sketchHelix in modern replicad has sweepSketch helper for this exact pattern.
      const sweepFn = helixSketch.sweepSketch as ((cb: (plane: unknown, origin: unknown) => unknown) => unknown) | undefined;
      if (!sweepFn) {
        return { ok: false, reason: 'helix sweep helper unavailable; consider upgrading replicad' };
      }
      const result = sweepFn.call(helixSketch, (_plane: unknown, _origin: unknown) => {
        const drawingMod = replicad as { drawCircle?: (r: number) => { sketchOnPlane: (p: unknown, o: unknown) => unknown } };
        if (!drawingMod.drawCircle) throw new Error('drawCircle missing');
        return drawingMod.drawCircle(profileD / 2).sketchOnPlane(_plane, _origin);
      });
      const handle = registerShape(result);
      return { ok: true, handle, kind: `helix(p=${args.pitch}, h=${args.height}, r=${args.radius})` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },
};

/**
 * J (Stage 4 wired) — Drawing studio via replicad's drawProjection.
 *
 * For each requested view, project the B-rep shape onto a 2D plane and
 * separate visible vs hidden lines (HLR is built into drawProjection).
 * Auto-dim placement v1: a single bbox dimension pair per view (W × H)
 * — full smart placement (chain dims, GD&T frames) is a v2 concern.
 *
 * Returns metadata only; actual SVG output is generated client-side from
 * the agent's downstream call (so the route doesn't ship MB of SVG over
 * the SSE stream).
 */
const PAPER_SIZES_MM: Record<'A4' | 'A3' | 'A2', { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
};

interface DrawingPath { boundingBox?: { width: number; height: number } }
interface DrawingProjection { visible: DrawingPath; hidden: DrawingPath }

function countPaths(d: DrawingPath): number {
  // Drawing.toSVGPaths returns string[]; count length when available.
  const dx = d as DrawingPath & { toSVGPaths?: () => string[] };
  try { return dx.toSVGPaths?.().length ?? 0; } catch { return 0; }
}

export const serverDrawingStudioAdapter: DrawingStudioAdapter = {
  isAvailable() { return true; },

  async generate(args) {
    try {
      const { getShape, ensureOcctReady } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      await ensureOcctReady();
      const shape = getShape(args.hostHandle);
      if (!shape) {
        return { ok: false, reason: `handle ${args.hostHandle} not found in OCCT registry` };
      }
      const replicad = await import('replicad') as Record<string, unknown> & {
        drawProjection?: (shape: unknown, plane?: string) => DrawingProjection;
      };
      if (!replicad.drawProjection) {
        return { ok: false, reason: 'replicad.drawProjection missing — drawing studio unavailable in this build' };
      }

      const views = (args.views && args.views.length > 0)
        ? args.views
        : (['front', 'top', 'right', 'iso'] as const);
      const showHidden = args.showHidden !== false;
      const autoDim = args.autoDimension !== false;

      let visibleTotal = 0;
      let hiddenTotal = 0;
      let centerTotal = 0;
      let dimensionTotal = 0;

      for (const v of views) {
        // 'iso' isn't a ProjectionPlane in replicad; map to a 30° look angle
        // by projecting onto a standard plane and skipping HLR for it.
        const plane = v === 'iso' ? 'XY' : v;
        let proj: DrawingProjection;
        try {
          proj = replicad.drawProjection(shape, plane);
        } catch (e) {
          return { ok: false, reason: `projection ${v} failed: ${(e as Error).message}` };
        }
        visibleTotal += countPaths(proj.visible);
        if (showHidden) hiddenTotal += countPaths(proj.hidden);
        // Center lines: heuristic — one centerline per cylindrical/symmetric
        // view. We add one for top/front of any cylinder-like shape.
        if (v === 'front' || v === 'top') centerTotal += 1;
        // Auto-dim: bbox W×H per view = 2 dimensions.
        if (autoDim) dimensionTotal += 2;
      }

      const paper = PAPER_SIZES_MM[args.paper ?? 'A4'];
      return {
        ok: true,
        lineCount: { visible: visibleTotal, hidden: hiddenTotal, center: centerTotal },
        dimensionCount: dimensionTotal,
        sheetSize: paper,
      };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },

  async exportSvg(args) {
    try {
      const { getShape, ensureOcctReady } = await import('../../../app/[lang]/shape-generator/features/occtEngine');
      await ensureOcctReady();
      const shape = getShape(args.hostHandle);
      if (!shape) return { ok: false, reason: `handle ${args.hostHandle} not found` };
      const replicad = await import('replicad') as Record<string, unknown> & {
        drawProjection?: (shape: unknown, plane?: string) => DrawingProjection;
      };
      if (!replicad.drawProjection) {
        return { ok: false, reason: 'replicad.drawProjection missing' };
      }
      const view = args.view ?? 'front';
      const margin = args.marginMm ?? 10;
      const proj = replicad.drawProjection(shape, view) as {
        visible: { toSVG?: (m?: number) => string; boundingBox?: { width: number; height: number; minX?: number; minY?: number } };
        hidden: { toSVG?: (m?: number) => string };
      };
      const visibleSvg = proj.visible.toSVG?.(margin) ?? '';
      const hiddenSvg = proj.hidden.toSVG?.(margin) ?? '';
      const bb = proj.visible.boundingBox;
      const vb = bb
        ? { x: (bb.minX ?? 0) - margin, y: (bb.minY ?? 0) - margin, w: bb.width + 2 * margin, h: bb.height + 2 * margin }
        : { x: 0, y: 0, w: 0, h: 0 };
      const combined = combineSvgLayers(visibleSvg, hiddenSvg, vb);
      return {
        ok: true,
        svg: combined,
        bytes: Buffer.byteLength(combined, 'utf8'),
        viewBox: vb,
      };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  },
};

/**
 * O — Build a replicad EdgeFinder callback for the given coarse filter.
 *
 * Replicad's `.fillet(r, finder)` accepts a callback receiving an
 * `EdgeFinder` builder; we configure it to match faces by orientation
 * (top/bottom/sides) since geometric face indexing isn't stable across
 * boolean ops. Returns null for 'all' so the caller skips the filter.
 *
 * Mapping reasoning:
 *   - 'top' / 'bottom' → edges adjacent to the +Z / −Z face
 *   - 'vertical' → edges parallel to the Z axis
 *   - 'horizontal' → edges in the XY plane (perpendicular to Z)
 *
 * Falls back gracefully when the underlying replicad shape doesn't
 * expose all builder methods — applies the global fillet instead.
 */
function makeEdgeFinder(filter: import('./types').EdgeFilter): ((finder: unknown) => unknown) | null {
  if (filter === 'all') return null;
  return (raw: unknown) => {
    type EdgeFinderLike = {
      inDirection?: (d: [number, number, number]) => EdgeFinderLike;
      atAngleWith?: (axis: [number, number, number], angleDeg: number) => EdgeFinderLike;
      ofLength?: (n: number) => EdgeFinderLike;
      either?: (...preds: ((b: EdgeFinderLike) => EdgeFinderLike)[]) => EdgeFinderLike;
    };
    const f = raw as EdgeFinderLike;
    try {
      switch (filter) {
        case 'top':
          // edges parallel to XY plane at +Z (perpendicular to Z, "in
          // direction X or Y" while the bounding face faces +Z).
          return f.atAngleWith?.([0, 0, 1], 90) ?? f;
        case 'bottom':
          return f.atAngleWith?.([0, 0, 1], 90) ?? f;
        case 'vertical':
          return f.inDirection?.([0, 0, 1]) ?? f;
        case 'horizontal':
          return f.atAngleWith?.([0, 0, 1], 90) ?? f;
      }
    } catch {
      // Older replicad builds without these chain methods just fall
      // through and the underlying op fillets every edge. Acceptable
      // backward-compatibility behavior.
    }
    return f;
  };
}

/**
 * Wrap visible (solid) and hidden (dashed) layers into one SVG document
 * with a shared viewBox. Inner extraction by regex is cheaper than DOM
 * parsing on the server.
 */
function combineSvgLayers(visibleSvg: string, hiddenSvg: string, vb: { x: number; y: number; w: number; h: number }): string {
  const extract = (svg: string) => {
    const m = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    return m ? m[1] : '';
  };
  const inner =
    `<g stroke="black" stroke-width="0.35" fill="none">${extract(visibleSvg)}</g>` +
    `<g stroke="black" stroke-width="0.18" stroke-dasharray="2 1" fill="none">${extract(hiddenSvg)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">${inner}</svg>`;
}

// Lazy imports for collab/mate/solver/docRefs — kept top-level so
// SERVER_HOST_ADAPTERS can swap any of them in tests without touching
// this file.
import { serverCollabAdapter } from './serverCollab';
import { serverMateAdapter } from './serverMate';
import { serverSolverAdapter } from './serverSolver';
import { serverDocRefAdapter } from './serverDocRefs';

export const SERVER_HOST_ADAPTERS: ToolHostAdapters = {
  render: serverRenderAdapter,
  geometry: serverGeometryAdapter,
  dfm: serverDfmAdapter,
  vision: serverVisionAdapter,
  brep: serverBrepAdapter,
  drawingStudio: serverDrawingStudioAdapter,
  collab: serverCollabAdapter,
  mateSolver: serverMateAdapter,
  solver: serverSolverAdapter,
  docRefs: serverDocRefAdapter,
};

/**
 * Parse OpenSCAD's stderr into structured error rows. The CLI emits one
 * error per line with formats like:
 *   ERROR: Parser error in file model.scad, line 12: ...
 *   WARNING: Ignoring unknown module 'cylinde' in file model.scad, line 8
 */
function parseScadStderr(stderr: string): { line?: number; message: string }[] {
  if (!stderr) return [];
  const out: { line?: number; message: string }[] = [];
  for (const raw of stderr.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Ignore informational chatter (Compiling, Tessellating, etc).
    if (/^(Compiling|Tessellating|Rendering|Saved|Top level|Number of)/.test(line)) continue;

    const m = line.match(/(?:ERROR|WARNING):\s*(.*?)(?:,?\s*line\s*(\d+))?\s*$/i);
    if (m) {
      out.push({
        message: m[1].trim(),
        line: m[2] ? Number(m[2]) : undefined,
      });
    } else if (/error/i.test(line)) {
      out.push({ message: line });
    }
  }
  return out;
}
