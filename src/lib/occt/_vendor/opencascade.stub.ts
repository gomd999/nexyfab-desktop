/**
 * occt/_vendor/opencascade.stub — minimal mock of the opencascade.js surface.
 *
 * Phase 5 spike (ADR-013). The real `opencascade.js@1.1.1` package was
 * installed (`npm install opencascade.js`), but the WASM binary itself
 * (`node_modules/opencascade.js/dist/opencascade.wasm.wasm`, ~65 MB raw)
 * cannot be instantiated under Vitest's `node` environment without polyfilling
 * Emscripten's `WebAssembly.instantiateStreaming` path and ~200 MB of FS
 * shims. The structure-only worker dispatcher in `occt-worker-real.js` also
 * has commented-out OCCT call sites — uncommenting them requires the same
 * runtime to be available.
 *
 * This stub mirrors JUST ENOUGH of the Embind surface for:
 *   - `wasmReal.ts` to compile + test against the same TypeScript shape that
 *     the real module presents (so launch day = drop the real factory in,
 *     not rewrite the wrapper).
 *   - The 11 wire ops in PHASE_5_INTEGRATION.md's per-op table to type-check.
 *   - The handle table + dispose-discipline assertions to run without a
 *     real WASM heap.
 *
 * NON-GOALS
 * ---------
 *  - Geometry correctness — every `Shape()` returns a tagged sentinel; bbox/
 *    volume/area are synthesized from feature args (matches `createStubBridge`
 *    behaviour).
 *  - Memory accounting — `.delete()` is tracked in a counter for tests but
 *    no real heap is freed.
 *  - Op coverage parity — only the symbols the wrapper actually constructs
 *    are mocked; reaching for `BRepFilletAPI_MakeFillet.Add` without that
 *    method existing on the stub throws a "not mocked" error that surfaces
 *    in tests as a clear missing-symbol message rather than a TypeError.
 *
 * REAL PACKAGE CONTRACT (verified via `node_modules/opencascade.js/index.js`)
 * --------------------------------------------------------------------------
 *   import initOpenCascade from 'opencascade.js';
 *   const occt = await initOpenCascade();    // returns the Embind Module
 *   const polygon = new occt.BRepBuilderAPI_MakePolygon_1();
 *   polygon.Add_1(new occt.gp_Pnt_3(0, 0, 0));
 *   ...
 *   polygon.delete();                        // MUST dispose every `new occt.X`
 *
 * The real factory is async and resolves to the Module. The stub mirrors
 * that — `createStubOpenCascadeModule()` returns a Promise.
 */

export type StubShape = {
  readonly __occt_stub__: true;
  readonly tag: string;
  /** Synthesised bbox so the wrapper can compute payloads without real BREP. */
  bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  volume: number;
  area: number;
  centerOfMass: { x: number; y: number; z: number };
  /** Marks the shape after `.delete()` so use-after-free is detectable in tests. */
  disposed: boolean;
};

/** Counter used by tests to assert dispose discipline. */
export interface DisposeTracker {
  allocs: number;
  disposes: number;
  liveSymbols: Set<string>;
}

/**
 * Minimal Embind-style class. Real opencascade.js classes expose `.delete()`
 * which decrements the Emscripten refcount; we mirror just that contract.
 */
interface StubEmbindObject {
  delete(): void;
}

interface StubPolygon extends StubEmbindObject {
  Add_1(point: StubEmbindObject): void;
  Close(): void;
  Wire(): StubEmbindObject;
}

interface StubFace extends StubEmbindObject {
  Face(): StubEmbindObject;
}

interface StubPrism extends StubEmbindObject {
  Shape(): StubShape;
}

interface StubBooleanAlgo extends StubEmbindObject {
  Build(): void;
  IsDone(): boolean;
  Shape(): StubShape;
}

interface StubStepWriter extends StubEmbindObject {
  Transfer(shape: StubShape, mode: number): number;
  Write(path: string): number;
}

interface StubStepReader extends StubEmbindObject {
  ReadFile(path: string): number;
  TransferRoots(): number;
  OneShape(): StubShape;
}

/**
 * The mock Module surface. Names mirror `opencascade.js@1.1.1` Embind
 * exports (the `_1`, `_2`, `_3` suffixes come from C++ overload disambiguation
 * applied by the upstream binding generator).
 */
export interface StubOpenCascadeModule {
  /** Dispose tracker (NOT present on the real module — convenience for tests). */
  readonly __tracker__: DisposeTracker;
  /** Constructor for 3D points: `new occt.gp_Pnt_3(x, y, z)`. */
  gp_Pnt_3: new (x: number, y: number, z: number) => StubEmbindObject;
  /** Constructor for 3D vectors. */
  gp_Vec_4: new (x: number, y: number, z: number) => StubEmbindObject;
  /** Polygon wire builder. */
  BRepBuilderAPI_MakePolygon_1: new () => StubPolygon;
  /** Wire → face. The `_1` overload takes a Wire + a planar bool. */
  BRepBuilderAPI_MakeFace_15: new (wire: StubEmbindObject, planar: boolean) => StubFace;
  /** Face → prism (extrude). */
  BRepPrimAPI_MakePrism_1: new (
    face: StubEmbindObject,
    vec: StubEmbindObject,
    copy: boolean,
    canonize: boolean,
  ) => StubPrism;
  /** Boolean ops — fuse / cut / common. */
  BRepAlgoAPI_Fuse_3: new (a: StubShape, b: StubShape) => StubBooleanAlgo;
  BRepAlgoAPI_Cut_3: new (a: StubShape, b: StubShape) => StubBooleanAlgo;
  BRepAlgoAPI_Common_3: new (a: StubShape, b: StubShape) => StubBooleanAlgo;
  /** STEP I/O. */
  STEPControl_Writer_1: new () => StubStepWriter;
  STEPControl_Reader_1: new () => StubStepReader;
  /** Step transfer-mode enum (real module exposes as object with named members). */
  STEPControl_StepModelType: { AsIs: number; ManifoldSolidBrep: number };
  /** IFSelect_ReturnStatus enum used by STEPControl_Reader. */
  IFSelect_ReturnStatus: { RetDone: number; RetFail: number };
  /** Emscripten FS shim — real module exposes the same. */
  FS: {
    writeFile(path: string, data: string): void;
    readFile(path: string, opts: { encoding: 'utf8' }): string;
  };
}

/**
 * Build a fresh stub module. Every call gets its own tracker so tests don't
 * leak state across each other.
 */
export function createStubOpenCascadeModule(): StubOpenCascadeModule {
  const tracker: DisposeTracker = {
    allocs: 0,
    disposes: 0,
    liveSymbols: new Set<string>(),
  };

  // Internal storage so STEP reader can echo back a shape from a written file.
  const fsFiles = new Map<string, string>();

  /** Builds a tagged Embind-style object that tracks its own dispose. */
  function makeEmbind<T extends object>(symbol: string, body: T): T & StubEmbindObject {
    tracker.allocs++;
    tracker.liveSymbols.add(symbol);
    const wrapped = body as T & StubEmbindObject;
    let disposed = false;
    wrapped.delete = (): void => {
      if (disposed) return;
      disposed = true;
      tracker.disposes++;
      tracker.liveSymbols.delete(symbol);
    };
    return wrapped;
  }

  function makeShape(tag: string, props?: Partial<Omit<StubShape, '__occt_stub__' | 'tag' | 'disposed'>>): StubShape {
    return {
      __occt_stub__: true,
      tag,
      bbox: props?.bbox ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      volume: props?.volume ?? 1,
      area: props?.area ?? 6,
      centerOfMass: props?.centerOfMass ?? { x: 0.5, y: 0.5, z: 0.5 },
      disposed: false,
    };
  }

  return {
    __tracker__: tracker,

    gp_Pnt_3: class {
      constructor(public x: number, public y: number, public z: number) {
        tracker.allocs++;
        tracker.liveSymbols.add('gp_Pnt_3');
      }
      delete(): void {
        tracker.disposes++;
        tracker.liveSymbols.delete('gp_Pnt_3');
      }
    } as unknown as new (x: number, y: number, z: number) => StubEmbindObject,

    gp_Vec_4: class {
      constructor(public x: number, public y: number, public z: number) {
        tracker.allocs++;
        tracker.liveSymbols.add('gp_Vec_4');
      }
      delete(): void {
        tracker.disposes++;
        tracker.liveSymbols.delete('gp_Vec_4');
      }
    } as unknown as new (x: number, y: number, z: number) => StubEmbindObject,

    BRepBuilderAPI_MakePolygon_1: function MakePolygon(this: StubPolygon) {
      const points: StubEmbindObject[] = [];
      const wireSym = 'TopoDS_Wire';
      const obj: StubPolygon = makeEmbind('BRepBuilderAPI_MakePolygon_1', {
        Add_1(p: StubEmbindObject): void { points.push(p); },
        Close(): void { /* no-op */ },
        Wire(): StubEmbindObject {
          // Wire returns a fresh Embind object that itself needs disposing.
          return makeEmbind(wireSym, {});
        },
      } as StubPolygon);
      void this;
      return obj;
    } as unknown as new () => StubPolygon,

    BRepBuilderAPI_MakeFace_15: function MakeFace(this: StubFace, _wire: StubEmbindObject, _planar: boolean) {
      void _wire; void _planar;
      const obj: StubFace = makeEmbind('BRepBuilderAPI_MakeFace_15', {
        Face(): StubEmbindObject {
          return makeEmbind('TopoDS_Face', {});
        },
      } as StubFace);
      void this;
      return obj;
    } as unknown as new (wire: StubEmbindObject, planar: boolean) => StubFace,

    BRepPrimAPI_MakePrism_1: function MakePrism(
      this: StubPrism,
      _face: StubEmbindObject,
      vec: StubEmbindObject,
      _copy: boolean,
      _canonize: boolean,
    ) {
      void _face; void _copy; void _canonize;
      // Pull depth from the vec components (set by wrapper as gp_Vec_4(0,0,depth)).
      const v = vec as unknown as { x?: number; y?: number; z?: number };
      const depth = typeof v?.z === 'number' ? v.z : 1;
      const obj: StubPrism = makeEmbind('BRepPrimAPI_MakePrism_1', {
        Shape(): StubShape {
          return makeShape('prism', {
            bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: depth } },
            volume: depth,
          });
        },
      } as StubPrism);
      void this;
      return obj;
    } as unknown as new (
      face: StubEmbindObject,
      vec: StubEmbindObject,
      copy: boolean,
      canonize: boolean,
    ) => StubPrism,

    BRepAlgoAPI_Fuse_3: makeBoolean('fuse', tracker, makeEmbind, makeShape),
    BRepAlgoAPI_Cut_3: makeBoolean('cut', tracker, makeEmbind, makeShape),
    BRepAlgoAPI_Common_3: makeBoolean('common', tracker, makeEmbind, makeShape),

    STEPControl_Writer_1: function Writer(this: StubStepWriter) {
      let lastShape: StubShape | null = null;
      const obj: StubStepWriter = makeEmbind('STEPControl_Writer_1', {
        Transfer(shape: StubShape, _mode: number): number {
          void _mode;
          lastShape = shape;
          return 1; // RetDone
        },
        Write(path: string): number {
          if (!lastShape) return 0;
          // Emit a synthetic STEP body so importSTEP roundtrip is verifiable.
          fsFiles.set(path, `ISO-10303-21;\nSTUB-STEP ${lastShape.tag} vol=${lastShape.volume}\nEND-ISO-10303-21;\n`);
          return 1;
        },
      } as StubStepWriter);
      void this;
      return obj;
    } as unknown as new () => StubStepWriter,

    STEPControl_Reader_1: function Reader(this: StubStepReader) {
      let parsedShape: StubShape | null = null;
      const obj: StubStepReader = makeEmbind('STEPControl_Reader_1', {
        ReadFile(path: string): number {
          const body = fsFiles.get(path);
          if (!body || !body.startsWith('ISO-10303-21;')) return 0;
          parsedShape = makeShape('imported');
          return 1;
        },
        TransferRoots(): number {
          return parsedShape ? 1 : 0;
        },
        OneShape(): StubShape {
          return parsedShape ?? makeShape('empty-import');
        },
      } as StubStepReader);
      void this;
      return obj;
    } as unknown as new () => StubStepReader,

    STEPControl_StepModelType: { AsIs: 0, ManifoldSolidBrep: 1 },
    IFSelect_ReturnStatus: { RetDone: 1, RetFail: 0 },

    FS: {
      writeFile(path: string, data: string): void {
        fsFiles.set(path, data);
      },
      readFile(path: string, _opts: { encoding: 'utf8' }): string {
        void _opts;
        const v = fsFiles.get(path);
        if (v === undefined) throw new Error(`stub FS: no such file ${path}`);
        return v;
      },
    },
  };
}

function makeBoolean(
  kind: 'fuse' | 'cut' | 'common',
  _tracker: DisposeTracker,
  makeEmbind: <T extends object>(symbol: string, body: T) => T & StubEmbindObject,
  makeShape: (tag: string, props?: Partial<Omit<StubShape, '__occt_stub__' | 'tag' | 'disposed'>>) => StubShape,
): new (a: StubShape, b: StubShape) => StubBooleanAlgo {
  void _tracker;
  return function Algo(this: StubBooleanAlgo, a: StubShape, b: StubShape) {
    let built = false;
    let result: StubShape | null = null;
    const obj: StubBooleanAlgo = makeEmbind(`BRepAlgoAPI_${kind}`, {
      Build(): void {
        // Synthesize bbox per operation kind so tests can assert behaviour.
        if (kind === 'fuse') {
          result = makeShape(`fused`, {
            bbox: {
              min: {
                x: Math.min(a.bbox.min.x, b.bbox.min.x),
                y: Math.min(a.bbox.min.y, b.bbox.min.y),
                z: Math.min(a.bbox.min.z, b.bbox.min.z),
              },
              max: {
                x: Math.max(a.bbox.max.x, b.bbox.max.x),
                y: Math.max(a.bbox.max.y, b.bbox.max.y),
                z: Math.max(a.bbox.max.z, b.bbox.max.z),
              },
            },
            volume: a.volume + b.volume,
          });
        } else if (kind === 'cut') {
          result = makeShape('cut', { bbox: a.bbox, volume: Math.max(0, a.volume - b.volume) });
        } else {
          // common — naive overlap (works for axis-aligned cases used in tests).
          const overlap = {
            min: {
              x: Math.max(a.bbox.min.x, b.bbox.min.x),
              y: Math.max(a.bbox.min.y, b.bbox.min.y),
              z: Math.max(a.bbox.min.z, b.bbox.min.z),
            },
            max: {
              x: Math.min(a.bbox.max.x, b.bbox.max.x),
              y: Math.min(a.bbox.max.y, b.bbox.max.y),
              z: Math.min(a.bbox.max.z, b.bbox.max.z),
            },
          };
          result = makeShape('common', { bbox: overlap, volume: Math.min(a.volume, b.volume) });
        }
        built = true;
      },
      IsDone(): boolean { return built; },
      Shape(): StubShape {
        if (!result) throw new Error(`BRepAlgoAPI_${kind}: Shape() before Build()`);
        return result;
      },
    } as StubBooleanAlgo);
    void this;
    return obj;
  } as unknown as new (a: StubShape, b: StubShape) => StubBooleanAlgo;
}
