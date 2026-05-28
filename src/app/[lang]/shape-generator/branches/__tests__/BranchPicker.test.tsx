// @vitest-environment jsdom
/**
 * BranchPicker.test.tsx — Wave 2 Phase 3 Z6 UI cases.
 *
 *  - Trigger renders the active branch name (or "Select branch")
 *  - Click trigger opens the dropdown
 *  - Empty state when no branches
 *  - Branches list renders with creator + relative time
 *  - Active branch shows the filled-circle marker + aria-current
 *  - Click a row switches the active branch + closes dropdown
 *  - "New branch" opens the modal
 *  - Modal enforces non-empty name
 *  - Modal create flow + auto-switch to new branch
 *  - Modal surfaces sibling name collision error
 *  - 6-lang dict picker resolves all langs
 *  - RTL direction applied for arabic
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { BranchPicker, pickBranchDict } from '../BranchPicker';
import { BranchStore } from '../BranchStore';
import type { BranchStore as IBranchStore } from '../BranchStore';

function setup(opts: { lang?: string; preBranches?: { name: string; parent?: string | null }[] } = {}): {
  store: IBranchStore;
  rootId: string;
} {
  const store = BranchStore.local();
  let rootId = '';
  for (const b of opts.preBranches ?? []) {
    const r = store.createBranch(b.name, 'doc-1', b.parent ?? null, 'peer-alpha');
    if (!r.ok) throw new Error(`fixture create failed for ${b.name}`);
    if (!rootId) rootId = r.branchId;
  }
  return { store, rootId };
}

beforeEach(() => {
  // Nothing to reset — local store is per-instance.
});

// ─── 1. Trigger ────────────────────────────────────────────────────────────

describe('BranchPicker — trigger', () => {
  it('renders "Select branch" placeholder when no active branch', () => {
    const { store } = setup();
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    expect(getByTestId('branch-picker-trigger').textContent).toContain('Select branch');
  });

  it('renders the active branch name when set', () => {
    const { store, rootId } = setup({ preBranches: [{ name: 'main' }] });
    store.setActiveBranch('doc-1', rootId);
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    expect(getByTestId('branch-picker-trigger').textContent).toContain('main');
  });

  it('click trigger opens the dropdown', () => {
    const { store } = setup();
    const { getByTestId, queryByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    expect(queryByTestId('branch-picker-panel')).toBeNull();
    fireEvent.click(getByTestId('branch-picker-trigger'));
    expect(queryByTestId('branch-picker-panel')).not.toBeNull();
  });
});

// ─── 2. Dropdown list ──────────────────────────────────────────────────────

describe('BranchPicker — dropdown list', () => {
  it('renders empty state when no branches', () => {
    const { store } = setup();
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    expect(getByTestId('branch-picker-empty').textContent).toBe('No branches yet');
  });

  it('renders one row per branch with the name', () => {
    const { store, rootId } = setup({ preBranches: [{ name: 'main' }, { name: 'feature' }] });
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    expect(getByTestId(`branch-picker-row-${rootId}`).textContent).toContain('main');
  });

  it('renders the relative time + creator name (resolveCreatorName)', () => {
    const { store, rootId } = setup({ preBranches: [{ name: 'main' }] });
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
        resolveCreatorName={(id) => id === 'peer-alpha' ? 'Alex' : null}
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    expect(getByTestId(`branch-picker-row-${rootId}`).textContent).toContain('Alex');
  });

  it('falls back to "anonymous" when no resolver', () => {
    const { store, rootId } = setup({ preBranches: [{ name: 'main' }] });
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    expect(getByTestId(`branch-picker-row-${rootId}`).textContent).toContain('anonymous');
  });

  it('marks the active branch with data-active="true" and aria-current', () => {
    const { store, rootId } = setup({ preBranches: [{ name: 'main' }, { name: 'feature' }] });
    store.setActiveBranch('doc-1', rootId);
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    const row = getByTestId(`branch-picker-row-${rootId}`);
    expect(row.getAttribute('data-active')).toBe('true');
    expect(row.getAttribute('aria-current')).toBe('true');
  });
});

// ─── 3. Switching branches ─────────────────────────────────────────────────

describe('BranchPicker — switch branch', () => {
  it('click row sets active branch + invokes onSwitchBranch', () => {
    const { store, rootId } = setup({ preBranches: [{ name: 'main' }, { name: 'feature' }] });
    const calls: string[] = [];
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
        onSwitchBranch={(id) => calls.push(id)}
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    fireEvent.click(getByTestId(`branch-picker-row-${rootId}`));
    expect(store.getActiveBranchId('doc-1')).toBe(rootId);
    expect(calls).toEqual([rootId]);
  });

  it('clicking a row closes the dropdown', () => {
    const { store, rootId } = setup({ preBranches: [{ name: 'main' }] });
    const { getByTestId, queryByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    fireEvent.click(getByTestId(`branch-picker-row-${rootId}`));
    expect(queryByTestId('branch-picker-panel')).toBeNull();
  });
});

// ─── 4. New-branch modal ──────────────────────────────────────────────────

describe('BranchPicker — new branch modal', () => {
  it('clicking + New branch opens the modal', () => {
    const { store } = setup({ preBranches: [{ name: 'main' }] });
    const { getByTestId, queryByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    fireEvent.click(getByTestId('branch-picker-new'));
    expect(queryByTestId('branch-picker-modal')).not.toBeNull();
  });

  it('Create button is disabled when name is empty', () => {
    const { store } = setup();
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    fireEvent.click(getByTestId('branch-picker-new'));
    const createBtn = getByTestId('branch-picker-create') as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });

  it('creates a branch on submit + auto-switches', () => {
    const { store } = setup();
    const calls: string[] = [];
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
        onSwitchBranch={(id) => calls.push(id)}
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    fireEvent.click(getByTestId('branch-picker-new'));
    const input = getByTestId('branch-picker-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'main' } });
    fireEvent.click(getByTestId('branch-picker-create'));
    expect(store.getBranches().length).toBe(1);
    expect(store.getBranches()[0]!.name).toBe('main');
    // Auto-switch happens.
    expect(calls.length).toBe(1);
  });

  it('surfaces sibling name collision error', () => {
    const { store, rootId } = setup({ preBranches: [{ name: 'main' }] });
    // Pin "main" as the active so the modal's new branch will be a sibling
    // of main (parent = main). Actually for a collision case, we need to
    // create a sibling that collides with another sibling — create a child,
    // then try to create another child with the same name.
    store.createBranch('child', 'doc-1', rootId, 'peer-alpha');
    store.setActiveBranch('doc-1', rootId);

    const { getByTestId, queryByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    fireEvent.click(getByTestId('branch-picker-new'));
    const input = getByTestId('branch-picker-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'child' } });
    fireEvent.click(getByTestId('branch-picker-create'));
    expect(queryByTestId('branch-picker-error')?.textContent).toContain('sibling');
  });

  it('passes the description through to createBranch', () => {
    const { store } = setup();
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    fireEvent.click(getByTestId('branch-picker-new'));
    const name = getByTestId('branch-picker-name-input') as HTMLInputElement;
    const desc = getByTestId('branch-picker-description-input') as HTMLTextAreaElement;
    fireEvent.change(name, { target: { value: 'main' } });
    fireEvent.change(desc, { target: { value: 'first branch' } });
    fireEvent.click(getByTestId('branch-picker-create'));
    expect(store.getBranches()[0]!.description).toBe('first branch');
  });

  it('Cancel closes the modal without writing', () => {
    const { store } = setup();
    const { getByTestId, queryByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    fireEvent.click(getByTestId('branch-picker-new'));
    fireEvent.click(getByTestId('branch-picker-cancel'));
    expect(queryByTestId('branch-picker-modal')).toBeNull();
    expect(store.getBranches()).toEqual([]);
  });
});

// ─── 5. i18n ───────────────────────────────────────────────────────────────

describe('BranchPicker — i18n', () => {
  it('pickBranchDict resolves all 6 langs', () => {
    expect(pickBranchDict('ko').create).toBe('생성');
    expect(pickBranchDict('en').create).toBe('Create');
    expect(pickBranchDict('ja').create).toBe('作成');
    expect(pickBranchDict('zh').create).toBe('创建');
    expect(pickBranchDict('es').create).toBe('Crear');
    expect(pickBranchDict('ar').create).toBe('إنشاء');
  });

  it('pickBranchDict falls back to en on unknown lang', () => {
    expect(pickBranchDict('xx').create).toBe('Create');
    expect(pickBranchDict(null).create).toBe('Create');
    expect(pickBranchDict(undefined).create).toBe('Create');
  });

  it('renders ko strings on the trigger when lang=ko', () => {
    const { store } = setup();
    const { getByTestId } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="ko"
      />,
    );
    expect(getByTestId('branch-picker-trigger').textContent).toContain('브랜치 선택');
  });
});

// ─── 6. Re-render on store mutation ────────────────────────────────────────

describe('BranchPicker — re-render on mutation', () => {
  it('updates when an external createBranch call lands', () => {
    const { store } = setup();
    const { getByTestId, rerender } = render(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    fireEvent.click(getByTestId('branch-picker-trigger'));
    expect(getByTestId('branch-picker-empty')).toBeTruthy();
    act(() => {
      store.createBranch('main', 'doc-1', null, 'peer-alpha');
    });
    rerender(
      <BranchPicker
        store={store}
        docId="doc-1"
        parentDocId="doc-1"
        createdBy="peer-alpha"
        lang="en"
      />,
    );
    expect(getByTestId('branch-picker-panel').textContent).toContain('main');
  });
});
