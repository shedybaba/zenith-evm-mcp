declare module "solc" {
  export interface SolcCompiler {
    version(): string;
    compile(
      input: string,
      callbacks?: { import?: (path: string) => { contents: string } | { error: string } },
    ): string;
    loadRemoteVersion(version: string, cb: (err: Error | null, solc: SolcCompiler) => void): void;
  }
  const solc: SolcCompiler;
  export default solc;
}
