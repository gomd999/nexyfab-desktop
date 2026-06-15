/**
 * assemblyCrdt.ts — Yjs CRDT binding for assembly mates and bodies.
 *
 * Same design rationale as `sketchCrdt`: by keying mates and bodies by
 * stable IDs in Y.Maps + Y.Arrays, concurrent assembly edits merge
 * deterministically. Two users adding distinct mates is a no-conflict
 * merge; two users tweaking different params of the same mate (e.g.
 * one changes the distance, another flips `enabled`) merges field-by-
 * field via the per-key LWW that Y.Map gives us.
 *
 * What lives on the wire:
 *   - `assemblyMates` (Y.Array<Y.Map>)  — one Y.Map per mate
 *   - `assemblyBodies` (Y.Map<Y.Map>)   — body-id → Y.Map of body state
 *
 * Body transform fields are JSON-stringified (position, rotation) so a
 * "move part B" edit is atomic, matching the user mental model of
 * "drag and drop a part to a new pose".
 */

import * as Y from 'yjs';
import * as THREE from 'three';
import type { Mate, AssemblyBody, MateType, MateSelection } from '../assembly/matesSolver';

const MATES_KEY = 'assemblyMates';
const BODIES_KEY = 'assemblyBodies';

export type MateMap = Y.Map<unknown>;
export type BodyMap = Y.Map<unknown>;

// ─── Mate helpers ────────────────────────────────────────────────────────

export function getSharedMates(doc: Y.Doc): Y.Array<MateMap> {
  return doc.getArray<MateMap>(MATES_KEY);
}

function selectionToJson(sel: MateSelection): string {
  return JSON.stringify({
    bodyIndex: sel.bodyIndex,
    type: sel.type,
    localPoint: [sel.localPoint.x, sel.localPoint.y, sel.localPoint.z],
    localNormal: [sel.localNormal.x, sel.localNormal.y, sel.localNormal.z],
    localAxis: sel.localAxis
      ? [sel.localAxis.x, sel.localAxis.y, sel.localAxis.z]
      : null,
  });
}

function selectionFromJson(s: string): MateSelection {
  const raw = JSON.parse(s) as {
    bodyIndex: number; type: MateSelection['type'];
    localPoint: [number, number, number];
    localNormal: [number, number, number];
    localAxis: [number, number, number] | null;
  };
  return {
    bodyIndex: raw.bodyIndex,
    type: raw.type,
    localPoint: new THREE.Vector3(...raw.localPoint),
    localNormal: new THREE.Vector3(...raw.localNormal),
    localAxis: raw.localAxis ? new THREE.Vector3(...raw.localAxis) : undefined,
  };
}

export function mateToYMap(mate: Mate): MateMap {
  const map = new Y.Map<unknown>();
  map.set('id', mate.id);
  map.set('type', mate.type);
  map.set('enabled', mate.enabled);
  map.set('selection0', selectionToJson(mate.selections[0]));
  map.set('selection1', selectionToJson(mate.selections[1]));
  if (mate.distance !== undefined) map.set('distance', mate.distance);
  if (mate.angle !== undefined) map.set('angle', mate.angle);
  if (mate.gearRatio !== undefined) map.set('gearRatio', mate.gearRatio);
  if (mate.beltRadius0 !== undefined) map.set('beltRadius0', mate.beltRadius0);
  if (mate.beltRadius1 !== undefined) map.set('beltRadius1', mate.beltRadius1);
  if (mate.beltCrossed !== undefined) map.set('beltCrossed', mate.beltCrossed);
  if (mate.min !== undefined) map.set('min', mate.min);
  if (mate.max !== undefined) map.set('max', mate.max);
  if (mate.widthSecond !== undefined) map.set('widthSecond', selectionToJson(mate.widthSecond));
  return map;
}

export function yMapToMate(map: MateMap): Mate {
  const out: Mate = {
    id: (map.get('id') as string) ?? '',
    type: (map.get('type') as MateType) ?? 'coincident',
    enabled: (map.get('enabled') as boolean) ?? true,
    selections: [
      selectionFromJson((map.get('selection0') as string) ?? '{}'),
      selectionFromJson((map.get('selection1') as string) ?? '{}'),
    ],
  };
  const dist = map.get('distance');
  if (typeof dist === 'number') out.distance = dist;
  const ang = map.get('angle');
  if (typeof ang === 'number') out.angle = ang;
  const gr = map.get('gearRatio');
  if (typeof gr === 'number') out.gearRatio = gr;
  const br0 = map.get('beltRadius0');
  if (typeof br0 === 'number') out.beltRadius0 = br0;
  const br1 = map.get('beltRadius1');
  if (typeof br1 === 'number') out.beltRadius1 = br1;
  const bc = map.get('beltCrossed');
  if (typeof bc === 'boolean') out.beltCrossed = bc;
  const mn = map.get('min');
  if (typeof mn === 'number') out.min = mn;
  const mx = map.get('max');
  if (typeof mx === 'number') out.max = mx;
  const ws = map.get('widthSecond');
  if (typeof ws === 'string') out.widthSecond = selectionFromJson(ws);
  return out;
}

export function appendMate(arr: Y.Array<MateMap>, mate: Mate): MateMap {
  const m = mateToYMap(mate);
  arr.push([m]);
  return m;
}

export function findMateById(arr: Y.Array<MateMap>, id: string): MateMap | null {
  for (let i = 0; i < arr.length; i++) {
    const m = arr.get(i);
    if (m.get('id') === id) return m;
  }
  return null;
}

export function removeMateById(arr: Y.Array<MateMap>, id: string): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr.get(i).get('id') === id) {
      arr.delete(i, 1);
      return true;
    }
  }
  return false;
}

export function readMates(arr: Y.Array<MateMap>): Mate[] {
  const out: Mate[] = [];
  arr.forEach(m => out.push(yMapToMate(m)));
  return out;
}

// ─── Body helpers ────────────────────────────────────────────────────────

export function getSharedBodies(doc: Y.Doc): Y.Map<BodyMap> {
  return doc.getMap<BodyMap>(BODIES_KEY);
}

export function bodyToYMap(body: AssemblyBody): BodyMap {
  const map = new Y.Map<unknown>();
  map.set('name', body.name);
  map.set('fixed', body.fixed);
  map.set('position', JSON.stringify([body.position.x, body.position.y, body.position.z]));
  map.set('rotation', JSON.stringify([body.rotation.x, body.rotation.y, body.rotation.z]));
  return map;
}

export function yMapToBody(map: BodyMap): AssemblyBody {
  const pos = JSON.parse((map.get('position') as string) ?? '[0,0,0]') as [number, number, number];
  const rot = JSON.parse((map.get('rotation') as string) ?? '[0,0,0]') as [number, number, number];
  return {
    name: (map.get('name') as string) ?? '',
    fixed: (map.get('fixed') as boolean) ?? false,
    position: new THREE.Vector3(...pos),
    rotation: new THREE.Euler(...rot),
  };
}

export function setBody(bodies: Y.Map<BodyMap>, id: string, body: AssemblyBody): BodyMap {
  const map = bodyToYMap(body);
  bodies.set(id, map);
  return map;
}

export function getBody(bodies: Y.Map<BodyMap>, id: string): AssemblyBody | null {
  const m = bodies.get(id);
  return m ? yMapToBody(m) : null;
}

/** Update a single body's position without recreating the whole map.
 *  Lets concurrent edits to different bodies merge cleanly while
 *  position changes still preserve other body attributes. */
export function moveBody(bodies: Y.Map<BodyMap>, id: string, position: [number, number, number]): boolean {
  const m = bodies.get(id);
  if (!m) return false;
  m.set('position', JSON.stringify(position));
  return true;
}

/** Toggle the `fixed` flag on a body. */
export function setBodyFixed(bodies: Y.Map<BodyMap>, id: string, fixed: boolean): boolean {
  const m = bodies.get(id);
  if (!m) return false;
  m.set('fixed', fixed);
  return true;
}
