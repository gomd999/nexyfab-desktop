// @vitest-environment jsdom
/**
 * DrivingDimensionField — D2 UI: editing a driven dimension writes the bound
 * variable through the real EquationManager and asks the host to rebuild.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import DrivingDimensionField from '../DrivingDimensionField';
import { EquationManager } from '../../equations/equationManager';

describe('DrivingDimensionField (D2 UI)', () => {
  it('shows the current bound value and drives the variable on Enter', () => {
    const em = new EquationManager();
    em.set('width', '100');
    let rebuilds = 0;
    let lastVal = -1;
    const { getByTestId } = render(
      <DrivingDimensionField
        em={em}
        binding={{ dimensionId: 'd1', variable: 'width' }}
        onRebuild={() => { rebuilds++; }}
        onCommitted={(v) => { lastVal = v; }}
      />,
    );
    const input = getByTestId('driving-dim-input') as HTMLInputElement;
    expect(input.value).toBe('100'); // forward: model → field

    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(em.get('width')).toBe(50); // reverse: field → model
    expect(rebuilds).toBe(1);
    expect(lastVal).toBe(50);
    expect(input.value).toBe('50');
  });

  it('drives through a scaled binding (diameter field → radius variable)', () => {
    const em = new EquationManager();
    em.set('r', '5');
    const { getByTestId } = render(
      <DrivingDimensionField em={em} binding={{ dimensionId: 'dia', variable: 'r', scale: 2 }} />,
    );
    const input = getByTestId('driving-dim-input') as HTMLInputElement;
    expect(input.value).toBe('10'); // 2·r
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.blur(input);
    expect(em.get('r')).toBe(15); // 30 / 2
  });

  it('surfaces an error and does NOT rebuild on an invalid value', () => {
    const em = new EquationManager();
    em.set('w', '10');
    let rebuilds = 0;
    const { getByTestId, queryByTestId } = render(
      <DrivingDimensionField em={em} binding={{ dimensionId: 'd', variable: 'w' }} onRebuild={() => { rebuilds++; }} />,
    );
    const input = getByTestId('driving-dim-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } }); // Number('abc') = NaN
    fireEvent.blur(input);
    expect(queryByTestId('driving-dim-error')).not.toBeNull();
    expect(rebuilds).toBe(0);
    expect(em.get('w')).toBe(10); // unchanged
  });

  it('labels which variable it drives', () => {
    const em = new EquationManager();
    em.set('height', '20');
    const { getByTestId } = render(
      <DrivingDimensionField em={em} binding={{ dimensionId: 'dh', variable: 'height' }} />,
    );
    expect(getByTestId('driving-dim-var').textContent).toContain('height');
  });
});
