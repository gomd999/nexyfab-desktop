import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildAssemblyGlbScene } from './assemblyGlbExport';
import { IDENTITY_QUAT } from './assemblyState';

describe('assembly GLB scene', () => {
  it('preserves separate part nodes and emits animation tracks', () => {
    const source = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial());
    mesh.userData.partId = 'arm';
    source.add(mesh);
    const state = { parts: [{ id: 'arm', name: 'Arm', partTemplateId: 'arm', position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT, fixed: true }], mates: [] };
    const animation = { version: 1 as const, name: 'move', fps: 30, startFrame: 0, endFrame: 30, tracks: [{ id: 't', targetPartId: 'arm', keyframes: [{ frame: 0, position: { x: 0, y: 0, z: 0 } }, { frame: 30, position: { x: 10, y: 0, z: 0 } }] }] };
    const built = buildAssemblyGlbScene(source, state, animation);
    expect(built.exportedPartIds).toEqual(['arm']);
    expect(built.scene.children[0]?.userData.partId).toBe('arm');
    expect(built.clip?.tracks).toHaveLength(2);
  });

  it('reports a missing rendered part instead of substituting a box', () => {
    const state = { parts: [{ id: 'missing', name: 'Missing', partTemplateId: 'x', position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT, fixed: true }], mates: [] };
    const animation = { version: 1 as const, name: 'none', fps: 30, startFrame: 0, endFrame: 1, tracks: [] };
    expect(buildAssemblyGlbScene(new THREE.Scene(), state, animation).missingPartIds).toEqual(['missing']);
  });
});
