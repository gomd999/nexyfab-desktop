// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MODE_DEFAULT_TABS, ModeRibbon } from './ModeRibbons';

const props = {
  mode: 'modeling' as const,
  tabs: MODE_DEFAULT_TABS.modeling,
  activeTab: 'solid',
  onTabChange: vi.fn(),
  onTool: vi.fn(),
};

describe('ModeRibbon experience levels', () => {
  it('keeps guided modeling focused on the smallest complete workflow', () => {
    render(<ModeRibbon {...props} experienceLevel="guided" />);
    expect(screen.getByRole('button', { name: /^Extrude/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Fillet/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Suggest/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revolve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All tools' })).toBeNull();
  });

  it('lets standard users expand advanced tools deliberately', () => {
    render(<ModeRibbon {...props} experienceLevel="standard" />);
    expect(screen.getByRole('button', { name: 'Revolve' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Variable Fillet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All tools' }));
    expect(screen.getByRole('button', { name: 'Variable Fillet' })).toBeTruthy();
  });

  it('shows the full expert ribbon without a disclosure toggle', () => {
    render(<ModeRibbon {...props} experienceLevel="expert" />);
    expect(screen.getByRole('button', { name: 'Variable Fillet' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'All tools' })).toBeNull();
  });
});
