// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectureInteriorSectionGaugePanel } from './ArchitectureInteriorSectionGaugePanel';

const dimensions = [{ id: 'width', label: 'Width', value: 8000, min: 2000, max: 20_000, step: 100, unit: 'mm' }] as const;

describe('ArchitectureInteriorSectionGaugePanel', () => {
  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'])('renders section and editable gauges in %s', lang => {
    render(<ArchitectureInteriorSectionGaugePanel lang={lang} kind="interior" widthMm={8000} depthMm={6000} heightMm={2700} dimensions={dimensions} onDimensionChange={vi.fn()} />);
    expect(screen.getByTestId('interior-section-view')).toBeInTheDocument();
    expect(screen.getByTestId('interior-section-gauge')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(8000);
  });

  it('supports RTL and calls the edit callback from the number gauge', () => {
    const onChange = vi.fn();
    const { container } = render(<ArchitectureInteriorSectionGaugePanel lang="ar" kind="building" widthMm={12_000} depthMm={8000} heightMm={6400} dimensions={dimensions} onDimensionChange={onChange} />);
    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9000' } });
    expect(onChange).toHaveBeenCalledWith('width', 9000);
  });

  it('clamps range and number edits to the declared bounds', () => {
    const onChange = vi.fn();
    render(<ArchitectureInteriorSectionGaugePanel lang="en" kind="building" widthMm={8000} depthMm={6000} heightMm={3000} dimensions={[{ ...dimensions[0], min: 3000, max: 10_000 }]} onDimensionChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100000' } });
    expect(onChange).toHaveBeenCalledWith('width', 10_000);
  });
});
