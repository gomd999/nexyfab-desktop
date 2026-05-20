import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as THREE from 'three';
import {
  getSharedMates,
  getSharedBodies,
  appendMate,
  findMateById,
  removeMateById,
  readMates,
  setBody,
  getBody,
  moveBody,
  setBodyFixed,
} from '../assemblyCrdt';
import { syncDocs } from '../sketchCrdt';
import type { Mate, AssemblyBody } from '../../assembly/matesSolver';

function makeMate(id: string, type: Mate['type'] = 'coincident'): Mate {
  return {
    id, type, enabled: true,
    selections: [
      {
        bodyIndex: 0, type: 'face',
        localPoint: new THREE.Vector3(0, 0, 0),
        localNormal: new THREE.Vector3(0, 1, 0),
      },
      {
        bodyIndex: 1, type: 'face',
        localPoint: new THREE.Vector3(0, 0, 0),
        localNormal: new THREE.Vector3(0, 1, 0),
      },
    ],
  };
}

function makeBody(name: string, x = 0, y = 0, z = 0, fixed = false): AssemblyBody {
  return {
    name,
    position: new THREE.Vector3(x, y, z),
    rotation: new THREE.Euler(0, 0, 0),
    fixed,
  };
}

describe('mate CRDT · single-doc', () => {
  it('appendMate + readMates round-trips id, type, enabled', () => {
    const doc = new Y.Doc();
    const arr = getSharedMates(doc);
    appendMate(arr, makeMate('m1'));
    appendMate(arr, makeMate('m2', 'distance'));
    const mates = readMates(arr);
    expect(mates).toHaveLength(2);
    expect(mates[0].id).toBe('m1');
    expect(mates[1].type).toBe('distance');
  });

  it('preserves selection localPoint / localNormal through JSON serialisation', () => {
    const doc = new Y.Doc();
    const arr = getSharedMates(doc);
    const m: Mate = {
      id: 'm', type: 'concentric', enabled: true,
      selections: [
        {
          bodyIndex: 0, type: 'axis',
          localPoint: new THREE.Vector3(1, 2, 3),
          localNormal: new THREE.Vector3(0, 1, 0),
          localAxis: new THREE.Vector3(0, 0, 1),
        },
        {
          bodyIndex: 1, type: 'axis',
          localPoint: new THREE.Vector3(4, 5, 6),
          localNormal: new THREE.Vector3(0, 1, 0),
        },
      ],
    };
    appendMate(arr, m);
    const back = readMates(arr)[0];
    expect(back.selections[0].localPoint.x).toBe(1);
    expect(back.selections[0].localAxis?.z).toBe(1);
    expect(back.selections[1].localPoint.x).toBe(4);
  });

  it('preserves type-specific fields (gearRatio, beltRadius, distance)', () => {
    const doc = new Y.Doc();
    const arr = getSharedMates(doc);
    appendMate(arr, { ...makeMate('m'), type: 'gear', gearRatio: 2.5 });
    appendMate(arr, { ...makeMate('b'), type: 'belt', beltRadius0: 10, beltRadius1: 20, beltCrossed: true });
    appendMate(arr, { ...makeMate('d'), type: 'distance', distance: 25 });
    const mates = readMates(arr);
    expect(mates[0].gearRatio).toBe(2.5);
    expect(mates[1].beltRadius0).toBe(10);
    expect(mates[1].beltCrossed).toBe(true);
    expect(mates[2].distance).toBe(25);
  });

  it('findMateById + removeMateById', () => {
    const doc = new Y.Doc();
    const arr = getSharedMates(doc);
    appendMate(arr, makeMate('m1'));
    appendMate(arr, makeMate('m2'));
    expect(findMateById(arr, 'm1')).not.toBeNull();
    expect(removeMateById(arr, 'm1')).toBe(true);
    expect(findMateById(arr, 'm1')).toBeNull();
    expect(readMates(arr).map(m => m.id)).toEqual(['m2']);
  });
});

describe('body CRDT · single-doc', () => {
  it('setBody + getBody round-trips position / rotation', () => {
    const doc = new Y.Doc();
    const bodies = getSharedBodies(doc);
    setBody(bodies, 'b1', makeBody('part1', 10, 20, 30));
    const back = getBody(bodies, 'b1');
    expect(back?.name).toBe('part1');
    expect(back?.position.x).toBe(10);
    expect(back?.position.y).toBe(20);
    expect(back?.position.z).toBe(30);
  });

  it('moveBody updates only position', () => {
    const doc = new Y.Doc();
    const bodies = getSharedBodies(doc);
    setBody(bodies, 'b1', makeBody('part1', 10, 20, 30, true));
    moveBody(bodies, 'b1', [99, 0, 0]);
    const back = getBody(bodies, 'b1');
    expect(back?.position.x).toBe(99);
    expect(back?.fixed).toBe(true); // preserved
    expect(back?.name).toBe('part1');
  });

  it('setBodyFixed toggles the flag without touching transform', () => {
    const doc = new Y.Doc();
    const bodies = getSharedBodies(doc);
    setBody(bodies, 'b1', makeBody('part1', 10, 20, 30));
    setBodyFixed(bodies, 'b1', true);
    const back = getBody(bodies, 'b1');
    expect(back?.fixed).toBe(true);
    expect(back?.position.x).toBe(10);
  });

  it('returns false / null for unknown body ids', () => {
    const doc = new Y.Doc();
    const bodies = getSharedBodies(doc);
    expect(getBody(bodies, 'ghost')).toBeNull();
    expect(moveBody(bodies, 'ghost', [1, 2, 3])).toBe(false);
    expect(setBodyFixed(bodies, 'ghost', true)).toBe(false);
  });
});

describe('mate CRDT · two-doc concurrent sync', () => {
  it('two users adding distinct mates → both visible after sync', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    appendMate(getSharedMates(a), makeMate('a-1'));
    appendMate(getSharedMates(b), makeMate('b-1'));
    syncDocs(a, b);
    const ids = readMates(getSharedMates(a)).map(m => m.id).sort();
    expect(ids).toEqual(['a-1', 'b-1']);
  });

  it('concurrent enabled / value edits on same mate merge field-by-field', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    appendMate(getSharedMates(a), { ...makeMate('shared'), type: 'distance', distance: 10 });
    syncDocs(a, b);
    // A flips enabled; B changes distance.
    findMateById(getSharedMates(a), 'shared')?.set('enabled', false);
    findMateById(getSharedMates(b), 'shared')?.set('distance', 25);
    syncDocs(a, b);
    const merged = readMates(getSharedMates(a))[0];
    expect(merged.enabled).toBe(false);
    expect(merged.distance).toBe(25);
  });

  it('concurrent body moves on different ids do not interfere', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    setBody(getSharedBodies(a), 'b1', makeBody('part1'));
    setBody(getSharedBodies(a), 'b2', makeBody('part2'));
    syncDocs(a, b);
    moveBody(getSharedBodies(a), 'b1', [100, 0, 0]);
    moveBody(getSharedBodies(b), 'b2', [0, 0, 200]);
    syncDocs(a, b);
    expect(getBody(getSharedBodies(a), 'b1')?.position.x).toBe(100);
    expect(getBody(getSharedBodies(a), 'b2')?.position.z).toBe(200);
  });
});
