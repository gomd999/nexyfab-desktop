// @vitest-environment jsdom
/**
 * dialogLang.test.tsx — Wave 2 Phase 2 Track D4 i18n integration smoke
 * for the four method-picker dialogs.
 *
 * Asserts:
 *
 *   1. Default render (no `lang` prop) keeps the existing English UI
 *      identical to the pre-W4 strings — regression check for the
 *      "Existing English UI still renders identically when KS
 *      conventions are off" acceptance criterion.
 *   2. `lang="ko"` swaps the title + insert/cancel button labels for
 *      their Korean equivalents.
 *   3. The dropdown trigger label localises as expected.
 *
 * Only the title + buttons are checked — full per-field localisation
 * is out of scope for W4 (the "W3 pick" placeholder strings stay in
 * English).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlaneMethodPickerDialog from '../PlaneMethodPickerDialog';
import AxisMethodPickerDialog from '../AxisMethodPickerDialog';
import PointMethodPickerDialog from '../PointMethodPickerDialog';
import CsysMethodPickerDialog from '../CsysMethodPickerDialog';
import ReferenceGeometryDropdown from '../ReferenceGeometryDropdown';

describe('Method-picker dialogs — default (English) render', () => {
  it('PlaneMethodPickerDialog title is "New Reference Plane" without lang', () => {
    render(
      <PlaneMethodPickerDialog
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('New Reference Plane')).toBeInTheDocument();
    expect(screen.getByTestId('method-picker-confirm').textContent).toBe('Insert');
    expect(screen.getByTestId('method-picker-cancel').textContent).toBe('Cancel');
  });

  it('AxisMethodPickerDialog title is "New Reference Axis" without lang', () => {
    render(
      <AxisMethodPickerDialog onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('New Reference Axis')).toBeInTheDocument();
  });

  it('PointMethodPickerDialog title is "New Reference Point" without lang', () => {
    render(
      <PointMethodPickerDialog onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('New Reference Point')).toBeInTheDocument();
  });

  it('CsysMethodPickerDialog title is "New Coordinate System" without lang', () => {
    render(
      <CsysMethodPickerDialog onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('New Coordinate System')).toBeInTheDocument();
  });
});

describe('Method-picker dialogs — Korean render (lang="ko")', () => {
  it('PlaneMethodPickerDialog title is "새 참조 평면" in ko', () => {
    render(
      <PlaneMethodPickerDialog
        lang="ko"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('새 참조 평면')).toBeInTheDocument();
    expect(screen.getByTestId('method-picker-confirm').textContent).toBe('삽입');
    expect(screen.getByTestId('method-picker-cancel').textContent).toBe('취소');
  });

  it('AxisMethodPickerDialog title is "새 참조 축" in ko', () => {
    render(
      <AxisMethodPickerDialog lang="ko" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('새 참조 축')).toBeInTheDocument();
  });

  it('PointMethodPickerDialog title is "새 참조 점" in ko', () => {
    render(
      <PointMethodPickerDialog lang="ko" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('새 참조 점')).toBeInTheDocument();
  });

  it('CsysMethodPickerDialog title is "새 좌표계" in ko', () => {
    render(
      <CsysMethodPickerDialog lang="ko" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('새 좌표계')).toBeInTheDocument();
  });
});

describe('ReferenceGeometryDropdown — localised trigger', () => {
  it('default (no lang) shows "Reference geometry" — regression check', () => {
    render(<ReferenceGeometryDropdown onPick={vi.fn()} />);
    const trigger = screen.getByTestId('ref-geom-dropdown-trigger');
    expect(trigger.textContent).toContain('Reference geometry');
  });

  it('lang="ko" shows "참조 형상"', () => {
    render(<ReferenceGeometryDropdown lang="ko" onPick={vi.fn()} />);
    const trigger = screen.getByTestId('ref-geom-dropdown-trigger');
    expect(trigger.textContent).toContain('참조 형상');
  });

  it('lang="ja" shows "参照ジオメトリ"', () => {
    render(<ReferenceGeometryDropdown lang="ja" onPick={vi.fn()} />);
    const trigger = screen.getByTestId('ref-geom-dropdown-trigger');
    expect(trigger.textContent).toContain('参照ジオメトリ');
  });
});
