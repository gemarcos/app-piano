#!/usr/bin/env node
// Starts / stops a private Vite server on a given port (Windows, Linux and macOS).
// Usage: node scripts/serve.mjs start <port> [--preview] [--log file]
//          detached dev server (or `vite preview` of dist/ with --preview) bound to 127.0.0.1;
//          returns once it answers. Log: <os tmpdir>/pauta/vite-<port>.log unless --log is given.
//        node scripts/serve.mjs stop <port>     kills only the node process listening on <port>
//        node scripts/serve.mjs status <port>
// Never kill node processes by name: node.exe also runs the agents' own tooling.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [cmd, portArg, ...rest] = process.argv.slice(2)
const port = Number(portArg)
const option = (name) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}

if (!['start', 'stop', 'status'].includes(cmd) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('usage: node scripts/serve.mjs start|stop|status <port> [--preview] [--log file]')
  process.exit(1)
}

/** PIDs listening on the TCP port. */
function listeningPids() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
      const pids = new Set()
      for (const line of out.split(/\r?\n/)) {
        // Proto  Local address  Remote address  State  PID (the state may be localized; listeners have remote port 0)
        const cols = line.trim().split(/\s+/)
        if (cols.length < 5 || cols[0] !== 'TCP' || !cols[1].endsWith(`:${port}`)) continue
        if (cols[3] === 'LISTENING' || cols[3] === 'ESCUCHANDO' || cols[2].endsWith(':0')) pids.add(Number(cols[cols.length - 1]))
      }
      return [...pids].filter((pid) => pid > 0)
    }
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    return out.split(/\s+/).filter(Boolean).map(Number)
  } catch {
    return []
  }
}

function processName(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
      const match = out.match(/^"([^"]+)"/m)
      return match ? match[1].toLowerCase() : ''
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim().toLowerCase()
  } catch {
    return ''
  }
}

function kill(pid) {
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else process.kill(pid, 'SIGTERM')
}

async function answers(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

const url = `http://localhost:${port}/`

if (cmd === 'status') {
  const pids = listeningPids()
  console.log(pids.length ? `en marcha: ${url} (pid ${pids.join(', ')})` : `nada escucha en ${port}`)
  process.exit(0)
}

if (cmd === 'stop') {
  const pids = listeningPids()
  if (!pids.length) {
    console.log(`nada escucha en ${port}`)
    process.exit(0)
  }
  for (const pid of pids) {
    const name = processName(pid)
    if (!name.startsWith('node')) {
      console.error(`el puerto ${port} es de "${name || pid}", no de un servidor node: no lo toco`)
      process.exit(1)
    }
    kill(pid)
    console.log(`parado: pid ${pid} en ${port}`)
  }
  process.exit(0)
}

// start
if (listeningPids().length) {
  console.error(`el puerto ${port} ya está ocupado (node scripts/serve.mjs stop ${port} si es tuyo)`)
  process.exit(1)
}
const logFile = option('--log') ?? path.join(os.tmpdir(), 'pauta', `vite-${port}.log`)
mkdirSync(path.dirname(logFile), { recursive: true })
const out = openSync(logFile, 'a')
const viteArgs = rest.includes('--preview') ? ['preview'] : []
viteArgs.push('--host', '127.0.0.1', '--port', String(port), '--strictPort')
const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), ...viteArgs], {
  cwd: ROOT,
  detached: true,
  stdio: ['ignore', out, out],
  windowsHide: true,
})
child.unref()

const deadline = Date.now() + 60_000
while (Date.now() < deadline) {
  if (await answers(url)) {
    console.log(`listo: ${url} (pid ${child.pid}, log ${logFile})`)
    process.exit(0)
  }
  if (child.exitCode !== null) break
  await new Promise((r) => setTimeout(r, 300))
}
console.error(`el servidor no respondió en ${port}; mira ${logFile}`)
process.exit(1)
