import{describe,expect,it}from'vitest';import{classifyFeatureTopologyPick}from'./featureTopologyPick';
const tree={id:'p',version:1 as const,nodes:[{id:'h',name:'Hole',parentId:null,dependencies:[],payload:{kind:'hole' as const,center:{x:5,y:7},holeType:'drilled' as const,diameter:10,depth:20}}]};
describe('feature topology pick',()=>{it('maps a tessellated hole wall to its persistent axis',()=>expect(classifyFeatureTopologyPick(tree,{x:10,y:7,z:-5},'face')).toEqual({refId:'hole_axis_0',refKind:'axis'}));it('does not guess away from the analytic cylinder',()=>expect(classifyFeatureTopologyPick(tree,{x:8,y:7,z:-5},'face')).toBeNull());});

const extrude={id:'box',version:1 as const,nodes:[{id:'e',name:'Extrude',parentId:null,dependencies:[],payload:{kind:'extrude' as const,loop:[{x:0,y:0},{x:10,y:0},{x:10,y:20},{x:0,y:20}],depth:5,mode:'add' as const,direction:'one_sided' as const}}]};
describe('extrude provenance pick',()=>{it('uses stable cap and side face names',()=>{expect(classifyFeatureTopologyPick(extrude,{x:3,y:3,z:5},'face')?.refId).toBe('f.cap.top');expect(classifyFeatureTopologyPick(extrude,{x:10,y:8,z:2},'face')?.refId).toBe('f.side.1');});it('uses stable edge and vertex names',()=>{expect(classifyFeatureTopologyPick(extrude,{x:10,y:20,z:2},'edge')?.refId).toBe('e.vert.2');expect(classifyFeatureTopologyPick(extrude,{x:0,y:0,z:0},'point')?.refId).toBe('v.bottom.0');});});

it('picks caps at a relocated extrude profile plane',()=>{
  const moved={...extrude,nodes:extrude.nodes.map(node=>({...node,payload:{...node.payload,profileOffsetZ:2,depth:3}}))};
  expect(classifyFeatureTopologyPick(moved,{x:3,y:3,z:2},'face')?.refId).toBe('f.cap.bottom');
  expect(classifyFeatureTopologyPick(moved,{x:3,y:3,z:5},'face')?.refId).toBe('f.cap.top');
});

const revolve=(angleDegrees:number)=>({id:'rev',version:1 as const,nodes:[{id:'r',name:'Revolve',parentId:null,dependencies:[],payload:{kind:'revolve' as const,loop:[{x:0,y:0},{x:10,y:0},{x:10,y:20},{x:0,y:20}],angleDegrees,mode:'add' as const}}]});
describe('revolve provenance pick',()=>{it('maps a cylindrical wall and latitude to stable names',()=>{expect(classifyFeatureTopologyPick(revolve(360),{x:10,y:10,z:0},'face')?.refId).toBe('f.side.1');expect(classifyFeatureTopologyPick(revolve(360),{x:-10,y:20,z:0},'edge')?.refId).toBe('e.lat.2');});it('keeps partial caps distinct and does not invent them for full revolves',()=>{expect(classifyFeatureTopologyPick(revolve(90),{x:5,y:10,z:0},'face')?.refId).toBe('f.cap.start');expect(classifyFeatureTopologyPick(revolve(360),{x:5,y:10,z:0},'face')).toBeNull();});});
