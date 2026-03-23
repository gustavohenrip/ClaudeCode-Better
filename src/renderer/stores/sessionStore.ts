import { create } from 'zustand'
import type { TabStatus, NormalizedEvent, EnrichedError, Message, TabState, Attachment, CatalogPlugin, PluginStatus } from '../../shared/types'
import { useThemeStore, type EffortLevel } from '../theme'
import notificationSrc from '../../../resources/notification.mp3'

// ─── Known models ───

export const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

export const MODELS_SUPPORTING_MAX_EFFORT = new Set(['claude-opus-4-6'])

export function getEffectiveModelId(preferredModel: string | null): string {
  return preferredModel ?? AVAILABLE_MODELS[0].id
}

const SESSION_SETTINGS_KEY = 'clui-session-settings'

function loadSessionSettings(): { preferredModel: string | null; permissionMode: 'ask' | 'auto' } {
  try {
    const raw = localStorage.getItem(SESSION_SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        preferredModel: typeof parsed.preferredModel === 'string' ? parsed.preferredModel : null,
        permissionMode: parsed.permissionMode === 'auto' ? 'auto' : 'ask',
      }
    }
  } catch {}
  return { preferredModel: null, permissionMode: 'ask' }
}

function saveSessionSettings(s: { preferredModel: string | null; permissionMode: 'ask' | 'auto' }): void {
  try { localStorage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

const savedSession = loadSessionSettings()

// ─── Store ───

interface StaticInfo {
  version: string
  email: string | null
  subscriptionType: string | null
  projectPath: string
  homePath: string
}

interface State {
  tabs: TabState[]
  activeTabId: string
  /** Global expand/collapse — user-controlled, not per-tab */
  isExpanded: boolean
  /** Global info fetched on startup (not per-session) */
  staticInfo: StaticInfo | null
  /** User's preferred model override (null = use default) */
  preferredModel: string | null
  /** Global permission mode: 'ask' shows cards, 'auto' auto-approves all tool calls */
  permissionMode: 'ask' | 'auto'

  // Marketplace state
  marketplaceOpen: boolean
  marketplaceCatalog: CatalogPlugin[]
  marketplaceLoading: boolean
  marketplaceError: string | null
  marketplaceInstalledNames: string[]
  marketplacePluginStates: Record<string, PluginStatus>
  marketplaceSearch: string
  marketplaceFilter: string

  // Actions
  initStaticInfo: () => Promise<void>
  setPreferredModel: (model: string | null) => void
  setPermissionMode: (mode: 'ask' | 'auto') => void
  createTab: () => Promise<string>
  selectTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  clearTab: () => void
  toggleExpanded: () => void
  toggleMarketplace: () => void
  closeMarketplace: () => void
  loadMarketplace: (forceRefresh?: boolean) => Promise<void>
  setMarketplaceSearch: (query: string) => void
  setMarketplaceFilter: (filter: string) => void
  installMarketplacePlugin: (plugin: CatalogPlugin) => Promise<void>
  uninstallMarketplacePlugin: (plugin: CatalogPlugin) => Promise<void>
  buildYourOwn: () => void
  resumeSession: (sessionId: string, title?: string, projectPath?: string, projectDir?: string) => Promise<string>
  addSystemMessage: (content: string) => void
  sendMessage: (prompt: string, projectPath?: string) => void
  respondPermission: (tabId: string, questionId: string, optionId: string) => void
  addDirectory: (dir: string) => void
  removeDirectory: (dir: string) => void
  setBaseDirectory: (dir: string) => void
  addAttachments: (attachments: Attachment[]) => void
  removeAttachment: (attachmentId: string) => void
  clearAttachments: () => void
  handleNormalizedEvent: (tabId: string, event: NormalizedEvent) => void
  handleStatusChange: (tabId: string, newStatus: string, oldStatus: string) => void
  handleError: (tabId: string, error: EnrichedError) => void
}

let msgCounter = 0
const nextMsgId = () => `msg-${++msgCounter}`

let _audioCtx: AudioContext | null = null
let _audioBuffer: AudioBuffer | null = null
let _audioInitPromise: Promise<void> | null = null

function _initAmplifiedAudio(): Promise<void> {
  if (_audioInitPromise) return _audioInitPromise
  _audioInitPromise = (async () => {
    try {
      _audioCtx = new AudioContext()
      const resp = await fetch(notificationSrc)
      const buf = await resp.arrayBuffer()
      _audioBuffer = await _audioCtx.decodeAudioData(buf)
    } catch {
      _audioCtx = null
      _audioBuffer = null
      _audioInitPromise = null
    }
  })()
  return _audioInitPromise
}

function _playAmplified(): void {
  try {
    if (!_audioCtx || !_audioBuffer) return
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})
    const source = _audioCtx.createBufferSource()
    source.buffer = _audioBuffer
    const gain = _audioCtx.createGain()
    gain.gain.value = 2.0
    source.connect(gain)
    gain.connect(_audioCtx.destination)
    source.start(0)
  } catch {}
}

async function playNotificationIfHidden(): Promise<void> {
  if (!useThemeStore.getState().soundEnabled) return
  try {
    const visible = await window.clui.isVisible()
    if (!visible) {
      await _initAmplifiedAudio()
      _playAmplified()
    }
  } catch {}
}

// ─── Window visibility flag (kept in sync by App.tsx) ───
let _windowVisible = true
export function setWindowVisibility(visible: boolean): void {
  _windowVisible = visible
}

function pathBasename(p: string): string {
  if (!p) return ''
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
}

function sendTaskNotification(tabId: string, tab: { title: string; workingDirectory: string }, durationMs: number, activeTabId: string): void {
  if (_windowVisible && tabId === activeTabId) return
  const dir = pathBasename(tab.workingDirectory)
  const hasTitle = tab.title && tab.title !== 'New Tab'
  const title = 'Claude Code'
  const secs = durationMs > 0 ? Math.round(durationMs / 1000) : 0
  const timeStr = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`
  let body = ''
  if (hasTitle) {
    body = secs > 0 ? `${tab.title}\nCompleted in ${timeStr}` : `${tab.title}\nTask completed`
  } else {
    body = secs > 0 ? `Task completed in ${timeStr}` : 'Task completed'
  }
  if (dir) body += ` | ${dir}`
  try { window.clui.notifyNative({ title, body }) } catch {}
}

function makeLocalTab(): TabState {
  return {
    id: crypto.randomUUID(),
    claudeSessionId: null,
    status: 'idle',
    activeRequestId: null,
    hasUnread: false,
    currentActivity: '',
    permissionQueue: [],
    permissionDenied: null,
    attachments: [],
    messages: [],
    title: 'New Tab',
    lastResult: null,
    sessionModel: null,
    sessionTools: [],
    sessionMcpServers: [],
    sessionSkills: [],
    sessionVersion: null,
    queuedPrompts: [],
    workingDirectory: '~',
    hasChosenDirectory: false,
    additionalDirs: [],
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  }
}

const initialTab = makeLocalTab()

export const useSessionStore = create<State>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  isExpanded: false,
  staticInfo: null,
  preferredModel: savedSession.preferredModel,
  permissionMode: savedSession.permissionMode,

  // Marketplace
  marketplaceOpen: false,
  marketplaceCatalog: [],
  marketplaceLoading: false,
  marketplaceError: null,
  marketplaceInstalledNames: [],
  marketplacePluginStates: {},
  marketplaceSearch: '',
  marketplaceFilter: 'All',

  initStaticInfo: async () => {
    try {
      const result = await window.clui.start()
      set({
        staticInfo: {
          version: result.version || 'unknown',
          email: result.auth?.email || null,
          subscriptionType: result.auth?.subscriptionType || null,
          projectPath: result.projectPath || '~',
          homePath: result.homePath || '~',
        },
      })
    } catch {}
  },

  setPreferredModel: (model) => {
    set({ preferredModel: model })
    saveSessionSettings({ preferredModel: model, permissionMode: get().permissionMode })
    const supportsMax = MODELS_SUPPORTING_MAX_EFFORT.has(getEffectiveModelId(model))
    if (!supportsMax && useThemeStore.getState().effort === 'max') {
      useThemeStore.getState().setEffort('high')
    }
  },

  setPermissionMode: (mode) => {
    set({ permissionMode: mode })
    window.clui.setPermissionMode(mode)
    saveSessionSettings({ preferredModel: get().preferredModel, permissionMode: mode })
  },

  createTab: async () => {
    const homeDir = get().staticInfo?.homePath || '~'
    const { tabId } = await window.clui.createTab()
    const tab: TabState = {
      ...makeLocalTab(),
      id: tabId,
      workingDirectory: homeDir,
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }))
    const rules = useThemeStore.getState().globalRules?.trim()
    window.clui.initSession(tabId, rules || undefined)
    return tabId
  },

  selectTab: (tabId) => {
    const s = get()
    if (tabId === s.activeTabId) {
      // Clicking the already-active tab: toggle global expand/collapse
      const willExpand = !s.isExpanded
      set((prev) => ({
        isExpanded: willExpand,
        marketplaceOpen: false,
        // Expanding = reading: clear unread flag
        tabs: willExpand
          ? prev.tabs.map((t) => t.id === tabId ? { ...t, hasUnread: false } : t)
          : prev.tabs,
      }))
    } else {
      // Switching to a different tab: mark as read
      set((prev) => ({
        activeTabId: tabId,
        marketplaceOpen: false,
        tabs: prev.tabs.map((t) =>
          t.id === tabId ? { ...t, hasUnread: false } : t
        ),
      }))
    }
  },

  toggleExpanded: () => {
    const { activeTabId, isExpanded } = get()
    const willExpand = !isExpanded
    set((s) => ({
      isExpanded: willExpand,
      marketplaceOpen: false,
      // Expanding = reading: clear unread flag for the active tab
      tabs: willExpand
        ? s.tabs.map((t) => t.id === activeTabId ? { ...t, hasUnread: false } : t)
        : s.tabs,
    }))
  },

  toggleMarketplace: () => {
    const s = get()
    if (s.marketplaceOpen) {
      set({ marketplaceOpen: false })
    } else {
      set({ isExpanded: false, marketplaceOpen: true })
      get().loadMarketplace()
    }
  },

  closeMarketplace: () => {
    set({ marketplaceOpen: false })
  },

  loadMarketplace: async (forceRefresh) => {
    set({ marketplaceLoading: true, marketplaceError: null })
    try {
      const [catalog, installed] = await Promise.all([
        window.clui.fetchMarketplace(forceRefresh),
        window.clui.listInstalledPlugins(),
      ])
      if (catalog.error && catalog.plugins.length === 0) {
        set({ marketplaceError: catalog.error, marketplaceLoading: false })
        return
      }
      const installedSet = new Set(installed.map((n) => n.toLowerCase()))
      const pluginStates: Record<string, PluginStatus> = {}
      for (const p of catalog.plugins) {
        // For SKILL.md skills: match individual name against ~/.claude/skills/ dirs
        // For CLI plugins: match installName or "installName@marketplace" against installed_plugins.json
        const candidates = p.isSkillMd
          ? [p.installName]
          : [p.installName, `${p.installName}@${p.marketplace}`]
        const isInstalled = candidates.some((c) => installedSet.has(c.toLowerCase()))
        pluginStates[p.id] = isInstalled ? 'installed' : 'not_installed'
      }
      set({
        marketplaceCatalog: catalog.plugins,
        marketplaceInstalledNames: installed,
        marketplacePluginStates: pluginStates,
        marketplaceLoading: false,
      })
    } catch (err: unknown) {
      set({
        marketplaceError: err instanceof Error ? err.message : String(err),
        marketplaceLoading: false,
      })
    }
  },

  setMarketplaceSearch: (query) => {
    set({ marketplaceSearch: query })
  },

  setMarketplaceFilter: (filter) => {
    set({ marketplaceFilter: filter })
  },

  installMarketplacePlugin: async (plugin) => {
    set((s) => ({
      marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'installing' },
    }))
    const result = await window.clui.installPlugin(plugin.repo, plugin.installName, plugin.marketplace, plugin.sourcePath, plugin.isSkillMd)
    if (result.ok) {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'installed' as PluginStatus },
        marketplaceInstalledNames: [...s.marketplaceInstalledNames, plugin.installName],
      }))
    } else {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'failed' },
      }))
    }
  },

  uninstallMarketplacePlugin: async (plugin) => {
    const result = await window.clui.uninstallPlugin(plugin.installName)
    if (result.ok) {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'not_installed' as PluginStatus },
        marketplaceInstalledNames: s.marketplaceInstalledNames.filter((n) => n !== plugin.installName),
      }))
    }
  },

  buildYourOwn: () => {
    set({ marketplaceOpen: false, isExpanded: true })
    // Small delay to let the UI transition
    setTimeout(() => {
      get().sendMessage('Help me create a new Claude Code skill')
    }, 100)
  },

  closeTab: (tabId) => {
    window.clui.closeTab(tabId).catch(() => {})

    const s = get()
    const remaining = s.tabs.filter((t) => t.id !== tabId)

    if (s.activeTabId === tabId) {
      if (remaining.length === 0) {
        const newTab = makeLocalTab()
        const localId = newTab.id
        set({ tabs: [newTab], activeTabId: localId })
        window.clui.createTab().then(({ tabId }) => {
          const rules = useThemeStore.getState().globalRules?.trim()
          set((s) => ({
            tabs: s.tabs.map((t) => t.id === localId ? { ...t, id: tabId } : t),
            activeTabId: s.activeTabId === localId ? tabId : s.activeTabId,
          }))
          window.clui.initSession(tabId, rules || undefined)
        }).catch(() => {})
        return
      }
      const closedIndex = s.tabs.findIndex((t) => t.id === tabId)
      const newActive = remaining[Math.min(closedIndex, remaining.length - 1)]
      set({ tabs: remaining, activeTabId: newActive.id })
    } else {
      set({ tabs: remaining })
    }
  },

  clearTab: () => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, messages: [], lastResult: null, currentActivity: '', permissionQueue: [], permissionDenied: null, queuedPrompts: [] }
          : t
      ),
    }))
  },

  resumeSession: async (sessionId, title, projectPath, projectDir) => {
    const resolvedDir = projectPath
      ? null
      : projectDir
        ? await window.clui.resolveProjectDir(projectDir).catch(() => null) || null
        : await window.clui.resolveSessionDir(sessionId).catch(() => null) || null
    const defaultDir = projectPath || resolvedDir || get().staticInfo?.homePath || '~'
    const { tabId } = await window.clui.createTab()

    const history = await window.clui.loadSession(sessionId, projectPath, projectDir).catch(() => [])
    const messages: Message[] = history.map((m) => ({
      id: nextMsgId(),
      role: m.role as Message['role'],
      content: m.content,
      toolName: m.toolName,
      toolInput: m.toolInput,
      toolStatus: m.toolName ? 'completed' as const : undefined,
      timestamp: m.timestamp,
    }))

    const tab: TabState = {
      ...makeLocalTab(),
      id: tabId,
      claudeSessionId: sessionId,
      title: title || 'Resumed Session',
      workingDirectory: defaultDir,
      hasChosenDirectory: !!(projectPath || resolvedDir),
      messages,
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      isExpanded: true,
    }))
    return tabId
  },

  addSystemMessage: (content) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { id: nextMsgId(), role: 'system' as const, content, timestamp: Date.now() },
              ],
            }
          : t
      ),
    }))
  },

  // ─── Permission response ───

  respondPermission: (tabId, questionId, optionId) => {
    window.clui.respondPermission(tabId, questionId, optionId)
      .then((success: boolean) => {
        if (!success) return
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t
            const remaining = t.permissionQueue.filter((p) => p.questionId !== questionId)
            return {
              ...t,
              permissionQueue: remaining,
              currentActivity: remaining.length > 0
                ? `Waiting for permission: ${remaining[0].toolTitle}`
                : 'Working...',
            }
          }),
        }))
      })
      .catch(() => {})
  },

  // ─── Directory management ───

  addDirectory: (dir) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              additionalDirs: t.additionalDirs.includes(dir)
                ? t.additionalDirs
                : [...t.additionalDirs, dir],
            }
          : t
      ),
    }))
  },

  removeDirectory: (dir) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, additionalDirs: t.additionalDirs.filter((d) => d !== dir) }
          : t
      ),
    }))
  },

  setBaseDirectory: (dir) => {
    const { activeTabId } = get()
    window.clui.resetTabSession(activeTabId)
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              workingDirectory: dir,
              hasChosenDirectory: true,
              claudeSessionId: null,
              additionalDirs: [],
              tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
            }
          : t
      ),
    }))
  },

  // ─── Attachment management ───

  addAttachments: (attachments) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, attachments: [...t.attachments, ...attachments] }
          : t
      ),
    }))
  },

  removeAttachment: (attachmentId) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) }
          : t
      ),
    }))
  },

  clearAttachments: () => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId ? { ...t, attachments: [] } : t
      ),
    }))
  },

  // ─── Send ───

  sendMessage: (prompt, projectPath) => {
    const { activeTabId, tabs, staticInfo } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    // Use explicitly chosen directory, otherwise fall back to user home
    const resolvedPath = projectPath || (tab?.hasChosenDirectory ? tab.workingDirectory : (staticInfo?.homePath || tab?.workingDirectory || '~'))
    if (!tab) return

    if (tab.status === 'connecting') return

    const isBusy = tab.status === 'running'
    const requestId = crypto.randomUUID()

    let fullPrompt = prompt
    if (tab.attachments.length > 0) {
      const attachmentCtx = tab.attachments
        .map((a) => `[Attached ${a.type}: ${a.path}]`)
        .join('\n')
      fullPrompt = `${attachmentCtx}\n\n${prompt}`
    }

    const title = tab.messages.length === 0
      ? (prompt.length > 30 ? prompt.substring(0, 27) + '...' : prompt)
      : tab.title

    if (isBusy) {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== activeTabId) return t
          return {
            ...t,
            title,
            attachments: [],
            queuedPrompts: [...t.queuedPrompts, prompt],
            messages: [
              ...t.messages,
              { id: nextMsgId(), role: 'user' as const, content: prompt, timestamp: Date.now(), attachments: t.attachments.length > 0 ? [...t.attachments] : undefined },
            ],
          }
        }),
      }))
    } else {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== activeTabId) return t
          const withEffectiveBase = t.hasChosenDirectory
            ? t
            : { ...t, hasChosenDirectory: true, workingDirectory: resolvedPath }
          return {
            ...withEffectiveBase,
            status: 'connecting' as TabStatus,
            activeRequestId: requestId,
            currentActivity: prompt.trim() === '/compact' ? 'Compacting...' : (tab.claudeSessionId ? 'Thinking...' : 'Starting...'),
            title,
            attachments: [],
            queuedPrompts: [],
            messages: [
              ...withEffectiveBase.messages,
              { id: nextMsgId(), role: 'user' as const, content: prompt, timestamp: Date.now(), attachments: t.attachments.length > 0 ? [...t.attachments] : undefined },
            ],
          }
        }),
      }))
    }

    const { preferredModel } = get()
    const { effort, thinkingEnabled, globalRules } = useThemeStore.getState()
    const effectiveEffort: EffortLevel = (effort === 'max' && !MODELS_SUPPORTING_MAX_EFFORT.has(getEffectiveModelId(preferredModel)))
      ? 'high'
      : effort
    const runOptions = {
      prompt: fullPrompt,
      projectPath: resolvedPath,
      sessionId: tab.claudeSessionId || undefined,
      model: preferredModel || undefined,
      addDirs: tab.additionalDirs.length > 0 ? tab.additionalDirs : undefined,
      effort: effectiveEffort !== 'medium' ? effectiveEffort : undefined,
      thinking: (thinkingEnabled ? 'adaptive' : 'disabled') as 'adaptive' | 'disabled',
      systemPrompt: globalRules.trim() || undefined,
    }

    window.clui.prompt(activeTabId, requestId, runOptions).catch((err: Error) => {
      get().handleError(activeTabId, {
        message: err.message,
        stderrTail: [],
        exitCode: null,
        elapsedMs: 0,
        toolCallCount: 0,
      })
    })
  },

  // ─── Event handlers ───

  handleNormalizedEvent: (tabId, event) => {
    set((s) => {
      const { activeTabId } = s
      const tabs = s.tabs.map((tab) => {
        if (tab.id !== tabId) return tab
        const updated = { ...tab }

        switch (event.type) {
          case 'session_init':
            updated.claudeSessionId = event.sessionId
            updated.sessionModel = event.model
            updated.sessionTools = event.tools
            updated.sessionMcpServers = event.mcpServers
            updated.sessionSkills = event.skills
            updated.sessionVersion = event.version
            // Don't change status/activity for warmup inits — they're invisible
            if (!event.isWarmup) {
              updated.status = 'running'
              updated.currentActivity = 'Thinking...'
              // Move the first queued prompt into the timeline (it's now being processed)
              if (updated.queuedPrompts.length > 0) {
                const [nextPrompt, ...rest] = updated.queuedPrompts
                updated.queuedPrompts = rest
                updated.messages = [
                  ...updated.messages,
                  { id: nextMsgId(), role: 'user' as const, content: nextPrompt, timestamp: Date.now() },
                ]
              }
            }
            break

          case 'thinking_chunk': {
            const lastThink = updated.messages[updated.messages.length - 1]
            if (lastThink?.role === 'thinking') {
              updated.messages = [
                ...updated.messages.slice(0, -1),
                { ...lastThink, content: lastThink.content + event.thinking },
              ]
            } else {
              updated.messages = [
                ...updated.messages,
                { id: nextMsgId(), role: 'thinking', content: event.thinking, timestamp: Date.now() },
              ]
            }
            break
          }

          case 'text_chunk': {
            updated.currentActivity = 'Writing...'
            const lastMsg = updated.messages[updated.messages.length - 1]
            if (lastMsg?.role === 'assistant' && !lastMsg.toolName) {
              updated.messages = [
                ...updated.messages.slice(0, -1),
                { ...lastMsg, content: lastMsg.content + event.text },
              ]
            } else {
              updated.messages = [
                ...updated.messages,
                { id: nextMsgId(), role: 'assistant', content: event.text, timestamp: Date.now() },
              ]
            }
            break
          }

          case 'tool_call':
            updated.currentActivity = `Running ${event.toolName}...`
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'tool',
                content: '',
                toolName: event.toolName,
                toolInput: '',
                toolStatus: 'running',
                timestamp: Date.now(),
              },
            ]
            break

          case 'tool_call_update': {
            const msgs = [...updated.messages]
            const lastTool = [...msgs].reverse().find((m) => m.role === 'tool' && m.toolStatus === 'running')
            if (lastTool) {
              lastTool.toolInput = (lastTool.toolInput || '') + event.partialInput
            }
            updated.messages = msgs
            break
          }

          case 'tool_call_complete': {
            const msgs2 = [...updated.messages]
            const runningTool = [...msgs2].reverse().find((m) => m.role === 'tool' && m.toolStatus === 'running')
            if (runningTool) {
              runningTool.toolStatus = 'completed'
            }
            updated.messages = msgs2
            break
          }

          case 'task_update': {
            if (event.message?.usage) {
              const u = event.message.usage
              updated.tokenUsage = {
                input: (updated.tokenUsage?.input || 0) + (u.input_tokens || 0),
                output: (updated.tokenUsage?.output || 0) + (u.output_tokens || 0),
                cacheRead: (updated.tokenUsage?.cacheRead || 0) + (u.cache_read_input_tokens || 0),
                cacheCreation: (updated.tokenUsage?.cacheCreation || 0) + (u.cache_creation_input_tokens || 0),
              }
            }
            if (event.message?.content) {
              const lastUserIdx = (() => {
                for (let i = updated.messages.length - 1; i >= 0; i--) {
                  if (updated.messages[i].role === 'user') return i
                }
                return -1
              })()
              const hasStreamedText = updated.messages
                .slice(lastUserIdx + 1)
                .some((m) => m.role === 'assistant' && !m.toolName)

              if (!hasStreamedText) {
                const textContent = event.message.content
                  .filter((b) => b.type === 'text' && b.text)
                  .map((b) => b.text!)
                  .join('')
                if (textContent) {
                  updated.messages = [
                    ...updated.messages,
                    { id: nextMsgId(), role: 'assistant' as const, content: textContent, timestamp: Date.now() },
                  ]
                }
              }

              // ── Tool card deduplication (unchanged) ──
              for (const block of event.message.content) {
                if (block.type === 'tool_use' && block.name) {
                  const exists = updated.messages.find(
                    (m) => m.role === 'tool' && m.toolName === block.name && !m.content
                  )
                  if (!exists) {
                    updated.messages = [
                      ...updated.messages,
                      {
                        id: nextMsgId(),
                        role: 'tool',
                        content: '',
                        toolName: block.name,
                        toolInput: JSON.stringify(block.input, null, 2),
                        toolStatus: 'completed',
                        timestamp: Date.now(),
                      },
                    ]
                  }
                }
              }
            }
            break
          }

          case 'task_complete':
            updated.status = 'completed'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.lastResult = {
              totalCostUsd: event.costUsd,
              durationMs: event.durationMs,
              numTurns: event.numTurns,
              usage: event.usage,
              sessionId: event.sessionId,
            }
            if (event.usage) {
              updated.tokenUsage = {
                input: (updated.tokenUsage?.input || 0) + (event.usage.input_tokens || 0),
                output: (updated.tokenUsage?.output || 0) + (event.usage.output_tokens || 0),
                cacheRead: (updated.tokenUsage?.cacheRead || 0) + (event.usage.cache_read_input_tokens || 0),
                cacheCreation: (updated.tokenUsage?.cacheCreation || 0) + (event.usage.cache_creation_input_tokens || 0),
              }
            }
            // ── Final text fallback ──
            // If neither text_chunks nor task_update text produced an assistant message,
            // use event.result (the CLI's assembled final output) as last resort.
            if (event.result) {
              const lastUserIdx2 = (() => {
                for (let i = updated.messages.length - 1; i >= 0; i--) {
                  if (updated.messages[i].role === 'user') return i
                }
                return -1
              })()
              const hasAnyText = updated.messages
                .slice(lastUserIdx2 + 1)
                .some((m) => m.role === 'assistant' && !m.toolName)
              if (!hasAnyText) {
                updated.messages = [
                  ...updated.messages,
                  { id: nextMsgId(), role: 'assistant' as const, content: event.result, timestamp: Date.now() },
                ]
              }
            }
            // Mark as unread unless the user is actively viewing this tab
            // (active tab with card expanded). A collapsed active tab still
            // counts as "unread" — the user hasn't seen the response yet.
            if (tabId !== activeTabId || !s.isExpanded) {
              updated.hasUnread = true
            }
            if (event.permissionDenials && event.permissionDenials.length > 0 && s.permissionMode !== 'auto') {
              updated.permissionDenied = { tools: event.permissionDenials }
            } else {
              updated.permissionDenied = null
            }
            // Play notification sound if window is hidden
            playNotificationIfHidden()
            // Show system notification (hidden window OR background tab)
            sendTaskNotification(tabId, updated, event.durationMs || 0, activeTabId)
            break

          case 'error':
            updated.status = 'failed'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.permissionDenied = null
            updated.messages = [
              ...updated.messages,
              { id: nextMsgId(), role: 'system', content: `Error: ${event.message}`, timestamp: Date.now() },
            ]
            break

          case 'session_dead':
            updated.status = 'dead'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.permissionDenied = null
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'system',
                content: `Session ended unexpectedly (exit ${event.exitCode})`,
                timestamp: Date.now(),
              },
            ]
            break

          case 'permission_request': {
            const newReq: import('../../shared/types').PermissionRequest = {
              questionId: event.questionId,
              toolTitle: event.toolName,
              toolDescription: event.toolDescription,
              toolInput: event.toolInput,
              options: event.options.map((o) => ({
                optionId: o.id,
                kind: o.kind,
                label: o.label,
              })),
            }
            updated.permissionQueue = [...updated.permissionQueue, newReq]
            updated.currentActivity = `Waiting for permission: ${event.toolName}`
            break
          }

          case 'rate_limit':
            if (event.status !== 'allowed') {
              updated.messages = [
                ...updated.messages,
                {
                  id: nextMsgId(),
                  role: 'system',
                  content: `Rate limited (${event.rateLimitType}). Resets at ${new Date(event.resetsAt).toLocaleTimeString()}.`,
                  timestamp: Date.now(),
                },
              ]
            }
            break

          case 'compact_complete': {
            const freed = event.clearedTokens >= 1000
              ? `${Math.round(event.clearedTokens / 1000)}k`
              : String(event.clearedTokens)
            updated.currentActivity = 'Thinking...'
            updated.messages = [
              ...updated.messages,
              { id: nextMsgId(), role: 'system' as const, content: `Context compacted — ${freed} tokens freed`, timestamp: Date.now() },
            ]
            break
          }
        }

        return updated
      })

      return { tabs }
    })
  },

  handleStatusChange: (tabId, newStatus) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              status: newStatus as TabStatus,
              ...(newStatus === 'idle' ? { currentActivity: '', permissionQueue: [] as import('../../shared/types').PermissionRequest[], permissionDenied: null } : {}),
            }
          : t
      ),
    }))
  },

  handleError: (tabId, error) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t

        // Deduplicate: skip if the last message is already an error for this failure
        const lastMsg = t.messages[t.messages.length - 1]
        const alreadyHasError = lastMsg?.role === 'system' && lastMsg.content.startsWith('Error:')

        return {
          ...t,
          status: 'failed' as TabStatus,
          activeRequestId: null,
          currentActivity: '',
          permissionQueue: [],
          messages: alreadyHasError
            ? t.messages
            : [
                ...t.messages,
                {
                  id: nextMsgId(),
                  role: 'system' as const,
                  content: `Error: ${error.message}${error.stderrTail.length > 0 ? '\n\n' + error.stderrTail.slice(-5).join('\n') : ''}`,
                  timestamp: Date.now(),
                },
              ],
        }
      }),
    }))
  },
}))

export function useActiveTab() {
  return useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
}
