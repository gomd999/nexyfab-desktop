import { describe, expect, it } from 'vitest';
import { BIM_REGISTRY_SCHEMA, type BimInformationInstance, type BimInformationRegistry } from './informationRegistry';
import { validateIfcRegistryBinding, verifyIfcRegistryBoundRoundtrip } from './ifcRegistryBinding';

const registry: BimInformationRegistry = {
  schema: BIM_REGISTRY_SCHEMA, registryId: 'site', version: '1',
  sourceReferences: [{ id: 'source', path: 'source.xlsx', revision: '1', access: 'read_only' }],
  units: [{ code: 'none', symbol: '-', dimension: 'none' }, { code: 'm', symbol: 'm', dimension: 'length' }],
  classifications: [{ scheme: 'WBS', code: 'A1', name: 'Earthwork', level: 5, sourceRef: 'source' }],
  properties: [
    { pset: 'Pset_WallCommon', key: 'FireRating', name: 'Fire rating', type: 'string', unit: 'none', requiredAt: ['design'], sourceRef: 'source' },
    { pset: 'Pset_WallCommon', key: 'Length', name: 'Length', type: 'number', unit: 'm', requiredAt: ['design'], sourceRef: 'source' },
  ],
  bepRequirements: [{ key: 'qualityPlan', type: 'object', requiredAt: ['design'], sourceRef: 'source' }],
};
const instance: BimInformationInstance = {
  registryId: 'site', registryVersion: '1', stage: 'design', classifications: [{ scheme: 'WBS', code: 'A1' }],
  properties: [
    { pset: 'Pset_WallCommon', key: 'FireRating', value: '2h', unit: 'none', source: 'user', sourceRef: 'review:fire' },
    { pset: 'Pset_WallCommon', key: 'Length', value: 5, unit: 'm', source: 'imported', sourceRef: 'ifc:length' },
  ],
  bep: { qualityPlan: { reviewer: 'team-a' } },
};

function ifc(): string {
  return `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));#2=IFCDIRECTION((0.,0.,1.));#3=IFCDIRECTION((1.,0.,0.));#4=IFCAXIS2PLACEMENT3D(#1,#2,#3);#5=IFCLOCALPLACEMENT($,#4);
#10=IFCPROJECT('project',$,$,$,$,$,$,$,$);#11=IFCSITE('site-guid',$,$,$,$,#5,$,$,$,$,$,$,$,$);#12=IFCWALL('wall',$,$,$,$,#5,$,$,$);
#13=IFCRELAGGREGATES('aggregate',$,$,$,#10,(#11));#14=IFCRELCONTAINEDINSPATIALSTRUCTURE('contain',$,$,$,(#12),#11);
#20=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);#21=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('2h'),$);#22=IFCPROPERTYSINGLEVALUE('Length',$,IFCLENGTHMEASURE(5.),#20);
#23=IFCPROPERTYSET('pset',$,'Pset_WallCommon',$,(#21,#22));#24=IFCRELDEFINESBYPROPERTIES('property-rel',$,$,$,(#12),#23);
#30=IFCQUANTITYLENGTH('NetLength',$,$,5.);#31=IFCELEMENTQUANTITY('quantity-set',$,'BaseQuantities',$,$,(#30));#32=IFCRELDEFINESBYPROPERTIES('quantity-rel',$,$,$,(#12),#31);
#40=IFCCLASSIFICATION('LH','2025.12',$,'WBS',$,$,$);#41=IFCCLASSIFICATIONREFERENCE($,'A1','Earthwork',#40);#42=IFCRELASSOCIATESCLASSIFICATION('class-rel',$,$,$,(#12),#41);
#50=IFCPROJECTEDCRS('EPSG:5186',$,$,$,$,$,$);#51=IFCMAPCONVERSION(#52,#50,200000.,450000.,0.,1.,0.,1.);ENDSEC;END-ISO-10303-21;`;
}

describe('IFC registry binding', () => {
  it('binds exact Pset values, units and WBS codes to a registry-valid instance', () => {
    expect(validateIfcRegistryBinding(registry, instance, ifc(), 'wall')).toMatchObject({ passed: true, issues: [] });
    expect(verifyIfcRegistryBoundRoundtrip(registry, instance, ifc(), ifc(), 'wall')).toMatchObject({ passed: true });
  });

  it('fails closed on an IFC value or explicit unit mismatch', () => {
    const changed = ifc().replace("IFCLABEL('2h')", "IFCLABEL('1h')").replace('IFCLENGTHMEASURE(5.),#20', 'IFCLENGTHMEASURE(5.),$');
    const report = validateIfcRegistryBinding(registry, instance, changed, 'wall');
    expect(report.issues.map(value => value.code)).toEqual(expect.arrayContaining(['IFC_PROPERTY_VALUE_MISMATCH', 'IFC_PROPERTY_UNIT_MISMATCH']));
  });

  it('blocks a valid-looking IFC when its required classification is missing', () => {
    const changed = ifc().replace("'A1','Earthwork'", "'A2','Roadwork'");
    expect(validateIfcRegistryBinding(registry, instance, changed, 'wall').issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'IFC_CLASSIFICATION_MISSING' }),
    ]));
  });
});
