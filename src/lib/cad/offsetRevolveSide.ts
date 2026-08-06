import type { RevolveFeature } from './revolveProfile';
import { offsetExtrudeSide } from './offsetExtrudeSide';

/** Move one generative revolve side face through its canonical profile edge. */
export function offsetRevolveSide(feature:RevolveFeature,sideIndex:number,distance:number):RevolveFeature{
  const loop=offsetExtrudeSide(feature.loop,sideIndex,distance);
  if(loop.some(point=>point.x < -1e-8))throw new Error('Revolve face offset would cross the rotation axis.');
  const canonical=loop.map(point=>({x:Math.abs(point.x)<1e-8?0:point.x,y:point.y}));
  if(canonical.every(point=>point.x===0))throw new Error('Revolve face offset would collapse the profile onto the rotation axis.');
  return{...feature,loop:canonical};
}
