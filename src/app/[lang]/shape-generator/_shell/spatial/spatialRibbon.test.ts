import { describe, expect, it } from 'vitest';
import { spatialRibbonGroups, spatialRibbonTabs } from './spatialRibbon';

describe('building spatial ribbon', () => {
  it('uses a valid building tab as the domain default', () => {
    expect(spatialRibbonTabs('building')[0]?.id).toBe('space.model');
  });

  it('exposes only wired actions in deliverables', () => {
    const ids = spatialRibbonGroups('building', 'standard', 'space.deliverables')
      .flatMap(group => group.rows.flat())
      .map(action => action.id);
    expect(ids).toEqual(['spatial.verify', 'spatial.ai']);
    expect(ids).not.toContain('spatial.section.deliverables');
  });
});

describe('landscape spatial ribbon', () => {
  it('exposes real plan, 3D, check and AI actions without contract placeholders', () => {
    expect(spatialRibbonTabs('landscape').map(tab => tab.id)).toEqual(['space.model', 'space.planting', 'space.water', 'space.inspect']);
    const modelIds = spatialRibbonGroups('landscape', 'standard', 'space.model').flatMap(group => group.rows.flat()).map(action => action.id);
    const checkIds = spatialRibbonGroups('landscape', 'standard', 'space.inspect').flatMap(group => group.rows.flat()).map(action => action.id);
    expect(modelIds).toEqual(['spatial.dimensions', 'spatial.plan', 'spatial.3d', 'spatial.ai']);
    expect(checkIds).toEqual(['spatial.verify', 'spatial.ai']);
  });
});

describe('civil spatial ribbon', () => {
  it('exposes real survey, alignment, drainage and check actions', () => {
    expect(spatialRibbonTabs('civil').map(tab => tab.id)).toEqual(['space.survey', 'space.alignment', 'space.drainage', 'space.inspect']);
    expect(spatialRibbonGroups('civil', 'standard', 'space.survey').flatMap(group => group.rows.flat()).map(action => action.id)).toEqual(['spatial.dimensions', 'spatial.plan', 'spatial.3d', 'spatial.ai']);
    expect(spatialRibbonGroups('civil', 'standard', 'space.inspect').flatMap(group => group.rows.flat()).map(action => action.id)).toEqual(['spatial.verify', 'spatial.ai']);
  });
});

describe('coordination ribbon', () => {
  it('separates federation, clash, issue and evidence workflows', () => {
    expect(spatialRibbonTabs('coordination').map(tab => tab.id)).toEqual(['space.federation', 'space.clashes', 'space.issues', 'space.evidence']);
    expect(spatialRibbonGroups('coordination', 'standard', 'space.clashes').flatMap(group => group.rows.flat()).map(action => action.id)).toEqual(['spatial.verify']);
    expect(spatialRibbonGroups('coordination', 'standard', 'space.federation').flatMap(group => group.rows.flat()).map(action => action.id)).toEqual(['spatial.plan', 'spatial.dimensions']);
    expect(spatialRibbonGroups('coordination', 'standard', 'space.evidence').flatMap(group => group.rows.flat()).map(action => action.id)).toEqual(['spatial.verify', 'spatial.exact-clash-job']);
  });
});
