import type {
  ClaudeEvent,
  NormalizedEvent,
  StreamEvent,
  InitEvent,
  AssistantEvent,
  ResultEvent,
  RateLimitEvent,
  PermissionEvent,
  ContentDelta,
} from '../../shared/types'

/**
 * Maps raw Claude stream-json events to canonical CLUI events.
 *
 * The normalizer is stateless — it takes one raw event and returns
 * zero or more normalized events. The caller (RunManager) is responsible
 * for sequencing and routing.
 */
export function normalize(raw: ClaudeEvent): NormalizedEvent[] {
  switch (raw.type) {
    case 'system':
      return normalizeSystem(raw as InitEvent)

    case 'stream_event':
      return normalizeStreamEvent(raw as StreamEvent)

    case 'assistant':
      return normalizeAssistant(raw as AssistantEvent)

    case 'result':
      return normalizeResult(raw as ResultEvent)

    case 'rate_limit_event':
      return normalizeRateLimit(raw as RateLimitEvent)

    case 'permission_request':
      return normalizePermission(raw as PermissionEvent)

    default:
      // Unknown event type — skip silently (defensive)
      return []
  }
}

function normalizeSystem(event: InitEvent): NormalizedEvent[] {
  if (event.subtype !== 'init') return []

  return [{
    type: 'session_init',
    sessionId: event.session_id,
    tools: event.tools || [],
    model: event.model || 'unknown',
    mcpServers: event.mcp_servers || [],
    skills: event.skills || [],
    version: event.claude_code_version || 'unknown',
  }]
}

function normalizeStreamEvent(event: StreamEvent): NormalizedEvent[] {
  const sub = event.event
  if (!sub) return []

  switch (sub.type) {
    case 'content_block_start': {
      if (sub.content_block.type === 'tool_use') {
        return [{
          type: 'tool_call',
          toolName: sub.content_block.name || 'unknown',
          toolId: sub.content_block.id || '',
          index: sub.index,
        }]
      }
      // text block start — no event needed, text comes via deltas
      return []
    }

    case 'content_block_delta': {
      const delta = sub.delta as ContentDelta
      if (delta.type === 'text_delta') {
        return [{ type: 'text_chunk', text: delta.text }]
      }
      if (delta.type === 'input_json_delta') {
        return [{
          type: 'tool_call_update',
          toolId: '',
          partialInput: delta.partial_json,
        }]
      }
      if (delta.type === 'thinking_delta') {
        return [{ type: 'thinking_chunk', thinking: delta.thinking }]
      }
      return []
    }

    case 'content_block_stop': {
      return [{
        type: 'tool_call_complete',
        index: sub.index,
      }]
    }

    case 'message_start':
    case 'message_stop':
      return []

    case 'message_delta': {
      const md = sub as { type: 'message_delta'; delta: { stop_reason: string | null }; usage?: Record<string, unknown>; context_management?: { applied_edits?: Array<{ cleared_input_tokens?: number }> } }
      if (md.context_management?.applied_edits && md.context_management.applied_edits.length > 0) {
        const cleared = md.context_management.applied_edits.reduce((sum, e) => sum + (e.cleared_input_tokens || 0), 0)
        if (cleared > 0) {
          return [{ type: 'compact_complete', clearedTokens: cleared }]
        }
      }
      return []
    }

    default:
      return []
  }
}

function normalizeAssistant(event: AssistantEvent): NormalizedEvent[] {
  return [{
    type: 'task_update',
    message: event.message,
  }]
}

function normalizeResult(event: ResultEvent): NormalizedEvent[] {
  if (event.is_error || event.subtype === 'error') {
    return [{
      type: 'error',
      message: event.result || 'Unknown error',
      isError: true,
      sessionId: event.session_id,
    }]
  }

  const denials = Array.isArray((event as any).permission_denials)
    ? (event as any).permission_denials.map((d: any) => ({
        toolName: d.tool_name || '',
        toolUseId: d.tool_use_id || '',
      }))
    : undefined

  return [{
    type: 'task_complete',
    result: event.result || '',
    costUsd: event.total_cost_usd || 0,
    durationMs: event.duration_ms || 0,
    numTurns: event.num_turns || 0,
    usage: event.usage || {},
    sessionId: event.session_id,
    ...(denials && denials.length > 0 ? { permissionDenials: denials } : {}),
  }]
}

function normalizeRateLimit(event: RateLimitEvent): NormalizedEvent[] {
  const info = event.rate_limit_info
  if (!info) return []

  return [{
    type: 'rate_limit',
    status: info.status,
    resetsAt: info.resetsAt,
    rateLimitType: info.rateLimitType,
  }]
}

function normalizePermission(event: PermissionEvent): NormalizedEvent[] {
  return [{
    type: 'permission_request',
    questionId: event.question_id,
    toolName: event.tool?.name || 'unknown',
    toolDescription: event.tool?.description,
    toolInput: event.tool?.input,
    options: (event.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      kind: o.kind,
    })),
  }]
}

export function normalizeCodex(raw: any): NormalizedEvent[] {
  const evt = raw?.type === 'event_msg' && raw?.payload
    ? raw.payload
    : raw

  if (!evt || !evt.type) return []

  switch (evt.type) {
    case 'thread.started':
      return [{
        type: 'session_init',
        sessionId: evt.thread_id || '',
        tools: [],
        model: 'codex',
        mcpServers: [],
        skills: [],
        version: 'codex',
      }]

    case 'turn.started':
      return []

    case 'turn.completed': {
      const u = evt.usage || {}
      return [{
        type: 'task_complete',
        result: '',
        costUsd: 0,
        durationMs: 0,
        numTurns: 1,
        usage: {
          input_tokens: u.input_tokens || 0,
          output_tokens: u.output_tokens || 0,
          cache_read_input_tokens: u.cached_input_tokens || 0,
        },
        sessionId: evt.thread_id || '',
      }]
    }

    case 'turn.failed':
      return [{
        type: 'error',
        message: evt.error?.message || 'Codex turn failed',
        isError: true,
        sessionId: evt.thread_id || '',
      }]

    case 'error': {
      if (evt.message && evt.message.startsWith('Reconnecting')) return []
      return [{
        type: 'error',
        message: evt.message || 'Unknown Codex error',
        isError: true,
      }]
    }

    case 'token_count': {
      if (evt.rate_limits) {
        return [{
          type: 'codex_rate_limits',
          rateLimits: evt.rate_limits,
        }]
      }
      return []
    }

    case 'item.started': {
      const item = evt.item
      if (!item) return []
      return normalizeCodexItemStarted(item)
    }

    case 'item.updated': {
      const item = evt.item
      if (!item) return []
      return normalizeCodexItemUpdated(item)
    }

    case 'item.completed': {
      const item = evt.item
      if (!item) return []
      return normalizeCodexItemCompleted(item)
    }

    default:
      return []
  }
}

function isApplyPatch(command: string): boolean {
  return /apply_patch\s/.test(command) || command.trimStart().startsWith('apply_patch')
}

function isCatWrite(command: string): boolean {
  return /cat\s*>{1,2}\s*\S/.test(command)
}

function parseCatWrite(command: string): { filePath: string; content: string } | null {
  const catMatch = command.match(/cat\s*>{1,2}\s*(\S+)\s*<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?/)
  if (!catMatch) return null
  const filePath = catMatch[1].replace(/^["']|["']$/g, '')
  const marker = catMatch[2]
  const matchEnd = catMatch.index! + catMatch[0].length
  const contentStart = command.indexOf('\n', matchEnd)
  if (contentStart === -1) return null
  const rest = command.substring(contentStart + 1)
  const endPattern = new RegExp(`^${marker}$`, 'm')
  const endMatch = rest.match(endPattern)
  if (!endMatch || endMatch.index === undefined) return null
  const content = rest.substring(0, endMatch.index).replace(/\n$/, '')
  if (!content) return null
  return { filePath, content }
}

function isFileWrite(command: string): boolean {
  return isApplyPatch(command) || isCatWrite(command)
}

function parseApplyPatch(command: string): { filePath: string; oldStr: string; newStr: string } | null {
  const patchStart = command.indexOf('*** Begin Patch')
  const patchEnd = command.indexOf('*** End Patch')
  if (patchStart === -1 || patchEnd === -1) return null
  const patchBody = command.substring(patchStart, patchEnd)
  const lines = patchBody.split('\n')
  let filePath = ''
  const oldLines: string[] = []
  const newLines: string[] = []
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('--- a/') || line.startsWith('--- ')) {
      filePath = line.replace(/^---\s+a\//, '').replace(/^---\s+/, '').trim()
    } else if (line.startsWith('+++ ')) {
      if (!filePath) filePath = line.replace(/^[+]+\s+b\//, '').replace(/^[+]+\s+/, '').trim()
    } else if (line.startsWith('@@')) {
      inHunk = true
    } else if (inHunk) {
      if (line.startsWith('-')) {
        oldLines.push(line.substring(1))
      } else if (line.startsWith('+')) {
        newLines.push(line.substring(1))
      } else if (line.startsWith(' ')) {
        oldLines.push(line.substring(1))
        newLines.push(line.substring(1))
      }
    }
  }
  if (oldLines.length === 0 && newLines.length === 0) return null
  return { filePath, oldStr: oldLines.join('\n'), newStr: newLines.join('\n') }
}

function normalizeCodexItemStarted(item: any): NormalizedEvent[] {
  switch (item.type) {
    case 'command_execution': {
      const cmd = item.command || ''
      if (isApplyPatch(cmd)) {
        return [{ type: 'tool_call', toolName: 'Edit', toolId: item.id || '', index: 0 }]
      }
      if (isCatWrite(cmd)) {
        return [{ type: 'tool_call', toolName: 'Write', toolId: item.id || '', index: 0 }]
      }
      return [{ type: 'tool_call', toolName: 'Bash', toolId: item.id || '', index: 0 }]
    }

    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes : []
      const first = changes[0]
      if (!first) return []
      const isCreate = first.kind === 'create'
      return [{ type: 'tool_call', toolName: isCreate ? 'Write' : 'Edit', toolId: item.id || '', index: 0 }]
    }

    case 'mcp_tool_call':
      return [{ type: 'tool_call', toolName: `${item.server || 'mcp'}:${item.tool || 'unknown'}`, toolId: item.id || '', index: 0 }]

    case 'web_search':
      return [{ type: 'tool_call', toolName: 'WebSearch', toolId: item.id || '', index: 0 }]

    default:
      return []
  }
}

function normalizeCodexItemUpdated(item: any): NormalizedEvent[] {
  switch (item.type) {
    case 'command_execution': {
      const cmd = item.command || ''
      if (isFileWrite(cmd)) return []
      if (item.aggregated_output) {
        return [{ type: 'tool_call_update', toolId: item.id || '', partialInput: item.aggregated_output }]
      }
      return []
    }

    case 'agent_message': {
      if (item.text) {
        return [{ type: 'text_chunk', text: item.text }]
      }
      return []
    }

    default:
      return []
  }
}

function normalizeCodexItemCompleted(item: any): NormalizedEvent[] {
  switch (item.type) {
    case 'agent_message':
      if (item.text) {
        return [{ type: 'text_chunk', text: item.text }]
      }
      return []

    case 'reasoning':
      if (item.text) {
        return [{ type: 'thinking_chunk', thinking: item.text }]
      }
      return []

    case 'command_execution': {
      const events: NormalizedEvent[] = []
      const input = item.command || ''
      if (isApplyPatch(input)) {
        const parsed = parseApplyPatch(input)
        if (parsed) {
          const json = JSON.stringify({ file_path: parsed.filePath, old_string: parsed.oldStr, new_string: parsed.newStr })
          events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: json })
        }
      } else if (isCatWrite(input)) {
        const parsed = parseCatWrite(input)
        if (parsed) {
          const json = JSON.stringify({ file_path: parsed.filePath, content: parsed.content })
          events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: json })
        }
      } else if (input) {
        events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: input })
      }
      events.push({ type: 'tool_call_complete', index: 0 })
      return events
    }

    case 'file_change': {
      const events: NormalizedEvent[] = []
      const changes = Array.isArray(item.changes) ? item.changes : []
      const first = changes[0]
      if (first && first.path) {
        const isCreate = first.kind === 'create'
        const json = isCreate
          ? JSON.stringify({ file_path: first.path, content: '' })
          : JSON.stringify({ file_path: first.path, old_string: '', new_string: '' })
        events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: json })
      }
      events.push({ type: 'tool_call_complete', index: 0 })
      return events
    }

    case 'mcp_tool_call': {
      const events: NormalizedEvent[] = []
      if (item.arguments) {
        events.push({
          type: 'tool_call_update',
          toolId: item.id || '',
          partialInput: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments, null, 2),
        })
      }
      events.push({ type: 'tool_call_complete', index: 0 })
      return events
    }

    case 'web_search': {
      const events: NormalizedEvent[] = []
      if (item.query) {
        events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: item.query })
      }
      events.push({ type: 'tool_call_complete', index: 0 })
      return events
    }

    case 'todo_list': {
      const entries = Array.isArray(item.items) ? item.items : []
      const text = entries.map((e: any) => `${e.completed ? '[x]' : '[ ]'} ${e.text || ''}`).join('\n')
      if (text) {
        return [{ type: 'text_chunk', text: '\n' + text + '\n' }]
      }
      return []
    }

    case 'error':
      return [{
        type: 'error',
        message: item.message || 'Codex item error',
        isError: true,
      }]

    default:
      return []
  }
}
