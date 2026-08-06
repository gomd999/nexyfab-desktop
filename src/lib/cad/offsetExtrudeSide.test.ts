import {describe,expect,it} from 'vitest';
import {offsetExtrudeSide} from './offsetExtrudeSide';
const square=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
describe('offsetExtrudeSide',()=>{
  it('moves one CCW rectangle edge outward while preserving stable edge order',()=>{
    expect(offsetExtrudeSide(square,1,2)).toEqual([{x:0,y:0},{x:12,y:0},{x:12,y:10},{x:0,y:10}]);
  });
  it('supports inward signed offsets',()=>{
    expect(offsetExtrudeSide(square,0,-2)).toEqual([{x:0,y:2},{x:10,y:2},{x:10,y:10},{x:0,y:10}]);
  });
  it('rejects collapse and stale topology references',()=>{
    expect(()=>offsetExtrudeSide(square,0,-10)).toThrow(/collapse|zero-length/);
    expect(()=>offsetExtrudeSide(square,9,1)).toThrow(/stale/);
  });
});
