import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '@/lib/assembly/assemblyState';
import { POST } from './route';

describe('CAD v1 animation verification recovery contract', () => {
  it('returns a stable fail-closed recovery disposition when precise geometry is absent', async () => {
    const state = { parts: [{ id: 'p', name: 'part', partTemplateId: 'p', position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT }], mates: [] };
    const animation = { version: 1, name: 'still', fps: 30, startFrame: 0, endFrame: 1, tracks: [] };
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/assembly/animation/verify', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'animation-recovery-test' },
      body: JSON.stringify({ state, animation, localBoxes: { p: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } } } }),
    }));
    expect(await response.json()).toMatchObject({
      ok: true, releaseReady: false, quoteOrRfqSideEffects: false,
      ccdRecovery: { exhausted: false, attempts: [{ rotationalMaxDepth: 6, unresolvedAfter: 0 }] },
      precise: { status: 'not_run', failureCodes: ['COLLISION_GEOMETRY_MISSING'], recovery: [{ automaticRepair: 'collision-refine', retryable: true, releaseBlocking: true }] },
    });
  });

  it('uses mesh separation and motion bounds to clear an AABB-overlapping rotational interval',async()=>{
    const extrude=(id:string,loX:number,hiX:number,loY:number,hiY:number)=>({id,name:id,dependencies:[],payload:{kind:'extrude',loop:[{x:loX,y:loY},{x:hiX,y:loY},{x:hiX,y:hiY},{x:loX,y:hiY}],depth:10,direction:'one_sided',mode:'add'}});
    const state={parts:[{id:'l',name:'l',partTemplateId:'l',position:{x:0,y:0,z:0},orientation:IDENTITY_QUAT},{id:'pin',name:'pin',partTemplateId:'pin',position:{x:15,y:15,z:0},orientation:IDENTITY_QUAT}],mates:[]};
    const animation={version:1,name:'small rotation',fps:30,startFrame:0,endFrame:10,tracks:[{id:'l-track',targetPartId:'l',keyframes:[{frame:0,orientation:IDENTITY_QUAT},{frame:10,orientation:{x:0,y:0,z:Math.sin(.001/2),w:Math.cos(.001/2)}}]}]};
    const body={state,animation,frameStep:10,rotationalMaxDepth:0,localBoxes:{l:{min:{x:0,y:0,z:0},max:{x:30,y:30,z:10}},pin:{min:{x:0,y:0,z:0},max:{x:10,y:10,z:10}}},featureTrees:{l:{nodes:[extrude('bar-x',0,30,0,10),extrude('bar-y',0,10,10,30)]},pin:{nodes:[extrude('pin-body',0,10,0,10)]}}};
    const response=await POST(new NextRequest('http://localhost/api/cad/v1/assembly/animation/verify',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'animation-mesh-distance-test'},body:JSON.stringify(body)}));const json=await response.json();
    expect(json.broad.continuous.unresolved.length).toBeGreaterThan(0);
    expect(json.precise.continuous.intervals.every((item:{status:string})=>item.status==='proven_clear')).toBe(true);
    expect(json).toMatchObject({releaseReady:true,precise:{status:'completed',collisionFree:true,failureCodes:[]}});
  });

  it('removes an exact swept-AABB false positive only after continuous mesh-distance proof',async()=>{
    const extrude=(id:string,loX:number,hiX:number,loY:number,hiY:number)=>({id,name:id,dependencies:[],payload:{kind:'extrude',loop:[{x:loX,y:loY},{x:hiX,y:loY},{x:hiX,y:hiY},{x:loX,y:hiY}],depth:10,direction:'one_sided',mode:'add'}});
    const state={parts:[{id:'l',name:'l',partTemplateId:'l',position:{x:0,y:0,z:0},orientation:IDENTITY_QUAT},{id:'pin',name:'pin',partTemplateId:'pin',position:{x:15,y:15,z:0},orientation:IDENTITY_QUAT}],mates:[]};
    const animation={version:1,name:'linear cavity motion',fps:30,startFrame:0,endFrame:10,tracks:[{id:'pin-track',targetPartId:'pin',keyframes:[{frame:0,position:{x:15,y:15,z:0}},{frame:10,position:{x:15.1,y:15,z:0}}]}]};
    const body={state,animation,frameStep:10,localBoxes:{l:{min:{x:0,y:0,z:0},max:{x:30,y:30,z:10}},pin:{min:{x:0,y:0,z:0},max:{x:10,y:10,z:10}}},featureTrees:{l:{nodes:[extrude('bar-x',0,30,0,10),extrude('bar-y',0,10,10,30)]},pin:{nodes:[extrude('pin-body',0,10,0,10)]}}};
    const response=await POST(new NextRequest('http://localhost/api/cad/v1/assembly/animation/verify',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'animation-linear-mesh-test'},body:JSON.stringify(body)})),json=await response.json();
    expect(json.broad.continuous.candidates.some((item:{method:string})=>item.method==='exact-linear-aabb')).toBe(true);
    expect(json.precise.continuous.linear).toMatchObject([{status:'proven_clear'}]);
    expect(json).toMatchObject({releaseReady:true,precise:{collisionFree:true,failureCodes:[]}});
  });
  it('returns a bounded earliest mesh collision time and fails closed when TOI budget is insufficient',async()=>{
    const tree=(id:string,w:number)=>({nodes:[{id,name:id,dependencies:[],payload:{kind:'extrude',loop:[{x:-w,y:-.1},{x:w,y:-.1},{x:w,y:.1},{x:-w,y:.1}],depth:.2,direction:'one_sided',mode:'add'}}]});
    const state={parts:[{id:'bar',name:'bar',partTemplateId:'bar',position:{x:0,y:0,z:0},orientation:IDENTITY_QUAT},{id:'pin',name:'pin',partTemplateId:'pin',position:{x:-10,y:0,z:0},orientation:IDENTITY_QUAT}],mates:[]};
    const animation={version:1,name:'tunnel',fps:30,startFrame:0,endFrame:10,tracks:[{id:'pin-track',targetPartId:'pin',keyframes:[{frame:0,position:{x:-10,y:0,z:0}},{frame:10,position:{x:10,y:0,z:0}}]}]};
    const base={state,animation,frameStep:10,localBoxes:{bar:{min:{x:-5,y:-.1,z:0},max:{x:5,y:.1,z:.2}},pin:{min:{x:-.1,y:-.1,z:0},max:{x:.1,y:.1,z:.2}}},featureTrees:{bar:tree('bar-body',5),pin:tree('pin-body',.1)},toiFrameTolerance:1e-3,toiMaxDepth:20};
    const response=await POST(new NextRequest('http://localhost/api/cad/v1/assembly/animation/verify',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'animation-toi-test'},body:JSON.stringify(base)})),json=await response.json();
    expect(json).toMatchObject({releaseReady:false,precise:{collisionFree:false,continuous:{timeOfImpact:[{partA:'bar',partB:'pin',status:'collision_bracket'}]}}});expect(json.precise.continuous.timeOfImpact[0].bracketWidthFrames).toBeLessThanOrEqual(1e-3);
    const limited=await(await POST(new NextRequest('http://localhost/api/cad/v1/assembly/animation/verify',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'animation-toi-budget-test'},body:JSON.stringify({...base,toiMaxEvaluations:2})}))).json();
    expect(limited.precise).toMatchObject({failureCodes:expect.arrayContaining(['PRECISE_TOI_UNRESOLVED']),continuous:{timeOfImpact:[{status:'unresolved',reason:expect.stringContaining('budget 2 exceeded')}]}});
  });
});
