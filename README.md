[Documentation](#-documentation) | [Getting started](#-getting-started) |
[Differences from upstream](#differences-from-upstream-fresh)

# fresh (Bun)

<img align="right" src="https://usefresh.dev/logo.svg" height="150px" alt="The Fresh logo: a sliced lemon dripping with juice">

**Fresh** is a next generation web framework, built for speed, reliability, and
simplicity. This is a fork of [Fresh](https://github.com/denoland/fresh) that
runs on [Bun](https://bun.sh) instead of Deno, while keeping the same APIs.

Some stand-out features:

- Island based client hydration for maximum interactivity.
- Zero runtime overhead: no JS is shipped to the client by default.
- No configuration necessary.
- TypeScript support out of the box.
- File-system routing à la Next.js.

## 📖 Documentation

The [documentation](https://usefresh.dev/docs/introduction) of upstream Fresh
applies to this fork as well. Replace the Deno commands with their Bun
equivalents, see [Differences from upstream](#differences-from-upstream-fresh).

## 🚀 Getting started

Install the latest [Bun](https://bun.sh/docs/installation) version.

You can scaffold a new project by running the Fresh init script. To scaffold a
project run the following:

```sh
bunx @fresh/init
```

Then navigate to the newly created project folder, install the dependencies and
start the development server:

```sh
cd fresh-project
bun install
bun run dev
```

Now open http://localhost:5173 in your browser to view the page. You make
changes to the project source code and see them reflected in your browser.

To create and run a production build:

```sh
bun run build
bun run start
```

`bun run start` runs `bun _fresh/server.js`, which listens on port `8000` by
default (configurable with the `PORT` environment variable). A `Dockerfile`
based on the `oven/bun` image can be generated with `bunx @fresh/init --docker`.

For a more in-depth getting started guide, visit the
[Getting Started](https://usefresh.dev/docs/getting-started) page in the Fresh
docs.

## Differences from upstream Fresh

Applications use the same APIs as upstream Fresh. The differences come from the
runtime:

| Deno                                    | Bun                                                     |
| --------------------------------------- | ------------------------------------------------------- |
| `deno run -Ar jsr:@fresh/init`          | `bunx @fresh/init`                                      |
| `deno.json` imports + `compilerOptions` | `package.json` + `tsconfig.json`                        |
| `"fresh": "jsr:@fresh/core@^2"`         | `"fresh": "npm:@fresh/core@^2"`                         |
| `deno task dev` / `build` / `start`     | `bun run dev` / `build` / `start`                       |
| `deno serve -A _fresh/server.js`        | `bun _fresh/server.js`                                  |
| `Deno.serve({ fetch: app.handler() })`  | `Bun.serve({ fetch: app.handler(), websocket })`        |
| `ctx.info: Deno.ServeHandlerInfo`       | `ctx.info: ServeHandlerInfo` (exported from `"fresh"`)  |
| `DENO_DEPLOYMENT_ID`                    | `FRESH_DEPLOYMENT_ID` (`DENO_DEPLOYMENT_ID` still read) |
| `deno run -A -r jsr:@fresh/update .`    | `bunx @fresh/update .`                                  |

Notes:

- **JSX**: Bun has no equivalent of Deno's `"jsx": "precompile"` mode. Projects
  use `"jsx": "react-jsx"` with `"jsxImportSource": "preact"` in
  `tsconfig.json`. Bun reads `tsconfig.json` from the directory you run it in,
  so run `bun` from the project root.
- **WebSockets**: `ctx.upgrade()` and `app.ws()` work unchanged. When you call
  `Bun.serve()` yourself, pass the `websocket` handlers exported from `"fresh"`.
  `app.listen()` and `_fresh/server.js` do this for you.
- **JSR packages** can be installed through JSR's npm registry (see `.npmrc`),
  e.g. `"@std/path": "npm:@jsr/std__path@^1"`. `npm:` and `jsr:` specifiers
  inside such packages are resolved from `node_modules`.
- **Public env vars**: `FRESH_PUBLIC_*` variables are inlined into client code
  for `process.env.X`, `Bun.env.X` and `import.meta.env.X`.
- **`@fresh/update`** migrates a `deno.json` to `package.json` and
  `tsconfig.json` in addition to updating the code.
- **Single binary builds**: `deno compile --include` embedded static files. `bun
  build --compile _fresh/compiled-entry.js` produces a binary that serves pages
  and API routes, but static files aren't embedded yet and respond with an
  error. Use `bun _fresh/server.js` (or Docker) to serve static files.

## Developing this repository

```sh
bun install
bunx playwright install chromium  # browser for the integration tests
bun run ok                        # format check, type check and tests
```

| Task                  | Command                             |
| --------------------- | ----------------------------------- |
| Run all tests         | `bun run test`                      |
| Type check            | `bun run check:types`               |
| Format / check format | `bun run fmt` / `bun run fmt:check` |
| Run the demo app      | `bun run demo`                      |
| Build the docs site   | `bun run build-www`                 |

## Contributing

We appreciate your help! To contribute, please read our
[contributing guideline](./.github/CONTRIBUTING.md).

## Adding your project to the showcase

If you feel that your project would be helpful to other Fresh users, please
consider putting your project on the [showcase](https://usefresh.dev/showcase).
However, websites that are just for promotional purposes may not be listed.

To take a screenshot, run the following command.

```sh
bun run screenshot [url] [your-app-name]
```

Then add your site to
[showcase.json](https://github.com/denoland/fresh/blob/main/www/data/showcase.json),
preferably with source code on GitHub, but not required.

## Badges

![Made with Fresh](./www/static/fresh-badge.svg)

```md
[![Made with Fresh](https://usefresh.dev/fresh-badge.svg)](https://usefresh.dev)
```

```html
<a href="https://usefresh.dev">
  <img
    width="197"
    height="37"
    src="https://usefresh.dev/fresh-badge.svg"
    alt="Made with Fresh"
  />
</a>
```

![Made with Fresh(dark)](./www/static/fresh-badge-dark.svg)

```md
[![Made with Fresh](https://usefresh.dev/fresh-badge-dark.svg)](https://usefresh.dev)
```

```html
<a href="https://usefresh.dev">
  <img
    width="197"
    height="37"
    src="https://usefresh.dev/fresh-badge-dark.svg"
    alt="Made with Fresh"
  />
</a>
```

## Hashtags

Use the following hashtags in your social media posts that reference Fresh and
as Topics in the About section of your GitHub repos that contain Fresh code. It
will assure maximum visibility for your posts and code, and promote Fresh
development ecosystem visibility.

- #denofresh
- #deno

Github repo Topics will not include the hash symbol.
