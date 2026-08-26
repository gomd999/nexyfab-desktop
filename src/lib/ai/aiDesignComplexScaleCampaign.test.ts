import { describe, expect, it } from 'vitest';
import { AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES, AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES } from './aiDesignCrossDomainConstraintGraph';
import { AI_DESIGN_PARTITION_MAX } from './aiDesignHierarchicalCandidatePartition';
import { PRODUCT_STRUCTURE_MAX_EDGES, PRODUCT_STRUCTURE_MAX_NODES } from './aiDesignProductStructureGraph';
import { runAiDesignComplexScaleCampaign } from './aiDesignComplexScaleCampaign';

describe('AI Design complex scale campaign', () => {
  it('passes the declared maximum synthetic graph and partition boundaries', () => {
    let tick = 100;
    const campaign = runAiDesignComplexScaleCampaign({ projectId: 'project-1', sessionId: 'session-1' }, { nowMs: () => (tick += 25) });
    expect(campaign.outcome).toBe('PASS');
    expect(campaign.issues).toEqual([]);
    expect(campaign.scale).toEqual({
      structureNodes: PRODUCT_STRUCTURE_MAX_NODES,
      structureEdges: PRODUCT_STRUCTURE_MAX_EDGES,
      crossDomainNodes: AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_NODES,
      crossDomainEdges: AI_DESIGN_CROSS_DOMAIN_GRAPH_MAX_EDGES,
      partitions: AI_DESIGN_PARTITION_MAX,
      completePartitionCoverage: true,
    });
    expect(campaign.authority).toEqual({
      syntheticOnly: true, sourceContentIncluded: false, proprietaryGeometryIncluded: false,
      exactCadVerified: false, manufacturingReleaseReady: false,
    });
    expect(campaign.measuredDurationMs).toBe(25);
  }, 60_000);

  it('is digest-deterministic while excluding elapsed timing from the evidence identity', () => {
    const config = { projectId: 'project-1', sessionId: 'session-1', structureNodeCount: 40, structureEdgeCount: 80, crossDomainNodeCount: 30, crossDomainEdgeCount: 50, partitionCount: 8 };
    const first = runAiDesignComplexScaleCampaign(config, { nowMs: (() => { let value = 0; return () => (value += 1); })() });
    const second = runAiDesignComplexScaleCampaign(config, { nowMs: (() => { let value = 0; return () => (value += 10); })() });
    expect(second.campaignDigest).toBe(first.campaignDigest);
    expect(second.measuredDurationMs).not.toBe(first.measuredDurationMs);
  });

  it('fails closed when requested scale exceeds owned contract bounds', () => {
    expect(() => runAiDesignComplexScaleCampaign({ projectId: 'project-1', sessionId: 'session-1', structureNodeCount: PRODUCT_STRUCTURE_MAX_NODES + 1 })).toThrow('AI_DESIGN_SCALE_STRUCTURE_NODES_INVALID');
  });
});
