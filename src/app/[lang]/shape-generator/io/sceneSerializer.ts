'use client';

// ─── Scene Serialization Types ───────────────────────────────────────────────

export interface SceneShapeEntry {
  id: string;
  shapeType: string;
  params: Record<string, number>;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  materialPreset: string;
  color: string;
}

export interface SceneCamera {
  position: [number, number, number];
  target: [number, number, number];
}

export interface SceneState {
  version: string;
  shapes: SceneShapeEntry[];
  camera: SceneCamera;
}

// ─── Default camera ──────────────────────────────────────────────────────────

const DEFAULT_CAMERA: SceneCamera = {
  position: [50, 50, 50],
  target: [0, 0, 0],
};

// ─── Serialize ───────────────────────────────────────────────────────────────

export interface SerializableShape {
  id: string;
  shapeType: string;
  params: Record<string, number>;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  materialPreset?: string;
  color?: string;
}

export interface SerializableCamera {
  position?: [number, number, number];
  target?: [number, number, number];
}

export function serializeScene(
  shapes: SerializableShape[],
  camera?: SerializableCamera,
): SceneState {
  return {
    version: '1.0',
    shapes: shapes.map(s => ({
      id: s.id,
      shapeType: s.shapeType,
      params: { ...s.params },
      position: s.position ?? [0, 0, 0],
      rotation: s.rotation ?? [0, 0, 0],
      scale: s.scale ?? [1, 1, 1],
      materialPreset: s.materialPreset ?? 'aluminum',
      color: s.color ?? '#8b9cf4',
    })),
    camera: {
      position: camera?.position ?? DEFAULT_CAMERA.position,
      target: camera?.target ?? DEFAULT_CAMERA.target,
    },
  };
}

// ─── Deserialize ─────────────────────────────────────────────────────────────

export function deserializeScene(state: SceneState): {
  shapes: SceneShapeEntry[];
  camera: SceneCamera;
} {
  return {
    shapes: (state.shapes ?? []).map(s => ({
      id: s.id,
      shapeType: s.shapeType,
      params: { ...s.params },
      position: s.position ?? [0, 0, 0],
      rotation: s.rotation ?? [0, 0, 0],
      scale: s.scale ?? [1, 1, 1],
      materialPreset: s.materialPreset ?? 'aluminum',
      color: s.color ?? '#8b9cf4',
    })),
    camera: {
      position: state.camera?.position ?? DEFAULT_CAMERA.position,
      target: state.camera?.target ?? DEFAULT_CAMERA.target,
    },
  };
}

// ─── Export to .nexyfab JSON file ────────────────────────────────────────────

export function exportSceneAsJSON(state: SceneState, filename = 'scene'): void {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.nexyfab') ? filename : `${filename}.nexyfab`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Import from .nexyfab JSON file ─────────────────────────────────────────

export function importSceneFromJSON(file: File): Promise<SceneState> {
  return new Promise<SceneState>((resolve, reject) => {
    if (!file.name.endsWith('.nexyfab') && !file.name.endsWith('.json')) {
      reject(new Error('Invalid file type. Expected .nexyfab or .json'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const state = JSON.parse(text) as SceneState;
        if (!state.version || !Array.isArray(state.shapes)) {
          reject(new Error('Invalid scene file format'));
          return;
        }
        resolve(state);
      } catch (err) {
        reject(new Error(`Failed to parse scene file: ${err instanceof Error ? err.message : 'Unknown error'}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
