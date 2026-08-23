// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DESIGN_RESULT_TRUST_I18N, DesignResultTrustPanel } from './DesignResultTrustPanel';

describe('DesignResultTrustPanel', () => {
  it('does not promote a generation gate or STEP export to manufacturing verification', () => {
    render(
      <DesignResultTrustPanel
        lang="kr"
        hasGeometry
        hasFeatureProgram
        analyticStepHandoffPassed
        generationGateStatus="passed"
        revisionId="intent-aabbcc"
        artifactSha256={'a'.repeat(64)}
      />,
    );
    expect(screen.getByText('제조 전 검토 필요')).toBeInTheDocument();
    expect(screen.queryByText('제조 게이트 검증됨')).not.toBeInTheDocument();
    expect(screen.getByText(/생성 검사 통과/)).toBeInTheDocument();
    expect(screen.getByTestId('design-revision-binding')).toHaveTextContent('REV intent-aabbcc');
  });

  it('keeps mesh-only output at concept level', () => {
    render(
      <DesignResultTrustPanel
        lang="en"
        hasGeometry
        hasFeatureProgram={false}
        analyticStepHandoffPassed={false}
        generationGateStatus="passed"
      />,
    );
    expect(screen.getByText('Concept only')).toBeInTheDocument();
    expect(screen.getByText(/does not prove manufacturability/)).toBeInTheDocument();
  });

  it('keeps a missing generation receipt at not-run instead of passing it', () => {
    render(
      <DesignResultTrustPanel
        lang="kr"
        hasGeometry={false}
        hasFeatureProgram
        analyticStepHandoffPassed={false}
        generationGateStatus="not_run"
      />,
    );
    expect(screen.getByTestId('generation-gate-status')).toHaveTextContent('생성 검사 미실행');
    expect(screen.queryByText(/생성 검사 통과/)).not.toBeInTheDocument();
  });

  it('has complete copy for all supported site languages', () => {
    for (const copy of Object.values(DESIGN_RESULT_TRUST_I18N)) {
      for (const value of Object.values(copy)) expect(value.trim()).not.toBe('');
    }
  });
});
