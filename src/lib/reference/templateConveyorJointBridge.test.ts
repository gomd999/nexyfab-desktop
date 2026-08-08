// @vitest-environment node
/**
 * B-1/A-L3 — 컨베이어 템플릿 → K6 스윕 인증 실왕복:
 *   1. 브리지가 51부품 전량을 증거+월드 피처트리로 옮기고(제외 0), 롤러 32개에
 *      revolute 를 선언한다
 *   2. bind → plan → clearance certificate 가 **전 회전 스윕 통과**하고 최소
 *      간극이 해석 기대값(롤러-레일 축방향 10mm — 회전축이 +y 라 회전 불변)과
 *      일치한다
 *   3. 변이 실증: 롤러 하나를 레일 쪽으로 20mm 밀면(간극 −10) 스윕이 충돌을
 *      검출한다 — 인증서가 실제 검출기임을 증명
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { collisionGeometryFromFeatureTree } from '@/lib/assembly/featureTreePreciseInterference';
import { adaptCadNativeAssembly } from './cadNativeAssemblyAdapter';
import { planCadNativeJointMotion } from './cadNativeJointMotionPlan';
import { buildJointMotionClearanceCertificate, bindJointsToOccurrences } from './jointMotionClearanceCertificate';
import { bridgeConveyorToJointEvidence, partWorldAabb, type TemplateAssemblyLike } from './templateConveyorJointBridge';

function conveyor(): TemplateAssemblyLike {
  const raw = execFileSync(process.execPath, ['-e', `
    import('./scripts/drawing-to-3d/domain-assemblies.mjs').then(m => {
      const asm = m.buildAssemblyTemplate('mech', 'modular_conveyor_line', {});
      console.log(JSON.stringify({ name: asm.name, parts: asm.parts }));
    });
  `], { encoding: 'utf8', cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(raw.trim().split('\n').pop()!) as TemplateAssemblyLike;
}

async function geometriesOf(bridge: ReturnType<typeof bridgeConveyorToJointEvidence>) {
  const map = new Map<string, Awaited<ReturnType<typeof collisionGeometryFromFeatureTree>>>();
  for (const [occId, tree] of bridge.trees) {
    const geo = await collisionGeometryFromFeatureTree(occId, tree);
    expect(geo.available, `${occId}: ${geo.reason ?? ''}`).toBe(true);
    map.set(occId, geo);
  }
  return map;
}

describe('conveyor → K6 joint sweep certification (B-1/A-L3)', () => {
  const asm = conveyor();

  it('bridges every part (0 excluded) and declares a revolute per roller', () => {
    const bridge = bridgeConveyorToJointEvidence(asm);
    expect(bridge.excluded).toEqual([]);
    expect(bridge.rollerJointIds.length).toBe(32);
    const binding = bindJointsToOccurrences(bridge.evidence);
    expect(binding.status).toBe('pass');
    expect(binding.joints).toHaveLength(32);
  });

  it('full-revolution sweep certifies PASS with the analytic roller↔rail axial gap (10mm)', async () => {
    const bridge = bridgeConveyorToJointEvidence(asm);
    const adapter = adaptCadNativeAssembly(bridge.bundle, bridge.evidence);
    const plan = planCadNativeJointMotion(bridge.evidence, adapter.compiledJointIds);
    expect(plan.status).toBe('pass');
    const certificate = buildJointMotionClearanceCertificate({
      evidence: bridge.evidence, adapter, plan, geometries: await geometriesOf(bridge),
      skipStaticStaticPairs: true, // 정적 맞댐(leg↔rail)은 조립 게이트 소관
    });
    expect(certificate.status).toBe('pass');
    expect(certificate.sweeps.length).toBe(32);
    const minAcross = Math.min(...certificate.sweeps.map(sweep => sweep.minimumClearanceMm ?? Infinity));
    // 해석 기대값: 롤러 y∈[70,530] vs 레일 y≤60 → 10mm (회전축 +y — 회전 불변)
    expect(minAcross).toBeGreaterThan(9.0);
    expect(minAcross).toBeLessThanOrEqual(10.0 + 1e-6);
  }, 240_000);

  it('mutation: shifting one roller 20mm toward the rail is DETECTED as a sweep collision', async () => {
    const mutated: TemplateAssemblyLike = {
      ...asm,
      parts: asm.parts.map(part => {
        if (!/mod\[0\]\/rol\[0\]/.test(part.id)) return part;
        return { ...part, at: { ...(part.at ?? {}), ty: (part.at?.ty ?? 0) - 20 } };
      }),
    };
    const bridge = bridgeConveyorToJointEvidence(mutated);
    const adapter = adaptCadNativeAssembly(bridge.bundle, bridge.evidence);
    const plan = planCadNativeJointMotion(bridge.evidence, adapter.compiledJointIds);
    const certificate = buildJointMotionClearanceCertificate({
      evidence: bridge.evidence, adapter, plan, geometries: await geometriesOf(bridge),
      skipStaticStaticPairs: true,
    });
    expect(certificate.status).toBe('fail');
    const failed = certificate.sweeps.filter(sweep => sweep.status === 'fail');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed.some(sweep => `${sweep.collision?.partA}${sweep.collision?.partB}`.includes('rl'))).toBe(true);
  }, 240_000);

  it('partWorldAabb honestly refuses out-of-vocabulary rotations', () => {
    expect(partWorldAabb({ id: 'x', type: 'cylinder', params: { diameter: 60, length: 100 }, at: { ry: 45 } })).toBeNull();
    expect(partWorldAabb({ id: 'x', type: 'box', params: { width: 10, depth: 10, height: 10 }, at: { rz: 30 } })).toBeNull();
  });
});
