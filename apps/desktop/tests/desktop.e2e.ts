import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'

// Electron smoke: boots the real desktop shell (real binary, real main
// process) against an in-process mock server, and verifies the observable
// lifecycle through the shell's own desktop.log — attach, window page load.
// The shell is spawned with stdio ignored: this lane must also run inside
// harness sandboxes whose named-pipe boundary forbids piped child stdio.
const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SMOKE_HTML = '<!doctype html><html><head><title>DSH Desktop Smoke</title></head><body><div id="dsh-smoke">ok</div></body></html>'
const STARTUP_DEADLINE_MS = 30_000

let server: Server
let url: string
let userData: string
let child: ChildProcess | null = null

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(SMOKE_HTML)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  url = `http://127.0.0.1:${address.port}/`
  userData = mkdtempSync(join(tmpdir(), 'dsh-desktop-e2e-'))
  // The electron npm package's runtime default export is the binary path,
  // while its type declarations export the Electron namespace; the cast
  // crosses that deliberate typing gap.
  const electronModule = await import('electron') as unknown as { default: string }
  const electronBinary = electronModule.default
  child = spawn(electronBinary, [
    // Chromium's OS-level sandbox cannot start under restricted test tokens
    // (e.g. this harness's Windows ACL runner); the smoke serves a
    // loopback-only mock, so the browser-level sandbox is unnecessary here.
    '--no-sandbox',
    APP_DIR,
  ], {
    env: {
      ...process.env,
      DSH_DESKTOP_SERVER_URL: url,
      DSH_DESKTOP_SPAWN: '0',
      DSH_DESKTOP_USER_DATA: userData,
    },
    stdio: 'ignore',
  })
})

afterAll(async () => {
  if (child !== null) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
      await new Promise<void>((resolve) => { child!.once('exit', () => { resolve() }) })
    }
  }
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  await removeWithRetry(userData)
})

/** Remove the profile with retries: Chromium grandchildren release their file locks slightly after the main process exits. */
async function removeWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw error
      await sleep(200)
    }
  }
  throw new Error(`profile directory still locked after 5s: ${path}`)
}

async function desktopLog(): Promise<string> {
  const path = join(userData, 'desktop.log')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

async function waitForLog(substring: string): Promise<void> {
  const deadline = Date.now() + STARTUP_DEADLINE_MS
  for (;;) {
    if ((await desktopLog()).includes(substring)) return
    if (Date.now() >= deadline) {
      throw new Error(`desktop.log never contained ${JSON.stringify(substring)} within ${STARTUP_DEADLINE_MS}ms:\n${await desktopLog()}`)
    }
    await sleep(200)
  }
}

it('attaches to the running server and loads it in the main window', async () => {
  await waitForLog(`attached to running server: ${url}`)
  await waitForLog(`page loaded: ${url}`)
  // The env-provided userData must be adopted (no files under the default profile).
  expect(await desktopLog()).toContain('desktop shell starting')
})
