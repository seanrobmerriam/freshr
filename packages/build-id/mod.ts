/**
 * Don't use this package directly. It's considered internal for Fresh.
 *
 * @example
 * ```ts
 * // `BUILD_ID` is based on the `FRESH_DEPLOYMENT_ID` environment variable.
 * ```
 *
 * @see https://usefresh.dev/docs/deployment/docker
 *
 * @module
 * @private
 */

import { encodeHex } from "@std/encoding/hex";

const env: Record<string, string | undefined> = typeof process !== "undefined"
  ? process.env
  : {};

/**
 * Deployment identifier. Read from `FRESH_DEPLOYMENT_ID` and falls back to
 * `DENO_DEPLOYMENT_ID` for compatibility with existing deployments.
 */
export const DENO_DEPLOYMENT_ID: string | undefined = env.FRESH_DEPLOYMENT_ID ||
  env.DENO_DEPLOYMENT_ID || undefined;
const deploymentId = DENO_DEPLOYMENT_ID ||
  // For CI
  env.GITHUB_SHA ||
  env.CI_COMMIT_SHA ||
  crypto.randomUUID();
const buildIdHash = await crypto.subtle.digest(
  "SHA-1",
  new TextEncoder().encode(deploymentId),
);

export let BUILD_ID: string = encodeHex(buildIdHash);

export function setBuildId(buildId: string): void {
  BUILD_ID = buildId;
}
