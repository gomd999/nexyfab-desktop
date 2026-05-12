/**
 * H* (Stage 4 foundation) — Server-side 2D constraint solver.
 *
 * The intended backend is Solvespace's `slvs.so` constraint solver,
 * compiled to WASM via emcc. The actual `.wasm` build is a user-side
 * step (see "Build instructions" below) — this module provides:
 *
 *   1. A typed JS wrapper that calls into the WASM (when present) and
 *      maps results back into the agent's SketchState shape.
 *   2. A pure-JS fallback that handles the *trivial* constraint subset
 *      (horizontal, vertical, fix_point, distance with fixed endpoint)
 *      so the agent can do basic parametric work even before the WASM
 *      is built.
 *   3. A clear `availability` report so the agent's `sketch_solve` tool
 *      can degrade gracefully ("WASM solver missing — handled 2 of 5
 *      constraints with fallback; please upgrade for full solving").
 *
 * Build instructions (for ops):
 *
 *   git clone https://github.com/solvespace/solvespace ~/build/solvespace
 *   cd ~/build/solvespace
 *   docker run --rm -v $PWD:/src emscripten/emsdk \
 *     bash -c "cd /src && cmake -B build-wasm \
 *       -DCMAKE_TOOLCHAIN_FILE=\$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
 *       -DENABLE_GUI=OFF -DENABLE_TESTS=OFF -DBUILD_SHARED_LIBS=OFF \
 *       && cmake --build build-wasm --target slvs"
 *   cp build-wasm/src/libslvs/slvs.{js,wasm} <nexyfab>/public/wasm/
 *
 * Then set SOLVESPACE_WASM_URL env to enable the full backend.
 */
import type { SolverAdapter } from './tools';
import type { SketchEntity, SketchState } from './types';

let cachedWasmInstance: unknown = null;
let cachedWasmAttempted = false;

async function tryLoadSolvespaceWasm(): Promise<unknown | null> {
  if (cachedWasmInstance) return cachedWasmInstance;
  if (cachedWasmAttempted) return null;
  cachedWasmAttempted = true;
  // emcc-generated factories follow the same shape across versions:
  // a default-exported async function that resolves with Module {Slvs_*, ...}.
  // We try server-side path first (Node fs), then URL fetch (browser/edge).
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const path = await import('node:path');
      const fs = await import('node:fs');
      const wasmPath = path.join(process.cwd(), 'public/wasm/slvs.js');
      if (!fs.existsSync(wasmPath)) return null;
      // Use a dynamic import path the bundler can't trace so we don't
      // try to compile slvs.js at build time (it's emcc output, ESM-ish).
      const factoryPath = wasmPath;
      const modRaw: unknown = await import(/* webpackIgnore: true */ factoryPath).catch(() => null);
      if (!modRaw || typeof modRaw !== 'object') return null;
      const mod = modRaw as { default?: unknown };
      const factory = (mod.default ?? modRaw) as () => Promise<unknown>;
      if (typeof factory !== 'function') return null;
      cachedWasmInstance = await factory();
      return cachedWasmInstance;
    }
    // Browser fallback — used by client-side eval harness in dev tools.
    const url = process.env.SOLVESPACE_WASM_URL ?? '/wasm/slvs.js';
    const modRaw: unknown = await import(/* webpackIgnore: true */ url).catch(() => null);
    if (!modRaw || typeof modRaw !== 'object') return null;
    const mod = modRaw as { default?: unknown };
    const factory = (mod.default ?? modRaw) as () => Promise<unknown>;
    if (typeof factory !== 'function') return null;
    cachedWasmInstance = await factory();
    return cachedWasmInstance;
  } catch {
    return null;
  }
}

interface Vec2 { x: number; y: number }

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Apply trivial-subset solving in pure JS. Mutates entities to satisfy
 *  the constraints we can handle:
 *    - fix_point: pin a point to its current location (no-op, marker)
 *    - horizontal / vertical: snap a 2-point line's second point Y or X
 *    - distance with at least one fix_point endpoint: scale to length
 *  Returns { handledIds, unhandledIds } so the caller can report. */
function jsFallbackSolve(sketch: SketchState): {
  entities: SketchEntity[];
  handled: string[];
  unhandled: string[];
  residual: number;
} {
  const entityById = new Map<string, SketchEntity>();
  for (const e of sketch.entities) entityById.set(e.id, JSON.parse(JSON.stringify(e)) as SketchEntity);

  const fixedPoints = new Set<string>();
  const handled: string[] = [];
  const unhandled: string[] = [];

  for (const c of sketch.constraints) {
    switch (c.kind) {
      case 'fix_point':
        if (c.entityIds[0]) {
          fixedPoints.add(c.entityIds[0]);
          handled.push(c.id);
        }
        break;

      case 'horizontal': {
        const e = entityById.get(c.entityIds[0]);
        if (e && e.kind === 'line' && e.points.length === 2) {
          // snap second point's Y to first point's Y
          e.points[1] = [e.points[1][0], e.points[0][1]];
          handled.push(c.id);
        } else {
          unhandled.push(c.id);
        }
        break;
      }

      case 'vertical': {
        const e = entityById.get(c.entityIds[0]);
        if (e && e.kind === 'line' && e.points.length === 2) {
          e.points[1] = [e.points[0][0], e.points[1][1]];
          handled.push(c.id);
        } else {
          unhandled.push(c.id);
        }
        break;
      }

      case 'distance': {
        // We can solve a distance constraint between two points if at
        // least one is fixed (we move the unfixed end along the same
        // direction to land at the requested distance).
        const target = c.value;
        if (typeof target !== 'number' || c.entityIds.length < 2) {
          unhandled.push(c.id); break;
        }
        const aId = c.entityIds[0];
        const bId = c.entityIds[1];
        const a = entityById.get(aId); const b = entityById.get(bId);
        if (!a || !b || a.kind !== 'point' || b.kind !== 'point') {
          unhandled.push(c.id); break;
        }
        const aFixed = fixedPoints.has(aId);
        const bFixed = fixedPoints.has(bId);
        if (aFixed && bFixed) {
          // Both fixed — can't solve, just check residual.
          handled.push(c.id);
          break;
        }
        if (!aFixed && !bFixed) {
          unhandled.push(c.id); break;
        }
        const fixedPt = aFixed ? a.points[0] : b.points[0];
        const movePt = aFixed ? b.points[0] : a.points[0];
        const cur = dist({ x: movePt[0], y: movePt[1] }, { x: fixedPt[0], y: fixedPt[1] });
        if (cur < 1e-9) {
          // Direction undefined — place along +X for determinism.
          (aFixed ? b : a).points[0] = [fixedPt[0] + target, fixedPt[1]];
        } else {
          const ux = (movePt[0] - fixedPt[0]) / cur;
          const uy = (movePt[1] - fixedPt[1]) / cur;
          (aFixed ? b : a).points[0] = [fixedPt[0] + ux * target, fixedPt[1] + uy * target];
        }
        handled.push(c.id);
        break;
      }

      default:
        unhandled.push(c.id);
    }
  }

  // Compute residual: sum of unsatisfied "horizontal/vertical/distance"
  // checks AFTER fallback application.
  let residual = 0;
  for (const c of sketch.constraints) {
    if (c.kind === 'horizontal') {
      const e = entityById.get(c.entityIds[0]);
      if (e?.kind === 'line' && e.points.length === 2) {
        residual += Math.abs(e.points[0][1] - e.points[1][1]);
      }
    } else if (c.kind === 'vertical') {
      const e = entityById.get(c.entityIds[0]);
      if (e?.kind === 'line' && e.points.length === 2) {
        residual += Math.abs(e.points[0][0] - e.points[1][0]);
      }
    } else if (c.kind === 'distance' && typeof c.value === 'number') {
      const a = entityById.get(c.entityIds[0]);
      const b = entityById.get(c.entityIds[1]);
      if (a?.kind === 'point' && b?.kind === 'point') {
        const cur = dist({ x: a.points[0][0], y: a.points[0][1] }, { x: b.points[0][0], y: b.points[0][1] });
        residual += Math.abs(cur - c.value);
      }
    }
  }

  return {
    entities: Array.from(entityById.values()),
    handled,
    unhandled,
    residual,
  };
}

/**
 * Adapter that uses the Solvespace WASM when available, otherwise falls
 * back to the JS subset solver. Reports `unhandled` constraints up so
 * the agent can decide whether to call the user out for missing solver.
 */
export const serverSolverAdapter: SolverAdapter = {
  isAvailable() {
    // We're "available" in the sense that something will respond — even
    // without the WASM, the JS fallback handles a useful subset.
    return true;
  },

  async solve(sketch) {
    const wasm = await tryLoadSolvespaceWasm();
    if (wasm) {
      // TODO: wire WASM solve here once .wasm is shipped.
      return { ok: false, reason: 'Solvespace WASM loaded but adapter not yet implemented' };
    }
    const r = jsFallbackSolve(sketch);
    // Any unhandled constraint = failure: we can't claim the sketch is
    // solved when we never even attempted those constraints.
    if (r.unhandled.length > 0) {
      return {
        ok: false,
        reason: `JS fallback solver handled ${r.handled.length}/${sketch.constraints.length} constraints `
          + `(unhandled: ${r.unhandled.join(', ')}). Build Solvespace WASM for full coverage — see scad-agent/serverSolver.ts header.`,
      };
    }
    // Even with all constraints "handled", a non-trivial residual means
    // the system was over-/under-constrained; surface that too.
    if (r.residual > 0.01) {
      return {
        ok: false,
        reason: `solver residual ${r.residual.toExponential(2)} exceeds tolerance — sketch may be over- or under-constrained.`,
      };
    }
    return { ok: true, updatedEntities: r.entities, residual: r.residual };
  },
};

// ─── test helpers ──────────────────────────────────────────────────────
export function _resetSolverCache(): void {
  cachedWasmInstance = null;
  cachedWasmAttempted = false;
}
