import React, { useState, useMemo } from 'react'
import { useColors } from '../theme'

type DiffOp = { type: 'equal' | 'add' | 'remove'; line: string }

const MAX_BYTES = 512 * 1024
const MAX_LINES = 2000
const PREVIEW_LINES = 6

function toLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

function computeDiff(oldText: string, newText: string): DiffOp[] | null {
  if (oldText.length > MAX_BYTES || newText.length > MAX_BYTES) return null
  const a = toLines(oldText)
  const b = toLines(newText)
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null
  if (oldText === newText) return []

  const n = a.length
  const m = b.length
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'equal', line: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'remove', line: a[i] }); i++ }
    else { out.push({ type: 'add', line: b[j] }); j++ }
  }
  while (i < n) out.push({ type: 'remove', line: a[i++] })
  while (j < m) out.push({ type: 'add', line: b[j++] })
  return out
}

function parseDiffInput(toolName: string, toolInput: string): { old: string; new: string } | null {
  try {
    const parsed = JSON.parse(toolInput)
    if (toolName === 'Edit') {
      if (typeof parsed.old_string !== 'string' || typeof parsed.new_string !== 'string') return null
      return { old: parsed.old_string, new: parsed.new_string }
    }
    if (toolName === 'Write') {
      if (typeof parsed.content !== 'string') return null
      return { old: '', new: parsed.content }
    }
    return null
  } catch {
    return null
  }
}

export function DiffViewer({ toolName, toolInput }: { toolName: string; toolInput: string }) {
  const [showAll, setShowAll] = useState(false)
  const colors = useColors()

  const data = useMemo(() => parseDiffInput(toolName, toolInput), [toolName, toolInput])
  const ops = useMemo(() => (data && data.old !== data.new ? computeDiff(data.old, data.new) : null), [data])

  if (!data || !ops) return null

  const changedOps = ops.filter(o => o.type !== 'equal')
  if (changedOps.length === 0) return null

  const added = changedOps.filter(o => o.type === 'add').length
  const removed = changedOps.filter(o => o.type === 'remove').length
  const visible = showAll ? changedOps : changedOps.slice(0, PREVIEW_LINES)
  const hiddenCount = changedOps.length - visible.length

  return (
    <div
      className="mt-1.5 rounded overflow-hidden"
      style={{ border: `1px solid ${colors.toolBorder}` }}
    >
      <div
        className="flex items-center gap-2 px-2 py-[3px]"
        style={{ background: colors.surfaceHover }}
      >
        {added > 0 && (
          <span className="text-[10px] font-mono font-medium" style={{ color: colors.statusComplete }}>
            +{added}
          </span>
        )}
        {removed > 0 && (
          <span className="text-[10px] font-mono font-medium" style={{ color: colors.statusError }}>
            -{removed}
          </span>
        )}
        <span className="text-[10px]" style={{ color: colors.textTertiary }}>
          {added > 0 && removed > 0
            ? `${added} added, ${removed} removed`
            : added > 0
            ? `${added} line${added > 1 ? 's' : ''} added`
            : `${removed} line${removed > 1 ? 's' : ''} removed`}
        </span>
      </div>

      <div style={{ borderTop: `1px solid ${colors.toolBorder}` }}>
        {visible.map((op, idx) => (
          <div
            key={idx}
            className="font-mono text-[11px] leading-[1.6] flex items-start gap-1.5 px-2"
            style={{
              background: op.type === 'add'
                ? 'rgba(122, 172, 140, 0.13)'
                : 'rgba(196, 112, 96, 0.11)',
              whiteSpace: 'pre',
              minHeight: 18,
            }}
          >
            <span
              className="flex-shrink-0 font-bold select-none"
              style={{
                color: op.type === 'add' ? colors.statusComplete : colors.statusError,
                width: 10,
              }}
            >
              {op.type === 'add' ? '+' : '-'}
            </span>
            <span style={{ color: colors.textSecondary }}>
              {op.line}
            </span>
          </div>
        ))}

        {hiddenCount > 0 && (
          <div
            className="px-2 py-1 text-[10px] cursor-pointer text-center"
            style={{
              color: colors.textTertiary,
              background: colors.surfaceHover,
              borderTop: `1px solid ${colors.toolBorder}`,
            }}
            onClick={() => setShowAll(true)}
          >
            {hiddenCount} more line{hiddenCount > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
