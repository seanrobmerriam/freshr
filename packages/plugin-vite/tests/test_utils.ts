import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { createRequire } from "node:module";
import * as net from "node:net";
import { createBuilder } from "vite";
import * as path from "@std/path";
import { walk } from "fresh/internal-dev";
import { integrationTest, withTmpDir } from "../../fresh/src/test_utils.ts";
import { withChildProcessServer } from "../../fresh/tests/test_utils.tsx";

export { integrationTest };

export const DEMO_DIR = path.join(import.meta.dirname!, "..", "demo");
export const FIXTURE_DIR = path.join(import.meta.dirname!, "fixtures");

/** Path to the Vite CLI, executed with Bun. */
const vitePkgPath = createRequire(import.meta.url).resolve(
  "vite/package.json",
);
export const VITE_BIN = path.join(
  path.dirname(vitePkgPath),
  // deno-lint-ignore no-explicit-any
  (JSON.parse(fs.readFileSync(vitePkgPath, "utf-8")) as any).bin.vite,
);

/**
 * Find a free TCP port. Vite's CLI treats `--port 0` as "not set" and falls
 * back to 5173. On macOS `localhost` is dual-stack, so a second server can
 * bind 5173 on the other address family instead of picking a new port and
 * requests end up at the wrong server.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function viteDevArgs(): Promise<string[]> {
  return [VITE_BIN, "--port", String(await getFreePort()), "--strictPort"];
}

export async function updateFile(
  filePath: string,
  fn: (text: string) => string | Promise<string>,
) {
  const original = await fsp.readFile(filePath, "utf-8");
  const result = await fn(original);
  await fsp.writeFile(filePath, result);

  return {
    async [Symbol.asyncDispose]() {
      await fsp.writeFile(filePath, original);
    },
  };
}

async function copyDir(from: string, to: string) {
  const entries = walk(from, {
    includeFiles: true,
    includeDirs: false,
    skip: [/([\\/]+(_fresh|node_modules|vendor)[\\/]+|[\\/]+vite\.config\.ts)/],
  });

  for await (const entry of entries) {
    if (entry.isFile) {
      const relative = path.relative(from, entry.path);
      const target = path.join(to, relative);

      await fsp.mkdir(path.dirname(target), { recursive: true });

      await fsp.copyFile(entry.path, target);
    }
  }
}

export async function prepareDevServer(fixtureDir: string) {
  const tmp = await withTmpDir({
    dir: path.join(import.meta.dirname!, ".."),
    prefix: "tmp_vite_",
  });

  await copyDir(fixtureDir, tmp.dir);

  await fsp.writeFile(
    path.join(tmp.dir, "vite.config.ts"),
    `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({
  plugins: [
    fresh(),
  ],
});
`,
  );

  return tmp;
}

export async function launchDevServer(
  dir: string,
  fn: (address: string, dir: string) => void | Promise<void>,
  env: Record<string, string> = {},
) {
  await withChildProcessServer(
    {
      cwd: dir,
      args: await viteDevArgs(),
      env,
    },
    async (address) => await fn(address, dir),
  );
}

export async function spawnDevServer(
  dir: string,
  env: Record<string, string> = {},
) {
  const boot = Promise.withResolvers<void>();
  const p = Promise.withResolvers<void>();

  let serverAddress = "";

  const server = withChildProcessServer(
    {
      cwd: dir,
      args: await viteDevArgs(),
      env,
    },
    async (address) => {
      serverAddress = address;
      boot.resolve();
      await p.promise;
    },
  );

  await boot.promise;

  return {
    dir,
    promise: server,
    address: () => {
      return serverAddress;
    },
    async [Symbol.asyncDispose]() {
      await p.resolve();
    },
  };
}

export async function withDevServer(
  fixtureDir: string,
  fn: (address: string, dir: string) => void | Promise<void>,
  env: Record<string, string> = {},
) {
  await using tmp = await prepareDevServer(fixtureDir);
  await launchDevServer(tmp.dir, fn, env);
}

export async function buildVite(
  fixtureDir: string,
  options?: {
    base?: string;
    rollupOutput?: {
      entryFileNames?: string;
      chunkFileNames?: string;
      assetFileNames?: string;
    };
  },
) {
  const tmp = await withTmpDir({
    dir: path.join(import.meta.dirname!, ".."),
    prefix: "tmp_vite_",
  });

  const builder = await createBuilder({
    logLevel: "error",
    root: fixtureDir,
    base: options?.base,
    build: {
      emptyOutDir: true,
    },
    environments: {
      ssr: {
        build: {
          outDir: path.join(tmp.dir, "_fresh", "server"),
          rollupOptions: options?.rollupOutput
            ? { output: options.rollupOutput }
            : undefined,
        },
      },
      client: {
        build: {
          outDir: path.join(tmp.dir, "_fresh", "client"),
        },
      },
    },
  });
  await builder.buildApp();

  return {
    tmp: tmp.dir,
    async [Symbol.asyncDispose]() {
      return await tmp[Symbol.asyncDispose]();
    },
  };
}

export function usingEnv(name: string, value: string) {
  const prev = process.env[name];
  process.env[name] = value;
  return {
    [Symbol.dispose]: () => {
      if (prev === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = prev;
      }
    },
  };
}

export interface ProdOptions {
  cwd: string;
  args?: string[];
  bin?: string;
  env?: Record<string, string>;
}

export async function launchProd(
  options: ProdOptions,
  fn: (address: string) => void | Promise<void>,
) {
  return await withChildProcessServer(
    {
      cwd: options.cwd,
      args: options.args ?? ["_fresh/server.js"],
      bin: options.bin,
      env: { PORT: "0", ...options.env },
    },
    fn,
  );
}
