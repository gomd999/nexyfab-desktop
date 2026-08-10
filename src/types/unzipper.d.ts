declare module 'unzipper' {
  interface Entry {
    path: string;
    type: 'File' | 'Directory';
    buffer(): Promise<Buffer>;
  }
  interface Directory { files: Entry[] }
  const unzipper: { Open: { file(path: string): Promise<Directory> } };
  export default unzipper;
}
