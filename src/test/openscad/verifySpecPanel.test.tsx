/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

import VerifySpecPanel from '@/app/[lang]/shape-generator/openscad/VerifySpecPanel';
import type { SpecVerificationResult } from '@/lib/ai/scad-agent/specVerification';

/** Build a passing result with measured bbox set. Optional overrides
 *  let each test tweak just the sub-field it cares about. */
function buildResult(overrides: Partial<SpecVerificationResult> = {}): SpecVerificationResult {
  return {
    ok: true,
    verifiable: true,
    expected: { centered: true, wMm: 50, hMm: 50, dMm: 50 },
    measured: { wMm: 50, hMm: 50, dMm: 50 },
    mismatches: [],
    ...overrides,
  };
}

describe('VerifySpecPanel', () => {
  it('renders empty state when result is null', () => {
    render(<VerifySpecPanel lang="en" result={null} />);
    expect(screen.getByTestId('verify-spec-empty')).toBeInTheDocument();
    expect(screen.getByTestId('verify-spec-empty')).toHaveTextContent('No verification run yet.');
    // No layer rows or banner when there's no result.
    expect(screen.queryByTestId('verify-banner-ok')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verify-row-bbox')).not.toBeInTheDocument();
  });

  it('renders overall "spec ok" banner when result.ok=true', () => {
    render(<VerifySpecPanel lang="en" result={buildResult()} />);
    const banner = screen.getByTestId('verify-banner-ok');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('spec ok');
    expect(screen.queryByTestId('verify-banner-fail')).not.toBeInTheDocument();
  });

  it('renders failure banner with issue count when result.ok=false', () => {
    const result = buildResult({
      ok: false,
      mismatches: [
        { axis: 'width', expectedMm: 50, actualMm: 60, deltaMm: 10, deltaPct: 20 },
      ],
      volume: {
        expectedMm3: 1000,
        actualMm3: 1500,
        holeBreakdown: [],
        mismatch: { expectedMm3: 1000, actualMm3: 1500, deltaMm3: 500, deltaPct: 50 },
      },
    });
    render(<VerifySpecPanel lang="en" result={result} />);
    const banner = screen.getByTestId('verify-banner-fail');
    expect(banner).toBeInTheDocument();
    // Two failing layers: bbox + volume.
    expect(banner).toHaveTextContent('2 issues');
  });

  it('bbox row shows green ✓ when no mismatches', () => {
    render(<VerifySpecPanel lang="en" result={buildResult()} />);
    const row = screen.getByTestId('verify-row-bbox');
    expect(row).toHaveAttribute('data-status', 'ok');
    expect(screen.getByTestId('verify-icon-bbox')).toHaveTextContent('✓');
    expect(row).toHaveTextContent('50.00 × 50.00 × 50.00 mm');
  });

  it('volume row shows red ✗ when result.volume.mismatch is set', () => {
    const result = buildResult({
      ok: false,
      volume: {
        expectedMm3: 1000,
        actualMm3: 1500,
        holeBreakdown: [],
        mismatch: { expectedMm3: 1000, actualMm3: 1500, deltaMm3: 500, deltaPct: 50 },
      },
    });
    render(<VerifySpecPanel lang="en" result={result} />);
    const row = screen.getByTestId('verify-row-volume');
    expect(row).toHaveAttribute('data-status', 'mismatch');
    expect(screen.getByTestId('verify-icon-volume')).toHaveTextContent('✗');
  });

  it('holeCount row shows gray — when result.holeCount is undefined (skipped)', () => {
    render(<VerifySpecPanel lang="en" result={buildResult()} />);
    const row = screen.getByTestId('verify-row-holeCount');
    expect(row).toHaveAttribute('data-status', 'skipped');
    expect(screen.getByTestId('verify-icon-holeCount')).toHaveTextContent('—');
  });

  it('clicking a failed row expands the critique detail', () => {
    const result = buildResult({
      ok: false,
      volume: {
        expectedMm3: 1000,
        actualMm3: 1500,
        holeBreakdown: [],
        mismatch: { expectedMm3: 1000, actualMm3: 1500, deltaMm3: 500, deltaPct: 50 },
      },
    });
    render(<VerifySpecPanel lang="en" result={result} />);
    // Detail is collapsed initially.
    expect(screen.queryByTestId('verify-detail-volume')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('verify-row-volume'));
    const detail = screen.getByTestId('verify-detail-volume');
    expect(detail).toBeInTheDocument();
    // formatSpecCritique's "volume:" wording shows up in the expanded text.
    expect(detail.textContent ?? '').toMatch(/volume/i);
    expect(detail.textContent ?? '').toContain('1500');
  });

  it('verifies a row\'s data-testid is present for every expected layer', () => {
    render(<VerifySpecPanel lang="en" result={buildResult()} />);
    const expectedKeys = [
      'bbox',
      'holeCount',
      'volume',
      'surfaceArea',
      'holePositions',
      'fillet',
      'threads',
      'intent',
    ];
    for (const k of expectedKeys) {
      expect(screen.getByTestId(`verify-row-${k}`)).toBeInTheDocument();
    }
  });
});
