// @vitest-environment node
import{describe,expect,it}from'vitest';import{NextRequest}from'next/server';import{POST}from'./route';import{loadOcctNode}from'@/lib/occt/nodeOcctLoader';import{createNodeOcctBridge}from'@/lib/occt/nodeOcctBridge';
describe('B-rep push/pull API',()=>{it('edits an imported planar STEP face and returns exact evidence',async()=>{
  const loaded=await loadOcctNode();if(!loaded.ok||!loaded.oc)return;const bridge=createNodeOcctBridge(loaded.oc);const built=await bridge.buildFromExtrude({kind:'extrude',loop:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],depth:5,direction:'one_sided',mode:'add'});const step=await bridge.exportSTEP(built.shape!);bridge.release(built.shape!);
  const response=await POST(new NextRequest('http://localhost/api/cad/v1/brep/push-pull',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'brep-push-test'},body:JSON.stringify({step:Buffer.from(step).toString('base64'),encoding:'base64',faceRef:'f.import.5',distanceMm:2})}));const json=await response.json();
  expect(response.status).toBe(200);expect(json).toMatchObject({ok:true,encoding:'base64',quoteOrRfqSideEffects:false,evidence:{method:'exact-brep',topologyValidation:'passed'}});expect(json.evidence.deltaVolumeMm3).toBeCloseTo(100,1);expect(typeof json.step).toBe('string');
},60_000);});
