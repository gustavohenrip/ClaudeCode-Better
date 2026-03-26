import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, CaretDown, Check, FolderOpen, Plus, X, ShieldCheck, Lightning, Brain, Database } from '@phosphor-icons/react'
import { useSessionStore, useActiveTab, AVAILABLE_MODELS, CODEX_MODELS, MODELS_SUPPORTING_MAX_EFFORT, getEffectiveModelId } from '../stores/sessionStore'
import { useCodexQuota } from '../hooks/useCodexQuota'
import { usePopoverLayer } from './PopoverLayer'
import { useColors, useThemeStore, type EffortLevel } from '../theme'


function ProviderToggle() {
  const provider = useSessionStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab?.provider || 'claude'
  })
  const switchProvider = useSessionStore((s) => s.switchProvider)
  const tab = useActiveTab()
  const colors = useColors()
  const isBusy = tab?.status === 'running' || tab?.status === 'connecting'
  const isCodex = provider === 'codex'
  const { quota } = useCodexQuota(isCodex)

  const [tooltip, setTooltip] = useState('')

  useEffect(() => {
    if (!isCodex) {
      setTooltip('Switch to Codex')
      return
    }
    if (!quota) {
      setTooltip('Loading Codex quota...')
      return
    }
    const pLeft = Math.max(0, 100 - Math.round(quota.primaryUsedPercent))
    const sLeft = Math.max(0, 100 - Math.round(quota.secondaryUsedPercent))
    setTooltip(`${quota.planType} | 5h: ${pLeft}% left | 7d: ${sLeft}% left`)
  }, [isCodex, quota])

  return (
    <motion.button
      onClick={() => { if (!isBusy) switchProvider() }}
      className="flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 transition-colors"
      style={{
        color: isCodex ? '#888888' : colors.accent,
        fontWeight: 600,
        cursor: isBusy ? 'not-allowed' : 'pointer',
        background: isCodex ? 'rgba(136,136,136,0.08)' : 'rgba(217,119,87,0.08)',
      }}
      title={tooltip}
      whileHover={{ scale: isBusy ? 1 : 1.05 }}
      whileTap={{ scale: isBusy ? 1 : 0.95 }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: isCodex ? '#888888' : colors.accent,
        display: 'inline-block',
      }} />
      {isCodex ? 'Codex' : 'Claude'}
    </motion.button>
  )
}

/* ─── Model Picker (inline — tightly coupled to StatusBar) ─── */

function ModelPicker() {
  const preferredClaudeModel = useSessionStore((s) => s.preferredModel)
  const preferredCodexModel = useSessionStore((s) => s.preferredCodexModel)
  const setPreferredModel = useSessionStore((s) => s.setPreferredModel)
  const tab = useActiveTab()
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ bottom: 0, left: 0 })

  const isBusy = tab?.status === 'running' || tab?.status === 'connecting'
  const isCodex = tab?.provider === 'codex'
  const models = isCodex ? CODEX_MODELS : AVAILABLE_MODELS

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleToggle = () => {
    if (isBusy) return
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  const preferredModel = isCodex ? preferredCodexModel : preferredClaudeModel

  const activeLabel = (() => {
    if (isCodex) {
      if (preferredCodexModel) {
        const m = CODEX_MODELS.find((m) => m.id === preferredCodexModel)
        if (m) return m.label
      }
      if (tab?.sessionModel) {
        const m = CODEX_MODELS.find((m) => m.id === tab.sessionModel)
        return m?.label || tab.sessionModel
      }
      return CODEX_MODELS[2].label
    }
    if (preferredClaudeModel) {
      const m = AVAILABLE_MODELS.find((m) => m.id === preferredClaudeModel)
      return m?.label || preferredClaudeModel
    }
    if (tab?.sessionModel) {
      const m = AVAILABLE_MODELS.find((m) => m.id === tab.sessionModel)
      return m?.label || tab.sessionModel
    }
    return AVAILABLE_MODELS[0].label
  })()

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors"
        style={{
          color: colors.textTertiary,
          cursor: isBusy ? 'not-allowed' : 'pointer',
        }}
        title={isBusy ? 'Stop the task to change model' : 'Switch model'}
      >
        {activeLabel}
        <CaretDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28, mass: 0.6 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            bottom: pos.bottom,
            left: pos.left,
            width: 192,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
          }}
        >
          <div className="py-1" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {models.map((m) => {
              const defaultId = isCodex ? CODEX_MODELS[2].id : AVAILABLE_MODELS[0].id
              const isSelected = preferredModel === m.id || (!preferredModel && m.id === defaultId)
              return (
                <button
                  key={m.id}
                  onClick={() => { setPreferredModel(m.id); setOpen(false) }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
                  style={{
                    color: isSelected ? colors.textPrimary : colors.textSecondary,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {m.label}
                  {isSelected && <Check size={12} style={{ color: colors.accent }} />}
                </button>
              )
            })}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}

/* ─── Permission Mode Picker (global — affects all tabs) ─── */

function PermissionModePicker() {
  const permissionMode = useSessionStore((s) => s.permissionMode)
  const setPermissionMode = useSessionStore((s) => s.setPermissionMode)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ bottom: 0, left: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleToggle = () => {
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  const isAuto = permissionMode === 'auto'

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors"
        style={{
          color: colors.textTertiary,
          cursor: 'pointer',
        }}
        title="Permission mode (global)"
      >
        <ShieldCheck size={11} weight={isAuto ? 'fill' : 'regular'} />
        {isAuto ? 'Auto' : 'Ask'}
        <CaretDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28, mass: 0.6 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            bottom: pos.bottom,
            left: pos.left,
            width: 180,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
          }}
        >
          <div className="py-1">
            <button
              onClick={() => { setPermissionMode('ask'); setOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
              style={{
                color: !isAuto ? colors.textPrimary : colors.textSecondary,
                fontWeight: !isAuto ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={12} />
                Ask
              </span>
              {!isAuto && <Check size={12} style={{ color: colors.accent }} />}
            </button>

            <div className="mx-2 my-0.5" style={{ height: 1, background: colors.popoverBorder }} />

            <button
              onClick={() => { setPermissionMode('auto'); setOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
              style={{
                color: isAuto ? colors.textPrimary : colors.textSecondary,
                fontWeight: isAuto ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={12} weight="fill" />
                Auto
              </span>
              {isAuto && <Check size={12} style={{ color: colors.accent }} />}
            </button>
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}

/* ─── Effort Badge ─── */

function EffortBadge() {
  const effort = useThemeStore((s) => s.effort)
  const setEffort = useThemeStore((s) => s.setEffort)
  const preferredModel = useSessionStore((s) => s.preferredModel)
  const supportsMax = MODELS_SUPPORTING_MAX_EFFORT.has(getEffectiveModelId(preferredModel))
  const colors = useColors()
  const [pop, setPop] = useState(false)
  const prevEffort = useRef(effort)

  useEffect(() => {
    if (effort !== prevEffort.current) {
      prevEffort.current = effort
      setPop(true)
      const t = setTimeout(() => setPop(false), 300)
      return () => clearTimeout(t)
    }
  }, [effort])

  const cycle: EffortLevel[] = supportsMax
    ? ['low', 'medium', 'high', 'max']
    : ['low', 'medium', 'high']

  const handleClick = () => {
    const idx = cycle.indexOf(effort)
    const next = idx === -1 ? 0 : (idx + 1) % cycle.length
    setEffort(cycle[next])
  }

  const isMax = effort === 'max'
  const isHighOrMax = effort === 'high' || isMax
  const effortColor = effort === 'medium' ? colors.textTertiary : isMax ? '#FF6B35' : colors.accent

  return (
    <motion.button
      onClick={handleClick}
      className={`flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors ${pop ? 'animate-badge-pop' : ''}`}
      style={{ color: colors.textTertiary }}
      title={`Effort: ${effort} — click to cycle`}
      whileTap={{ scale: 0.9 }}
    >
      {isMax ? (
        <span className="relative flex items-center justify-center" style={{ width: 10, height: 10 }}>
          <Lightning size={10} weight="fill" style={{ color: '#FF6B35', position: 'absolute', filter: 'drop-shadow(0 0 2px rgba(255, 107, 53, 0.6))' }} />
          <Lightning size={7} weight="fill" style={{ color: '#FFD700', position: 'absolute', left: 4, top: 0 }} />
        </span>
      ) : (
        <Lightning size={10} weight={isHighOrMax ? 'fill' : 'regular'} style={{ color: effortColor }} />
      )}
      <span style={{ color: effortColor, fontWeight: isMax ? 700 : undefined }}>
        {effort.charAt(0).toUpperCase() + effort.slice(1)}
      </span>
    </motion.button>
  )
}

/* ─── Thinking Badge ─── */

function ThinkingBadge() {
  const thinkingEnabled = useThemeStore((s) => s.thinkingEnabled)
  const setThinkingEnabled = useThemeStore((s) => s.setThinkingEnabled)
  const colors = useColors()
  const [pop, setPop] = useState(false)
  const prevVal = useRef(thinkingEnabled)

  useEffect(() => {
    if (thinkingEnabled !== prevVal.current) {
      prevVal.current = thinkingEnabled
      setPop(true)
      const t = setTimeout(() => setPop(false), 300)
      return () => clearTimeout(t)
    }
  }, [thinkingEnabled])

  return (
    <motion.button
      onClick={() => setThinkingEnabled(!thinkingEnabled)}
      className={`flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors ${pop ? 'animate-badge-pop' : ''}`}
      style={{ color: thinkingEnabled ? colors.accent : colors.textTertiary }}
      title={thinkingEnabled ? 'Thinking enabled — click to disable' : 'Thinking disabled — click to enable'}
      whileTap={{ scale: 0.9 }}
    >
      <Brain size={10} weight={thinkingEnabled ? 'fill' : 'regular'} />
      <span>Thinking</span>
    </motion.button>
  )
}

/* ─── Token Usage Badge ─── */

function formatTokenCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function TokenBadge() {
  const tab = useActiveTab()
  const colors = useColors()

  const usage = tab?.tokenUsage
  const input = usage?.input || 0
  const output = usage?.output || 0
  const totalTokens = input + output

  if (totalTokens === 0) {
    return (
      <div
        className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5"
        style={{ color: colors.textTertiary }}
        title="Tokens used this session"
      >
        <Database size={10} weight="regular" />
        <span>0 tokens</span>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5"
      style={{ color: colors.textSecondary }}
      title={`Input: ${formatTokenCount(input)} | Output: ${formatTokenCount(output)}\nCache read: ${formatTokenCount(usage?.cacheRead || 0)} | Cache write: ${formatTokenCount(usage?.cacheCreation || 0)}`}
    >
      <Database size={10} weight="regular" />
      <span>{formatTokenCount(totalTokens)} tokens</span>
    </div>
  )
}

/* ─── StatusBar ─── */

function ReasoningBadge() {
  const effort = useThemeStore((s) => s.effort)
  const setEffort = useThemeStore((s) => s.setEffort)
  const colors = useColors()
  const [pop, setPop] = useState(false)
  const prevEffort = useRef(effort)

  useEffect(() => {
    if (effort !== prevEffort.current) {
      prevEffort.current = effort
      setPop(true)
      const t = setTimeout(() => setPop(false), 300)
      return () => clearTimeout(t)
    }
  }, [effort])

  const cycle: EffortLevel[] = ['low', 'medium', 'high', 'max']

  const handleClick = () => {
    const idx = cycle.indexOf(effort)
    const next = idx === -1 ? 0 : (idx + 1) % cycle.length
    setEffort(cycle[next])
  }

  const labels: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', max: 'Extra High' }
  const label = labels[effort] || 'Medium'
  const isHigh = effort === 'high' || effort === 'max'
  const reasonColor = effort === 'low' ? colors.textTertiary : effort === 'medium' ? colors.textTertiary : colors.accent

  return (
    <motion.button
      onClick={handleClick}
      className={`flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors ${pop ? 'animate-badge-pop' : ''}`}
      style={{ color: colors.textTertiary }}
      title={`Reasoning: ${label} — click to cycle`}
      whileTap={{ scale: 0.9 }}
    >
      <Brain size={10} weight={isHigh ? 'fill' : 'regular'} style={{ color: reasonColor }} />
      <span style={{ color: reasonColor }}>
        {label}
      </span>
    </motion.button>
  )
}

function compactPath(fullPath: string): string {
  if (fullPath === '~') return '~'
  const parts = fullPath.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || fullPath
}

export function StatusBar() {
  const tab = useActiveTab()
  const addDirectory = useSessionStore((s) => s.addDirectory)
  const removeDirectory = useSessionStore((s) => s.removeDirectory)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [dirOpen, setDirOpen] = useState(false)
  const dirRef = useRef<HTMLButtonElement>(null)
  const dirPopRef = useRef<HTMLDivElement>(null)
  const [dirPos, setDirPos] = useState({ bottom: 0, left: 0 })

  // Close popover on outside click
  useEffect(() => {
    if (!dirOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (dirRef.current?.contains(target)) return
      if (dirPopRef.current?.contains(target)) return
      setDirOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dirOpen])

  if (!tab) return null

  const isRunning = tab.status === 'running' || tab.status === 'connecting'
  const isEmpty = tab.messages.length === 0
  const hasExtraDirs = tab.additionalDirs.length > 0

  const handleOpenInTerminal = () => {
    window.clui.openInTerminal(tab.claudeSessionId, tab.workingDirectory)
  }

  const handleDirClick = () => {
    if (isRunning) return
    if (!dirOpen && dirRef.current) {
      const rect = dirRef.current.getBoundingClientRect()
      setDirPos({
        bottom: window.innerHeight - rect.top + 6,
        left: rect.left,
      })
    }
    setDirOpen((o) => !o)
  }

  const handleAddDir = async () => {
    const dir = await window.clui.selectDirectory()
    if (dir) {
      addDirectory(dir)
    }
  }

  const dirTooltip = tab.hasChosenDirectory
    ? [tab.workingDirectory, ...tab.additionalDirs].join('\n')
    : 'Using home directory by default — click to choose a folder'

  return (
    <div
      className="flex items-center justify-between px-4 py-1.5"
      style={{ minHeight: 28 }}
    >
      {/* Left — directory + model picker */}
      <div className="flex items-center gap-2 text-[11px] min-w-0" style={{ color: colors.textTertiary }}>
        <ProviderToggle />

        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>

        <button
          ref={dirRef}
          onClick={handleDirClick}
          className="flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors flex-shrink-0"
          style={{
            color: colors.textTertiary,
            cursor: isRunning ? 'not-allowed' : 'pointer',
            maxWidth: 140,
          }}
          title={dirTooltip}
          disabled={isRunning}
        >
          <FolderOpen size={11} className="flex-shrink-0" />
          <span className="truncate">{tab.hasChosenDirectory ? compactPath(tab.workingDirectory) : '—'}</span>
          {hasExtraDirs && (
            <span style={{ color: colors.textTertiary, fontWeight: 600 }}>+{tab.additionalDirs.length}</span>
          )}
        </button>

        {/* Directory popover */}
        {popoverLayer && dirOpen && createPortal(
          <motion.div
            ref={dirPopRef}
            data-clui-ui
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className="rounded-xl"
            style={{
              position: 'fixed',
              bottom: dirPos.bottom,
              left: dirPos.left,
              width: 220,
              pointerEvents: 'auto',
              background: colors.popoverBg,
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: colors.popoverShadow,
              border: `1px solid ${colors.popoverBorder}`,
            }}
          >
            <div className="py-1.5 px-1">
              {/* Base directory */}
              <div className="px-2 py-1">
                <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: colors.textTertiary }}>
                  Base directory
                </div>
                <div className="text-[11px] truncate" style={{ color: tab.hasChosenDirectory ? colors.textSecondary : colors.textMuted }} title={tab.hasChosenDirectory ? tab.workingDirectory : 'No folder selected — defaults to home directory'}>
                  {tab.hasChosenDirectory ? tab.workingDirectory : 'None (defaults to ~)'}
                </div>
              </div>

              {/* Additional directories */}
              {hasExtraDirs && (
                <>
                  <div className="mx-2 my-1" style={{ height: 1, background: colors.popoverBorder }} />
                  <div className="px-2 py-1">
                    <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: colors.textTertiary }}>
                      Added directories
                    </div>
                    {tab.additionalDirs.map((dir) => (
                      <div key={dir} className="flex items-center justify-between py-0.5 group">
                        <span className="text-[11px] truncate mr-2" style={{ color: colors.textSecondary }} title={dir}>
                          {compactPath(dir)}
                        </span>
                        <button
                          onClick={() => removeDirectory(dir)}
                          className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                          style={{ color: colors.textTertiary }}
                          title="Remove directory"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="mx-2 my-1" style={{ height: 1, background: colors.popoverBorder }} />

              {/* Add directory button */}
              <button
                onClick={handleAddDir}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] transition-colors rounded-lg"
                style={{ color: colors.accent }}
              >
                <Plus size={10} />
                Add directory...
              </button>
            </div>
          </motion.div>,
          popoverLayer,
        )}

        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>

        <ModelPicker />

        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>

        <PermissionModePicker />

        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>

        {tab.provider === 'codex' ? (
          <ReasoningBadge />
        ) : (
          <>
            <EffortBadge />
            <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>
            <ThinkingBadge />
          </>
        )}

        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>

        <TokenBadge />
      </div>

      {/* Right — Open in CLI */}
      <div className="flex items-center flex-shrink-0">
        <motion.button
          onClick={handleOpenInTerminal}
          className="flex items-center justify-center w-5 h-5 rounded-full transition-colors"
          style={{ color: colors.textTertiary }}
          title="Open in Terminal"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.9 }}
        >
          <Terminal size={12} />
        </motion.button>
      </div>
    </div>
  )
}
