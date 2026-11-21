import * as fsp from "node:fs/promises";
import { test } from "bun:test";
import { expect } from "@std/expect";
import {
  CONFIRM_TAILWIND_MESSAGE,
  CONFIRM_VITE_MESSAGE,
  CONFIRM_VSCODE_MESSAGE,
  HELP_TEXT,
  initProject,
} from "./init.ts";
import * as path from "@std/path";
import {
  getStdOutput,
  runCommand,
  withBrowser,
} from "../../fresh/tests/test_utils.tsx";
import { waitForText } from "../../fresh/tests/test_utils.tsx";
import { withChildProcessServer } from "../../fresh/tests/test_utils.tsx";
import { withTmpDir as withTmpDirBase } from "../../fresh/src/test_utils.ts";
import { stub } from "@std/testing/mock";

// deno-lint-ignore no-explicit-any
(globalThis as any).INIT_TEST = true;

const testInitProject: typeof initProject = async (cwd, input, flags = {}) => {
  return await initProject(cwd, input, { ...flags, skipInstall: true });
};

function stubPrompt(result: string) {
  return stub(globalThis, "prompt", () => result);
}

function stubConfirm(steps: Record<string, boolean> = {}) {
  return stub(
    globalThis,
    "confirm",
    (message) => message ? steps[message] : false,
  );
}

function stubLogs() {
  return stub(
    console,
    "log",
    () => undefined,
  );
}

const REPO_ROOT = path.join(import.meta.dirname!, "..", "..", "..");

function withTmpDir(): Promise<{ dir: string } & AsyncDisposable> {
  // Windows need temporary files in the repository root. Being inside the
  // repository also lets them resolve packages from its `node_modules`.
  if (process.platform === "win32") {
    const dir = REPO_ROOT;
    // Must stay empty: `init` refuses to write into a non-empty directory.
    return withTmpDirBase({ dir, prefix: "tmp_", tsconfig: false });
  }
  return withTmpDirBase();
}

/**
 * Point the generated project at the packages in this repository. Upstream
 * this linked the local packages through a Deno workspace. With Bun we
 * symlink the repository's `node_modules` so that `fresh` resolves to the
 * workspace package and dependencies like `preact` are shared (a duplicate
 * copy of preact would break rendering).
 */
async function patchProject(dir: string): Promise<void> {
  const pkgPath = path.join(dir, "package.json");
  const pkg = JSON.parse(await fsp.readFile(pkgPath, "utf-8"));
  expect(pkg.dependencies.fresh).toMatch(/^npm:@fresh\/core@/);

  // Projects inside the repository already resolve its `node_modules` by
  // walking up the directory tree. Linking isn't needed there, and directory
  // links are unreliable on Windows.
  const rel = path.relative(REPO_ROOT, dir);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return;

  const repoModules = path.join(REPO_ROOT, "node_modules");
  await fsp.symlink(
    repoModules,
    path.join(dir, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
}

async function expectProjectFile(dir: string, pathname: string) {
  const filePath = path.join(dir, ...pathname.split("/").filter(Boolean));
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a project file: ${filePath}`);
  }
}

async function expectNotProjectFile(dir: string, pathname: string) {
  const filePath = path.join(dir, ...pathname.split("/").filter(Boolean));
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isFile()) {
      throw new Error(`A project file but expected it not to be: ${filePath}`);
    }
  } catch (err) {
    if (!((err as NodeJS.ErrnoException)?.code === "ENOENT")) {
      throw err;
    }
  }
}

async function readProjectFile(dir: string, pathname: string): Promise<string> {
  const filePath = path.join(dir, ...pathname.split("/").filter(Boolean));
  const content = await fsp.readFile(filePath, "utf-8");
  return content;
}

test("init - show help", async () => {
  using logs = stubLogs();

  await testInitProject("", [], { help: true });
  const args = logs.calls.flatMap((c) => c.args);
  const out = args.join("\n");
  await testInitProject("", [], { h: true });

  expect(out).toBe(HELP_TEXT);
  expect(args).toEqual(logs.calls.flatMap((c) => c.args).slice(args.length));
});

test("init - new project", async () => {
  await using tmp = await withTmpDir();
  using _promptStub = stubPrompt("fresh-init");
  using _confirmStub = stubConfirm();

  await testInitProject(tmp.dir, [], { builder: true });
});

test("init - create project dir", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt("fresh-init");
  using _confirmStub = stubConfirm();
  await testInitProject(dir, [], { builder: true });

  const root = path.join(dir, "fresh-init");
  await expectProjectFile(root, "package.json");
  await expectProjectFile(root, "tsconfig.json");
  await expectProjectFile(root, "main.ts");
  await expectProjectFile(root, "dev.ts");
  await expectProjectFile(root, ".gitignore");
  await expectProjectFile(root, "static/styles.css");
});

test("init - with tailwind", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm({
    [CONFIRM_TAILWIND_MESSAGE]: true,
  });
  await testInitProject(dir, [], { builder: true });

  const css = await readProjectFile(dir, "static/styles.css");
  expect(css).toMatch(/@import "tailwindcss"/);

  const main = await readProjectFile(dir, "main.ts");
  const dev = await readProjectFile(dir, "dev.ts");
  expect(main).not.toMatch(/tailwind/);
  expect(dev).toMatch(/tailwind/);
});

test("init - with vscode", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm({
    [CONFIRM_VSCODE_MESSAGE]: true,
  });
  await testInitProject(dir, [], { builder: true });

  await expectProjectFile(dir, ".vscode/settings.json");
  await expectProjectFile(dir, ".vscode/extensions.json");
});

test("init - fmt, lint, and type check project", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm();
  await testInitProject(dir, [], { builder: true });
  await expectProjectFile(dir, "main.ts");
  await expectProjectFile(dir, "dev.ts");

  await patchProject(dir);

  const check = await runCommand(process.execPath, {
    args: ["run", "check"],
    cwd: dir,
    stderr: "inherit",
    stdout: "inherit",
  });
  expect(check.code).toEqual(0);
});

test("init with tailwind - fmt, lint, and type check project", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm({
    [CONFIRM_TAILWIND_MESSAGE]: true,
  });

  await testInitProject(dir, [], { builder: true });
  await expectProjectFile(dir, "main.ts");
  await expectProjectFile(dir, "dev.ts");

  await patchProject(dir);

  const check = await runCommand(process.execPath, {
    args: ["run", "check"],
    cwd: dir,
    stderr: "inherit",
    stdout: "inherit",
  });
  expect(check.code).toEqual(0);
});

test.skipIf(process.platform === "win32" && process.env.CI !== undefined)(
  "init - can start dev server",
  async () => {
    await using tmp = await withTmpDir();
    const dir = tmp.dir;
    using _promptStub = stubPrompt(".");
    using _confirmStub = stubConfirm();
    await testInitProject(dir, [], { builder: true });
    await expectProjectFile(dir, "main.ts");
    await expectProjectFile(dir, "dev.ts");

    await patchProject(dir);
    await withChildProcessServer(
      { cwd: dir, args: ["run", "dev"] },
      async (address) => {
        await withBrowser(async (page) => {
          await page.goto(address);
          await page.locator("#decrement").click();
          await waitForText(page, "button + p", "2");
        });
      },
    );
  },
);

test("init - can start built project", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm();
  await testInitProject(dir, [], { builder: true });
  await expectProjectFile(dir, "main.ts");
  await expectProjectFile(dir, "dev.ts");

  await patchProject(dir);

  // Build
  await runCommand(process.execPath, {
    args: ["run", "build"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    cwd: dir,
  });

  await withChildProcessServer(
    { cwd: dir, args: ["_fresh/server.js"], env: { PORT: "0" } },
    async (address) => {
      await withBrowser(async (page) => {
        await page.goto(address);
        await page.locator("button").click();
        await waitForText(page, "button + p", "2");
      });
    },
  );
});

test("init - errors on missing build cache in prod", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm();
  await testInitProject(dir, [], { builder: true });
  await expectProjectFile(dir, "main.ts");
  await expectProjectFile(dir, "dev.ts");

  await patchProject(dir);

  const cp = await runCommand(process.execPath, {
    args: ["run", "start"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    cwd: dir,
  });

  const { stderr } = getStdOutput(cp);
  expect(cp.code).toEqual(1);

  expect(stderr).toMatch(/Module not found/);
});

test("init - vite dev server", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm();
  await testInitProject(dir, [], {});

  await expectProjectFile(dir, "vite.config.ts");
  await expectNotProjectFile(dir, "dev.ts");

  await patchProject(dir);

  await withChildProcessServer(
    { cwd: dir, args: ["run", "dev"] },
    async (address) => {
      await withBrowser(async (page) => {
        await page.goto(address);
        await page.locator("#decrement").click();
        await waitForText(page, "button + p", "2");
      });
    },
  );
});

test("init - vite build", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm();
  await testInitProject(dir, [], {});

  await expectProjectFile(dir, "vite.config.ts");

  await patchProject(dir);

  // Build
  await runCommand(process.execPath, {
    args: ["run", "build"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    cwd: dir,
  });

  await withChildProcessServer(
    { cwd: dir, args: ["_fresh/server.js"], env: { PORT: "0" } },
    async (address) => {
      await withBrowser(async (page) => {
        await page.goto(address);
        await page.locator("button").click();
        await waitForText(page, "button + p", "2");
      });
    },
  );
});

test("init - with vite", async () => {
  await using tmp = await withTmpDir();
  const dir = tmp.dir;
  using _promptStub = stubPrompt(".");
  using _confirmStub = stubConfirm({
    [CONFIRM_VITE_MESSAGE]: true,
  });
  await testInitProject(dir, [], {});

  await expectProjectFile(dir, "vite.config.ts");
  await expectNotProjectFile(dir, "dev.ts");
});
