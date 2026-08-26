// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPaletteShell } from './CommandPaletteShell';

describe('CommandPaletteShell localization', () => {
  it('uses the route locale for its dialog and search control', () => {
    render(<CommandPaletteShell lang="ja" open onClose={vi.fn()} onActivate={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'コマンドパレット' })).toBeTruthy();
    expect(screen.getByPlaceholderText(/機能を検索/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });
});
