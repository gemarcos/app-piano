#!/usr/bin/env node
// Waits until a file under the watched folders is newer than a reference, or until a timeout.
// Usage: node scripts/wait-for-changes.mjs [--since <file|ISO date>] [--timeout 540] [dirs...]
//   defaults: --since docs/preview/state.json, dirs docs/screenshots docs/agents/reports
// Prints the changed files and exits 0, or exits 2 on timeout. Used by the liaison agent between rounds.
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  const [value] = args.splice(i, 2).slice(1)
  return value
}
const since = option('--since', 'docs/preview/state.json')
const timeoutSec = Number(option('--timeout', 540))
const dirs = args.length ? args : ['docs/screenshots', 'docs/agents/reports']

const sincePath = path.resolve(ROOT, since)
const reference = existsSync(sincePath) ? statSync(sincePath).mtimeMs : Date.parse(since) || Date.now()

function changed() {
  const out = []
  for (const dir of dirs) {
    const abs = path.resolve(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs, { recursive: true })) {
      const file = path.join(abs, String(name))
      try {
        const stat = statSync(file)
        if (stat.isFile() && stat.mtimeMs > reference) out.push(path.relative(ROOT, file).replaceAll('\\', '/'))
      } catch {
        /* file removed while scanning */
      }
    }
  }
  return out
}

const deadline = Date.now() + timeoutSec * 1000
for (;;) {
  const files = changed()
  if (files.length) {
    console.log(files.join('\n'))
    process.exit(0)
  }
  if (Date.now() >= deadline) {
    console.log(`sin cambios en ${timeoutSec} s`)
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 15_000))
}
