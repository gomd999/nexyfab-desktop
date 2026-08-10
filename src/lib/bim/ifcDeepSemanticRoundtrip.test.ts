import { describe, expect, it } from 'vitest';
import { snapshotIfcDeepSemantics, verifyIfcDeepSemanticRoundtrip } from './ifcDeepSemanticRoundtrip';

function ifc(): string {
  return `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));#2=IFCDIRECTION((0.,0.,1.));#3=IFCDIRECTION((1.,0.,0.));#4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
#5=IFCLOCALPLACEMENT($,#4);#6=IFCCARTESIANPOINT((10.,20.,3.));#7=IFCAXIS2PLACEMENT3D(#6,#2,#3);#8=IFCLOCALPLACEMENT(#5,#7);
#10=IFCPROJECT('project',$,'Project',$,$,$,$,$,$);#11=IFCSITE('site',$,'Site',$,$,#5,$,$,$,$,$,$,$,$);
#12=IFCWALL('wall',$,'Wall',$,$,#8,$,$,$);#13=IFCRELAGGREGATES('aggregate',$,$,$,#10,(#11));
#14=IFCRELCONTAINEDINSPATIALSTRUCTURE('contain',$,$,$,(#12),#11);
#20=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('2h'),$);#21=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(5.),$);
#22=IFCPROPERTYSET('pset',$,'Pset_WallCommon',$,(#20,#21));#23=IFCRELDEFINESBYPROPERTIES('property-rel',$,$,$,(#12),#22);
#30=IFCQUANTITYAREA('NetArea',$,$,15.);#31=IFCELEMENTQUANTITY('quantity-set',$,'BaseQuantities',$,$,(#30));
#32=IFCRELDEFINESBYPROPERTIES('quantity-rel',$,$,$,(#12),#31);
#40=IFCCLASSIFICATION('LH','2025.12',$,'WBS',$,$,$);#41=IFCCLASSIFICATIONREFERENCE($,'A1','Earthwork',#40);
#42=IFCRELASSOCIATESCLASSIFICATION('class-rel',$,$,$,(#12),#41);
#50=IFCPROJECTEDCRS('EPSG:5186',$,$,$,$,$,$);#51=IFCMAPCONVERSION(#52,#50,200000.,450000.,0.,1.,0.,1.);
ENDSEC;END-ISO-10303-21;`;
}

describe('IFC deep semantic roundtrip', () => {
  it('captures property values, quantities, classifications, hierarchy, placement and CRS', () => {
    const snapshot = snapshotIfcDeepSemantics(ifc());
    expect(snapshot.propertySets[0]).toMatchObject({ occurrenceGlobalId: 'wall', name: 'Pset_WallCommon' });
    expect(snapshot.propertySets[0]?.values.map(value => value.name)).toEqual(['FireRating', 'Length']);
    expect(snapshot.quantities[0]).toMatchObject({ occurrenceGlobalId: 'wall', name: 'NetArea', value: '15' });
    expect(snapshot.classifications[0]?.reference).toContain('IFCCLASSIFICATIONREFERENCE');
    const transform = snapshot.placements.find(item => item.globalId === 'wall')?.worldTransform;
    expect([transform?.[3], transform?.[7], transform?.[11]]).toEqual([10, 20, 3]);
    expect(snapshot.georeference).toHaveLength(2);
  });

  it('passes only when all release semantics survive', () => {
    expect(verifyIfcDeepSemanticRoundtrip(ifc(), ifc())).toMatchObject({ passed: true, errors: [] });
  });

  it('detects changed Pset value, classification, quantity, placement and map conversion', () => {
    const changed = ifc().replace("IFCLABEL('2h')", "IFCLABEL('1h')")
      .replace("'A1','Earthwork'", "'A2','Roadwork'")
      .replace("'NetArea',$,$,15.", "'NetArea',$,$,14.")
      .replace('(10.,20.,3.)', '(11.,20.,3.)')
      .replace('200000.,450000.', '200001.,450000.');
    const report = verifyIfcDeepSemanticRoundtrip(ifc(), changed);
    expect(report.passed).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([
      'PROPERTY_SET_CHANGED', 'CLASSIFICATION_CHANGED', 'QUANTITY_CHANGED', 'PLACEMENT_CHANGED', 'GEOREFERENCE_CHANGED',
    ]));
  });

  it('fails closed when a requested evidence category is absent from the source', () => {
    const minimal = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;#1=IFCSITE('site',$,$,$,$,$,$,$,$,$,$,$,$,$);ENDSEC;END-ISO-10303-21;`;
    expect(verifyIfcDeepSemanticRoundtrip(minimal, minimal).errors).toEqual(expect.arrayContaining([
      'SOURCE_HIERARCHY_EVIDENCE_MISSING', 'SOURCE_PLACEMENT_EVIDENCE_MISSING', 'SOURCE_PROPERTY_SET_EVIDENCE_MISSING',
      'SOURCE_CLASSIFICATION_EVIDENCE_MISSING', 'SOURCE_QUANTITY_EVIDENCE_MISSING', 'SOURCE_GEOREFERENCE_EVIDENCE_MISSING',
    ]));
  });
});
