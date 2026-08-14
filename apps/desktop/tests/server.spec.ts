import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isReachable, waitForReachable } from '../src/probe.ts'
import { ServerSupervisor, ServerUnavailableError } from '../src/server.ts'

const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))
const children: ChildProcess[] = []
const servers: Server[] = []
let sandbox: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'dsh-desktop-server-'))
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  rmSync(sandbox, { recursive: true, force: true })
})

async function freePort(): Promise<number> {
  const server = createServer((_request, response) => { response.end('ok') })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  const port = address.port
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  return port
}

function echoSpawn(port: number) {
  return { command: process.execPath, args: [ECHO_SERVER, String(port)], cwd: sandbox }
}

describe('ServerSupervisor.ensure', () => {
  it('attaches to an already-running server and never stops it', async () => {
    const port = await freePort()
    const child = spawn(process.execPath, [ECHO_SERVER, String(port)], { stdio: 'ignore' })
    children.push(child)
    await waitForReachable(`http://127.0.0.1:${port}/`, { timeoutMs: 5000 })
    const supervisor = new ServerSupervisor()
    await expect(supervisor.ensure({
      url: `http://127.0.0.1:${port}/`,
      spawn: null,
      readinessTimeoutMs: 5000,
      logPath: null,
    })).resolves.toEqual({ owned: false })
    await supervisor.stop()
    await expect(isReachable(`http://127.0.0.1:${port}/`)).resolves.toBe(true)
  })

  it('spawns an owned server and stop() takes it down', async () => {
    const port = await freePort()
    const supervisor = new ServerSupervisor()
    await expect(supervisor.ensure({
      url: `http://127.0.0.1:${port}/`,
      spawn: echoSpawn(port),
      readinessTimeoutMs: 10_000,
      logPath: null,
    })).resolves.toEqual({ owned: true })
    expect(supervisor.isOwned).toBe(true)
    await expect(isReachable(`http://127.0.0.1:${port}/`)).resolves.toBe(true)
    await supervisor.stop()
    expect(supervisor.isOwned).toBe(false)
    await expect(waitForReachable(`http://127.0.0.1:${port}/`, { timeoutMs: 3000, intervalMs: 100 })).resolves.toBe(false)
  })

  it('fails when the spawned process exits before answering', async () => {
    const port = await freePort()
    const supervisor = new ServerSupervisor()
    const promise = supervisor.ensure({
      url: `http://127.0.0.1:${port}/`,
      spawn: { command: process.execPath, args: ['-e', 'process.exit(3)'], cwd: sandbox },
      readinessTimeoutMs: 5000,
      logPath: null,
    })
    await expect(promise).rejects.toThrow(/退出码 3/)
    expect(supervisor.isOwned).toBe(false)
  })

  it('fails when the spawned process cannot be found', async () => {
    const port = await freePort()
    const supervisor = new ServerSupervisor()
    await expect(supervisor.ensure({
      url: `http://127.0.0.1:${port}/`,
      spawn: { command: 'this-binary-does-not-exist-dsh-xyz', args: [], cwd: sandbox },
      readinessTimeoutMs: 5000,
      logPath: null,
    })).rejects.toThrow(/启动失败/)
    expect(supervisor.isOwned).toBe(false)
  })

  it('fails after the readiness deadline and cleans up the child', async () => {
    const port = await freePort()
    const supervisor = new ServerSupervisor()
    await expect(supervisor.ensure({
      url: `http://127.0.0.1:${port}/`,
      spawn: { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], cwd: sandbox },
      readinessTimeoutMs: 1200,
      logPath: null,
    })).rejects.toThrow(/未在 1200ms 内就绪/)
    expect(supervisor.isOwned).toBe(false)
  })

  it('fails when no spawn is available and nothing is running', async () => {
    const port = await freePort()
    const supervisor = new ServerSupervisor()
    await expect(supervisor.ensure({
      url: `http://127.0.0.1:${port}/`,
      spawn: null,
      readinessTimeoutMs: 1000,
      logPath: null,
    })).rejects.toBeInstanceOf(ServerUnavailableError)
  })
})

describe('ServerSupervisor.stop', () => {
  it('is a no-op when nothing is owned', async () => {
    const supervisor = new ServerSupervisor()
    await expect(supervisor.stop()).resolves.toBeUndefined()
  })
})
