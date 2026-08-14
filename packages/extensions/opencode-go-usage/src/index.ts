/**
 * OpenCode Go subscription usage: one Host service exposing the three usage
 * windows (rolling five-hour, weekly, monthly) as a Remote namespace, plus the
 * globally registered `opencode_go_usage` model tool that answers the same
 * snapshot in conversation.
 *
 * The gateway answers `GET {usageUrl}` with Bearer auth resolved per request
 * through the credential seam, so a changed key reaches the next read without
 * a restart and the secret never enters configuration or process arguments.
 * @module @deepseek-ai/dsh-opencode-go-usage
 */

import { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  UsageFailure,
  UsageResult,
  UsageWindow,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** OpenCode Go usage service (`ctx.opencodeUsage`). */
    opencodeUsage: OpencodeUsageService
  }
}

/** Credential reference resolved per request; the Go gateway authenticates with it as a Bearer token. */
const DEFAULT_API_KEY_ENV = 'OPENCODE_GO_API_KEY'
/** The gateway endpoint answering one JSON document with the three windows. */
const DEFAULT_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
/** Per-read HTTP deadline in milliseconds. */
const DEFAULT_TIMEOUT_MS = 20_000

/** Deployment-varying choices for one route. */
export interface Config {
  /** Credential reference (environment-variable name) supplying the Go API key. */
  apiKeyEnv?: string
  /** Gateway endpoint serving the usage document. */
  usageUrl?: string
  /** Per-read HTTP deadline in milliseconds. */
  timeoutMs?: number
}

/** Loader validation for the deployment-varying choices. */
export const Config: s<Config> = s.object({
  apiKeyEnv: s.string().default(DEFAULT_API_KEY_ENV),
  usageUrl: s.string().default(DEFAULT_USAGE_URL),
  timeoutMs: s.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
})

/** Validate the one numeric choice at the configuration boundary. */
function resolveTimeoutMs(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new TypeError(
      `opencode-go-usage: timeoutMs must be a positive finite number, got ${String(value)}`,
    )
  }
  return value
}

/** Build the failed-read branch with one actionable reason. */
function failure(error: string): UsageFailure {
  return { ok: false, error }
}

/** Whether a value can carry one usage window by property access. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Project one window from the gateway payload; a missing or malformed window is `null`. */
function windowOf(payload: Record<string, unknown>, name: string): UsageWindow | null {
  const value = payload[name]
  if (!isRecord(value)) return null
  const status = value.status
  const percent = value.percent
  const resetsAt = value.resetsAt
  return {
    status: typeof status === 'string' ? status : 'unknown',
    percent: typeof percent === 'number' ? percent : null,
    resetsAt: typeof resetsAt === 'string' ? resetsAt : null,
  }
}

/** Two-digit zero-padded clock field. */
function pad(value: number): string {
  return (value < 10 ? '0' : '') + String(value)
}

/** Local wall-clock rendering of one ISO instant; the raw string survives unparseable input. */
function fmtTime(iso: string | null): string {
  if (iso === null || iso.length === 0) return '未知'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** One window rendered as `label percent | 重置于 time`. */
function pctText(window: UsageWindow | null): string {
  if (window === null) return '未知'
  return `${window.percent === null ? '?' : String(window.percent)}%`
}

/** The fields a render projection reads off one snapshot or failure. */
type UsageRenderValue = Partial<Record<'ok' | 'error' | 'fetchedAt' | 'rolling' | 'weekly' | 'monthly', unknown>>

/** Render one snapshot as the tool's plain-text answer; a failed read renders its reason. */
function renderUsageText(value: unknown): ContentBlock {
  const result: UsageRenderValue = isRecord(value) ? value : {}
  if (result.ok !== true) {
    return { type: 'text', text: 'OpenCode Go 额度查询失败: ' + (typeof result.error === 'string' ? result.error : '未知错误') }
  }
  const line = (label: string, window: UsageWindow | null): string =>
    `${label} ${pctText(window)} | 重置于 ${fmtTime(window === null ? null : window.resetsAt)}`
  return {
    type: 'text',
    text: 'OpenCode Go 套餐额度(更新于 ' + fmtTime(typeof result.fetchedAt === 'string' ? result.fetchedAt : null) + '):\n'
      + line('滚动5小时:', (result.rolling as UsageWindow | null | undefined) ?? null) + '\n'
      + line('本周:', (result.weekly as UsageWindow | null | undefined) ?? null) + '\n'
      + line('本月:', (result.monthly as UsageWindow | null | undefined) ?? null),
  }
}

/**
 * Host service owning the usage route and the model tool.
 */
export class OpencodeUsageService extends TypertRemoteService {
  /** Credential seam for the key and the tool registry for the model tool. */
  static inject = ['credentials', 'tools']

  private readonly apiKeyEnv: CredentialRef
  private readonly usageUrl: string
  private readonly timeoutMs: number

  /**
   * @param ctx - Host context carrying the credential and tool registries.
   * @param config - Validated route choices; schema defaults fill omitted fields.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'opencodeUsage')
    this.apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
    this.usageUrl = config.usageUrl ?? DEFAULT_USAGE_URL
    this.timeoutMs = resolveTimeoutMs(config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'opencode_go_usage',
      description: '查询 OpenCode Go 订阅套餐的额度消耗:滚动5小时、每周、每月窗口的已用百分比与下次重置时间。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: unknown) => [renderUsageText(value)],
      },
      execute: () => this.usage(),
    })))
  }

  /**
   * Read the current Go usage snapshot from the gateway.
   * @returns the three windows with their reset instants, or one failure reason.
   */
  @Remote('usage')
  async usage(): Promise<UsageResult> {
    const credential = await this.ctx.credentials.resolve(this.apiKeyEnv)
    if (credential === undefined || credential.value.length === 0) {
      return failure(`${this.apiKeyEnv} 未配置;请在 设置 → 模型 → opencode-go 中填入 API 密钥`)
    }
    let response: Response
    try {
      response = await fetch(this.usageUrl, {
        headers: { Authorization: 'Bearer ' + credential.value },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      return failure(`请求 OpenCode 失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      return failure(`OpenCode 返回 HTTP ${String(response.status)}`)
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return failure('OpenCode 响应不是 JSON')
    }
    if (!isRecord(payload)) {
      return failure('OpenCode 响应缺少 usage 字段')
    }
    const usage = payload.usage
    if (!isRecord(usage)) {
      return failure('OpenCode 响应缺少 usage 字段')
    }
    return {
      ok: true,
      fetchedAt: new Date().toISOString(),
      rolling: windowOf(usage, 'rolling'),
      weekly: windowOf(usage, 'weekly'),
      monthly: windowOf(usage, 'monthly'),
    }
  }
}

export default OpencodeUsageService
