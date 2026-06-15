/** @vitest-environment jsdom */
/**
 * ConfigurationsPanel — design-variant panel tests (Phase 2.x).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import ConfigurationsPanel, {
  type ConfigurationsLang,
} from '@/app/[lang]/shape-generator/sketch/ConfigurationsPanel';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ConfigurationSet } from '@/lib/cad/configurations';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

afterEach(cleanup);

function node(id: string): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    depth: 5, direction: 'one_sided', mode: 'add',
  };
  return { id, name: id, dependencies: [], payload };
}
const tree: FeatureTree = { nodes: [node('a'), node('b')] };

const set: ConfigurationSet = {
  active: 'base',
  configs: [
    { name: 'base' },
    { name: 'lite', suppress: ['b'], paramOverrides: { a: { depth: 2 } } },
  ],
};

function mount(overrides: Partial<React.ComponentProps<typeof ConfigurationsPanel>> = {}) {
  const onActivate = vi.fn<(name: string) => void>();
  const onApply = vi.fn<(t: FeatureTree) => void>();
  render(<ConfigurationsPanel lang="en" tree={tree} set={set} onActivate={onActivate} onApply={onApply} {...overrides} />);
  return { onActivate, onApply };
}

describe('ConfigurationsPanel', () => {
  it('lists configs, marks the active one, shows suppress + override counts', () => {
    mount();
    expect(screen.getByTestId('configurations-panel')).toBeInTheDocument();
    expect(screen.getByTestId('configurations-row-base').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('configurations-row-lite').getAttribute('data-active')).toBe('false');
    expect(screen.getByTestId('configurations-row-lite').textContent ?? '').toMatch(/1 suppressed/);
    expect(screen.getByTestId('configurations-row-lite').textContent ?? '').toMatch(/1 overrides/);
  });

  it('selecting a config radio fires onActivate', () => {
    const { onActivate } = mount();
    fireEvent.click(screen.getByTestId('configurations-active-lite'));
    expect(onActivate).toHaveBeenCalledWith('lite');
  });

  it('Apply resolves the active config and hands the tree to onApply', () => {
    const { onApply } = mount({ set: { ...set, active: 'lite' } });
    fireEvent.click(screen.getByTestId('configurations-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const resolved = onApply.mock.calls[0][0];
    // 'lite' suppresses node b + overrides a.depth = 2.
    expect(resolved.nodes.find((n) => n.id === 'b')!.suppressed).toBe(true);
    const a = resolved.nodes.find((n) => n.id === 'a')!;
    expect((a.payload as ExtrudeFeature).depth).toBe(2);
  });

  it('shows a validation error + disables Apply for an invalid set', () => {
    mount({ set: { active: 'ghost', configs: [{ name: 'base' }] } });
    expect(screen.getByTestId('configurations-error')).toBeInTheDocument();
    expect((screen.getByTestId('configurations-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('empty config set shows the empty hint', () => {
    mount({ set: { active: '', configs: [] } });
    expect(screen.getByTestId('configurations-empty')).toBeInTheDocument();
  });

  it('localises the title across 6 langs (+ RTL on Arabic)', () => {
    const cases: Array<[ConfigurationsLang, RegExp]> = [
      ['ko', /구성/], ['en', /Configurations/], ['ja', /コンフィギュレーション/],
      ['zh', /配置/], ['es', /Configuraciones/], ['ar', /التكوينات/],
    ];
    for (const [lang, re] of cases) {
      mount({ lang });
      const panel = screen.getByTestId('configurations-panel');
      expect(panel.textContent ?? '').toMatch(re);
      expect(panel.getAttribute('dir')).toBe(lang === 'ar' ? 'rtl' : 'ltr');
      cleanup();
    }
  });
});
