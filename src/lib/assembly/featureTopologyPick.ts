import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { HoleFeature } from '@/lib/cad/holeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import { buildRevolveTopo } from '@/lib/cad/topoNaming';
import type { PickVector, PickedTopologyReference } from './viewportTopologyPick';

/** Map a mesh hit back to generative-provenance topology names. */
export function classifyFeatureTopologyPick(
  tree: FeatureTree | undefined,
  point: PickVector,
  mode: 'face'|'edge'|'point',
): PickedTopologyReference|null {
  if (!tree) return null;

  if (mode === 'face') {
    let holeIndex = 0;
    for (const node of tree.nodes) {
      if (node.payload.kind !== 'hole') continue;
      const hole = node.payload as HoleFeature;
      const radius = hole.diameter / 2;
      const radial = Math.hypot(point.x - hole.center.x, point.y - hole.center.y);
      const tolerance = Math.max(0.05, radius * 0.04);
      if (Math.abs(radial - radius) <= tolerance && point.z >= -hole.depth - tolerance && point.z <= tolerance) {
        return { refId: `hole_axis_${holeIndex}`, refKind: 'axis' };
      }
      holeIndex += 1;
    }
  }

  const revolve = tree.nodes.find(node => node.payload.kind === 'revolve')?.payload as RevolveFeature|undefined;
  if (revolve) {
    const picked = classifyRevolve(revolve, point, mode);
    if (picked) return picked;
  }

  const base = tree.nodes.find(node => node.payload.kind === 'extrude')?.payload as ExtrudeFeature|undefined;
  if (!base || base.loop.length < 3) return null;
  const loop = dedupeLoop(base.loop);
  const {z0,z1}=extrudeRange(base);
  const scale = Math.max(base.depth, ...loop.map(p => Math.hypot(p.x, p.y)), 1);
  const tolerance = Math.max(0.05, scale * 0.012);

  if (mode === 'face') {
    if (Math.abs(point.z-z0) <= tolerance) return { refId: 'f.cap.bottom', refKind: 'plane' };
    if (Math.abs(point.z-z1) <= tolerance) return { refId: 'f.cap.top', refKind: 'plane' };
    if (point.z < z0-tolerance || point.z > z1+tolerance) return null;
    const side = nearestProfileEdge(loop, point);
    return side.distance <= tolerance ? { refId: `f.side.${side.index}`, refKind: 'plane' } : null;
  }

  if (mode === 'point') {
    let best = { distance: Infinity, index: -1, top: false };
    loop.forEach((vertex, index) => { for (const top of [false,true]) { const distance=Math.hypot(point.x-vertex.x,point.y-vertex.y,point.z-(top?z1:z0));if(distance<best.distance)best={distance,index,top}; } });
    return best.distance <= tolerance ? { refId: `v.${best.top?'top':'bottom'}.${best.index}`, refKind: 'point' } : null;
  }

  const side = nearestProfileEdge(loop, point);
  const cap = Math.abs(point.z-z0) <= Math.abs(point.z-z1) ? 'bottom' : 'top';
  const capDistance = Math.hypot(side.distance, Math.min(Math.abs(point.z-z0),Math.abs(point.z-z1)));
  let vertical = { distance: Infinity, index: -1 };
  loop.forEach((vertex,index)=>{const z=Math.max(z0,Math.min(z1,point.z));const distance=Math.hypot(point.x-vertex.x,point.y-vertex.y,point.z-z);if(distance<vertical.distance)vertical={distance,index};});
  if (vertical.distance <= capDistance && vertical.distance <= tolerance) return { refId:`e.vert.${vertical.index}`,refKind:'edge' };
  if (capDistance <= tolerance) return { refId:`e.${cap}.${side.index}-${(side.index+1)%loop.length}`,refKind:'edge' };
  return null;
}

function dedupeLoop(loop:ReadonlyArray<{x:number;y:number}>):Array<{x:number;y:number}>{const result:Array<{x:number;y:number}>=[];for(const point of loop){const previous=result.at(-1);if(!previous||Math.hypot(point.x-previous.x,point.y-previous.y)>1e-9)result.push(point);}if(result.length>1&&Math.hypot(result[0]!.x-result.at(-1)!.x,result[0]!.y-result.at(-1)!.y)<1e-9)result.pop();return result;}
function extrudeRange(feature:ExtrudeFeature):{z0:number;z1:number}{const z=feature.profileOffsetZ??0,d=feature.depth;if(feature.direction==='two_sided')return{z0:z-d,z1:z+d};if(feature.direction==='midplane')return{z0:z-d/2,z1:z+d/2};return{z0:z,z1:z+d};}
function nearestProfileEdge(loop:ReadonlyArray<{x:number;y:number}>,point:PickVector):{index:number;distance:number}{let best={index:-1,distance:Infinity};loop.forEach((a,index)=>{const b=loop[(index+1)%loop.length]!,dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/l2)):0,distance=Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy));if(distance<best.distance)best={index,distance};});return best;}

function classifyRevolve(feature:RevolveFeature,point:PickVector,mode:'face'|'edge'|'point'):PickedTopologyReference|null{
  const topo=buildRevolveTopo(feature),profile=topo.profile;
  const radius=Math.hypot(point.x,point.z),theta=normaliseAngle(Math.atan2(-point.z,point.x)*180/Math.PI);
  const scale=Math.max(...profile.map(p=>Math.max(p.x,Math.abs(p.y))),1),tolerance=Math.max(.05,scale*.012),angleTolerance=Math.max(.4,180/Math.max(32,Math.ceil(scale)));
  const insideSweep=topo.full||theta<=feature.angleDegrees+angleTolerance;
  if(!insideSweep)return null;
  if(mode==='face'){
    if(!topo.full&&Math.min(theta,360-theta)<=angleTolerance&&pointInPolygon({x:radius,y:point.y},profile))return{refId:'f.cap.start',refKind:'plane'};
    if(!topo.full&&Math.abs(theta-feature.angleDegrees)<=angleTolerance&&pointInPolygon({x:radius,y:point.y},profile))return{refId:'f.cap.end',refKind:'plane'};
    const side=nearestProfileEdge(profile,{x:radius,y:point.y,z:0});
    return side.distance<=tolerance&&topo.byName.has(`f.side.${side.index}`)?{refId:`f.side.${side.index}`,refKind:'face'}:null;
  }
  if(mode==='point')return null;
  let latitude={distance:Infinity,index:-1};profile.forEach((p,index)=>{if(p.x<=1e-9)return;const distance=Math.hypot(radius-p.x,point.y-p.y);if(distance<latitude.distance)latitude={distance,index};});
  if(latitude.distance<=tolerance&&topo.byName.has(`e.lat.${latitude.index}`))return{refId:`e.lat.${latitude.index}`,refKind:'edge'};
  const side=nearestProfileEdge(profile,{x:radius,y:point.y,z:0});
  if(side.distance>tolerance)return null;
  if(topo.full&&Math.min(theta,360-theta)<=angleTolerance&&topo.byName.has(`e.seam.${side.index}`))return{refId:`e.seam.${side.index}`,refKind:'edge'};
  if(!topo.full&&Math.min(theta,360-theta)<=angleTolerance&&topo.byName.has(`e.mer.start.${side.index}`))return{refId:`e.mer.start.${side.index}`,refKind:'edge'};
  if(!topo.full&&Math.abs(theta-feature.angleDegrees)<=angleTolerance&&topo.byName.has(`e.mer.end.${side.index}`))return{refId:`e.mer.end.${side.index}`,refKind:'edge'};
  return null;
}
function normaliseAngle(value:number):number{return(value%360+360)%360;}
function pointInPolygon(point:{x:number;y:number},loop:ReadonlyArray<{x:number;y:number}>):boolean{let inside=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i]!,b=loop[j]!,crosses=(a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x;if(crosses)inside=!inside;}return inside;}
