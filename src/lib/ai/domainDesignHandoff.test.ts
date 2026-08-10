// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DOMAIN_DESIGN_HANDOFF_KEY,
  saveDomainDesignHandoff,
  takeDomainDesignHandoff,
} from './domainDesignHandoff';
import { assemblyUnifiedProject } from './assemblyUnifiedProjectAdapter';

describe('domain design handoff', () => {
  beforeEach(() => sessionStorage.clear());
  const project = assemblyUnifiedProject('p1', 'civil', { parts: [{ id: 'wall' }] }).project;
  const validation = {
    designOk: true as const, gateErrors: [] as [], interferenceCount: 0 as const, floatingCount: 0 as const,
    degraded: false as const, droppedPartCount: 0 as const, canonicalIssues: [] as [], intentMatch: null,
  };
  const workspaceRevision = {
    projectId: project.id, lineageId: project.id, revision: project.revision,
    contentRevision: 'model-a1', workMode: 'ai_assisted' as const, protectedLockIds: ['manual:project-1:parameter:wall:height'],
  };

  it('moves an approved semantic assembly into the manual workspace once', () => {
    saveDomainDesignHandoff(sessionStorage, {
      domain: 'civil', assembly: { parts: [{ id: 'wall' }] }, openscad: 'cube(1);', parts: [], unifiedProject: project, workspaceRevision, validation,
    });
    expect(takeDomainDesignHandoff(sessionStorage, 'civil')).toMatchObject({
      schema: 'nexyfab.domain-design-handoff.v2',
      assembly: { parts: [{ id: 'wall' }] },
      workspaceRevision: { projectId: project.id, revision: project.revision, protectedLockIds: workspaceRevision.protectedLockIds },
    });
    expect(takeDomainDesignHandoff(sessionStorage, 'civil')).toBeNull();
  });

  it('does not consume a handoff from a different discipline', () => {
    saveDomainDesignHandoff(sessionStorage, {
      domain: 'civil', assembly: { parts: [{ id: 'wall' }] }, openscad: 'cube(1);', parts: [], unifiedProject: project, workspaceRevision, validation,
    });
    expect(takeDomainDesignHandoff(sessionStorage, 'building')).toBeNull();
    expect(sessionStorage.getItem(DOMAIN_DESIGN_HANDOFF_KEY)).not.toBeNull();
  });

  it('rejects a handoff whose approval evidence reports an unresolved issue', () => {
    saveDomainDesignHandoff(sessionStorage, {
      domain: 'civil', assembly: { parts: [{ id: 'wall' }] }, openscad: 'cube(1);', parts: [], unifiedProject: project, workspaceRevision,
      validation: { ...validation, interferenceCount: 1 as never },
    });
    expect(takeDomainDesignHandoff(sessionStorage, 'civil')).toBeNull();
  });

  it('rejects a v2 handoff that claims a different project revision', () => {
    saveDomainDesignHandoff(sessionStorage, {
      domain: 'civil', assembly: { parts: [{ id: 'wall' }] }, openscad: 'cube(1);', parts: [], unifiedProject: project,
      workspaceRevision: { ...workspaceRevision, revision: project.revision + 1 }, validation,
    });
    expect(takeDomainDesignHandoff(sessionStorage, 'civil')).toBeNull();
  });
});
