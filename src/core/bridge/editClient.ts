/**
 * AI 编辑传输层：与本地桥（spatialharness serve ≥0.3.0）的编辑中转队列通信。
 * 职责仅限 HTTP（轮询/回传），编辑语义在 state/aiEdit.ts（组装 Command 进 history）。
 * 见 docs/ai-editing.md。
 */
import { DEFAULT_BRIDGE_URL } from './pythonBridge'

export interface EditCommandMessage {
  id: number
  tool: string
  args: Record<string, unknown>
}

export interface PendingResponse {
  commands: EditCommandMessage[]
  latest: number
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { signal: controller.signal })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return (await resp.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** 浏览器轮询：取 ack 之后的新命令（兼作在线心跳） */
export async function fetchPendingEdits(ack: number, baseUrl = DEFAULT_BRIDGE_URL): Promise<PendingResponse> {
  return getJson<PendingResponse>(`${baseUrl}/edit/pending?ack=${ack}`, 4000)
}

/** 回传一条命令的执行结果 */
export async function postEditResult(
  id: number,
  ok: boolean,
  summaryOrError: string,
  baseUrl = DEFAULT_BRIDGE_URL,
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    await fetch(`${baseUrl}/edit/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ok, summary: ok ? summaryOrError : undefined, error: ok ? undefined : summaryOrError }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
