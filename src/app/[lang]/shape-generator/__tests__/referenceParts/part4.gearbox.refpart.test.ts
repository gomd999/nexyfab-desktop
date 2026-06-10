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
import type { FaceSelectionInfo } from '../../editing/selectionInfo';
import { meshVolume, manifoldReport, nfabRoundTrip, recordFinding } from './refPartsHarness';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
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
    console.log(`[REF-PART 4] draft: vol=${vol.toFixed(0)} (pre-draft ${V_PRE_DRAFT.toFixed(0)}), `
      + `error=${err ?? '(none)'}, handleAlive=${draftHandleAlive}, occtDraftFailed=${occtDraftFailed}`);
    if (occtDraftFailed) {
      recordFinding({
        part: 'P4 gearbox housing',
        severity: 'critical',
        title: 'OCCT draft crashes on a real housing and the mesh fallback is a silent whole-body shear',
        detail: 'occtDraft throws a wasm-exception on the flanged/bored housing (atAngleWith([0,1,0],90) face '
          + 'filter hits the bore + flange faces) → features/draft.ts falls back to applyDraftMesh, a per-vertex '
          + 'X/Z shear: it is volume-preserving (det=1), tapers NOTHING per-face, skews the bore and flange, and '
          + 'the pipeline reports NO error — the user believes the part is drafted.',
      });
      if (draftHandleAlive) {
        recordFinding({
          part: 'P4 gearbox housing',
          severity: 'critical',
          title: 'stale occtHandle after a mesh fallback — B-rep and mesh silently diverge',
          detail: 'applyDraftMesh clones the geometry; THREE\'s clone shares userData by reference, so '
            + 'userData.occtHandle still points at the PRE-draft solid. Every downstream OCCT feature '
            + '(boss union, deleteFace, STEP export) operates on the undrafted B-rep while the viewport '
            + 'shows the sheared mesh.',
        });
      }
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

    if (errs['h-delboss']) {
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
