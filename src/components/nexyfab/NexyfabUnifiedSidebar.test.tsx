// @vitest-environment jsdom

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockPathname = '/kr/nexyfab/hub';
let mockSearchParams = new URLSearchParams();
const mockLogout = vi.fn();
let mockAuth = {
  user: null as { name: string; plan: string } | null,
  token: null as string | null,
  sessionStatus: 'anonymous' as 'anonymous' | 'authenticated',
  logout: mockLogout,
};

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuthStore: () => mockAuth,
}));

vi.mock('./NotificationBell', () => ({ default: () => null }));
vi.mock('./NexysysAppSwitcher', () => ({ default: () => null }));

import NexyfabUnifiedSidebar from './NexyfabUnifiedSidebar';

describe('NexyfabUnifiedSidebar commercial IA', () => {
  beforeEach(() => {
    mockPathname = '/kr/nexyfab/hub';
    mockSearchParams = new URLSearchParams();
    window.history.replaceState({}, '', '/kr/nexyfab/hub');
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockLogout.mockClear();
    mockAuth = { user: null, token: null, sessionStatus: 'anonymous', logout: mockLogout };
  });

  afterEach(() => cleanup());

  it('presents mechanical CAD as the product and preserves spatial routes under additional services', () => {
    render(<NexyfabUnifiedSidebar lang="kr" />);

    expect(screen.getByRole('link', { name: '새 기계 설계' })).toHaveAttribute('href', '/kr/nexyfab/ai?new=1');
    expect(screen.getByRole('link', { name: 'AI 기계 CAD' })).toHaveAttribute('href', '/kr/nexyfab/ai');
    expect(screen.getByRole('link', { name: '정밀 CAD' })).toHaveAttribute('href', '/kr/shape-generator?expert=1&mode=expert&domain=mech&workMode=precision_cad');
    expect(screen.getByRole('link', { name: '설계 검토·제조' })).toHaveAttribute('href', '/kr/nexyfab/evaluate');
    expect(screen.getByText('부가 서비스')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Space Design Labs BETA' })).toHaveAttribute('href', '/kr/nexyfab/design?domain=building');
    expect(screen.getByRole('link', { name: '내 프로젝트' })).toHaveAttribute('href', '/kr/nexyfab/projects');
    expect(screen.getByRole('link', { name: '예제 및 템플릿' })).toHaveAttribute('href', '/kr/examples');

    const spatialTypes = screen.getByRole('group', { name: 'Space Design Labs 세부 유형' });
    expect(within(spatialTypes).getByRole('link', { name: '건축' })).toHaveAttribute('href', '/kr/nexyfab/design?domain=building');
    expect(within(spatialTypes).getByRole('link', { name: '토목' })).toHaveAttribute('href', '/kr/nexyfab/design?domain=civil');
    expect(within(spatialTypes).getByRole('link', { name: '조경' })).toHaveAttribute('href', '/kr/nexyfab/design?domain=landscape');
    expect(within(spatialTypes).getByRole('link', { name: '인테리어' })).toHaveAttribute('href', '/kr/nexyfab/design?domain=interior');
  });

  it('marks product and mechanical as the single current page in the unified studio', () => {
    mockPathname = '/kr/nexyfab/ai';
    mockSearchParams = new URLSearchParams();
    render(<NexyfabUnifiedSidebar lang="kr" />);

    expect(screen.getByRole('link', { current: 'page' })).toHaveAccessibleName('AI 기계 CAD');
  });

  it('does not mark the new-design action as a second current page', () => {
    mockPathname = '/kr/nexyfab/ai';
    mockSearchParams = new URLSearchParams();
    render(<NexyfabUnifiedSidebar lang="kr" />);

    const currentLinks = screen.getAllByRole('link', { current: 'page' });
    expect(currentLinks).toHaveLength(1);
    expect(currentLinks[0]).toHaveAccessibleName('AI 기계 CAD');
  });

  it('highlights the spatial group while assigning aria-current only to its active subtype', () => {
    mockPathname = '/kr/nexyfab/design';
    mockSearchParams = new URLSearchParams('domain=bridge');
    render(<NexyfabUnifiedSidebar lang="kr" />);

    const groupEntry = screen.getByRole('link', { name: 'Space Design Labs BETA' });
    expect(groupEntry).toHaveAttribute('data-active', 'true');
    expect(groupEntry).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { current: 'page' })).toHaveAccessibleName('토목');
  });

  it('provides complete English accessible labels, including beta status', () => {
    mockPathname = '/en/nexyfab/projects';
    window.history.replaceState({}, '', '/en/nexyfab/projects');
    render(<NexyfabUnifiedSidebar lang="en" />);

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New mechanical design' })).toHaveAttribute('href', '/en/nexyfab/ai?new=1');
    expect(screen.getByRole('link', { name: 'AI Mechanical CAD' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Precision CAD' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review & Manufacturing' })).toBeInTheDocument();
    expect(screen.getByText('Additional services')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Space Design Labs BETA' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Examples & Templates' })).toHaveAttribute('href', '/en/examples');
    expect(screen.getByRole('link', { name: 'My Projects' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['ja', 'メインナビゲーション', '新しい機械設計', 'マイプロジェクト'],
    ['cn', '主导航', '新建机械设计', '我的项目'],
    ['es', 'Navegación principal', 'Nuevo diseño mecánico', 'Mis proyectos'],
    ['ar', 'التنقل الرئيسي', 'تصميم ميكانيكي جديد', 'مشاريعي'],
  ])('localizes the complete navigation for %s', (lang, navigation, newDesign, projects) => {
    mockPathname = `/${lang}/nexyfab/projects`;
    window.history.replaceState({}, '', mockPathname);
    render(<NexyfabUnifiedSidebar lang={lang} />);

    expect(screen.getByRole('navigation', { name: navigation })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: newDesign })).toHaveAttribute('href', `/${lang}/nexyfab/ai?new=1`);
    expect(screen.getByRole('link', { name: projects })).toHaveAttribute('aria-current', 'page');
  });

  it('shows login actions instead of logout for a guest', () => {
    render(<NexyfabUnifiedSidebar lang="en" />);

    fireEvent.click(screen.getByRole('button', { name: /Guest/i }));
    expect(screen.getByRole('menuitem', { name: 'Log in' })).toHaveAttribute('href', '/login?lang=en');
    expect(screen.getByRole('menuitem', { name: 'Create account' })).toHaveAttribute('href', '/register?lang=en');
    expect(screen.queryByRole('menuitem', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('shows logout only for a server-confirmed authenticated user', () => {
    mockAuth = {
      user: { name: 'Beta User', plan: 'pro' },
      token: 'access-token',
      sessionStatus: 'authenticated',
      logout: mockLogout,
    };
    render(<NexyfabUnifiedSidebar lang="en" />);

    fireEvent.click(screen.getByRole('button', { name: /Beta User/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it('updates the active subtype when only the query string changes', () => {
    mockPathname = '/kr/nexyfab/design';
    mockSearchParams = new URLSearchParams('domain=building');
    const view = render(<NexyfabUnifiedSidebar lang="kr" />);
    expect(screen.getByRole('link', { current: 'page' })).toHaveAccessibleName('건축');

    mockSearchParams = new URLSearchParams('domain=interior');
    view.rerender(<NexyfabUnifiedSidebar lang="kr" />);
    expect(screen.getByRole('link', { current: 'page' })).toHaveAccessibleName('인테리어');
  });
});
