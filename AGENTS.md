# Agents

## Repository Overview

Fresh is a web framework built on Preact. This fork runs on **Bun** instead of
Deno. This is a **Bun workspace monorepo** (see the root `package.json`) with
workspace members in `packages/*` and `www/`. Packages from JSR (`@std/*`) are
installed through JSR's npm registry, configured in `.npmrc`.

### Packages

- **`packages/fresh/`** (`@fresh/core`): Core framework — routing, rendering,
  islands, build cache, middlewares, and client/server runtime.
- **`packages/plugin-vite/`** (`@fresh/plugin-vite`): Vite integration plugin
  with dev server, SSR/client builds, and HMR.
- **`packages/init/`** (`@fresh/init`): Project scaffolding (`bunx
  @fresh/init`).
- **`packages/update/`** (`@fresh/update`): Automated Fresh 1.x to 2.x migration
  tool using ts-morph for AST transforms. Also migrates `deno.json` projects to
  `package.json` + `tsconfig.json`.
- **`packages/build-id/`** (`@fresh/build-id`): Build/deployment ID generation.
- **`packages/plugin-tailwindcss/`** (`@fresh/plugin-tailwind`): TailwindCSS v4
  plugin.
- **`packages/plugin-tailwindcss-v3/`** (`@fresh/plugin-tailwind-v3`): Legacy
  TailwindCSS v3 plugin.
- **`packages/examples/`** (`@fresh/examples`): Example components for tests.

### Other directories

- **`www/`**: Documentation website (usefresh.dev), built with Fresh + Vite +
  Tailwind. Has its own routes, islands, and vite.config.ts.
- **`docs/`**: Markdown documentation organized by version (`latest/`, `1.x/`,
  `canary/`).
- **`tools/`**: `release.ts` (version bumping), `check_docs.ts` (doc
  validation), `check_links.ts` (link checker), `fmt.ts` (formatter, same dprint
  plugins and settings as `deno fmt`), `test_setup.ts` (test preload).

## Git Workflow

- To check out a PR branch, use `gh pr checkout <pr-number>`. Do not set up
  remotes manually.
- Always run `bun run fmt` before pushing.
- Do not commit `bun.lock` changes unless the PR is specifically about updating
  dependencies.
- **Never amend commits or force push.** Always create new commits.

## Development

- Run `bun run ok` before pushing — it runs the full local CI check (format
  check, type check, tests).
- Run `bun install` if you get missing dependency errors, and `bunx playwright
  install chromium` for the browser based tests.
- Tests: `bun run test` (all tests). Tests use `bun:test` with `@std/expect` for
  assertions, `linkedom` for DOM testing and Playwright (through a small Astral
  compatible wrapper in `packages/fresh/tests/browser.ts`) for browser tests.
- JSX uses `"jsx": "react-jsx"` with Preact as the import source
  (`tsconfig.json`). Bun only reads the `tsconfig.json` of the working
  directory, so `.tsx` files that are published in a package carry a `/**
  @jsxImportSource preact */` pragma.
- Runtime specific code lives in `packages/fresh/src/server.ts`: `Bun.serve()`
  wrapper, WebSocket upgrades, file streaming and error helpers. Prefer `node:`
  APIs elsewhere so that code also runs inside Vite's SSR runner.

## Architecture

### Request lifecycle

1. `App.handler()` receives an HTTP request (`app.ts`). Under `Bun.serve()` the
   second argument is the Bun server, which is normalized into `ctx.info:
   ServeHandlerInfo`
2. URL is parsed and normalized (double slashes removed)
3. `UrlPatternRouter.match()` finds the matching route — static routes are
   checked first via direct `Map` lookup, then dynamic routes via `URLPattern`
4. A `Context` is created with request, params, and build cache
5. The middleware chain executes (built backwards as nested closures)
6. `ctx.render()` composes layouts and app wrapper around the page component
7. Preact's `renderToString()` generates HTML, with option hooks detecting
   islands along the way
8. `FreshScripts` component emits the inline boot script with island imports and
   serialized props
9. Response is returned with HTML and `Link` modulepreload headers

### Island architecture

Islands are interactive Preact components that hydrate on the client while the
rest of the page stays static HTML.

**Server side** (`runtime/server/preact_hooks.ts`):

- Preact's diff hook intercepts every VNode during SSR
- When a component exists in `buildCache.islandRegistry`, it's wrapped in HTML
  comment markers: `<!--frsh:island:NAME:PROPSIDX:KEY-->...<!--/frsh:island-->`
- Island props are collected into a `RenderState.islandProps[]` array
- JSX element props become **slots** — stored in `<template>` elements and
  replaced with symbolic references

**Client side** (`runtime/client/reviver.ts`):

- The `boot()` function is called from an inline `<script type="module">`
- DOM is walked to find `<!--frsh:island:...-->` comment markers
- Props are deserialized with custom handlers: signals become reactive, slots
  become VNode references
- Each island is hydrated via `render(h(component, props), container)` using
  `scheduler.postTask()` for non-blocking hydration

### Routing

Filesystem paths are converted to URL patterns (`router.ts`, `fs_routes.ts`):

- `/routes/blog/[id].tsx` becomes `/blog/:id`
- `/routes/blog/[...rest].tsx` becomes `/blog/:rest*`
- `/routes/(group)/page.tsx` becomes `/page` (groups are transparent)
- `/routes/[[id]].tsx` becomes `/:id?` (optional segment)

Routes form a **segment tree** (`segments.ts`) where each level accumulates
middlewares, layouts, and error handlers. When a route matches, the tree is
walked from root to leaf to build the full middleware chain.

### Build system

Two build paths exist:

- **esbuild-based** (`dev/builder.ts`, `dev/esbuild.ts`): The native Fresh
  builder. Discovers islands, creates entry points per island + a
  `fresh-runtime` entry, bundles with esbuild (splitting, tree-shaking, ESM
  output). Output goes to `/_fresh/js/{BUILD_ID}/`.
- **Vite-based** (`plugin-vite/`): Uses Vite's environment API for dual
  client/SSR builds. Provides the same island discovery and bundling through
  Vite's plugin system with HMR in dev.

Both produce: separate island bundles, a client runtime entry, static assets
with content hashing, and a BUILD_ID for cache busting.

Build caches come in two flavors:

- `MemoryBuildCache` / `DiskBuildCache` for development (live rebuilds)
- `ProdBuildCache` for production (snapshot-based, read from `_fresh/`)

### Partials

`<Partial>` components enable incremental page updates without full reloads.
They are wrapped with markers (`<!--frsh:partial:{name}:{mode}:{key}-->`) and
support `replace`, `append`, and `prepend` modes. Elements with `f-client-nav`
enable client-side navigation that fetches and swaps partials instead of full
page loads.

## CI

CI runs on every PR against `main` across a matrix of Bun latest + canary on
macOS, Windows, and Ubuntu. Steps:

1. `bun install --frozen-lockfile`
2. `bunx playwright install --with-deps chromium`
3. `bun run fmt:check` (Ubuntu + latest only)
4. Spell-check via `typos` (Ubuntu + latest only)
5. `bun run check:types` (all platforms)
6. `bun run test` (all platforms)
7. `bun run check:docs` (all platforms)
8. `bun run build-www` and `bun run check:links` (Ubuntu + latest only)

Publishing is a manual workflow (`.github/workflows/publish.yml`) that defaults
to a dry run.
