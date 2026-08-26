/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CAMWorkspacePanel from './CAMWorkspacePanel';

let pathname = '/en/shape-generator';

vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

describe('CAMWorkspacePanel i18n', () => {
  it.each([
    ['kr', 'CAM 작업공간(베타)'],
    ['en', 'CAM Workspace (Beta)'],
    ['ja', 'CAM ワークスペース（ベータ）'],
    ['cn', 'CAM 工作区（测试版）'],
    ['es', 'Espacio de trabajo CAM (beta)'],
    ['ar', 'مساحة عمل CAM (تجريبية)'],
  ])('renders localized workspace chrome for %s', (segment, expected) => {
    pathname = `/${segment}/shape-generator`;
    render(<CAMWorkspacePanel />);
    expect(screen.getByRole('heading', { name: expected })).toBeInTheDocument();
  });
});
