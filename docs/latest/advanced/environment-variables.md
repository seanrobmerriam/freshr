---
description: |
  How to use environment variables in Fresh, including public variables that are inlined into island bundles.
---

Environment variables in Bun are read via `process.env.*` or `Bun.env.*`. Bun
automatically loads `.env` files, see
[how to use Environment Variables in Bun](https://bun.sh/docs/runtime/env).

On top of that Fresh automatically inlines all environment variables whose names
start with `FRESH_PUBLIC_` during bundling of [islands](/docs/concepts/islands).

> [info]: This inlining step occurs when building the app (`bun run build`).
> Environment variables inside islands cannot be read at runtime.

Example:

```sh Terminal
$ FRESH_PUBLIC_FOO=bar bun run dev
```

```tsx
export function MyIsland() {
  const value = process.env.FRESH_PUBLIC_FOO;
  return <h1>{value}</h1>;
}
```

This code when bundled will be turned into this:

```tsx
export function MyIsland() {
  const value = "bar";
  return <h1>{value}</h1>;
}
```

This way you can use specific environment variables in the browser.

> [warn]: To make inlining work the code needs to be analyzable by our plugins.
> This means that not all forms of reading an environment variable are
> supported, even if it's perfectly valid JavaScript code.
>
> ```ts MyIsland.tsx
> // CORRECT
> process.env.FRESH_PUBLIC_FOO;
> Bun.env.FRESH_PUBLIC_FOO;
>
> // WRONG
> const name = "FRESH_PUBLIC_FOO";
> process.env[name];
>
> // WRONG
> const obj = { ...process.env };
> obj.FRESH_PUBLIC_FOO;
> ```
