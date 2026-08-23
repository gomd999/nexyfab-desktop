/**
 * agentBrepAdoption — B-rep provenance preserved across agent→modeler adoption.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  tagBrepProvenance,
  readBrepProvenance,
  canExportStepViaServerHandle,
  brepStepEndpoint,
  brepStepHeaders,
} from './agentBrepAdoption';

describe('tagBrepProvenance / readBrepProvenance', () => {
  const TOKEN = 'v1.capability';
  it('a fresh geometry has no provenance', () => {
    const g = new THREE.BufferGeometry();
    expect(readBrepProvenance(g)).toBeNull();
    expect(canExportStepViaServerHandle(g)).toBe(false);
  });

  it('stamps and reads back the server handle', () => {
    const g = new THREE.BufferGeometry();
    tagBrepProvenance(g, 'occt:42', TOKEN);
    expect(readBrepProvenance(g)).toEqual({ source: 'scad-agent', serverHandle: 'occt:42', handleAccessToken: TOKEN });
    expect(canExportStepViaServerHandle(g)).toBe(true);
  });

  it('a falsy handle is a no-op (call-site convenience)', () => {
    const g = new THREE.BufferGeometry();
    tagBrepProvenance(g, null, TOKEN);
    tagBrepProvenance(g, undefined, TOKEN);
    tagBrepProvenance(g, '');
    expect(readBrepProvenance(g)).toBeNull();
  });

  it('rejects a malformed provenance blob', () => {
    const g = new THREE.BufferGeometry();
    g.userData.brepProvenance = { source: 'something-else', serverHandle: 'x' };
    expect(readBrepProvenance(g)).toBeNull();
    g.userData.brepProvenance = { source: 'scad-agent' }; // missing handle
    expect(readBrepProvenance(g)).toBeNull();
    g.userData.brepProvenance = { source: 'scad-agent', serverHandle: 'occt:1' }; // missing capability
    expect(readBrepProvenance(g)).toBeNull();
  });

  it('re-tagging overwrites the prior handle', () => {
    const g = new THREE.BufferGeometry();
    tagBrepProvenance(g, 'occt:1', TOKEN);
    tagBrepProvenance(g, 'occt:2', TOKEN);
    expect(readBrepProvenance(g)!.serverHandle).toBe('occt:2');
  });
});

describe('brepStepEndpoint', () => {
  it('builds the URL with an encoded handle', () => {
    expect(brepStepEndpoint({ source: 'scad-agent', serverHandle: 'occt:7', handleAccessToken: 'v1.t' }))
      .toBe('/api/nexyfab/scad-agent/brep-step?handle=occt%3A7');
    expect(brepStepHeaders({ source: 'scad-agent', serverHandle: 'occt:7', handleAccessToken: 'v1.t' }))
      .toEqual({ 'x-nexyfab-brep-capability': 'v1.t' });
  });
});
