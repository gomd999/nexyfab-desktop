import { describe, expect, it } from 'vitest';
import { planJointRobotPath } from './robotPathPlanning';
import type { RobotEngineeringSpec } from './robotEngineering';

const spec: RobotEngineeringSpec = { payloadKg: 1, joints: Array.from({length:6},()=>({ aMm:100, alphaDeg:0, dMm:20, minDeg:-180, maxDeg:180, motorTorqueNm:2, gearRatio:50, efficiency:.8, linkMassKg:1, cableDiameterMm:5, routingRadiusMm:40, maxCableTwistDeg:400, maxVelocityDegS:60, maxAccelerationDegS2:120, maxJerkDegS3:600 })) };
describe('robot path planning',()=>{
  it('time-scales a continuous path within limits',()=>{ const r=planJointRobotPath(spec,[[0,0,0,0,0,0],[30,-20,10,5,0,-5]]); expect(r.success).toBe(true); expect(r.frames.length).toBeGreaterThan(2); expect(r.collisionVerified).toBe(false); });
  it('fails closed on joint limits',()=>{ expect(planJointRobotPath(spec,[[0,0,0,0,0,0],[181,0,0,0,0,0]]).reason).toBe('joint_limit'); });
  it('reports injected collision evidence',()=>{ const r=planJointRobotPath(spec,[[0,0,0,0,0,0],[10,0,0,0,0,0]],{collisionCheck:q=>({collision:q[0]!>5,detail:'fixture'})}); expect(r.reason).toBe('collision'); expect(r.collisionVerified).toBe(true); });
  it('checks the swept interval instead of trusting collision-free endpoints',()=>{
    const r=planJointRobotPath(spec,[[0,0,0,0,0,0],[10,0,0,0,0,0]],{
      collisionCheck: ()=>({ collision: false }),
      sweptCollisionCheck: (from,to)=>({
        collision: from[0]! <= 5 && to[0]! >= 5 && from[0] !== to[0],
        detail: 'swept-fixture',
      }),
    });
    expect(r.reason).toBe('collision');
    expect(r.continuousCollisionVerified).toBe(true);
    expect(r.continuousCollisionFree).toBe(false);
    expect(r.errors.some(error=>error.includes('Swept collision'))).toBe(true);
  });
  it('keeps continuous coverage explicitly unknown when no swept checker is supplied',()=>{
    const r=planJointRobotPath(spec,[[0,0,0,0,0,0],[10,0,0,0,0,0]]);
    expect(r.continuousCollisionVerified).toBe(false);
    expect(r.continuousCollisionFree).toBe(null);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -0.01])('fails closed for invalid sample period %s',(samplePeriodS)=>{
    const r=planJointRobotPath(spec,[[0,0,0,0,0,0],[10,0,0,0,0,0]],{ samplePeriodS });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('invalid_path');
    expect(r.frames).toEqual([]);
  });
});
