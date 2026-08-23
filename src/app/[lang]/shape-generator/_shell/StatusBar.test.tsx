import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar';

describe('StatusBar autosave contract', () => {
  it.each([
    ['default', 'ready'],
    ['default', 'saving'],
    ['ok', 'saved'],
    ['error', 'error'],
  ] as const)('exposes cloud tone %s as %s', (tone, expected) => {
    const html = renderToStaticMarkup(<StatusBar pills={[{ id: 'cloud', label: expected, tone, saveState: expected }]} />);

    expect(html).toContain('data-testid="autosave-indicator"');
    expect(html).toContain(`data-save-state="${expected}"`);
  });

  it('does not label unrelated status pills as autosave', () => {
    const html = renderToStaticMarkup(<StatusBar pills={[{ id: 'fps', label: '60 fps', tone: 'ok' }]} />);

    expect(html).not.toContain('data-testid="autosave-indicator"');
  });
});
