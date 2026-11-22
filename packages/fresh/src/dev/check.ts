import * as fsp from "node:fs/promises";
import * as JSONC from "@std/jsonc";
import * as path from "@std/path";
import { isNotFound } from "../server.ts";

export interface TsConfig {
  extends?: string | string[];
  compilerOptions?: {
    jsx?: string;
    jsxImportSource?: string;
  };
}

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];

export async function checkCompilerOptions(root: string) {
  const tsconfig = await findNearestConfigWithCompilerOptions(root);

  const jsxImportSource = tsconfig.config.compilerOptions?.jsxImportSource;
  if (jsxImportSource === undefined) {
    throw new Error(
      `Option compilerOptions > jsxImportSource not set in: ${tsconfig.filePath}`,
    );
  }

  return { jsxImportSource, configPath: tsconfig.filePath };
}

async function readConfig(filePath: string): Promise<TsConfig | null> {
  try {
    const text = await fsp.readFile(filePath, "utf-8");
    return JSONC.parse(text) as TsConfig;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * Resolve `compilerOptions` of a tsconfig, following relative `extends`.
 */
async function resolveCompilerOptions(
  filePath: string,
  config: TsConfig,
  seen = new Set<string>(),
): Promise<TsConfig["compilerOptions"]> {
  seen.add(filePath);
  let base: TsConfig["compilerOptions"] = {};
  const parents = config.extends === undefined
    ? []
    : Array.isArray(config.extends)
    ? config.extends
    : [config.extends];
  for (const ext of parents) {
    let parentPath: string;
    if (ext.startsWith(".") || path.isAbsolute(ext)) {
      parentPath = path.resolve(path.dirname(filePath), ext);
      if (!parentPath.endsWith(".json")) parentPath += ".json";
    } else {
      // Package based config, e.g. "@tsconfig/bun"
      try {
        parentPath = (await import("node:module")).createRequire(filePath)
          .resolve(ext);
      } catch {
        continue;
      }
    }
    if (seen.has(parentPath)) continue;
    const parent = await readConfig(parentPath);
    if (parent === null) continue;
    base = {
      ...base,
      ...await resolveCompilerOptions(parentPath, parent, seen),
    };
  }
  return { ...base, ...config.compilerOptions };
}

export async function findNearestConfigWithCompilerOptions(
  directory: string,
): Promise<{ config: TsConfig; filePath: string }> {
  let dir = directory;
  while (true) {
    for (const name of CONFIG_NAMES) {
      const filePath = path.join(dir, name);
      const config = await readConfig(filePath);
      if (config === null) continue;

      const compilerOptions = await resolveCompilerOptions(filePath, config);
      if (compilerOptions && Object.keys(compilerOptions).length > 0) {
        return { config: { ...config, compilerOptions }, filePath };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Could not find a tsconfig.json or jsconfig.json file in the current directory or any parent directory that contains a 'compilerOptions' field.`,
  );
}
