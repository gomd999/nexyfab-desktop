// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InteriorPlacementAiCandidate } from '@/lib/ai/interiorPlacementAiCandidate';
import { InteriorPlacementAiCandidateBridge } from './InteriorPlacementAiCandidateBridge';

const candidate = {
  selectedObjectId: 'table-1',
  parameterPaths: ['pose.positionMm'],
  reviewFingerprint: 'a'.repeat(64),
} as unknown as InteriorPlacementAiCandidate;

describe('InteriorPlacementAiCandidateBridge', () => {
  it.each([
    ['kr', '선택 객체 AI 수정 검토', 'ltr'],
    ['en', 'Review selected-object AI patch', 'ltr'],
    ['ja', '選択オブジェクトのAI修正を確認', 'ltr'],
    ['cn', '检查选定对象的 AI 修改', 'ltr'],
    ['es', 'Revisar el cambio de IA del objeto seleccionado', 'ltr'],
    ['ar', 'مراجعة تعديل الذكاء الاصطناعي للكائن المحدد', 'rtl'],
  ])('renders the %s copy and direction', (lang, title, direction) => {
    render(<InteriorPlacementAiCandidateBridge candidate={candidate} lang={lang} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByTestId('interior-placement-ai-candidate')).toHaveAttribute('dir', direction);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByTestId('interior-placement-ai-candidate-apply')).toBeEnabled();
    expect(screen.getByTestId('interior-placement-ai-candidate-discard')).toBeEnabled();
  });

  it('uses pending copy and disables both actions while applying', () => {
    render(<InteriorPlacementAiCandidateBridge candidate={candidate} lang="en" pending onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText('Applying…')).toBeInTheDocument();
    expect(screen.getByTestId('interior-placement-ai-candidate-apply')).toBeDisabled();
    expect(screen.getByTestId('interior-placement-ai-candidate-discard')).toBeDisabled();
  });
});
