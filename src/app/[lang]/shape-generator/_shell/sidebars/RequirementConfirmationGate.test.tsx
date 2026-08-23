// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildGuidedDesignBrief, buildGuidedRequirementGate, seedGuidedBriefInputs } from '@/lib/ai/guidedDesignBrief';
import { RequirementConfirmationGate } from './RequirementConfirmationGate';

describe('RequirementConfirmationGate', () => {
  it('announces missing exact inputs and their exact next question', () => {
    const brief = buildGuidedDesignBrief({
      prompt: 'Design an exact bracket', requestedStage: 'exact', selectedDomains: ['mechanical'],
      inputs: seedGuidedBriefInputs('Design an exact bracket', 'mechanical'),
    });
    render(<RequirementConfirmationGate gate={buildGuidedRequirementGate(brief)} locks={[]} lang="en" />);
    expect(screen.getByTestId('requirement-gate-state')).toHaveTextContent('BLOCKED');
    expect(screen.getByRole('alert')).toHaveTextContent('Please provide Critical dimensions and tolerances');
    expect(screen.getByTestId('requirement-item-mechanical-critical_dimensions')).toHaveTextContent('MISSING');
  });
});
