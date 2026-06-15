/**
 * occtCorpus.regression — Phase-4 kernel-robustness corpus harness.
 *
 * Replays the seed corpus (fixtures/kernel-corpus/seeds.json): each case
 * rebuilds a base solid through the real occtEngine builders, then runs the
 * historically-failing op through the SAME avoidance/capture path production
 * uses (occtFilletAvoidance / occtShellBox / occtDraft / occtBooleanSolids +
 * kernelCorpus). The pinned `expectation` is the regression contract — if a
 * replicad/OCCT upgrade changes an outcome (a case that used to need
 * avoidance now succeeds, or a clean failure starts crashing), this suite
 * flags it.
 *
 * Adding cases: convert a field-captured kernelCorpus record
 * (`window.__nfabKernelCorpus.export()`) into a fixture by writing replay
 * `steps` for its base-shape signature, then pin the expectation.
 *
 * Gated like the sibling OCCT suites: RUN_OCCT_FEASIBILITY=1 (10 MB WASM).
 * Run via `npm run test:occt:corpus`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  ensureOcctReady,
  resetShapeRegistry,
  occtExtrudeProfile,
  occtExtrudeCircle,
  occtBooleanSolids,
  occtFilletBox,
  occtShellBox,
  occtDraft,
  hostBoxFromGeometry,
} from '../features/occtEngine';
import {
  occtFilletWithAvoidanceSync,
  occtFilletWithAvoidanceAsync,
} from '../features/occtFilletAvoidance';
import {
  captureKernelFailure,
  clearKernelCorpus,
  getKernelCorpus,
} from '../features/kernelCorpus';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';
import seedsJson from './fixtures/kernel-corpus/seeds.json';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

// ─── Fixture schema ──────────────────────────────────────────────────────────

interface StepExtrude { op: 'extrude'; out: string; profile: [number, number][]; depth: number; offset?: number }
interface StepCircle { op: 'extrudeCircle'; out: string; r: number; cx: number; cy: number; depth: number; offset?: number }
interface StepBoolean { op: 'boolean'; out: string; type: 'union' | 'subtract' | 'intersect'; host: string; tool: string }
interface StepFillet { op: 'filletStep'; out: string; host: string; radius: number }
interface StepShell { op: 'shellStep'; out: string; host: string; thickness: number; openFace: number }
type Step = StepExtrude | StepCircle | StepBoolean | StepFillet | StepShell;

interface SelectionSpec {
  position: [number, number, number];
  direction: [number, number, number];
  length: number;
  normal: [number, number, number];
}

interface FinalOp {
  op: 'fillet' | 'filletPerEdge' | 'shell' | 'draft' | 'boolean';
  host: string;
  tool?: string;
  type?: 'union' | 'subtract' | 'intersect';
  radius?: number;
  thickness?: number;
  openFace?: number;
  angle?: number;
  direction?: number;
  selections?: SelectionSpec[];
}

interface CorpusCase {
  id: string;
  title: string;
  expectation: 'ok' | 'avoided' | 'partial' | 'fail-clean' | 'empty';
  volume?: number;
  steps: Step[];
  final: FinalOp;
}

const CASES = (seedsJson as { cases: CorpusCase[] }).cases;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface Built { geometry: THREE.BufferGeometry; handle: string | null }

function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos || !idx) return 0;
  let vol = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(vol);
}

const toPts = (profile: [number, number][]) => profile.map(([x, y]) => ({ x, y }));

/** Interpret the replay steps into named {geometry, handle} shapes. */
function buildSteps(steps: Step[]): Map<string, Built> {
  const shapes = new Map<string, Built>();
  const get = (name: string): Built => {
    const s = shapes.get(name);
    if (!s) throw new Error(`fixture step references unknown shape '${name}'`);
    return s;
  };
  for (const step of steps) {
    if (step.op === 'extrude') {
      const r = occtExtrudeProfile(toPts(step.profile), step.depth, {}, step.offset ?? 0);
      shapes.set(step.out, r);
    } else if (step.op === 'extrudeCircle') {
      const r = occtExtrudeCircle(step.r, step.cx, step.cy, step.depth, {}, step.offset ?? 0);
      shapes.set(step.out, r);
    } else if (step.op === 'boolean') {
      const r = occtBooleanSolids(step.type, get(step.host).handle, get(step.tool).handle);
      shapes.set(step.out, r);
    } else if (step.op === 'filletStep') {
      const host = get(step.host);
      const r = occtFilletBox(hostBoxFromGeometry(host.geometry), step.radius, {}, host.handle);
      shapes.set(step.out, r);
    } else if (step.op === 'shellStep') {
      const host = get(step.host);
      const r = occtShellBox(hostBoxFromGeometry(host.geometry), step.thickness, step.openFace, {}, host.handle);
      shapes.set(step.out, r);
    }
  }
  return shapes;
}

/** Geometry with the B-rep handle attached, as the pipeline would hand it to a feature. */
function asPipelineGeometry(built: Built): THREE.BufferGeometry {
  const geo = built.geometry;
  if (built.handle) geo.userData = { ...geo.userData, occtHandle: built.handle };
  return geo;
}

const asSelection = (s: SelectionSpec): EdgeSelectionInfo => ({
  type: 'edge',
  position: s.position,
  direction: s.direction,
  length: s.length,
  normal: s.normal,
});

// ─── Harness ─────────────────────────────────────────────────────────────────

describeMaybe('Phase-4 kernel corpus regression (seeds.json)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 180_000);

  beforeEach(() => {
    resetShapeRegistry();
    clearKernelCorpus();
  });

  for (const c of CASES) {
    it(`[${c.expectation}] ${c.id} — ${c.title}`, async () => {
      const shapes = buildSteps(c.steps);
      const host = shapes.get(c.final.host);
      expect(host, `fixture base '${c.final.host}' built`).toBeTruthy();
      expect(host!.handle, `fixture base '${c.final.host}' has a B-rep handle`).toBeTruthy();
      const geometry = asPipelineGeometry(host!);

      if (c.final.op === 'fillet') {
        const out = occtFilletWithAvoidanceSync(geometry, c.final.radius!, null, { featureId: c.id });
        if (c.expectation === 'ok') {
          expect(out).not.toBeNull();
          expect(out!.strategy).toBe('requested');
          expect(out!.geometry.attributes.position.count).toBeGreaterThan(0);
          expect(getKernelCorpus()).toHaveLength(0); // healthy path captures nothing
        } else if (c.expectation === 'avoided') {
          expect(out).not.toBeNull();
          expect(out!.strategy).toBe('reduced-radius');
          expect(out!.appliedRadius).toBeLessThan(out!.requestedRadius);
          expect(out!.geometry.attributes.position.count).toBeGreaterThan(0);
          // Corpus captured the original failure + the resolution.
          const rec = getKernelCorpus().find(r => r.op === 'fillet');
          expect(rec).toBeTruthy();
          expect(rec!.resolution.strategy).toBe('reduced-radius');
          expect(rec!.resolution.applied?.radius).toBe(out!.appliedRadius);
        } else {
          // fail-clean: every attempt failed, but no crash and the corpus has it.
          expect(out).toBeNull();
          const rec = getKernelCorpus().find(r => r.op === 'fillet');
          expect(rec).toBeTruthy();
          expect(rec!.resolution.strategy).toBe('mesh-fallback');
        }
      } else if (c.final.op === 'filletPerEdge') {
        const out = await occtFilletWithAvoidanceAsync(geometry, c.final.radius!, null, {
          featureId: c.id,
          edgeSelections: (c.final.selections ?? []).map(asSelection),
        });
        if (c.expectation === 'partial') {
          expect(out).not.toBeNull();
          expect(out!.strategy).toBe('partial-edges');
          expect(out!.edgesApplied).toBeGreaterThan(0);
          expect(out!.edgesApplied!).toBeLessThan(out!.edgesRequested!);
          expect(out!.appliedRadius).toBe(c.final.radius); // requested radius kept on the healthy subset
          const rec = getKernelCorpus().find(r => r.resolution.strategy === 'partial-edges');
          expect(rec).toBeTruthy();
        } else if (c.expectation === 'avoided') {
          expect(out).not.toBeNull();
          expect(out!.strategy).toBe('reduced-radius');
        } else if (c.expectation === 'ok') {
          expect(out).not.toBeNull();
          expect(out!.strategy).toBe('requested');
        } else {
          expect(out).toBeNull();
        }
      } else if (c.final.op === 'shell') {
        // Mirror the production shell.ts contract: throw → capture → mesh fallback.
        let failed: unknown = null;
        let geo: THREE.BufferGeometry | null = null;
        try {
          const r = occtShellBox(hostBoxFromGeometry(geometry), c.final.thickness!, c.final.openFace ?? 0, {}, host!.handle);
          geo = r.geometry;
        } catch (err) {
          failed = err;
          captureKernelFailure({
            op: 'shell',
            params: { wallThickness: c.final.thickness!, openFace: c.final.openFace ?? 0 },
            geometry,
            error: err,
            resolution: { strategy: 'mesh-fallback' },
            forward: false,
          });
        }
        if (c.expectation === 'ok') {
          expect(failed).toBeNull();
          expect(geo!.attributes.position.count).toBeGreaterThan(0);
        } else {
          // fail-clean: a real Error (not a crash), captured into the corpus.
          expect(failed).toBeTruthy();
          expect(getKernelCorpus().find(r => r.op === 'shell')).toBeTruthy();
        }
      } else if (c.final.op === 'draft') {
        let failed: unknown = null;
        let out: { geometry: THREE.BufferGeometry; handle: string | null } | null = null;
        try {
          out = occtDraft(host!.handle, c.final.angle!, c.final.direction ?? 0);
        } catch (err) {
          failed = err;
          captureKernelFailure({
            op: 'draft',
            params: { angle: c.final.angle!, direction: c.final.direction ?? 0 },
            geometry,
            error: err,
            resolution: { strategy: 'mesh-fallback' },
            forward: false,
          });
        }
        if (c.expectation === 'ok') {
          expect(failed).toBeNull();
          expect(out!.handle).toBeTruthy();
          expect(out!.geometry.attributes.position.count).toBeGreaterThan(0);
        } else {
          // fail-clean: throws OR returns no handle (caller meshes either way).
          const cleanlyFailed = failed !== null || !out?.handle || out.geometry.attributes.position.count === 0;
          expect(cleanlyFailed).toBe(true);
          if (failed) expect(getKernelCorpus().find(r => r.op === 'draft')).toBeTruthy();
        }
      } else if (c.final.op === 'boolean') {
        const tool = shapes.get(c.final.tool!);
        expect(tool?.handle).toBeTruthy();
        let failed: unknown = null;
        let geo: THREE.BufferGeometry | null = null;
        try {
          const r = occtBooleanSolids(c.final.type!, host!.handle, tool!.handle);
          geo = r.geometry;
        } catch (err) {
          failed = err;
          captureKernelFailure({
            op: 'boolean',
            params: { type: c.final.type! },
            geometry,
            error: err,
            resolution: { strategy: 'mesh-fallback' },
            forward: false,
          });
        }
        if (c.expectation === 'ok') {
          expect(failed).toBeNull();
          expect(geo!.attributes.position.count).toBeGreaterThan(0);
          if (typeof c.volume === 'number') {
            expect(Math.abs(meshVolume(geo!) - c.volume)).toBeLessThan(c.volume * 0.02);
          }
        } else if (c.expectation === 'empty') {
          // Must not crash; result is an empty (or near-zero-volume) solid.
          expect(failed).toBeNull();
          const count = geo!.attributes.position?.count ?? 0;
          const vol = count > 0 ? meshVolume(geo!) : 0;
          expect(vol).toBeLessThan(1e-3);
        } else {
          expect(failed).toBeTruthy();
          expect(getKernelCorpus().find(r => r.op === 'boolean')).toBeTruthy();
        }
      }
    }, 120_000);
  }
});
