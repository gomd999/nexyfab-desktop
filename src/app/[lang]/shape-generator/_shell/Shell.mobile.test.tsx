import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';

const baseProps = {
  mode: 'modeling' as const,
  titleBar: { filename: 'mobile-test.nxpart' },
  ribbon: {
    activeTab: 'solid',
    onTabChange: vi.fn(),
    onTool: vi.fn(),
  },
  domainWorkspace: <div data-testid="domain-chrome">Domain chrome</div>,
  workflow: <div data-testid="workflow-chrome">Workflow chrome</div>,
  left: <div data-testid="left-chrome">Left chrome</div>,
  right: <div data-testid="right-chrome">Right chrome</div>,
  viewport: <main data-testid="phone-surface">Phone surface</main>,
  bottomDrawer: <div data-testid="drawer-chrome">Drawer chrome</div>,
  statusBar: { left: [{ id: 'units', items: ['mm'] }] },
};

describe('Shell phone layout', () => {
  it('renders only the hosted phone surface in viewport-only mode', () => {
    const html = renderToStaticMarkup(<Shell {...baseProps} viewportOnly />);

    expect(html).toContain('data-viewport-only="true"');
    expect(html).toContain('data-testid="phone-surface"');
    expect(html).not.toContain('mobile-test.nxpart');
    expect(html).not.toContain('data-testid="domain-chrome"');
    expect(html).not.toContain('data-testid="workflow-chrome"');
    expect(html).not.toContain('data-testid="left-chrome"');
    expect(html).not.toContain('data-testid="right-chrome"');
    expect(html).not.toContain('data-testid="drawer-chrome"');
    expect(html).not.toContain('class="nx-ribbon"');
    expect(html).not.toContain('class="nx-status"');
  });

  it('preserves the complete desktop CAD shell by default', () => {
    const html = renderToStaticMarkup(<Shell {...baseProps} />);

    expect(html).not.toContain('data-viewport-only');
    expect(html).toContain('mobile-test.nxpart');
    expect(html).toContain('data-testid="domain-chrome"');
    expect(html).toContain('data-testid="workflow-chrome"');
    expect(html).toContain('data-testid="left-chrome"');
    expect(html).toContain('data-testid="right-chrome"');
    expect(html).toContain('data-testid="drawer-chrome"');
    expect(html).toContain('class="nx-ribbon"');
    expect(html).toContain('class="nx-status"');
    expect(html).toContain('data-testid="shell-left-panel-resizer"');
    expect(html).toContain('data-testid="shell-right-panel-resizer"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="280"');
    expect(html).toContain('aria-valuenow="320"');
  });
});
