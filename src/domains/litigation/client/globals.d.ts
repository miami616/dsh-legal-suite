/**
 * Browser-half build-time globals.
 *
 * `__PLUGIN_VERSION__` is injected by tsdown's `define` from the package
 * package.json at bundle time (see tsdown.config.ts). The declaration exists
 * so the typecheck face (tsconfig, tsconfig.client) sees a typed identifier
 * — the bundled artifact never contains this declaration, only the replaced
 * string literal.
 */
declare const __PLUGIN_VERSION__: string