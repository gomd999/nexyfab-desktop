import type { DesignDomainId, UserExperienceLevel } from '@/lib/ai/domainProfile';
import type { RibbonAction, RibbonActionGroup } from '../ModeRibbons';
import type { RibbonTabDef } from '../Ribbon';

export type SpatialRibbonDomain = Exclude<DesignDomainId, 'mechanical'> | 'coordination';

export function spatialRibbonTabs(domain: SpatialRibbonDomain): RibbonTabDef[] {
  if (domain === 'coordination') {
    return [
      { id: 'space.federation', label: 'Federation' },
      { id: 'space.clashes', label: 'Clashes' },
      { id: 'space.issues', label: 'Issues' },
      { id: 'space.evidence', label: 'Evidence' },
    ];
  }
  if (domain === 'interior') {
    return [
      { id: 'space.layout', label: 'Layout' },
      { id: 'space.furniture', label: 'Furniture' },
      { id: 'space.systems', label: 'Ceiling & MEP' },
      { id: 'space.inspect', label: 'Inspect' },
    ];
  }
  if (domain === 'building') {
    return [
      { id: 'space.model', label: 'Building' },
      { id: 'space.openings', label: 'Openings' },
      { id: 'space.inspect', label: 'Inspect' },
      { id: 'space.deliverables', label: 'Deliverables' },
    ];
  }
  if (domain === 'landscape') {
    return [
      { id: 'space.model', label: 'Site' },
      { id: 'space.planting', label: 'Planting' },
      { id: 'space.water', label: 'Water' },
      { id: 'space.inspect', label: 'Inspect' },
    ];
  }
  return [{ id: 'space.survey', label: 'Survey' }, { id: 'space.alignment', label: 'Alignment' }, { id: 'space.drainage', label: 'Drainage' }, { id: 'space.inspect', label: 'Inspect' }];
}

export function spatialRibbonGroups(
  domain: SpatialRibbonDomain,
  experience: UserExperienceLevel,
  activeTab: string,
): RibbonActionGroup[] {
  if (domain === 'coordination') {
    if (activeTab === 'space.clashes') return [{ title: 'Candidate check', rows: [[{ id: 'spatial.verify', lbl: 'Calculate clash candidates', ico: 'check' }]] }];
    if (activeTab === 'space.issues') return [{ title: 'Issue state', rows: [[{ id: 'spatial.issues', lbl: 'Review open candidates', ico: 'layers' }]] }];
    if (activeTab === 'space.evidence') return [{ title: 'Truth', rows: [[{ id: 'spatial.verify', lbl: 'Recalculate preview evidence', ico: 'check' }, { id: 'spatial.exact-clash-job', lbl: 'Prepare exact clash job', ico: 'bolt' }]] }];
    return [{ title: 'Federated model', rows: [[{ id: 'spatial.plan', lbl: 'Federated plan', ico: 'rect' }, { id: 'spatial.dimensions', lbl: 'Coordinates & offsets', ico: 'dim' }]] }];
  }
  if (domain === 'building') {
    const groups: RibbonActionGroup[] = [];
    if (activeTab === 'space.inspect') {
      groups.push({ title: 'Topology', rows: [[{ id: 'spatial.verify', lbl: 'Run architecture check', ico: 'check' }]] });
    } else if (activeTab === 'space.deliverables') {
      groups.push({ title: 'Available check', rows: [[{ id: 'spatial.verify', lbl: 'Run architecture check', ico: 'check' }]] });
      groups.push({ title: 'Missing authority', rows: [[{ id: 'spatial.ai', lbl: 'Complete release brief', ico: 'ai' }]] });
    } else {
      const actions: RibbonAction[] = [
          { id: 'spatial.dimensions', lbl: activeTab === 'space.openings' ? 'Door & window sizes' : 'Building dimensions', ico: 'dim' },
          { id: 'spatial.plan', lbl: 'Plan view', ico: 'rect' },
      ];
      if (experience !== 'guided') actions.push({ id: 'spatial.3d', lbl: '3D building', ico: 'cube' });
      groups.push({ title: activeTab === 'space.openings' ? 'Openings' : 'Building', rows: [actions] });
    }
    if (activeTab !== 'space.deliverables') {
      groups.push({ title: 'Nexy AI', rows: [[{ id: 'spatial.ai', lbl: 'Review design brief', ico: 'ai' }]] });
    }
    return groups;
  }
  if (domain === 'landscape') {
    const actions: RibbonAction[] = activeTab === 'space.inspect'
      ? [{ id: 'spatial.verify', lbl: 'Check concept consistency', ico: 'check' }]
      : [{ id: 'spatial.dimensions', lbl: activeTab === 'space.planting' ? 'Planting parameters' : 'Site dimensions', ico: 'dim' }, { id: 'spatial.plan', lbl: 'Plan view', ico: 'rect' }];
    if (activeTab !== 'space.inspect' && experience !== 'guided') actions.push({ id: 'spatial.3d', lbl: '3D landscape', ico: 'cube' });
    return [{ title: activeTab === 'space.inspect' ? 'Consistency' : 'Landscape', rows: [actions] }, { title: 'Nexy AI', rows: [[{ id: 'spatial.ai', lbl: activeTab === 'space.water' ? 'Complete water brief' : 'Review design brief', ico: 'ai' }]] }];
  }
  if (domain === 'civil') {
    const actions: RibbonAction[] = activeTab === 'space.inspect' ? [{ id: 'spatial.verify', lbl: 'Check civil consistency', ico: 'check' }] : [{ id: 'spatial.dimensions', lbl: activeTab === 'space.survey' ? 'CRS & dimensions' : 'Corridor parameters', ico: 'dim' }, { id: 'spatial.plan', lbl: 'Alignment plan', ico: 'rect' }];
    if (activeTab !== 'space.inspect' && experience !== 'guided') actions.push({ id: 'spatial.3d', lbl: '3D corridor', ico: 'cube' });
    return [{ title: activeTab === 'space.inspect' ? 'Consistency' : 'Civil', rows: [actions] }, { title: 'Nexy AI', rows: [[{ id: 'spatial.ai', lbl: activeTab === 'space.survey' ? 'Complete survey brief' : 'Review design brief', ico: 'ai' }]] }];
  }

  const groups: RibbonActionGroup[] = [];
  if (activeTab === 'space.layout') {
    groups.push({
      title: 'Space',
      rows: [[
        { id: 'spatial.dimensions', lbl: 'Room dimensions', ico: 'dim' },
        { id: 'spatial.plan', lbl: 'Plan view', ico: 'rect' },
      ]],
    });
  } else if (activeTab === 'space.furniture') {
    groups.push({
      title: 'Furniture',
      rows: [[{ id: 'spatial.furniture', lbl: 'Edit layout', ico: 'layers' }]],
    });
    if (experience !== 'guided') {
      groups.push({
        title: 'View',
        rows: [[{ id: 'spatial.3d', lbl: '3D spatial view', ico: 'cube' }]],
      });
    }
  } else if (activeTab === 'space.systems') {
    groups.push({
      title: 'Ceiling',
      rows: [[{ id: 'spatial.ceiling', lbl: 'Ceiling height', ico: 'plane' }]],
    });
  } else {
    groups.push({
      title: 'Checks',
      rows: [[{ id: 'spatial.verify', lbl: 'Run egress & finish', ico: 'check' }]],
    });
  }
  groups.push({
    title: 'Nexy AI',
    rows: [[{ id: 'spatial.ai', lbl: 'Review design brief', ico: 'ai' }]],
  });
  return groups;
}
