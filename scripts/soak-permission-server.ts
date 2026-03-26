import { readFileSync } from 'fs'
import http from 'http'
import { performance } from 'perf_hooks'
import { PermissionServer } from '../src/main/hooks/permission-server'

type HookPayload = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode: string
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
}

type HookDecision = 'allow' | 'deny'
type PromptDecision = 'allow' | 'allow-session' | 'allow-domain' | 'deny'

function activeHandleCount(): number {
  const fn = (process as any)._getActiveHandles
  if (typeof fn !== 'function') return -1
  try {
    return fn.call(process).length as number
  } catch {
    return -1
  }
}

function readHookUrl(settingsPath: string): string {
  const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  return raw.hooks.PreToolUse[0].hooks[0].url as string
}

function postJson(url: string, payload: HookPayload): Promise<{ status: number; body: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const parsed = new URL(url)
    const data = JSON.stringify(payload)
    const req = http.request({
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 80,
      path: parsed.pathname,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          body,
          durationMs: performance.now() - t0,
        })
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postJsonWithRetry(
  url: string,
  payload: HookPayload,
  maxAttempts = 3
): Promise<{ status: number; body: string; durationMs: number }> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await postJson(url, payload)
    } catch (err: any) {
      lastError = err
      const code = typeof err?.code === 'string' ? err.code : ''
      const retryable = code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE'
      if (!retryable || attempt === maxAttempts) break
      await sleep(20 * attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function buildPayload(params: {
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string
}): HookPayload {
  return {
    session_id: params.sessionId,
    transcript_path: '/tmp/transcript.jsonl',
    cwd: process.cwd(),
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: params.toolName,
    tool_input: params.toolInput,
    tool_use_id: params.toolUseId,
  }
}

function extractDecision(body: string): HookDecision {
  try {
    const parsed = JSON.parse(body)
    return parsed.hookSpecificOutput?.permissionDecision === 'allow' ? 'allow' : 'deny'
  } catch {
    return 'deny'
  }
}

async function main() {
  const cycles = Number(process.env.SOAK_CYCLES || '180')
  const printEvery = Number(process.env.SOAK_PRINT_EVERY || '20')

  let requests = 0
  let failures = 0
  let promptCount = 0
  let unexpectedPromptCount = 0
  let missingPromptCount = 0
  let totalLatencyMs = 0

  const heapSamples: Array<{ cycle: number; heapUsed: number; rss: number; handles: number }> = []
  const baselineHandles = activeHandleCount()

  const t0 = performance.now()

  for (let cycle = 1; cycle <= cycles; cycle++) {
    const port = 19836 + (cycle % 100)
    const server = new PermissionServer(port)
    const promptDecisionByUseId = new Map<string, PromptDecision>()

    server.on('permission-request', (questionId: string, toolRequest: HookPayload) => {
      promptCount++
      const decision = promptDecisionByUseId.get(toolRequest.tool_use_id) || 'deny'
      const ok = server.respondToPermission(questionId, decision)
      if (!ok) failures++
    })

    await server.start()

    try {
      const sessionId = `session-${cycle}`
      const tabId = `tab-${cycle}`

      const runA = server.registerRun(tabId, `req-a-${cycle}`, sessionId)
      const runASettings = server.generateSettingsFile(runA)
      const runAUrl = readHookUrl(runASettings)

      const stepA1 = `a1-${cycle}`
      promptDecisionByUseId.set(stepA1, 'allow-session')
      const beforeA1 = promptCount
      const resA1 = await postJsonWithRetry(runAUrl, buildPayload({
        sessionId,
        toolName: 'Write',
        toolInput: { file_path: `/tmp/a1-${cycle}.txt`, content: 'x' },
        toolUseId: stepA1,
      }))
      totalLatencyMs += resA1.durationMs
      requests++
      if (promptCount === beforeA1) missingPromptCount++
      if (resA1.status !== 200 || extractDecision(resA1.body) !== 'allow') failures++
      promptDecisionByUseId.delete(stepA1)

      const stepA2 = `a2-${cycle}`
      promptDecisionByUseId.set(stepA2, 'deny')
      const beforeA2 = promptCount
      const resA2 = await postJsonWithRetry(runAUrl, buildPayload({
        sessionId,
        toolName: 'Write',
        toolInput: { file_path: `/tmp/a2-${cycle}.txt`, content: 'x' },
        toolUseId: stepA2,
      }))
      totalLatencyMs += resA2.durationMs
      requests++
      if (promptCount > beforeA2) unexpectedPromptCount++
      if (resA2.status !== 200 || extractDecision(resA2.body) !== 'allow') failures++
      promptDecisionByUseId.delete(stepA2)
      server.unregisterRun(runA)

      const runB = server.registerRun(tabId, `req-b-${cycle}`, sessionId)
      const runBSettings = server.generateSettingsFile(runB)
      const runBUrl = readHookUrl(runBSettings)

      const stepB1 = `b1-${cycle}`
      promptDecisionByUseId.set(stepB1, 'deny')
      const beforeB1 = promptCount
      const resB1 = await postJsonWithRetry(runBUrl, buildPayload({
        sessionId,
        toolName: 'Write',
        toolInput: { file_path: `/tmp/b1-${cycle}.txt`, content: 'x' },
        toolUseId: stepB1,
      }))
      totalLatencyMs += resB1.durationMs
      requests++
      if (promptCount === beforeB1) missingPromptCount++
      if (resB1.status !== 200 || extractDecision(resB1.body) !== 'deny') failures++
      promptDecisionByUseId.delete(stepB1)
      server.unregisterRun(runB)

      const runC = server.registerRun(tabId, `req-c-${cycle}`, sessionId)
      const runCSettings = server.generateSettingsFile(runC)
      const runCUrl = readHookUrl(runCSettings)

      const stepC1 = `c1-${cycle}`
      promptDecisionByUseId.set(stepC1, 'allow-domain')
      const beforeC1 = promptCount
      const resC1 = await postJsonWithRetry(runCUrl, buildPayload({
        sessionId,
        toolName: 'WebFetch',
        toolInput: { url: 'https://example.com/alpha' },
        toolUseId: stepC1,
      }))
      totalLatencyMs += resC1.durationMs
      requests++
      if (promptCount === beforeC1) missingPromptCount++
      if (resC1.status !== 200 || extractDecision(resC1.body) !== 'allow') failures++
      promptDecisionByUseId.delete(stepC1)

      const stepC2 = `c2-${cycle}`
      promptDecisionByUseId.set(stepC2, 'deny')
      const beforeC2 = promptCount
      const resC2 = await postJsonWithRetry(runCUrl, buildPayload({
        sessionId,
        toolName: 'WebFetch',
        toolInput: { url: 'https://example.com/bravo' },
        toolUseId: stepC2,
      }))
      totalLatencyMs += resC2.durationMs
      requests++
      if (promptCount > beforeC2) unexpectedPromptCount++
      if (resC2.status !== 200 || extractDecision(resC2.body) !== 'allow') failures++
      promptDecisionByUseId.delete(stepC2)

      const stepC3 = `c3-${cycle}`
      promptDecisionByUseId.set(stepC3, 'deny')
      const beforeC3 = promptCount
      const resC3 = await postJsonWithRetry(runCUrl, buildPayload({
        sessionId,
        toolName: 'WebFetch',
        toolInput: { url: 'https://otherdomain.test/charlie' },
        toolUseId: stepC3,
      }))
      totalLatencyMs += resC3.durationMs
      requests++
      if (promptCount === beforeC3) missingPromptCount++
      if (resC3.status !== 200 || extractDecision(resC3.body) !== 'deny') failures++
      promptDecisionByUseId.delete(stepC3)
      server.unregisterRun(runC)
    } catch {
      failures++
    } finally {
      server.stop()
    }

    if (global.gc) {
      global.gc()
      global.gc()
    }
    const mu = process.memoryUsage()
    const handles = activeHandleCount()
    heapSamples.push({
      cycle,
      heapUsed: mu.heapUsed,
      rss: mu.rss,
      handles,
    })

    if (cycle % printEvery === 0 || cycle === cycles) {
      const latest = heapSamples[heapSamples.length - 1]
      const avgMs = requests > 0 ? totalLatencyMs / requests : 0
      console.log(
        `[cycle ${cycle}/${cycles}] requests=${requests} failures=${failures} prompts=${promptCount} ` +
        `heap=${(latest.heapUsed / 1024 / 1024).toFixed(2)}MB rss=${(latest.rss / 1024 / 1024).toFixed(2)}MB handles=${latest.handles} avg=${avgMs.toFixed(2)}ms`
      )
    }
  }

  const elapsedMs = performance.now() - t0
  const first = heapSamples[0]
  const last = heapSamples[heapSamples.length - 1]
  const heapDeltaMb = first && last ? (last.heapUsed - first.heapUsed) / 1024 / 1024 : 0
  const rssDeltaMb = first && last ? (last.rss - first.rss) / 1024 / 1024 : 0
  const endingHandles = activeHandleCount()

  console.log('')
  console.log('=== SOAK RESULT ===')
  console.log(`cycles=${cycles}`)
  console.log(`requests=${requests}`)
  console.log(`failures=${failures}`)
  console.log(`missing_prompts=${missingPromptCount}`)
  console.log(`unexpected_prompts=${unexpectedPromptCount}`)
  console.log(`avg_request_latency_ms=${(requests > 0 ? totalLatencyMs / requests : 0).toFixed(2)}`)
  console.log(`heap_delta_mb=${heapDeltaMb.toFixed(2)}`)
  console.log(`rss_delta_mb=${rssDeltaMb.toFixed(2)}`)
  console.log(`handles_baseline=${baselineHandles}`)
  console.log(`handles_end=${endingHandles}`)
  console.log(`elapsed_s=${(elapsedMs / 1000).toFixed(2)}`)

  if (failures > 0 || missingPromptCount > 0 || unexpectedPromptCount > 0) {
    process.exitCode = 1
    return
  }
}

void main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
