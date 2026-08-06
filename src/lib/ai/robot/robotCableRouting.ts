export type Point3 = { x:number; y:number; z:number };
export type CableRoute = { id:string; diameterMm:number; minBendRadiusMm:number; maxTwistDeg:number; guidePoints:Point3[]; twistDeg:number; serviceLoopLengthMm?:number; requiredServiceLoopMm?:number; minClearanceMm?:number };
export type KeepOutSphere = { id:string; center:Point3; radiusMm:number };
export type CableRouteReport = { id:string; passed:boolean; minimumBendRadiusMm:number|null; minimumClearanceMm:number|null; errors:string[] };

export function verifyCableRoutes(routes:readonly CableRoute[], keepOut:readonly KeepOutSphere[]=[]):CableRouteReport[] {
  return routes.map(route=>{
    const errors:string[]=[];
    if(route.guidePoints.length<3) errors.push('At least three 3D guide points are required.');
    let bend=Infinity;
    for(let i=1;i<route.guidePoints.length-1;i++) bend=Math.min(bend,circumradius(route.guidePoints[i-1]!,route.guidePoints[i]!,route.guidePoints[i+1]!));
    if(Number.isFinite(bend)&&bend<route.minBendRadiusMm) errors.push(`Bend radius ${bend.toFixed(2)} mm is below ${route.minBendRadiusMm} mm.`);
    if(Math.abs(route.twistDeg)>route.maxTwistDeg) errors.push(`Cable twist ${Math.abs(route.twistDeg)} deg exceeds ${route.maxTwistDeg} deg.`);
    if((route.serviceLoopLengthMm??0)<(route.requiredServiceLoopMm??0)) errors.push('Required service loop length is not provided.');
    let clearance=Infinity;
    for(const p of route.guidePoints) for(const body of keepOut) clearance=Math.min(clearance,distance(p,body.center)-body.radiusMm-route.diameterMm/2);
    if(Number.isFinite(clearance)&&clearance<(route.minClearanceMm??0)) errors.push(`Cable clearance ${clearance.toFixed(2)} mm is insufficient.`);
    return { id:route.id, passed:errors.length===0, minimumBendRadiusMm:Number.isFinite(bend)?bend:null, minimumClearanceMm:Number.isFinite(clearance)?clearance:null, errors };
  });
}
function circumradius(a:Point3,b:Point3,c:Point3){const ab=distance(a,b),bc=distance(b,c),ca=distance(c,a);const cross=crossLength(a,b,c);return cross<1e-9?Infinity:(ab*bc*ca)/(2*cross);}
function crossLength(a:Point3,b:Point3,c:Point3){const u={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},v={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};return Math.hypot(u.y*v.z-u.z*v.y,u.z*v.x-u.x*v.z,u.x*v.y-u.y*v.x);}
function distance(a:Point3,b:Point3){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
