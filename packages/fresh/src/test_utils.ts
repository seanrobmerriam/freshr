import type { test as bunTest } from "bun:test";
import { Context, type ServerIslandRegistry } from "./context.ts";
import type { FsAdapter } from "./fs.ts";
import type { BuildCache, StaticFile } from "./build_cache.ts";
import type { ResolvedFreshConfig } from "./config.ts";
import type { WalkEntry } from "./fs.ts";
import { DEFAULT_CONN_INFO } from "./app.ts";
import type { Command } from "./commands.ts";
import { fsItemsToCommands, type FsRouteFile } from "./fs_routes.ts";
import * as path from "@std/path";
import { toPosix } from "./dev/dev_build_cache.ts";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import type { ServeHandlerInfo } from "./server.ts";

const STUB = {} as unknown as ServeHandlerInfo;

export class FakeServer {
  constructor(
    public handler: (
      req: Request,
      info: ServeHandlerInfo,
    ) => Response | Promise<Response>,
  ) {}

  async get(path: string, init?: RequestInit): Promise<Response> {
    const url = this.toUrl(path);
    const req = new Request(url, init);
    return await this.handler(req, STUB);
  }
  async post(path: string, body?: BodyInit): Promise<Response> {
    const url = this.toUrl(path);
    const req = new Request(url, { method: "post", body });
    return await this.handler(req, STUB);
  }
  async patch(path: string, body?: BodyInit): Promise<Response> {
    const url = this.toUrl(path);
    const req = new Request(url, { method: "patch", body });
    return await this.handler(req, STUB);
  }
  async put(path: string, body?: BodyInit): Promise<Response> {
    const url = this.toUrl(path);
    const req = new Request(url, { method: "put", body });
    return await this.handler(req, STUB);
  }
  async delete(path: string): Promise<Response> {
    const url = this.toUrl(path);
    const req = new Request(url, { method: "delete" });
    return await this.handler(req, STUB);
  }
  async head(path: string): Promise<Response> {
    const url = this.toUrl(path);
    const req = new Request(url, { method: "head" });
    return await this.handler(req, STUB);
  }
  async options(path: string): Promise<Response> {
    const url = this.toUrl(path);
    const req = new Request(url, { method: "options" });
    return await this.handler(req, STUB);
  }

  async request(req: Request): Promise<Response> {
    return await this.handler(req, STUB);
  }

  private toUrl(path: string) {
    return new URL(path, "http://localhost/");
  }
}

const DEFAULT_CONFIG: ResolvedFreshConfig = {
  root: "",
  mode: "production",
  basePath: "",
  trustProxy: false,
};

export function serveMiddleware<T>(
  middleware: (ctx: Context<T>) => Response | Promise<Response>,
  options: {
    config?: ResolvedFreshConfig;
    buildCache?: BuildCache<T>;
    next?: () => Promise<Response>;
    route?: string | null;
  } = {},
): FakeServer {
  return new FakeServer(async (req) => {
    const next = options.next ??
      (() => new Response("not found", { status: 404 }));
    const config = options.config ?? DEFAULT_CONFIG;
    const buildCache = options.buildCache ??
      new MockBuildCache<T>([], options.config?.mode ?? "production");

    const ctx = new Context<T>(
      req,
      new URL(req.url),
      DEFAULT_CONN_INFO,
      options.route ?? null,
      {},
      config,
      () => Promise.resolve(next()),
      buildCache,
    );
    return await middleware(ctx);
  });
}

export function createFakeFs(files: Record<string, unknown>): FsAdapter {
  return {
    cwd: () => ".",
    async *walk(_root, options) {
      const skip = options?.skip ?? [];
      for (const file of Object.keys(files)) {
        // Check if file matches any skip pattern
        if (skip.some((pattern) => pattern.test(file))) {
          continue;
        }

        const entry: WalkEntry = {
          isDirectory: false,
          isFile: true,
          isSymlink: false,
          name: file,
          path: file,
        };
        yield entry;
      }
    },
    // deno-lint-ignore require-await
    async isDirectory(dir) {
      return Object.keys(files).some((file) =>
        // normalize path to posix before comparing
        toPosix(file).startsWith(dir + "/")
      );
    },
    async mkdirp(_dir: string) {
    },
    async readFile(path) {
      return new Uint8Array(await fsp.readFile(path));
    },
    // deno-lint-ignore require-await
    async readTextFile(path) {
      return String(files[String(path)]);
    },
  };
}

const REPO_TSCONFIG = path.join(
  import.meta.dirname!,
  "..",
  "..",
  "..",
  "tsconfig.json",
);

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withTmpDir(
  options?: { dir?: string; prefix?: string; suffix?: string },
): Promise<{ dir: string } & AsyncDisposable> {
  const parent = options?.dir ?? os.tmpdir();
  await fsp.mkdir(parent, { recursive: true });
  let dir = await fsp.mkdtemp(
    parent.replace(/[\\/]$/, "") + "/" + (options?.prefix ?? "tmp-"),
  );
  if (options?.suffix) {
    await fsp.rename(dir, dir + options.suffix);
    dir = dir + options.suffix;
  }
  if (options?.dir !== undefined) {
    // Deno discovered the workspace `deno.json` from any nested directory.
    // Bun only looks for `tsconfig.json` between the file and the current
    // working directory, so give temp projects inside the repo a config
    // that extends the root one. Tests may overwrite it.
    await fsp.writeFile(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ extends: REPO_TSCONFIG }),
    );
  }
  return {
    dir,
    async [Symbol.asyncDispose]() {
      // Skip pointless cleanup in CI, speed up tests
      if (process.env.CI === "true") return;

      try {
        await fsp.rm(dir, { recursive: true, force: true });
      } catch {
        // Temp files are not cleaned up automatically on Windows
        // deno-lint-ignore no-console
        console.warn(`Failed to clean up temp dir: "${dir}"`);
      }
    },
  };
}

export class MockBuildCache<State> implements BuildCache<State> {
  #files: FsRouteFile<State>[];
  root = "";
  clientEntry = "";
  islandRegistry: ServerIslandRegistry = new Map();
  features = { errorOverlay: false };

  constructor(files: FsRouteFile<State>[], mode: "development" | "production") {
    this.features.errorOverlay = mode === "development";
    this.#files = files;
  }

  getEntryAssets(): string[] {
    return [];
  }

  getFsRoutes(): Command<State>[] {
    return fsItemsToCommands(this.#files);
  }

  readFile(_pathname: string): Promise<StaticFile | null> {
    return Promise.resolve(null);
  }
}

/**
 * Wrapper around `bun:test` for integration tests. These typically spin up
 * builds or servers so they get a generous timeout.
 * Accepts either a name string or an options object, plus the test function.
 */
export function integrationTest(
  nameOrOptions: string | { name: string; ignore?: boolean; only?: boolean },
  fn: () => void | Promise<void>,
): void {
  const options = typeof nameOrOptions === "string"
    ? { name: nameOrOptions }
    : nameOrOptions;
  // Resolved lazily: importing "bun:test" at the top level would break this
  // module in production since `app.ts` depends on it.
  const { test } = require("bun:test") as { test: typeof bunTest };
  const t = options.ignore ? test.skip : options.only ? test.only : test;
  t(options.name, fn, 120_000);
}

export async function writeFiles(dir: string, files: Record<string, string>) {
  const entries = Object.entries(files);
  await Promise.all(entries.map(async (entry) => {
    const [pathname, content] = entry;
    const fullPath = path.join(dir, pathname);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, content);
  }));
}
