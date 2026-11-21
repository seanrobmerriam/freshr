import { test } from "bun:test";
import { expect } from "@std/expect";
import { parseDirPath } from "./config.ts";

test("parseDirPath", () => {
  const cwd = process.cwd().replaceAll("\\", "/");

  // File paths
  expect(parseDirPath("file:///foo/bar", cwd)).toEqual("/foo/bar");
  if (process.platform === "win32") {
    expect(parseDirPath("file:///C:/foo/bar", cwd)).toEqual("C:/foo/bar");
  }

  // Relative paths
  expect(parseDirPath("./foo/bar", cwd)).toEqual(`${cwd}/foo/bar`);

  // Absolute paths
  expect(parseDirPath("/foo/bar", cwd)).toEqual("/foo/bar");
  if (process.platform === "win32") {
    expect(parseDirPath("C:/foo/bar", cwd)).toEqual("C:/foo/bar");
  }
});
