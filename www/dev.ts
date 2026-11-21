#!/usr/bin/env -S bun --watch

import { Builder } from "fresh/dev";
import { tailwind } from "@fresh/plugin-tailwind";

const builder = new Builder({ target: "safari12" });
tailwind(builder);

if (process.argv.slice(2).includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}
