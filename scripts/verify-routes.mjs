/**
 * Guard against duplicate `kind: 'exact'` route registrations.
 *
 * Why this exists: the host's webServer crashes at boot when the same exact
 * path is registered twice, and the failure says nothing about WHICH path
 * collided. It already bit this codebase once (/events vs /events-stream),
 * and again while adding the health routes (/health was taken by the plugin
 * health check). `makeRoutes` now throws at registration time, but that only
 * fires at runtime — this script catches it at build time from source.
 *
 * A route() call whose first argument is a template literal containing `${...}`
 * is resolved here by substituting the known prefix, so `route(`${API_PREFIX}/x`)`
 * is compared as the real path.
 *
 * Run: node scripts/verify-routes.mjs
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

const TARGETS = [
  { file: 'src/domains/litigation/routes.ts', prefixVar: 'API_PREFIX', prefix: '/api/agentlex-case' },
  { file: 'src/domains/nonlitigation/routes.ts', prefixVar: '', prefix: '' },
  { file: 'src/domains/litigation/legacy-compat.ts', prefixVar: '', prefix: '' },
  { file: 'src/domains/nonlitigation/legacy-compat.ts', prefixVar: '', prefix: '' },
]

let failures = 0

for (const target of TARGETS) {
  let src
  try {
    src = await readFile(join(ROOT, target.file), 'utf8')
  } catch {
    console.log(`SKIP  ${target.file} (not found)`)
    continue
  }

  // Match route('...') and route(`...`) — the path is always the first argument.
  const paths = [...src.matchAll(/\broute\(\s*[`']([^`']+)[`']/g)].map((m) => {
    const raw = m[1]
    // `${API_PREFIX}/health` → /api/agentlex-case/health
    if (target.prefixVar !== '' && raw.includes(`\${${target.prefixVar}}`)) {
      return raw.replace(`\${${target.prefixVar}}`, target.prefix)
    }
    return raw
  })

  const seen = new Set()
  const dupes = []
  for (const p of paths) {
    if (seen.has(p)) dupes.push(p)
    seen.add(p)
  }

  const ok = dupes.length === 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${target.file}  (${paths.length} routes${ok ? '' : `, 重名: ${dupes.join(', ')}`})`)
  if (!ok) failures++
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
