// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiModelSelector } from './AiModelSelector';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('AiModelSelector', () => {
  it('keeps only Luna selectable for a Free user', () => {
    render(<AiModelSelector modelId="gpt-luna" onChange={vi.fn()} plan="free" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /gpt-5\.6 luna/i }));

    const listbox = screen.getByRole('listbox', { name: 'Choose AI model' });
    expect(within(listbox).getByRole('option', { name: /GPT-5\.6 Luna/i })).toBeEnabled();
    expect(within(listbox).getByRole('option', { name: /DeepSeek Pro/i })).toBeDisabled();
    expect(within(listbox).getByRole('option', { name: /GPT-5\.6 Terra/i })).toBeDisabled();
    expect(within(listbox).getByText(/Native vision is used when supported/i)).toBeInTheDocument();
  });

  it('lets an Enterprise user choose Terra', () => {
    const onChange = vi.fn();
    render(<AiModelSelector modelId="qwen-3.8-max" onChange={onChange} plan="enterprise" lang="en" />);
    expect(screen.getByText('Qwen 3.8 Max')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /qwen 3\.8 max/i }));
    fireEvent.click(screen.getByRole('option', { name: /GPT-5\.6 Terra/i }));

    expect(onChange).toHaveBeenCalledWith('gpt-terra');
  });

  it('lets a Free beta user choose every governed model without payment', () => {
    vi.stubEnv('NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '1');
    const onChange = vi.fn();
    render(<AiModelSelector modelId="gpt-luna" onChange={onChange} plan="free" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /gpt-5\.6 luna/i }));

    const listbox = screen.getByRole('listbox', { name: 'Choose AI model' });
    expect(within(listbox).getByRole('option', { name: /Qwen 3\.7 Max/i })).toBeEnabled();
    expect(within(listbox).getByRole('option', { name: /GPT-5\.6 Terra/i })).toBeEnabled();
    expect(within(listbox).getByText(/No-payment production beta/i)).toBeInTheDocument();
    fireEvent.click(within(listbox).getByRole('option', { name: /Qwen 3\.7 Max/i }));
    expect(onChange).toHaveBeenCalledWith('qwen-3.7-max');
  });

  it('uses Korean selector copy for the public kr route code', () => {
    vi.stubEnv('NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '1');
    render(<AiModelSelector modelId="gpt-luna" onChange={vi.fn()} plan="free" lang="kr" />);
    fireEvent.click(screen.getByRole('button', { name: /gpt-5\.6 luna/i }));

    expect(screen.getByRole('listbox', { name: 'AI 모델 선택' })).toBeInTheDocument();
    expect(screen.getByText('결제 없는 운영 베타: 모든 모델 선택 가능')).toBeInTheDocument();
  });

  it('renders the Arabic selector copy without forcing physical left/right positioning', () => {
    const { container } = render(
      <div dir="rtl"><AiModelSelector modelId="gpt-luna" onChange={vi.fn()} plan="free" lang="ar" /></div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /gpt-5\.6 luna/i }));

    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-label')).toContain('اختيار');
    expect((listbox as HTMLElement).style.insetInlineEnd).toBe('0');
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
  });
});
