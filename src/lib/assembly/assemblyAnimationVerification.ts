import type { AssemblyState, PartInstance, Quat } from './assemblyState';
import type { AssemblyAnimation } from './assemblyAnimation';
import { evaluateAssemblyAnimation } from './assemblyAnimation';
import { aabbOverlap, assemblyInterferencesSpatial, transformAabb, type AABB, type InterferencePair } from './interference';

export type AnimationFrameStatus = 'passed' | 'warning' | 'failed' | 'not_run';
export type AnimationFrameEvidence = { frame: number; status: AnimationFrameStatus; pairs: InterferencePair[]; errors: string[] };
export type ContinuousInterference = {
  partA: string; partB: string; startFrame: number; endFrame: number;
  method: 'exact-linear-aabb' | 'adaptive-rotational-aabb';
  status: 'confirmed' | 'unresolved'; depth?: number;
};
export type AssemblyAnimationVerification = { verified: boolean; collisionFree: boolean; firstFailureFrame: number | null; frames: AnimationFrameEvidence[]; continuous: { checked: boolean; candidates: ContinuousInterference[]; unresolved: ContinuousInterference[] }; errors: string[] };
export type AnimationVerificationOptions = { frameStep?: number; whitelist?: ReadonlySet<string>; rotationalMaxDepth?: number };
export type AnimationCcdRecoveryAttempt = { rotationalMaxDepth: number; unresolvedBefore: number | null; unresolvedAfter: number; resolved: number };
export type AssemblyAnimationRecoveryResult = { verification: AssemblyAnimationVerification; attempts: AnimationCcdRecoveryAttempt[]; exhausted: boolean };

const sameQuat = (a: Quat, b: Quat) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) + Math.abs(a.w - b.w) <= 1e-10;
const pairKey = (a: string, b: string) => a < b ? `${a}::${b}` : `${b}::${a}`;

/** Exact time-of-impact existence for linearly translating, non-rotating AABBs. */
function linearSweptOverlap(a0: AABB, a1: AABB, b0: AABB, b1: AABB): boolean {
  let enter = 0; let exit = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const va = a1.min[axis] - a0.min[axis], vb = b1.min[axis] - b0.min[axis], relative = va - vb;
    if (Math.abs(relative) < 1e-12) { if (a0.max[axis] <= b0.min[axis] || b0.max[axis] <= a0.min[axis]) return false; continue; }
    const t1 = (b0.min[axis] - a0.max[axis]) / relative; const t2 = (b0.max[axis] - a0.min[axis]) / relative;
    enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2)); if (enter >= exit) return false;
  }
  return exit > 0 && enter < 1;
}

function union(a: AABB, b: AABB): AABB { return { min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) }, max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) } }; }
function radius(local: AABB): number {
  return Math.max(...[local.min.x, local.max.x].flatMap(x => [local.min.y, local.max.y].flatMap(y => [local.min.z, local.max.z].map(z => Math.hypot(x, y, z)))));
}
function quatAngle(a: Quat, b: Quat): number {
  const na = Math.hypot(a.x, a.y, a.z, a.w), nb = Math.hypot(b.x, b.y, b.z, b.w);
  if (!(na > 0) || !(nb > 0)) return Math.PI;
  const dot = Math.min(1, Math.abs((a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)/(na*nb)));
  return 2*Math.acos(dot);
}
function expand(box: AABB, amount: number): AABB { return { min: { x: box.min.x-amount, y: box.min.y-amount, z: box.min.z-amount }, max: { x: box.max.x+amount, y: box.max.y+amount, z: box.max.z+amount } }; }
/** Conservative bound around the endpoint boxes. The deviation of a rotating
 * point from its endpoint chord is bounded by r*sin(theta/2). Subdivision
 * therefore tightens the old full-radius envelope instead of preserving its
 * false positives forever. */
function rotationalEnvelope(local: AABB, p0: PartInstance, p1: PartInstance): AABB {
  return expand(union(transformAabb(local,p0),transformAabb(local,p1)), radius(local)*Math.sin(quatAngle(p0.orientation,p1.orientation)/2));
}

function continuousCandidates(start: AssemblyState, end: AssemblyState, localBoxes: ReadonlyMap<string, AABB>, startFrame: number, endFrame: number, poseAt: (frame:number)=>AssemblyState, whitelist?: ReadonlySet<string>, maxDepth=8): ContinuousInterference[] {
  const endById = new Map(end.parts.map(part => [part.id, part])); const out: ContinuousInterference[] = [];
  for (let i = 0; i < start.parts.length; i++) for (let j = i + 1; j < start.parts.length; j++) {
    const a0 = start.parts[i]!, b0 = start.parts[j]!, a1 = endById.get(a0.id), b1 = endById.get(b0.id), la = localBoxes.get(a0.id), lb = localBoxes.get(b0.id); if (!a1 || !b1 || !la || !lb) continue;
    if (whitelist?.has(pairKey(a0.id, b0.id))) continue;
    const rotating = !sameQuat(a0.orientation, a1.orientation) || !sameQuat(b0.orientation, b1.orientation);
    const ids = { partA: a0.id < b0.id ? a0.id : b0.id, partB: a0.id < b0.id ? b0.id : a0.id };
    if (!rotating) {
      if (linearSweptOverlap(transformAabb(la,a0),transformAabb(la,a1),transformAabb(lb,b0),transformAabb(lb,b1))) out.push({...ids,startFrame,endFrame,method:'exact-linear-aabb',status:'confirmed'});
      continue;
    }
    const inspect = (aa0:PartInstance,aa1:PartInstance,bb0:PartInstance,bb1:PartInstance,f0:number,f1:number,depth:number): void => {
      if (!aabbOverlap(rotationalEnvelope(la,aa0,aa1),rotationalEnvelope(lb,bb0,bb1))) return;
      const mid=(f0+f1)/2, midState=poseAt(mid), byId=new Map(midState.parts.map(p=>[p.id,p])), am=byId.get(a0.id), bm=byId.get(b0.id);
      if (!am || !bm) { out.push({...ids,startFrame:f0,endFrame:f1,method:'adaptive-rotational-aabb',status:'unresolved',depth}); return; }
      // A midpoint broad-phase hit is useful narrow-phase evidence, but it does
      // not cover the open intervals on either side. Keep subdividing so that
      // every part of the interval is either conservatively proven clear or
      // explicitly retained as unresolved at the governed depth limit.
      if (aabbOverlap(transformAabb(la,am),transformAabb(lb,bm))) out.push({...ids,startFrame:mid,endFrame:mid,method:'adaptive-rotational-aabb',status:'confirmed',depth});
      if (depth>=maxDepth || Math.abs(f1-f0)<=1e-6) { out.push({...ids,startFrame:f0,endFrame:f1,method:'adaptive-rotational-aabb',status:'unresolved',depth}); return; }
      inspect(aa0,am,bb0,bm,f0,mid,depth+1); inspect(am,aa1,bm,bb1,mid,f1,depth+1);
    };
    inspect(a0,a1,b0,b1,startFrame,endFrame,0);
  }
  return out;
}

export function verifyAssemblyAnimationFrames(state: AssemblyState, animation: AssemblyAnimation, localBoxes: ReadonlyMap<string, AABB> | null, options: AnimationVerificationOptions = {}): AssemblyAnimationVerification {
  if (!localBoxes) return { verified: false, collisionFree: false, firstFailureFrame: null, frames: [], continuous: { checked: false, candidates: [], unresolved: [] }, errors: ['Local collision boxes were not supplied.'] };
  const step = Math.max(1, Math.floor(options.frameStep ?? 1)), frames: AnimationFrameEvidence[] = [], poses: Array<{ frame: number; state: AssemblyState }> = [];
  const sample = (frame: number) => { const pose = evaluateAssemblyAnimation(state, animation, frame); const missing = pose.parts.filter(p => !localBoxes.has(p.id)).map(p => p.id); const pairs = assemblyInterferencesSpatial(pose.parts, localBoxes, options.whitelist); frames.push({ frame, status: missing.length ? 'not_run' : pairs.length ? 'failed' : 'passed', pairs, errors: missing.length ? [`Missing collision boxes: ${missing.join(', ')}.`] : [] }); poses.push({ frame, state: pose }); };
  const criticalFrames = new Set<number>([animation.startFrame, animation.endFrame, ...animation.tracks.flatMap(track => track.keyframes.map(key => key.frame))]);
  for (let frame = animation.startFrame; frame <= animation.endFrame; frame += step) criticalFrames.add(frame);
  for (const frame of [...criticalFrames].sort((a, b) => a - b)) sample(frame);
  const continuous = poses.slice(0, -1).flatMap((pose, index) => continuousCandidates(pose.state, poses[index + 1]!.state, localBoxes, pose.frame, poses[index + 1]!.frame, frame=>evaluateAssemblyAnimation(state,animation,frame), options.whitelist, Math.max(0,Math.floor(options.rotationalMaxDepth??8))));
  const unresolved=continuous.filter(item=>item.status==='unresolved'), confirmed=continuous.filter(item=>item.status==='confirmed');
  const first = frames.find(f => f.status === 'failed'); const errors = frames.flatMap(f => f.errors.map(e => `Frame ${f.frame}: ${e}`)); const firstContinuous = continuous[0];
  const firstFailure = Math.min(first?.frame ?? Infinity, firstContinuous?.startFrame ?? Infinity);
  const continuousErrors=unresolved.map(item=>`Rotational CCD unresolved for ${item.partA}/${item.partB} in frames ${item.startFrame}-${item.endFrame}.`);
  return { verified: errors.length === 0 && unresolved.length===0, collisionFree: errors.length === 0 && !first && confirmed.length === 0 && unresolved.length===0, firstFailureFrame: Number.isFinite(firstFailure) ? firstFailure : null, frames, continuous: { checked: errors.length === 0, candidates: continuous, unresolved }, errors:[...errors,...continuousErrors] };
}

/** Execute a bounded, deterministic collision-refine recovery. Each retry
 * increases only rotational interval depth and reuses the exact same design
 * inputs; it can reduce numerical uncertainty but cannot change geometry or
 * silently invent clearance. */
export function verifyAssemblyAnimationWithRecovery(
  state: AssemblyState,
  animation: AssemblyAnimation,
  localBoxes: ReadonlyMap<string, AABB> | null,
  options: AnimationVerificationOptions & { rotationalDepthSchedule?: readonly number[] } = {},
): AssemblyAnimationRecoveryResult {
  const requested = Math.max(0, Math.min(16, Math.floor(options.rotationalMaxDepth ?? 6)));
  const schedule = [...new Set((options.rotationalDepthSchedule ?? [requested, Math.min(8, Math.max(requested, 8))])
    .map(depth => Math.max(requested, Math.min(16, Math.floor(depth)))))].sort((a,b)=>a-b);
  let verification: AssemblyAnimationVerification | null = null;
  const attempts: AnimationCcdRecoveryAttempt[]=[];
  for(const rotationalMaxDepth of schedule){
    const before=verification?.continuous.unresolved.length??null;
    verification=verifyAssemblyAnimationFrames(state,animation,localBoxes,{...options,rotationalMaxDepth});
    const after=verification.continuous.unresolved.length;
    attempts.push({rotationalMaxDepth,unresolvedBefore:before,unresolvedAfter:after,resolved:before===null?0:Math.max(0,before-after)});
    if(after===0)break;
  }
  // The schedule is never empty, but retain a defensive fail-closed fallback.
  verification??=verifyAssemblyAnimationFrames(state,animation,localBoxes,{...options,rotationalMaxDepth:requested});
  return{verification,attempts,exhausted:verification.continuous.unresolved.length>0};
}
