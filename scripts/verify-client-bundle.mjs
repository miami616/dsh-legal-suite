#!/usr/bin/env node
/**
 * Publish-gate guard for client/client.js.
 *
 * Background: `__PLUGIN_VERSION__` is baked into the client bundle at tsdown
 * build time (tsdown.config.ts reads ./package.json). Bumping package.json
 * WITHOUT re-running `pnpm build` ships a bundle that still displays the OLD
 * version in the sidebar ("当前诉讼插件 v0.6.0" incident, 2026-08). The old
 * prepack hook only checked file EXISTENCE, which let that happen.
 *
 * This script fails `pnpm pack` / `pnpm publish` unless:
 *   1. build artifacts exist (lib/index.js, client/client.js);
 *   2. no raw `__PLUGIN_VERSION__` token survived bundling;
 *   3. every version literal baked next to `updater.currentPlugin` equals
 *      package.json's version.
 */
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = pkg.version

// 1) artifacts must exist
for (const f of ['lib/index.js', 'client/client.js']) {
  if (!fs.existsSync(f)) {
    console.error(`verify-client-bundle: ${f} not found — run "pnpm build" first`)
    process.exit(1)
  }
}

const code = fs.readFileSync('client/client.js', 'utf8')

// 2) an unreplaced call-site means the tsdown define did not apply.
//    (Mentions of the token inside comments are harmless and must not trip this.)
if (/version:\s*__PLUGIN_VERSION__/.test(code)) {
  console.error(
    'verify-client-bundle: raw "__PLUGIN_VERSION__" call-site found in client/client.js — ' +
      'the tsdown define did not apply. Check tsdown.config.ts.',
  )
  process.exit(1)
}

// 3) any semver literal near a currentPlugin display site must match
//    package.json. Sites render `runtimeVersion || "X.Y.Z"` (build-time
//    fallback), so scan a window after each occurrence instead of matching a
//    rigid call-shape.
const SEMVER = /"(\d+\.\d+\.\d+(?:-[\w.-]+)?)"/g
const baked = []
for (const m of code.matchAll(/updater\.currentPlugin/g)) {
  const windowText = code.slice(m.index, m.index + 300)
  for (const v of windowText.matchAll(SEMVER)) baked.push(v[1])
}

if (baked.length > 0) {
  const stale = baked.filter((v) => v !== version)
  if (stale.length > 0) {
    console.error(
      `verify-client-bundle: STALE client bundle — package.json is ${version} but ` +
        `client/client.js bakes ${[...new Set(stale)].join(', ')}. ` +
        `Bumping the version requires a rebuild: run "pnpm build" before publish.`,
    )
    process.exit(1)
  }
  console.log(`verify-client-bundle ok: client bundle bakes v${version} (${baked.length} site/s)`)
} else {
  console.log(
    `verify-client-bundle warn: no baked version found near updater.currentPlugin — ` +
      `if the settings UI was refactored, update this check's regex.`,
  )
}
