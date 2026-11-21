// Preloaded by `bun test` (see bunfig.toml).
//
// `bun test` sets `NODE_ENV=test` when it isn't set. `deno test` didn't,
// and tools like Vite change behavior based on it (e.g.
// `import.meta.env.PROD` is false). Keep the environment the tests were
// written for.
if (process.env.NODE_ENV === "test") {
  delete process.env.NODE_ENV;
}
