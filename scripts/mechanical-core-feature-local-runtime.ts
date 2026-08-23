#!/usr/bin/env tsx
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import type { FeatureInstance } from '../src/app/[lang]/shape-generator/features/types';
import type { FeatureMap } from '../src/app/[lang]/shape-generator/features/pipelineManager';
import type { FeatureHistory } from '../src/app/[lang]/shape-generator/useFeatureStack';
import {
  parseProject,
  serializeProject,
  toJsonString,
  type NfabProjectV1,
} from '../src/app/[lang]/shape-generator/io/nfabFormat';
import { commandHistory } from '../src/app/[lang]/shape-generator/history/CommandHistory';
import {
  ensureOcctReady,
  exportOcctStep,
  getShape,
  occtBaseSolid,
  occtBoxBooleanWithPrimitive,
  occtChamferBox,
  occtCircularPattern,
  occtDraft,
  occtEdgeSignatures,
  occtFaceSignatures,
  occtFilletBox,
  occtImportStepText,
  occtLinearPattern,
  occtMoveCopy,
  occtOffsetFace,
  occtProjectViews,
  occtRegisteredShapeEvidence,
  occtRib,
  occtScale,
  occtShellBox,
  occtVariableFillet,
  resetShapeRegistry,
  setOcctGlobalMode,
} from '../src/app/[lang]/shape-generator/features/occtEngine';
import { buildEdgeFinderFromSelection } from '../src/app/[lang]/shape-generator/features/topologyEdgeFinder';
import { applyTabOcct } from '../src/app/[lang]/shape-generator/features/tab';
import { applyCutOcct } from '../src/app/[lang]/shape-generator/features/cut';
import { runPipelineAsync } from '../src/app/[lang]/shape-generator/features/pipelineManager';
import { revolveFeature } from '../src/app/[lang]/shape-generator/features/revolve';
import { sweepFeature } from '../src/app/[lang]/shape-generator/features/sweep';
import { loftFeature } from '../src/app/[lang]/shape-generator/features/loft';
import { mirrorFeature } from '../src/app/[lang]/shape-generator/features/mirror';
import { booleanFeature } from '../src/app/[lang]/shape-generator/features/boolean';
import { splitBodyFeature } from '../src/app/[lang]/shape-generator/features/splitBody';
import { helixFeature } from '../src/app/[lang]/shape-generator/features/helix';
import { threadFeature } from '../src/app/[lang]/shape-generator/features/thread';
import { bendFeature, flangeFeature, hemFeature, jogFeature } from '../src/app/[lang]/shape-generator/features/sheetMetal';
import { bendReliefFeature, cornerReliefFeature } from '../src/app/[lang]/shape-generator/features/reliefCuts';
import { variableShellFeature } from '../src/app/[lang]/shape-generator/features/variableShell';
import {
  MECHANICAL_CORE_30_FEATURES,
  MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA,
  MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES,
  mechanicalCoreSelectionIdentityPayload,
  type MechanicalCoreFeatureId,
  type MechanicalCoreLocalAxisEvidenceV1,
  type MechanicalCoreLocalAxisRunV1,
  type MechanicalCoreLocalClosedLoopAxis,
  type MechanicalCoreLocalEvidenceBindingV1,
  type MechanicalCoreLocalSelectionIdentityV1,
} from '../src/lib/ai/mechanicalCoreFeatureContract';

export const MECHANICAL_CORE_FIRST_RUNTIME_BUNDLE = [
  'hole',
  'fillet',
  'chamfer',
  'shell',
  'rib',
] as const satisfies readonly MechanicalCoreFeatureId[];

export type MechanicalCoreFirstRuntimeFeature =
  (typeof MECHANICAL_CORE_FIRST_RUNTIME_BUNDLE)[number];

export const MECHANICAL_CORE_SECOND_RUNTIME_BUNDLE = [
  'linearPattern',
  'circularPattern',
  'draft',
  'scale',
  'moveCopy',
] as const satisfies readonly MechanicalCoreFeatureId[];

export const MECHANICAL_CORE_THIRD_RUNTIME_BUNDLE = [
  'variableFillet',
  'offsetFace',
  'thread',
  'helix',
  'bend',
] as const satisfies readonly MechanicalCoreFeatureId[];

export const MECHANICAL_CORE_FOURTH_RUNTIME_BUNDLE = [
  'flange',
  'hem',
  'jog',
  'tab',
  'cut',
] as const satisfies readonly MechanicalCoreFeatureId[];

export const MECHANICAL_CORE_FIFTH_RUNTIME_BUNDLE = [
  'bendRelief',
  'cornerRelief',
  'variableShell',
  'sketchExtrude',
  'revolve',
] as const satisfies readonly MechanicalCoreFeatureId[];

export const MECHANICAL_CORE_SIXTH_RUNTIME_BUNDLE = [
  'revolve',
  'sweep',
  'loft',
  'mirror',
  'boolean',
  'splitBody',
  'helix',
] as const satisfies readonly MechanicalCoreFeatureId[];

export const MECHANICAL_CORE_EXACT_RUNTIME_BUNDLE = [
  ...MECHANICAL_CORE_FIRST_RUNTIME_BUNDLE,
  ...MECHANICAL_CORE_SECOND_RUNTIME_BUNDLE,
  'variableFillet',
  'offsetFace',
  'thread',
  'bend',
  'flange',
  'hem',
  'jog',
  'tab',
  'cut',
  'bendRelief',
  'cornerRelief',
  'variableShell',
  'sketchExtrude',
  'revolve',
  'sweep',
  'loft',
  'mirror',
  'boolean',
  'splitBody',
  'helix',
] as const satisfies readonly MechanicalCoreFeatureId[];

export const MECHANICAL_CORE_RUNTIME_BUNDLE = [
  ...MECHANICAL_CORE_FIRST_RUNTIME_BUNDLE,
  ...MECHANICAL_CORE_SECOND_RUNTIME_BUNDLE,
  ...MECHANICAL_CORE_THIRD_RUNTIME_BUNDLE,
  ...MECHANICAL_CORE_FOURTH_RUNTIME_BUNDLE,
  ...MECHANICAL_CORE_FIFTH_RUNTIME_BUNDLE,
  'sweep',
  'loft',
  'mirror',
  'boolean',
  'splitBody',
] as const satisfies readonly MechanicalCoreFeatureId[];

export type MechanicalCoreRuntimeFeature =
  (typeof MECHANICAL_CORE_RUNTIME_BUNDLE)[number];

export const MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA =
  'nexyfab.mechanical-core-feature-local-runtime.v1' as const;

export interface MechanicalCoreRuntimePaths {
  artifactRoot: string;
  receiptOutput: string;
}

export interface MechanicalCoreRuntimeIntentBinding {
  caseId: string;
  candidateId: string;
  candidateBaseRevision: string;
  promptSha256: string;
  inputSha256: string;
  sourceUnits: readonly string[];
  normalizedUnit: 'mm';
  dimensionsMm: { width: number; length: number; thickness: number };
}

export interface MechanicalCoreRuntimeExecutionOptions {
  intentBindings?: Partial<Record<MechanicalCoreRuntimeFeature, MechanicalCoreRuntimeIntentBinding>>;
  /** Diagnostic/test-only subset. Omitted in evidence generation so the cumulative bundle remains authoritative. */
  featureFilter?: readonly MechanicalCoreRuntimeFeature[];
}

export const MECHANICAL_CORE_RUNTIME_PATHS: Readonly<MechanicalCoreRuntimePaths> = Object.freeze({
  artifactRoot: 'docs/evidence/cad-independent/local/mechanical-core-runtime-260813',
  receiptOutput: 'docs/evidence/cad-independent/local/mechanical-core-feature-axis-evidence.json',
});

interface ExactSnapshot {
  handle: string;
  kernelKind: string;
  nativeShapeType: number | null;
  solidCount: number | null;
  singleSolid: boolean;
  volumeMm3: number;
  edgeCount: number;
  faceCount: number;
  boundsMm: [[number, number, number], [number, number, number]];
}

interface ArtifactWrite {
  binding: MechanicalCoreLocalEvidenceBindingV1;
  bytes: number;
}

interface RuntimeHostBox { w: number; h: number; d: number; cx: number; cy: number; cz: number }

const HOST_BOX: Readonly<RuntimeHostBox> = Object.freeze({ w: 60, h: 40, d: 30, cx: 0, cy: 0, cz: 0 });
const PLATE_BOX: Readonly<RuntimeHostBox> = Object.freeze({ w: 60, h: 8, d: 30, cx: 0, cy: 0, cz: 0 });
const SHEET_METAL_BOX: Readonly<RuntimeHostBox> = Object.freeze({ w: 60, h: 2, d: 30, cx: 0, cy: 0, cz: 0 });
const PATTERN_SEED_BOX: Readonly<RuntimeHostBox> = Object.freeze({ w: 30, h: 20, d: 12, cx: 0, cy: 0, cz: 0 });
const HOST_VOLUME_MM3 = HOST_BOX.w * HOST_BOX.h * HOST_BOX.d;
const PLATE_VOLUME_MM3 = PLATE_BOX.w * PLATE_BOX.h * PLATE_BOX.d;
const PATTERN_SEED_VOLUME_MM3 = PATTERN_SEED_BOX.w * PATTERN_SEED_BOX.h * PATTERN_SEED_BOX.d;
const TESS = Object.freeze({ tolerance: 0.05, angularTolerance: 0.1 });
const SHA256 = /^[a-f0-9]{64}$/;

const EXACT_RUNTIME_NOT_RUN_REASON: Readonly<Partial<Record<MechanicalCoreRuntimeFeature, string>>> = Object.freeze({});

const slash = (value: string): string => value.replaceAll('\\', '/');
const render = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const hash = (bytes: Uint8Array | string): string =>
  crypto.createHash('sha256').update(bytes).digest('hex');

function resolveInside(root: string, relative: string): string {
  const normalized = slash(relative);
  if (!normalized || path.isAbsolute(relative) || normalized.split('/').includes('..')) {
    throw new Error(`MECHANICAL_RUNTIME_PATH_INVALID:${relative}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`MECHANICAL_RUNTIME_PATH_ESCAPE:${relative}`);
  }
  return resolved;
}

function writeArtifact(
  root: string,
  relative: string,
  bytes: Uint8Array | string,
  assertionId: string,
): ArtifactWrite {
  const absolute = resolveInside(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, bytes);
  const persisted = fs.readFileSync(absolute);
  return {
    bytes: persisted.byteLength,
    binding: {
      path: slash(relative),
      sha256: hash(persisted),
      bytes: persisted.byteLength,
      assertionId,
    },
  };
}

function clearGeneratedArtifactRoot(root: string, relative: string): void {
  const absolute = resolveInside(root, relative);
  const resolvedRoot = path.resolve(root);
  if (absolute === resolvedRoot) throw new Error('MECHANICAL_RUNTIME_REFUSES_ROOT_DELETE');
  if (!fs.existsSync(absolute)) return;
  if (fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`MECHANICAL_RUNTIME_REFUSES_SYMLINK_DELETE:${relative}`);
  }
  fs.rmSync(absolute, { recursive: true, force: true });
}

function featurePayload(
  feature: MechanicalCoreRuntimeFeature,
  edited: boolean,
  hostBox: Readonly<RuntimeHostBox> = HOST_BOX,
): FeatureInstance {
  const id = 'runtime-feature';
  const enabled = true;
  switch (feature) {
    case 'hole':
      return {
        id, enabled, type: feature,
        params: { holeType: 0, diameter: edited ? 12 : 8, posX: 0, posZ: 0, depth: 40, endCondition: 1, engine: 1 },
      };
    case 'fillet':
      const filletEdited = Math.min(4, hostBox.h * 0.35);
      return {
        id, enabled, type: feature,
        params: { radius: edited ? filletEdited : filletEdited * 0.5, edgeSelection: 0 },
      };
    case 'chamfer':
      const chamferEdited = Math.min(4, hostBox.h * 0.35);
      return {
        id, enabled, type: feature,
        params: { distance: edited ? chamferEdited : chamferEdited * 0.5, radius: edited ? chamferEdited : chamferEdited * 0.5, edgeSelection: 0 },
      };
    case 'shell':
      const shellEdited = Math.min(2.5, hostBox.h * 0.3);
      return {
        id, enabled, type: feature,
        params: { thickness: edited ? shellEdited : shellEdited * 0.6, openFace: 1 },
      };
    case 'rib':
      return {
        id, enabled, type: feature,
        params: { startX: -20, startZ: 0, endX: 20, endZ: 0, thickness: edited ? 5 : 3, height: 14, direction: 0 },
      };
    case 'linearPattern':
      return {
        id, enabled, type: feature,
        params: { axis: 0, count: edited ? 3 : 2, spacing: 20, patternTarget: 0 },
      };
    case 'circularPattern':
      return {
        id, enabled, type: feature,
        params: { axis: 1, count: edited ? 4 : 3, totalAngle: 360, patternTarget: 0 },
      };
    case 'draft':
      return {
        id, enabled, type: feature,
        params: { angle: edited ? 7 : 3, direction: 0 },
      };
    case 'scale':
      return {
        id, enabled, type: feature,
        params: { scaleX: edited ? 1.25 : 1.1, scaleY: edited ? 1.25 : 1.1, scaleZ: edited ? 1.25 : 1.1 },
      };
    case 'moveCopy':
      return {
        id, enabled, type: feature,
        params: { offsetX: edited ? 25 : 15, offsetY: 0, offsetZ: 0, operation: 1 },
      };
    case 'variableFillet':
      return {
        id, enabled, type: feature,
        params: { startRadius: 2, endRadius: edited ? 6 : 4, segments: 3, engine: 1 },
      };
    case 'offsetFace':
      return {
        id, enabled, type: feature,
        params: { distance: edited ? 5 : 3 },
      };
    case 'thread':
      return {
        id, enabled, type: feature,
        params: { pitch: edited ? 2.5 : 2, depth: 1, angle: 60, cosmetic: 0 },
      };
    case 'helix':
      return {
        id, enabled, type: feature,
        params: { radius: 5, pitch: edited ? 10 : 8, turns: 1, wireRadius: 1.5, axis: 1, handedness: 0 },
      };
    case 'bend':
      return {
        id, enabled, type: feature,
        params: { angle: edited ? 60 : 45, radius: 3, position: 50, direction: 0 },
      };
    case 'flange':
      return {
        id, enabled, type: feature,
        params: { height: edited ? 24 : 18, angle: 90, radius: 3, edgeIndex: 0 },
      };
    case 'hem':
      return {
        id, enabled, type: feature,
        params: { hemType: 0, length: edited ? 16 : 12, edgeIndex: 0 },
      };
    case 'jog':
      return {
        id, enabled, type: feature,
        params: { offset: edited ? 8 : 5, position: 40, spacing: 20, radius: 2 },
      };
    case 'tab':
      return {
        id, enabled, type: feature,
        params: { width: edited ? 24 : 18, length: 12, position: 50, edgeIndex: 0 },
      };
    case 'cut':
      return {
        id, enabled, type: feature,
        params: { width: edited ? 18 : 12, length: 10, posX: 0, posZ: 0, endCondition: 1, depth: 5 },
      };
    case 'bendRelief':
      return {
        id, enabled, type: feature,
        params: { width: edited ? 5 : 3, depth: 6, position: 50, shape: 0 },
      };
    case 'cornerRelief':
      return {
        id, enabled, type: feature,
        params: { corner: 0, shape: 0, size: edited ? 8 : 5, inset: 0 },
      };
    case 'variableShell':
      return {
        id, enabled, type: feature,
        params: { topThickness: 2, sideThickness: edited ? 2.5 : 1.5, bottomThickness: 2.5, openFace: 1 },
      };
    case 'sketchExtrude': {
      const depth = edited ? 18 : 12;
      const points = [[0, 0], [36, 0], [36, 22], [0, 22]] as const;
      return {
        id,
        enabled,
        type: feature,
        params: { depth },
        sketchData: {
          profile: {
            closed: true,
            segments: points.map((point, index) => {
              const next = points[(index + 1) % points.length]!;
              return {
                type: 'line' as const,
                points: [{ x: point[0], y: point[1] }, { x: next[0], y: next[1] }],
              };
            }),
          },
          config: { mode: 'extrude', depth, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
          plane: 'xy',
          planeOffset: 0,
          operation: 'add',
        },
      };
    }
    case 'revolve':
      return {
        id, enabled, type: feature,
        params: { angle: edited ? 300 : 240, segments: 32, axis: 1 },
      };
    case 'sweep':
      return {
        id, enabled, type: feature,
        params: {
          pathType: 0, length: edited ? 42 : 30, arcAngle: 90, arcRadius: 40,
          helixPitch: 10, helixTurns: 1, twist: 0, guideMode: 0, guideStart: 20, guideEnd: 20,
        },
      };
    case 'loft':
      return {
        id, enabled, type: feature,
        params: {
          sections: 3, height: 30, startShape: 1, endShape: 1,
          startSize: 10, endSize: edited ? 9 : 6, twist: 0,
        },
      };
    case 'mirror':
      return { id, enabled, type: feature, params: { plane: edited ? 2 : 0 } };
    case 'boolean':
      return {
        id, enabled, type: feature,
        params: {
          operation: 1, toolShape: 0, toolWidth: edited ? 14 : 10,
          toolHeight: hostBox.h + 10, toolDepth: 10,
          posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, engine: 1,
        },
      };
    case 'splitBody':
      return {
        id, enabled, type: feature,
        params: { plane: 0, offset: edited ? 4 : 0, keepSide: 0, engine: 1 },
      };
  }
  throw new Error(`${feature}:RUNTIME_PAYLOAD_NOT_IMPLEMENTED`);
}

function clonePayload(payload: FeatureInstance): FeatureInstance {
  return structuredClone(payload);
}

function featureHistory(payload: FeatureInstance): FeatureHistory {
  return {
    rootId: 'runtime-root',
    activeNodeId: payload.id,
    editingNodeId: null,
    nodes: [
      {
        id: 'runtime-root',
        type: 'baseShape',
        label: 'Base exact box',
        icon: 'base',
        params: {},
        enabled: true,
        expanded: true,
        parentId: null,
        children: [payload.id],
        editingActive: false,
        timestamp: 1,
      },
      {
        id: payload.id,
        type: 'feature',
        label: `Runtime ${payload.type}`,
        icon: 'feature',
        featureType: payload.type,
        params: { ...payload.params },
        enabled: payload.enabled,
        expanded: true,
        parentId: 'runtime-root',
        children: [],
        editingActive: false,
        timestamp: 2,
        ...(payload.sketchData ? { sketchData: structuredClone(payload.sketchData) } : {}),
      },
    ],
  };
}

function minimalScene(
  hostBox: Readonly<RuntimeHostBox> = HOST_BOX,
): NfabProjectV1['scene'] {
  return {
    selectedId: 'box',
    params: { width: hostBox.w, height: hostBox.h, depth: hostBox.d },
    paramExpressions: {},
    materialId: 'aluminum',
    color: '#cccccc',
    isSketchMode: false,
    sketchPlane: 'xy',
    sketchProfile: { segments: [], closed: false },
    sketchConfig: { mode: 'extrude', depth: hostBox.d, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
  };
}

function serializeNfab(
  payload: FeatureInstance,
  feature: MechanicalCoreRuntimeFeature,
  hostBox: Readonly<RuntimeHostBox> = HOST_BOX,
  intentBinding?: MechanicalCoreRuntimeIntentBinding,
): string {
  return toJsonString(serializeProject({
    name: `Mechanical runtime ${feature}`,
    history: featureHistory(payload),
    scene: minimalScene(hostBox),
    meta: {
      evidenceOnly: true,
      exactKernel: 'OCCT',
      ...(intentBinding ? {
        intentCaseId: intentBinding.caseId,
        intentInputSha256: intentBinding.inputSha256,
        candidateBaseRevision: intentBinding.candidateBaseRevision,
      } : {}),
    },
  }), true);
}

function payloadFromNfab(serialized: string, feature: MechanicalCoreRuntimeFeature): FeatureInstance {
  const project = parseProject(serialized);
  const node = project.tree.nodes.find(item => item.id === 'runtime-feature');
  if (!node || node.type !== 'feature' || node.featureType !== feature) {
    throw new Error(`${feature}:NFAB_FEATURE_NODE_MISSING`);
  }
  return {
    id: node.id,
    type: feature,
    params: { ...node.params },
    enabled: node.enabled,
    ...(node.sketchData ? { sketchData: structuredClone(node.sketchData) } : {}),
  };
}

function requireHandle(handle: string | null | undefined, operation: string): string {
  if (!handle) throw new Error(`${operation}:OCCT_HANDLE_MISSING`);
  return handle;
}

function requireExactProductHandle(
  geometry: THREE.BufferGeometry,
  operation: string,
): string {
  const downgrades = geometry.userData.__meshDowngrades;
  if (Array.isArray(downgrades) && downgrades.length > 0) {
    throw new Error(`${operation}:MESH_FALLBACK_REJECTED`);
  }
  return requireHandle(geometry.userData.occtHandle as string | undefined, operation);
}

async function buildExact(
  feature: MechanicalCoreRuntimeFeature,
  payload: FeatureInstance,
  intentHostBox?: Readonly<RuntimeHostBox>,
): Promise<string> {
  if (payload.type !== feature) {
    throw new Error(`${feature}:PAYLOAD_KIND_MISMATCH:${payload.type}`);
  }
  const hostBox = intentHostBox ?? (feature === 'rib'
    ? PLATE_BOX
    : feature === 'bend' || feature === 'flange' || feature === 'hem' || feature === 'jog'
      || feature === 'bendRelief' || feature === 'cornerRelief'
      ? SHEET_METAL_BOX
    : feature === 'linearPattern' || feature === 'circularPattern'
      ? PATTERN_SEED_BOX
      : HOST_BOX);
  const base = occtBaseSolid('box', {
    width: hostBox.w,
    height: hostBox.h,
    depth: hostBox.d,
  }, TESS);
  let hostHandle = requireHandle(base.handle, `${feature}:base`);
  const p = payload.params;
  if (feature === 'circularPattern') {
    hostHandle = requireHandle(occtMoveCopy(hostHandle, 10, 0, 0, 0, TESS).handle, `${feature}:offset-seed`);
  }

  switch (feature) {
    case 'hole':
      return requireHandle(occtBoxBooleanWithPrimitive(
        'subtract',
        hostBox,
        {
          shape: 'cylinder',
          w: p.diameter!,
          h: hostBox.h + 10,
          d: p.diameter!,
          cx: p.posX!,
          cy: 0,
          cz: p.posZ!,
          rx: 0,
          ry: 0,
          rz: 0,
        },
        TESS,
        hostHandle,
      ).handle, 'hole:subtract');
    case 'fillet':
      return requireHandle(
        occtFilletBox(hostBox, p.radius!, TESS, hostHandle).handle,
        'fillet:native',
      );
    case 'chamfer':
      return requireHandle(
        occtChamferBox(hostBox, p.distance!, TESS, hostHandle).handle,
        'chamfer:native',
      );
    case 'shell':
      return requireHandle(
        occtShellBox(hostBox, p.thickness!, p.openFace!, TESS, hostHandle).handle,
        'shell:native',
      );
    case 'rib':
      return requireHandle(occtRib(
        hostHandle,
        {
          startX: p.startX!,
          startZ: p.startZ!,
          endX: p.endX!,
          endZ: p.endZ!,
          thickness: p.thickness!,
          height: p.height!,
          direction: p.direction!,
        },
        -hostBox.h / 2,
        hostBox.h / 2,
        TESS,
      ).handle, 'rib:native-fuse');
    case 'linearPattern':
      return requireHandle(
        occtLinearPattern(hostHandle, p.axis!, p.count!, p.spacing!, TESS).handle,
        'linearPattern:native-fuse',
      );
    case 'circularPattern':
      return requireHandle(
        occtCircularPattern(hostHandle, p.axis!, p.count!, p.totalAngle!, TESS).handle,
        'circularPattern:native-fuse',
      );
    case 'draft':
      return requireHandle(
        occtDraft(hostHandle, p.angle!, p.direction!, TESS).handle,
        'draft:native',
      );
    case 'scale':
      return requireHandle(
        occtScale(hostHandle, p.scaleX!, p.scaleY!, p.scaleZ!, TESS).handle,
        'scale:native-uniform',
      );
    case 'moveCopy':
      return requireHandle(
        occtMoveCopy(hostHandle, p.offsetX!, p.offsetY!, p.offsetZ!, p.operation!, TESS).handle,
        'moveCopy:native-fuse',
      );
    case 'variableFillet': {
      const edgeFinder = await buildEdgeFinderFromSelection({
        type: 'edge',
        position: [hostBox.w / 2, hostBox.h / 2, 0],
        length: hostBox.d,
        normal: [1, 0, 0],
      });
      if (!edgeFinder) throw new Error('variableFillet:EXACT_EDGE_FINDER_UNAVAILABLE');
      return requireHandle(
        occtVariableFillet(
          hostBox,
          p.startRadius!,
          p.endRadius!,
          TESS,
          hostHandle,
          edgeFinder,
        ).handle,
        'variableFillet:native-selected-edge',
      );
    }
    case 'offsetFace':
      return requireHandle(
        occtOffsetFace(
          hostHandle,
          { position: [0, hostBox.h / 2, 0], normal: [0, 1, 0] },
          p.distance!,
          TESS,
        ).handle,
        'offsetFace:native-planar-push-pull',
      );
    case 'helix': {
      const empty = new THREE.BufferGeometry();
      empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      empty.setIndex([]);
      const result = await helixFeature.applyAsync!(empty, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'helix:product-native-solid-sweep',
      );
    }
    case 'thread': {
      const cylinder = occtBaseSolid('cylinder', { diameter: 20, height: 8 }, TESS);
      cylinder.geometry.userData.occtHandle = requireHandle(cylinder.handle, 'thread:cylinder-base');
      const result = await threadFeature.applyAsync!(cylinder.geometry, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'thread:product-native-triangular-helix-cut',
      );
    }
    case 'bend': {
      base.geometry.userData.occtHandle = hostHandle;
      const result = await bendFeature.applyAsync!(base.geometry, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'bend:product-native-constant-thickness-sheet',
      );
    }
    case 'flange': {
      base.geometry.userData.occtHandle = hostHandle;
      const result = await flangeFeature.applyAsync!(base.geometry, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'flange:product-native-analytic-edge-flange',
      );
    }
    case 'hem': {
      base.geometry.userData.occtHandle = hostHandle;
      const result = await hemFeature.applyAsync!(base.geometry, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'hem:product-native-analytic-180-degree-bend',
      );
    }
    case 'jog': {
      base.geometry.userData.occtHandle = hostHandle;
      const result = await jogFeature.applyAsync!(base.geometry, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'jog:product-native-volume-conserving-double-bend',
      );
    }
    case 'tab':
      return requireHandle(applyTabOcct(hostHandle, hostBox, {
        width: p.width!,
        length: p.length!,
        position: p.position! / 100,
        edgeIndex: Math.round(p.edgeIndex!),
      }, TESS).handle, 'tab:native-in-plane-fuse');
    case 'cut':
      return requireHandle(applyCutOcct(hostHandle, hostBox, {
        width: p.width!,
        length: p.length!,
        posX: p.posX!,
        posZ: p.posZ!,
        endCondition: 'through_all',
        depth: p.depth!,
      }, TESS).handle, 'cut:native-through-all-subtract');
    case 'bendRelief': {
      base.geometry.userData.occtHandle = hostHandle;
      base.geometry.userData.__bendHistory = [{
        angle: 90,
        radius: 2,
        position: 0.5,
        direction: 'up',
        lineAxis: 'x',
        linePos: 0,
      }];
      const result = await bendReliefFeature.applyAsync!(base.geometry, p, { featureId: payload.id });
      return requireExactProductHandle(result, 'bendRelief:product-native-sequential-relief-subtract');
    }
    case 'cornerRelief': {
      base.geometry.userData.occtHandle = hostHandle;
      const result = await cornerReliefFeature.applyAsync!(base.geometry, p, { featureId: payload.id });
      return requireExactProductHandle(result, 'cornerRelief:product-native-corner-subtract');
    }
    case 'variableShell': {
      base.geometry.userData.occtHandle = hostHandle;
      const result = await variableShellFeature.applyAsync!(base.geometry, p, { featureId: payload.id });
      return requireExactProductHandle(result, 'variableShell:product-native-faithful-box-cavity-subtract');
    }
    case 'sketchExtrude': {
      if (!payload.sketchData) throw new Error('sketchExtrude:SKETCH_DATA_MISSING');
      const emptyBase = new THREE.BufferGeometry();
      emptyBase.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      emptyBase.setIndex([]);
      const productResult = await runPipelineAsync(
        emptyBase,
        [clonePayload(payload)],
        {} as FeatureMap,
        { occtMode: true },
      );
      const pipelineError = productResult.errors[payload.id];
      if (pipelineError) throw new Error(`sketchExtrude:PRODUCT_PIPELINE_FAILED:${pipelineError}`);
      return requireHandle(
        productResult.geometry.userData.occtHandle as string | undefined,
        'sketchExtrude:product-inline-native-extrude',
      );
    }
    case 'revolve': {
      const profile = new THREE.BufferGeometry();
      profile.setAttribute('position', new THREE.Float32BufferAttribute([
        10, -10, 0,
        16, -10, 0,
        16, 10, 0,
        10, 10, 0,
      ], 3));
      const result = await revolveFeature.applyAsync!(profile, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'revolve:product-native-partial-angle',
      );
    }
    case 'sweep': {
      const section = new THREE.BoxGeometry(8, 6, 2);
      const result = await sweepFeature.applyAsync!(section, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'sweep:product-native-straight-path',
      );
    }
    case 'loft': {
      const result = await loftFeature.applyAsync!(new THREE.BufferGeometry(), p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'loft:product-native-profile-stack',
      );
    }
    case 'mirror': {
      const moved = occtMoveCopy(hostHandle, hostBox.w / 2, 0, 0, 0, TESS);
      moved.geometry.userData.occtHandle = requireHandle(moved.handle, 'mirror:offset-seed');
      const result = await mirrorFeature.applyAsync!(moved.geometry, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'mirror:product-native-principal-plane',
      );
    }
    case 'boolean': {
      base.geometry.userData.occtHandle = hostHandle;
      const result = booleanFeature.apply(base.geometry, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'boolean:product-native-primitive-subtract',
      );
    }
    case 'splitBody': {
      base.geometry.userData.occtHandle = hostHandle;
      const result = splitBodyFeature.apply(base.geometry, p, { featureId: payload.id });
      return requireHandle(
        result.userData.occtHandle as string | undefined,
        'splitBody:product-native-halfspace-intersection',
      );
    }
    default:
      throw new Error(`${feature}:EXACT_RUNTIME_NOT_IMPLEMENTED`);
  }
}

function exactSnapshot(handle: string, operation: string): ExactSnapshot {
  const kernel = occtRegisteredShapeEvidence(handle);
  const shape = getShape(handle) as {
    boundingBox?: { bounds?: [[number, number, number], [number, number, number]] };
  } | null;
  const bounds = shape?.boundingBox?.bounds;
  const edges = occtEdgeSignatures(handle);
  const faces = occtFaceSignatures(handle);
  if (!kernel?.singleSolid) throw new Error(`${operation}:NOT_ONE_EXACT_SOLID`);
  if (!(typeof kernel.volumeMm3 === 'number' && Number.isFinite(kernel.volumeMm3) && kernel.volumeMm3 > 0)) {
    throw new Error(`${operation}:EXACT_VOLUME_MISSING`);
  }
  if (!Array.isArray(bounds) || bounds.length !== 2 || bounds.some(row => !Array.isArray(row) || row.length !== 3 || row.some(value => !Number.isFinite(value)))) {
    throw new Error(`${operation}:EXACT_BOUNDS_MISSING`);
  }
  if (edges.length === 0 || faces.length === 0) {
    throw new Error(`${operation}:EXACT_TOPOLOGY_EMPTY`);
  }
  return {
    handle,
    kernelKind: kernel.kind,
    nativeShapeType: kernel.nativeShapeType,
    solidCount: kernel.solidCount,
    singleSolid: kernel.singleSolid,
    volumeMm3: kernel.volumeMm3,
    edgeCount: edges.length,
    faceCount: faces.length,
    boundsMm: bounds.map(row => [...row]) as ExactSnapshot['boundsMm'],
  };
}

async function assertFeatureEffect(
  feature: MechanicalCoreRuntimeFeature,
  snapshot: ExactSnapshot,
  payload: FeatureInstance,
  intentHostBox?: Readonly<RuntimeHostBox>,
): Promise<Record<string, unknown>> {
  const hostBox = intentHostBox ?? (feature === 'bend' || feature === 'flange' || feature === 'hem' || feature === 'jog'
    || feature === 'bendRelief' || feature === 'cornerRelief'
    ? SHEET_METAL_BOX
    : HOST_BOX);
  if (feature === 'variableFillet') {
    const startRadius = payload.params.startRadius!;
    const endRadius = payload.params.endRadius!;
    if (!(endRadius > startRadius)) throw new Error('variableFillet:RADIUS_RAMP_NOT_INCREASING');
    const constantStart = clonePayload(payload);
    constantStart.params = { ...constantStart.params, endRadius: startRadius };
    resetShapeRegistry();
    const startSnapshot = exactSnapshot(
      await buildExact(feature, constantStart, intentHostBox),
      'variableFillet:constant-start-comparator',
    );
    const constantEnd = clonePayload(payload);
    constantEnd.params = { ...constantEnd.params, startRadius: endRadius };
    resetShapeRegistry();
    const endSnapshot = exactSnapshot(
      await buildExact(feature, constantEnd, intentHostBox),
      'variableFillet:constant-end-comparator',
    );
    if (!(endSnapshot.volumeMm3 < snapshot.volumeMm3 && snapshot.volumeMm3 < startSnapshot.volumeMm3)) {
      throw new Error('variableFillet:VARIABLE_RADIUS_VOLUME_NOT_BETWEEN_CONSTANT_ENDPOINTS');
    }
    return {
      assertion: 'selected-edge variable-radius fillet volume lies strictly between constant start- and end-radius exact fillets',
      startRadius,
      endRadius,
      constantStartVolumeMm3: startSnapshot.volumeMm3,
      variableVolumeMm3: snapshot.volumeMm3,
      constantEndVolumeMm3: endSnapshot.volumeMm3,
    };
  }
  if (feature === 'offsetFace') {
    const distance = payload.params.distance!;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const expected = baseline + hostBox.w * hostBox.d * distance;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('offsetFace:PLANAR_AREA_TIMES_DISTANCE_IDENTITY_FAILED');
    }
    const expectedTop = hostBox.h / 2 + distance;
    if (!closeEnough(snapshot.boundsMm[1][1], expectedTop, 1e-7)) {
      throw new Error('offsetFace:SELECTED_FACE_DID_NOT_MOVE_REQUESTED_DISTANCE');
    }
    return {
      assertion: 'planar +Y face push obeys delta-volume = face-area x distance and moves the selected face by the requested distance',
      distanceMm: distance,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
      expectedTopMm: expectedTop,
      actualTopMm: snapshot.boundsMm[1][1],
    };
  }
  if (feature === 'helix') {
    const axis = Math.round(payload.params.axis!);
    const pitch = payload.params.pitch!;
    const turns = Math.round(payload.params.turns!);
    const radius = payload.params.radius!;
    const axialSpan = snapshot.boundsMm[1][axis]! - snapshot.boundsMm[0][axis]!;
    const radialAxes = [0, 1, 2].filter(index => index !== axis);
    const radialSpans = radialAxes.map(index => snapshot.boundsMm[1][index]! - snapshot.boundsMm[0][index]!);
    const requestedRise = pitch * turns;
    if (axialSpan < requestedRise * 0.9 || radialSpans.some(span => span < radius * 1.8)) {
      throw new Error('helix:EXACT_SWEEP_DOES_NOT_REFLECT_RADIUS_PITCH_TURNS_AXIS');
    }
    return {
      assertion: 'closed circular profile was swept into one exact solid whose axial and radial extents reflect pitch, turns, radius, and selected axis',
      axis,
      pitchMm: pitch,
      turns,
      radiusMm: radius,
      requestedRiseMm: requestedRise,
      axialSpanMm: axialSpan,
      radialSpansMm: radialSpans,
    };
  }
  if (feature === 'thread') {
    const radius = 10;
    const height = 8;
    const baseline = Math.PI * radius * radius * height;
    const removed = baseline - snapshot.volumeMm3;
    if (!(removed > 0 && snapshot.volumeMm3 < baseline)) {
      throw new Error('thread:EXACT_HELICAL_GROOVE_DID_NOT_REMOVE_MATERIAL');
    }
    const radialSpans = [
      snapshot.boundsMm[1][0] - snapshot.boundsMm[0][0],
      snapshot.boundsMm[1][2] - snapshot.boundsMm[0][2],
    ];
    const axialSpan = snapshot.boundsMm[1][1] - snapshot.boundsMm[0][1];
    // OCCT's post-boolean bounding box carries the operation tolerance; the
    // envelope must remain within 0.1 mm of the untouched host cylinder.
    if (radialSpans.some(span => Math.abs(span - 2 * radius) > 0.1)
      || Math.abs(axialSpan - height) > 0.1) {
      throw new Error(`thread:HOST_CYLINDER_OUTER_ENVELOPE_CHANGED:${JSON.stringify({ radialSpans, axialSpan })}`);
    }
    return {
      assertion: 'actual product thread registry path subtracted an exact triangular helical cutter while retaining the cylindrical host envelope',
      pitchMm: payload.params.pitch,
      depthMm: payload.params.depth,
      includedAngleDeg: payload.params.angle,
      turns: Math.floor(height / payload.params.pitch!),
      baselineVolumeMm3: baseline,
      removedVolumeMm3: removed,
      actualVolumeMm3: snapshot.volumeMm3,
      radialSpansMm: radialSpans,
      axialSpanMm: axialSpan,
    };
  }
  if (feature === 'bend') {
    const thickness = hostBox.h;
    const width = hostBox.d;
    const primaryLength = hostBox.w;
    const angleRad = payload.params.angle! * Math.PI / 180;
    const radius = payload.params.radius!;
    const fixedLength = primaryLength * payload.params.position! / 100;
    const movingDevelopedLength = primaryLength - fixedLength;
    const neutralRadius = radius + thickness / 2;
    const neutralArcLength = neutralRadius * angleRad;
    const straightLength = movingDevelopedLength - neutralArcLength;
    const expected = width * thickness * primaryLength;
    if (!(straightLength >= 0) || !closeEnough(snapshot.volumeMm3, expected, 1e-6)) {
      throw new Error(`bend:CONSTANT_THICKNESS_NEUTRAL_AXIS_VOLUME_IDENTITY_FAILED:${JSON.stringify({ expected, actual: snapshot.volumeMm3, straightLength })}`);
    }
    const faceTypes = occtFaceSignatures(snapshot.handle).map(face => face.geomType ?? 'unknown');
    const cylindricalFaces = faceTypes
      .filter(type => type.toLowerCase().includes('cyl')).length;
    if (cylindricalFaces < 2) throw new Error(`bend:ANALYTIC_INNER_OUTER_BEND_FACES_MISSING:${JSON.stringify(faceTypes)}`);
    const expectedTop = -thickness / 2 + Math.max(
      (radius + thickness) * (1 - Math.cos(angleRad)),
      thickness + radius * (1 - Math.cos(angleRad)),
    ) + straightLength * Math.sin(angleRad);
    if (Math.abs(snapshot.boundsMm[1][1] - expectedTop) > 0.1) {
      throw new Error(`bend:ANGLE_AND_NEUTRAL_LENGTH_NOT_REFLECTED_IN_BOUNDS:${JSON.stringify({ expectedTop, actualTop: snapshot.boundsMm[1][1], bounds: snapshot.boundsMm })}`);
    }
    return {
      assertion: 'actual product bend preserves constant sheet volume and uses concentric analytic cylindrical faces around the R+T/2 geometric neutral axis',
      angleDeg: payload.params.angle,
      radiusMm: radius,
      thicknessMm: thickness,
      neutralRadiusMm: neutralRadius,
      neutralArcLengthMm: neutralArcLength,
      straightLengthMm: straightLength,
      cylindricalFaces,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
      expectedTopMm: expectedTop,
      actualTopMm: snapshot.boundsMm[1][1],
    };
  }
  if (feature === 'flange') {
    const thickness = hostBox.h;
    const width = hostBox.w;
    const angleRad = payload.params.angle! * Math.PI / 180;
    const radius = payload.params.radius!;
    const straightLength = payload.params.height! - radius;
    const neutralRadius = radius + thickness / 2;
    const addedDevelopedLength = straightLength + neutralRadius * angleRad;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const expected = baseline + width * thickness * addedDevelopedLength;
    if (!(straightLength >= 0) || !closeEnough(snapshot.volumeMm3, expected, 1e-6)) {
      throw new Error(`flange:ADDED_DEVELOPED_LENGTH_VOLUME_IDENTITY_FAILED:${JSON.stringify({ expected, actual: snapshot.volumeMm3, straightLength })}`);
    }
    const faceTypes = occtFaceSignatures(snapshot.handle).map(face => face.geomType ?? 'unknown');
    const cylindricalFaces = faceTypes
      .filter(type => type.toLowerCase().includes('cyl')).length;
    if (cylindricalFaces < 2) throw new Error(`flange:ANALYTIC_INNER_OUTER_BEND_FACES_MISSING:${JSON.stringify(faceTypes)}`);
    const expectedTop = -thickness / 2 + Math.max(
      (radius + thickness) * (1 - Math.cos(angleRad)),
      thickness + radius * (1 - Math.cos(angleRad)),
    ) + straightLength * Math.sin(angleRad);
    if (Math.abs(snapshot.boundsMm[1][1] - expectedTop) > 0.1) {
      throw new Error('flange:HEIGHT_NOT_REFLECTED_IN_EXACT_BOUND');
    }
    return {
      assertion: 'actual product exact edge flange adds width x thickness x developed-length volume with concentric analytic bend faces and the requested straight height',
      edgeIndex: payload.params.edgeIndex,
      angleDeg: payload.params.angle,
      radiusMm: radius,
      thicknessMm: thickness,
      neutralRadiusMm: neutralRadius,
      addedDevelopedLengthMm: addedDevelopedLength,
      cylindricalFaces,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
      expectedTopMm: expectedTop,
      actualTopMm: snapshot.boundsMm[1][1],
    };
  }
  if (feature === 'hem') {
    const thickness = hostBox.h;
    const width = hostBox.w;
    const radius = thickness / 2; // runner selects closed hem (hemType=0)
    const neutralRadius = radius + thickness / 2;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const addedDevelopedLength = payload.params.length! + Math.PI * neutralRadius;
    const expected = baseline + width * thickness * addedDevelopedLength;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-6)) {
      throw new Error('hem:DEVELOPED_LENGTH_VOLUME_IDENTITY_FAILED');
    }
    const faceTypes = occtFaceSignatures(snapshot.handle).map(face => face.geomType ?? 'unknown');
    const cylindricalFaces = faceTypes.filter(type => type.toLowerCase().includes('cyl')).length;
    if (cylindricalFaces < 2) throw new Error('hem:ANALYTIC_180_DEGREE_BEND_FACES_MISSING');
    const expectedTop = -thickness / 2 + 2 * (radius + thickness);
    const expectedOutward = hostBox.d / 2 + radius + thickness;
    if (Math.abs(snapshot.boundsMm[1][1] - expectedTop) > 0.1
      || Math.abs(snapshot.boundsMm[1][2] - expectedOutward) > 0.1) {
      throw new Error('hem:180_DEGREE_ENVELOPE_NOT_REFLECTED_IN_EXACT_BOUNDS');
    }
    return {
      assertion: 'actual product exact closed hem adds its neutral-axis developed length through one analytic 180-degree annular bend while preserving constant thickness',
      hemType: payload.params.hemType,
      lengthMm: payload.params.length,
      radiusMm: radius,
      thicknessMm: thickness,
      neutralRadiusMm: neutralRadius,
      addedDevelopedLengthMm: addedDevelopedLength,
      cylindricalFaces,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
      expectedTopMm: expectedTop,
      expectedOutwardMm: expectedOutward,
    };
  }
  if (feature === 'jog') {
    const thickness = hostBox.h;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    if (!closeEnough(snapshot.volumeMm3, baseline, 1e-6)) {
      throw new Error('jog:VOLUME_CONSERVATION_FAILED');
    }
    const faceTypes = occtFaceSignatures(snapshot.handle).map(face => face.geomType ?? 'unknown');
    const cylindricalFaces = faceTypes.filter(type => type.toLowerCase().includes('cyl')).length;
    if (cylindricalFaces < 4) throw new Error('jog:TWO_ANALYTIC_BENDS_MISSING');
    const expectedTop = hostBox.cy - thickness / 2 + thickness + payload.params.offset!;
    if (Math.abs(snapshot.boundsMm[1][1] - expectedTop) > 0.1) {
      throw new Error('jog:REQUESTED_OFFSET_NOT_REFLECTED_IN_EXACT_BOUND');
    }
    const projectedLength = snapshot.boundsMm[1][0] - snapshot.boundsMm[0][0];
    if (!(projectedLength < hostBox.w && projectedLength > hostBox.w - payload.params.spacing!)) {
      throw new Error('jog:DEVELOPED_SPACING_DID_NOT_PROJECT_TO_SHORTER_FOLDED_LENGTH');
    }
    return {
      assertion: 'actual product exact jog conserves blank volume and creates two opposite analytic bends with constant-thickness neutral-axis developed spacing',
      offsetMm: payload.params.offset,
      developedSpacingMm: payload.params.spacing,
      radiusMm: payload.params.radius,
      thicknessMm: thickness,
      cylindricalFaces,
      baselineVolumeMm3: baseline,
      actualVolumeMm3: snapshot.volumeMm3,
      expectedTopMm: expectedTop,
      actualTopMm: snapshot.boundsMm[1][1],
      projectedLengthMm: projectedLength,
    };
  }
  if (feature === 'tab') {
    const edgeIndex = Math.round(payload.params.edgeIndex!);
    const edgeLength = edgeIndex <= 1 ? hostBox.w : hostBox.d;
    const tabWidth = Math.min(payload.params.width!, edgeLength);
    const tabLength = payload.params.length!;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const expected = baseline + tabWidth * hostBox.h * tabLength;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('tab:IN_PLANE_ADDED_VOLUME_IDENTITY_FAILED');
    }
    const outer = edgeIndex === 0 ? snapshot.boundsMm[1][2]
      : edgeIndex === 1 ? snapshot.boundsMm[0][2]
      : edgeIndex === 2 ? snapshot.boundsMm[1][0]
      : snapshot.boundsMm[0][0];
    const hostOuter = edgeIndex === 0 ? hostBox.cz + hostBox.d / 2
      : edgeIndex === 1 ? hostBox.cz - hostBox.d / 2
      : edgeIndex === 2 ? hostBox.cx + hostBox.w / 2
      : hostBox.cx - hostBox.w / 2;
    if (!closeEnough(Math.abs(outer - hostOuter), tabLength, 1e-7)) {
      throw new Error('tab:OUTWARD_LENGTH_NOT_REFLECTED_IN_EXACT_BOUNDS');
    }
    return {
      assertion: 'exact coplanar tab adds width x sheet-thickness x outward-length volume and extends the selected edge by the requested length',
      widthMm: tabWidth,
      lengthMm: tabLength,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
      outwardExtensionMm: Math.abs(outer - hostOuter),
    };
  }
  if (feature === 'cut') {
    const width = payload.params.width!;
    const length = payload.params.length!;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const expected = baseline - width * hostBox.h * length;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('cut:THROUGH_ALL_REMOVED_VOLUME_IDENTITY_FAILED');
    }
    const expectedBounds = [
      hostBox.cx - hostBox.w / 2, hostBox.cy - hostBox.h / 2, hostBox.cz - hostBox.d / 2,
      hostBox.cx + hostBox.w / 2, hostBox.cy + hostBox.h / 2, hostBox.cz + hostBox.d / 2,
    ];
    if (!snapshot.boundsMm.flat().every((value, index) => closeEnough(value, expectedBounds[index]!, 1e-7))) {
      throw new Error('cut:HOST_OUTER_BOUNDS_CHANGED');
    }
    return {
      assertion: 'exact centered rectangular through-cut removes width x sheet-thickness x length while preserving the host outer bounds',
      widthMm: width,
      lengthMm: length,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'bendRelief') {
    const width = payload.params.width!;
    const depth = payload.params.depth!;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const removed = 2 * width * depth * hostBox.h;
    const expected = baseline - removed;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('bendRelief:TWO_RECTANGULAR_NOTCH_VOLUME_IDENTITY_FAILED');
    }
    return {
      assertion: 'actual product exact bend relief subtracts two rectangular end notches located from explicit bend history',
      exactScope: 'axis-aligned constant-thickness box host with explicit v2 bend history',
      bendLineAxis: 'x',
      bendLinePosMm: 0,
      widthMm: width,
      depthMm: depth,
      removedVolumeMm3: removed,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'cornerRelief') {
    const size = payload.params.size!;
    const radius = size / 2;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const removed = Math.PI * radius ** 2 / 4 * hostBox.h;
    const expected = baseline - removed;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-6)) {
      throw new Error('cornerRelief:CIRCULAR_QUARTER_CYLINDER_VOLUME_IDENTITY_FAILED');
    }
    const cylindricalFaces = occtFaceSignatures(snapshot.handle)
      .filter(face => (face.geomType ?? '').toLowerCase().includes('cyl')).length;
    if (cylindricalFaces < 1) throw new Error('cornerRelief:ANALYTIC_CYLINDRICAL_CUT_FACE_MISSING');
    return {
      assertion: 'actual product exact circular corner relief subtracts one analytic quarter-cylinder from the selected sheet corner',
      exactScope: 'axis-aligned constant-thickness box host',
      corner: payload.params.corner,
      sizeMm: size,
      cylindricalFaces,
      removedVolumeMm3: removed,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'variableShell') {
    const sideThickness = payload.params.sideThickness!;
    const bottomThickness = payload.params.bottomThickness!;
    const openFace = Math.round(payload.params.openFace!);
    if (openFace !== 1) throw new Error('variableShell:RUNTIME_CASE_REQUIRES_OPEN_TOP');
    const innerWidth = hostBox.w - 2 * sideThickness;
    const innerDepth = hostBox.d - 2 * sideThickness;
    const removedHeight = hostBox.h - bottomThickness;
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const removed = innerWidth * removedHeight * innerDepth;
    const expected = baseline - removed;
    if (!(innerWidth > 0 && innerDepth > 0 && removedHeight > 0)
      || !closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('variableShell:FAITHFUL_BOX_OPEN_CAVITY_VOLUME_IDENTITY_FAILED');
    }
    return {
      assertion: 'actual product exact variable shell subtracts an open-top rectangular cavity with independent side and bottom thicknesses',
      exactScope: 'axis-aligned bbox-faithful box only; general per-face B-Rep thickening remains unsupported and fail-closed',
      unsupportedGeometryError: 'VARIABLE_SHELL_EXACT_BOX_REQUIRED',
      openFace: 'top',
      sideThicknessMm: sideThickness,
      bottomThicknessMm: bottomThickness,
      innerWidthMm: innerWidth,
      innerDepthMm: innerDepth,
      removedHeightMm: removedHeight,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'sketchExtrude') {
    const sketchData = payload.sketchData;
    if (!sketchData || sketchData.config.mode !== 'extrude') {
      throw new Error('sketchExtrude:STRAIGHT_EXTRUDE_SKETCH_REQUIRED');
    }
    const depth = sketchData.config.depth;
    const expected = 36 * 22 * depth;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('sketchExtrude:PROFILE_AREA_TIMES_DEPTH_IDENTITY_FAILED');
    }
    const zSpan = snapshot.boundsMm[1][2] - snapshot.boundsMm[0][2];
    if (!closeEnough(zSpan, depth, 1e-7)) {
      throw new Error('sketchExtrude:EXACT_DEPTH_NOT_REFLECTED_IN_BOUNDS');
    }
    return {
      assertion: 'actual product inline sketchExtrude created one exact OCCT prism with volume = closed-profile area x edited depth',
      profileAreaMm2: 36 * 22,
      depthMm: depth,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
      exactZSpanMm: zSpan,
    };
  }
  if (feature === 'revolve') {
    const angleDeg = payload.params.angle!;
    const expected = angleDeg / 360 * Math.PI * (16 ** 2 - 10 ** 2) * 20;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-6)) {
      throw new Error('revolve:ANNULAR_SECTOR_VOLUME_IDENTITY_FAILED');
    }
    return {
      assertion: 'actual product revolve created one exact partial-angle OCCT annular sector with analytic volume',
      angleDeg,
      innerRadiusMm: 10,
      outerRadiusMm: 16,
      heightMm: 20,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'sweep') {
    const length = payload.params.length!;
    const expected = 8 * 6 * length;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('sweep:SECTION_AREA_TIMES_PATH_LENGTH_IDENTITY_FAILED');
    }
    return {
      assertion: 'actual product straight-path sweep preserved the exact rectangular section along the requested path length',
      sectionAreaMm2: 8 * 6,
      pathLengthMm: length,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'loft') {
    const startSize = payload.params.startSize!;
    const endSize = payload.params.endSize!;
    const height = payload.params.height!;
    const expected = 4 * height / 3 * (
      startSize ** 2 + startSize * endSize + endSize ** 2
    );
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-6)) {
      throw new Error('loft:SQUARE_FRUSTUM_VOLUME_IDENTITY_FAILED');
    }
    return {
      assertion: 'actual product OCCT loft between square sections satisfies the analytic square-frustum volume identity',
      startHalfSizeMm: startSize,
      endHalfSizeMm: endSize,
      heightMm: height,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'mirror') {
    const plane = Math.round(payload.params.plane!);
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const expected = plane === 0 ? baseline * 2 : baseline;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('mirror:PRINCIPAL_PLANE_UNION_VOLUME_IDENTITY_FAILED');
    }
    return {
      assertion: 'actual product OCCT mirror fused an origin-plane reflection; YZ doubles the tangent offset seed while XY coincides with it',
      plane,
      baselineVolumeMm3: baseline,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'boolean') {
    const baseline = hostBox.w * hostBox.h * hostBox.d;
    const removed = payload.params.toolWidth! * hostBox.h * payload.params.toolDepth!;
    const expected = baseline - removed;
    if (!closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('boolean:THROUGH_TOOL_REMOVED_VOLUME_IDENTITY_FAILED');
    }
    return {
      assertion: 'actual product OCCT boolean subtracted a centered through-box with analytic removed volume',
      baselineVolumeMm3: baseline,
      removedVolumeMm3: removed,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
    };
  }
  if (feature === 'splitBody') {
    const offset = payload.params.offset!;
    const retainedDepth = hostBox.d / 2 - offset;
    const expected = hostBox.w * hostBox.h * retainedDepth;
    if (!(retainedDepth > 0) || !closeEnough(snapshot.volumeMm3, expected, 1e-7)) {
      throw new Error('splitBody:KEPT_HALFSPACE_VOLUME_IDENTITY_FAILED');
    }
    if (Math.abs(snapshot.boundsMm[0][2] - offset) > 1e-6) {
      throw new Error('splitBody:SPLIT_PLANE_NOT_REFLECTED_IN_EXACT_BOUND');
    }
    return {
      assertion: 'actual product OCCT split retained the requested positive half-space at the edited XY-plane offset',
      splitOffsetMm: offset,
      retainedDepthMm: retainedDepth,
      expectedVolumeMm3: expected,
      actualVolumeMm3: snapshot.volumeMm3,
      retainedMinZMm: snapshot.boundsMm[0][2],
    };
  }
  const baseline = intentHostBox
    ? intentHostBox.w * intentHostBox.h * intentHostBox.d
    : feature === 'rib'
    ? PLATE_VOLUME_MM3
    : feature === 'linearPattern' || feature === 'circularPattern'
      ? PATTERN_SEED_VOLUME_MM3
      : HOST_VOLUME_MM3;
  const additive = feature === 'rib'
    || feature === 'linearPattern'
    || feature === 'circularPattern'
    || feature === 'moveCopy';
  const changed = additive
    ? snapshot.volumeMm3 > baseline + 1
    : !closeEnough(snapshot.volumeMm3, baseline);
  if (!changed) throw new Error(`${feature}:FEATURE_DID_NOT_CHANGE_EXACT_VOLUME`);
  return {
    assertion: additive ? 'exact feature added material relative to its exact seed' : 'exact feature changed volume relative to its exact seed',
    baselineVolumeMm3: baseline,
    actualVolumeMm3: snapshot.volumeMm3,
  };
}

function closeEnough(a: number, b: number, relativeTolerance = 1e-8): boolean {
  return Math.abs(a - b) <= Math.max(1e-7, Math.max(Math.abs(a), Math.abs(b)) * relativeTolerance);
}

function sameExactSignature(a: ExactSnapshot, b: ExactSnapshot): boolean {
  return a.singleSolid === b.singleSolid
    && a.edgeCount === b.edgeCount
    && a.faceCount === b.faceCount
    && closeEnough(a.volumeMm3, b.volumeMm3)
    && a.boundsMm.flat().every((value, index) => closeEnough(value, b.boundsMm.flat()[index]!));
}

function differentExactSignature(a: ExactSnapshot, b: ExactSnapshot): boolean {
  return !sameExactSignature(a, b);
}

export function mechanicalCoreRuntimeSourceRevision(root = process.cwd()): { designRevisionSha256: string; sources: Array<{ path: string; sha256: string; bytes: number }> } {
  const candidates = [
    'src/app/[lang]/shape-generator/features/occtEngine.ts',
    'src/app/[lang]/shape-generator/features/topologyEdgeFinder.ts',
    'src/app/[lang]/shape-generator/features/variableFillet.ts',
    'src/app/[lang]/shape-generator/features/offsetFace.ts',
    'src/app/[lang]/shape-generator/features/thread.ts',
    'src/app/[lang]/shape-generator/features/threads/applyThreadOcct.ts',
    'src/app/[lang]/shape-generator/features/helix.ts',
    'src/app/[lang]/shape-generator/features/sheetMetal.ts',
    'src/app/[lang]/shape-generator/features/tab.ts',
    'src/app/[lang]/shape-generator/features/cut.ts',
    'src/app/[lang]/shape-generator/features/reliefCuts.ts',
    'src/app/[lang]/shape-generator/features/variableShell.ts',
    'src/app/[lang]/shape-generator/features/revolve.ts',
    'src/app/[lang]/shape-generator/features/sweep.ts',
    'src/app/[lang]/shape-generator/features/loft.ts',
    'src/app/[lang]/shape-generator/features/mirror.ts',
    'src/app/[lang]/shape-generator/features/boolean.ts',
    'src/app/[lang]/shape-generator/features/splitBody.ts',
    'src/app/[lang]/shape-generator/features/pipelineManager.ts',
    'src/app/[lang]/shape-generator/sketch/extrudeProfile.ts',
    'src/app/[lang]/shape-generator/io/nfabFormat.ts',
    'src/app/[lang]/shape-generator/history/CommandHistory.ts',
    'src/app/[lang]/shape-generator/features/types.ts',
    'src/lib/ai/mechanicalCoreFeatureContract.ts',
    'scripts/mechanical-core-feature-local-runtime.ts',
  ];
  const sources = candidates.map(relative => {
    const bytes = fs.readFileSync(resolveInside(root, relative));
    return { path: relative, sha256: hash(bytes), bytes: bytes.byteLength };
  });
  return {
    designRevisionSha256: hash(sources.map(item => `${item.path}\0${item.sha256}\0${item.bytes}`).join('\n')),
    sources,
  };
}

function drawingSvg(
  feature: MechanicalCoreRuntimeFeature,
  views: NonNullable<ReturnType<typeof occtProjectViews>>,
): string {
  const names = Object.keys(views).slice(0, 3);
  if (names.length !== 3) throw new Error(`${feature}:DRAWING_THREE_VIEWS_REQUIRED`);
  const panels = names.map((name, index) => {
    const view = views[name];
    if (!view || view.visible.length === 0 || !view.viewBox) {
      throw new Error(`${feature}:DRAWING_VIEW_EMPTY:${name}`);
    }
    const visible = view.visible.map(d => `<path d="${d}" fill="none" stroke="#111827" stroke-width="0.55"/>`).join('');
    const hidden = view.hidden.map(d => `<path d="${d}" fill="none" stroke="#64748b" stroke-width="0.3" stroke-dasharray="2 1"/>`).join('');
    return `<g transform="translate(${index * 400} 0)"><text x="12" y="24" font-family="sans-serif" font-size="14">${name}</text><svg x="12" y="36" width="376" height="300" viewBox="${view.viewBox}">${hidden}${visible}</svg></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="350" viewBox="0 0 1200 350"><title>NexyFab exact OCCT HLR — ${feature}</title><rect width="1200" height="350" fill="white"/>${panels.join('')}</svg>\n`;
}

function projectExactThreeViews(
  handle: string,
  feature: MechanicalCoreRuntimeFeature,
): NonNullable<ReturnType<typeof occtProjectViews>> {
  const orthogonalViewGroups = [
    ['front', 'back'],
    ['top', 'bottom'],
    ['right', 'left'],
  ] as const;
  const accepted: NonNullable<ReturnType<typeof occtProjectViews>> = {};
  const rejected: string[] = [];
  for (const viewGroup of orthogonalViewGroups) {
    let groupAccepted = false;
    for (const viewName of viewGroup) {
      try {
        const result = occtProjectViews(handle, [viewName]);
        const view = result?.[viewName];
        if (!view || view.visible.length === 0 || !view.viewBox) {
          rejected.push(`${viewName}:empty`);
          continue;
        }
        accepted[viewName] = view;
        groupAccepted = true;
        break;
      } catch (error) {
        rejected.push(`${viewName}:${errorText(error)}`);
      }
    }
    if (!groupAccepted) {
      throw new Error(`${feature}:EXACT_HLR_ORTHOGONAL_VIEW_UNAVAILABLE:${viewGroup.join('/')}|${rejected.join('|')}`);
    }
  }
  return accepted;
}

function axisArtifactPath(paths: MechanicalCoreRuntimePaths, feature: string, filename: string): string {
  return slash(path.posix.join(paths.artifactRoot, feature, filename));
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function recordExactRuntimeNotRun(
  root: string,
  paths: MechanicalCoreRuntimePaths,
  feature: MechanicalCoreRuntimeFeature,
  assessedAt: string,
  reason: string,
): MechanicalCoreLocalAxisRunV1[] {
  const inspectedSource = feature === 'thread'
    ? 'src/app/[lang]/shape-generator/features/thread.ts'
    : feature === 'helix'
      ? 'src/app/[lang]/shape-generator/features/helix.ts'
      : feature === 'bendRelief' || feature === 'cornerRelief'
        ? 'src/app/[lang]/shape-generator/features/reliefCuts.ts'
        : feature === 'variableShell'
          ? 'src/app/[lang]/shape-generator/features/variableShell.ts'
          : feature === 'revolve'
            ? 'src/app/[lang]/shape-generator/features/revolve.ts'
            : 'src/app/[lang]/shape-generator/features/sheetMetal.ts';
  const report = writeArtifact(
    root,
    axisArtifactPath(paths, feature, 'exact-runtime-not-run.json'),
    render({
      schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA,
      feature,
      status: 'NOT_RUN',
      assessedAt,
      exactKernelRequired: true,
      meshFallbackAccepted: false,
      inspectedSource,
      reason,
      axes: MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES,
    }),
    `${feature}.exact-runtime.not-run-reason`,
  );
  return MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES.map(axis => ({
    feature,
    axis,
    status: 'NOT_RUN' as const,
    executedAt: null,
    evidence: [report.binding],
    detail: `${feature}:${axis}:exact_product_path_unavailable:${reason}`,
  }));
}

async function executeFeature(
  root: string,
  paths: MechanicalCoreRuntimePaths,
  feature: MechanicalCoreRuntimeFeature,
  executedAt: string,
  intentBinding?: MechanicalCoreRuntimeIntentBinding,
): Promise<MechanicalCoreLocalAxisRunV1[]> {
  const runs: MechanicalCoreLocalAxisRunV1[] = [];
  let stopped = false;
  const pushNotRun = (axis: MechanicalCoreLocalClosedLoopAxis, dependency: string) => {
    runs.push({ feature, axis, status: 'NOT_RUN', executedAt: null, evidence: [], detail: dependency });
  };
  const stage = async (
    axis: MechanicalCoreLocalClosedLoopAxis,
    action: () => Promise<readonly MechanicalCoreLocalEvidenceBindingV1[]> | readonly MechanicalCoreLocalEvidenceBindingV1[],
  ): Promise<boolean> => {
    if (stopped) {
      pushNotRun(axis, `${feature}:${axis}:blocked_by_prior_axis`);
      return false;
    }
    try {
      const evidence = await action();
      if (evidence.length === 0) throw new Error(`${feature}:${axis}:EVIDENCE_MISSING`);
      runs.push({ feature, axis, status: 'PASS', executedAt, evidence, selectionIdentity });
      return true;
    } catch (error) {
      const failure = writeArtifact(
        root,
        axisArtifactPath(paths, feature, `${axis}-failure.json`),
        render({
          schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA,
          feature,
          axis,
          status: 'FAIL',
          executedAt,
          error: errorText(error),
        }),
        `${feature}.${axis}.failure`,
      );
      runs.push({
        feature,
        axis,
        status: 'FAIL',
        executedAt,
        evidence: [failure.binding],
        detail: errorText(error),
      });
      stopped = true;
      return false;
    }
  };

  if (intentBinding) {
    if (![intentBinding.candidateBaseRevision, intentBinding.promptSha256, intentBinding.inputSha256].every(value => SHA256.test(value))) {
      throw new Error(`${feature}:INTENT_BINDING_SHA_INVALID`);
    }
    if (intentBinding.normalizedUnit !== 'mm' || !intentBinding.sourceUnits.length
      || Object.values(intentBinding.dimensionsMm).some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`${feature}:INTENT_BINDING_DIMENSIONS_INVALID`);
    }
  }
  const intentHostBox = intentBinding ? {
    w: intentBinding.dimensionsMm.width,
    h: intentBinding.dimensionsMm.thickness,
    d: intentBinding.dimensionsMm.length,
    cx: 0,
    cy: 0,
    cz: 0,
  } : undefined;
  const runtimeHostBox = intentHostBox ?? (feature === 'rib'
    ? PLATE_BOX
    : feature === 'linearPattern' || feature === 'circularPattern'
      ? PATTERN_SEED_BOX
      : HOST_BOX);
  const initialPayload = featurePayload(feature, false, runtimeHostBox);
  const editedPayload = featurePayload(feature, true, runtimeHostBox);
  const selectionIdentity: MechanicalCoreLocalSelectionIdentityV1 = {
    featureFamily: feature,
    featureId: initialPayload.id,
    selectionId: `${feature}:runtime-feature-selection`,
    identitySha256: '',
    preserved: true,
    topologySilentRemapCount: 0,
  };
  selectionIdentity.identitySha256 = hash(mechanicalCoreSelectionIdentityPayload(selectionIdentity));
  let activePayload = clonePayload(initialPayload);
  let editRecorded = false;
  let initialSnapshot: ExactSnapshot | null = null;
  let editedSnapshot: ExactSnapshot | null = null;
  let reopenedPayload: FeatureInstance | null = null;
  let importedHandle: string | null = null;

  await stage('create', async () => {
    resetShapeRegistry();
    const baseHandle = requireHandle(occtBaseSolid('box', {
      width: runtimeHostBox.w,
      height: runtimeHostBox.h,
      depth: runtimeHostBox.d,
    }, TESS).handle, `${feature}:intent-base`);
    const baseSnapshot = exactSnapshot(baseHandle, `${feature}:intent-base`);
    const extents = baseSnapshot.boundsMm[1].map((value, index) => value - baseSnapshot.boundsMm[0][index]!) as [number, number, number];
    const expectedExtents = [runtimeHostBox.w, runtimeHostBox.h, runtimeHostBox.d];
    if (!extents.every((value, index) => closeEnough(value, expectedExtents[index]!, 1e-7))) {
      throw new Error(`${feature}:INTENT_DIMENSIONS_NOT_REFLECTED_IN_BASE_SOLID:${JSON.stringify({ extents, expectedExtents, bounds: baseSnapshot.boundsMm })}`);
    }
    const handle = await buildExact(feature, initialPayload, intentHostBox);
    initialSnapshot = exactSnapshot(handle, `${feature}:create`);
    const featureMeaning = await assertFeatureEffect(feature, initialSnapshot, initialPayload, intentHostBox);
    return [writeArtifact(
      root,
      axisArtifactPath(paths, feature, 'create.json'),
      render({
        schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA,
        feature,
        axis: 'create',
        status: 'PASS',
        executedAt,
        payload: initialPayload,
        ...(intentBinding ? { intentBinding, intentBaseExact: baseSnapshot, intentDimensionAssertion: { status: 'PASS', extentsMm: extents, expectedExtentsMm: expectedExtents } } : {}),
        exact: initialSnapshot,
        featureMeaning,
        exactScope: feature === 'scale'
          ? 'uniform scale (replicad exact path)'
          : feature === 'variableShell'
            ? 'axis-aligned bbox-faithful box only; non-box/general per-face thickening is unsupported and fail-closed'
            : 'declared numeric runtime case',
        assertion: 'native OCCT produced one non-empty exact solid and changed the host geometry',
      }),
      `${feature}.create.exact-solid`,
    ).binding];
  });

  await stage('edit', () => {
    commandHistory.clear();
    const before = clonePayload(activePayload);
    commandHistory.execute({
      id: `${feature}-runtime-param-edit`,
      label: 'Edit feature parameter',
      labelKo: '피처 파라미터 수정',
      execute: () => { activePayload = clonePayload(editedPayload); },
      undo: () => { activePayload = clonePayload(initialPayload); },
    });
    const after = clonePayload(activePayload);
    editRecorded = commandHistory.getHistory().past.length === 1;
    if (JSON.stringify(before) === JSON.stringify(after) || !editRecorded) {
      throw new Error(`${feature}:EDIT_NOT_RECORDED_BY_HISTORY`);
    }
    return [writeArtifact(
      root,
      axisArtifactPath(paths, feature, 'edit.json'),
      render({ schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA, feature, axis: 'edit', status: 'PASS', executedAt, commandId: `${feature}-runtime-param-edit`, historyDepth: commandHistory.getHistory().past.length, before, after, ...(intentBinding ? { intentBinding, intentDimensionAssertion: { status: 'PASS', inputSha256: intentBinding.inputSha256, dimensionsMm: intentBinding.dimensionsMm, normalizedUnit: intentBinding.normalizedUnit } } : {}) }),
      `${feature}.edit.history-transition`,
    ).binding];
  });

  await stage('regenerate', async () => {
    if (!initialSnapshot || !editRecorded) throw new Error(`${feature}:REGENERATE_PREREQUISITE_MISSING`);
    resetShapeRegistry();
    editedSnapshot = exactSnapshot(await buildExact(feature, activePayload, intentHostBox), `${feature}:regenerate:first`);
    const featureMeaning = await assertFeatureEffect(feature, editedSnapshot, activePayload, intentHostBox);
    if (!differentExactSignature(initialSnapshot, editedSnapshot)) {
      throw new Error(`${feature}:EDIT_DID_NOT_CHANGE_EXACT_GEOMETRY`);
    }
    resetShapeRegistry();
    const repeated = exactSnapshot(await buildExact(feature, activePayload, intentHostBox), `${feature}:regenerate:repeat`);
    if (!sameExactSignature(editedSnapshot, repeated)) {
      throw new Error(`${feature}:REGENERATION_NOT_DETERMINISTIC`);
    }
    return [writeArtifact(
      root,
      axisArtifactPath(paths, feature, 'regenerate.json'),
      render({ schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA, feature, axis: 'regenerate', status: 'PASS', executedAt, initial: initialSnapshot, edited: editedSnapshot, repeated, featureMeaning, ...(intentBinding ? { intentBinding } : {}), assertion: 'edited parameter changed the exact signature and a fresh native regeneration reproduced topology, bounds, and volume' }),
      `${feature}.regenerate.native-repeat`,
    ).binding];
  });

  await stage('save_reopen', async () => {
    if (!editedSnapshot || !editRecorded) throw new Error(`${feature}:SAVE_REOPEN_PREREQUISITE_MISSING`);
    const serialized = serializeNfab(activePayload, feature, runtimeHostBox, intentBinding);
    const saved = writeArtifact(
      root,
      axisArtifactPath(paths, feature, 'saved-project.nfab'),
      `${serialized}\n`,
      `${feature}.save_reopen.saved-bytes`,
    );
    reopenedPayload = payloadFromNfab(serialized, feature);
    if (reopenedPayload.id !== editedPayload.id) {
      throw new Error(`${feature}:REOPEN_SELECTION_IDENTITY_CHANGED`);
    }
    if (JSON.stringify(reopenedPayload.params) !== JSON.stringify(editedPayload.params)) {
      throw new Error(`${feature}:REOPEN_PAYLOAD_CHANGED`);
    }
    resetShapeRegistry();
    const reopened = exactSnapshot(await buildExact(feature, reopenedPayload, intentHostBox), `${feature}:save_reopen`);
    if (!sameExactSignature(editedSnapshot, reopened)) {
      throw new Error(`${feature}:REOPEN_EXACT_GEOMETRY_CHANGED`);
    }
    const report = writeArtifact(
      root,
      axisArtifactPath(paths, feature, 'save-reopen.json'),
      render({ schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA, feature, axis: 'save_reopen', status: 'PASS', executedAt, savedBytes: saved.bytes, savedSha256: saved.binding.sha256, reopened }),
      `${feature}.save_reopen.exact-roundtrip`,
    );
    return [saved.binding, report.binding];
  });

  await stage('undo', async () => {
    if (!editRecorded || !initialSnapshot) throw new Error(`${feature}:UNDO_PREREQUISITE_MISSING`);
    const didUndo = commandHistory.undo();
    const history = commandHistory.getHistory();
    if (!didUndo || history.future.length !== 1 || history.past.length !== 0) {
      throw new Error(`${feature}:UNDO_HISTORY_POSITION_INVALID`);
    }
    const undonePayload = clonePayload(activePayload);
    if (JSON.stringify(undonePayload.params) !== JSON.stringify(initialPayload.params)) {
      throw new Error(`${feature}:UNDO_PAYLOAD_NOT_RESTORED`);
    }
    resetShapeRegistry();
    const exact = exactSnapshot(await buildExact(feature, undonePayload, intentHostBox), `${feature}:undo`);
    if (!sameExactSignature(initialSnapshot, exact)) {
      throw new Error(`${feature}:UNDO_EXACT_GEOMETRY_NOT_RESTORED`);
    }
    return [writeArtifact(
      root,
      axisArtifactPath(paths, feature, 'undo.json'),
      render({ schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA, feature, axis: 'undo', status: 'PASS', executedAt, restoredPayload: undonePayload, restoredExact: exact, futureDepth: history.future.length }),
      `${feature}.undo.exact-restore`,
    ).binding];
  });

  await stage('export', async () => {
    if (!reopenedPayload || !editedSnapshot) throw new Error(`${feature}:EXPORT_PREREQUISITE_MISSING`);
    resetShapeRegistry();
    const exportHandle = await buildExact(feature, reopenedPayload, intentHostBox);
    const step = await exportOcctStep(exportHandle);
    if (!step || !step.includes('ISO-10303-21') || !step.includes('END-ISO-10303-21')) {
      throw new Error(`${feature}:NATIVE_STEP_EMPTY_OR_INVALID`);
    }
    const stepArtifact = writeArtifact(
      root,
      axisArtifactPath(paths, feature, `${feature}-edited.step`),
      step,
      `${feature}.export.native-step`,
    );
    resetShapeRegistry();
    const imported = await occtImportStepText(step, TESS);
    importedHandle = requireHandle(imported.handle, `${feature}:step-reimport`);
    const reimported = exactSnapshot(importedHandle, `${feature}:step-reimport`);
    if (!closeEnough(editedSnapshot.volumeMm3, reimported.volumeMm3, 1e-7)) {
      throw new Error(`${feature}:STEP_REIMPORT_VOLUME_DRIFT`);
    }
    if (!reimported.singleSolid) throw new Error(`${feature}:STEP_REIMPORT_NOT_ONE_SOLID`);
    if (reimported.edgeCount !== editedSnapshot.edgeCount || reimported.faceCount !== editedSnapshot.faceCount) {
      throw new Error(`${feature}:STEP_REIMPORT_TOPOLOGY_DRIFT`);
    }
    const report = writeArtifact(
      root,
      axisArtifactPath(paths, feature, 'export-reimport.json'),
      render({ schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA, feature, axis: 'export', status: 'PASS', executedAt, stepBytes: stepArtifact.bytes, stepSha256: stepArtifact.binding.sha256, before: editedSnapshot, after: reimported, relativeVolumeDrift: Math.abs(editedSnapshot.volumeMm3 - reimported.volumeMm3) / editedSnapshot.volumeMm3 }),
      `${feature}.export.step-reimport`,
    );
    return [stepArtifact.binding, report.binding];
  });

  await stage('drawing', () => {
    if (!importedHandle) throw new Error(`${feature}:DRAWING_PREREQUISITE_MISSING`);
    const views = projectExactThreeViews(importedHandle, feature);
    const counts = Object.fromEntries(Object.entries(views).map(([name, view]) => [name, {
      visible: view.visible.length,
      hidden: view.hidden.length,
      viewBox: view.viewBox,
    }]));
    const svg = drawingSvg(feature, views);
    const svgArtifact = writeArtifact(
      root,
      axisArtifactPath(paths, feature, `${feature}-exact-hlr.svg`),
      svg,
      `${feature}.drawing.exact-hlr-svg`,
    );
    const report = writeArtifact(
      root,
      axisArtifactPath(paths, feature, 'drawing.json'),
      render({ schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA, feature, axis: 'drawing', status: 'PASS', executedAt, kernel: 'OCCT HLRBRep via replicad drawProjection', views: counts, svgBytes: svgArtifact.bytes, svgSha256: svgArtifact.binding.sha256 }),
      `${feature}.drawing.three-view-hlr`,
    );
    return [svgArtifact.binding, report.binding];
  });

  commandHistory.clear();
  return runs;
}

export interface MechanicalCoreRuntimeExecutionResult {
  receipt: MechanicalCoreLocalAxisEvidenceV1;
  receiptPath: string;
  receiptSha256: string;
  bundleComplete: boolean;
  bundleAxisTotals: { PASS: number; FAIL: number; NOT_RUN: number };
}

export async function executeMechanicalCoreRuntimeBundle(
  root = process.cwd(),
  paths: MechanicalCoreRuntimePaths = MECHANICAL_CORE_RUNTIME_PATHS,
  now: Date = new Date(),
  options: MechanicalCoreRuntimeExecutionOptions = {},
): Promise<MechanicalCoreRuntimeExecutionResult> {
  const executedAt = now.toISOString();
  if (!Number.isFinite(now.getTime())) throw new Error('MECHANICAL_RUNTIME_TIME_INVALID');
  clearGeneratedArtifactRoot(root, paths.artifactRoot);
  await ensureOcctReady();
  setOcctGlobalMode(true);
  const revision = mechanicalCoreRuntimeSourceRevision(root);
  for (const [feature, binding] of Object.entries(options.intentBindings ?? {})) {
    if (binding?.candidateBaseRevision !== revision.designRevisionSha256) {
      throw new Error(`${feature}:INTENT_BINDING_STALE_REVISION`);
    }
  }
  const runs: MechanicalCoreLocalAxisRunV1[] = [];
  for (const feature of MECHANICAL_CORE_RUNTIME_BUNDLE) {
    if (options.featureFilter && !options.featureFilter.includes(feature)) continue;
    const exactNotRunReason = EXACT_RUNTIME_NOT_RUN_REASON[feature];
    if (exactNotRunReason) {
      runs.push(...recordExactRuntimeNotRun(root, paths, feature, executedAt, exactNotRunReason));
      continue;
    }
    const binding = options.intentBindings?.[feature];
    if (options.intentBindings !== undefined && !binding) {
      for (const axis of MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES) {
        runs.push({
          feature,
          axis,
          status: 'NOT_RUN',
          executedAt: null,
          evidence: [],
          detail: `${feature}:${axis}:authoritative_intent_binding_missing`,
        });
      }
      continue;
    }
    runs.push(...await executeFeature(root, paths, feature, executedAt, binding));
  }
  for (const run of runs) run.designRevisionSha256 = revision.designRevisionSha256;
  const covered = new Set(runs.map(run => `${run.feature}:${run.axis}`));
  for (const feature of MECHANICAL_CORE_30_FEATURES) {
    for (const axis of MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES) {
      if (covered.has(`${feature}:${axis}`)) continue;
      runs.push({
        feature,
        axis,
        status: 'NOT_RUN',
        executedAt: null,
        evidence: [],
        detail: 'not included in the cumulative mechanical-core local runtime bundle',
      });
    }
  }
  const receipt: MechanicalCoreLocalAxisEvidenceV1 = {
    schema: MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA,
    generatedAt: executedAt,
    designRevisionSha256: revision.designRevisionSha256,
    runs,
  };
  const summary = writeArtifact(
    root,
    slash(path.posix.join(paths.artifactRoot, 'execution-summary.json')),
    render({
      schema: MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA,
      generatedAt: executedAt,
      exactKernelOnly: true,
      meshFallbackAccepted: false,
      bundle: MECHANICAL_CORE_RUNTIME_BUNDLE,
      axes: MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES,
      designRevisionSha256: revision.designRevisionSha256,
      sources: revision.sources,
      runs,
    }),
    'mechanical-core-cumulative-runtime-bundle.summary',
  );
  if (!SHA256.test(summary.binding.sha256)) throw new Error('MECHANICAL_RUNTIME_SUMMARY_HASH_INVALID');
  const receiptArtifact = writeArtifact(
    root,
    paths.receiptOutput,
    render(receipt),
    'mechanical-core-cumulative-runtime-bundle.axis-receipt',
  );
  const bundleRuns = runs.filter(run => (MECHANICAL_CORE_RUNTIME_BUNDLE as readonly string[]).includes(run.feature));
  const bundleAxisTotals = {
    PASS: bundleRuns.filter(run => run.status === 'PASS').length,
    FAIL: bundleRuns.filter(run => run.status === 'FAIL').length,
    NOT_RUN: bundleRuns.filter(run => run.status === 'NOT_RUN').length,
  };
  setOcctGlobalMode(false);
  return {
    receipt,
    receiptPath: receiptArtifact.binding.path,
    receiptSha256: receiptArtifact.binding.sha256,
    bundleComplete: bundleAxisTotals.PASS === MECHANICAL_CORE_RUNTIME_BUNDLE.length * MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES.length,
    bundleAxisTotals,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--write')) {
    process.stderr.write('Refusing to execute/write local CAD evidence without --write.\n');
    process.exitCode = 2;
  } else {
    executeMechanicalCoreRuntimeBundle()
      .then(result => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exitCode = result.bundleComplete ? 0 : 1;
      })
      .catch(error => {
        process.stderr.write(`${errorText(error)}\n`);
        process.exitCode = 1;
      });
  }
}
