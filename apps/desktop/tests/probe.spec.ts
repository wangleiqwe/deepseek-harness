import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { isReachable, waitForReachable } from '../src/probe.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    // A probe that hangs mid-request leaves a non-idle connection behind, which
    // close() would wait on forever; closeAllConnections drops it first.
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
})

async function listenPort(): Promise<number> {
  const server = createServer((_request, response) => { response.end('ok') })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  return address.port
}

describe('isReachable', () => {
  it('resolves true when the server answers', async () => {
    const port = await listenPort()
    await expect(isReachable(`http://127.0.0.1:${port}/`)).resolves.toBe(true)
  })

  it('resolves false when the connection is refused', async () => {
    const probe = createServer((_request, response) => { response.end('ok') })
    await new Promise<void>((resolve) => { probe.listen(0, '127.0.0.1', () => { resolve() }) })
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
    const port = address.port
    await new Promise<void>((resolve) => { probe.close(() => { resolve() }) })
    await expect(isReachable(`http://127.0.0.1:${port}/`)).resolves.toBe(false)
  })

  it('resolves false when the server accepts but never answers', async () => {
    const silent = createServer(() => {
      // Accept the connection and never respond: the client deadline must win.
    })
    servers.push(silent)
    await new Promise<void>((resolve) => { silent.listen(0, '127.0.0.1', () => { resolve() }) })
    const address = silent.address()
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
    await expect(isReachable(`http://127.0.0.1:${address.port}/`, 150)).resolves.toBe(false)
  })
})

describe('waitForReachable', () => {
  it('resolves true once a late server comes up', async () => {
    const server = createServer((_request, response) => { response.end('ok') })
    servers.push(server)
    const late = new Promise<number>((resolve) => {
      setTimeout(() => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address()
          if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
          resolve(address.port)
        })
      }, 400)
    })
    const port = await late
    await expect(waitForReachable(`http://127.0.0.1:${port}/`, { timeoutMs: 3000, intervalMs: 50 })).resolves.toBe(true)
  })

  it('resolves false when nothing answers before the deadline', async () => {
    const probe = createServer((_request, response) => { response.end('ok') })
    await new Promise<void>((resolve) => { probe.listen(0, '127.0.0.1', () => { resolve() }) })
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
    const port = address.port
    await new Promise<void>((resolve) => { probe.close(() => { resolve() }) })
    await expect(waitForReachable(`http://127.0.0.1:${port}/`, { timeoutMs: 400, intervalMs: 50 })).resolves.toBe(false)
  })
})
