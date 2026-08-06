import * as THREE from 'three';
import type { StableFace, TopologicalMap } from '@/app/[lang]/shape-generator/topology/TopologicalNaming';

/** Resolve one raycast triangle to the closest registered geometric face group. */
export function pickStableMeshFace(
  geometry: THREE.BufferGeometry,
  triangleIndex: number,
  map: TopologicalMap,
): StableFace|null {
  const position=geometry.getAttribute('position');
  if(!position||!Number.isInteger(triangleIndex)||triangleIndex<0)return null;
  const index=geometry.getIndex();
  const at=(corner:number)=>index?index.getX(triangleIndex*3+corner):triangleIndex*3+corner;
  if(at(2)>=position.count)return null;
  const a=new THREE.Vector3().fromBufferAttribute(position,at(0)),b=new THREE.Vector3().fromBufferAttribute(position,at(1)),c=new THREE.Vector3().fromBufferAttribute(position,at(2));
  const normal=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
  if(normal.lengthSq()<.5)return null;
  const centroid=a.add(b).add(c).multiplyScalar(1/3);
  const ranked=Object.values(map.faces).map(face=>{const n=new THREE.Vector3(...face.signature.normal);const direction=Math.max(0,normal.dot(n));const fc=new THREE.Vector3(...face.signature.centroid);const scale=Math.max(Math.sqrt(Math.abs(face.signature.area)),1);const proximity=Math.exp(-centroid.distanceTo(fc)/scale);return{face,score:direction*.82+proximity*.18};}).sort((x,y)=>y.score-x.score||x.face.stableId.localeCompare(y.face.stableId));
  const best=ranked[0],runnerUp=ranked[1];
  if(!best||best.score<.72)return null;
  // Equal geometric candidates are review-required; never choose by array order.
  if(runnerUp&&best.score-runnerUp.score<.03)return null;
  return best.face;
}
