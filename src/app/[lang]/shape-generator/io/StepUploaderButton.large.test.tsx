// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const parseStep = vi.hoisted(() => vi.fn());
const importLargeStepDirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ usePathname: () => '/en/shape-generator' }));
vi.mock('../workers/useStepWorker', () => ({ useStepWorker: () => ({ parseStep }) }));
vi.mock('./directLargeStepImport', () => ({ importLargeStepDirect }));
import StepUploaderButton from './StepUploaderButton';

describe('StepUploaderButton large STEP route', () => {
  it('routes 417 MB through direct private upload and never invokes browser OCCT', async () => {
    const geometry = new THREE.BoxGeometry(10, 20, 30);
    importLargeStepDirect.mockResolvedValue({ geometry });
    const onResult = vi.fn();
    const { container } = render(<StepUploaderButton onResult={onResult} lang="en" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fixture'], 'loader.step', { type: 'application/step' });
    Object.defineProperty(file, 'size', { value: 417 * 1024 * 1024 });
    Object.defineProperty(file, 'arrayBuffer', { value: vi.fn(() => { throw new Error('browser buffer path forbidden'); }) });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(importLargeStepDirect).toHaveBeenCalledWith(file);
    expect(parseStep).not.toHaveBeenCalled();
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ geometry, isSolid: false, isManifold: false });
  });
});
