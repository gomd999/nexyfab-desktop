// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceExperienceSwitcher } from './WorkspaceExperienceSwitcher';

describe('WorkspaceExperienceSwitcher', () => {
  it('exposes the current novice/expert view as an accessible pressed state', () => {
    const onChange = vi.fn();
    render(<WorkspaceExperienceSwitcher mode="studio" lang="en" onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Guided AI' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Expert CAD' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Verification is not promoted automatically');

    fireEvent.click(screen.getByRole('button', { name: 'Expert CAD' }));
    expect(onChange).toHaveBeenCalledWith('expert');
  });

  it.each([
    ['kr', 'AI 안내', '전문 CAD'],
    ['ja', 'AIガイド', 'エキスパートCAD'],
    ['cn', 'AI 引导', '专家 CAD'],
    ['es', 'IA guiada', 'CAD experto'],
    ['ar', 'ذكاء اصطناعي موجّه', 'CAD متقدم'],
  ])('uses the complete locale catalog for %s', (lang, guided, expert) => {
    render(<WorkspaceExperienceSwitcher mode="studio" lang={lang} onChange={() => {}} />);

    expect(screen.getByRole('button', { name: guided })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: expert })).toBeInTheDocument();
  });
});
