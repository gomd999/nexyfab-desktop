import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AssemblyAnimationTimeline from './AssemblyAnimationTimeline';
import type { AssemblyAnimationVerification } from '@/lib/assembly/assemblyAnimationVerification';
import type { PreciseCollisionTimeEvidence } from '@/lib/assembly/featureTreePreciseInterference';

const animation = { version: 1 as const, name: 'motion', fps: 30, startFrame: 0, endFrame: 10, tracks: [] };
const base: AssemblyAnimationVerification = { verified: true, collisionFree: true, firstFailureFrame: null, frames: [{ frame: 0, status: 'passed', pairs: [], errors: [] }], continuous: { checked: true, candidates: [], unresolved: [] }, errors: [] };
const render = (verification: AssemblyAnimationVerification) => renderToStaticMarkup(<AssemblyAnimationTimeline animation={animation} frame={0} playing={false} onFrameChange={vi.fn()} onPlayingChange={vi.fn()} verification={verification}/>);

describe('AssemblyAnimationTimeline continuous evidence', () => {
  it('names interactive frame fields for browser form tooling', () => {
    const html = render(base);
    expect(html).toContain('name="assembly-animation-frame-slider"');
    expect(html).toContain('name="assembly-animation-current-frame"');
  });
  it('shows whole-motion clearance rather than sampled-only clearance', () => expect(render(base)).toContain('All sampled and continuous intervals clear'));
  it('surfaces release-blocking rotational intervals', () => {
    const interval = { partA: 'a', partB: 'b', startFrame: 2, endFrame: 3, method: 'adaptive-rotational-aabb' as const, status: 'unresolved' as const, depth: 8 };
    expect(render({ ...base, verified: false, collisionFree: false, continuous: { checked: true, candidates: [interval], unresolved: [interval] }, errors: ['unresolved'] })).toContain('1 unresolved rotational interval(s)');
  });
  it('shows the conservative first-contact bracket from precise verification',()=>{const toi:PreciseCollisionTimeEvidence[]=[{partA:'arm',partB:'guard',status:'collision_bracket',searchStartFrame:0,searchEndFrame:10,firstPossibleFrame:2.449,confirmedCollisionFrame:2.45,bracketWidthFrames:.001,evaluations:20,clearIntervals:8}];const html=renderToStaticMarkup(<AssemblyAnimationTimeline animation={animation} frame={0} playing={false} onFrameChange={vi.fn()} onPlayingChange={vi.fn()} verification={base} timeOfImpact={toi}/>);expect(html).toContain('First collision arm/guard: frames 2.449–2.450');expect(html).toContain('assembly-animation-jump-to-toi');});
  it('localizes controls and evidence for Arabic routes', () => {
    const html = renderToStaticMarkup(<AssemblyAnimationTimeline lang="ar" animation={animation} frame={0} playing={false} onFrameChange={vi.fn()} onPlayingChange={vi.fn()} verification={base}/>);
    expect(html).toContain('aria-label="تشغيل"');
    expect(html).toContain('جميع الفواصل المأخوذة والمستمرة خالية');
    expect(html).not.toContain('aria-label="Play"');
  });
});
