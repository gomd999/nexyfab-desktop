import { describe, expect, it } from 'vitest';
import { analyzeIfcSpatialStructure } from './ifcSpatialStructure';

const header = "ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;";
const footer = 'ENDSEC;END-ISO-10303-21;';

describe('IFC spatial structure evidence', () => {
  it('separates spatial containers from physical elements and checks placements', () => {
    const source = `${header}
#1=IFCPROJECT('project',$,'Project',$,$,$,$,$,$);
#2=IFCCARTESIANPOINT((0.,0.,0.)); #3=IFCAXIS2PLACEMENT3D(#2,$,$); #4=IFCLOCALPLACEMENT($,#3);
#5=IFCBUILDINGSTOREY('storey',$,'L1',$,$,#4,$,$,.ELEMENT.,0.);
#6=IFCWALL('wall',$,'Wall',$,$,#4,$,$);
#7=IFCRELAGGREGATES('r1',$,$,$,#1,(#5));
#8=IFCRELCONTAINEDINSPATIALSTRUCTURE('r2',$,$,$,(#6),#5);
${footer}`;
    const result = analyzeIfcSpatialStructure(source);
    expect(result).toMatchObject({ schema: 'IFC4', spatialCount: 2, elementCount: 1, relatedCount: 2, availablePlacementCount: 2, unresolvedPlacementCount: 0, optionalSpatialPlacementOmittedCount: 0, cycleCount: 0, failureCodes: [] });
    expect(result.nodes.find(node => node.globalId === 'wall')).toMatchObject({ kind: 'element', parentEntityId: 5, placementStatus: 'available' });
  });

  it('reports missing and cyclic placements instead of inventing identity', () => {
    const source = `${header}
#1=IFCPROJECT('project',$,'Project',$,$,$,$,$,$);
#2=IFCLOCALPLACEMENT(#3,#4); #3=IFCLOCALPLACEMENT(#2,#4); #4=IFCAXIS2PLACEMENT3D(#5,$,$); #5=IFCCARTESIANPOINT((0.,0.,0.));
#6=IFCWALL('cycle',$,'Cycle',$,$,#2,$,$); #7=IFCDOOR('missing',$,'Missing',$,$,$,$,$);
${footer}`;
    const result = analyzeIfcSpatialStructure(source);
    expect(result.cycleCount).toBe(1);
    expect(result.unresolvedPlacementCount).toBe(1);
    expect(result.failureCodes).toEqual(['IFC_PLACEMENT_UNRESOLVED']);
  });

  it('does not classify IFC types, styles, properties, or analysis records as placed occurrences', () => {
    const source = `${header}
#1=IFCWALLTYPE('type',$,'Wall Type',$,$,$,$,$,$,.NOTDEFINED.);
#2=IFCDOORSTYLE('style',$,'Door Style',$,$,$,$,$,$,$,.NOTDEFINED.);
#3=IFCWINDOWLININGPROPERTIES('prop',$,'Lining',$,$,$,$,$,$,$,$,$,$,$,$,$,$);
#4=IFCSTRUCTURALCURVEMEMBER('analysis',$,'Member',$,$,$,$,$,$,$);
#5=IFCDISTRIBUTIONSYSTEM('system',$,'HVAC',$,$,$,$,$,$);
${footer}`;
    const result = analyzeIfcSpatialStructure(source);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ globalId: 'system', kind: 'system', placementStatus: 'not_applicable' });
    expect(result.unresolvedPlacementCount).toBe(0);
  });

  it('reports unresolved linear and grid placement as unsupported instead of identity', () => {
    const source = `${header}
#1=IFCLINEARPLACEMENT(#9,#10,$);
#2=IFCGRIDPLACEMENT(#11,$);
#3=IFCSIGNAL('linear',$,'Signal',$,$,#1,$,$);
#4=IFCCOLUMN('grid',$,'Column',$,$,#2,$,$);
${footer}`;
    const result = analyzeIfcSpatialStructure(source);
    expect(result.unsupportedPlacementCount).toBe(2);
    expect(result.nodes.map(node => node.placementStatus)).toEqual(['unsupported', 'unsupported']);
    expect(result.failureCodes).toEqual(['IFC_PLACEMENT_UNRESOLVED', 'UNSUPPORTED_ENTITY']);
  });

  it('resolves a straight two-axis grid intersection into an exact world transform', () => {
    const source = `${header}
#10=IFCCARTESIANPOINT((100.,200.,3.)); #11=IFCAXIS2PLACEMENT3D(#10,$,$); #12=IFCLOCALPLACEMENT($,#11);
#20=IFCCARTESIANPOINT((0.,5.)); #21=IFCCARTESIANPOINT((20.,5.)); #22=IFCPOLYLINE((#20,#21)); #23=IFCGRIDAXIS('X',#22,.T.);
#30=IFCCARTESIANPOINT((8.,0.)); #31=IFCCARTESIANPOINT((8.,10.)); #32=IFCPOLYLINE((#30,#31)); #33=IFCGRIDAXIS('Y',#32,.T.);
#40=IFCVIRTUALGRIDINTERSECTION((#23,#33),(0.,0.)); #41=IFCGRIDPLACEMENT(#12,#40,$);
#50=IFCCOLUMN('column',$,'Column',$,$,#41,$,$,$);
${footer}`;
    const result = analyzeIfcSpatialStructure(source); const column = result.nodes[0]!;
    expect(column.placementStatus).toBe('available');
    expect([column.worldTransform?.[3], column.worldTransform?.[7], column.worldTransform?.[11]]).toEqual([108, 205, 3]);
    expect(result.failureCodes).toEqual([]);
  });

  it('uses an explicit CartesianPosition on IfcLinearPlacement', () => {
    const source = `${header}
#1=IFCCARTESIANPOINT((100.,200.,3.)); #2=IFCAXIS2PLACEMENT3D(#1,$,$); #3=IFCLOCALPLACEMENT($,#2);
#4=IFCCARTESIANPOINT((8.,5.,2.)); #5=IFCAXIS2PLACEMENT3D(#4,$,$); #6=IFCLINEARPLACEMENT(#3,#99,#5);
#7=IFCSIGNAL('signal',$,'Signal',$,$,#6,$,$);
${footer}`;
    const result = analyzeIfcSpatialStructure(source); const signal = result.nodes[0]!;
    expect(signal.placementStatus).toBe('available');
    expect([signal.worldTransform?.[3], signal.worldTransform?.[7], signal.worldTransform?.[11]]).toEqual([108, 205, 5]);
    expect(result.failureCodes).toEqual([]);
  });

  it('resolves PointByDistanceExpression against governed alignment geometry when CartesianPosition is absent',()=>{const source=`${header}
#1=IFCALIGNMENT('alignment',$,'A',$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,0.,0.,100.,$,.LINE.);#4=IFCALIGNMENTVERTICALSEGMENT($,$,0.,100.,5.,0.1,0.1,$,.CONSTANTGRADIENT.);
#10=IFCCARTESIANPOINT((100.,200.,0.));#11=IFCAXIS2PLACEMENT3D(#10,$,$);#12=IFCLOCALPLACEMENT($,#11);
#20=IFCPOINTBYDISTANCEEXPRESSION(IFCLENGTHMEASURE(10.),2.,3.,1.,#99);#21=IFCAXIS2PLACEMENTLINEAR(#20,$,$);#22=IFCLINEARPLACEMENT(#12,#21,$);#23=IFCSIGNAL('signal',$,'Signal',$,$,#22,$,$);${footer}`;const result=analyzeIfcSpatialStructure(source),signal=result.nodes.find(node=>node.globalId==='signal')!;expect(signal.placementStatus).toBe('available');expect(signal.worldTransform?.[3]).toBeCloseTo(111,9);expect(signal.worldTransform?.[7]).toBeCloseTo(202,9);expect(signal.worldTransform?.[11]).toBeCloseTo(9.1,9);expect(result.failureCodes).toEqual([]);});

  it('keeps unsupported alignment station geometry fail-closed',()=>{const source=`${header}#1=IFCALIGNMENT('alignment',$,'A',$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,0.,100.,10.,$,.VIENNESEBEND.);#20=IFCPOINTBYDISTANCEEXPRESSION(IFCLENGTHMEASURE(5.),$,$,$,#99);#21=IFCAXIS2PLACEMENTLINEAR(#20,$,$);#22=IFCLINEARPLACEMENT($,#21,$);#23=IFCSIGNAL('signal',$,'Signal',$,$,#22,$,$);${footer}`;const result=analyzeIfcSpatialStructure(source);expect(result.nodes[0]).toMatchObject({placementStatus:'unsupported',worldTransform:null});expect(result.failureCodes).toEqual(['IFC_PLACEMENT_UNRESOLVED','UNSUPPORTED_ENTITY']);});

  it('classifies IFC facilities as spatial containers rather than physical rail parts', () => {
    const source = `${header}
#1=IFCPROJECT('project',$,'Project',$,$,$,$,$,$);
#2=IFCRAILWAY('railway',$,'Railway',$,$,$,$,$,$,$);
#3=IFCRELAGGREGATES('rel',$,$,$,#1,(#2));
${footer}`;
    const result = analyzeIfcSpatialStructure(source);
    expect(result).toMatchObject({ spatialCount: 2, elementCount: 0, unresolvedPlacementCount: 0 });
    expect(result.nodes[1]).toMatchObject({ kind: 'site', placementStatus: 'not_applicable' });
  });
});
