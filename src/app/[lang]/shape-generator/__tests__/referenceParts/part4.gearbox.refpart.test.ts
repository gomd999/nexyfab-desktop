/**
 * Reference part 4 — gearbox-ish housing (검증 트랙).
 *
 * Box body 80×50×60 + bottom mounting flange 110×8×80 + Ø30 through-bore
 * along Z + 4×Ø9 flange bolt holes + 2° draft on the outer walls +
 * deleteFace defeaturing of a boss. Exercises the OCCT boolean chain,
 * draft, direct edit, and the .nfab round-trip.
 *
 * Gated: RUN_OCCT_FEASIBILITY=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { applyFeaturePipelineDetailedAsync } from '../../features';
import type { FeatureInstance } from '../../features/types';
import { ensureOcctReady, setOcctGlobalMode } from '../../features/occtEngine';
import { cacheClear } from '../../features/pipelineCache';
import { getKernelCorpus, clearKernelCorpus } from '../../features/kernelCorpus';
import { collectDowngrades } from '../../features/downgradeNotice';
import type { FaceSelectionInfo } from '../../editing/selectionInfo';
import { meshVolume, manifoldReport, nfabRoundTrip, recordFinding } from './refPartsHarness';

// W1-A (R0-0): default ON. This suite is the OCCT kernel's real-behaviour gate;
// leaving it opt-IN meant it never ran in CI. Measured cost of enabling: ~18s
// wall across the whole __tests__ dir. Set RUN_OCCT_FEASIBILITY=0 to opt out.
const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

// Body 80(x) × 50(y) × 60(z), centered. Flange plate 110×8×80 at the bottom.
const BX = 80, BY = 50, BZ = 60;
const FX = 110, FT = 8, FZ = 80;
const BORE_D = 30, BORE_Y = 5;
const BOLT_D = 9;
const BOSS_D = 16, BOSS_H = 10, BOSS_X = 20;

function baseBody(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(BX, BY, BZ);
  g.computeVertexNormals();
  return g;
}

const flangeUnion: FeatureInstance = {
  id: 'h-flange',
  type: 'boolean',
  params: {
    operation: 0, toolShape: 0,
    toolWidth: FX, toolHeight: FT, toolDepth: FZ,
    posX: 0, posY: -BY / 2 + FT / 2, posZ: 0,
    rotX: 0, rotY: 0, rotZ: 0, engine: 1,
  },
  enabled: true,
};

const boreSubtract: FeatureInstance = {
  id: 'h-bore',
  type: 'boolean',
  params: {
    operation: 1, toolShape: 1,
    toolWidth: BORE_D, toolHeight: BZ + 10, toolDepth: BORE_D,
    posX: 0, posY: BORE_Y, posZ: 0,
    rotX: 90, rotY: 0, rotZ: 0, engine: 1, // +Y cylinder → Z axis bore
  },
  enabled: true,
};

const BOLTS: [number, number][] = [[-45, -32], [45, -32], [45, 32], [-45, 32]];
const boltHole = (i: number): FeatureInstance => ({
  id: `h-bolt${i}`,
  type: 'hole',
  params: {
    holeType: 0, diameter: BOLT_D, posX: BOLTS[i][0], posZ: BOLTS[i][1], depth: 999,
    counterboreDia: 16, counterboreDepth: 4, countersinkAngle: 90,
    engine: 1,
  },
  enabled: true,
});

const draftWalls: FeatureInstance = {
  id: 'h-draft',
  type: 'draft',
  params: { angle: 2, direction: 0 },
  enabled: true,
};

const bossUnion: FeatureInstance = {
  id: 'h-boss',
  type: 'boolean',
  params: {
    operation: 0, toolShape: 1,
    toolWidth: BOSS_D, toolHeight: BOSS_H, toolDepth: BOSS_D,
    posX: BOSS_X, posY: BY / 2 + BOSS_H / 2, posZ: 0,
    rotX: 0, rotY: 0, rotZ: 0, engine: 1,
  },
  enabled: true,
};

const faceSel = (position: [number, number, number], normal: [number, number, number], label: string): FaceSelectionInfo => ({
  type: 'face',
  position,
  normal,
  area: 100,
  triangleCount: 2,
  normalLabel: label,
  triangleIndices: [],
});

const deleteBoss: FeatureInstance = {
  id: 'h-delboss',
  type: 'deleteFace',
  params: {},
  enabled: true,
  faceSelections: [
    faceSel([BOSS_X, BY / 2 + BOSS_H, 0], [0, 1, 0], '+Y boss cap'),
    faceSel([BOSS_X + BOSS_D / 2, BY / 2 + BOSS_H / 2, 0], [1, 0, 0], 'boss wall'),
  ],
};

// Closed-form (pre-draft):
const V_BODY = BX * BY * BZ;                          // 240 000
const V_FLANGE_ADD = FX * FT * FZ - BX * FT * BZ;     //  32 000
const V_BORE = Math.PI * (BORE_D / 2) ** 2 * BZ;      // ≈ 42 412
const V_BOLTS = 4 * Math.PI * (BOLT_D / 2) ** 2 * FT; // ≈  2 036
const V_PRE_DRAFT = V_BODY + V_FLANGE_ADD - V_BORE - V_BOLTS; // ≈ 227 552
const V_BOSS = Math.PI * (BOSS_D / 2) ** 2 * BOSS_H;  // ≈  2 011

describeMaybe('REF-PART 4 · gearbox housing', () => {
  beforeAll(async () => {
    await ensureOcctReady();
    setOcctGlobalMode(true);
  }, 180_000);

  afterAll(() => {
    setOcctGlobalMode(false);
    cacheClear();
  });

  let draftedVolume = 0;
  let draftHandleAlive = false;
  let allFeatures: FeatureInstance[] = [];
  let finalVolume = 0;

  it('booleans: flange union + Ø30 bore + 4 bolt holes match closed-form volume', async () => {
    cacheClear();
    const features = [flangeUnion, boreSubtract, boltHole(0), boltHole(1), boltHole(2), boltHole(3)];
    const res = await applyFeaturePipelineDetailedAsync(baseBody(), features, { occtMode: true });
    console.log(`[REF-PART 4] boolean-chain errors: ${Object.keys(res.errors).length === 0 ? '(none)' : JSON.stringify(res.errors)}`);
    expect(Object.entries(res.errors)).toEqual([]);
    const vol = meshVolume(res.geometry);
    const rep = manifoldReport(res.geometry);
    console.log(`[REF-PART 4] SCORECARD booleans volume=${vol.toFixed(0)} vs closed-form ${V_PRE_DRAFT.toFixed(0)}, `
      + `boundaryEdges=${rep.boundaryEdges}, handle=${String(res.geometry.userData?.occtHandle ?? null)}`);
    expect(Math.abs(vol - V_PRE_DRAFT)).toBeLessThan(V_PRE_DRAFT * 0.02);
    expect(res.geometry.userData?.occtHandle).toBeTruthy();
  }, 240_000);

  it('draft 2° on the outer walls — outcome pinned', async () => {
    cacheClear();
    clearKernelCorpus();
    const features = [flangeUnion, boreSubtract, boltHole(0), boltHole(1), boltHole(2), boltHole(3), draftWalls];
    const res = await applyFeaturePipelineDetailedAsync(baseBody(), features, { occtMode: true });
    const err = res.errors['h-draft'];
    const vol = meshVolume(res.geometry);
    draftedVolume = vol;
    draftHandleAlive = !!res.geometry.userData?.occtHandle;
    const occtDraftFailed = !!getKernelCorpus().find(r => r.op === 'draft');
    const draftDowngrades = collectDowngrades(res.geometry).filter(n => n.op === 'Draft');
    console.log(`[REF-PART 4] draft: vol=${vol.toFixed(0)} (pre-draft ${V_PRE_DRAFT.toFixed(0)}), `
      + `error=${err ?? '(none)'}, handleAlive=${draftHandleAlive}, occtDraftFailed=${occtDraftFailed}, `
      + `downgrades=${JSON.stringify(draftDowngrades.map(n => n.severity))}`);
    if (occtDraftFailed) {
      // The OCCT draft kernel crash itself is still open (atAngleWith face
      // filter hits the bore + flange faces) — but the fallback is no longer
      // SILENT, and the stale-handle divergence is fixed:
      recordFinding({
        part: 'P4 gearbox housing',
        severity: 'major',
        title: 'OCCT draft crashes on a real housing; mesh fallback is a shear approximation (now surfaced, not silent)',
        detail: 'occtDraft throws a wasm-exception on the flanged/bored housing → features/draft.ts falls back '
          + 'to applyDraftMesh (per-vertex X/Z shear: volume-preserving, skews bore/flange). Since the fix the '
          + 'fallback stamps a "Draft approximated" downgrade notice (banner) and CLEARS the pre-draft '
          + 'occtHandle, so downstream OCCT features re-derive from the mesh instead of the wrong solid. '
          + 'Remaining gap: the mesh approximation is a shear, not a per-face taper.',
      });
      // FIXED pins (were critical findings):
      // 1. mesh fallback must surface a downgrade notice — never silent.
      expect(draftDowngrades.some(n => n.severity === 'approximated')).toBe(true);
      // 2. the stale PRE-draft handle must be cleared — B-rep and mesh may
      //    not silently diverge.
      expect(draftHandleAlive).toBe(false);
    }
    expect(res.geometry.attributes.position.count).toBeGreaterThan(0);
    // Draft of 2° on ≤50 mm walls changes volume by a few %, never an order.
    expect(vol).toBeGreaterThan(V_PRE_DRAFT * 0.85);
    expect(vol).toBeLessThan(V_PRE_DRAFT * 1.15);
  }, 240_000);

  it('boss union + Delete Face defeaturing returns to the pre-boss volume', async () => {
    cacheClear();
    allFeatures = [
      flangeUnion, boreSubtract, boltHole(0), boltHole(1), boltHole(2), boltHole(3),
      draftWalls, bossUnion, deleteBoss,
    ];
    const res = await applyFeaturePipelineDetailedAsync(baseBody(), allFeatures, { occtMode: true });
    const errs = res.errors;
    const vol = meshVolume(res.geometry);
    finalVolume = vol;
    console.log(`[REF-PART 4] SCORECARD deleteFace: vol=${vol.toFixed(0)} vs drafted ${draftedVolume.toFixed(0)} `
      + `(boss ${V_BOSS.toFixed(0)}), errors=${Object.keys(errs).length === 0 ? '(none)' : JSON.stringify(errs)}`);

    if (errs['h-boss']) {
      // Honest behaviour change from the fail-clean host contract: the boss
      // union used to run OCCT against the STALE pre-draft handle (silently
      // composing on the WRONG solid). Now the drafted housing has no handle
      // (cleared by the draft mesh fallback), OCCT refuses a bbox stand-in,
      // and the boolean falls to mesh CSG — which fails LOUDLY on the uv-less
      // OCCT tessellation (same merge-compat class pinned in P1/P2).
      recordFinding({
        part: 'P4 gearbox housing',
        severity: 'major',
        title: 'boss union on the drafted (mesh-fallback) housing fails in the mesh CSG fallback',
        detail: `boolean error: "${errs['h-boss']}" — fail-clean per the host contract (the union previously `
          + 'applied to the WRONG, undrafted B-rep via the stale handle). The mesh CSG fallback rejects the '
          + 'uv-less OCCT tessellation; the body is preserved un-bossed with a per-feature error.',
      });
      // Both boss and deleteFace reverted — the body stays the drafted housing.
      expect(Math.abs(vol - draftedVolume)).toBeLessThan(Math.max(draftedVolume * 0.015, 500));
    } else if (errs['h-delboss']) {
      recordFinding({
        part: 'P4 gearbox housing',
        severity: 'major',
        title: 'Delete Face defeaturing of the boss failed',
        detail: `deleteFace error: "${errs['h-delboss']}" — the user cannot defeature the boss in-pipeline`,
      });
      // The pipeline reverts the failed feature — boss remains.
      expect(Math.abs(vol - (draftedVolume + V_BOSS))).toBeLessThan(draftedVolume * 0.03);
    } else {
      // Healed back to the pre-boss body.
      expect(Math.abs(vol - draftedVolume)).toBeLessThan(Math.max(draftedVolume * 0.015, 500));
    }
  }, 240_000);

  it('.nfab round-trip (incl. faceSelections) → re-run → identical volume', async () => {
    expect(allFeatures.length).toBeGreaterThan(0);
    const rt = nfabRoundTrip(allFeatures, 'ref-part-4-gearbox');
    expect(rt.features).toHaveLength(allFeatures.length);
    const delNode = rt.features.find(f => f.id === 'h-delboss');
    expect(delNode?.faceSelections).toHaveLength(2);
    cacheClear();
    const res2 = await applyFeaturePipelineDetailedAsync(baseBody(), rt.features, { occtMode: true });
    const vol2 = meshVolume(res2.geometry);
    console.log(`[REF-PART 4] round-trip volume=${vol2.toFixed(0)} vs ${finalVolume.toFixed(0)}`);
    expect(Math.abs(vol2 - finalVolume)).toBeLessThan(Math.max(1, finalVolume * 0.01));
  }, 240_000);
});
