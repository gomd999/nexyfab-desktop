import type { Point3 } from './robotCableRouting';
export type ServiceEnvelope={id:string;min:Point3;max:Point3};
export type ServiceObstacle={id:string;min:Point3;max:Point3};
export function verifyServiceEnvelopes(envelopes:readonly ServiceEnvelope[],obstacles:readonly ServiceObstacle[]){
  const conflicts=envelopes.flatMap(e=>obstacles.filter(o=>overlap(e,o)).map(o=>({envelopeId:e.id,obstacleId:o.id})));
  return { verified:envelopes.length>0, clear:envelopes.length>0&&conflicts.length===0, conflicts, errors:envelopes.length?conflicts.map(x=>`${x.envelopeId} overlaps ${x.obstacleId}.`):['No service envelope geometry was supplied.'] };
}
function overlap(a:ServiceEnvelope,b:ServiceObstacle){return a.min.x<b.max.x&&a.max.x>b.min.x&&a.min.y<b.max.y&&a.max.y>b.min.y&&a.min.z<b.max.z&&a.max.z>b.min.z;}
