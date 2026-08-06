import type { PartInstance } from './assemblyState';
import type { AABB, InterferencePair } from './interference';
import type { AssemblyState } from './assemblyState';
import type { AssemblyAnimation } from './assemblyAnimation';
import { evaluateAssemblyAnimation } from './assemblyAnimation';
import type { ContinuousInterference } from './assemblyAnimationVerification';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { MeshableFeature } from '@/lib/cad/featureMesh';
import { buildPartGeometry, type PartGeometry } from '@/lib/ai/design-driver/geometryGate';
import { preciseInterference, preciseSeparation } from '@/lib/ai/design-driver/interferencePrecise';
import type { PlanPart } from '@/lib/ai/design-driver/types';
import { featureTreeToOcctPlan } from '@/lib/occt/featurePlan';
import { executeOcctPlan } from '@/lib/occt/planExecutor';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { VertexWeld, triangleNormal } from '@/lib/occt/occtTessellate';

const MESHABLE = new Set(['extrude', 'revolve', 'sweep', 'sweep_path', 'loft']);

export interface FeatureTreeCollisionGeometry {
  part: PlanPart;
  geometry: ReturnType<typeof buildPartGeometry>;
  available: boolean;
  reason?: string;
}

/** Build collision geometry from the active terminal bodies of one FeatureTree. */
export async function collisionGeometryFromFeatureTree(partId: string, tree: FeatureTree): Promise<FeatureTreeCollisionGeometry> {
  const active = tree.nodes.filter(node => !node.suppressed);
  const consumed = new Set(active.flatMap(node => [...node.dependencies]));
  const terminal = active.filter(node => !consumed.has(node.id));
  const unsupported = terminal.filter(node => !MESHABLE.has(node.payload.kind));
  const part: PlanPart = {
    partId,
    name: partId,
    bodies: terminal
      .filter(node => MESHABLE.has(node.payload.kind))
      .map(node => ({ bodyId: node.id, feature: node.payload as MeshableFeature })),
  };
  const geometry = buildPartGeometry(part);
  if (terminal.length === 0) return { part, geometry, available: false, reason: `${partId}: no active terminal body` };
  if (unsupported.length > 0) return collisionGeometryFromOcct(partId, tree, part, geometry);
  const failed = geometry.bodies.filter(body => !body.poly || !body.watertight);
  if (failed.length > 0) {
    return { part, geometry, available: false, reason: `${partId}: invalid collision mesh: ${failed.map(body => body.bodyId).join(', ')}` };
  }
  return { part, geometry, available: true };
}

async function collisionGeometryFromOcct(
  partId: string,
  tree: FeatureTree,
  fallbackPart: PlanPart,
  fallbackGeometry: PartGeometry,
): Promise<FeatureTreeCollisionGeometry> {
  let plan;
  try { plan = featureTreeToOcctPlan(tree); }
  catch (error) {
    return { part: fallbackPart, geometry: fallbackGeometry, available: false, reason: `${partId}: OCCT plan failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!plan.finalResultId || plan.unsupported.length > 0) {
    return {
      part: fallbackPart, geometry: fallbackGeometry, available: false,
      reason: `${partId}: OCCT unsupported feature(s): ${plan.unsupported.map(node => `${node.resultId}:${node.kind}`).join(', ') || 'no final solid'}`,
    };
  }
  const loaded = await loadOcctNode();
  if (!loaded.ok || !loaded.oc) {
    return { part: fallbackPart, geometry: fallbackGeometry, available: false, reason: `${partId}: OCCT unavailable: ${loaded.reason ?? 'load failed'}` };
  }
  const bridge = createNodeOcctBridge(loaded.oc);
  const executed = await executeOcctPlan(plan, bridge);
  if (!executed.ok || !executed.finalShape) {
    return { part: fallbackPart, geometry: fallbackGeometry, available: false, reason: `${partId}: OCCT execution failed: ${executed.error ?? 'no final shape'}` };
  }
  try {
    const tessellated = await bridge.tessellate(executed.finalShape, 0.1);
    if (!tessellated.ok || !tessellated.mesh) {
      return { part: fallbackPart, geometry: fallbackGeometry, available: false, reason: `${partId}: OCCT tessellation failed: ${tessellated.error ?? 'no mesh'}` };
    }
    const poly = polyhedronFromTrianglePositions(tessellated.mesh.positions);
    if (poly.faces.length === 0) {
      return { part: fallbackPart, geometry: fallbackGeometry, available: false, reason: `${partId}: OCCT tessellation returned no triangles` };
    }
    const xs = poly.vertices.map(vertex => vertex.x);
    const ys = poly.vertices.map(vertex => vertex.y);
    const zs = poly.vertices.map(vertex => vertex.z);
    const bbox: [number, number, number][] = [
      [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    ];
    const bodyId = plan.finalResultId;
    const seed = fallbackPart.bodies[0]?.feature ?? dummyFeature();
    const part: PlanPart = { partId, name: partId, bodies: [{ bodyId, feature: seed }] };
    const geometry: PartGeometry = {
      partId,
      bodies: [{ bodyId, poly, bbox: { min: bbox[0]!, max: bbox[1]! }, volumeMm3: executed.finalShape.volume ?? 0, flippedFaces: 0, watertight: true, nonManifoldEdges: 0 }],
      totalVolumeMm3: executed.finalShape.volume ?? 0,
      bbox: { min: bbox[0]!, max: bbox[1]! },
      overlappingBodyPairs: [],
    };
    return { part, geometry, available: true };
  } finally {
    bridge.release(executed.finalShape);
  }
}

function polyhedronFromTrianglePositions(positions: ReadonlyArray<number>) {
  const weld = new VertexWeld();
  const faces = [];
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a = weld.add({ x: positions[i]!, y: positions[i + 1]!, z: positions[i + 2]! });
    const b = weld.add({ x: positions[i + 3]!, y: positions[i + 4]!, z: positions[i + 5]! });
    const c = weld.add({ x: positions[i + 6]!, y: positions[i + 7]!, z: positions[i + 8]! });
    if (a === b || b === c || a === c) continue;
    faces.push({ vertices: [a, b, c], normal: triangleNormal(weld.vertices[a]!, weld.vertices[b]!, weld.vertices[c]!) });
  }
  return { vertices: weld.vertices, faces };
}

function dummyFeature(): MeshableFeature {
  return { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], depth: 1, direction: 'one_sided', mode: 'add' };
}

export interface RefinedInterference {
  pair: InterferencePair;
  available: boolean;
  intersects: boolean;
  triPairsIntersecting: number;
  byContainment: boolean;
  trianglesA: number;
  trianglesB: number;
  unavailableReason?: string;
}

/** Refine broad-phase pairs using FeatureTree tessellation in the supplied solved pose. */
export function refineFeatureTreeInterferences(
  pairs: ReadonlyArray<InterferencePair>,
  poses: ReadonlyArray<PartInstance>,
  geometries: ReadonlyMap<string, FeatureTreeCollisionGeometry>,
): RefinedInterference[] {
  const poseById = new Map(poses.map(pose => [pose.id, pose]));
  return pairs.map(pair => {
    const a = geometries.get(pair.partA);
    const b = geometries.get(pair.partB);
    const poseA = poseById.get(pair.partA);
    const poseB = poseById.get(pair.partB);
    const reason = !a?.available ? a?.reason ?? `${pair.partA}: FeatureTree unavailable`
      : !b?.available ? b?.reason ?? `${pair.partB}: FeatureTree unavailable`
      : !poseA || !poseB ? 'solved part pose unavailable' : null;
    if (reason || !a || !b || !poseA || !poseB) {
      return { pair, available: false, intersects: true, triPairsIntersecting: 0, byContainment: false, trianglesA: 0, trianglesB: 0, unavailableReason: reason ?? 'collision geometry unavailable' };
    }
    const result = preciseInterference(
      a.part, a.geometry, poseA, b.part, b.geometry, poseB,
      {
        min: {
          x: Math.max(pair.bboxA.min.x, pair.bboxB.min.x),
          y: Math.max(pair.bboxA.min.y, pair.bboxB.min.y),
          z: Math.max(pair.bboxA.min.z, pair.bboxB.min.z),
        },
        max: {
          x: Math.min(pair.bboxA.max.x, pair.bboxB.max.x),
          y: Math.min(pair.bboxA.max.y, pair.bboxB.max.y),
          z: Math.min(pair.bboxA.max.z, pair.bboxB.max.z),
        },
      },
    );
    return { pair, ...result };
  });
}

export interface PreciseMotionIntervalEvidence {
  partA:string;partB:string;startFrame:number;endFrame:number;
  status:'proven_clear'|'confirmed_collision'|'unresolved'|'unavailable';
  midpointFrame:number;minimumDistanceMm:number|null;motionBoundMm:number|null;
  reason?:string;
}
export type PreciseRotationalIntervalEvidence = PreciseMotionIntervalEvidence;

/** Refine fail-closed rotational leaves with real tessellated geometry. A leaf
 * is clear only when its measured midpoint surface gap exceeds a conservative
 * upper bound on how far either solid can move anywhere in that leaf. */
export function refineRotationalIntervals(
  state:AssemblyState,animation:AssemblyAnimation,intervals:ReadonlyArray<ContinuousInterference>,
  localBoxes:ReadonlyMap<string,AABB>,geometries:ReadonlyMap<string,FeatureTreeCollisionGeometry>,
  clearanceToleranceMm=1e-7,maxIntervals=256,kind:'rotational'|'linear'='rotational',
):PreciseMotionIntervalEvidence[]{
  const candidates=intervals.filter(item=>kind==='rotational'?item.method==='adaptive-rotational-aabb'&&item.status==='unresolved':item.method==='exact-linear-aabb'&&item.status==='confirmed'),budget=Math.max(0,Math.floor(maxIntervals));
  const evaluated:PreciseMotionIntervalEvidence[]=candidates.slice(0,budget).map(interval=>{
    const midpointFrame=(interval.startFrame+interval.endFrame)/2,start=evaluateAssemblyAnimation(state,animation,interval.startFrame),mid=evaluateAssemblyAnimation(state,animation,midpointFrame),end=evaluateAssemblyAnimation(state,animation,interval.endFrame);
    const maps=[start,mid,end].map(pose=>new Map(pose.parts.map(part=>[part.id,part]))),[a0,am,a1]=maps.map(map=>map.get(interval.partA)),[b0,bm,b1]=maps.map(map=>map.get(interval.partB));
    const ga=geometries.get(interval.partA),gb=geometries.get(interval.partB),ba=localBoxes.get(interval.partA),bb=localBoxes.get(interval.partB);
    if(!a0||!am||!a1||!b0||!bm||!b1||!ga?.available||!gb?.available||!ba||!bb)return{...interval,midpointFrame,status:'unavailable',minimumDistanceMm:null,motionBoundMm:null,reason:ga?.reason??gb?.reason??'pose, local bounds, or precise collision geometry unavailable'};
    const separation=preciseSeparation(ga.part,ga.geometry,am,gb.part,gb.geometry,bm);
    if(!separation.available||separation.minimumDistanceMm===null)return{...interval,midpointFrame,status:'unavailable',minimumDistanceMm:null,motionBoundMm:null,reason:separation.unavailableReason??'precise separation unavailable'};
    if(separation.intersects)return{...interval,midpointFrame,status:'confirmed_collision',minimumDistanceMm:0,motionBoundMm:0};
    const motionBoundMm=poseMotionBound(a0,am,a1,ba)+poseMotionBound(b0,bm,b1,bb);
    return separation.minimumDistanceMm>motionBoundMm+clearanceToleranceMm
      ?{...interval,midpointFrame,status:'proven_clear',minimumDistanceMm:separation.minimumDistanceMm,motionBoundMm}
      :{...interval,midpointFrame,status:'unresolved',minimumDistanceMm:separation.minimumDistanceMm,motionBoundMm,reason:'Measured mesh separation does not exceed the conservative interval motion bound.'};
  });
  const overflow=candidates.slice(budget).map(interval=>({...interval,midpointFrame:(interval.startFrame+interval.endFrame)/2,status:'unavailable' as const,minimumDistanceMm:null,motionBoundMm:null,reason:`Precise rotational interval budget ${budget} exceeded.`}));
  return[...evaluated,...overflow];
}

/** Apply the same executed mesh-distance proof to exact swept-AABB candidates.
 * "Exact" describes box motion, not arbitrary concave solids; this removes
 * those broad-phase false positives without weakening continuous coverage. */
export function refineLinearIntervals(
  state:AssemblyState,animation:AssemblyAnimation,intervals:ReadonlyArray<ContinuousInterference>,
  localBoxes:ReadonlyMap<string,AABB>,geometries:ReadonlyMap<string,FeatureTreeCollisionGeometry>,
  clearanceToleranceMm=1e-7,maxIntervals=256,
):PreciseMotionIntervalEvidence[]{return refineRotationalIntervals(state,animation,intervals,localBoxes,geometries,clearanceToleranceMm,maxIntervals,'linear');}

export interface PreciseCollisionTimeEvidence {
  partA:string;partB:string;status:'collision_bracket'|'proven_clear'|'unresolved'|'unavailable';
  searchStartFrame:number;searchEndFrame:number;firstPossibleFrame:number|null;confirmedCollisionFrame:number|null;
  bracketWidthFrames:number|null;evaluations:number;clearIntervals:number;reason?:string;
}

/** Finds the earliest *possible* collision interval from left to right. Every
 * interval before a returned bracket is proven clear by real mesh separation
 * exceeding the maximum rigid-body motion bound. The bracket upper endpoint
 * is a measured mesh collision; its lower endpoint is conservative. */
export function locatePreciseCollisionTime(
  state:AssemblyState,animation:AssemblyAnimation,intervals:ReadonlyArray<ContinuousInterference>,
  localBoxes:ReadonlyMap<string,AABB>,geometries:ReadonlyMap<string,FeatureTreeCollisionGeometry>,
  options:{maxDepth?:number;frameTolerance?:number;maxEvaluations?:number;clearanceToleranceMm?:number}={},
):PreciseCollisionTimeEvidence[]{
  const maxDepth=Number.isFinite(options.maxDepth)?Math.max(0,Math.min(24,Math.floor(options.maxDepth!))):16,frameTolerance=Number.isFinite(options.frameTolerance)?Math.max(1e-9,options.frameTolerance!):1e-3,maxEvaluations=Number.isFinite(options.maxEvaluations)?Math.max(1,Math.min(100_000,Math.floor(options.maxEvaluations!))):4096,clearance=Number.isFinite(options.clearanceToleranceMm)?Math.max(0,options.clearanceToleranceMm!):1e-7;
  const grouped=new Map<string,ContinuousInterference[]>();for(const interval of intervals){const key=[interval.partA,interval.partB].sort().join('::');grouped.set(key,[...(grouped.get(key)??[]),interval]);}
  return [...grouped.values()].map(raw=>{
    const sorted=[...raw].sort((a,b)=>a.startFrame-b.startFrame||a.endFrame-b.endFrame),first=sorted[0]!,ga=geometries.get(first.partA),gb=geometries.get(first.partB),ba=localBoxes.get(first.partA),bb=localBoxes.get(first.partB);
    const searchStartFrame=Math.min(...sorted.map(x=>x.startFrame)),searchEndFrame=Math.max(...sorted.map(x=>x.endFrame));let evaluations=0,clearIntervals=0;
    if(!ga?.available||!gb?.available||!ba||!bb)return{partA:first.partA,partB:first.partB,status:'unavailable',searchStartFrame,searchEndFrame,firstPossibleFrame:null,confirmedCollisionFrame:null,bracketWidthFrames:null,evaluations,clearIntervals,reason:ga?.reason??gb?.reason??'local bounds or collision geometry unavailable'};
    const at=(frame:number)=>{if(evaluations>=maxEvaluations)return null;evaluations++;const pose=evaluateAssemblyAnimation(state,animation,frame),byId=new Map(pose.parts.map(part=>[part.id,part])),a=byId.get(first.partA),b=byId.get(first.partB);if(!a||!b)return null;const separation=preciseSeparation(ga.part,ga.geometry,a,gb.part,gb.geometry,b);return separation.available?{a,b,separation}:null;};
    type Search={kind:'clear'}|{kind:'collision';lo:number;hi:number}|{kind:'unresolved';lo:number;hi:number;reason:string};
    const search=(f0:number,f1:number,depth:number,startSample:ReturnType<typeof at>,endSample:ReturnType<typeof at>):Search=>{
      if(!startSample||!endSample)return{kind:'unresolved',lo:f0,hi:f1,reason:evaluations>=maxEvaluations?`Precise TOI evaluation budget ${maxEvaluations} exceeded.`:'pose or precise separation unavailable'};
      if(startSample.separation.intersects)return{kind:'collision',lo:f0,hi:f0};
      const mid=(f0+f1)/2,midSample=at(mid);if(!midSample)return{kind:'unresolved',lo:f0,hi:f1,reason:evaluations>=maxEvaluations?`Precise TOI evaluation budget ${maxEvaluations} exceeded.`:'midpoint precise separation unavailable'};
      const motionBound=poseMotionBound(startSample.a,midSample.a,endSample.a,ba)+poseMotionBound(startSample.b,midSample.b,endSample.b,bb);
      if(!midSample.separation.intersects&&midSample.separation.minimumDistanceMm!==null&&midSample.separation.minimumDistanceMm>motionBound+clearance){clearIntervals++;return{kind:'clear'};}
      if(depth>=maxDepth||f1-f0<=frameTolerance){
        if(midSample.separation.intersects)return{kind:'collision',lo:f0,hi:mid};
        if(endSample.separation.intersects)return{kind:'collision',lo:f0,hi:f1};
        return{kind:'unresolved',lo:f0,hi:f1,reason:depth>=maxDepth?`Precise TOI depth ${maxDepth} exhausted.`:`Precise TOI tolerance ${frameTolerance} reached without a clear or colliding sample.`};
      }
      const left=search(f0,mid,depth+1,startSample,midSample);if(left.kind!=='clear')return left;
      return search(mid,f1,depth+1,midSample,endSample);
    };
    for(const interval of sorted){const start=at(interval.startFrame),end=at(interval.endFrame),found=search(interval.startFrame,interval.endFrame,0,start,end);if(found.kind==='collision')return{partA:first.partA,partB:first.partB,status:'collision_bracket',searchStartFrame,searchEndFrame,firstPossibleFrame:found.lo,confirmedCollisionFrame:found.hi,bracketWidthFrames:found.hi-found.lo,evaluations,clearIntervals};if(found.kind==='unresolved')return{partA:first.partA,partB:first.partB,status:'unresolved',searchStartFrame,searchEndFrame,firstPossibleFrame:found.lo,confirmedCollisionFrame:null,bracketWidthFrames:found.hi-found.lo,evaluations,clearIntervals,reason:found.reason};}
    return{partA:first.partA,partB:first.partB,status:'proven_clear',searchStartFrame,searchEndFrame,firstPossibleFrame:null,confirmedCollisionFrame:null,bracketWidthFrames:null,evaluations,clearIntervals};
  });
}

function poseMotionBound(start:PartInstance,mid:PartInstance,end:PartInstance,box:AABB):number{
  const radius=Math.max(...[box.min.x,box.max.x].flatMap(x=>[box.min.y,box.max.y].flatMap(y=>[box.min.z,box.max.z].map(z=>Math.hypot(x,y,z)))));
  const displacement=(a:PartInstance,b:PartInstance)=>Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y,a.position.z-b.position.z)+2*radius*Math.sin(quatAngle(a.orientation,b.orientation)/2);
  return Math.max(displacement(mid,start),displacement(mid,end));
}
function quatAngle(a:PartInstance['orientation'],b:PartInstance['orientation']):number{const na=Math.hypot(a.x,a.y,a.z,a.w),nb=Math.hypot(b.x,b.y,b.z,b.w);if(!(na>0)||!(nb>0))return Math.PI;return 2*Math.acos(Math.min(1,Math.abs((a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)/(na*nb))));}
