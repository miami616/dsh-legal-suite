#!/usr/bin/env node
// Post-build copy of the push command-job script into the host lib output.
// tsc compiles src TS files to lib but does not copy .mjs assets, so the
// push domain's command job target is copied here after the tsc pass.
import fs from 'node:fs'
import { mkdirSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'

const source = 'src/domains/push/push-cli.mjs'
const target = 'lib/domains/push/push-cli.mjs'

if (!fs.existsSync(source)) {
  console.error('copy-push-cli: source not found: ' + source)
  process.exit(1)
}
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log('copy-push-cli: ' + source + ' -> ' + target)
