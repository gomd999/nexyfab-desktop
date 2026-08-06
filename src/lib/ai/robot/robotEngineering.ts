export type RobotJointSpec = {
  aMm: number; alphaDeg: number; dMm: number; thetaOffsetDeg?: number;
  minDeg: number; maxDeg: number; motorTorqueNm: number; gearRatio: number; efficiency: number;
  linkMassKg: number; cableDiameterMm: number; routingRadiusMm: number; maxCableTwistDeg: number;
  requiredOutputRpm?: number; radialLoadN?: number; minShaftDiameterMm?: number;
  maxVelocityDegS?: number; maxAccelerationDegS2?: number; maxJerkDegS3?: number;
};
export type RobotEngineeringSpec = { joints: RobotJointSpec[]; payloadKg: number; samples?: number };
export type RobotEngineeringReport = {
  designOk: boolean; workspace: { min: Vec3; max: Vec3; sampledPoses: number };
  singularities: { count: number; worstRank: number };
  selfCollision: { count: number; firstPose: number | null };
  torque: Array<{ joint: number; requiredNm: number; availableNm: number; passed: boolean }>;
  cables: Array<{ joint: number; bendPassed: boolean; twistPassed: boolean; requiredBendRadiusMm: number }>;
  errors: string[];
};
type Vec3 = { x: number; y: number; z: number };
type Mat4 = number[];

export function verifyRobotEngineering(spec: RobotEngineeringSpec): RobotEngineeringReport {
  if (spec.joints.length !== 6) throw new Error('A 6-axis robot requires exactly six revolute joints.');
  const poses = samplePoses(spec.joints, spec.samples ?? 64);
  const points = poses.map(pose => forward(spec.joints, pose));
  const ends = points.map(chain => chain[chain.length - 1]!);
  const workspace = bounds(ends);
  let singularCount = 0; let worstRank = 6; let collisions = 0; let firstPose: number | null = null;
  const required = Array(6).fill(0) as number[];
  poses.forEach((pose, poseIndex) => {
    const rank = jacobianRank(spec.joints, pose); worstRank = Math.min(worstRank, rank); if (rank < 6) singularCount += 1;
    if (hasSelfCollision(points[poseIndex]!)) { collisions += 1; firstPose ??= poseIndex; }
    for (let j = 0; j < 6; j += 1) required[j] = Math.max(required[j]!, Math.abs(gravityTorque(spec, pose, j)));
  });
  const torque = spec.joints.map((joint, index) => ({ joint: index + 1, requiredNm: required[index]!, availableNm: joint.motorTorqueNm * joint.gearRatio * joint.efficiency, passed: required[index]! <= joint.motorTorqueNm * joint.gearRatio * joint.efficiency }));
  const cables = spec.joints.map((joint, index) => ({ joint: index + 1, bendPassed: joint.routingRadiusMm >= joint.cableDiameterMm * 6, twistPassed: joint.maxDeg - joint.minDeg <= joint.maxCableTwistDeg, requiredBendRadiusMm: joint.cableDiameterMm * 6 }));
  const errors = [
    ...(collisions ? [`Self-collision found in ${collisions} sampled pose(s).`] : []),
    ...torque.filter(x => !x.passed).map(x => `J${x.joint} output torque is insufficient.`),
    ...cables.filter(x => !x.bendPassed || !x.twistPassed).map(x => `J${x.joint} cable routing violates bend or twist limit.`),
  ];
  return { designOk: errors.length === 0, workspace: { ...workspace, sampledPoses: poses.length }, singularities: { count: singularCount, worstRank }, selfCollision: { count: collisions, firstPose }, torque, cables, errors };
}

export function forward(joints: RobotJointSpec[], anglesDeg: number[]): Vec3[] {
  let t = identity(); const points: Vec3[] = [{ x: 0, y: 0, z: 0 }];
  joints.forEach((joint, index) => { t = mul(t, dh(joint.aMm, joint.alphaDeg, joint.dMm, anglesDeg[index]! + (joint.thetaOffsetDeg ?? 0))); points.push({ x: t[3]!, y: t[7]!, z: t[11]! }); });
  return points;
}
function samplePoses(joints: RobotJointSpec[], count: number): number[][] {
  const poses = [joints.map(() => 0)];
  for (let i = 1; i < count; i += 1) poses.push(joints.map((joint, axis) => joint.minDeg + halton(i, [2, 3, 5, 7, 11, 13][axis]!) * (joint.maxDeg - joint.minDeg)));
  return poses;
}
function halton(index: number, base: number) { let f = 1; let r = 0; for (let i = index; i > 0; i = Math.floor(i / base)) { f /= base; r += f * (i % base); } return r; }
function jacobianRank(joints: RobotJointSpec[], pose: number[]): number {
  const base = forward(joints, pose).at(-1)!; const m = Array.from({ length: 6 }, () => Array(6).fill(0) as number[]);
  for (let c = 0; c < 6; c += 1) { const p = [...pose]; p[c]! += 1e-4; const e = forward(joints, p).at(-1)!; m[0]![c] = (e.x - base.x) / (1e-4 * Math.PI / 180); m[1]![c] = (e.y - base.y) / (1e-4 * Math.PI / 180); m[2]![c] = (e.z - base.z) / (1e-4 * Math.PI / 180); }
  const axes = jointAxes(joints, pose); axes.forEach((a, c) => { m[3]![c] = a.x; m[4]![c] = a.y; m[5]![c] = a.z; });
  return rank(m);
}
function jointAxes(joints: RobotJointSpec[], pose: number[]): Vec3[] { let t = identity(); const out: Vec3[] = []; joints.forEach((j, i) => { out.push({ x: t[2]!, y: t[6]!, z: t[10]! }); t = mul(t, dh(j.aMm, j.alphaDeg, j.dMm, pose[i]! + (j.thetaOffsetDeg ?? 0))); }); return out; }
function gravityTorque(spec: RobotEngineeringSpec, pose: number[], joint: number): number {
  const energy = (angles: number[]) => { const chain = forward(spec.joints, angles); let u = spec.payloadKg * 9.80665 * chain.at(-1)!.z / 1000; for (let i = joint; i < 6; i += 1) u += spec.joints[i]!.linkMassKg * 9.80665 * ((chain[i]!.z + chain[i + 1]!.z) / 2) / 1000; return u; };
  const d = 1e-3; const p = [...pose]; const n = [...pose]; p[joint]! += d; n[joint]! -= d; return (energy(p) - energy(n)) / (2 * d * Math.PI / 180);
}
function hasSelfCollision(points: Vec3[]): boolean { for (let i = 0; i < points.length - 1; i += 1) for (let j = i + 2; j < points.length - 1; j += 1) if (!(i === 0 && j === points.length - 2) && segmentDistance(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!) < 30) return true; return false; }
function segmentDistance(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number { let best = Infinity; for (let i = 0; i <= 10; i += 1) for (let j = 0; j <= 10; j += 1) { const p = lerp(a, b, i / 10); const q = lerp(c, d, j / 10); best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)); } return best; }
function lerp(a: Vec3, b: Vec3, t: number): Vec3 { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
function bounds(v: Vec3[]) { return { min: { x: Math.min(...v.map(p => p.x)), y: Math.min(...v.map(p => p.y)), z: Math.min(...v.map(p => p.z)) }, max: { x: Math.max(...v.map(p => p.x)), y: Math.max(...v.map(p => p.y)), z: Math.max(...v.map(p => p.z)) } }; }
function dh(a: number, alphaDeg: number, d: number, thetaDeg: number): Mat4 { const al = alphaDeg * Math.PI / 180; const th = thetaDeg * Math.PI / 180; const c = Math.cos(th), s = Math.sin(th), ca = Math.cos(al), sa = Math.sin(al); return [c,-s*ca,s*sa,a*c,s,c*ca,-c*sa,a*s,0,sa,ca,d,0,0,0,1]; }
function identity(): Mat4 { return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; }
function mul(a: Mat4, b: Mat4): Mat4 { const o = Array(16).fill(0) as number[]; for (let r=0;r<4;r++) for(let c=0;c<4;c++) for(let k=0;k<4;k++) o[r*4+c]! += a[r*4+k]! * b[k*4+c]!; return o; }
function rank(input: number[][]): number { const a=input.map(r=>[...r]); const scale=Math.max(1,...a.flat().map(Math.abs)); let n=0; for(let c=0;c<6&&n<a.length;c++){let p=n;for(let r=n+1;r<a.length;r++)if(Math.abs(a[r]![c]!)>Math.abs(a[p]![c]!))p=r;if(Math.abs(a[p]![c]!)<scale*1e-7)continue;[a[n],a[p]]=[a[p]!,a[n]!];for(let r=n+1;r<a.length;r++){const f=a[r]![c]!/a[n]![c]!;for(let k=c;k<6;k++)a[r]![k]-=f*a[n]![k]!;}n++;}return n; }
