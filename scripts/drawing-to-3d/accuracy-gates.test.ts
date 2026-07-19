import { describe, it, expect } from 'vitest';
import { buildAssembly } from './assembly.mjs';
import { stepRoundTrip } from './roundtrip.mjs';
import { refineInterferencesMesh, stlVolume } from './interference-refine.mjs';

describe('정확도 게이트 A1·B1 (260719)', () => {
  it('A1 라운드트립 — STEP 재임포트 부피·AABB ↔ 폐형 예측 PASS', async () => {
    const asm = {
      name: 'rt', domain: 'mech',
      parts: [
        { id: 'base', type: 'box', params: { width: 300, depth: 200, height: 20 }, at: { tx: 0, ty: 0, tz: 0 }, role: 'frame', material: 'steel' },
        { id: 'post', type: 'cylinder', params: { diameter: 60, length: 150 }, at: { tx: 150, ty: 100, tz: 20 }, role: 'column', material: 'steel' },
        { id: 'noz', type: 'pipe_reducer', params: { dia1: 100, dia2: 60, length: 80, wallThk: 5 }, at: { tx: 150, ty: 100, tz: 170 }, role: 'mount', material: 'steel' },
      ],
    };
    const r = (await stepRoundTrip(asm)) as { verdict: string; volume: { ok: boolean; errMm3: number; bandMm3: number }; aabb: Array<{ ok: boolean }> };
    expect(r.verdict).toBe('PASS');
    expect(r.volume.ok).toBe(true);
    expect(r.aabb.every((a) => a.ok)).toBe(true);
  }, 120_000);

  it('B1 메시 부울 — AABB 과탐 해제(콘 상부 회전판) + 실관통 확정(실측 부피)', async () => {
    const mk = (pz: number) => ({
      name: 't',
      parts: [
        { id: 'cone', type: 'revolve', params: { profile: [[0, 0], [80, 0], [0, 150]] }, at: { tx: 0, ty: 0, tz: 0 }, role: 'vessel', material: 'steel' },
        { id: 'plate', type: 'box', params: { width: 60, depth: 60, height: 8 }, at: { tx: 45, ty: 45, tz: pz, rz: 15 }, role: 'frame', material: 'steel' },
      ],
    });
    const sep = mk(130);
    const bSep = buildAssembly(sep) as { interferences: Array<{ a: string; b: string }> };
    expect(bSep.interferences.length).toBe(1); // 1차=보수 과탐
    const rSep = (await refineInterferencesMesh(sep, bSep.interferences)) as { interferences: unknown[]; demoted: Array<{ intersectMm3: number }> };
    expect(rSep.interferences.length).toBe(0);
    expect(rSep.demoted.length).toBe(1); // 실분리 해제

    const hit = mk(20);
    const bHit = buildAssembly(hit) as { interferences: Array<{ a: string; b: string }> };
    const rHit = (await refineInterferencesMesh(hit, bHit.interferences)) as { interferences: Array<{ intersectMm3?: number }> };
    expect(rHit.interferences.length).toBe(1);
    expect(rHit.interferences[0].intersectMm3!).toBeGreaterThan(50); // 실측 관통 부피
  }, 180_000);

  it('stlVolume — 바이너리 STL 부호 사면체(빈/짧은 입력=0)', () => {
    expect(stlVolume(new Uint8Array(10))).toBe(0);
  });
});
