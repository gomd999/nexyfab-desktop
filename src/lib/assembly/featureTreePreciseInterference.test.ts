// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { collisionGeometryFromFeatureTree, locatePreciseCollisionTime, refineFeatureTreeInterferences, refineLinearIntervals, refineRotationalIntervals } from './featureTreePreciseInterference';

const square = (lo: number, hi: number) => [
  { x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi },
];
const extrude = (id: string, lo: number, hi: number, depth: number): FeatureNode => ({
  id, name: id, dependencies: [],
  payload: { kind: 'extrude', loop: square(lo, hi), depth, direction: 'one_sided', mode: 'add' },
});
const pose = (id: string) => ({
  id, name: id, partTemplateId: id, fixed: true,
  position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
});

describe('FeatureTree OCCT precise collision geometry', () => {
  it('executes and tessellates a boolean final feature instead of falling back to AABB', async () => {
    const loaded = await loadOcctNode();
    if (!loaded.ok) return;
    const tree: FeatureTree = {
      nodes: [
        extrude('base', 0, 20, 10),
        extrude('tool', 5, 15, 10),
        { id: 'cut', name: 'cut', dependencies: ['base', 'tool'], payload: { kind: 'boolean', op: 'difference', bodies: ['base', 'tool'] } },
      ],
    };
    const cut = await collisionGeometryFromFeatureTree('cut-part', tree);
    expect(cut.available, cut.reason).toBe(true);
    expect(cut.part.bodies[0]?.bodyId).toBe('cut');
    expect(cut.geometry.bodies[0]?.poly?.faces.length).toBeGreaterThan(12);

    const peg = await collisionGeometryFromFeatureTree('peg', { nodes: [extrude('peg-body', 6, 14, 10)] });
    const broad = [{
      partA: 'cut-part', partB: 'peg', penetration: 8,
      bboxA: { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 20, z: 10 } },
      bboxB: { min: { x: 6, y: 6, z: 0 }, max: { x: 14, y: 14, z: 10 } },
    }];
    const refined = refineFeatureTreeInterferences(broad, [pose('cut-part'), pose('peg')], new Map([
      ['cut-part', cut], ['peg', peg],
    ]));
    expect(refined[0]).toMatchObject({ available: true, intersects: false });
  }, 60_000);

  it('cuts a drilled Hole feature through its first dependency and clears a part inside it', async () => {
    const loaded = await loadOcctNode();
    if (!loaded.ok) return;
    const drilled: FeatureTree = {
      nodes: [
        extrude('plate', 0, 20, 10),
        {
          id: 'hole', name: 'hole', dependencies: ['plate'],
          payload: { kind: 'hole', center: { x: 10, y: 10 }, holeType: 'drilled', diameter: 12, depth: 10 },
        },
      ],
    };
    const plate = await collisionGeometryFromFeatureTree('plate', drilled);
    expect(plate.available, plate.reason).toBe(true);
    expect(plate.part.bodies[0]?.bodyId).toBe('hole');

    const counterbored = await collisionGeometryFromFeatureTree('counterbored', {
      nodes: [
        extrude('plate', 0, 20, 10),
        {
          id: 'counterbore', name: 'counterbore', dependencies: ['plate'],
          payload: {
            kind: 'hole', center: { x: 10, y: 10 }, holeType: 'counterbore', diameter: 12, depth: 10,
            counterboreDiameter: 16, counterboreDepth: 3,
          },
        },
      ],
    });
    expect(counterbored.available, counterbored.reason).toBe(true);
    expect(counterbored.geometry.totalVolumeMm3).toBeLessThan(plate.geometry.totalVolumeMm3);

    const countersunk = await collisionGeometryFromFeatureTree('countersunk', {
      nodes: [
        extrude('plate', 0, 20, 10),
        {
          id: 'countersink', name: 'countersink', dependencies: ['plate'],
          payload: {
            kind: 'hole', center: { x: 10, y: 10 }, holeType: 'countersink', diameter: 12, depth: 10,
            countersinkAngleDegrees: 90, countersinkDepth: 3,
          },
        },
      ],
    });
    expect(countersunk.available, countersunk.reason).toBe(true);
    expect(countersunk.geometry.totalVolumeMm3).toBeLessThan(plate.geometry.totalVolumeMm3);

    const insert = await collisionGeometryFromFeatureTree('insert', { nodes: [extrude('insert-body', 7, 13, 10)] });
    const broad = [{
      partA: 'insert', partB: 'plate', penetration: 6,
      bboxA: { min: { x: 7, y: 7, z: 0 }, max: { x: 13, y: 13, z: 10 } },
      bboxB: { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 20, z: 10 } },
    }];
    const refined = refineFeatureTreeInterferences(broad, [pose('plate'), pose('insert')], new Map([
      ['plate', plate], ['insert', insert],
    ]));
    expect(refined[0]).toMatchObject({ available: true, intersects: false });
  }, 60_000);
});

describe('rotational interval mesh-distance refinement',()=>{
  const barTree:FeatureTree={nodes:[{id:'bar-body',name:'bar',dependencies:[],payload:{kind:'extrude',loop:[{x:-5,y:-.1},{x:5,y:-.1},{x:5,y:.1},{x:-5,y:.1}],depth:.2,direction:'one_sided',mode:'add'}}]};
  const pinTree:FeatureTree={nodes:[{id:'pin-body',name:'pin',dependencies:[],payload:{kind:'extrude',loop:[{x:-.1,y:-.1},{x:.1,y:-.1},{x:.1,y:.1},{x:-.1,y:.1}],depth:.2,direction:'one_sided',mode:'add'}}]};
  const animation={version:1 as const,name:'rotate',fps:30,startFrame:0,endFrame:10,tracks:[{id:'bar-track',targetPartId:'bar',keyframes:[{frame:0,orientation:{x:0,y:0,z:0,w:1}},{frame:10,orientation:{x:0,y:0,z:1,w:0}}]}]};
  const boxes=new Map([['bar',{min:{x:-5,y:-.1,z:0},max:{x:5,y:.1,z:.2}}],['pin',{min:{x:-.1,y:-.1,z:0},max:{x:.1,y:.1,z:.2}}]]);
  it('proves an entire small rotational leaf clear when real mesh gap exceeds all possible motion',async()=>{const bar=await collisionGeometryFromFeatureTree('bar',barTree),pin=await collisionGeometryFromFeatureTree('pin',pinTree);const state={parts:[pose('bar'),{...pose('pin'),position:{x:4,y:4,z:0}}],mates:[]};const evidence=refineRotationalIntervals(state,animation,[{partA:'bar',partB:'pin',startFrame:0,endFrame:.1,method:'adaptive-rotational-aabb',status:'unresolved',depth:8}],boxes,new Map([['bar',bar],['pin',pin]]));expect(evidence[0]).toMatchObject({status:'proven_clear'});expect(evidence[0]!.minimumDistanceMm!).toBeGreaterThan(evidence[0]!.motionBoundMm!);});
  it('confirms a real rotating-mesh collision at the interval midpoint',async()=>{const bar=await collisionGeometryFromFeatureTree('bar',barTree),pin=await collisionGeometryFromFeatureTree('pin',pinTree);const state={parts:[pose('bar'),{...pose('pin'),position:{x:3,y:3,z:0}}],mates:[]};const evidence=refineRotationalIntervals(state,animation,[{partA:'bar',partB:'pin',startFrame:2.4,endFrame:2.6,method:'adaptive-rotational-aabb',status:'unresolved',depth:8}],boxes,new Map([['bar',bar],['pin',pin]]));expect(evidence[0]).toMatchObject({status:'confirmed_collision',minimumDistanceMm:0});});
  it('keeps excess precise leaves unavailable when the governed work budget is exhausted',async()=>{const bar=await collisionGeometryFromFeatureTree('bar',barTree),pin=await collisionGeometryFromFeatureTree('pin',pinTree),state={parts:[pose('bar'),{...pose('pin'),position:{x:4,y:4,z:0}}],mates:[]},leaf={partA:'bar',partB:'pin',startFrame:0,endFrame:.1,method:'adaptive-rotational-aabb' as const,status:'unresolved' as const,depth:8};const evidence=refineRotationalIntervals(state,animation,[leaf,{...leaf,startFrame:.1,endFrame:.2}],boxes,new Map([['bar',bar],['pin',pin]]),1e-7,1);expect(evidence.map(item=>item.status)).toEqual(['proven_clear','unavailable']);expect(evidence[1]!.reason).toContain('budget 1 exceeded');});
  it('confirms a real collision hidden inside a linearly swept interval',async()=>{const bar=await collisionGeometryFromFeatureTree('bar',barTree),pin=await collisionGeometryFromFeatureTree('pin',pinTree),state={parts:[pose('bar'),{...pose('pin'),position:{x:-10,y:0,z:0}}],mates:[]},linear={version:1 as const,name:'pass through',fps:30,startFrame:0,endFrame:10,tracks:[{id:'pin-track',targetPartId:'pin',keyframes:[{frame:0,position:{x:-10,y:0,z:0}},{frame:10,position:{x:10,y:0,z:0}}]}]},candidate={partA:'bar',partB:'pin',startFrame:0,endFrame:10,method:'exact-linear-aabb' as const,status:'confirmed' as const};const evidence=refineLinearIntervals(state,linear,[candidate],boxes,new Map([['bar',bar],['pin',pin]]));expect(evidence[0]).toMatchObject({status:'confirmed_collision',midpointFrame:5,minimumDistanceMm:0});});
  it('returns a conservative first-collision bracket only after all earlier intervals are mesh-proven clear',async()=>{const bar=await collisionGeometryFromFeatureTree('bar',barTree),pin=await collisionGeometryFromFeatureTree('pin',pinTree),state={parts:[pose('bar'),{...pose('pin'),position:{x:-10,y:0,z:0}}],mates:[]},linear={version:1 as const,name:'pass through',fps:30,startFrame:0,endFrame:10,tracks:[{id:'pin-track',targetPartId:'pin',keyframes:[{frame:0,position:{x:-10,y:0,z:0}},{frame:10,position:{x:10,y:0,z:0}}]}]},candidate={partA:'bar',partB:'pin',startFrame:0,endFrame:10,method:'exact-linear-aabb' as const,status:'confirmed' as const};const evidence=locatePreciseCollisionTime(state,linear,[candidate],boxes,new Map([['bar',bar],['pin',pin]]),{frameTolerance:1e-3,maxDepth:20});expect(evidence[0]).toMatchObject({status:'collision_bracket'});expect(evidence[0]!.firstPossibleFrame!).toBeLessThanOrEqual(evidence[0]!.confirmedCollisionFrame!);expect(evidence[0]!.bracketWidthFrames!).toBeLessThanOrEqual(1e-3);expect(evidence[0]!.confirmedCollisionFrame!).toBeGreaterThan(2);expect(evidence[0]!.confirmedCollisionFrame!).toBeLessThan(3);expect(evidence[0]!.clearIntervals).toBeGreaterThan(0);});
  it('keeps TOI unresolved when its independent precise evaluation budget is exhausted',async()=>{const bar=await collisionGeometryFromFeatureTree('bar',barTree),pin=await collisionGeometryFromFeatureTree('pin',pinTree),state={parts:[pose('bar'),{...pose('pin'),position:{x:-10,y:0,z:0}}],mates:[]},linear={version:1 as const,name:'pass through',fps:30,startFrame:0,endFrame:10,tracks:[{id:'pin-track',targetPartId:'pin',keyframes:[{frame:0,position:{x:-10,y:0,z:0}},{frame:10,position:{x:10,y:0,z:0}}]}]},candidate={partA:'bar',partB:'pin',startFrame:0,endFrame:10,method:'exact-linear-aabb' as const,status:'confirmed' as const};expect(locatePreciseCollisionTime(state,linear,[candidate],boxes,new Map([['bar',bar],['pin',pin]]),{maxEvaluations:2})[0]).toMatchObject({status:'unresolved',reason:expect.stringContaining('budget 2 exceeded')});});
  it('brackets the first contact of a rotating executed mesh, not merely a sampled frame',async()=>{const bar=await collisionGeometryFromFeatureTree('bar',barTree),pin=await collisionGeometryFromFeatureTree('pin',pinTree),state={parts:[pose('bar'),{...pose('pin'),position:{x:3,y:3,z:0}}],mates:[]},candidate={partA:'bar',partB:'pin',startFrame:0,endFrame:5,method:'adaptive-rotational-aabb' as const,status:'unresolved' as const,depth:0},result=locatePreciseCollisionTime(state,animation,[candidate],boxes,new Map([['bar',bar],['pin',pin]]),{frameTolerance:1e-3,maxDepth:20})[0]!;expect(result.status).toBe('collision_bracket');expect(result.bracketWidthFrames!).toBeLessThanOrEqual(1e-3);expect(result.confirmedCollisionFrame!).toBeGreaterThan(1.5);expect(result.confirmedCollisionFrame!).toBeLessThan(2.5);expect(result.clearIntervals).toBeGreaterThan(0);});
});
