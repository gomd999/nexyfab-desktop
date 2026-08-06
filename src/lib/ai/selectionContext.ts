import type {
  EdgeSelectionInfo,
  ElementSelectionInfo,
  FaceSelectionInfo,
} from '@/app/[lang]/shape-generator/editing/selectionInfo';
import { remapTopologyEntities, type TopologyEntitySnapshot } from '@/lib/cad/topologyRemap';

export type SelectionTopologyKind = 'face' | 'edge' | 'vertex';
export type SelectionReferenceQuality = 'persistent' | 'derived' | 'ambiguous' | 'broken';

export type TopologySelectionRef = {
  kind: SelectionTopologyKind;
  persistentRef: string;
  referenceQuality: SelectionReferenceQuality;
  semanticRole?: string;
  geometrySignature: string;
};

export type SelectionContext = {
  version: 1;
  projectRevision: string;
  assemblyPath: string[];
  partInstanceId?: string;
  bodyId?: string;
  featureId?: string;
  topology: TopologySelectionRef[];
  sketchEntityIds: string[];
  mateIds: string[];
  coordinateFrame: string;
  units: 'mm';
};

export type SelectionContextOptions = {
  projectRevision: string;
  assemblyPath?: string[];
  partInstanceId?: string;
  bodyId?: string;
  featureId?: string;
  sketchEntityIds?: string[];
  mateIds?: string[];
  coordinateFrame?: string;
};

const q = (n: number, precision = 1e-5) =>
  Number.isFinite(n) ? Math.round(n / precision) * precision : 0;

const tuple = (values: readonly number[]) => values.map(n => q(n)).join(',');

function faceRole(face: FaceSelectionInfo): string {
  const [x, y, z] = face.normal;
  const ax = Math.abs(x); const ay = Math.abs(y); const az = Math.abs(z);
  if (az >= ax && az >= ay) return z >= 0 ? 'positive_z_face' : 'negative_z_face';
  if (ay >= ax) return y >= 0 ? 'positive_y_face' : 'negative_y_face';
  return x >= 0 ? 'positive_x_face' : 'negative_x_face';
}

function signatureForFace(face: FaceSelectionInfo): string {
  return `face:n=${tuple(face.normal)}:p=${tuple(face.position)}:a=${q(face.area, 1e-3)}`;
}

function signatureForEdge(edge: EdgeSelectionInfo): string {
  const bbox = edge.bbox
    ? `:bb=${tuple(edge.bbox.min)}/${tuple(edge.bbox.max)}`
    : '';
  const direction = edge.direction ? `:d=${tuple(edge.direction)}` : '';
  return `edge:p=${tuple(edge.position)}:l=${q(edge.length, 1e-3)}:n=${tuple(edge.normal)}${direction}${bbox}`;
}

function faceRef(face: FaceSelectionInfo): TopologySelectionRef {
  const signature = signatureForFace(face);
  return {
    kind: 'face',
    persistentRef: face.persistentId ?? `derived:${signature}`,
    referenceQuality: face.persistentId ? 'persistent' : 'derived',
    semanticRole: faceRole(face),
    geometrySignature: signature,
  };
}

function edgeRef(edge: EdgeSelectionInfo): TopologySelectionRef {
  const signature = signatureForEdge(edge);
  return {
    kind: 'edge',
    persistentRef: edge.persistentId ?? `derived:${signature}`,
    referenceQuality: edge.persistentId ? 'persistent' : 'derived',
    geometrySignature: signature,
  };
}

/**
 * Converts today's viewport selection into the canonical AI selection
 * context. Derived references are honest fallbacks: callers may preview with
 * them, but destructive edits should require remapping or user confirmation.
 */
export function selectionContextFromElement(
  selection: ElementSelectionInfo | null,
  options: SelectionContextOptions,
): SelectionContext {
  const topology = selection === null
    ? []
    : selection.type === 'face'
      ? [faceRef(selection)]
      : selection.type === 'edge'
        ? [edgeRef(selection)]
        : selection.faces.map(faceRef);

  const partFromSelection = selection && selection.type !== 'multi'
    ? selection.partName
    : selection?.faces.find(face => face.partName)?.partName;

  return {
    version: 1,
    projectRevision: options.projectRevision,
    assemblyPath: [...(options.assemblyPath ?? [])],
    partInstanceId: options.partInstanceId ?? partFromSelection,
    bodyId: options.bodyId,
    featureId: options.featureId,
    topology,
    sketchEntityIds: [...(options.sketchEntityIds ?? [])],
    mateIds: [...(options.mateIds ?? [])],
    coordinateFrame: options.coordinateFrame ?? 'world',
    units: 'mm',
  };
}

export function selectionRequiresConfirmation(context: SelectionContext): boolean {
  return context.topology.some(ref => ref.referenceQuality !== 'persistent');
}

export function remapSelectionContext(
  context: SelectionContext,
  previous: readonly TopologyEntitySnapshot[],
  current: readonly TopologyEntitySnapshot[],
  projectRevision: string,
): SelectionContext {
  const results = remapTopologyEntities(previous, current);
  const byPrevious = new Map(results.map(result => [result.previousRef, result]));
  return {
    ...context,
    projectRevision,
    topology: context.topology.map(ref => {
      const result = byPrevious.get(ref.persistentRef);
      if (!result) return { ...ref, referenceQuality: 'broken' as const };
      return {
        ...ref,
        persistentRef: result.mappedRef ?? ref.persistentRef,
        referenceQuality: result.quality,
      };
    }),
  };
}

/**
 * Content-addressed revision for local, unsaved model state. This is not a PDM
 * revision label: it is an optimistic-concurrency token used to ensure an AI
 * edit is applied to the same model snapshot that it inspected.
 */
export function modelContentRevision(value: unknown): string {
  const canonical = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `model-${hash.toString(16).padStart(8, '0')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
