export function error(message: string): never {
  // deno-lint-ignore no-console
  console.error(`%cerror%c: ${message}`, "color: red; font-weight: bold", "");
  process.exit(1);
}
