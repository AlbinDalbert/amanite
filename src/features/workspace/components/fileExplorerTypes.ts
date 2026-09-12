export type FileExplorerMenu = { kind?: "folder" | "page"; path?: string; x: number; y: number };

export type ExplorerEntry =
  | { kind: "folder"; path: string; folder: import("@/lib/fractal/types").FractalFolder; children: ExplorerEntry[] }
  | { kind: "page"; path: string; page: import("@/lib/fractal/types").FractalPage };
