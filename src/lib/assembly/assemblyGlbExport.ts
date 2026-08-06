import * as THREE from 'three';
import type { AssemblyAnimation } from './assemblyAnimation';
import { validateAssemblyAnimation } from './assemblyAnimation';
import type { AssemblyState } from './assemblyState';

export type AssemblyGlbExport = {
  scene: THREE.Scene;
  clip: THREE.AnimationClip | null;
  exportedPartIds: string[];
  missingPartIds: string[];
};

/** Build a clean glTF scene from the live, tessellated assembly meshes. */
export function buildAssemblyGlbScene(
  source: THREE.Scene,
  state: AssemblyState,
  animation: AssemblyAnimation,
): AssemblyGlbExport {
  const errors = validateAssemblyAnimation(animation, state);
  if (errors.length) throw new Error(errors.join(' '));

  const output = new THREE.Scene();
  output.name = 'NexyFab assembly';
  const tracks: THREE.KeyframeTrack[] = [];
  const exportedPartIds: string[] = [];
  const missingPartIds: string[] = [];

  for (const part of state.parts) {
    const sourceMesh = source.children.find(
      object => object instanceof THREE.Mesh && object.userData?.partId === part.id,
    ) as THREE.Mesh | undefined;
    if (!sourceMesh) {
      missingPartIds.push(part.id);
      continue;
    }

    const node = new THREE.Group();
    node.name = safeNodeName(part.id);
    node.userData = { partId: part.id, partName: part.name, partTemplateId: part.partTemplateId };
    node.position.set(part.position.x, part.position.y, part.position.z);
    node.quaternion.set(part.orientation.x, part.orientation.y, part.orientation.z, part.orientation.w);

    const mesh = new THREE.Mesh(sourceMesh.geometry.clone(), cloneMaterial(sourceMesh.material));
    mesh.name = `${safeNodeName(part.id)}_geometry`;
    // Viewer geometry may carry a local bbox-centre offset. Preserve it below
    // the animated part node, instead of baking it into animation positions.
    const worldOffset = sourceMesh.position.clone().sub(node.position);
    mesh.position.copy(worldOffset.applyQuaternion(node.quaternion.clone().invert()));
    node.add(mesh);
    output.add(node);
    exportedPartIds.push(part.id);

    const poseTrack = animation.tracks.find(track => track.targetPartId === part.id);
    if (!poseTrack?.keyframes.length) continue;
    const keys = [...poseTrack.keyframes].sort((a, b) => a.frame - b.frame);
    const times = keys.map(key => (key.frame - animation.startFrame) / animation.fps);
    const positions: number[] = [];
    const quaternions: number[] = [];
    let lastPosition = part.position;
    let lastOrientation = part.orientation;
    for (const key of keys) {
      lastPosition = key.position ?? lastPosition;
      lastOrientation = key.orientation ?? lastOrientation;
      positions.push(lastPosition.x, lastPosition.y, lastPosition.z);
      quaternions.push(lastOrientation.x, lastOrientation.y, lastOrientation.z, lastOrientation.w);
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, times, positions));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, quaternions));
  }

  const duration = Math.max(0, (animation.endFrame - animation.startFrame) / animation.fps);
  return {
    scene: output,
    clip: tracks.length ? new THREE.AnimationClip(animation.name, duration, tracks) : null,
    exportedPartIds,
    missingPartIds,
  };
}

export async function encodeAssemblyGlb(
  source: THREE.Scene,
  state: AssemblyState,
  animation: AssemblyAnimation,
): Promise<ArrayBuffer> {
  const built = buildAssemblyGlbScene(source, state, animation);
  if (built.missingPartIds.length) {
    throw new Error(`GLB export is missing rendered geometry for: ${built.missingPartIds.join(', ')}`);
  }
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      built.scene,
      result => result instanceof ArrayBuffer
        ? resolve(result)
        : reject(new Error('GLB exporter returned JSON instead of binary data.')),
      reject,
      { binary: true, animations: built.clip ? [built.clip] : [] },
    );
  });
}

function safeNodeName(id: string): string {
  return `part_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function cloneMaterial(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  return Array.isArray(material) ? material.map(item => item.clone()) : material.clone();
}
