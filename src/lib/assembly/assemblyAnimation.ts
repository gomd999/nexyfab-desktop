import type { AssemblyState, PartInstance, Quat } from './assemblyState';

export type AnimationInterpolation = 'linear' | 'smoothstep' | 's_curve';
export type PoseKeyframe = { frame:number; position?:PartInstance['position']; orientation?:Quat; interpolation?:AnimationInterpolation };
export type PartPoseTrack = { id:string; targetPartId:string; keyframes:PoseKeyframe[] };
export type AssemblyAnimation = { version:1; name:string; fps:number; startFrame:number; endFrame:number; loop?:boolean; tracks:PartPoseTrack[] };

export function validateAssemblyAnimation(animation:AssemblyAnimation,state:AssemblyState):string[]{
  const errors:string[]=[]; const ids=new Set(state.parts.map(p=>p.id)); const trackIds=new Set<string>();
  if(!Number.isFinite(animation.fps)||animation.fps<=0||animation.fps>240) errors.push('fps must be between 0 and 240.');
  if(!Number.isInteger(animation.startFrame)||!Number.isInteger(animation.endFrame)||animation.endFrame<animation.startFrame) errors.push('frame range is invalid.');
  for(const track of animation.tracks){
    if(trackIds.has(track.id)) errors.push(`Duplicate track id: ${track.id}.`); trackIds.add(track.id);
    if(!ids.has(track.targetPartId)) errors.push(`Track ${track.id} targets unknown part ${track.targetPartId}.`);
    const frames=new Set<number>();
    for(const key of track.keyframes){
      if(!Number.isInteger(key.frame)||key.frame<animation.startFrame||key.frame>animation.endFrame) errors.push(`Track ${track.id} has an out-of-range frame ${key.frame}.`);
      if(frames.has(key.frame)) errors.push(`Track ${track.id} has duplicate frame ${key.frame}.`); frames.add(key.frame);
      if(!key.position&&!key.orientation) errors.push(`Track ${track.id} frame ${key.frame} has no pose value.`);
    }
  }
  return errors;
}

export function evaluateAssemblyAnimation(state:AssemblyState,animation:AssemblyAnimation,frame:number):AssemblyState{
  const errors=validateAssemblyAnimation(animation,state); if(errors.length) throw new Error(errors.join(' '));
  const f=Math.max(animation.startFrame,Math.min(animation.endFrame,frame)); const tracks=new Map(animation.tracks.map(t=>[t.targetPartId,t]));
  return {...state,parts:state.parts.map(part=>{const track=tracks.get(part.id);return track?evaluateTrack(part,track,f):part;})};
}
function evaluateTrack(part:PartInstance,track:PartPoseTrack,frame:number):PartInstance{
  const keys=[...track.keyframes].sort((a,b)=>a.frame-b.frame); if(!keys.length)return part;
  const before=[...keys].reverse().find(k=>k.frame<=frame)??keys[0]!; const after=keys.find(k=>k.frame>=frame)??keys.at(-1)!;
  if(before.frame===after.frame)return {...part,position:before.position??part.position,orientation:normalize(before.orientation??part.orientation)};
  let t=(frame-before.frame)/(after.frame-before.frame); const interpolation=after.interpolation??before.interpolation??'linear';
  if(interpolation==='smoothstep')t=t*t*(3-2*t); else if(interpolation==='s_curve')t=t*t*t*(10+t*(-15+6*t));
  const p0=before.position??part.position,p1=after.position??p0,q0=before.orientation??part.orientation,q1=after.orientation??q0;
  return {...part,position:{x:mix(p0.x,p1.x,t),y:mix(p0.y,p1.y,t),z:mix(p0.z,p1.z,t)},orientation:slerp(q0,q1,t)};
}
function slerp(a:Quat,b:Quat,t:number):Quat{const q0=normalize(a);let q1=normalize(b),dot=q0.x*q1.x+q0.y*q1.y+q0.z*q1.z+q0.w*q1.w;if(dot<0){q1={x:-q1.x,y:-q1.y,z:-q1.z,w:-q1.w};dot=-dot;}if(dot>.9995)return normalize({x:mix(q0.x,q1.x,t),y:mix(q0.y,q1.y,t),z:mix(q0.z,q1.z,t),w:mix(q0.w,q1.w,t)});const theta=Math.acos(Math.max(-1,Math.min(1,dot))),s=Math.sin(theta);const x=Math.sin((1-t)*theta)/s,y=Math.sin(t*theta)/s;return{x:q0.x*x+q1.x*y,y:q0.y*x+q1.y*y,z:q0.z*x+q1.z*y,w:q0.w*x+q1.w*y};}
function normalize(q:Quat):Quat{const n=Math.hypot(q.x,q.y,q.z,q.w)||1;return{x:q.x/n,y:q.y/n,z:q.z/n,w:q.w/n};} function mix(a:number,b:number,t:number){return a+(b-a)*t;}
