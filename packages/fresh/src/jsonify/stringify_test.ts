import { test } from "bun:test";
import { expect } from "@std/expect";
import { stringify } from "./stringify.ts";

test("stringify - object prototype", () => {
  const obj = { __proto__: 123, foo: 1 };
  expect(stringify(obj)).toEqual(
    '[{"foo":1},1]',
  );
});

test("stringify - throw serializing functions", () => {
  const fn = () => {};
  expect(() => stringify(fn)).toThrow();
});
