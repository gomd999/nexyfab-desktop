import { describe, expect, it } from 'vitest';
import { analyzeIfcSemantics, snapshotIfcSemantics, verifyIfcSemanticRoundtrip } from './ifcSemanticEvidence';

describe('IFC semantic evidence', () => {
  it('counts explicit semantics without treating them as geometry', () => {
    const source = `#1=IFCPROJECT('g',$,$,$,$,$,$,$,$); #2=IFCRELAGGREGATES('r',$,$,$,#1,(#3));
#3=IFCSITE('s',$,$,$,$,$,$,$,$,$,$,$,$,$); #4=IFCRELASSOCIATESMATERIAL('m',$,$,$,(#3),#5);
#5=IFCMATERIAL('steel'); #6=IFCELEMENTQUANTITY('q',$,$,$,$,(#7)); #7=IFCQUANTITYVOLUME('v',$,$,1.0,$);
#8=IFCPROJECTEDCRS('EPSG:5179',$,$,$,$,$,$);`;
    expect(analyzeIfcSemantics(source)).toEqual({ guids: 2, hierarchyRelations: 1, materialRelations: 2, propertySets: 0, quantitySets: 2, georeferenceEntities: 2 });
  });

  it('preserves GUID hierarchy, property/quantity definitions and projected CRS across a roundtrip', () => {
    const source = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;
#1=IFCPROJECT('project',$,'P',$,$,$,$,$,$); #2=IFCSITE('site',$,'S',$,$,$,$,$,$,$,$,$,$,$);
#3=IFCWALL('wall',$,'W',$,$,$,$,$,$); #4=IFCRELAGGREGATES('aggregate',$,$,$,#1,(#2));
#5=IFCRELCONTAINEDINSPATIALSTRUCTURE('contain',$,$,$,(#3),#2);
#6=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('2h'),$); #7=IFCPROPERTYSET('pset',$,'Pset_WallCommon',$,(#6));
#8=IFCRELDEFINESBYPROPERTIES('defines',$,$,$,(#3),#7);
#9=IFCPROJECTEDCRS('EPSG:5179',$,$,$,$,$,$); #10=IFCMAPCONVERSION(#11,#9,100.,200.,3.,1.,0.,1.); ENDSEC;END-ISO-10303-21;`;
    const snapshot = snapshotIfcSemantics(source);
    expect(snapshot.occurrences.map(item => [item.globalId, item.parentGlobalId])).toEqual([['project', null], ['site', 'project'], ['wall', 'site']]);
    expect(snapshot.definitions).toHaveLength(1);
    expect(verifyIfcSemanticRoundtrip(source, source)).toMatchObject({ passed: true, georeferencePreserved: true, errors: [] });
  });

  it('fails closed when semantic identity or map conversion changes', () => {
    const before = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;#1=IFCSITE('site',$,$,$,$,$,$,$,$,$,$,$,$,$);#2=IFCPROJECTEDCRS('EPSG:5179',$,$,$,$,$,$);#3=IFCMAPCONVERSION(#4,#2,1.,2.,0.,1.,0.,1.);ENDSEC;END-ISO-10303-21;`;
    const after = before.replace("'site'", "'changed'").replace('1.,2.,0.', '9.,2.,0.');
    expect(verifyIfcSemanticRoundtrip(before, after)).toMatchObject({ passed: false, missingOccurrences: ['site'], georeferencePreserved: false });
  });

  it('does not mistake non-IfcRoot names for duplicate GlobalIds', () => {
    const source = "#1=IFCBOUNDARYNODECONDITION('Fixed',$,$,$,$,$,$);#2=IFCBOUNDARYNODECONDITION('Fixed',$,$,$,$,$,$);#3=IFCSTRUCTURALLOADLINEARFORCE('Nominal',$,$,$,$,$,$);#4=IFCSTRUCTURALLOADLINEARFORCE('Nominal',$,$,$,$,$,$);";
    expect(snapshotIfcSemantics(source).duplicateGlobalIds).toEqual([]);
  });

  it('detects duplicate encoded IfcRoot GlobalIds', () => {
    const guid = '0DAlDmbNb6ZhcaPbmdsMGX';
    expect(snapshotIfcSemantics(`#1=IFCSITE('${guid}',$,$,$,$,$,$,$,$,$,$,$,$,$);#2=IFCWALL('${guid}',$,$,$,$,$,$,$,$);`).duplicateGlobalIds).toEqual([guid]);
  });
});
