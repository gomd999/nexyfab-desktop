import {describe,expect,it} from 'vitest';
import {verifyCableRoutes} from './robotCableRouting';
import {verifyServiceEnvelopes} from './robotServiceEnvelope';
describe('robot installation verification',()=>{
 it('verifies explicit 3D cable evidence',()=>{const [r]=verifyCableRoutes([{id:'h',diameterMm:5,minBendRadiusMm:20,maxTwistDeg:180,guidePoints:[{x:0,y:0,z:0},{x:30,y:30,z:0},{x:60,y:0,z:0}],twistDeg:90,serviceLoopLengthMm:100,requiredServiceLoopMm:80}]);expect(r!.passed).toBe(true);expect(r!.minimumBendRadiusMm).not.toBeNull();});
 it('fails a missing route and service envelope',()=>{expect(verifyCableRoutes([{id:'h',diameterMm:5,minBendRadiusMm:20,maxTwistDeg:180,guidePoints:[],twistDeg:0}])[0]!.passed).toBe(false);expect(verifyServiceEnvelopes([],[]).verified).toBe(false);});
 it('detects a service obstruction',()=>{const r=verifyServiceEnvelopes([{id:'panel',min:{x:0,y:0,z:0},max:{x:10,y:10,z:10}}],[{id:'wall',min:{x:5,y:5,z:5},max:{x:20,y:20,z:20}}]);expect(r.clear).toBe(false);});
});
