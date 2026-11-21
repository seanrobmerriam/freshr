import * as fsp from "node:fs/promises";
/**
 * Verifies that all image references in documentation markdown files
 * point to existing files in www/static/.
 *
 * Run: bun test docs/check_images_test.ts
 */
import { test } from "bun:test";
import { walk } from "../packages/fresh/src/fs.ts";
import { join, resolve } from "@std/path";

const ROOT = resolve(import.meta.dirname!);
const PROJECT_ROOT = resolve(ROOT, "..");
const DOCS_DIR = ROOT;
const STATIC_DIR = join(PROJECT_ROOT, "www", "static");

const IMAGE_RE = /!\[.*?\]\(([^)]+)\)/g;

test("all doc image references point to existing files", async () => {
  const errors: string[] = [];

  for await (
    const entry of walk(DOCS_DIR, {
      exts: [".md", ".mdx"],
      includeDirs: false,
    })
  ) {
    const content = await fsp.readFile(entry.path, "utf-8");
    const relativePath = entry.path.slice(PROJECT_ROOT.length);

    for (const match of content.matchAll(IMAGE_RE)) {
      const imgPath = match[1];

      // Skip external URLs
      if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) {
        continue;
      }

      // Doc image paths like "/docs/foo.png" map to "www/static/docs/foo.png"
      const fsPath = join(STATIC_DIR, imgPath);

      try {
        await fsp.stat(fsPath);
      } catch {
        errors.push(`${relativePath}: image not found: ${imgPath}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Found ${errors.length} broken image reference(s):\n\n${
        errors.join("\n")
      }`,
    );
  }
});
