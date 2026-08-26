import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(process.cwd(), 'containers/occt-xcaf');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('native XCAF worker static contract', () => {
  it('builds OCCT DataExchange/XCAF in a multi-stage image', () => {
    const docker = read('Dockerfile');
    expect(docker).toContain('FROM debian:bookworm-slim AS occt-build');
    expect(docker).toContain('libocct-data-exchange-dev');
    expect(docker).toContain('libocct-visualization-dev');
    expect(docker).toContain('cmake -S . -B build');
    expect(docker).toContain('COPY --from=occt-build');
    expect(docker).toContain('COPY containers/occt-xcaf/CMakeLists.txt ./');
    expect(docker).toContain('COPY containers/occt-xcaf/native ./native');
    expect(docker).toContain('libocct-data-exchange-7.6');
    expect(docker).toContain('libocct-ocaf-7.6');
    expect(read('CMakeLists.txt')).toContain('find_package(OpenCASCADE REQUIRED)');
    expect(docker).toContain('libocct-ocaf-dev');
  });

  it('uses STEPCAF/XCAF APIs and kernel measurements in native code', () => {
    const source = read('native/occt_xcaf_inspect.cpp');
    expect(source).toContain('#include <STEPCAFControl_Reader.hxx>');
    expect(source).toContain('XCAFDoc_ShapeTool');
    expect(source).toContain('reader.Transfer(document)');
    expect(source).toContain('Interface_Static::SetCVal("xstep.cascade.unit", "MM")');
    expect(source).toContain('GetReferredShape');
    expect(source).toContain('occurrencePath');
    expect(source).toContain('xcaf_assembly_depth_exceeded');
    expect(source).toContain('BRepGProp::VolumeProperties');
    expect(source).toContain('BRepGProp::SurfaceProperties');
    expect(source).toContain('BRepCheck_Analyzer(shape, Standard_True).IsValid()');
    expect(source).toContain('BRep_Tool::Tolerance');
    expect(source).toContain('TopExp::MapShapesAndUniqueAncestors');
    expect(source).toContain('nonManifoldEdgeCount');
    expect(source).toContain('maxToleranceMm');
    expect(source).toContain('inertiaTensor');
    expect(source).toContain('orderedChildren');
    expect(source).toContain('recursionStack');
    expect(source).toContain('visitedLabels');
    expect(source).toContain('xcaf_assembly_cycle_detected');
    expect(source).toContain('programIdentity');
    expect(source).toContain('kernelIdentity');
    expect(source).toContain('OCC_VERSION_COMPLETE');
    expect(source).toContain('native_output_limit_exceeded');
    expect(source).toContain('native_numeric_nonfinite');
    expect(source).toContain('EVP_DigestFinal_ex');
    expect(source).toContain('value.LengthOfCString()');
    expect(source).toContain('value.ToUTF8CString(utf8)');
    expect(source).not.toContain('value.ToUTF8CString()');
    expect(source).not.toContain('out << "]}");');
    expect(source).not.toContain('STEPControl_Reader');
    expect(source).not.toContain('IGESControl_Reader');
  });

  it('keeps the HTTP boundary fail-closed', () => {
    const client = read('src/workerClient.ts');
    const server = read('src/server.ts');
    expect(client).toContain('shell: false');
    expect(client).toContain('mkdtemp');
    expect(client).toContain('NATIVE_TIMEOUT');
    expect(client).toContain('NATIVE_OUTPUT_HASH_MISMATCH');
    expect(client).toContain('PATH_OUTSIDE_ROOT');
    expect(client).toContain('isSymbolicLink');
    expect(client).toContain("inspectionStatus: 'NOT_RUN'");
    expect(client).toContain("status: 'PASS_NATIVE'");
    expect(client).toContain('validateBoundedJson');
    expect(client).toContain('MAX_NATIVE_PRODUCTS');
    expect(client).toContain('Number.isFinite');
    expect(client).toContain('nativeBinarySha256: nativeDigest');
    expect(client).toContain('nativeInvocationSha256: nativeInvocationDigest');
    expect(server).toContain("'/health/live'");
    expect(server).toContain("'/capabilities'");
    expect(server).toContain("'/v1/inspect'");
    expect(server).toContain('OCCT_XCAF_SERVICE_TOKEN_REQUIRED');
    expect(server).toContain('timingSafeEqual');
  });
});
