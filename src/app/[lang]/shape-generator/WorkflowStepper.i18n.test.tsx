// @vitest-environment jsdom
/**
 * WorkflowStepper.i18n.test.tsx — regression for the hardcoded-English-label
 * bug class (260802 shape-generator i18n audit, batch 7).
 *
 * WorkflowStepper only branched on `lang === 'ko' ? STEPS_KO : STEPS_EN`,
 * so the four step labels (Sketch/Extrude/Features/Done) silently fell back
 * to English for ja/cn/es/ar even though every sibling component in this
 * tree carries a full six-locale dict. Fixed by adding STEPS_JA/CN/ES/AR
 * and looking the labels up from a lang-keyed map with an `en` fallback.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WorkflowStepper from './WorkflowStepper';

const baseProps = {
  isSketchMode: true,
  sketchClosed: false,
  hasResult: false,
  featuresCount: 0,
};

describe('WorkflowStepper — step labels follow lang, not hardcoded to ko/en', () => {
  it('lang=ko: shows Korean labels', () => {
    render(<WorkflowStepper {...baseProps} lang="ko" />);
    expect(screen.getByText('스케치')).toBeInTheDocument();
    expect(screen.getByText('돌출')).toBeInTheDocument();
  });

  it('lang=en: shows English labels', () => {
    render(<WorkflowStepper {...baseProps} lang="en" />);
    expect(screen.getByText('Sketch')).toBeInTheDocument();
    expect(screen.getByText('Extrude')).toBeInTheDocument();
  });

  it('lang=ja: shows Japanese labels, not the bare English word', () => {
    render(<WorkflowStepper {...baseProps} lang="ja" />);
    expect(screen.getByText('スケッチ')).toBeInTheDocument();
    expect(screen.queryByText('Sketch')).not.toBeInTheDocument();
  });

  it('lang=cn: shows Chinese labels, not the bare English word', () => {
    render(<WorkflowStepper {...baseProps} lang="cn" />);
    expect(screen.getByText('草图')).toBeInTheDocument();
    expect(screen.queryByText('Sketch')).not.toBeInTheDocument();
  });

  it('lang=es: shows Spanish labels, not the bare English word', () => {
    render(<WorkflowStepper {...baseProps} lang="es" />);
    expect(screen.getByText('Croquis')).toBeInTheDocument();
    expect(screen.queryByText('Sketch')).not.toBeInTheDocument();
  });

  it('lang=ar: shows Arabic labels, not the bare English word', () => {
    render(<WorkflowStepper {...baseProps} lang="ar" />);
    expect(screen.getByText('الرسم')).toBeInTheDocument();
    expect(screen.queryByText('Sketch')).not.toBeInTheDocument();
  });
});
