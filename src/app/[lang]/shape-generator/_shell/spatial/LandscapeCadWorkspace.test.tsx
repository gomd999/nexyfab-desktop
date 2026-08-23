// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LandscapeCadWorkspace } from './LandscapeCadWorkspace';
import { dispatchSpatialCadCommand } from './spatialCadCommands';

vi.mock('../../../nexyfab/design/AssemblyViewer3D', () => ({ default: ({ parts }: { parts: unknown[] }) => <div data-testid="mock-landscape-viewer">parts:{parts.length}</div> }));

describe('LandscapeCadWorkspace', () => {
  it('renders semantic planting layout and keeps external authority NOT_RUN', () => {
    render(<LandscapeCadWorkspace lang="en" onAiDesign={vi.fn()}/>);
    expect(screen.getByTestId('landscape-plan')).toBeInTheDocument();
    expect(screen.getByTestId('landscape-spatial-cad')).toHaveTextContent('12 trees');
    expect(screen.getByTestId('landscape-verification')).toHaveTextContent('Approved terrain & coordinates: NOT_RUN');
  });
  it('runs only local consistency as PREVIEW', () => {
    render(<LandscapeCadWorkspace lang="en" onAiDesign={vi.fn()}/>);
    fireEvent.click(screen.getByTestId('landscape-run-verify'));
    expect(screen.getByTestId('landscape-verification')).toHaveTextContent('Document & geometry consistency: PREVIEW');
    expect(screen.getByTestId('landscape-verification')).toHaveTextContent('Irrigation hydraulics: NOT_RUN');
  });
  it('commits human numeric drafts on blur and supports ribbon 3D', async () => {
    render(<LandscapeCadWorkspace lang="en" onAiDesign={vi.fn()}/>);
    const width = screen.getByRole('spinbutton', { name: 'Site width (m)' });
    fireEvent.change(width, { target: { value: '35.5' } });
    expect(screen.getByText(/30 × 24 m/)).toBeInTheDocument();
    fireEvent.blur(width);
    expect(screen.getByText(/35.5 × 24 m/)).toBeInTheDocument();
    act(() => dispatchSpatialCadCommand('spatial.3d'));
    expect(await screen.findByTestId('mock-landscape-viewer')).toBeInTheDocument();
    expect(screen.getByText('CONCEPT · geometry preview')).toBeInTheDocument();
  });
});
