#!/usr/bin/env bun
import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { error } from "./utils.ts";
import { updateProject } from "./update.ts";
import * as colors from "@std/fmt/colors";

const HELP = `@fresh/update

Update a Fresh project. This updates dependencies and optionally performs code
mods to update a project's source code to the latest recommended patterns.

To upgrade a project in the current directory, run:
  bunx @fresh/update .

USAGE:
    @fresh/update [DIRECTORY]
`;

const flags = parseArgs(process.argv.slice(2), {});

// deno-lint-ignore no-console
console.log(colors.bgRgb8(
  colors.rgb8(" 🍋 Fresh Updater ", 0),
  121,
));
// deno-lint-ignore no-console
console.log();

let unresolvedDirectory = process.argv.slice(2)[0];
if (flags._.length !== 1) {
  const userInput = prompt("Where is the project directory?", ".");
  if (!userInput) {
    error(HELP);
  }

  unresolvedDirectory = userInput;
}

const dir = path.resolve(unresolvedDirectory);
await updateProject(dir);
