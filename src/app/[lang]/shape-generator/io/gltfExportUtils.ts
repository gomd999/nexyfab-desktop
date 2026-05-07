'use client';

import * as THREE from 'three';
import { downloadBlob } from '@/lib/platform';

// ─── Export entire THREE.Scene as binary GLB ─────────────────────────────────

export async function exportSceneGLB(
  scene: THREE.Scene,
  filename = 'scene',
): Promise<void> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

  const exporter = new GLTFExporter();

  return new Promise<void>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        let blob: Blob;
        if (result instanceof ArrayBuffer) {
          blob = new Blob([result], { type: 'application/octet-stream' });
        } else {
          const json = JSON.stringify(result);
          blob = new Blob([json], { type: 'application/json' });
        }
        const outName = filename.endsWith('.glb') ? filename : `${filename}.glb`;
        downloadBlob(outName, blob).then(resolve, reject);
      },
      (error) => {
        reject(error);
      },
      { binary: true },
    );
  });
}
