// Ambient module shims for deps that don't ship .d.ts files.
declare module 'occt-import-js' {
  type LocateFile = (filename: string) => string;
  const factory: (opts?: { locateFile?: LocateFile }) => Promise<unknown>;
  export default factory;
}
