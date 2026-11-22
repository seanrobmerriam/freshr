#!/usr/bin/env bun
import { parseArgs } from "@std/cli/parse-args";
import { initProject } from "./init.ts";
import { InitError } from "./init.ts";

// Note: "bunx @fresh/init" is the recommended way to create a new project.

const flags = parseArgs(process.argv.slice(2), {
  boolean: ["force", "tailwind", "vscode", "docker", "help", "builder"],
  default: {
    force: null,
    tailwind: null,
    vscode: null,
    docker: null,
    builder: null,
  },
  alias: {
    help: "h",
  },
});

try {
  await initProject(process.cwd(), flags._, flags);
} catch (err) {
  if (err instanceof InitError) {
    process.exit(1);
  }
  throw err;
}
