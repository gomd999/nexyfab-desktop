import type { RobotEngineeringSpec, RobotJointSpec } from './robotEngineering';

export type RobotTargetPose = { positionMm: [number, number, number]; rotation: [number, number, number, number, number, number, number, number, number] };
export type IkResult = { success: boolean; anglesDeg: number[]; iterations: number; positionErrorMm: number; orientationErrorRad: number; reason?: 'unreachable' | 'joint_limit' | 'singular' };
export function robotForwardPose(spec: RobotEngineeringSpec, anglesDeg: number[]): RobotTargetPose { const x = pose(spec.joints, anglesDeg); return { positionMm: x.p as [number, number, number], rotation: x.r.flat() as RobotTargetPose['rotation'] }; }

export function solveRobotIk(spec: RobotEngineeringSpec, target: RobotTargetPose, seedDeg = spec.joints.map(j => (j.minDeg + j.maxDeg) / 2), maxIterations = 120): IkResult {
  if (spec.joints.length !== 6) throw new Error('IK requires six joints');
  let q = seedDeg.map((v, i) => clamp(v, spec.joints[i]!.minDeg, spec.joints[i]!.maxDeg)); let hitLimit = false;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const current = pose(spec.joints, q); const error = poseError(current, target); const pe = norm(error.slice(0, 3)); const oe = norm(error.slice(3));
    if (pe < 0.1 && oe < 1e-3) return { success: true, anglesDeg: q, iterations: iteration, positionErrorMm: pe, orientationErrorRad: oe };
    const j = numericalJacobian(spec.joints, q); const jj = mul(j, transpose(j)); for (let i=0;i<6;i++) jj[i]![i]! += 0.04;
    const y = solve(jj, error); if (!y) return { success: false, anglesDeg: q, iterations: iteration, positionErrorMm: pe, orientationErrorRad: oe, reason: 'singular' };
    const dq = matVec(transpose(j), y).map(v => clamp(v, -0.15, 0.15) * 180 / Math.PI);
    q = q.map((v, i) => { const next = clamp(v + dq[i]!, spec.joints[i]!.minDeg, spec.joints[i]!.maxDeg); if (next !== v + dq[i]!) hitLimit = true; return next; });
  }
  const e = poseError(pose(spec.joints, q), target); return { success: false, anglesDeg: q, iterations: maxIterations, positionErrorMm: norm(e.slice(0,3)), orientationErrorRad: norm(e.slice(3)), reason: hitLimit ? 'joint_limit' : 'unreachable' };
}

export function buildReachabilityMap(spec: RobotEngineeringSpec, targets: readonly RobotTargetPose[]): { reachable: number; unreachable: number; results: IkResult[] } {
  const results = targets.map(target => solveRobotIk(spec, target)); return { reachable: results.filter(r => r.success).length, unreachable: results.filter(r => !r.success).length, results };
}

type Pose = { p: number[]; r: number[][] };
function pose(joints: RobotJointSpec[], q: number[]): Pose { let t=identity(); joints.forEach((j,i)=>{t=mul4(t,dh(j.aMm,j.alphaDeg,j.dMm,q[i]!+(j.thetaOffsetDeg??0)));}); return {p:[t[3]!,t[7]!,t[11]!],r:[[t[0]!,t[1]!,t[2]!],[t[4]!,t[5]!,t[6]!],[t[8]!,t[9]!,t[10]!]]}; }
function poseError(current: Pose, target: RobotTargetPose): number[] { const rt=[target.rotation.slice(0,3),target.rotation.slice(3,6),target.rotation.slice(6,9)]; const re=mul3(rt,transpose(current.r)); return [target.positionMm[0]-current.p[0]!,target.positionMm[1]-current.p[1]!,target.positionMm[2]-current.p[2]!, (re[2]![1]!-re[1]![2]!)/2,(re[0]![2]!-re[2]![0]!)/2,(re[1]![0]!-re[0]![1]!)/2]; }
function numericalJacobian(joints: RobotJointSpec[],q:number[]):number[][]{const base=pose(joints,q);const j=Array.from({length:6},()=>Array(6).fill(0) as number[]);for(let c=0;c<6;c++){const p=[...q];p[c]!+=1e-4;const e=poseError(base,{positionMm:pose(joints,p).p as [number,number,number],rotation:pose(joints,p).r.flat() as RobotTargetPose['rotation']});for(let r=0;r<6;r++)j[r]![c]=e[r]!/(1e-4*Math.PI/180);}return j;}
function dh(a:number,ad:number,d:number,td:number){const A=ad*Math.PI/180,T=td*Math.PI/180,c=Math.cos(T),s=Math.sin(T),ca=Math.cos(A),sa=Math.sin(A);return[c,-s*ca,s*sa,a*c,s,c*ca,-c*sa,a*s,0,sa,ca,d,0,0,0,1];}
function identity(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];}
function mul4(a:number[],b:number[]){const o=Array(16).fill(0) as number[];for(let r=0;r<4;r++)for(let c=0;c<4;c++)for(let k=0;k<4;k++)o[r*4+c]!+=a[r*4+k]!*b[k*4+c]!;return o;}
function transpose(a:number[][]){return a[0]!.map((_,i)=>a.map(r=>r[i]!));} function mul(a:number[][],b:number[][]){return a.map(r=>b[0]!.map((_,c)=>r.reduce((s,v,k)=>s+v*b[k]![c]!,0)));} function mul3(a:number[][],b:number[][]){return mul(a,b);} function matVec(a:number[][],v:number[]){return a.map(r=>r.reduce((s,x,i)=>s+x*v[i]!,0));}
function solve(a:number[][],b:number[]){const m=a.map((r,i)=>[...r,b[i]!]);for(let c=0;c<6;c++){let p=c;for(let r=c+1;r<6;r++)if(Math.abs(m[r]![c]!)>Math.abs(m[p]![c]!))p=r;if(Math.abs(m[p]![c]!)<1e-12)return null;[m[c],m[p]]=[m[p]!,m[c]!];const v=m[c]![c]!;for(let k=c;k<7;k++)m[c]![k]/=v;for(let r=0;r<6;r++)if(r!==c){const f=m[r]![c]!;for(let k=c;k<7;k++)m[r]![k]-=f*m[c]![k]!;}}return m.map(r=>r[6]!);}
function norm(v:number[]){return Math.hypot(...v);} function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v));}
