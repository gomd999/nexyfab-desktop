/** @vitest-environment jsdom */
/**
 * threads/__tests__/HoleWizardThreadsSection.test.tsx — Wave 2 Phase 2 Track D6.
 *
 * Renders the threads section component (W6 spec §10.1). The component lives
 * in its own file specifically to be testable in isolation without bringing
 * up the full HoleWizardModalV2 surface.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HoleWizardThreadsSection, {
  type ThreadsSectionSpec,
} from '../HoleWizardThreadsSection';

describe('HoleWizardThreadsSection — render baseline', () => {
  it('renders the section container', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    expect(screen.getByTestId('hole-wizard-threads-section')).toBeTruthy();
  });

  it('renders all four series groups (ISO M / UTS / NPT / BSP)', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    expect(screen.getByTestId('threads-group-ISO_M')).toBeTruthy();
    expect(screen.getByTestId('threads-group-UTS')).toBeTruthy();
    expect(screen.getByTestId('threads-group-NPT')).toBeTruthy();
    expect(screen.getByTestId('threads-group-BSP')).toBeTruthy();
  });

  it('defaults to ISO_M_COARSE / M8 / 6H / cosmetic', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.series).toBe('ISO_M_COARSE');
    expect(last.designation).toBe('M8');
    expect(last.class).toBe('6H');
    expect(last.mode).toBe('cosmetic');
    expect(last.threadDirection).toBe('right_hand');
  });

  it('renders the mode badge text for cosmetic by default', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    expect(screen.getByTestId('hole-wizard-threads-mode-badge').textContent).toBe(
      'cosmetic',
    );
  });
});

describe('HoleWizardThreadsSection — series & designation switching', () => {
  it('switches to UTS group when clicked and picks UNC by default', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('threads-group-UTS'));
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.series).toBe('UNC');
    expect(last.class).toBe('2B'); // UNC default
  });

  it('shows the UNC/UNF sub-tabs once UTS group is active', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    fireEvent.click(screen.getByTestId('threads-group-UTS'));
    expect(screen.getByTestId('threads-series-UNC')).toBeTruthy();
    expect(screen.getByTestId('threads-series-UNF')).toBeTruthy();
  });

  it('switching to BSP group exposes BSP_PARALLEL / BSP_TAPERED sub-tabs', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    fireEvent.click(screen.getByTestId('threads-group-BSP'));
    expect(screen.getByTestId('threads-series-BSP_PARALLEL')).toBeTruthy();
    expect(screen.getByTestId('threads-series-BSP_TAPERED')).toBeTruthy();
  });

  it('picks a different designation and reports it', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('threads-designation-M12'));
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.designation).toBe('M12');
  });
});

describe('HoleWizardThreadsSection — class picker', () => {
  it('shows class buttons for the current series', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    expect(screen.getByTestId('threads-class-6H')).toBeTruthy();
    expect(screen.getByTestId('threads-class-7H')).toBeTruthy();
  });

  it('picking a different class fires onChange with the new class', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('threads-class-7H'));
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.class).toBe('7H');
  });
});

describe('HoleWizardThreadsSection — direction & kind toggles', () => {
  it('toggles direction to left_hand', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('threads-direction-left_hand'));
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.threadDirection).toBe('left_hand');
  });

  it('hides the kind toggle when hideKindToggle=true', () => {
    render(<HoleWizardThreadsSection lang="en" hideKindToggle />);
    expect(screen.queryByTestId('threads-kind-internal')).toBeNull();
    expect(screen.queryByTestId('threads-kind-external')).toBeNull();
  });

  it('renders the kind toggle when hideKindToggle is false/undefined', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    expect(screen.getByTestId('threads-kind-internal')).toBeTruthy();
    expect(screen.getByTestId('threads-kind-external')).toBeTruthy();
  });
});

describe('HoleWizardThreadsSection — mode & W7 hint', () => {
  it('geometric button is disabled (W7)', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    const btn = screen.getByTestId('threads-mode-geometric') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the W7 hint text', () => {
    render(<HoleWizardThreadsSection lang="en" />);
    expect(screen.getByTestId('threads-mode-w7-hint').textContent).toContain('W7');
  });

  it('clicking the cosmetic mode button does not change mode (already cosmetic)', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('threads-mode-cosmetic'));
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.mode).toBe('cosmetic');
  });
});

describe('HoleWizardThreadsSection — length / startOffset inputs', () => {
  it('updates length when the input changes', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    const input = screen.getByTestId('threads-length-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30' } });
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.length).toBe(30);
  });

  it('rejects negative length (no state change)', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    const input = screen.getByTestId('threads-length-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-5' } });
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.length).toBe(20); // unchanged
  });

  it('updates startOffset when the input changes', () => {
    const onChange = vi.fn();
    render(<HoleWizardThreadsSection lang="en" onChange={onChange} />);
    const input = screen.getByTestId('threads-startoffset-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.startOffset).toBe(2);
  });
});

describe('HoleWizardThreadsSection — initialSpec hydration', () => {
  it('respects an initialSpec for series + designation + class', () => {
    const onChange = vi.fn();
    render(
      <HoleWizardThreadsSection
        lang="en"
        initialSpec={{
          series: 'UNC',
          designation: '1/4-20 UNC',
          class: '2B',
          length: 15,
          threadDirection: 'left_hand',
        }}
        onChange={onChange}
      />,
    );
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.series).toBe('UNC');
    expect(last.designation).toBe('1/4-20 UNC');
    expect(last.class).toBe('2B');
    expect(last.length).toBe(15);
    expect(last.threadDirection).toBe('left_hand');
  });

  it('falls back to series default when the supplied class is invalid', () => {
    const onChange = vi.fn();
    render(
      <HoleWizardThreadsSection
        lang="en"
        initialSpec={{ series: 'ISO_M_COARSE', class: '2B' /* invalid */ }}
        onChange={onChange}
      />,
    );
    const last = onChange.mock.calls.at(-1)?.[0] as ThreadsSectionSpec;
    expect(last.class).toBe('6H');
  });
});

describe('HoleWizardThreadsSection — Korean localisation', () => {
  it('renders the Korean section title (나사산)', () => {
    render(<HoleWizardThreadsSection lang="ko" />);
    const section = screen.getByTestId('hole-wizard-threads-section');
    expect(section.textContent).toContain('나사산');
  });

  it('renders the Korean direction labels (오른나사 / 왼나사)', () => {
    render(<HoleWizardThreadsSection lang="ko" />);
    expect(
      screen.getByTestId('threads-direction-right_hand').textContent,
    ).toContain('오른나사');
    expect(
      screen.getByTestId('threads-direction-left_hand').textContent,
    ).toContain('왼나사');
  });
});
