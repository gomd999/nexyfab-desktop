// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiModelSelector } from './AiModelSelector';

afterEach(cleanup);

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
    expect(screen.getByText('Qwen 3.8 Max Preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /qwen 3\.8 max/i }));
    fireEvent.click(screen.getByRole('option', { name: /GPT-5\.6 Terra/i }));

    expect(onChange).toHaveBeenCalledWith('gpt-terra');
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
