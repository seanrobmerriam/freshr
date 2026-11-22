import { DAY } from "../../src/constants.ts";
import { updateCheck } from "../../src/dev/update_check.ts";

// deno-lint-ignore require-await
async function getLatestVersion() {
  // deno-lint-ignore no-console
  console.log("fetching latest version");
  return process.env.LATEST_VERSION ?? "99.99.999";
}

function getCurrentVersion() {
  return process.env.CURRENT_VERSION!;
}

const interval = +(process.env.UPDATE_INTERVAL ?? DAY);
await updateCheck(
  interval,
  () => process.env.TEST_HOME!,
  getLatestVersion,
  (process.env.CURRENT_VERSION !== undefined) ? getCurrentVersion : undefined,
);
