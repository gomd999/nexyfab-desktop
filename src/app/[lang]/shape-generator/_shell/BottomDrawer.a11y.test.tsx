// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomDrawer } from './BottomDrawer';

const props = {
  activeTab: 'dfm',
  tabs: [{ id: 'dfm', label: 'DFM' }, { id: 'fea', label: 'FEA' }],
  onTabChange: vi.fn(),
  onClose: vi.fn(),
  children: <div>Analysis results</div>,
};

describe('BottomDrawer accessibility', () => {
  it('does not leave focusable controls in an aria-hidden closed drawer', () => {
    const { container } = render(<BottomDrawer {...props} open={false} />);
    expect(container.querySelector('.nx-bottom-drawer')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps open drawer tabs keyboard reachable and Escape closes it', () => {
    const onClose = vi.fn();
    render(<BottomDrawer {...props} open onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'DFM' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'FEA' })).toBeEnabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('localizes the close control for non-English routes', () => {
    render(<BottomDrawer {...props} lang="ar" open />);
    expect(screen.getByRole('button', { name: 'إغلاق الدرج' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Close drawer' })).toBeNull();
  });
});
