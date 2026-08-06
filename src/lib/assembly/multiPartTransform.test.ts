import { describe, expect, it } from 'vitest';
import { prepareMateAwareMove, rotateAssemblyParts, translateAssemblyParts } from './multiPartTransform';
import { IDENTITY_QUAT, type AssemblyState } from './assemblyState';
const state: AssemblyState = { parts: [{ id:'base',name:'base',partTemplateId:'base',position:{x:0,y:0,z:0},orientation:IDENTITY_QUAT,fixed:true },{id:'a',name:'a',partTemplateId:'a',position:{x:10,y:0,z:0},orientation:IDENTITY_QUAT},{id:'b',name:'b',partTemplateId:'b',position:{x:20,y:5,z:0},orientation:IDENTITY_QUAT}], mates:[] };
describe('multi-part transform',()=>{
  it('preserves relative placement',()=>{const r=translateAssemblyParts(state,['a','b'],{x:5,y:-2,z:3});expect(r.parts[1]!.position).toEqual({x:15,y:-2,z:3});expect(r.parts[2]!.position).toEqual({x:25,y:3,z:3});});
  it('refuses fixed parts',()=>expect(()=>translateAssemblyParts(state,['base'],{x:1,y:0,z:0})).toThrow(/Fixed/));
  it('rotates a group around its centroid',()=>{const r=rotateAssemblyParts(state,['a','b'],{x:0,y:0,z:180});expect(r.parts[1]!.position.x).toBeCloseTo(20);expect(r.parts[2]!.position.x).toBeCloseTo(10);});
  it('requires an explicit mate policy',()=>{const m={...state,mates:[{id:'m',kind:'concentric' as const,a:{partId:'a',refId:'z',refKind:'axis' as const},b:{partId:'base',refId:'z',refKind:'axis' as const}}]};expect(prepareMateAwareMove(m,['a'],'constrained').requiresSolve).toBe(true);expect(prepareMateAwareMove(m,['a'],'suppress').state.mates[0]!.suppressed).toBe(true);expect(prepareMateAwareMove(m,['a'],'remove').state.mates).toHaveLength(0);expect(prepareMateAwareMove(m,['a'],'cancel').cancelled).toBe(true);});
});
