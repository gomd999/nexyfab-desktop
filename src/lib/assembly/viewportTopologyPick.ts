export type ViewportPickMode = 'part' | 'face' | 'edge' | 'point';
export type PickBounds = { min: { x:number;y:number;z:number }; max: { x:number;y:number;z:number } };
export type PickVector = { x:number;y:number;z:number };
export type PickedTopologyReference = { refId:string;refKind:'face'|'plane'|'axis'|'edge'|'point' };

/** Convert a mesh hit into a deterministic bbox reference, never a transient triangle index. */
export function classifyViewportTopologyPick(mode:Exclude<ViewportPickMode,'part'>,point:PickVector,normal:PickVector,bounds:PickBounds):PickedTopologyReference|null{
  const axes=(['x','y','z']as const);
  const side=(axis:'x'|'y'|'z')=>Math.abs(point[axis]-bounds.min[axis])<=Math.abs(point[axis]-bounds.max[axis])?'min':'max';
  if(mode==='face'){
    const axis=axes.reduce((best,axis)=>Math.abs(normal[axis])>Math.abs(normal[best])?axis:best,'x');
    if(Math.abs(normal[axis])<0.9)return null;
    return{refId:`bbox_plane_${axis}_${side(axis)}`,refKind:'plane'};
  }
  const ranked=axes.map(axis=>({axis,distance:Math.min(Math.abs(point[axis]-bounds.min[axis]),Math.abs(point[axis]-bounds.max[axis]))})).sort((a,b)=>a.distance-b.distance);
  const count=mode==='point'?3:2;
  const chosen=ranked.slice(0,count);
  const scale=Math.max(...axes.map(axis=>bounds.max[axis]-bounds.min[axis]),1);
  if(chosen.some(item=>item.distance>scale*0.08))return null;
  const suffix=chosen.map(item=>`${item.axis}${side(item.axis)}`).sort().join('_');
  return{refId:`bbox_${mode}_${suffix}`,refKind:mode};
}
