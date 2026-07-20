/** @vitest-environment jsdom */
/**
 * DimensionAnnotationModal — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone modal tests. Mounts the modal directly with prop fixtures;
 * verifies UI surfaces, kind switching, tolerance form, GD&T form, and
 * onAdd payload shape.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DimensionAnnotationModal, { type DrawingAnnotation } from '@/app/[lang]/shape-generator/drawing/DimensionAnnotationModal';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';

function frontVp(): Viewport {
  return {
    id: 'front',
    sourceId: 'p1',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: 150, y: 150 },
    widthOnSheet: 100,
    scale: 1,
    label: 'FRONT',
  };
}

function sheet(): Sheet {
  return { id: 's', name: 'S', paperSize: 'A3', viewports: [frontVp()] };
}

function mountModal(opts: {
  onAdd?: (a: DrawingAnnotation) => void;
  onClose?: () => void;
  lang?: string;
} = {}) {
  const onAdd = opts.onAdd ?? vi.fn();
  const onClose = opts.onClose ?? vi.fn();
  return {
    onAdd,
    onClose,
    ...render(
      <DimensionAnnotationModal
        lang={opts.lang ?? 'en'}
        sheet={sheet()}
        viewportId="front"
        onAdd={onAdd}
        onClose={onClose}
      />,
    ),
  };
}

describe('DimensionAnnotationModal', () => {
  it('renders the modal shell + both kind radios + submit/cancel buttons', () => {
    mountModal();
    expect(screen.getByTestId('solver-dim-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-dim-kind-dimension')).toBeInTheDocument();
    expect(screen.getByTestId('solver-dim-kind-gdt')).toBeInTheDocument();
    expect(screen.getByTestId('solver-dim-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-dim-cancel')).toBeInTheDocument();
  });

  it('cancel button invokes onClose', () => {
    const { onClose } = mountModal();
    fireEvent.click(screen.getByTestId('solver-dim-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', () => {
    const { onClose } = mountModal();
    fireEvent.click(screen.getByTestId('solver-dim-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('defaults to dimension form, switches to gd&t form on radio click', () => {
    mountModal();
    expect(screen.getByTestId('solver-dim-dimension-form')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-dim-gdt-form')).toBeNull();
    fireEvent.click(screen.getByTestId('solver-dim-kind-gdt'));
    expect(screen.getByTestId('solver-dim-gdt-form')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-dim-dimension-form')).toBeNull();
  });

  it('linear dimension shows exactly 2 ref inputs; radial shows 1', () => {
    mountModal();
    // Linear default → 2 refs.
    expect(screen.getByTestId('solver-dim-ref-0-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-dim-ref-1-input')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-dim-ref-2-input')).toBeNull();

    // Switch to radial → 1 ref.
    fireEvent.change(screen.getByTestId('solver-dim-dimkind-select'), {
      target: { value: 'radial' },
    });
    expect(screen.getByTestId('solver-dim-ref-0-input')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-dim-ref-1-input')).toBeNull();
  });

  it('tolerance kind = bilateral exposes upper/lower inputs', () => {
    mountModal();
    fireEvent.change(screen.getByTestId('solver-dim-tolerance-kind-select'), {
      target: { value: 'bilateral' },
    });
    expect(screen.getByTestId('solver-dim-tolerance-upper-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-dim-tolerance-lower-input')).toBeInTheDocument();
  });

  it('tolerance kind = limit exposes min/max inputs', () => {
    mountModal();
    fireEvent.change(screen.getByTestId('solver-dim-tolerance-kind-select'), {
      target: { value: 'limit' },
    });
    expect(screen.getByTestId('solver-dim-tolerance-min-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-dim-tolerance-max-input')).toBeInTheDocument();
  });

  it('tolerance kind = iso_fit exposes designation input', () => {
    mountModal();
    fireEvent.change(screen.getByTestId('solver-dim-tolerance-kind-select'), {
      target: { value: 'iso_fit' },
    });
    expect(screen.getByTestId('solver-dim-tolerance-designation-input')).toBeInTheDocument();
  });

  it('submit (dimension) fires onAdd with a well-formed Dimension', () => {
    const onAdd = vi.fn();
    mountModal({ onAdd });
    fireEvent.change(screen.getByTestId('solver-dim-ref-0-input'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByTestId('solver-dim-ref-1-input'), { target: { value: 'e2' } });
    fireEvent.change(screen.getByTestId('solver-dim-prefix-input'), { target: { value: 'L' } });
    fireEvent.change(screen.getByTestId('solver-dim-tolerance-kind-select'), {
      target: { value: 'bilateral' },
    });
    fireEvent.change(screen.getByTestId('solver-dim-tolerance-upper-input'), {
      target: { value: '0.05' },
    });
    fireEvent.change(screen.getByTestId('solver-dim-tolerance-lower-input'), {
      target: { value: '0.05' },
    });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const payload = onAdd.mock.calls[0]![0] as Dimension;
    expect(payload.kind).toBe('linear');
    expect(payload.viewportId).toBe('front');
    expect(payload.refs).toEqual(['e1', 'e2']);
    expect(payload.prefix).toBe('L');
    expect(payload.tolerance).toEqual({ kind: 'bilateral', upper: 0.05, lower: 0.05 });
  });

  it('submit (dimension) with an empty ref shows error and does NOT call onAdd', () => {
    const onAdd = vi.fn();
    mountModal({ onAdd });
    // refs left blank.
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId('solver-dim-error').textContent).toMatch(/refs/);
  });

  it('GD&T form: submit fires onAdd with a well-formed GdtCallout', () => {
    const onAdd = vi.fn();
    mountModal({ onAdd });
    fireEvent.click(screen.getByTestId('solver-dim-kind-gdt'));
    fireEvent.change(screen.getByTestId('solver-dim-gdt-kind-select'), {
      target: { value: 'position' },
    });
    fireEvent.change(screen.getByTestId('solver-dim-gdt-target-input'), {
      target: { value: 'face-1' },
    });
    fireEvent.change(screen.getByTestId('solver-dim-gdt-tolerance-input'), {
      target: { value: '0.1' },
    });
    fireEvent.change(screen.getByTestId('solver-dim-gdt-datums-input'), {
      target: { value: 'A, B' },
    });
    fireEvent.change(screen.getByTestId('solver-dim-gdt-mc-select'), {
      target: { value: 'M' },
    });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const payload = onAdd.mock.calls[0]![0] as GdtCallout;
    expect(payload.kind).toBe('position');
    expect(payload.viewportId).toBe('front');
    expect(payload.targetRef).toBe('face-1');
    expect(payload.toleranceValue).toBe(0.1);
    expect(payload.datums).toEqual(['A', 'B']);
    expect(payload.materialCondition).toBe('M');
  });

  it('GD&T submit without targetRef shows error and does NOT call onAdd', () => {
    const onAdd = vi.fn();
    mountModal({ onAdd });
    fireEvent.click(screen.getByTestId('solver-dim-kind-gdt'));
    // leave target blank
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId('solver-dim-error').textContent).toMatch(/targetRef/);
  });

  it('GD&T submit with non-positive tolerance shows error', () => {
    const onAdd = vi.fn();
    mountModal({ onAdd });
    fireEvent.click(screen.getByTestId('solver-dim-kind-gdt'));
    fireEvent.change(screen.getByTestId('solver-dim-gdt-target-input'), {
      target: { value: 'face-1' },
    });
    fireEvent.change(screen.getByTestId('solver-dim-gdt-tolerance-input'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId('solver-dim-error').textContent).toMatch(/positive/);
  });

  it('Korean lang: surfaces 치수 / 추가 labels', () => {
    mountModal({ lang: 'ko' });
    // The 치수 label appears in both the radio label and the dim kind select label.
    expect(screen.getAllByText(/치수/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('solver-dim-submit').textContent).toMatch(/추가/);
  });
});
