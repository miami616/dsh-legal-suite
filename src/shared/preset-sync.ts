/**
 * Shared preset-sync helpers — the fix for
 * "Agent 预设「诉讼管家 / 非诉管家」无法挂载（Cannot find package 'dsh-legal-suite'）".
 *
 * Why the rewrite exists:
 * - The HOST bundle loader resolves a plugin row like `agentlex: dsh-legal-suite`
 *   from the PROFILE root (`profiles/<name>/node_modules`), so the plugin itself
 *   loads fine.
 * - The AGENT-PRESET loader (the one that loads `.agent-presets/<id>/agent.cordis.yml`
 *   rows) resolves `name:` from the App install tree (`.../node_modules/@deepseek-ai/...`),
 *   which never contains the profile-installed `dsh-legal-suite`. A bare package
 *   name therefore fails with `Cannot find package 'dsh-legal-suite'`.
 * - The shipping presets are copied verbatim into `${DSH_HOME}/.agent-presets/`
 *   on every host apply, so hand-editing the copy is pointless — the fix must
 *   happen when the backup copy is written.
 *
 * Fix: when syncing a shipped preset, rewrite the agent-plugin row's
 * `name: dsh-legal-suite` (bare package name) to this package's OWN absolute
 * entry URL. A `file://` specifier does not depend on any loader base directory:
 * Node imports it by path, and the package's own dependencies resolve from its
 * real install location. The sync code runs inside the successfully-loaded host
 * bundle, so it can compute its own location via `import.meta.url` — no hardcoded
 * username/profile paths, and the result stays correct across machines and
 * upgrades (each apply re-syncs from the new install).
 *
 * This module is compiled to `lib/shared/preset-sync.js`; its own position
 * (up two levels) is always the package root, in both the src layout and the
 * built layout.
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Bare package name used in the shipped presets' agent-plugin row. */
export const SUITE_PACKAGE_NAME = 'dsh-legal-suite'

/** The preset row we must rewrite: `name: 'dsh-legal-suite'` (any indent/quote). */
const AGENT_NAME_LINE = /(^.*name:\s*)(['"])dsh-legal-suite\2([ \t]*)$/m

/** Package root of dsh-legal-suite, derived from THIS module's own location. */
function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

/** Absolute file:// URL of this package's own entry (lib/index.js). */
export function suiteEntryUrl(): string {
  return pathToFileURL(join(packageRoot(), 'lib', 'index.js')).href
}

/** Single-quote a YAML scalar, doubling embedded quotes ('' escapes a quote). */
function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Rewrite the `name: 'dsh-legal-suite'` agent-plugin row to the package's own
 * absolute entry URL. Any other row (`@deepseek-ai/...`) is left untouched.
 * Idempotent: an already-URL'd row no longer matches and stays as-is.
 */
export function rewriteSuiteEntry(yml: string, entryUrl: string): string {
  return yml.replace(AGENT_NAME_LINE, (_match, lead: string, _quote: string, trail: string) => {
    return `${lead}${yamlQuote(entryUrl)}${trail}`
  })
}

/**
 * Copy a shipped preset directory into `${DSH_HOME}/.agent-presets/<id>`,
 * rewriting agent.cordis.yml's plugin row from the bare package name to the
 * package's own absolute entry URL (see module comment). Every other entry is
 * copied byte-for-byte. Serialize callers with their own queue; this function
 * is rm→mkdir→per-entry copy, so concurrent runs into the same target never
 * interleave into a half-written preset.
 */
export async function syncShippedPreset(source: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  const entryUrl = suiteEntryUrl()
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const srcPath = join(source, entry.name)
    const dstPath = join(target, entry.name)
    if (entry.name === 'agent.cordis.yml' && entry.isFile()) {
      const text = await readFile(srcPath, 'utf8')
      await writeFile(dstPath, rewriteSuiteEntry(text, entryUrl), 'utf8')
    } else {
      await cp(srcPath, dstPath, { recursive: true, force: true })
    }
  }
}