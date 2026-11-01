// Lets Node run the TypeScript sources directly: resolves extensionless relative imports to .ts files.
// Usage: node --import ./scripts/ts-resolve.mjs scripts/<script>.ts
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (err?.code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});
