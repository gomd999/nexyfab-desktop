# Native OCCT XCAF worker

This unit is deliberately independent of the browser/replicad STEP path. The
native executable uses `STEPCAFControl_Reader` to transfer AP203/AP214/AP242
STEP into a `TDocStd_Document`, then traverses `XCAFDoc_ShapeTool` labels. It
reports product definitions, occurrence labels, locations, colors, the OCCT STEP
unit setting, and kernel-derived shape counts. The Debian OCCT binding used here
does not expose a portable, distinct part-number attribute, so the worker emits
`partNumber: null` with `partNumberStatus: NOT_EXPOSED_BY_BINDING` rather than
copying a display name and falsely claiming product identity.

The HTTP wrapper is fail-closed. It accepts only bounded STEP bytes or a file
under an explicitly configured input root, creates a private temporary input
for every request, binds the native result to the input SHA-256, kills timed-out
children, and rejects malformed/non-zero native output. It never rewrites STEP
text or infers product identity from topology.

Build locally (inside the Docker build image):

```sh
docker build -f containers/occt-xcaf/Dockerfile .
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

The repository environment does not provide a local CMake/OCCT toolchain. A
native PASS must therefore come from a successfully built Docker/native worker;
the source-level and mock-worker tests are not native evidence. Until that build
is run, deployment qualification remains `HOLD`.
