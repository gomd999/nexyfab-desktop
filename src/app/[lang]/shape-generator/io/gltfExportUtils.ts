'use client';

import * as THREE from 'three';

// ─── Helper: trigger browser download ────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
        triggerDownload(blob, outName);
        resolve();
      },
      (error) => {
        reject(error);
      },
      { binary: true },
    );
  });
}
