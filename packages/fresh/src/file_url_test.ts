import { test } from "bun:test";
import { expect } from "@std/expect";
import { pathToFileUrl, relativeUrl } from "./file_url.ts";

test("pathToFileUrl", () => {
  expect(pathToFileUrl("file:///foo/bar")).toEqual("file:///foo/bar");
  expect(pathToFileUrl("/foo/bar")).toEqual("file:///foo/bar");
});

test("relativeUrl", () => {
  const a = pathToFileUrl("file://foo/bar");
  const b = pathToFileUrl("file://foo/baz");

  expect(relativeUrl(a, b)).toEqual("../baz");
});
