import * as fsp from "node:fs/promises";
import * as cl from "@std/fmt/colors";
import * as path from "@std/path";
import type { PackageJson } from "../packages/update/src/update.ts";
import * as semver from "@std/semver";

function showHelp() {
  // deno-lint-ignore no-console
  console.log(`
  Usage: bun tools/release.ts <major|minor|patch|...>
`);
}

function exitError(msg: string): never {
  // deno-lint-ignore no-console
  console.error(cl.red(msg));
  showHelp();
  process.exit(1);
}

if (process.argv.slice(2).length === 0) {
  exitError(`Missing version argument.`);
} else if (process.argv.slice(2).length > 1) {
  exitError(`Too many arguments. Expected only one release argument`);
}

const ROOT_DIR = path.join(import.meta.dirname!, "..");
const corePkgPath = path.join(ROOT_DIR, "packages", "fresh", "package.json");
const rootPkgPath = path.join(ROOT_DIR, "package.json");
const corePkg = JSON.parse(
  await fsp.readFile(corePkgPath, "utf-8"),
) as PackageJson;

const version = process.argv.slice(2)[0];
const current = semver.parse(corePkg.version!);
const next = semver.parse(corePkg.version!);
if (version === "major") {
  next.major++;
  next.minor = 0;
  next.patch = 0;
  next.prerelease = undefined;
} else if (version === "minor") {
  next.minor++;
  next.patch = 0;
} else if (version === "patch") {
  next.patch++;
  next.prerelease = undefined;
} else {
  if (!next.prerelease) {
    exitError(`Unknown prerelease version`);
  }

  if (next.prerelease[0] === version) {
    ((next.prerelease[1]) as number)++;
  } else {
    next.prerelease[0] = version;
    next.prerelease[1] = 1;
  }
}

const updatePkgPath = path.join(ROOT_DIR, "packages", "update", "package.json");
const updateJson = JSON.parse(await fsp.readFile(updatePkgPath, "utf-8"));
const currentUpdate = semver.parse(updateJson.version);

function formatUpgradeMsg(
  name: string,
  from: semver.SemVer,
  to: semver.SemVer,
): string {
  const nameMsg = cl.yellow(name);
  const fromMsg = cl.green(semver.format(from));
  const toMsg = cl.yellow(semver.format(to));

  return `  ${nameMsg}: ${fromMsg} -> ${toMsg}`;
}

// deno-lint-ignore no-console
console.log(formatUpgradeMsg(corePkg.name!, current, next));
// deno-lint-ignore no-console
console.log(formatUpgradeMsg(updateJson.name!, currentUpdate, next));

if (!confirm("Proceed with update?")) {
  process.exit(0);
}

const tailwindPkg = JSON.parse(
  await fsp.readFile(
    path.join(ROOT_DIR, "packages", "plugin-tailwindcss", "package.json"),
    "utf-8",
  ),
) as PackageJson;

async function replaceInFile(
  file: string,
  replacer: (content: string) => string,
) {
  const raw = await fsp.readFile(file, "utf-8");
  const replaced = replacer(raw);
  await fsp.writeFile(file, replaced);
}

const nextVersion = semver.format(next);

function replaceJsonVersion(version: string) {
  return (content: string) =>
    content.replace(/"version":\s"[^"]+"/, `"version": "${version}"`);
}
await replaceInFile(corePkgPath, replaceJsonVersion(nextVersion));
await replaceInFile(updatePkgPath, replaceJsonVersion(nextVersion));

async function getNpmVersion(name: string) {
  const res = await fetch(`https://registry.npmjs.org/${name}`, {
    headers: {
      "Accept":
        "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    },
  });
  const json = await res.json();
  return json["dist-tags"].latest;
}

const [preactVersion, preactSignalsVersion] = await Promise.all([
  getNpmVersion("preact"),
  getNpmVersion("@preact/signals"),
]);

function updateVersions(content: string): string {
  const replaced = content
    .replace(
      /FRESH_VERSION\s=\s["']([^'"]+)['"]/g,
      `FRESH_VERSION = "${nextVersion}"`,
    )
    .replace(
      /FRESH_TAILWIND_VERSION\s=\s["']([^'"]+)['"]/g,
      `FRESH_TAILWIND_VERSION = "${tailwindPkg.version!}"`,
    )
    .replace(
      /PREACT_VERSION\s=\s["']([^'"]+)['"]/g,
      `PREACT_VERSION = "${preactVersion!}"`,
    )
    .replace(
      /PREACT_SIGNALS_VERSION\s=\s["']([^'"]+)['"]/g,
      `PREACT_SIGNALS_VERSION = "${preactSignalsVersion!}"`,
    );

  if (content === replaced) {
    exitError(`Did not find FRESH_VERSION string`);
  }

  return replaced;
}

function replaceDepVersion(name: string, version: string) {
  return (content: string) => {
    return content.replace(
      new RegExp(`"${name.replace("/", "\\/")}":\\s"[^"]+"`),
      `"${name}": "^${version}"`,
    );
  };
}

// Update preact + @preact/signals version
for (const pkgPath of [corePkgPath, rootPkgPath]) {
  await replaceInFile(pkgPath, replaceDepVersion("preact", preactVersion));
  await replaceInFile(
    pkgPath,
    replaceDepVersion("@preact/signals", preactSignalsVersion),
  );
}

const updateScriptPath = path.join(
  ROOT_DIR,
  "packages",
  "update",
  "src",
  "update.ts",
);
await replaceInFile(updateScriptPath, updateVersions);

const initScriptPath = path.join(
  ROOT_DIR,
  "packages",
  "init",
  "src",
  "init.ts",
);
await replaceInFile(initScriptPath, updateVersions);
