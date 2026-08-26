// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MODE_DEFAULT_TABS, ModeRibbon } from './ModeRibbons';
import { TitleBar } from './TitleBar';
import { localizeRibbonAction, localizeRibbonGroup, localizeRibbonTabs, shellChromeText } from './shellChromeI18n';

describe('precision CAD shell chrome localization', () => {
  it('normalizes all six public route locales for shell, ribbon, and tab copy', () => {
    const expected = {
      kr: ['새로 만들기', '돌출', '파일', '생성'],
      en: ['New', 'Extrude', 'File', 'Create'],
      ja: ['新規作成', '押し出し', 'ファイル', '作成'],
      cn: ['新建', '拉伸', '文件', '创建'],
      es: ['Nuevo', 'Extruir', 'Archivo', 'Crear'],
      ar: ['جديد', 'بثق', 'ملف', 'إنشاء'],
    } as const;

    for (const [lang, values] of Object.entries(expected)) {
      expect(shellChromeText(lang, 'new')).toBe(values[0]);
      expect(localizeRibbonAction('extrude', 'Extrude', lang)).toBe(values[1]);
      expect(localizeRibbonTabs([{ id: 'file', label: 'File' }], lang)[0].label).toBe(values[2]);
      expect(localizeRibbonGroup('Create', lang)).toBe(values[3]);
    }
  });

  it('renders localized accessible names in the Japanese title bar', () => {
    render(
      <TitleBar
        lang="ja"
        onBrandClick={vi.fn()}
        onNew={vi.fn()}
        onOpen={vi.fn()}
        onSave={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onShare={vi.fn()}
        onPublish={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '新規作成' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '全画面' })).toBeTruthy();
    expect(screen.getByText('共有')).toBeTruthy();
    expect(screen.getByText('公開')).toBeTruthy();
    expect(screen.queryByTitle('New')).toBeNull();
    expect(screen.queryByTitle('Fullscreen')).toBeNull();
  });

  it('localizes expert CAD tools and the standard disclosure control', () => {
    const base = {
      mode: 'modeling' as const,
      tabs: MODE_DEFAULT_TABS.modeling,
      activeTab: 'solid',
      onTabChange: vi.fn(),
      onTool: vi.fn(),
    };
    const { rerender } = render(<ModeRibbon {...base} lang="cn" experienceLevel="expert" />);
    expect(screen.getByRole('button', { name: /^拉伸/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '可变圆角' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '文件' })).toBeTruthy();

    rerender(<ModeRibbon {...base} lang="es" experienceLevel="standard" />);
    fireEvent.click(screen.getByRole('button', { name: 'Todas las herramientas' }));
    expect(screen.getByRole('button', { name: 'Redondeo variable' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Herramientas esenciales' })).toBeTruthy();
  });
});
