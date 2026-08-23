// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InteriorPlacementInspector } from './InteriorPlacementInspector';
import type { InteriorPlacementObject } from '@/lib/cad/interiorPlacementDocument';

const object: InteriorPlacementObject = { id: 'table-1', catalogType: 'table4', spaceId: 'room-1', pose: { positionMm: [0, 0, 0], rotationDeg: [0, 0, 0] }, dimensionsMm: [1000, 600, 750], clearanceMm: [20, 20, 0] };
type Changes = Partial<Pick<InteriorPlacementObject, 'pose' | 'dimensionsMm' | 'clearanceMm'>>;
const props = (onCommit: (changes: Changes) => boolean | Promise<boolean>, extra: Partial<React.ComponentProps<typeof InteriorPlacementInspector>> = {}) => ({ object, roomSizeMm: [10_000, 8_000, 3_000] as [number, number, number], lang: 'en', onCommit, ...extra });

describe('InteriorPlacementInspector', () => {
  it('commits Enter once even when blur follows, and Escape cancels', async () => {
    const onCommit = vi.fn<(changes: Changes) => Promise<boolean>>().mockResolvedValue(true); render(<InteriorPlacementInspector {...props(onCommit)} />);
    const input = screen.getByTestId('interior-placement-dimensions-0');
    fireEvent.change(input, { target: { value: '1200' } });
    fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledOnce();
    await waitFor(() => expect(input).toHaveValue(1200));
    fireEvent.change(input, { target: { value: '1500' } }); fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue(1200);
  });

  it('normalizes rotation, clamps dimensions/clearance and exposes readonly identity', async () => {
    const onCommit = vi.fn<(changes: Changes) => Promise<boolean>>().mockResolvedValue(true); render(<InteriorPlacementInspector {...props(onCommit)} />);
    expect(screen.getByTestId('interior-placement-object-id')).toHaveTextContent('table-1');
    expect(screen.getByText('table4')).toBeInTheDocument(); expect(screen.getByText('room-1')).toBeInTheDocument();
    const rotation = screen.getByTestId('interior-placement-rotation-2'); fireEvent.change(rotation, { target: { value: '540' } }); fireEvent.blur(rotation);
    const clearance = screen.getByTestId('interior-placement-clearance-0'); fireEvent.change(clearance, { target: { value: '-10' } }); fireEvent.blur(clearance);
    await waitFor(() => { expect(rotation).toHaveValue(180); expect(clearance).toHaveValue(0); });
    const latest = onCommit.mock.calls.at(-1)?.[0]; if (!latest) throw new Error('expected inspector commit'); expect(latest.clearanceMm?.[0]).toBeGreaterThanOrEqual(0); expect(latest.pose?.rotationDeg?.[2]).toBe(180);
  });

  it('disables fields for pending/stale state and keeps RTL/a11y status visible', () => {
    render(<InteriorPlacementInspector {...props(vi.fn<(changes: Changes) => boolean>())} lang="ar" pending roomBasisStale />);
    expect(screen.getByTestId('interior-placement-dimensions-0')).toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.getByTestId('interior-placement-inspector')).toHaveAttribute('dir', 'rtl');
  });
});
