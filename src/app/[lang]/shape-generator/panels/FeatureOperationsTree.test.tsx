// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FeatureOperationsTree from './FeatureOperationsTree';
import type { FeatureHistory, HistoryNode } from '../useFeatureStack';

const node = (id: string, type: HistoryNode['type'], extra: Partial<HistoryNode> = {}): HistoryNode => ({
  id,
  type,
  label: id,
  icon: type === 'sketch' ? '✏️' : '🔧',
  params: {},
  enabled: true,
  expanded: true,
  parentId: 'root',
  children: [],
  editingActive: false,
  timestamp: 1,
  ...extra,
});

const history: FeatureHistory = {
  rootId: 'root',
  activeNodeId: 'fillet-1',
  editingNodeId: 'fillet-1',
  nodes: [
    node('root', 'baseShape', { parentId: null, children: ['sketch-1', 'fillet-1'] }),
    node('sketch-1', 'sketch'),
    node('fillet-1', 'feature', { error: 'edge missing' }),
  ],
};

const colors = { text: '#fff', muted: '#999', accent: '#36f', border: '#333', hover: '#222', input: '#111' };

describe('FeatureOperationsTree', () => {
  it('shows only editable operations and exposes rebuild failures', () => {
    const view = render(
      <FeatureOperationsTree lang="en" history={history} colors={colors} onEdit={() => {}} onToggle={() => {}} onRemove={() => {}} />,
    );
    expect(view.getByTestId('feature-operation-fillet-1')).toBeTruthy();
    expect(view.queryByTestId('feature-operation-sketch-1')).toBeNull();
    expect(view.getByLabelText('Rebuild failed')).toBeTruthy();
  });

  it('opens PropertyManager editing on double-click or Enter', () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const view = render(
      <FeatureOperationsTree lang="en" history={history} colors={colors} onSelect={onSelect} onEdit={onEdit} onToggle={() => {}} onRemove={() => {}} />,
    );
    const row = view.getByTestId('feature-operation-fillet-1');
    fireEvent.doubleClick(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('fillet-1');
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it('keeps suppress and delete actions separate from row selection', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    const view = render(
      <FeatureOperationsTree lang="ko" history={history} colors={colors} onSelect={onSelect} onEdit={() => {}} onToggle={onToggle} onRemove={onRemove} />,
    );
    fireEvent.click(view.getByLabelText('억제: fillet-1'));
    fireEvent.click(view.getByLabelText('삭제: fillet-1'));
    expect(onToggle).toHaveBeenCalledWith('fillet-1');
    expect(onRemove).toHaveBeenCalledWith('fillet-1');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
