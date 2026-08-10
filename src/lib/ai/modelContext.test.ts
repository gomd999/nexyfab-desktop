import { describe, expect, it } from 'vitest';
import { renderModelContext } from './modelContext';

describe('renderModelContext domain contract', () => {
  it('tells the planner which discipline and workflow are authoritative', () => {
    const rendered = renderModelContext({
      domainWorkspace: { domain: 'landscape', experience: 'guided' },
      features: [],
    });
    expect(rendered).toContain('Design domain: landscape');
    expect(rendered).toContain('User workflow: guided');
    expect(rendered).toContain('do not silently reinterpret');
  });
});
