// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InteriorPlanEditor from './InteriorPlanEditor';
import type { InteriorPlacementObject } from '@/lib/cad/interiorPlacementDocument';

const object = (id: string, x = 0): InteriorPlacementObject => ({ id, catalogType: 'table4', spaceId: 'room-1', pose: { positionMm: [x, 0, 0], rotationDeg: [0, 0, 0] }, dimensionsMm: [1000, 600, 750], clearanceMm: [0, 0, 0] });
const baseProps = (placement: ReturnType<typeof controller>) => ({ lang: 'en', width: 10_000, depth: 8_000, height: 3_000, doorWidth: 1000, exitCount: 1, rows: 1, cols: 1, furniture: [], onChange: vi.fn(), result: null, placement });
function controller(objects: readonly InteriorPlacementObject[], selectedObjectId: string | null = null) {
  return { objects, selectedObjectId, onSelectObject: vi.fn(), onPreviewMove: vi.fn(), onCommitMove: vi.fn(), onAddObject: vi.fn(), onDeleteObject: vi.fn() };
}
function rect(svg: SVGSVGElement) {
  Object.defineProperty(svg, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) });
  (svg as SVGSVGElement & { setPointerCapture: () => void }).setPointerCapture = vi.fn();
}
function drop(svg: SVGSVGElement, dataTransfer: { types: string[]; getData: (type: string) => string }, clientX: number, clientY: number) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, clientX: { value: clientX }, clientY: { value: clientY } });
  fireEvent(svg, event);
}

describe('InteriorPlanEditor typed DOM contract', () => {
  it('uses shared MIME drop physical point, stops outer duplicate handling, and keeps RTL x physical', () => {
    const item = controller([]); const outerDrop = vi.fn();
    const view = render(<div onDrop={outerDrop}><InteriorPlanEditor {...baseProps(item)} /></div>);
    const svg = view.container.querySelector('svg')!;
    rect(svg);
    const dataTransfer = { types: ['application/x-nexyfab-spatial-object'], getData: (type: string) => type === 'application/x-nexyfab-spatial-object' ? 'table4' : '' };
    drop(svg, dataTransfer, 250, 250);
    expect(item.onAddObject).toHaveBeenCalledOnce();
    expect(outerDrop).not.toHaveBeenCalled();
    const ltrPosition = item.onAddObject.mock.calls[0]![1] as readonly [number, number, number];
    expect(ltrPosition).toEqual([-2800, -1700, 0]);
    const xLtr = ltrPosition[0];
    view.unmount();
    const rtl = controller([]); const rtlView = render(<InteriorPlanEditor {...baseProps(rtl)} lang="ar" />);
    const rtlSvg = rtlView.container.querySelector('svg')!; rect(rtlSvg);
    drop(rtlSvg, dataTransfer, 250, 250);
    expect((rtl.onAddObject.mock.calls[0]![1] as readonly [number, number, number])[0]).toBe(xLtr);
  });

  it('selects on pointer click, previews on move, and commits exactly once on pointerup', () => {
    const item = controller([object('table-1')]); const view = render(<InteriorPlanEditor {...baseProps(item)} />);
    const svg = view.container.querySelector('svg')!; rect(svg);
    const furniture = screen.getByRole('button', { name: /table4 table-1/ });
    fireEvent.focus(furniture); expect(item.onSelectObject).not.toHaveBeenCalled();
    fireEvent.pointerDown(furniture, { clientX: 500, clientY: 400, pointerId: 1 });
    expect(item.onSelectObject).toHaveBeenCalledWith('table-1');
    fireEvent.pointerMove(svg, { clientX: 520, clientY: 420, pointerId: 1 });
    expect(item.onPreviewMove).toHaveBeenCalled(); expect(item.onCommitMove).not.toHaveBeenCalled();
    fireEvent.pointerUp(svg, { clientX: 520, clientY: 420, pointerId: 1 });
    expect(item.onCommitMove).toHaveBeenCalledOnce();
  });

  it('supports stable Delete/arrows and disables add at the 40-object limit', () => {
    const item = controller(Array.from({ length: 40 }, (_, index) => object(`table-${index}`, index * 100)), 'table-0');
    const view = render(<InteriorPlanEditor {...baseProps(item)} />);
    const svg = view.container.querySelector('svg')!; rect(svg);
    const furniture = screen.getByRole('button', { name: /table4 table-0/ });
    fireEvent.pointerDown(furniture, { clientX: 500, clientY: 400, pointerId: 1 });
    fireEvent.keyDown(furniture, { key: 'ArrowRight' });
    fireEvent.keyDown(furniture, { key: 'Delete' });
    expect(item.onCommitMove).toHaveBeenCalled(); expect(item.onDeleteObject).toHaveBeenCalledWith('table-0');
    fireEvent.click(screen.getByRole('button', { name: /2-seat table/ }));
    expect(item.onAddObject).not.toHaveBeenCalled();
  });
});
