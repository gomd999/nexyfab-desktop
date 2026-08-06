import { describe, expect, it } from 'vitest';
import { analyzeIfcOccurrenceRecoveryEvidence, planIfcGeometryRecovery } from './ifcGeometryRecoveryPolicy';

describe('IFC geometry recovery policy', () => {
  it('uses explicit material-layer evidence for a zero-thickness wall', () => {
    expect(planIfcGeometryRecovery({ ifcClass: 'IFCWALL', dimensions: [5000, 0, 3000], hasMaterialLayerUsage: true, hasProfileDefinition: false, hasTypeRelationship: false, evidenceScopedToOccurrence: true, typeGeometryAlreadyTried: true })).toMatchObject({ action: 'material_layer_sweep', automatic: true });
  });

  it('uses an explicit section profile for a line-like column', () => {
    expect(planIfcGeometryRecovery({ ifcClass: 'IFCCOLUMN', dimensions: [0, 0, 2000], hasMaterialLayerUsage: false, hasProfileDefinition: true, hasTypeRelationship: false, evidenceScopedToOccurrence: true, typeGeometryAlreadyTried: true })).toMatchObject({ action: 'profile_sweep', automatic: true });
  });

  it('requests authoritative thickness when the source cannot prove it', () => {
    expect(planIfcGeometryRecovery({ ifcClass: 'IFCDOOR', dimensions: [1000, 0, 2100], hasMaterialLayerUsage: false, hasProfileDefinition: false, hasTypeRelationship: false, evidenceScopedToOccurrence: false, typeGeometryAlreadyTried: true })).toMatchObject({ action: 'request_authoritative_thickness', automatic: false });
  });

  it('does not loop a type retry or use unrelated file-level evidence', () => {
    expect(planIfcGeometryRecovery({ ifcClass: 'IFCDOOR', dimensions: [1000, 0, 2100], hasMaterialLayerUsage: true, hasProfileDefinition: true, hasTypeRelationship: true, evidenceScopedToOccurrence: false, typeGeometryAlreadyTried: true })).toMatchObject({ action: 'request_authoritative_thickness', automatic: false });
  });

  it('scopes profile, material, and type evidence to the referenced occurrence', () => {
    const source = `ISO-10303-21;DATA;
#1=IFCWALL('wall',$,$,$,$,$,#10,$); #2=IFCDOOR('door',$,$,$,$,$,#20,$);
#10=IFCPRODUCTDEFINITIONSHAPE($,$,(#11)); #11=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#12)); #12=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,10.,20.);
#30=IFCMATERIALLAYERSETUSAGE(#31,.AXIS2.,.POSITIVE.,0.,$); #31=IFCMATERIALLAYERSET((#32),$,$); #32=IFCMATERIALLAYER($,100.,$,$,$,$,$);
#40=IFCRELASSOCIATESMATERIAL('r',$,$,$,(#1),#30); #41=IFCRELDEFINESBYTYPE('t',$,$,$,(#2),#42); #42=IFCDOORTYPE('type',$,$,$,$,$,$,$,$,.DOOR.,.SINGLE_SWING_LEFT.,$);
ENDSEC;END-ISO-10303-21;`;
    const evidence = analyzeIfcOccurrenceRecoveryEvidence(source, [1, 2]);
    expect(evidence.get(1)).toEqual({ hasMaterialLayerUsage: true, hasProfileDefinition: true, hasTypeRelationship: false });
    expect(evidence.get(2)).toEqual({ hasMaterialLayerUsage: false, hasProfileDefinition: false, hasTypeRelationship: true });
  });
});
