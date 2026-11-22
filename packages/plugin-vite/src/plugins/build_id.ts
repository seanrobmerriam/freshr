import { spawnSync } from "node:child_process";
import type { Plugin } from "vite";

export function buildIdPlugin(): Plugin {
  let buildId = "";

  const regex = /^(jsr:)?@fresh\/build-id(@.*)?$/;

  return {
    name: "fresh:build-id",
    sharedDuringBuild: true,
    async config(_, env) {
      const isDev = env.command === "serve";

      buildId = await getBuildId(isDev);

      return {
        define: {
          BUILD_ID: JSON.stringify(buildId),
        },
      };
    },
    applyToEnvironment() {
      return true;
    },
    resolveId(id) {
      if (regex.test(id)) {
        return `\0fresh/build-id`;
      }
    },
    load: {
      filter: {
        id: /\0fresh\/build-id/,
      },
      handler() {
        return `export let BUILD_ID = ${JSON.stringify(buildId)};
export const DENO_DEPLOYMENT_ID = undefined;
export function setBuildId(id) {
  BUILD_ID = id;
}`;
      },
    },
  };
}

export async function getBuildId(dev: boolean): Promise<string> {
  const gitRevision = process.env.FRESH_DEPLOYMENT_ID ??
    process.env.DENO_DEPLOYMENT_ID ??
    process.env.DENO_DEPLOY_BUILD_ID ??
    process.env.GITHUB_SHA ??
    process.env.CI_COMMIT_SHA;
  if (gitRevision !== undefined) {
    return gitRevision.trim();
  }

  if (!dev) {
    try {
      const bin = process.platform === "win32" ? "git.exe" : "git";
      const res = spawnSync(bin, ["rev-parse", "HEAD"], {
        encoding: "utf-8",
      });
      if (res.status === 0 && res.stdout) {
        return res.stdout.trim();
      }
    } catch {
      // ignore
    }
  }

  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0]).trim();
}
