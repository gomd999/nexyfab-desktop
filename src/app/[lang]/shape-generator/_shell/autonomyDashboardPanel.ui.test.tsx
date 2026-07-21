// @vitest-environment jsdom

/**
 * autonomyDashboardPanel.ui.test.tsx — Wave A · GA3.
 *
 * jsdom proof that the dashboard renders ONLY what the shared measurer
 * (autonomyMetrics) produces from REAL event logs — no fabricated numbers:
 *   - empty logs ⇒ explicit "no measurement" state, zero numeric headlines;
 *   - real mixed logs ⇒ zero-touch rate with numerator/denominator, mean
 *     interventions, median review time, per-run rows;
 *   - low sample (n < 5) ⇒ the low-sample warning is shown, numbers still there;
 *   - a measurer-refused sequence is surfaced with its reason, excluded from n.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/shape-generator',
}));

import { AutonomyDashboardPanel } from './AutonomyDashboardPanel';
import type { AutonomyEvent } from '@/lib/ai/design-driver/autonomyMetrics';

/** A zero-touch run: started → approved, no interventions, no review. */
function zeroTouchRun(runId: string, t0 = 0): AutonomyEvent[] {
  return [
    { type: 'run_started', runId, atMs: t0 },
    { type: 'approved', atMs: t0 + 1000 },
  ];
}

/** A touched run: one change request + a timed review session, then approved. */
function touchedRun(runId: string, reviewMs: number, t0 = 0): AutonomyEvent[] {
  return [
    { type: 'run_started', runId, atMs: t0 },
    { type: 'changes_requested', commentCount: 2, atMs: t0 + 100 },
    { type: 'rerun', atMs: t0 + 200 },
    { type: 'human_review_started', atMs: t0 + 300 },
    { type: 'human_review_ended', atMs: t0 + 300 + reviewMs },
    { type: 'approved', atMs: t0 + 400 + reviewMs },
  ];
}

/** A sequence the measurer REFUSES: human_review_ended with no matching start. */
function refusedRun(runId: string): AutonomyEvent[] {
  return [
    { type: 'run_started', runId, atMs: 0 },
    { type: 'human_review_ended', atMs: 100 },
  ];
}

afterEach(() => cleanup());

describe('AutonomyDashboardPanel — empty state', () => {
  it('renders an explicit "no measurement" state and no numeric dashboard', () => {
    render(<AutonomyDashboardPanel runEventLogs={[]} />);
    expect(screen.getByTestId('autonomy-empty')).toBeTruthy();
    expect(screen.queryByTestId('autonomy-dashboard')).toBeNull();
    expect(screen.queryByTestId('autonomy-zerotouch')).toBeNull();
  });
});

describe('AutonomyDashboardPanel — measured render', () => {
  // 6 runs so n >= MIN_SAMPLE_SIZE(5): 3 zero-touch + 3 touched.
  const logs = [
    zeroTouchRun('r1'),
    zeroTouchRun('r2'),
    zeroTouchRun('r3'),
    touchedRun('r4', 60_000), // 1.0 min review
    touchedRun('r5', 120_000), // 2.0 min review
    touchedRun('r6', 180_000), // 3.0 min review
  ];

  it('shows zero-touch rate with numerator/denominator, mean interventions, and median review time', () => {
    render(<AutonomyDashboardPanel runEventLogs={logs} />);
    // 3 of 6 zero-touch = 50.0%.
    expect(screen.getByTestId('autonomy-zerotouch').textContent).toContain('50.0% (3/6)');
    // mean interventions = (0+0+0+1+1+1)/6 = 0.50 per run, total 3/6.
    expect(screen.getByTestId('autonomy-mean').textContent).toContain('0.50 per run (3/6)');
    // median review = median(60000,120000,180000) = 120000ms = 2.0 min over 3 reviewed runs.
    const median = screen.getByTestId('autonomy-median').textContent ?? '';
    expect(median).toContain('120000 ms');
    expect(median).toContain('2.0 min');
    expect(median).toContain('3 reviewed run');
    // sample line present, NOT low.
    expect(screen.getByTestId('autonomy-sample').textContent).toContain('n=6');
    expect(screen.queryByTestId('autonomy-lowsample')).toBeNull();
  });

  it('lists one row per measured run with a zero-touch badge where applicable', () => {
    render(<AutonomyDashboardPanel runEventLogs={logs} />);
    const rows = screen.getAllByTestId('autonomy-run');
    expect(rows).toHaveLength(6);
    const badges = screen.getAllByTestId('autonomy-run-badge');
    expect(badges.filter((b) => b.textContent === 'zero-touch')).toHaveLength(3);
  });
});

describe('AutonomyDashboardPanel — low sample warning', () => {
  it('shows the low-sample warning for n < 5 but still renders the numbers', () => {
    render(<AutonomyDashboardPanel runEventLogs={[zeroTouchRun('r1'), touchedRun('r2', 60_000)]} />);
    const warn = screen.getByTestId('autonomy-lowsample');
    expect(warn.textContent).toContain('n=2');
    // 1 of 2 zero-touch still shown.
    expect(screen.getByTestId('autonomy-zerotouch').textContent).toContain('50.0% (1/2)');
  });
});

describe('AutonomyDashboardPanel — refused sequences', () => {
  it('surfaces a measurer-refused sequence with its reason and excludes it from the sample', () => {
    render(<AutonomyDashboardPanel runEventLogs={[zeroTouchRun('r1'), refusedRun('bad')]} />);
    const refused = screen.getByTestId('autonomy-refused');
    expect(refused.textContent).toContain('no matching human_review_started');
    // Only the 1 valid run counts: 100% (1/1), not 50%.
    expect(screen.getByTestId('autonomy-zerotouch').textContent).toContain('100.0% (1/1)');
    expect(screen.getByTestId('autonomy-sample').textContent).toContain('n=1');
  });
});
