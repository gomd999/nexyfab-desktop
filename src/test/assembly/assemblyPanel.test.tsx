/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { AssemblyMate } from '@/app/[lang]/shape-generator/assembly/AssemblyMates';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/shape',
}));

const mockSetShowPerf = vi.fn();
vi.mock('@/app/[lang]/shape-generator/store/uiStore', () => ({
  useUIStore: (selector: (s: { setShowPerf: typeof mockSetShowPerf }) => unknown) =>
    selector({ setShowPerf: mockSetShowPerf }),
}));

import AssemblyPanel from '@/app/[lang]/shape-generator/assembly/AssemblyPanel';

describe('AssemblyPanel', () => {
  beforeEach(() => {
    mockSetShowPerf.mockClear();
  });

  const baseProps: React.ComponentProps<typeof AssemblyPanel> = {
    mates: [] as AssemblyMate[],
    onAddMate: vi.fn(),
    onRemoveMate: vi.fn(),
    onUpdateMate: vi.fn(),
    onDetectInterference: vi.fn(),
    interferenceResults: [],
    interferenceLoading: false,
    explodeFactor: 0,
    onExplodeFactorChange: vi.fn(),
    partNames: ['part_a', 'part_b'],
    interferenceCheckPartCount: 2,
    isKo: false,
    onClose: vi.fn(),
  };

  it('shows viewport load banner when part count crosses viewport warn threshold', () => {
    render(
      <AssemblyPanel
        {...baseProps}
        interferenceCheckPartCount={30}
      />,
    );
    expect(screen.getByTestId('assembly-viewport-load-banner')).toBeInTheDocument();
  });

  it('shows interference preamble on interference tab when pairwise workload is heavy', () => {
    render(
      <AssemblyPanel
        {...baseProps}
        interferenceCheckPartCount={25}
      />,
    );
    fireEvent.click(screen.getByTestId('assembly-tab-interference'));
    expect(screen.getByTestId('assembly-interference-preamble')).toBeInTheDocument();
  });

  it('shows open Performance button when workload suggests perf panel', () => {
    render(
      <AssemblyPanel
        {...baseProps}
        interferenceCheckPartCount={100}
      />,
    );
    fireEvent.click(screen.getByTestId('assembly-open-perf-button'));
    expect(mockSetShowPerf).toHaveBeenCalledWith(true);
  });
});
