import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { createFromBuffer, type Formatter } from "@dprint/formatter";
import { getPath } from "@dprint/typescript";

let formatter: Formatter | null = null;

function getFormatter(): Formatter {
  if (formatter === null) {
    formatter = createFromBuffer(fs.readFileSync(getPath()));
    // Same settings `deno fmt` uses for dprint-plugin-typescript.
    formatter.setConfig(
      { indentWidth: 2, lineWidth: 80, useTabs: false },
      {
        quoteStyle: "preferDouble",
        semiColons: "prefer",
        "module.sortImportDeclarations": "maintain",
        "module.sortExportDeclarations": "maintain",
        "exportDeclaration.sortNamedExports": "maintain",
        "importDeclaration.sortNamedImports": "maintain",
        ignoreNodeCommentText: "deno-fmt-ignore",
        ignoreFileCommentText: "deno-fmt-ignore-file",
      },
    );
  }
  return formatter;
}

/** Format a TypeScript/JavaScript file in place, like `deno fmt <file>`. */
export async function formatFile(filePath: string): Promise<void> {
  const text = await fsp.readFile(filePath, "utf-8");
  let formatted: string;
  try {
    formatted = getFormatter().formatText({ filePath, fileText: text });
  } catch {
    // Leave files with syntax errors untouched, like `deno fmt` does
    return;
  }
  if (formatted !== text) {
    await fsp.writeFile(filePath, formatted);
  }
}
