// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NexysysAppSwitcher from './NexysysAppSwitcher';

afterEach(cleanup);

const EXPECTED = {
  kr: ['협업 그룹웨어', '제조 견적 플랫폼', '비즈니스 인텔리전스'],
  en: ['Collaboration groupware', 'Manufacturing quotation platform', 'Business intelligence'],
  ja: ['コラボレーション・グループウェア', '製造見積プラットフォーム', 'ビジネスインテリジェンス'],
  cn: ['协作群件', '制造报价平台', '商业智能'],
  es: ['Suite de colaboración', 'Plataforma de cotización de fabricación', 'Inteligencia empresarial'],
  ar: ['منصة تعاون جماعي', 'منصة عروض أسعار التصنيع', 'ذكاء الأعمال'],
} as const;

describe('NexysysAppSwitcher', () => {
  it.each(Object.entries(EXPECTED))('renders the %s product taglines', (lang, taglines) => {
    render(<NexysysAppSwitcher lang={lang} />);
    for (const tagline of taglines) expect(screen.getByText(tagline)).toBeInTheDocument();
  });

  it.each(['en', 'ja', 'cn', 'es', 'ar'])('%s does not fall back to Korean', lang => {
    const { container } = render(<NexysysAppSwitcher lang={lang} />);
    expect(container.textContent).not.toMatch(/[\u3131-\u318e\uac00-\ud7a3]/u);
  });
});
