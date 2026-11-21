import type { Plugin } from "vite";
import { stripRegistryPrefix } from "fresh/internal-dev";

/**
 * Packages published to JSR are often written for Deno and may contain
 * `npm:` or `jsr:` specifiers, e.g. in a `@jsxImportSource npm:preact`
 * pragma. Resolve those against `node_modules` like a bare specifier.
 */
export function registrySpecifiers(): Plugin {
  return {
    name: "fresh:registry-specifiers",
    enforce: "pre",
    sharedDuringBuild: true,
    applyToEnvironment() {
      return true;
    },
    async resolveId(id, importer, options) {
      if (!/^(npm|jsr):/.test(id)) return null;
      const bare = stripRegistryPrefix(id);
      return await this.resolve(bare, importer, { ...options, skipSelf: true });
    },
  };
}
