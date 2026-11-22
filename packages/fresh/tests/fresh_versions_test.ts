import { test } from "bun:test";
import { expect } from "@std/expect";
import freshConfig from "../package.json" with { type: "json" };
import { FRESH_VERSION } from "../../update/src/update.ts";
import initConfig from "../../init/package.json" with { type: "json" };
import * as fsp from "node:fs/promises";
import * as path from "@std/path";

test("Fresh version consistency", async () => {
  // The version written into new and updated projects must match the
  // version of the core package.
  expect(FRESH_VERSION).toEqual(freshConfig.version);

  const initSource = await fsp.readFile(
    path.join(import.meta.dirname!, "..", "..", "init", "src", "init.ts"),
    "utf-8",
  );
  const match = initSource.match(/const FRESH_VERSION = "([^"]+)"/);
  expect(match?.[1]).toEqual(freshConfig.version);
  expect(initConfig.version).toEqual(freshConfig.version);
});
