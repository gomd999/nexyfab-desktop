import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { generateRobot6Axis } from '@/lib/ai/robot/robotGenerator';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from '@/lib/ai/robot/robotDemonstrator';
import { buildEditedAiAssemblyProgram, packageAiAssemblyRevision, serializeAiAssemblyProgram } from '@/lib/ai/aiAssemblyRevision';
import { verifyRobotEvidenceBundle } from '@/lib/ai/robot/robotEvidenceBundle';
import { createHash } from 'node:crypto';
import type { HingeMate } from '@/lib/assembly/mate';

const base = generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC).program;
const trees = Object.fromEntries(base.parts.map(part => [part.instanceId, part.featureTree]));
async function revision() {
  const parts = base.assembly.parts.map((part, index) => index === 1 ? { ...part, position: { ...part.position, x: part.position.x + 5 } } : part);
  const program = buildEditedAiAssemblyProgram(base, { ...base.assembly, parts }, trees);
  const baseHash = createHash('sha256').update(serializeAiAssemblyProgram(base)).digest('hex');
  return { program, ...await packageAiAssemblyRevision(program, { lineageId: 'robot-reverify-test', revision: 2, baseProgramHash: baseHash, createdAt: '2026-08-09T00:00:00.000Z' }) };
}
function request(programBytes: Uint8Array, manifestBytes: Uint8Array, ip: string) {
  const form = new FormData();
  form.set('program', new File([new Uint8Array(programBytes)], 'program.json', { type: 'application/json' }));
  form.set('manifest', new File([new Uint8Array(manifestBytes)], 'manifest.json', { type: 'application/json' }));
  return new NextRequest('http://localhost/api/cad/v1/robot/reverify', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: form });
}

describe('CAD v1 robot revision reverification', () => {
  it('rejects the fifth package request before expensive verification', async () => {
    for (let index = 0; index < 4; index += 1) {
      const response = await POST(new NextRequest('http://localhost/api/cad/v1/robot/reverify', { method: 'POST', body: new FormData(), headers: { 'x-forwarded-for': 'reverify-rate-budget' } }));
      expect(response.status).toBe(400);
    }
    const limited = await POST(new NextRequest('http://localhost/api/cad/v1/robot/reverify', { method: 'POST', body: new FormData(), headers: { 'x-forwarded-for': 'reverify-rate-budget' } }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
  });

  it('returns a hash-bound precise report without storage, quote, or RFQ side effects', async () => {
    const packaged = await revision();
    const response = await POST(request(packaged.programBytes, packaged.manifestBytes, 'reverify-ok'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: true, releaseReady: false, quoteOrRfqSideEffects: false, report: { product: { lineageId: 'robot-reverify-test', revision: 2, programSha256: packaged.manifest.programHash }, assembly: { preciseInterferenceStatus: 'completed', releaseReady: false }, motionStudy: { releaseEvidence: false, axisCount: 6, frameCount: 156, checkedFrames: 156 }, coordinatedMotionStudy: { releaseEvidence: false, strategy: 'coordinated-six-axis-keyframes-v1', frameCount: 49, checkedFrames: 49 }, quoteOrRfqSideEffects: false } });
    expect(payload.report.motionStudy.axes.map((axis: { mateId: string }) => axis.mateId)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6']);
    expect(payload.report.motionStudy.axes.map((axis: { rangeDeg: number[] }) => axis.rangeDeg)).toEqual(base.assembly.mates.filter((mate): mate is HingeMate => mate.kind === 'hinge' && /^J[1-6]$/.test(mate.id)).sort((a, b) => a.id.localeCompare(b.id)).map(mate => [mate.limit!.minAngleDeg, mate.limit!.maxAngleDeg]));
    expect(payload.report.motionStudy.collisionFrameCount).toBeGreaterThan(0);
    expect(payload.report.coordinatedMotionStudy.mateIds).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6']);
    expect(payload.report.blockers).toContain('precise_motion_collisions_present');
    expect(payload.report.blockers.includes('motion_reverify_incomplete')).toBe(payload.report.motionStudy.allConverged !== true);
    const reportBytes = new TextEncoder().encode(JSON.stringify(payload.report));
    const verified = await verifyRobotEvidenceBundle(reportBytes, packaged.programBytes);
    expect(verified).toMatchObject({ lineageId: 'robot-reverify-test', revision: 2, programHash: packaged.manifest.programHash, effectiveReleaseReady: false });
  });

  it('rejects tampered program bytes and a side-effectful manifest', async () => {
    const packaged = await revision();
    const tampered = new Uint8Array(packaged.programBytes); tampered[tampered.length - 2] ^= 1;
    const badProgram = await POST(request(tampered, packaged.manifestBytes, 'reverify-tamper'));
    expect(badProgram.status).toBe(422);
    expect((await badProgram.json()).message).toContain('do not match manifest');
    const manifest = { ...packaged.manifest, sideEffects: { ...packaged.manifest.sideEffects, quoteCreated: true } };
    const badManifest = await POST(request(packaged.programBytes, new TextEncoder().encode(JSON.stringify(manifest)), 'reverify-side-effect'));
    expect(badManifest.status).toBe(422);
    expect((await badManifest.json()).message).toContain('side effects must all be false');
  });

  it('requires both files and rejects a non-six-axis assembly', async () => {
    const empty = await POST(new NextRequest('http://localhost/api/cad/v1/robot/reverify', { method: 'POST', body: new FormData(), headers: { 'x-forwarded-for': 'reverify-empty' } }));
    expect(empty.status).toBe(400);
    const packaged = await revision();
    const noHinges = { ...packaged.program, assembly: { ...packaged.program.assembly, mates: packaged.program.assembly.mates.filter(mate => mate.kind !== 'hinge') } };
    const bytes = new TextEncoder().encode(`${JSON.stringify(noHinges, null, 2)}\n`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const manifest = { ...packaged.manifest, programHash: hash, programArtifact: `editable-program-${hash}.json` };
    const response = await POST(request(bytes, new TextEncoder().encode(JSON.stringify(manifest)), 'reverify-nonrobot'));
    expect(response.status).toBe(422);
    expect((await response.json()).message).toContain('J1..J6');
    const noLimit = { ...packaged.program, assembly: { ...packaged.program.assembly, mates: packaged.program.assembly.mates.map(mate => mate.id === 'J1' ? { ...mate, limit: undefined } : mate) } };
    const noLimitBytes = new TextEncoder().encode(`${JSON.stringify(noLimit, null, 2)}\n`);
    const noLimitHash = createHash('sha256').update(noLimitBytes).digest('hex');
    const noLimitManifest = { ...packaged.manifest, programHash: noLimitHash, programArtifact: `editable-program-${noLimitHash}.json` };
    const noLimitResponse = await POST(request(noLimitBytes, new TextEncoder().encode(JSON.stringify(noLimitManifest)), 'reverify-no-limit'));
    expect(noLimitResponse.status).toBe(422);
    expect((await noLimitResponse.json()).message).toContain('angular limit containing zero for J1');
  });
});
