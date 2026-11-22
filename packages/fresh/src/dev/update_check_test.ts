import * as fsp from "node:fs/promises";
import { test } from "bun:test";
import * as path from "@std/path";
import pkgJson from "../../package.json" with { type: "json" };
import { getStdOutput, runCommand } from "../../tests/test_utils.tsx";
import { expect } from "@std/expect";
import { withTmpDir } from "../test_utils.ts";
import type { CheckFile } from "./update_check.ts";
import { WEEK } from "../constants.ts";
import { retry } from "@std/async/retry";

const CURRENT_VERSION = pkgJson.version;

const cwd = import.meta.dirname!;

test("stores update check file in $HOME/fresh", async () => {
  await using tmp = await withTmpDir();
  const filePath = path.join(tmp.dir, "latest.json");

  await runCommand(process.execPath, {
    args: [
      path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
    ],
    cwd,
    env: {
      CI: "false",
      TEST_HOME: tmp.dir,
    },
  });

  const text = JSON.parse(await fsp.readFile(filePath, "utf-8"));
  expect(text).toEqual({
    current_version: CURRENT_VERSION,
    latest_version: "99.99.999",
    last_checked: text.last_checked,
    last_shown: text.last_shown,
  });
});

test("skips update check on specific environment variables", async () => {
  const envs = [
    "FRESH_NO_UPDATE_CHECK",
    "CI",
    "FRESH_DEPLOYMENT_ID",
    "DENO_DEPLOYMENT_ID",
  ];

  for (const env of envs) {
    {
      // step: `checking ${env}`
      await using tmp = await withTmpDir();
      const out = await runCommand(process.execPath, {
        args: [
          path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
        ],
        cwd,
        env: {
          [env]: "true",
          TEST_HOME: tmp.dir,
          LATEST_VERSION: "1.30.0",
        },
        stderr: "piped",
        stdout: "piped",
      });

      const { stdout } = getStdOutput(out);
      expect(stdout).not.toMatch(/Fresh 1\.30\.0 is available/);
    }
  }
});

test("shows update message on version mismatch", async () => {
  await using tmp = await withTmpDir();
  const filePath = path.join(tmp.dir, "latest.json");

  await fsp.writeFile(
    filePath,
    JSON.stringify({
      current_version: "1.1.0",
      latest_version: "1.1.0",
      last_checked: new Date(0).toISOString(),
    }),
  );

  const out = await runCommand(process.execPath, {
    args: [
      path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
    ],
    cwd,
    env: {
      CI: "false",
      TEST_HOME: tmp.dir,
      LATEST_VERSION: "999.999.0",
    },
    stderr: "piped",
    stdout: "piped",
  });

  const { stdout } = getStdOutput(out);
  expect(stdout).toMatch(/Fresh 999\.999\.0 is available/);

  // Updates check file
  const text = JSON.parse(await fsp.readFile(filePath, "utf-8"));
  expect(text).toEqual({
    current_version: CURRENT_VERSION,
    latest_version: "999.999.0",
    last_checked: text.last_checked,
    last_shown: text.last_shown,
  });
});

test("only fetch new version defined by interval", async () => {
  await using tmp = await withTmpDir();

  {
    // step: "fetches latest version initially"
    const out = await runCommand(process.execPath, {
      args: [
        path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
      ],
      cwd,
      env: {
        CI: "false",
        UPDATE_INTERVAL: "100000",
        TEST_HOME: tmp.dir,
        LATEST_VERSION: "1.30.0",
      },
      stderr: "piped",
      stdout: "piped",
    });

    const { stdout } = getStdOutput(out);
    expect(stdout).toMatch(/fetching latest version/);
  }

  {
    // step: "should not fetch if interval has not passed"
    const out = await runCommand(process.execPath, {
      args: [
        path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
      ],
      cwd,
      env: {
        CI: "false",
        UPDATE_INTERVAL: "100000",
        TEST_HOME: tmp.dir,
        LATEST_VERSION: "1.30.0",
      },
      stderr: "piped",
      stdout: "piped",
    });

    const { stdout } = getStdOutput(out);
    expect(stdout).not.toMatch(/fetching latest version/);
  }

  {
    // step: "fetches if interval has passed"
    const out = await runCommand(process.execPath, {
      args: [
        path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
      ],
      cwd,
      env: {
        CI: "false",
        UPDATE_INTERVAL: "1 ",
        TEST_HOME: tmp.dir,
        LATEST_VERSION: "1.30.0",
      },
    });

    const { stdout } = getStdOutput(out);
    expect(stdout).toMatch(/fetching latest version/);
  }
});

test("updates current version in cache file", async () => {
  await using tmp = await withTmpDir();

  const checkFile: CheckFile = {
    current_version: "1.2.0",
    latest_version: "1.2.0",
    last_checked: new Date(Date.now() - WEEK).toISOString(),
  };

  await fsp.writeFile(
    path.join(tmp.dir, "latest.json"),
    JSON.stringify(checkFile, null, 2),
  );

  const out = await runCommand(process.execPath, {
    args: [
      path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
    ],
    cwd,
    env: {
      CI: "false",
      TEST_HOME: tmp.dir,
      LATEST_VERSION: CURRENT_VERSION,
    },
    stderr: "piped",
    stdout: "piped",
  });

  const { stdout } = getStdOutput(out);
  expect(stdout).not.toMatch(/Fresh .* is available/);
});

test("only shows update message when current < latest", async () => {
  await using tmp = await withTmpDir();

  const checkFile: CheckFile = {
    current_version: "9999.999.0",
    latest_version: "1.2.0",
    last_checked: new Date().toISOString(),
  };

  await fsp.writeFile(
    path.join(tmp.dir, "latest.json"),
    JSON.stringify(checkFile, null, 2),
  );

  const out = await runCommand(process.execPath, {
    args: [
      path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
    ],
    cwd,
    env: {
      CI: "false",
      TEST_HOME: tmp.dir,
      LATEST_VERSION: CURRENT_VERSION,
      CURRENT_VERSION: "99999.9999.0",
    },
    stderr: "piped",
    stdout: "piped",
  });

  const { stdout } = getStdOutput(out);
  expect(stdout).not.toMatch(/Fresh .* is available/);
});

test("migrates to last_shown property", async () => {
  await using tmp = await withTmpDir();

  const checkFile: CheckFile = {
    latest_version: "1.4.0",
    current_version: "1.2.0",
    last_checked: new Date().toISOString(),
  };

  await fsp.writeFile(
    path.join(tmp.dir, "latest.json"),
    JSON.stringify(checkFile, null, 2),
  );

  const out = await runCommand(process.execPath, {
    args: [
      path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
    ],
    cwd,
    env: {
      CI: "false",
      TEST_HOME: tmp.dir,
      CURRENT_VERSION: "1.2.0",
      LATEST_VERSION: "99999.9999.0",
    },
    stderr: "piped",
    stdout: "piped",
  });

  const { stdout, stderr } = getStdOutput(out);
  if (stdout === "") {
    // deno-lint-ignore no-console
    console.log(stderr);
  }
  expect(stdout).toMatch(/Fresh .* is available/);

  const checkFileAfter = JSON.parse(
    await fsp.readFile(
      path.join(tmp.dir, "latest.json"),
      "utf-8",
    ),
  );

  // Check if last version was written
  expect(typeof checkFileAfter.last_shown).toEqual("string");
});

test("doesn't show update if last_shown + interval >= today", async () => {
  await using tmp = await withTmpDir();

  const todayMinus1Hour = new Date();
  todayMinus1Hour.setHours(todayMinus1Hour.getHours() - 1);

  const checkFile: CheckFile = {
    current_version: "1.2.0",
    latest_version: "1.6.0",
    last_checked: new Date().toISOString(),
    last_shown: todayMinus1Hour.toISOString(),
  };

  await fsp.writeFile(
    path.join(tmp.dir, "latest.json"),
    JSON.stringify(checkFile, null, 2),
  );

  const out = await runCommand(process.execPath, {
    args: [
      path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
    ],
    cwd,
    env: {
      CI: "false",
      TEST_HOME: tmp.dir,
      CURRENT_VERSION: "1.2.0",
      LATEST_VERSION: "99999.9999.0",
    },
    stderr: "piped",
    stdout: "piped",
  });

  const { stdout } = getStdOutput(out);
  expect(stdout).not.toMatch(/Fresh .* is available/);
});

test("shows update if last_shown + interval < today", async () => {
  await retry(async () => {
    await using tmp = await withTmpDir();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const checkFile: CheckFile = {
      current_version: "1.2.0",
      latest_version: "99.999.99",
      last_checked: new Date().toISOString(),
      last_shown: yesterday.toISOString(),
    };

    await fsp.writeFile(
      path.join(tmp.dir, "latest.json"),
      JSON.stringify(checkFile, null, 2),
    );

    const out = await runCommand(process.execPath, {
      args: [
        path.join(cwd, "../../tests/fixture_update_check/mod.ts"),
      ],
      cwd,
      env: {
        CI: "false",
        TEST_HOME: tmp.dir,
        CURRENT_VERSION: CURRENT_VERSION,
        LATEST_VERSION: "99999.9999.0",
      },
      stderr: "piped",
      stdout: "piped",
    });

    const { stdout } = getStdOutput(out);
    expect(stdout).toMatch(/Fresh .* is available/);

    const checkFileAfter = JSON.parse(
      await fsp.readFile(
        path.join(tmp.dir, "latest.json"),
        "utf-8",
      ),
    );

    expect(checkFileAfter.last_shown).not.toEqual(yesterday.toISOString());
  }, { maxAttempts: 5 });
});
