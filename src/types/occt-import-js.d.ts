declare module 'occt-import-js' {
  interface OcctMesh {
    attributes: {
      position: { array: Float32Array };
      normal?: { array: Float32Array };
    };
    index?: { array: Uint32Array };
  }

  interface OcctResult {
    success: boolean;
    meshes: OcctMesh[];
  }

  interface OcctInstance {
    ReadStepFile(buffer: Uint8Array, params: null): OcctResult;
    ReadIgesFile(buffer: Uint8Array, params: null): OcctResult;
    ReadBrepFile(buffer: Uint8Array, params: null): OcctResult;
  }

  export default function occtimport(options?: { locateFile?: (path: string) => string }): Promise<OcctInstance>;
}
