import * as fsp from "node:fs/promises";
import * as path from "@std/path";
import { isNotFound } from "./server.ts";

/** An entry yielded by {@linkcode walk}. Same shape as `@std/fs/walk`. */
export interface WalkEntry {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

/** Options for {@linkcode walk}. Same shape as `@std/fs/walk`. */
export interface WalkOptions {
  maxDepth?: number;
  includeFiles?: boolean;
  includeDirs?: boolean;
  includeSymlinks?: boolean;
  followSymlinks?: boolean;
  canonicalize?: boolean;
  exts?: string[];
  match?: RegExp[];
  skip?: RegExp[];
}

function include(
  p: string,
  exts?: string[],
  match?: RegExp[],
  skip?: RegExp[],
): boolean {
  if (exts && !exts.some((ext) => p.endsWith(ext))) return false;
  if (match && !match.some((pattern) => !!p.match(pattern))) return false;
  if (skip && skip.some((pattern) => !!p.match(pattern))) return false;
  return true;
}

async function createWalkEntry(p: string): Promise<WalkEntry> {
  p = path.normalize(p);
  const name = path.basename(p);
  const info = await fsp.stat(p);
  return {
    path: p,
    name,
    isFile: info.isFile(),
    isDirectory: info.isDirectory(),
    isSymlink: false,
  };
}

/**
 * Recursively walk a directory. Port of `@std/fs/walk` on top of
 * `node:fs` so that it works outside of Deno.
 */
export async function* walk(
  root: string | URL,
  options: WalkOptions = {},
): AsyncIterableIterator<WalkEntry> {
  let {
    maxDepth = Infinity,
    includeFiles = true,
    includeDirs = true,
    includeSymlinks = true,
    followSymlinks = false,
    canonicalize = true,
    exts = undefined,
    match = undefined,
    skip = undefined,
  } = options;

  if (maxDepth < 0) return;
  root = root instanceof URL ? path.fromFileUrl(root) : root;
  if (exts) {
    exts = exts.map((ext) => ext.startsWith(".") ? ext : `.${ext}`);
  }
  if (includeDirs && include(root, exts, match, skip)) {
    yield await createWalkEntry(root);
  }
  if (maxDepth < 1 || !include(root, undefined, undefined, skip)) return;

  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    let p = path.join(root, entry.name);
    let isSymlink = entry.isSymbolicLink();
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (isSymlink) {
      if (!followSymlinks) {
        if (includeSymlinks && include(p, exts, match, skip)) {
          yield { path: p, name: entry.name, isFile, isDirectory, isSymlink };
        }
        continue;
      }
      const realPath = await fsp.realpath(p);
      if (canonicalize) p = realPath;
      const info = await fsp.lstat(realPath);
      isSymlink = info.isSymbolicLink();
      isDirectory = info.isDirectory();
      isFile = info.isFile();
    }

    if (isSymlink || isDirectory) {
      yield* walk(p, {
        maxDepth: maxDepth - 1,
        includeFiles,
        includeDirs,
        includeSymlinks,
        followSymlinks,
        exts,
        match,
        skip,
      });
    } else if (includeFiles && include(p, exts, match, skip)) {
      yield { path: p, name: entry.name, isFile, isDirectory, isSymlink };
    }
  }
}

export interface FsAdapter {
  cwd(): string;
  walk(
    root: string | URL,
    options?: WalkOptions,
  ): AsyncIterableIterator<WalkEntry>;
  isDirectory(path: string | URL): Promise<boolean>;
  mkdirp(dir: string): Promise<void>;
  readFile(path: string | URL): Promise<Uint8Array>;
  readTextFile(path: string | URL): Promise<string>;
}

export const fsAdapter: FsAdapter = {
  walk,
  cwd: () => process.cwd(),
  async isDirectory(path) {
    try {
      const stat = await fsp.stat(path);
      return stat.isDirectory();
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  },
  async mkdirp(dir: string) {
    await fsp.mkdir(dir, { recursive: true });
  },
  async readFile(path) {
    return new Uint8Array(await fsp.readFile(path));
  },
  readTextFile(path) {
    return fsp.readFile(path, "utf-8");
  },
};
