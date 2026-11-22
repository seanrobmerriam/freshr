/**
 * Used internally by the `@fresh/plugin-vite` to add HMR support
 * for Fresh running in the browser.
 *
 * **Do not** import this module directly.
 *
 * @module
 * @private
 */

import type { UpdatePayload } from "vite";
import type { ViteHotContext } from "vite/types/hot.d.ts";
import { hashCode } from "./shared.ts";

// `@types/bun` declares its own `import.meta.hot`, use Vite's typing here.
const hot = import.meta.hot as unknown as ViteHotContext | undefined;

if (hot) {
  hot.on("fresh:reload", () => {
    window.location.reload();
  });

  hot.on("vite:beforeUpdate", (module: UpdatePayload) => {
    module.updates.forEach((update) => {
      const moduleStyle = document.querySelector(
        `[vite-module-id="${hashCode(update.acceptedPath)}"]`,
      );
      if (moduleStyle) {
        moduleStyle.remove();
      }
    });
  });
}
