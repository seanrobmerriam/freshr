import * as semver from "@std/semver";
import * as colors from "@std/fmt/colors";
import * as path from "@std/path";
import * as fsp from "node:fs/promises";
import { isNotFound } from "../server.ts";
import { CURRENT_FRESH_VERSION } from "../otel.ts";

export interface CheckFile {
  last_checked: string;
  last_shown?: string;
  latest_version: string;
  current_version: string;
}

function getHomeDir(): string | null {
  const env = process.env;
  switch (process.platform) {
    case "linux": {
      const xdg = env.XDG_CACHE_HOME;
      if (xdg) return xdg;

      const home = env.HOME;
      if (home) return `${home}/.cache`;
      break;
    }

    case "darwin": {
      const home = env.HOME;
      if (home) return `${home}/Library/Caches`;
      break;
    }

    case "win32":
      return env.LOCALAPPDATA ?? null;
  }

  return null;
}

function getFreshCacheDir(): string | null {
  const home = getHomeDir();
  if (home) return path.join(home, "fresh");
  return null;
}

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch("https://registry.npmjs.org/@fresh/core/latest");
  if (res.ok) {
    const json = await res.json() as { version: string };
    return json.version.trim().replace(/^v/, "");
  }

  throw new Error(`Could not fetch latest version.`);
}

function readCurrentVersion(): string {
  return CURRENT_FRESH_VERSION;
}

export async function updateCheck(
  interval: number,
  getCacheDir = getFreshCacheDir,
  getLatestVersion = fetchLatestVersion,
  getCurrentVersion = readCurrentVersion,
) {
  // Skip update checks on CI or deployments
  if (
    process.env.CI === "true" ||
    process.env.FRESH_NO_UPDATE_CHECK === "true" ||
    process.env.FRESH_DEPLOYMENT_ID ||
    process.env.DENO_DEPLOYMENT_ID
  ) {
    return;
  }

  const home = getCacheDir();
  if (!home) return;
  const filePath = path.join(home, "latest.json");
  await fsp.mkdir(home, { recursive: true });

  const version = await getCurrentVersion();

  let checkFile: CheckFile = {
    current_version: version,
    latest_version: version,
    last_checked: new Date(0).toISOString(),
  };
  try {
    const text = await fsp.readFile(filePath, "utf-8");
    checkFile = JSON.parse(text);
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }

  // Update current version
  checkFile.current_version = version;

  // Only check in the specified interval
  if (Date.now() >= new Date(checkFile.last_checked).getTime() + interval) {
    try {
      checkFile.latest_version = await getLatestVersion();
      checkFile.last_checked = new Date().toISOString();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Update check is optional and shouldn't abort the program.
      // deno-lint-ignore no-console
      console.error(
        colors.red(`    Update check failed: `) + message,
      );
      return;
    }
  }

  // Only show update message if current version is smaller than latest
  const currentVersion = semver.parse(checkFile.current_version);
  const latestVersion = semver.parse(checkFile.latest_version);
  if (
    (!checkFile.last_shown ||
      Date.now() >= new Date(checkFile.last_shown).getTime() + interval) &&
    semver.lessThan(currentVersion, latestVersion)
  ) {
    checkFile.last_shown = new Date().toISOString();

    const current = colors.bold(colors.rgb8(checkFile.current_version, 208));
    const latest = colors.bold(colors.rgb8(checkFile.latest_version, 121));
    // deno-lint-ignore no-console
    console.log(
      `    Fresh ${latest} is available. You're on ${current}`,
    );
    // deno-lint-ignore no-console
    console.log(
      `    To upgrade, run: bunx @fresh/update@latest`,
    );
    // deno-lint-ignore no-console
    console.log();
  }

  // Migrate old format to current
  if (!checkFile.last_shown) {
    checkFile.last_shown = new Date().toISOString();
  }

  const raw = JSON.stringify(checkFile, null, 2);
  await fsp.writeFile(filePath, raw);
}
