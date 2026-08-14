/**
 * Server supervision: attach to an already-running dsh web server, or own one
 * for this shell's lifetime. Ownership is exclusive — a server the supervisor
 * spawned is the only one it ever stops; an attached server is never touched.
 * @module @deepseek-ai/dsh-desktop/server
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { isReachable, waitForReachable } from './probe.ts'

/** The server cannot be reached and the shell cannot or may not start one. */
export class ServerUnavailableError extends Error {}

/** A structured (non-shell) spawn specification. */
export interface SpawnSpec {
  command: string
  args: readonly string[]
  cwd: string
  /** Run the command through the platform shell (a configured command line, not a resolved binary). */
  shell?: boolean
}

export interface EnsureOptions {
  /** The served web UI address to probe. */
  url: string
  /** The spawn to own startup with, or null when the shell may not start anything. */
  spawn: SpawnSpec | null
  /** Deadline for a spawned server to answer the readiness probe. */
  readinessTimeoutMs: number
  /** Append child stdio here; null drops child output entirely (tests). */
  logPath: string | null
}

export interface ServerOwnership {
  /** True when this shell started the server and is responsible for stopping it. */
  owned: boolean
}

/** How long {@link ServerSupervisor.stop} waits for the child to exit after the kill request. */
const STOP_WAIT_MS = 5000

export class ServerSupervisor {
  private child: ChildProcess | null = null
  private owned = false

  /** Whether a server this supervisor started is still tracked. */
  get isOwned(): boolean {
    return this.owned
  }

  /**
   * Reach an answering server at `options.url`: attach when one is already
   * running, spawn `options.spawn` when not. Fails with
   * {@link ServerUnavailableError} when the server stays unreachable, dies
   * before answering, or cannot be spawned — and cleans up the attempt.
   * @param options - probe target, optional spawn spec, and deadline.
   * @returns who owns the server now.
   */
  async ensure(options: EnsureOptions): Promise<ServerOwnership> {
    if (await isReachable(options.url)) return { owned: false }
    if (options.spawn === null) {
      throw new ServerUnavailableError(`服务器未运行（${options.url}），且没有可用的启动命令：请先运行 dsh web，或在设置中配置 server.command。`)
    }
    const child = spawn(options.spawn.command, [...options.spawn.args], {
      cwd: options.spawn.cwd,
      shell: options.spawn.shell ?? false,
      stdio: options.logPath === null ? 'ignore' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    })
    if (options.logPath !== null) {
      mkdirSync(dirname(options.logPath), { recursive: true })
      const log = createWriteStream(options.logPath, { flags: 'a' })
      child.stdout?.pipe(log)
      child.stderr?.pipe(log)
    }
    this.child = child
    this.owned = true
    try {
      // The child's stop detail rides the race value, so the throw sites read
      // one authoritative string instead of a callback-mutated variable.
      const childStopped = new Promise<string>((resolve) => {
        child.once('error', (error) => { resolve(error.message) })
        child.once('exit', (code, signal) => {
          resolve(signal === null ? `退出码 ${code ?? '未知'}` : `信号 ${signal}`)
        })
      })
      const ready = await Promise.race([
        waitForReachable(options.url, { timeoutMs: options.readinessTimeoutMs }),
        childStopped,
      ])
      if (typeof ready === 'string') {
        throw new ServerUnavailableError(`dsh web 启动失败（${options.url}）：进程${ready}；详见日志 ${logLabel(options.logPath)}`)
      }
      if (!ready) {
        throw new ServerUnavailableError(
          `dsh web 未在 ${String(options.readinessTimeoutMs)}ms 内就绪（${options.url}）；详见日志 ${logLabel(options.logPath)}`,
        )
      }
      return { owned: true }
    } catch (error) {
      await this.stop()
      if (error instanceof ServerUnavailableError) throw error
      throw new ServerUnavailableError(`dsh web 启动失败（${options.url}）：${describe(error)}`)
    }
  }

  /**
   * Stop the owned server: request termination and wait up to
   * {@link STOP_WAIT_MS}. An attached server or an already-exited child is a
   * no-op, and a child that ignores the request is left alone — on Windows
   * kill() already issued TerminateProcess, so nothing portable escalates it.
   */
  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.owned = false
    if (child === null || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await Promise.race([exited, sleep(STOP_WAIT_MS)])
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Human label for the child log in failure messages; null means output was dropped. */
function logLabel(logPath: string | null): string {
  return logPath ?? '(未记录)'
}
