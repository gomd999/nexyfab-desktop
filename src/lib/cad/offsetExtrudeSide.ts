export type Point2 = { x:number; y:number };

function area(loop: readonly Point2[]): number {
  return loop.reduce((sum, point, index) => {
    const next = loop[(index + 1) % loop.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function lineIntersection(a:Point2,b:Point2,c:Point2,d:Point2):Point2|null {
  const rx=b.x-a.x,ry=b.y-a.y,sx=d.x-c.x,sy=d.y-c.y,den=rx*sy-ry*sx;
  if(Math.abs(den)<1e-10)return null;
  const t=((c.x-a.x)*sy-(c.y-a.y)*sx)/den;
  return{x:a.x+t*rx,y:a.y+t*ry};
}

function orient(a:Point2,b:Point2,c:Point2):number{return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function segmentsCross(a:Point2,b:Point2,c:Point2,d:Point2):boolean{
  const ab1=orient(a,b,c),ab2=orient(a,b,d),cd1=orient(c,d,a),cd2=orient(c,d,b);
  return ab1*ab2 < -1e-9 && cd1*cd2 < -1e-9;
}
function selfIntersects(loop:readonly Point2[]):boolean{
  for(let i=0;i<loop.length;i++)for(let j=i+1;j<loop.length;j++){
    if(j===i||j===(i+1)%loop.length||i===(j+1)%loop.length)continue;
    if(segmentsCross(loop[i]!,loop[(i+1)%loop.length]!,loop[j]!,loop[(j+1)%loop.length]!))return true;
  }
  return false;
}

/** Move one profile edge parallel to itself; positive distance is outward. */
export function offsetExtrudeSide(loop:readonly Point2[],sideIndex:number,distance:number):Point2[]{
  if(loop.length<3)throw new Error('Side-face offset requires a profile with at least three edges.');
  if(!Number.isInteger(sideIndex)||sideIndex<0||sideIndex>=loop.length)throw new Error(`Side face f.side.${sideIndex} is stale.`);
  if(!Number.isFinite(distance)||distance===0)throw new Error('Side-face offset requires a non-zero finite distance.');
  const signedArea=area(loop);if(Math.abs(signedArea)<1e-9)throw new Error('Profile area is degenerate.');
  const i=sideIndex,j=(i+1)%loop.length,prev=(i-1+loop.length)%loop.length,next=(j+1)%loop.length;
  const a=loop[i]!,b=loop[j]!,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
  if(len<1e-9)throw new Error(`Side face f.side.${sideIndex} has a zero-length source edge.`);
  const orientation=signedArea>0?1:-1,nx=orientation*dy/len,ny=orientation*-dx/len;
  const shiftedA={x:a.x+nx*distance,y:a.y+ny*distance},shiftedB={x:b.x+nx*distance,y:b.y+ny*distance};
  const newA=lineIntersection(loop[prev]!,a,shiftedA,shiftedB);
  const newB=lineIntersection(shiftedA,shiftedB,b,loop[next]!);
  if(!newA||!newB)throw new Error('Side-face offset is undefined because an adjacent edge is parallel.');
  const result=loop.map(point=>({...point}));result[i]=newA;result[j]=newB;
  const nextArea=area(result);
  if(Math.abs(nextArea)<1e-8||Math.sign(nextArea)!==Math.sign(signedArea)||selfIntersects(result))throw new Error('Side-face offset would collapse, invert, or self-intersect the profile.');
  if(result.some((point,index)=>Math.hypot(point.x-result[(index+1)%result.length]!.x,point.y-result[(index+1)%result.length]!.y)<1e-8))throw new Error('Side-face offset would create a zero-length edge.');
  return result;
}
