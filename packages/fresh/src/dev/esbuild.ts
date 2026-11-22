import * as fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BuildOptions, Plugin as EsbuildPlugin } from "esbuild";
import * as path from "@std/path";

export interface FreshBundleOptions {
  dev: boolean;
  cwd: string;
  buildId: string;
  outDir: string;
  /** Path to the tsconfig.json that configures JSX */
  configPath?: string;
  entryPoints: Record<string, string>;
  target: string | string[];
  jsxImportSource?: string;
  sourceMap?: {
    /** Documentation: https://esbuild.github.io/api/#sourcemap */
    kind: BuildOptions["sourcemap"];
    /** Documentation: https://esbuild.github.io/api/#source-root */
    sourceRoot?: BuildOptions["sourceRoot"];
    /** Documentation: https://esbuild.github.io/api/#sources-content */
    sourcesContent?: BuildOptions["sourcesContent"];
  };
}

export interface BuildOutput {
  entryToChunk: Map<string, string>;
  dependencies: Map<string, string[]>;
  files: Array<{ hash: string | null; contents: Uint8Array; path: string }>;
}

let esbuild: null | typeof import("esbuild") = null;

const PREACT_ENV = process.env.PREACT_PATH;

const PUBLIC_ENV_PREFIX = "FRESH_PUBLIC_";

/**
 * Inline public environment variables into client code, like the
 * `publicEnvVarPrefix` option of the former Deno esbuild plugin.
 */
function publicEnvDefines(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(PUBLIC_ENV_PREFIX) || value === undefined) continue;
    const json = JSON.stringify(value);
    out[`process.env.${key}`] = json;
    out[`Bun.env.${key}`] = json;
    out[`import.meta.env.${key}`] = json;
  }
  return out;
}

export async function bundleJs(
  options: FreshBundleOptions,
): Promise<BuildOutput> {
  if (esbuild === null) {
    await startEsbuild();
  }

  await fsp.mkdir(options.cwd, { recursive: true });

  const bundle = await esbuild!.build({
    entryPoints: options.entryPoints,

    platform: "browser",
    target: options.target,

    format: "esm",
    bundle: true,
    splitting: true,
    treeShaking: true,
    sourcemap: options.dev ? "linked" : options.sourceMap?.kind,
    sourceRoot: options.dev ? undefined : options.sourceMap?.sourceRoot,
    sourcesContent: options.dev ? undefined : options.sourceMap?.sourcesContent,
    minify: !options.dev,
    logOverride: {
      "suspicious-nullish-coalescing": "silent",
      "unsupported-jsx-comment": "silent",
    },

    jsxDev: options.dev,
    jsx: "automatic",
    jsxImportSource: options.jsxImportSource ?? "preact",

    absWorkingDir: options.cwd,
    outdir: ".",
    write: false,
    metafile: true,

    tsconfig: options.configPath,
    define: {
      ...publicEnvDefines(),
      "process.env.NODE_ENV": JSON.stringify(
        options.dev ? "development" : "production",
      ),
    },

    plugins: [
      preactDebugger(PREACT_ENV),
      buildIdPlugin(options.buildId),
      windowsPathFixer(),
      specifierPlugin(),
    ],
  });

  const files: BuildOutput["files"] = [];
  for (let i = 0; i < bundle.outputFiles.length; i++) {
    const outputFile = bundle.outputFiles[i];
    const relative = path.relative(options.cwd, outputFile.path);
    files.push({
      path: relative,
      contents: outputFile.contents,
      hash: outputFile.hash,
    });
  }

  files.push({
    path: "metafile.json",
    contents: new TextEncoder().encode(JSON.stringify(bundle.metafile)),
    hash: null,
  });

  const entryToChunk = new Map<string, string>();
  const dependencies = new Map<string, string[]>();

  const entryToName = new Map(
    Array.from(Object.entries(options.entryPoints)).map(
      (entry) => [entry[1], entry[0]],
    ),
  );

  if (bundle.metafile) {
    const metaOutputs = new Map(Object.entries(bundle.metafile.outputs));

    for (const [entryPath, entry] of metaOutputs.entries()) {
      const imports = entry.imports
        .filter(({ kind }) => kind === "import-statement")
        .map(({ path }) => path);
      dependencies.set(entryPath, imports);

      // Map entries to chunks
      if (entryPath !== "fresh-runtime.js" && entry.entryPoint !== undefined) {
        const basename = path.basename(
          entryPath,
          path.extname(entryPath),
        );

        const filePath = options.entryPoints[basename];

        const name = entryToName.get(filePath)!;
        entryToChunk.set(name, entryPath);
      }
    }
  }

  if (!options.dev) {
    esbuild = null;
  }

  return {
    files,
    entryToChunk,
    dependencies,
  };
}

export async function startEsbuild() {
  esbuild = await import("esbuild");
}

function buildIdPlugin(buildId: string): EsbuildPlugin {
  return {
    name: "fresh-build-id",
    setup(build) {
      build.onResolve({ filter: /^(jsr:)?@fresh\/build-id/ }, (args) => {
        return {
          path: args.path,
          namespace: "fresh-internal-build-id",
        };
      });
      build.onLoad({
        filter: /.*/,
        namespace: "fresh-internal-build-id",
      }, () => {
        return {
          contents: `export const BUILD_ID = "${buildId}";`,
        };
      });
    },
  };
}

function toPreactModPath(mod: string): string {
  if (mod === "preact/debug") {
    return path.join("debug", "dist", "debug.module.js");
  } else if (mod === "preact/hooks") {
    return path.join("hooks", "dist", "hooks.module.js");
  } else if (mod === "preact/devtools") {
    return path.join("devtools", "dist", "devtools.module.js");
  } else if (mod === "preact/compat") {
    return path.join("compat", "dist", "compat.module.js");
  } else if (mod === "preact/jsx-runtime" || mod === "preact/jsx-dev-runtime") {
    return path.join("jsx-runtime", "dist", "jsxRuntime.module.js");
  } else {
    return path.join("dist", "preact.module.js");
  }
}

function preactDebugger(preactPath: string | undefined): EsbuildPlugin {
  return {
    name: "fresh-preact-debugger",
    setup(build) {
      if (preactPath === undefined) return;

      build.onResolve({ filter: /^preact/ }, (args) => {
        const resolved = path.resolve(preactPath, toPreactModPath(args.path));

        return {
          path: resolved,
        };
      });
    },
  };
}

function windowsPathFixer(): EsbuildPlugin {
  return {
    name: "fresh-fix-windows",
    setup(build) {
      if (process.platform === "win32") {
        build.onResolve({ filter: /\.*/ }, (args) => {
          if (args.path.startsWith("\\")) {
            const normalized = path.resolve(args.path);
            return {
              path: normalized,
            };
          }
        });
      }
    },
  };
}

/**
 * Normalize specifiers that esbuild can't resolve on its own:
 *
 * - `file://` URLs are turned into paths
 * - `npm:foo@1.2.3/bar` and `jsr:@foo/bar@1/baz` prefixes are stripped so
 *   that the package is resolved from `node_modules`.
 */
function specifierPlugin(): EsbuildPlugin {
  return {
    name: "fresh-specifiers",
    setup(build) {
      build.onResolve({ filter: /^(file|npm|jsr):/ }, async (args) => {
        if (args.path.startsWith("file:")) {
          return { path: fileURLToPath(args.path) };
        }

        const bare = stripRegistryPrefix(args.path);
        const result = await build.resolve(bare, {
          kind: args.kind,
          resolveDir: args.resolveDir || build.initialOptions.absWorkingDir,
          importer: args.importer,
        });
        if (result.errors.length > 0) {
          return { errors: result.errors };
        }
        return { path: result.path, external: result.external };
      });
    },
  };
}

/**
 * Turn `npm:preact@^10/hooks` into `preact/hooks` and
 * `jsr:@std/path@1/posix` into `@std/path/posix`.
 */
export function stripRegistryPrefix(spec: string): string {
  const match = spec.match(
    /^(?:npm|jsr):\/?((?:@[^/@]+\/)?[^/@]+)(?:@[^/]*)?(\/.*)?$/,
  );
  if (match === null) return spec;
  return match[1] + (match[2] ?? "");
}
