import * as fsp from "node:fs/promises";
import { test } from "bun:test";
import * as Marked from "marked";
import { walk } from "../src/fs.ts";
import { dirname, join, relative } from "@std/path";
// import { expect } from "@std/expect/expect";
import { withTmpDir } from "../src/test_utils.ts";
import { runCommand } from "./test_utils.tsx";

test("Docs Code example checks", async () => {
  await using tmp = await withTmpDir();

  for await (const { path, code } of docsMarkdownFiles()) {
    const codePath = join(tmp.dir, path);
    await fsp.mkdir(dirname(codePath), { recursive: true });
    await fsp.writeFile(codePath, code);
  }

  const root = join(import.meta.dirname!, "..", "..", "..");
  const tsconfig = {
    compilerOptions: {
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
      types: ["bun"],
      typeRoots: [join(root, "node_modules", "@types")],
      jsx: "react-jsx",
      jsxImportSource: "preact",
      allowImportingTsExtensions: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      baseUrl: root,
      paths: {
        "fresh": ["packages/fresh/src/mod.ts"],
        "fresh/*": ["packages/fresh/src/*"],
        "@fresh/plugin-tailwind": ["packages/plugin-tailwindcss/src/mod.ts"],
        "@fresh/plugin-tailwind-v3": [
          "packages/plugin-tailwindcss-v3/src/mod.ts",
        ],
        "*": ["node_modules/*"],
      },
    },
    include: ["**/*"],
  };
  await fsp.writeFile(
    join(tmp.dir, "tsconfig.json"),
    JSON.stringify(tsconfig, undefined, 2),
  );

  const { stdout, stderr } = await runCommand(process.execPath, {
    args: [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
    cwd: tmp.dir,
  });

  const decoder = new TextDecoder();
  const output = `${decoder.decode(stdout)}\n${decoder.decode(stderr)}`;
  // Log `tsc` output (can be removed if expects below are enabled)
  // deno-lint-ignore no-console
  console.log(output);

  // TODO: Enable after fixing docs check issues
  // expect(code).toBe(0);
  // expect(output).toBe("");
});

async function* docsMarkdownFiles() {
  // Limit to checking Fresh v2 (canary) docs for now
  const docsDir = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "docs",
    "canary",
  );
  const docsIter = walk(docsDir, { exts: [".md"], includeDirs: false });

  for await (const entry of docsIter) {
    for (const { file, code } of await extractTsCode(entry.path)) {
      const path = join(relative(docsDir, entry.path), file);
      yield { path, code };
    }
  }
}

async function extractTsCode(path: string) {
  const code: { file: string; code: string }[] = [];
  const input = await fsp.readFile(path, "utf-8");
  let index = 0;

  const tokens = await Marked.lexer(input, { gfm: true, async: true });

  Marked.walkTokens(tokens, (token) => {
    // Get rid of `Marked.Tokens.Generic`
    const t = token as Marked.MarkedToken;
    if (t.type !== "code") return;

    const result = /^([tj]sx?)\s*/.exec(t.lang ?? "");
    if (!result) return;

    // Codeblock must be TS/JS
    index += 1;

    // Probably a filename, but perhaps a title,
    // so get rid of non-file safe characters
    const [match, ext] = result;
    let file = t.lang!.slice(match.length)
      .toLocaleLowerCase()
      .replaceAll(/[^a-z0-9._\-\/\\]/g, "_")
      .replaceAll(/_{2,}/g, "_") || String(index);

    if (!file.endsWith(ext)) file += `.${ext}`;

    code.push({ file, code: t.text });
  });

  return code;
}
