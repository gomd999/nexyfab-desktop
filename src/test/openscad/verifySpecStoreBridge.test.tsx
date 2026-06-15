/**
 * SSE bridge regression: when the agent emits a verify_spec tool_result,
 * the analysisStore's latestVerifySpecResult must reflect the reconstructed
 * SpecVerificationResult so any consumer (e.g. OpenScadPanel) picks it up.
 *
 * We don't exercise the SSE wire here — that's covered by the agent SSE
 * tests. This file locks down the contract between agent tool_result.meta
 * and the store field shape.
 */

/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAnalysisStore } from '@/app/[lang]/shape-generator/store/analysisStore';
import type { SpecVerificationResult } from '@/lib/ai/scad-agent/specVerification';

beforeEach(() => {
  useAnalysisStore.getState().setLatestVerifySpecResult(null);
});

describe('analysisStore.latestVerifySpecResult bridge', () => {
  it('starts null with no capture timestamp', () => {
    const s = useAnalysisStore.getState();
    expect(s.latestVerifySpecResult).toBeNull();
    expect(s.latestVerifySpecAtMs).toBeNull();
  });

  it('setLatestVerifySpecResult writes the result + stamps Date.now()', () => {
    const fixture: SpecVerificationResult = {
      ok: true,
      verifiable: true,
      mismatches: [],
      expected: { centered: true, wMm: 50, hMm: 50, dMm: 50 },
      measured: { wMm: 50, hMm: 50, dMm: 50 },
    };
    const before = Date.now();
    useAnalysisStore.getState().setLatestVerifySpecResult(fixture);
    const after = Date.now();

    const s = useAnalysisStore.getState();
    expect(s.latestVerifySpecResult).toBe(fixture);
    expect(s.latestVerifySpecAtMs).not.toBeNull();
    expect(s.latestVerifySpecAtMs!).toBeGreaterThanOrEqual(before);
    expect(s.latestVerifySpecAtMs!).toBeLessThanOrEqual(after);
  });

  it('setLatestVerifySpecResult(null) clears both fields', () => {
    useAnalysisStore.getState().setLatestVerifySpecResult({
      ok: false,
      verifiable: true,
      mismatches: [],
    } as SpecVerificationResult);
    expect(useAnalysisStore.getState().latestVerifySpecResult).not.toBeNull();
    expect(useAnalysisStore.getState().latestVerifySpecAtMs).not.toBeNull();

    useAnalysisStore.getState().setLatestVerifySpecResult(null);
    const s = useAnalysisStore.getState();
    expect(s.latestVerifySpecResult).toBeNull();
    expect(s.latestVerifySpecAtMs).toBeNull();
  });

  it('reconstructed result with all sub-fields preserves the agent meta shape', () => {
    // Mirrors the reconstruction logic in ScadAgentPanel.tsx — locks the
    // contract so a refactor that adds a new field gets caught.
    const meta = {
      passed: false,
      verifiable: true,
      mismatchCount: 1,
      expected: { centered: true, wMm: 50, hMm: 50, dMm: 50 },
      measured: { wMm: 50, hMm: 50, dMm: 50 },
      holeCount: { expected: 2, detected: 1, mismatch: { delta: -1 } },
      volume: { expectedMm3: 125000, actualMm3: 121073, holeBreakdown: [], mismatch: null },
      fillet: { expectedFilletCount: 1, sharpEdgeCount: 12, maxDihedralDeg: 90, applied: false },
    };
    const reconstructed: SpecVerificationResult = {
      ok: meta.passed === true,
      verifiable: meta.verifiable === true,
      mismatches: [],
      ...(meta.expected ? { expected: meta.expected } : {}),
      ...(meta.measured ? { measured: meta.measured } : {}),
      ...(meta.holeCount ? { holeCount: meta.holeCount } : {}),
      ...(meta.volume ? { volume: meta.volume } : {}),
      ...(meta.fillet ? { fillet: meta.fillet } : {}),
    };
    useAnalysisStore.getState().setLatestVerifySpecResult(reconstructed);
    const stored = useAnalysisStore.getState().latestVerifySpecResult!;
    expect(stored.ok).toBe(false);
    expect(stored.verifiable).toBe(true);
    expect(stored.holeCount?.mismatch?.delta).toBe(-1);
    expect(stored.volume?.expectedMm3).toBe(125000);
    expect(stored.fillet?.applied).toBe(false);
  });
});
