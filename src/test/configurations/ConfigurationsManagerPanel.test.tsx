// @vitest-environment jsdom
/**
 * ConfigurationsManagerPanel.test.tsx — interaction coverage for the
 * lightweight manager panel.
 *
 * Covers:
 *   - empty state renders the master row + the empty hint
 *   - populated list renders one row per config
 *   - clicking a row switches active config
 *   - clicking the master row returns to master
 *   - + Add button prompts then creates a config
 *   - rename button prompts then updates the name
 *   - delete button confirms then removes
 *   - cancelled prompt is a no-op
 *   - cancelled confirm is a no-op
 *   - open-table callback fires when provided
 *   - i18n: en / ko strings render
 *   - inert mode (store=null) — add button disabled, no throws
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfigurationsManagerPanel from '@/app/[lang]/shape-generator/configurations/ConfigurationsManagerPanel';
import { ConfigStore } from '@/app/[lang]/shape-generator/configurations/ConfigStore';

function makeStore(): ConfigStore {
  return ConfigStore.local();
}

describe('ConfigurationsManagerPanel — empty state', () => {
  it('renders the master row and empty hint when no configs', () => {
    const store = makeStore();
    render(<ConfigurationsManagerPanel store={store} lang="en" />);
    expect(screen.getByTestId('cfgmgr-row-master')).toBeInTheDocument();
    expect(screen.getByTestId('cfgmgr-empty')).toBeInTheDocument();
    expect(screen.getByText(/No configurations/i)).toBeInTheDocument();
  });

  it('master row is active when no config is activated', () => {
    const store = makeStore();
    render(<ConfigurationsManagerPanel store={store} lang="en" />);
    const master = screen.getByTestId('cfgmgr-row-master');
    // Active marker is the filled bullet '●'.
    expect(master.textContent).toContain('●');
  });
});

describe('ConfigurationsManagerPanel — list rendering', () => {
  it('renders one row per config + master row', () => {
    const store = makeStore();
    store.add('Small', { id: 'c-s' });
    store.add('Medium', { id: 'c-m' });
    store.add('Large', { id: 'c-l' });
    render(<ConfigurationsManagerPanel store={store} lang="en" />);
    expect(screen.getByTestId('cfgmgr-row-master')).toBeInTheDocument();
    expect(screen.getByTestId('cfgmgr-row-c-s')).toBeInTheDocument();
    expect(screen.getByTestId('cfgmgr-row-c-m')).toBeInTheDocument();
    expect(screen.getByTestId('cfgmgr-row-c-l')).toBeInTheDocument();
    expect(screen.getByText('Small')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Large')).toBeInTheDocument();
  });
});

describe('ConfigurationsManagerPanel — switching', () => {
  it('clicking a config row activates it', () => {
    const store = makeStore();
    store.add('A', { id: 'a' });
    store.add('B', { id: 'b' });
    store.activate(null);
    render(<ConfigurationsManagerPanel store={store} lang="en" />);

    fireEvent.click(screen.getByTestId('cfgmgr-row-b'));
    expect(store.getActiveId()).toBe('b');
  });

  it('clicking master row returns to master', () => {
    const store = makeStore();
    store.add('A', { id: 'a' });
    store.activate('a');
    render(<ConfigurationsManagerPanel store={store} lang="en" />);

    fireEvent.click(screen.getByTestId('cfgmgr-row-master'));
    expect(store.getActiveId()).toBeNull();
  });
});

describe('ConfigurationsManagerPanel — add', () => {
  it('+ Add prompts then creates a config', () => {
    const store = makeStore();
    const promptFn = vi.fn(() => 'Custom');
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        promptFn={promptFn}
      />,
    );

    fireEvent.click(screen.getByTestId('cfgmgr-add'));
    expect(promptFn).toHaveBeenCalledTimes(1);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.name).toBe('Custom');
  });

  it('cancelled prompt does not create a config', () => {
    const store = makeStore();
    const promptFn = vi.fn(() => null);
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        promptFn={promptFn}
      />,
    );

    fireEvent.click(screen.getByTestId('cfgmgr-add'));
    expect(store.list()).toHaveLength(0);
  });

  it('empty input falls back to default name', () => {
    const store = makeStore();
    const promptFn = vi.fn(() => '   '); // whitespace
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        promptFn={promptFn}
      />,
    );

    fireEvent.click(screen.getByTestId('cfgmgr-add'));
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.name).toMatch(/^Config /);
  });
});

describe('ConfigurationsManagerPanel — rename', () => {
  it('rename button prompts then updates the name', () => {
    const store = makeStore();
    store.add('Old', { id: 'a' });
    const promptFn = vi.fn(() => 'New');
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        promptFn={promptFn}
      />,
    );

    fireEvent.click(screen.getByTestId('cfgmgr-rename-a'));
    expect(promptFn).toHaveBeenCalled();
    expect(store.get('a')!.name).toBe('New');
  });

  it('cancelled rename does not change the name', () => {
    const store = makeStore();
    store.add('Old', { id: 'a' });
    const promptFn = vi.fn(() => null);
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        promptFn={promptFn}
      />,
    );

    fireEvent.click(screen.getByTestId('cfgmgr-rename-a'));
    expect(store.get('a')!.name).toBe('Old');
  });

  it('clicking rename does NOT switch the row', () => {
    const store = makeStore();
    store.add('A', { id: 'a' });
    store.add('B', { id: 'b' });
    store.activate('a');
    const promptFn = vi.fn(() => 'B2');
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        promptFn={promptFn}
      />,
    );

    fireEvent.click(screen.getByTestId('cfgmgr-rename-b'));
    // Active should remain 'a' — rename click must stopPropagation.
    expect(store.getActiveId()).toBe('a');
  });
});

describe('ConfigurationsManagerPanel — delete', () => {
  it('delete button confirms then removes', () => {
    const store = makeStore();
    store.add('A', { id: 'a' });
    const confirmFn = vi.fn(() => true);
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        confirmFn={confirmFn}
      />,
    );

    fireEvent.click(screen.getByTestId('cfgmgr-delete-a'));
    expect(confirmFn).toHaveBeenCalled();
    expect(store.list()).toHaveLength(0);
  });

  it('cancelled confirm does not remove', () => {
    const store = makeStore();
    store.add('A', { id: 'a' });
    const confirmFn = vi.fn(() => false);
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        confirmFn={confirmFn}
      />,
    );

    fireEvent.click(screen.getByTestId('cfgmgr-delete-a'));
    expect(store.list()).toHaveLength(1);
  });
});

describe('ConfigurationsManagerPanel — open table', () => {
  it('open-table button renders when onOpenTable provided', () => {
    const store = makeStore();
    const onOpenTable = vi.fn();
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        onOpenTable={onOpenTable}
      />,
    );
    fireEvent.click(screen.getByTestId('cfgmgr-open-table'));
    expect(onOpenTable).toHaveBeenCalledTimes(1);
  });

  it('open-table button hidden when not provided', () => {
    const store = makeStore();
    render(<ConfigurationsManagerPanel store={store} lang="en" />);
    expect(screen.queryByTestId('cfgmgr-open-table')).not.toBeInTheDocument();
  });
});

describe('ConfigurationsManagerPanel — close chrome', () => {
  it('close button fires onClose when provided', () => {
    const store = makeStore();
    const onClose = vi.fn();
    render(
      <ConfigurationsManagerPanel
        store={store}
        lang="en"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('cfgmgr-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close button hidden when onClose omitted', () => {
    const store = makeStore();
    render(<ConfigurationsManagerPanel store={store} lang="en" />);
    expect(screen.queryByTestId('cfgmgr-close')).not.toBeInTheDocument();
  });
});

describe('ConfigurationsManagerPanel — i18n', () => {
  it('renders Korean strings', () => {
    const store = makeStore();
    render(<ConfigurationsManagerPanel store={store} lang="ko" />);
    expect(screen.getByText(/구성 관리자/)).toBeInTheDocument();
    expect(screen.getByText(/마스터/)).toBeInTheDocument();
    // The add button label appears both on the button and in the empty
    // hint ("...'+ 구성 추가' 로 시작..."), so scope to the button itself.
    expect(screen.getByTestId('cfgmgr-add').textContent).toMatch(/\+ 구성 추가/);
  });

  it('falls back to en for unknown locale', () => {
    const store = makeStore();
    render(<ConfigurationsManagerPanel store={store} lang="xx" />);
    expect(screen.getByText(/Configurations/)).toBeInTheDocument();
  });
});

describe('ConfigurationsManagerPanel — inert mode', () => {
  it('add button is disabled when store is null', () => {
    render(<ConfigurationsManagerPanel store={null} lang="en" />);
    const btn = screen.getByTestId('cfgmgr-add') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('renders master row + empty hint with store=null', () => {
    render(<ConfigurationsManagerPanel store={null} lang="en" />);
    expect(screen.getByTestId('cfgmgr-row-master')).toBeInTheDocument();
    expect(screen.getByTestId('cfgmgr-empty')).toBeInTheDocument();
  });
});
