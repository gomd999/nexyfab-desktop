import{describe,expect,it}from'vitest';
import{offsetRevolveSide}from'./offsetRevolveSide';
const cylinder={kind:'revolve' as const,loop:[{x:0,y:0},{x:10,y:0},{x:10,y:20},{x:0,y:20}],angleDegrees:360,mode:'add' as const};
describe('offsetRevolveSide',()=>{
  it('moves the cylindrical wall through profile side 1',()=>expect(offsetRevolveSide(cylinder,1,2).loop).toEqual([{x:0,y:0},{x:12,y:0},{x:12,y:20},{x:0,y:20}]));
  it('rejects an offset through the rotation axis',()=>expect(()=>offsetRevolveSide(cylinder,1,-11)).toThrow(/axis|collapse|invert/));
});
