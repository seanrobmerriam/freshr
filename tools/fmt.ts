/**
 * Formats the repository like `deno fmt` did: it uses the same dprint
 * plugins (TypeScript/JavaScript, JSON and Markdown) with Deno's defaults.
 *
 * Usage:
 *   bun tools/fmt.ts          # format files in place
 *   bun tools/fmt.ts --check  # exit with 1 if a file isn't formatted
 *   bun tools/fmt.ts [paths]  # only format the given files/directories
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createFromBuffer, type Formatter } from "@dprint/formatter";
import { getPath as getTsPath } from "@dprint/typescript";
import { getPath as getJsonPath } from "@dprint/json";
import { getPath as getMarkdownPath } from "@dprint/markdown";
import { walk } from "../packages/fresh/src/fs.ts";

const ROOT = path.join(import.meta.dirname!, "..");

const GLOBAL_CONFIG = { indentWidth: 2, lineWidth: 80, useTabs: false };

function create(wasmPath: string, config: Record<string, unknown>) {
  const formatter = createFromBuffer(fs.readFileSync(wasmPath));
  formatter.setConfig(GLOBAL_CONFIG, config);
  return formatter;
}

// Same plugin configuration `deno fmt` uses by default.
const typescript = create(getTsPath(), {
  deno: true,
  quoteStyle: "preferDouble",
  semiColons: "prefer",
  "module.sortImportDeclarations": "maintain",
  "module.sortExportDeclarations": "maintain",
  "exportDeclaration.sortNamedExports": "maintain",
  "importDeclaration.sortNamedImports": "maintain",
  ignoreNodeCommentText: "deno-fmt-ignore",
  ignoreFileCommentText: "deno-fmt-ignore-file",
});
const json = create(getJsonPath(), {
  deno: true,
  ignoreNodeCommentText: "deno-fmt-ignore",
  ignoreFileCommentText: "deno-fmt-ignore-file",
});
const markdown = create(getMarkdownPath(), {
  deno: true,
  textWrap: "always",
  ignoreDirective: "deno-fmt-ignore",
  ignoreFileDirective: "deno-fmt-ignore-file",
  ignoreStartDirective: "deno-fmt-ignore-start",
  ignoreEndDirective: "deno-fmt-ignore-end",
});

const TS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];
const JSON_EXTS = [".json", ".jsonc"];
const MD_EXTS = [".md", ".markdown"];

const SKIP = [
  /[\\/](node_modules|\.git|_fresh|vendor|coverage|\.vite|dist)([\\/]|$)/,
  /[\\/]tmp[_\\/]/,
  /[\\/]vite\.config\.ts\.[^\\/]+$/,
  /[\\/]www[\\/]static[\\/]/,
  /[\\/]__snapshots__[\\/]/,
  /[\\/](bun\.lock|package-lock\.json)$/,
];

function getFormatter(file: string): Formatter | null {
  const ext = path.extname(file).toLowerCase();
  if (TS_EXTS.includes(ext)) return typescript;
  if (JSON_EXTS.includes(ext)) return json;
  if (MD_EXTS.includes(ext)) return markdown;
  return null;
}

// Format embedded code blocks in markdown with the matching formatter.
markdown.setHostFormatter((request) => {
  const formatter = getFormatter(request.filePath);
  if (formatter === null || formatter === markdown) return request.fileText;
  try {
    return formatter.formatText(request);
  } catch {
    return request.fileText;
  }
});

async function* collectFiles(targets: string[]): AsyncGenerator<string> {
  for (const target of targets) {
    const abs = path.resolve(target);
    const stat = await fsp.stat(abs);
    if (stat.isFile()) {
      yield abs;
      continue;
    }
    for await (const entry of walk(abs, { includeDirs: false })) {
      // Match skip patterns relative to the target directory
      const rel = path.sep + path.relative(abs, entry.path);
      if (SKIP.some((pattern) => pattern.test(rel))) continue;
      if (getFormatter(entry.path) !== null) yield entry.path;
    }
  }
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const targets = args.filter((arg) => !arg.startsWith("--"));

let unformatted = 0;
let changed = 0;
let total = 0;
for await (const file of collectFiles(targets.length > 0 ? targets : [ROOT])) {
  const formatter = getFormatter(file);
  if (formatter === null) continue;
  total++;

  const text = await fsp.readFile(file, "utf-8");
  let result: string;
  try {
    result = formatter.formatText({ filePath: file, fileText: text });
  } catch (err) {
    // deno-lint-ignore no-console
    console.error(`Error formatting ${path.relative(ROOT, file)}: ${err}`);
    process.exitCode = 1;
    continue;
  }

  if (result === text) continue;
  if (check) {
    unformatted++;
    // deno-lint-ignore no-console
    console.error(`Not formatted: ${path.relative(ROOT, file)}`);
  } else {
    changed++;
    await fsp.writeFile(file, result);
  }
}

if (check) {
  // deno-lint-ignore no-console
  console.log(`Checked ${total} files`);
  if (unformatted > 0) {
    // deno-lint-ignore no-console
    console.error(`Found ${unformatted} not formatted files`);
    process.exit(1);
  }
} else {
  // deno-lint-ignore no-console
  console.log(`Checked ${total} files, formatted ${changed}`);
}
