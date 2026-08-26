import type { NfabStudioViewV1 } from '../io/nfabFormat';

export type StudioViewCamera = Readonly<{
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}>;

export interface StudioViewState {
  sectionActive: boolean;
  sectionAxis: 'x' | 'y' | 'z';
  sectionOffset: number;
  sketchSlicePalette: boolean;
  sketchSlicePlaneMm: number;
  multiView: boolean;
  camera: StudioViewCamera | null;
}

export interface StudioViewRestorePatch {
  sectionActive: boolean;
  sectionAxis?: 'x' | 'y' | 'z';
  sectionOffset?: number;
  sketchSlicePalette: boolean;
  sketchSlicePlaneMm?: number;
  multiView: boolean;
  camera: { position: [number, number, number]; target: [number, number, number] } | null;
  suppressGeometryFit: boolean;
}

export const DEFAULT_STUDIO_VIEW_STATE: Readonly<StudioViewState> = Object.freeze({
  sectionActive: false,
  sectionAxis: 'y',
  sectionOffset: 0.5,
  sketchSlicePalette: false,
  sketchSlicePlaneMm: 60,
  multiView: false,
  camera: null,
});

function isDataRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Boolean(Object.getOwnPropertyDescriptor(value, key)?.enumerable)
      && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
  } catch {
    return false;
  }
}

function dataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function vector(value: unknown): [number, number, number] | null {
  try {
    if (!Array.isArray(value) || value.length !== 3 || Object.getPrototypeOf(value) !== Array.prototype
      || !value.every(item => typeof item === 'number' && Number.isFinite(item))) return null;
    return [value[0], value[1], value[2]];
  } catch {
    return null;
  }
}

function camera(value: unknown): { position: [number, number, number]; target: [number, number, number] } | null {
  if (!isDataRecord(value)) return null;
  const position = vector(dataValue(value, 'position'));
  const target = vector(dataValue(value, 'target'));
  return position && target ? { position, target } : null;
}

export function createStudioViewSnapshot(input: StudioViewState): NfabStudioViewV1 | undefined {
  const sectionAxis = input.sectionAxis === 'x' || input.sectionAxis === 'z' ? input.sectionAxis : 'y';
  const sectionOffset = Number.isFinite(input.sectionOffset) ? Math.max(0, Math.min(1, input.sectionOffset)) : 0.5;
  const sketchSlicePlaneMm = Number.isFinite(input.sketchSlicePlaneMm) ? input.sketchSlicePlaneMm : 60;
  const validCamera = camera(input.camera);
  const isDefault = !input.sectionActive
    && sectionAxis === DEFAULT_STUDIO_VIEW_STATE.sectionAxis
    && Math.abs(sectionOffset - DEFAULT_STUDIO_VIEW_STATE.sectionOffset) < 1e-6
    && !input.sketchSlicePalette
    && Math.abs(sketchSlicePlaneMm - DEFAULT_STUDIO_VIEW_STATE.sketchSlicePlaneMm) < 1e-6
    && !input.multiView
    && !validCamera;
  if (isDefault) return undefined;
  return {
    sectionActive: Boolean(input.sectionActive),
    sectionAxis,
    sectionOffset,
    sketchSlicePalette: Boolean(input.sketchSlicePalette),
    sketchSlicePlaneMm,
    ...(input.multiView ? { multiView: true as const } : {}),
    ...(validCamera ? {
      cameraPosition: validCamera.position,
      cameraTarget: validCamera.target,
    } : {}),
  };
}
/**
 * Produces a pure patch. Optional numeric/axis fields preserve the caller's
 * current value when a legacy direct caller bypasses the normalized parser.
 */
export function createStudioViewRestorePatch(input: unknown): StudioViewRestorePatch {
  if (input === undefined || input === null || !isDataRecord(input)) {
    return {
      sectionActive: false,
      sectionAxis: 'y',
      sectionOffset: 0.5,
      sketchSlicePalette: false,
      sketchSlicePlaneMm: 60,
      multiView: false,
      camera: null,
      suppressGeometryFit: false,
    };
  }
  const axis = dataValue(input, 'sectionAxis');
  const offset = dataValue(input, 'sectionOffset');
  const plane = dataValue(input, 'sketchSlicePlaneMm');
  const cameraPosition = vector(dataValue(input, 'cameraPosition'));
  const cameraTarget = vector(dataValue(input, 'cameraTarget'));
  const restoredCamera = cameraPosition && cameraTarget
    ? { position: cameraPosition, target: cameraTarget }
    : null;
  return {
    sectionActive: Boolean(dataValue(input, 'sectionActive')),
    ...(axis === 'x' || axis === 'y' || axis === 'z' ? { sectionAxis: axis } : {}),
    ...(typeof offset === 'number' && Number.isFinite(offset) ? { sectionOffset: Math.max(0, Math.min(1, offset)) } : {}),
    sketchSlicePalette: Boolean(dataValue(input, 'sketchSlicePalette')),
    ...(typeof plane === 'number' && Number.isFinite(plane) ? { sketchSlicePlaneMm: plane } : {}),
    multiView: dataValue(input, 'multiView') === true,
    camera: restoredCamera,
    suppressGeometryFit: restoredCamera !== null,
  };
}
