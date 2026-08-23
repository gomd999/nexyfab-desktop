import {NextRequest,NextResponse} from 'next/server';
import type {AssemblyState} from '@/lib/assembly/assemblyState';
import {evaluateAssemblyAnimation,validateAssemblyAnimation,type AssemblyAnimation} from '@/lib/assembly/assemblyAnimation';
import {getTrustedClientIp} from '@/lib/client-ip'; import {rateLimit} from '@/lib/rate-limit';
import {boundedJsonError,readBoundedJson} from '@/lib/boundedJsonBody';
export const runtime='nodejs';export const dynamic='force-dynamic';
const MAX_BODY_BYTES=32*1024*1024;
export async function POST(req:NextRequest){const ip=getTrustedClientIp(req.headers);if(!rateLimit(`cad-v1-animation:${ip}`,60,60_000).allowed)return NextResponse.json({ok:false,code:'RATE_LIMIT'},{status:429});let body:{state?:AssemblyState;animation?:AssemblyAnimation;frame?:number}|null;try{body=await readBoundedJson(req,MAX_BODY_BYTES);}catch(error){if(boundedJsonError(error)?.code==='PAYLOAD_TOO_LARGE')return NextResponse.json({ok:false,code:'PAYLOAD_TOO_LARGE'},{status:413});body=null;}if(!body?.state||!body.animation||typeof body.frame!=='number'||!Number.isFinite(body.frame))return NextResponse.json({ok:false,code:'BAD_REQUEST',message:'state, animation and frame are required'},{status:400});const errors=validateAssemblyAnimation(body.animation,body.state);if(errors.length)return NextResponse.json({ok:false,code:'INVALID_ANIMATION',errors},{status:422});return NextResponse.json({ok:true,frame:body.frame,state:evaluateAssemblyAnimation(body.state,body.animation,body.frame),quoteOrRfqSideEffects:false});}
