/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceLoading } from './WorkspaceLoading';

let pathname = '/en/shape-generator';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

describe('WorkspaceLoading i18n', () => {
  it.each([
    ['kr', '3D 작업공간을 불러오는 중…'],
    ['en', 'Loading 3D workspace…'],
    ['ja', '3D ワークスペースを読み込み中…'],
    ['cn', '正在加载 3D 工作区…'],
    ['es', 'Cargando el espacio de trabajo 3D…'],
    ['ar', 'جارٍ تحميل مساحة العمل ثلاثية الأبعاد…'],
  ])('renders the page loading message for %s', (segment, expected) => {
    pathname = `/${segment}/shape-generator`;
    render(<WorkspaceLoading />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
