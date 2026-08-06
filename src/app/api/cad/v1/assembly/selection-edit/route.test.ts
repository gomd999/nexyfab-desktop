import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST } from './route';
import { createGenerationRun } from '@/lib/ai/generationRunState';

const body = {
  state: { parts: [{ id:'p', name:'Plate', partTemplateId:'p', position:{x:0,y:0,z:0}, orientation:{x:0,y:0,z:0,w:1}, fixed:true }], mates:[] },
  featureTrees: { p: { nodes: [{ id:'e', name:'Base', dependencies:[], payload:{ kind:'extrude', loop:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], depth:5, direction:'one_sided', mode:'add' } }] } },
  selection: [{ partId:'p', refId:'f.side.0', refKind:'face' }],
  command: '깊이 8mm 그리고 드래프트 4도',
};

describe('assembly selection edit API',()=>{
  it('returns one deterministic atomic batch and fail-closed evidence status',async()=>{
    const response=await POST(new NextRequest('http://localhost/api/cad/v1/assembly/selection-edit',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'selection-edit-test'},body:JSON.stringify(body)}));
    const json=await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ok:true,deterministic:true,quoteOrRfqSideEffects:false,preview:{transaction:{operations:[{kind:'set_feature_parameter'},{kind:'set_feature_parameter'}]},evidence:{method:'feature-tree-estimate',deltaVolumeMm3:300,topologyValidation:'not_run'}}});
  });

  it('rejects invalid edits instead of returning a partial first result',async()=>{
    const response=await POST(new NextRequest('http://localhost/api/cad/v1/assembly/selection-edit',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'selection-edit-test-fail'},body:JSON.stringify({...body,command:'깊이 8mm 그리고 쉘 두께 9mm'})}));
    const json=await response.json();
    expect(response.status).toBe(422);
    expect(json).toMatchObject({ok:false,code:'UNSUPPORTED_EDIT'});
    expect(json.preview).toBeUndefined();
  });

  it('optionally returns exact OCCT B-rep evidence',async()=>{
    const response=await POST(new NextRequest('http://localhost/api/cad/v1/assembly/selection-edit',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'selection-edit-test-brep'},body:JSON.stringify({...body,command:'depth 8mm',selection:[{partId:'p',refId:'f.cap.top',refKind:'face'}],verifyBrep:true})}));
    const json=await response.json();
    expect(response.status).toBe(200);
    expect(json.preview.evidence).toMatchObject({method:'exact-brep',topologyValidation:'passed',before:{valid:true},after:{valid:true}});
    expect(json.preview.evidence.deltaVolumeMm3).toBeCloseTo(300,9);
  },60_000);

  it('returns the minimally invalidated generation state for a selected feature edit',async()=>{
    const generationState=createGenerationRun('selection-edit-run');
    const response=await POST(new NextRequest('http://localhost/api/cad/v1/assembly/selection-edit',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'selection-edit-generation'},body:JSON.stringify({...body,generationState})}));
    const json=await response.json();
    expect(json.generationState).toMatchObject({revision:1,stages:{part_programs:{status:'pending'},kernel:{status:'not_run',affectedPartIds:['p']},release:{status:'not_run'}}});
  });
});
