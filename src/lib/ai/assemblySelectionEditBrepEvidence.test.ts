// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planAssemblySelectionEdit } from './assemblySelectionEdit';
import { verifyAssemblySelectionEditBrep } from './assemblySelectionEditBrepEvidence';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';

const state: AssemblyState = {
  parts: [{ id:'p', name:'Plate', partTemplateId:'p', position:{x:0,y:0,z:0}, orientation:{x:0,y:0,z:0,w:1}, fixed:true }],
  mates: [],
};
const featureTrees: Record<string, FeatureTree> = { p: { nodes: [{
  id:'e', name:'Base', dependencies:[],
  payload:{ kind:'extrude', loop:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], depth:5, direction:'one_sided', mode:'add' },
}] } };

describe('verifyAssemblySelectionEditBrep', () => {
  it('promotes an extrude-depth estimate to exact, valid OCCT evidence', async () => {
    const preview = planAssemblySelectionEdit({ state, featureTrees, selection:[{partId:'p',refId:'f.cap.top',refKind:'face'}], command:'depth 8mm' });
    const exact = await verifyAssemblySelectionEditBrep(preview, featureTrees);
    expect(exact.evidence).toMatchObject({
      method:'exact-brep', topologyValidation:'passed',
      before:{solidCount:1,faceCount:6,edgeCount:12,valid:true},
      after:{solidCount:1,faceCount:6,edgeCount:12,valid:true},
    });
    expect(exact.evidence!.before.volumeMm3).toBeCloseTo(500, 9);
    expect(exact.evidence!.after.volumeMm3).toBeCloseTo(800, 9);
    expect(exact.evidence!.deltaVolumeMm3).toBeCloseTo(300, 9);
  }, 60_000);

  it('fails closed when either tree contains an unsupported OCCT node', async () => {
    const preview = planAssemblySelectionEdit({ state, featureTrees, selection:[{partId:'p',refId:'f.cap.top',refKind:'face'}], command:'depth 8mm' });
    const edited = preview.nextFeatureTrees.p!;
    preview.nextFeatureTrees.p = { ...edited, nodes:[...edited.nodes, { id:'pat', name:'pattern', dependencies:['e'], payload:{kind:'linear_pattern',childScad:'cube(1);',count:2,direction:{x:1,y:0,z:0},spacing:2} }] };
    const exact = await verifyAssemblySelectionEditBrep(preview, featureTrees);
    expect(exact.evidence).toMatchObject({method:'exact-brep',topologyValidation:'failed'});
    expect(exact.evidence?.kernelError).toMatch(/unsupported/);
  });

  it('verifies an exact selected side-face offset in the real kernel', async () => {
    const preview = planAssemblySelectionEdit({ state, featureTrees, selection:[{partId:'p',refId:'f.side.1',refKind:'face'}], command:'face offset 2mm' });
    const exact = await verifyAssemblySelectionEditBrep(preview, featureTrees);
    expect(exact.evidence).toMatchObject({method:'exact-brep',topologyValidation:'passed',before:{faceCount:6,valid:true},after:{faceCount:6,valid:true}});
    expect(exact.evidence!.deltaVolumeMm3).toBeCloseTo(100,9);
  },60_000);

  it('verifies bottom-cap movement with an unchanged top plane', async () => {
    const preview = planAssemblySelectionEdit({ state, featureTrees, selection:[{partId:'p',refId:'f.cap.bottom',refKind:'face'}], command:'face offset 2mm' });
    const exact = await verifyAssemblySelectionEditBrep(preview, featureTrees);
    expect(exact.evidence).toMatchObject({method:'exact-brep',topologyValidation:'passed',after:{valid:true}});
    expect(exact.evidence!.after.volumeMm3).toBeCloseTo(300,9);
    expect(exact.evidence!.after.bbox.min.z).toBeCloseTo(2,5);
    expect(exact.evidence!.after.bbox.max.z).toBeCloseTo(5,5);
  },60_000);

  it('verifies a cylindrical revolve side offset in the real kernel',async()=>{
    const revolveTrees:Record<string,FeatureTree>={p:{nodes:[{id:'r',name:'Cylinder',dependencies:[],payload:{kind:'revolve',loop:[{x:0,y:0},{x:10,y:0},{x:10,y:20},{x:0,y:20}],angleDegrees:360,mode:'add'}}]}};
    const preview=planAssemblySelectionEdit({state,featureTrees:revolveTrees,selection:[{partId:'p',refId:'f.side.1',refKind:'face'}],command:'face offset 2mm'});
    const exact=await verifyAssemblySelectionEditBrep(preview,revolveTrees);
    expect(exact.evidence).toMatchObject({method:'exact-brep',topologyValidation:'passed',before:{valid:true},after:{valid:true}});
    expect(exact.evidence!.before.volumeMm3).toBeCloseTo(Math.PI*100*20,5);
    expect(exact.evidence!.after.volumeMm3).toBeCloseTo(Math.PI*144*20,5);
  },60_000);

  it('replays a boolean after editing an inherited source face',async()=>{
    const booleanTrees:Record<string,FeatureTree>={p:{nodes:[
      {id:'base',name:'Base',dependencies:[],payload:{kind:'extrude',loop:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],depth:5,direction:'one_sided',mode:'add'}},
      {id:'tool',name:'Tool',dependencies:[],payload:{kind:'extrude',loop:[{x:2,y:2},{x:4,y:2},{x:4,y:4},{x:2,y:4}],depth:7,direction:'one_sided',mode:'add'}},
      {id:'cut',name:'Cut',dependencies:['base','tool'],payload:{kind:'boolean',op:'difference',bodies:['base','tool']}},
    ]}};
    const preview=planAssemblySelectionEdit({state,featureTrees:booleanTrees,selection:[{partId:'p',refId:'base/f.side.1',refKind:'face'}],command:'face offset 2mm'});
    const exact=await verifyAssemblySelectionEditBrep(preview,booleanTrees);
    expect(exact.evidence).toMatchObject({method:'exact-brep',topologyValidation:'passed',before:{valid:true},after:{valid:true}});
    expect(exact.evidence!.deltaVolumeMm3).toBeCloseTo(100,6);
  },60_000);
});
