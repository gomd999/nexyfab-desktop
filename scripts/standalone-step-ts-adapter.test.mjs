import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  executeIndependentStepParser,
  inspectStandaloneStep,
  parseStandaloneStep,
  rewriteStandaloneStep,
} from './standalone-step-ts-adapter.mjs';

const AP242_BOX_ASSEMBLY = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#1=PRODUCT_DEFINITION('','',#2,#900);
#2=PRODUCT_DEFINITION_FORMATION('','',#3);
#3=PRODUCT('root','Root','',());
#10=PRODUCT_DEFINITION('','',#11,#900);
#11=PRODUCT_DEFINITION_FORMATION('','',#12);
#12=PRODUCT('part-a','Part A','',());
#13=PRODUCT_DEFINITION_SHAPE('','',#10);
#14=SHAPE_DEFINITION_REPRESENTATION(#13,#15);
#15=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#20),#901);
#20=MANIFOLD_SOLID_BREP('',#21);
#21=CLOSED_SHELL('',(#30,#31,#32,#33,#34,#35));
#30=ADVANCED_FACE('',(#40),#70,.T.);
#31=ADVANCED_FACE('',(#41),#70,.T.);
#32=ADVANCED_FACE('',(#42),#70,.T.);
#33=ADVANCED_FACE('',(#43),#70,.T.);
#34=ADVANCED_FACE('',(#44),#70,.T.);
#35=ADVANCED_FACE('',(#45),#70,.T.);
#40=FACE_OUTER_BOUND('',#50,.T.);#41=FACE_OUTER_BOUND('',#50,.T.);#42=FACE_OUTER_BOUND('',#50,.T.);#43=FACE_OUTER_BOUND('',#50,.T.);#44=FACE_OUTER_BOUND('',#50,.T.);#45=FACE_OUTER_BOUND('',#50,.T.);
#50=EDGE_LOOP('',(#60,#61,#62,#63,#64,#65,#66,#67,#68,#69,#71,#72));
#60=EDGE_CURVE('',#100,#101,#80,.T.);#61=EDGE_CURVE('',#101,#102,#80,.T.);#62=EDGE_CURVE('',#102,#103,#80,.T.);#63=EDGE_CURVE('',#103,#100,#80,.T.);
#64=EDGE_CURVE('',#104,#105,#80,.T.);#65=EDGE_CURVE('',#105,#106,#80,.T.);#66=EDGE_CURVE('',#106,#107,#80,.T.);#67=EDGE_CURVE('',#107,#104,#80,.T.);
#68=EDGE_CURVE('',#100,#104,#80,.T.);#69=EDGE_CURVE('',#101,#105,#80,.T.);#71=EDGE_CURVE('',#102,#106,#80,.T.);#72=EDGE_CURVE('',#103,#107,#80,.T.);
#80=LINE('',#90,#91);#90=CARTESIAN_POINT('',(0.,0.,0.));#91=VECTOR('',#92,1.);#92=DIRECTION('',(1.,0.,0.));
#100=VERTEX_POINT('',#110);#101=VERTEX_POINT('',#111);#102=VERTEX_POINT('',#112);#103=VERTEX_POINT('',#113);#104=VERTEX_POINT('',#114);#105=VERTEX_POINT('',#115);#106=VERTEX_POINT('',#116);#107=VERTEX_POINT('',#117);
#110=CARTESIAN_POINT('',(0.,0.,0.));#111=CARTESIAN_POINT('',(10.,0.,0.));#112=CARTESIAN_POINT('',(10.,20.,0.));#113=CARTESIAN_POINT('',(0.,20.,0.));
#114=CARTESIAN_POINT('',(0.,0.,30.));#115=CARTESIAN_POINT('',(10.,0.,30.));#116=CARTESIAN_POINT('',(10.,20.,30.));#117=CARTESIAN_POINT('',(0.,20.,30.));
#70=PLANE('',#120);#120=AXIS2_PLACEMENT_3D('',#110,#121,#122);#121=DIRECTION('',(0.,0.,1.));#122=DIRECTION('',(1.,0.,0.));
#200=NEXT_ASSEMBLY_USAGE_OCCURRENCE('occ-1','Part A','',#1,#10,$);
#201=ITEM_DEFINED_TRANSFORMATION('occ-1_xfm','',#220,#210);
#202=(REPRESENTATION_RELATIONSHIP('','',#230,#15)REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#201)SHAPE_REPRESENTATION_RELATIONSHIP());
#203=PRODUCT_DEFINITION_SHAPE('','',#200);#204=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#202,#203);#230=SHAPE_REPRESENTATION('',(),#901);#231=PRODUCT_DEFINITION_SHAPE('','',#1);#232=SHAPE_DEFINITION_REPRESENTATION(#231,#230);
#210=AXIS2_PLACEMENT_3D('',#211,#212,#213);#211=CARTESIAN_POINT('',(0.,0.,0.));#212=DIRECTION('',(0.,0.,1.));#213=DIRECTION('',(1.,0.,0.));
#220=AXIS2_PLACEMENT_3D('',#221,#222,#223);#221=CARTESIAN_POINT('',(5.,6.,7.));#222=DIRECTION('',(0.,0.,1.));#223=DIRECTION('',(1.,0.,0.));
#800=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#900=PRODUCT_DEFINITION_CONTEXT('',#901,'design');#901=APPLICATION_CONTEXT('');#902=APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2014,#901);
ENDSEC;
END-ISO-10303-21;
`;

test('independently parses, measures, rewrites, and reopens a bounded AP242 box assembly', async () => {
  const measured = inspectStandaloneStep(AP242_BOX_ASSEMBLY);
  assert.deepEqual(measured.boundingBox, [5, 6, 7, 15, 26, 37]);
  assert.equal(measured.volume, 6000);
  assert.equal(measured.surfaceArea, 2200);
  assert.deepEqual(measured.componentNames, ['Part A']);
  assert.deepEqual(inspectStandaloneStep(rewriteStandaloneStep(AP242_BOX_ASSEMBLY)), measured);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'step-ts-adapter-'));
  try {
    const sourcePath = path.join(root, 'source.step');
    fs.writeFileSync(sourcePath, AP242_BOX_ASSEMBLY);
    const sourceSha256 = (await import('node:crypto')).createHash('sha256').update(AP242_BOX_ASSEMBLY).digest('hex');
    const result = await executeIndependentStepParser({ sourcePath, sourceSha256, designRevisionSha256: 'a'.repeat(64), evidenceRoot: root });
    assert.equal(result.engine.family, 'iso10303-part21-pure-ts');
    assert.equal(result.report.checks.length, 16);
    assert.ok(result.report.checks.every(item => item.status === 'pass'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('accepts the reciprocal OCCT relationship/frame orientation only when both sides agree', () => {
  const reciprocal = AP242_BOX_ASSEMBLY
    .replace("REPRESENTATION_RELATIONSHIP('','',#230,#15)", "REPRESENTATION_RELATIONSHIP('','',#15,#230)")
    .replace("ITEM_DEFINED_TRANSFORMATION('occ-1_xfm','',#220,#210)", "ITEM_DEFINED_TRANSFORMATION('occ-1_xfm','',#210,#220)");
  assert.deepEqual(inspectStandaloneStep(reciprocal).boundingBox, [5, 6, 7, 15, 26, 37]);
  const crossWired = reciprocal.replace("ITEM_DEFINED_TRANSFORMATION('occ-1_xfm','',#210,#220)", "ITEM_DEFINED_TRANSFORMATION('occ-1_xfm','',#220,#210)");
  assert.throws(() => inspectStandaloneStep(crossWired), /RELATION_TRANSFORM_ORIENTATION_INVALID/);
});

test('fails closed for AP214, missing transforms, and non-box topology', () => {
  assert.throws(() => parseStandaloneStep(AP242_BOX_ASSEMBLY.replace('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF', 'AP214')), /AP242_REQUIRED/);
  assert.throws(() => inspectStandaloneStep(AP242_BOX_ASSEMBLY.replace('ap242_managed_model_based_3d_engineering', 'automotive_design')), /AP242_PROTOCOL_DEFINITION_REQUIRED/);
  assert.throws(() => inspectStandaloneStep(AP242_BOX_ASSEMBLY.replace(',2014,#901', ',2003,#901')), /AP242_PROTOCOL_DEFINITION_REQUIRED/);
  assert.throws(() => inspectStandaloneStep(AP242_BOX_ASSEMBLY.replace("#201=ITEM_DEFINED_TRANSFORMATION('occ-1_xfm','',#220,#210);", '')), /RRWT_TRANSFORM_CROSS_BINDING_INVALID/);
  assert.throws(() => inspectStandaloneStep(AP242_BOX_ASSEMBLY.replace('#204=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#202,#203);', '')), /OCCURRENCE_TRANSFORM_MISMATCH/);
  assert.throws(() => inspectStandaloneStep(AP242_BOX_ASSEMBLY.replace("#202=(REPRESENTATION_RELATIONSHIP('','',#230,#15)", "#202=(REPRESENTATION_RELATIONSHIP('','',#230,#230)")), /REPRESENTATION_RELATION_CROSS_BINDING_INVALID/);
  assert.throws(() => inspectStandaloneStep(AP242_BOX_ASSEMBLY.replace("#201=ITEM_DEFINED_TRANSFORMATION('occ-1_xfm'", "#201=ITEM_DEFINED_TRANSFORMATION('cross-wired_xfm'")), /RRWT_TRANSFORM_CROSS_BINDING_INVALID/);
  assert.throws(() => inspectStandaloneStep(AP242_BOX_ASSEMBLY.replace("#35=ADVANCED_FACE('',(#45),#70,.T.);", '')), /BOX_TOPOLOGY_REQUIRED/);
});
