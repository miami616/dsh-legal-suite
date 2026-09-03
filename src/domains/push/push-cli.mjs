#!/usr/bin/env node
/**
 * Push command-job entry (the dsh-timer-agent command target).
 *
 * This is a THIN trigger: it reads the web URL from the environment
 * (DSH_WEB_URL, set by the dsh host) and POSTs to the host's
 * /api/agentlex-push/run route. The host half does the real work
 * (read deadlines → filter → format → send via dsh-im → dedupe) in-process,
 * so the command job never needs to know channel credentials or the data
 * directory layout.
 *
 * Usage:
 *   node push-cli.mjs
 *
 * Env:
 *   DSH_WEB_URL  — the dsh web base URL (e.g. http://127.0.0.1:3080).
 *                  Falls back to http://127.0.0.1:3080.
 */
const baseUrl = (process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080').replace(/\/+$/, '')

async function main() {
  const res = await fetch(`${baseUrl}/api/agentlex-push/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({}),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success !== true) {
    console.error(`[agentlex-push] run failed (${res.status}):`, body.error ?? 'unknown')
    process.exit(1)
  }
  const result = body.data ?? {}
  console.log(`[agentlex-push] due=${result.due ?? 0} pushed=${result.pushed ?? 0} attempted=${result.attempted ?? false}`)
}

main().catch((error) => {
  console.error('[agentlex-push] command job error:', error)
  process.exit(1)
})
