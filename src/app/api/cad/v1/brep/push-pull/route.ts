import {NextRequest,NextResponse}from'next/server';
import{getTrustedClientIp}from'@/lib/client-ip';
import{rateLimit}from'@/lib/rate-limit';
import{loadOcctNode}from'@/lib/occt/nodeOcctLoader';
import{createNodeOcctBridge}from'@/lib/occt/nodeOcctBridge';
export const runtime='nodejs';export const dynamic='force-dynamic';

export async function POST(req:NextRequest){
  const ip=getTrustedClientIp(req.headers);if(!rateLimit(`cad-v1-brep-push-pull:${ip}`,20,60_000).allowed)return NextResponse.json({ok:false,code:'RATE_LIMIT'},{status:429});
  const body=await req.json().catch(()=>null)as{step?:string;encoding?:'base64'|'utf8';faceRef?:string;distanceMm?:number}|null;
  if(!body||typeof body.step!=='string'||body.step.length===0||body.step.length>30_000_000||typeof body.faceRef!=='string'||!Number.isFinite(body.distanceMm)||body.distanceMm===0)return NextResponse.json({ok:false,code:'BAD_REQUEST',message:'step, faceRef and non-zero distanceMm are required'},{status:400});
  try{
    const source=body.encoding==='base64'?Buffer.from(body.step,'base64').toString('utf8'):body.step;
    const loaded=await loadOcctNode();if(!loaded.ok||!loaded.oc)throw new Error(`OCCT unavailable: ${loaded.reason??'load failed'}`);
    const bridge=createNodeOcctBridge(loaded.oc);if(!bridge.pushPullFace||!bridge.inspectShape||!bridge.listFaceRefs)throw new Error('OCCT bridge lacks imported B-rep push/pull');
    const imported=await bridge.importSTEP(source);if(!imported.ok||!imported.shape)throw new Error(imported.error??'STEP import failed');
    const beforeShape=imported.shape;
    try{
      const before={volumeMm3:beforeShape.volume,bbox:beforeShape.bbox,...await bridge.inspectShape(beforeShape),faceRefs:await bridge.listFaceRefs(beforeShape)};
      const moved=await bridge.pushPullFace(beforeShape,body.faceRef,body.distanceMm!);if(!moved.ok||!moved.shape)throw new Error(moved.error??'push/pull failed');
      try{
        const after={volumeMm3:moved.shape.volume,bbox:moved.shape.bbox,...await bridge.inspectShape(moved.shape),faceRefs:await bridge.listFaceRefs(moved.shape)};
        const step=Buffer.from(await bridge.exportSTEP(moved.shape),'utf8').toString('base64');
        return NextResponse.json({ok:true,step,encoding:'base64',faceRef:body.faceRef,distanceMm:body.distanceMm,evidence:{method:'exact-brep',topologyValidation:after.valid?'passed':'failed',before,after,deltaVolumeMm3:(after.volumeMm3??0)-(before.volumeMm3??0)},quoteOrRfqSideEffects:false});
      }finally{bridge.release(moved.shape);}
    }finally{bridge.release(beforeShape);}
  }catch(error){return NextResponse.json({ok:false,code:'BREP_PUSH_PULL_FAILED',message:error instanceof Error?error.message:String(error)},{status:422});}
}
