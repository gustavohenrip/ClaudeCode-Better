import { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Tray, Menu, nativeImage, nativeTheme, shell, systemPreferences, clipboard, Notification } from 'electron'
import { join, resolve, dirname } from 'path'
import { existsSync, readdirSync, statSync, createReadStream, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { ControlPlane } from './claude/control-plane'
import { ensureSkills, type SkillStatus } from './skills/installer'
import { fetchCatalog, listInstalled, installPlugin, uninstallPlugin } from './marketplace/catalog'
import { log as _log, LOG_FILE, flushLogs } from './logger'
import { getCliEnv } from './cli-env'
import { IPC } from '../shared/types'
import type { RunOptions, NormalizedEvent, EnrichedError } from '../shared/types'

const DEBUG_MODE = process.env.CLUI_DEBUG === '1'
const SPACES_DEBUG = DEBUG_MODE || process.env.CLUI_SPACES_DEBUG === '1'

function log(msg: string): void {
  _log('main', msg)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenshotCounter = 0
let toggleSequence = 0
let pendingHideTimeout: ReturnType<typeof setTimeout> | null = null

// Feature flag: enable PTY interactive permissions transport
const INTERACTIVE_PTY = process.env.CLUI_INTERACTIVE_PERMISSIONS_PTY === '1'

const controlPlane = new ControlPlane(INTERACTIVE_PTY)

// Keep native width fixed to avoid renderer animation vs setBounds race.
// The UI itself still launches in compact mode; extra width is transparent/click-through.
const BAR_WIDTH = 1040
const PILL_HEIGHT = 720  // Fixed native window height — extra room for expanded UI + shadow buffers
const PILL_BOTTOM_MARGIN = 24

const execFileAsync = promisify(execFile)
const START_CACHE_FILE = join(homedir(), '.claude', 'clui-start-cache.json')
const START_TTL_MS = 5 * 60 * 1000
const START_SOFT_WAIT_MS = 120

type StartCache = { version: string; auth: Record<string, unknown>; mcpServers: string[]; updatedAt: number }
let startCache: StartCache | null = null
let startRefreshInFlight: Promise<void> | null = null

function loadStartCache(): StartCache | null {
  try {
    if (!existsSync(START_CACHE_FILE)) return null
    const parsed = JSON.parse(readFileSync(START_CACHE_FILE, 'utf-8')) as StartCache
    return (parsed && typeof parsed.updatedAt === 'number') ? parsed : null
  } catch { return null }
}

function saveStartCache(c: StartCache): void {
  try { mkdirSync(dirname(START_CACHE_FILE), { recursive: true }); writeFileSync(START_CACHE_FILE, JSON.stringify(c), 'utf-8') } catch {}
}

async function runClaudeCmd(args: string[], timeout: number): Promise<string> {
  const { stdout } = await execFileAsync('claude', args, { encoding: 'utf-8', timeout, env: getCliEnv(), windowsHide: true, maxBuffer: 1024 * 1024 })
  return (stdout || '').trim()
}

async function refreshStartCache(): Promise<void> {
  const [versionR, authR] = await Promise.allSettled([
    runClaudeCmd(['-v'], 1200),
    runClaudeCmd(['auth', 'status'], 1500),
  ])
  const next: StartCache = {
    version: versionR.status === 'fulfilled' ? versionR.value : (startCache?.version ?? 'unknown'),
    auth: authR.status === 'fulfilled' ? (() => { try { return JSON.parse(authR.value) } catch { return {} } })() : (startCache?.auth ?? {}),
    mcpServers: startCache?.mcpServers ?? [],
    updatedAt: Date.now(),
  }
  startCache = next
  saveStartCache(next)
  runClaudeCmd(['mcp', 'list'], 6000).then((raw) => {
    const servers = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    startCache = { ...next, mcpServers: servers, updatedAt: Date.now() }
    saveStartCache(startCache)
  }).catch(() => {})
}

startCache = loadStartCache()

// ─── Broadcast to renderer ───

function broadcast(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function snapshotWindowState(reason: string): void {
  if (!SPACES_DEBUG) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    log(`[spaces] ${reason} window=none`)
    return
  }

  const b = mainWindow.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const visibleOnAll = mainWindow.isVisibleOnAllWorkspaces()
  const wcFocused = mainWindow.webContents.isFocused()

  log(
    `[spaces] ${reason} ` +
    `vis=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} wcFocused=${wcFocused} ` +
    `alwaysOnTop=${mainWindow.isAlwaysOnTop()} allWs=${visibleOnAll} ` +
    `bounds=(${b.x},${b.y},${b.width}x${b.height}) ` +
    `cursor=(${cursor.x},${cursor.y}) display=${display.id} ` +
    `workArea=(${display.workArea.x},${display.workArea.y},${display.workArea.width}x${display.workArea.height})`
  )
}

function scheduleToggleSnapshots(toggleId: number, phase: 'show' | 'hide'): void {
  if (!SPACES_DEBUG) return
  const probes = [0, 100, 400, 1200]
  for (const delay of probes) {
    setTimeout(() => {
      snapshotWindowState(`toggle#${toggleId} ${phase} +${delay}ms`)
    }, delay)
  }
}


// ─── Wire ControlPlane events → renderer ───

controlPlane.on('event', (tabId: string, event: NormalizedEvent) => {
  broadcast('clui:normalized-event', tabId, event)
})

controlPlane.on('tab-status-change', (tabId: string, newStatus: string, oldStatus: string) => {
  broadcast('clui:tab-status-change', tabId, newStatus, oldStatus)
})

controlPlane.on('error', (tabId: string, error: EnrichedError) => {
  broadcast('clui:enriched-error', tabId, error)
})

// ─── Window Creation ───

function createWindow(): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width: screenWidth, height: screenHeight } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea

  const actualHeight = Math.min(PILL_HEIGHT, screenHeight - PILL_BOTTOM_MARGIN)
  const x = dx + Math.round((screenWidth - BAR_WIDTH) / 2)
  const y = dy + screenHeight - actualHeight - PILL_BOTTOM_MARGIN

  mainWindow = new BrowserWindow({
    width: BAR_WIDTH,
    height: actualHeight,
    x,
    y,
    ...(process.platform === 'darwin' ? { type: 'panel' as const, titleBarStyle: 'hidden' as const } : {}),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    title: '',
    autoHideMenuBar: true,
    roundedCorners: false,
    icon: process.platform === 'win32'
      ? join(__dirname, '../../resources/icon.png')
      : join(__dirname, '../../resources/icon.icns'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.platform === 'win32') {
    Menu.setApplicationMenu(null)
    mainWindow.removeMenu()
    mainWindow.setMenuBarVisibility(false)
    mainWindow.setTitle('')
    mainWindow.on('page-title-updated', (e) => e.preventDefault())
  }

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.setAlwaysOnTop(true, 'screen-saver')

  mainWindow.once('ready-to-show', () => {
    showWindow('ready-to-show')
    mainWindow?.setIgnoreMouseEvents(true, { forward: true })
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow?.webContents.on('console-message', (_e, level, message) => {
        if (level === 3 && (message.includes('Autofill.') || message.includes('is not valid JSON'))) {
          _e.preventDefault()
        }
      })
    }
  })

  let forceQuit = false
  app.on('before-quit', () => { forceQuit = true })
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(source = 'unknown'): void {
  if (!mainWindow) return
  if (pendingHideTimeout) {
    clearTimeout(pendingHideTimeout)
    pendingHideTimeout = null
  }
  const toggleId = ++toggleSequence

  // Position on the display where the cursor currently is (not always primary)
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width: sw, height: sh } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea
  const actualH = Math.min(PILL_HEIGHT, sh - PILL_BOTTOM_MARGIN)
  mainWindow.setBounds({
    x: dx + Math.round((sw - BAR_WIDTH) / 2),
    y: dy + sh - actualH - PILL_BOTTOM_MARGIN,
    width: BAR_WIDTH,
    height: actualH,
  })

  // Always re-assert space membership — the flag can be lost after hide/show cycles
  // and must be set before show() so the window joins the active Space, not its
  // last-known Space.
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (SPACES_DEBUG) {
    log(`[spaces] showWindow#${toggleId} source=${source} move-to-display id=${display.id}`)
    snapshotWindowState(`showWindow#${toggleId} pre-show`)
  }
  // As an accessory app (app.dock.hide), show() + focus gives keyboard
  // without deactivating the active app — hover preserved everywhere.
  mainWindow.show()
  if (process.platform === 'win32') mainWindow.focus()
  mainWindow.webContents.focus()
  broadcast(IPC.WINDOW_SHOWN)
  if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'show')
}

function toggleWindow(source = 'unknown'): void {
  if (!mainWindow) return
  const toggleId = ++toggleSequence
  if (SPACES_DEBUG) {
    log(`[spaces] toggle#${toggleId} source=${source} start`)
    snapshotWindowState(`toggle#${toggleId} pre`)
  }

  if (mainWindow.isVisible()) {
    if (pendingHideTimeout) { clearTimeout(pendingHideTimeout); pendingHideTimeout = null }
    broadcast(IPC.WINDOW_WILL_HIDE)
    pendingHideTimeout = setTimeout(() => {
      mainWindow?.hide()
      pendingHideTimeout = null
      if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'hide')
    }, 185)
  } else {
    showWindow(source)
  }
}

// ─── Resize ───
// Fixed-height mode: ignore renderer resize events to prevent jank.
// The native window stays at PILL_HEIGHT; all expand/collapse happens inside the renderer.

ipcMain.on(IPC.RESIZE_HEIGHT, () => {
  // No-op — fixed height window, no dynamic resize
})

ipcMain.on(IPC.SET_WINDOW_WIDTH, () => {
  // No-op — native width is fixed to keep expand/collapse animation smooth.
})

ipcMain.handle(IPC.ANIMATE_HEIGHT, () => {
  // No-op — kept for API compat, animation handled purely in renderer
})

ipcMain.on(IPC.HIDE_WINDOW, () => {
  if (!mainWindow) return
  if (pendingHideTimeout) { clearTimeout(pendingHideTimeout); pendingHideTimeout = null }
  broadcast(IPC.WINDOW_WILL_HIDE)
  pendingHideTimeout = setTimeout(() => {
    mainWindow?.hide()
    pendingHideTimeout = null
  }, 185)
})

ipcMain.handle(IPC.IS_VISIBLE, () => {
  return mainWindow?.isVisible() ?? false
})

ipcMain.on(IPC.NOTIFY_NATIVE, (_e, payload: { title: string; body: string }) => {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: payload.title, body: payload.body, silent: true })
  n.on('click', () => showWindow('notification-click'))
  n.show()
})

// OS-level click-through toggle — renderer calls this on mousemove
// to enable clicks on interactive UI while passing through transparent areas
ipcMain.on(IPC.SET_IGNORE_MOUSE_EVENTS, (event, ignore: boolean, options?: { forward?: boolean }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options || {})
  }
})

// ─── IPC Handlers (typed, strict) ───

ipcMain.handle(IPC.START, async () => {
  log('IPC START')
  const stale = !startCache || (Date.now() - startCache.updatedAt > START_TTL_MS)
  if (stale && !startRefreshInFlight) {
    startRefreshInFlight = refreshStartCache().finally(() => { startRefreshInFlight = null })
  }
  if (startRefreshInFlight) {
    await Promise.race([startRefreshInFlight, new Promise<void>((r) => setTimeout(r, START_SOFT_WAIT_MS))])
  }
  return {
    version: startCache?.version ?? 'unknown',
    auth: startCache?.auth ?? {},
    mcpServers: startCache?.mcpServers ?? [],
    projectPath: process.cwd(),
    homePath: homedir(),
  }
})

ipcMain.handle(IPC.CREATE_TAB, () => {
  const tabId = controlPlane.createTab()
  log(`IPC CREATE_TAB → ${tabId}`)
  return { tabId }
})

ipcMain.on(IPC.INIT_SESSION, (_event, tabId: string, systemPrompt?: string) => {
  log(`IPC INIT_SESSION: ${tabId}`)
  controlPlane.initSession(tabId, systemPrompt)
})

ipcMain.on(IPC.RESET_TAB_SESSION, (_event, tabId: string) => {
  log(`IPC RESET_TAB_SESSION: ${tabId}`)
  controlPlane.resetTabSession(tabId)
})

ipcMain.handle(IPC.PROMPT, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  if (DEBUG_MODE) {
    log(`IPC PROMPT: tab=${tabId} req=${requestId} prompt="${options.prompt.substring(0, 100)}"`)
  } else {
    log(`IPC PROMPT: tab=${tabId} req=${requestId}`)
  }

  if (!tabId) {
    throw new Error('No tabId provided — prompt rejected')
  }
  if (!requestId) {
    throw new Error('No requestId provided — prompt rejected')
  }

  try {
    await controlPlane.submitPrompt(tabId, requestId, options)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`PROMPT error: ${msg}`)
    throw err
  }
})

ipcMain.handle(IPC.CANCEL, (_event, requestId: string) => {
  log(`IPC CANCEL: ${requestId}`)
  return controlPlane.cancel(requestId)
})

ipcMain.handle(IPC.STOP_TAB, (_event, tabId: string) => {
  log(`IPC STOP_TAB: ${tabId}`)
  return controlPlane.cancelTab(tabId)
})

ipcMain.handle(IPC.INTERRUPT_AND_SEND, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  log(`IPC INTERRUPT_AND_SEND: tab=${tabId} req=${requestId}`)
  return controlPlane.interruptAndSend(tabId, requestId, options)
})

ipcMain.handle(IPC.RETRY, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  log(`IPC RETRY: tab=${tabId} req=${requestId}`)
  return controlPlane.retry(tabId, requestId, options)
})

ipcMain.handle(IPC.STATUS, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.TAB_HEALTH, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.CLOSE_TAB, (_event, tabId: string) => {
  log(`IPC CLOSE_TAB: ${tabId}`)
  controlPlane.closeTab(tabId)
})

ipcMain.on(IPC.SET_PERMISSION_MODE, (_event, mode: string) => {
  if (mode !== 'ask' && mode !== 'auto') {
    log(`IPC SET_PERMISSION_MODE: invalid mode "${mode}" — ignoring`)
    return
  }
  log(`IPC SET_PERMISSION_MODE: ${mode}`)
  controlPlane.setPermissionMode(mode)
})

ipcMain.handle(IPC.RESPOND_PERMISSION, (_event, { tabId, questionId, optionId }: { tabId: string; questionId: string; optionId: string }) => {
  log(`IPC RESPOND_PERMISSION: tab=${tabId} question=${questionId} option=${optionId}`)
  return controlPlane.respondToPermission(tabId, questionId, optionId)
})

ipcMain.handle(IPC.LIST_SESSIONS, async (_e, projectPath?: string) => {
  log(`IPC LIST_SESSIONS ${projectPath ? `(path=${projectPath})` : '(all)'}`)
  try {
    const projectsRoot = join(homedir(), '.claude', 'projects')
    if (!existsSync(projectsRoot)) return []

    let projectDirs: string[]
    if (projectPath) {
      const encoded = projectPath.replace(/\\/g, '/').replace(/\//g, '-')
      projectDirs = existsSync(join(projectsRoot, encoded)) ? [encoded] : []
    } else {
      projectDirs = readdirSync(projectsRoot).filter((d: string) => {
        try { return statSync(join(projectsRoot, d)).isDirectory() } catch { return false }
      })
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const sessions: Array<{ sessionId: string; slug: string | null; firstMessage: string | null; lastTimestamp: string; size: number; projectDir: string }> = []

    for (const projectDir of projectDirs) {
      const sessionsDir = join(projectsRoot, projectDir)
      let files: string[]
      try { files = readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl')) }
      catch { continue }

      for (const file of files) {
        const fileSessionId = file.replace(/\.jsonl$/, '')
        if (!UUID_RE.test(fileSessionId)) continue

        const filePath = join(sessionsDir, file)
        const stat = statSync(filePath)
        if (stat.size < 100) continue

        const meta: { validated: boolean; slug: string | null; firstMessage: string | null; lastTimestamp: string | null } = {
          validated: false, slug: null, firstMessage: null, lastTimestamp: null,
        }

        await new Promise<void>((resolve) => {
          const rl = createInterface({ input: createReadStream(filePath) })
          rl.on('line', (line: string) => {
            try {
              const obj = JSON.parse(line)
              if (!meta.validated && obj.type && obj.uuid && obj.timestamp) meta.validated = true
              if (obj.slug && !meta.slug) meta.slug = obj.slug
              if (obj.timestamp) meta.lastTimestamp = obj.timestamp
              if (obj.type === 'user' && !meta.firstMessage) {
                const content = obj.message?.content
                if (typeof content === 'string') {
                  meta.firstMessage = content.substring(0, 100)
                } else if (Array.isArray(content)) {
                  const textPart = content.find((p: any) => p.type === 'text')
                  meta.firstMessage = textPart?.text?.substring(0, 100) || null
                }
              }
            } catch {}
          })
          rl.on('close', () => resolve())
        })

        if (meta.validated) {
          sessions.push({
            sessionId: fileSessionId,
            slug: meta.slug,
            firstMessage: meta.firstMessage,
            lastTimestamp: meta.lastTimestamp || stat.mtime.toISOString(),
            size: stat.size,
            projectDir,
          })
        }
      }
    }

    sessions.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
    return sessions.slice(0, projectPath ? 20 : 100)
  } catch (err) {
    log(`LIST_SESSIONS error: ${err}`)
    return []
  }
})

// Load conversation history from a session's JSONL file
ipcMain.handle(IPC.LOAD_SESSION, async (_e, arg: { sessionId: string; projectPath?: string; projectDir?: string } | string) => {
  const sessionId = typeof arg === 'string' ? arg : arg.sessionId
  const projectPath = typeof arg === 'string' ? undefined : arg.projectPath
  const projectDir = typeof arg === 'string' ? undefined : arg.projectDir
  log(`IPC LOAD_SESSION ${sessionId}`)

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(sessionId)) {
    log(`LOAD_SESSION rejected: invalid sessionId format`)
    return []
  }

  try {
    const projectsBase = resolve(homedir(), '.claude', 'projects')
    let filePath: string
    if (projectDir) {
      filePath = resolve(projectsBase, projectDir, `${sessionId}.jsonl`)
    } else {
      const cwd = projectPath || process.cwd()
      const encodedPath = cwd.replace(/\\/g, '/').replace(/\//g, '-')
      filePath = resolve(projectsBase, encodedPath, `${sessionId}.jsonl`)
    }
    const sep = process.platform === 'win32' ? '\\' : '/'
    if (!filePath.startsWith(projectsBase + sep)) {
      log(`LOAD_SESSION rejected: path traversal detected`)
      return []
    }
    if (!existsSync(filePath)) return []

    const messages: Array<{ role: string; content: string; toolName?: string; toolInput?: string; timestamp: number }> = []
    await new Promise<void>((resolve) => {
      const rl = createInterface({ input: createReadStream(filePath) })
      rl.on('line', (line: string) => {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user') {
            const content = obj.message?.content
            let text = ''
            if (typeof content === 'string') {
              text = content
            } else if (Array.isArray(content)) {
              text = content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
            }
            if (text) {
              messages.push({ role: 'user', content: text, timestamp: new Date(obj.timestamp).getTime() })
            }
          } else if (obj.type === 'assistant') {
            const content = obj.message?.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  messages.push({ role: 'assistant', content: block.text, timestamp: new Date(obj.timestamp).getTime() })
                } else if (block.type === 'tool_use' && block.name) {
                  messages.push({
                    role: 'tool',
                    content: '',
                    toolName: block.name,
                    toolInput: block.input ? JSON.stringify(block.input) : undefined,
                    timestamp: new Date(obj.timestamp).getTime(),
                  })
                }
              }
            }
          }
        } catch {}
      })
      rl.on('close', () => resolve())
    })
    return messages
  } catch (err) {
    log(`LOAD_SESSION error: ${err}`)
    return []
  }
})

function decodeEncodedDir(encoded: string): string {
  if (!encoded.startsWith('-')) return homedir()
  const parts = encoded.slice(1).split('-')
  function dfs(idx: number, current: string): string | null {
    if (idx >= parts.length) return existsSync(current) ? current : null
    for (let take = 1; idx + take <= parts.length; take++) {
      const component = parts.slice(idx, idx + take).join('-')
      const next = current + '/' + component
      if (idx + take === parts.length) {
        if (existsSync(next)) return next
      } else {
        try {
          if (existsSync(next) && statSync(next).isDirectory()) {
            const result = dfs(idx + take, next)
            if (result) return result
          }
        } catch {}
      }
    }
    return null
  }
  return dfs(0, '') || homedir()
}

ipcMain.handle(IPC.RESOLVE_PROJECT_DIR, (_e, projectDir: string): string => {
  return decodeEncodedDir(projectDir)
})

ipcMain.handle(IPC.RESOLVE_SESSION_DIR, (_e, sessionId: string): string => {
  const projectsBase = join(homedir(), '.claude', 'projects')
  try {
    const dirs = readdirSync(projectsBase)
    for (const dir of dirs) {
      if (existsSync(join(projectsBase, dir, `${sessionId}.jsonl`))) {
        return decodeEncodedDir(dir)
      }
    }
  } catch {}
  return homedir()
})

ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top (not behind other apps).
  // Unparented avoids modal dimming on the transparent overlay.
  // Activation is fine here — user is actively interacting with CLUI.
  if (process.platform === 'darwin') app.focus()
  const options = { properties: ['openDirectory'] as const }
  const result = process.platform === 'darwin'
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
  try {
    // Only allow http(s) links from markdown content.
    if (!/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
})

ipcMain.handle(IPC.ATTACH_FILES, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top
  if (process.platform === 'darwin') app.focus()
  const options = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'md', 'json', 'yaml', 'toml'] },
    ],
  }
  const result = process.platform === 'darwin'
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  if (result.canceled || result.filePaths.length === 0) return null

  const { basename, extname } = require('path')
  const { readFileSync, statSync } = require('fs')

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.yaml': 'text/yaml', '.toml': 'text/toml',
  }

  return result.filePaths.map((fp: string) => {
    const ext = extname(fp).toLowerCase()
    const mime = mimeMap[ext] || 'application/octet-stream'
    const stat = statSync(fp)
    let dataUrl: string | undefined

    // Generate preview data URL for images (max 2MB to keep IPC fast)
    if (IMAGE_EXTS.has(ext) && stat.size < 2 * 1024 * 1024) {
      try {
        const buf = readFileSync(fp)
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      } catch {}
    }

    return {
      id: crypto.randomUUID(),
      type: IMAGE_EXTS.has(ext) ? 'image' : 'file',
      name: basename(fp),
      path: fp,
      mimeType: mime,
      dataUrl,
      size: stat.size,
    }
  })
})

ipcMain.handle(IPC.TAKE_SCREENSHOT, async () => {
  if (!mainWindow) return null

  if (SPACES_DEBUG) snapshotWindowState('screenshot pre-hide')
  mainWindow.hide()
  await new Promise((r) => setTimeout(r, 300))

  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process')
      const { join } = require('path')
      const { tmpdir } = require('os')
      const { writeFileSync } = require('fs')

      const initialImage = clipboard.readImage()
      const initialDataUrl = initialImage.isEmpty() ? '' : initialImage.toDataURL()

      try {
        execSync('start ms-screenclip:', { shell: true, timeout: 2000 })
      } catch {
        try {
          execSync('start SnippingTool.exe', { shell: true, timeout: 2000 })
        } catch {}
      }

      const deadline = Date.now() + 60000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500))
        const clip = clipboard.readImage()
        if (!clip.isEmpty()) {
          const newDataUrl = clip.toDataURL()
          if (newDataUrl !== initialDataUrl) {
            const buf = clip.toPNG()
            const screenshotPath = join(tmpdir(), `clui-screenshot-${Date.now()}.png`)
            writeFileSync(screenshotPath, buf)
            return {
              id: crypto.randomUUID(),
              type: 'image',
              name: `screenshot ${++screenshotCounter}.png`,
              path: screenshotPath,
              mimeType: 'image/png',
              dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
              size: buf.length,
            }
          }
        }
      }
      return null
    }

    const { execSync } = require('child_process')
    const { join } = require('path')
    const { tmpdir } = require('os')
    const { readFileSync, existsSync } = require('fs')

    const timestamp = Date.now()
    const screenshotPath = join(tmpdir(), `clui-screenshot-${timestamp}.png`)

    execSync(`/usr/sbin/screencapture -i "${screenshotPath}"`, {
      timeout: 30000,
      stdio: 'ignore',
    })

    if (!existsSync(screenshotPath)) {
      return null
    }

    const buf = readFileSync(screenshotPath)
    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `screenshot ${++screenshotCounter}.png`,
      path: screenshotPath,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      size: buf.length,
    }
  } catch {
    return null
  } finally {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.webContents.focus()
    }
    broadcast(IPC.WINDOW_SHOWN)
    if (SPACES_DEBUG) {
      log('[spaces] screenshot restore show+focus')
      snapshotWindowState('screenshot restore immediate')
      setTimeout(() => snapshotWindowState('screenshot restore +200ms'), 200)
    }
  }
})

let pasteCounter = 0
const MAX_PASTE_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_AUDIO_BYTES = 100 * 1024 * 1024

ipcMain.handle(IPC.PASTE_IMAGE, async (_event, dataUrl: string) => {
  try {
    const { writeFileSync } = require('fs')
    const { join } = require('path')
    const { tmpdir } = require('os')

    if (typeof dataUrl !== 'string' || dataUrl.length > MAX_PASTE_IMAGE_BYTES * 1.37) return null

    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/)
    if (!match) return null

    const [, mimeType, ext, base64Data] = match
    const buf = Buffer.from(base64Data, 'base64')
    if (buf.length > MAX_PASTE_IMAGE_BYTES) return null
    const timestamp = Date.now()
    const filePath = join(tmpdir(), `clui-paste-${timestamp}.${ext}`)
    writeFileSync(filePath, buf)

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `pasted image ${++pasteCounter}.${ext}`,
      path: filePath,
      mimeType,
      dataUrl,
      size: buf.length,
    }
  } catch {
    return null
  }
})

ipcMain.handle(IPC.TRANSCRIBE_AUDIO, async (_event, audioBase64: string) => {
  const { writeFileSync, existsSync, unlinkSync, readFileSync } = require('fs')
  const { execSync } = require('child_process')
  const { join } = require('path')
  const { tmpdir } = require('os')

  const tmpWav = join(tmpdir(), `clui-voice-${Date.now()}.wav`)
  try {
    if (typeof audioBase64 !== 'string' || audioBase64.length > MAX_AUDIO_BYTES * 1.37) {
      return { error: 'Audio payload too large' }
    }
    const buf = Buffer.from(audioBase64, 'base64')
    if (buf.length > MAX_AUDIO_BYTES) {
      return { error: 'Audio payload too large' }
    }
    writeFileSync(tmpWav, buf)

    const candidates = process.platform === 'win32' ? [
      join(homedir(), 'AppData', 'Local', 'Programs', 'whisper-cli', 'whisper-cli.exe'),
      join(homedir(), 'AppData', 'Roaming', 'Python', 'Scripts', 'whisper.exe'),
      join(homedir(), '.local', 'bin', 'whisper-cli.exe'),
      join(homedir(), '.local', 'bin', 'whisper.exe'),
    ] : [
      '/opt/homebrew/bin/whisper-cli',
      '/usr/local/bin/whisper-cli',
      '/opt/homebrew/bin/whisper',
      '/usr/local/bin/whisper',
      join(homedir(), '.local/bin/whisper'),
    ]

    let whisperBin = ''
    for (const c of candidates) {
      if (existsSync(c)) { whisperBin = c; break }
    }

    if (!whisperBin) {
      if (process.platform === 'win32') {
        try {
          whisperBin = execSync('where.exe whisper-cli', { encoding: 'utf-8' }).trim().split(/\r?\n/)[0]
        } catch {}
        if (!whisperBin) {
          try {
            whisperBin = execSync('where.exe whisper', { encoding: 'utf-8' }).trim().split(/\r?\n/)[0]
          } catch {}
        }
      } else {
        try {
          whisperBin = execSync('/bin/zsh -lc "whence -p whisper-cli"', { encoding: 'utf-8' }).trim()
        } catch {}
        if (!whisperBin) {
          try {
            whisperBin = execSync('/bin/zsh -lc "whence -p whisper"', { encoding: 'utf-8' }).trim()
          } catch {}
        }
      }
    }

    if (!whisperBin) {
      return {
        error: process.platform === 'win32'
          ? 'Whisper not found. Install whisper-cli and ensure it is in your PATH.'
          : 'Whisper not found. Install with: brew install whisper-cli',
        transcript: null,
      }
    }

    const isWhisperCpp = whisperBin.includes('whisper-cli')

    const modelCandidates = process.platform === 'win32' ? [
      join(homedir(), 'AppData', 'Local', 'whisper', 'ggml-base.bin'),
      join(homedir(), 'AppData', 'Local', 'whisper', 'ggml-tiny.bin'),
      join(homedir(), '.local', 'share', 'whisper', 'ggml-base.bin'),
      join(homedir(), '.local', 'share', 'whisper', 'ggml-tiny.bin'),
      join(homedir(), 'AppData', 'Local', 'whisper', 'ggml-base.en.bin'),
      join(homedir(), 'AppData', 'Local', 'whisper', 'ggml-tiny.en.bin'),
    ] : [
      join(homedir(), '.local/share/whisper/ggml-base.bin'),
      join(homedir(), '.local/share/whisper/ggml-tiny.bin'),
      '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
      '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.bin',
      join(homedir(), '.local/share/whisper/ggml-base.en.bin'),
      join(homedir(), '.local/share/whisper/ggml-tiny.en.bin'),
      '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
      '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.en.bin',
    ]

    let modelPath = ''
    for (const m of modelCandidates) {
      if (existsSync(m)) { modelPath = m; break }
    }

    // Detect if using an English-only model (.en suffix) — force English if so
    const isEnglishOnly = modelPath.includes('.en.')
    log(`Transcribing with: ${whisperBin} (model: ${modelPath || 'default'}, lang: ${isEnglishOnly ? 'en' : 'auto'})`)

    let output: string
    if (isWhisperCpp) {
      // whisper-cpp: whisper-cli -m model -f file --no-timestamps
      if (!modelPath) {
        return {
          error: process.platform === 'win32'
            ? 'Whisper model not found. Download ggml-tiny.bin from huggingface.co/ggerganov/whisper.cpp and place it in %LOCALAPPDATA%\\whisper\\'
            : 'Whisper model not found. Download with:\nmkdir -p ~/.local/share/whisper && curl -L -o ~/.local/share/whisper/ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
          transcript: null,
        }
      }
      const langFlag = isEnglishOnly ? '-l en' : '-l auto'
      output = execSync(
        `"${whisperBin}" -m "${modelPath}" -f "${tmpWav}" --no-timestamps ${langFlag}`,
        { encoding: 'utf-8', timeout: 30000 }
      )
    } else {
      // Python whisper: auto-detect language unless English-only model
      const langFlag = isEnglishOnly ? '--language en' : ''
      output = execSync(
        `"${whisperBin}" "${tmpWav}" --model tiny ${langFlag} --output_format txt --output_dir "${tmpdir()}"`,
        { encoding: 'utf-8', timeout: 30000 }
      )
      // Python whisper writes .txt file
      const txtPath = tmpWav.replace('.wav', '.txt')
      if (existsSync(txtPath)) {
        const transcript = readFileSync(txtPath, 'utf-8').trim()
        try { unlinkSync(txtPath) } catch {}
        return { error: null, transcript }
      }
      // File not created — Python whisper failed silently
      return {
        error: `Whisper output file not found at ${txtPath}. Check disk space and permissions.`,
        transcript: null,
      }
    }

    // whisper-cpp prints to stdout directly
    // Strip timestamp patterns and known hallucination outputs
    const HALLUCINATIONS = /^\s*(\[BLANK_AUDIO\]|you\.?|thank you\.?|thanks\.?)\s*$/i
    const transcript = output
      .replace(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/g, '')
      .trim()

    if (HALLUCINATIONS.test(transcript)) {
      return { error: null, transcript: '' }
    }

    return { error: null, transcript: transcript || '' }
  } catch (err: any) {
    log(`Transcription error: ${err.message}`)
    return {
      error: `Transcription failed: ${err.message}`,
      transcript: null,
    }
  } finally {
    try { unlinkSync(tmpWav) } catch {}
  }
})

ipcMain.handle(IPC.GET_DIAGNOSTICS, () => {
  const { readFileSync, existsSync } = require('fs')
  const health = controlPlane.getHealth()

  let recentLogs = ''
  if (existsSync(LOG_FILE)) {
    try {
      const content = readFileSync(LOG_FILE, 'utf-8')
      const lines = content.split('\n')
      recentLogs = lines.slice(-100).join('\n')
    } catch {}
  }

  return {
    health,
    logPath: LOG_FILE,
    recentLogs,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    appVersion: app.getVersion(),
    transport: INTERACTIVE_PTY ? 'pty' : 'stream-json',
  }
})

ipcMain.handle(IPC.OPEN_IN_TERMINAL, (_event, arg: string | null | { sessionId?: string | null; projectPath?: string }) => {
  const { execFile } = require('child_process')
  const claudeBin = 'claude'

  let sessionId: string | null = null
  let projectPath: string = process.cwd()
  if (typeof arg === 'string') {
    sessionId = arg
  } else if (arg && typeof arg === 'object') {
    sessionId = arg.sessionId ?? null
    projectPath = arg.projectPath && arg.projectPath !== '~' ? arg.projectPath : process.cwd()
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (sessionId && !UUID_RE.test(sessionId)) {
    log(`OPEN_IN_TERMINAL rejected: invalid sessionId format`)
    return false
  }

  if (process.platform === 'win32') {
    const claudeCmd = sessionId ? `${claudeBin} --resume ${sessionId}` : claudeBin
    const { execSync: winExecSync } = require('child_process')

    let useWt = false
    try {
      winExecSync('where.exe wt.exe', { stdio: 'ignore', timeout: 2000 })
      useWt = true
    } catch {}

    try {
      if (useWt) {
        const wtArgs = ['-d', projectPath, 'cmd.exe', '/k', claudeCmd]
        execFile('wt.exe', wtArgs, (err: Error | null) => {
          if (err) log(`Failed to open Windows Terminal: ${err.message}`)
          else log(`Opened Windows Terminal with: ${claudeCmd}`)
        })
      } else {
        const safeDir = projectPath.replace(/"/g, '')
        const cmdArgs = ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${safeDir}" && ${claudeCmd}`]
        execFile('cmd.exe', cmdArgs, (err: Error | null) => {
          if (err) log(`Failed to open cmd: ${err.message}`)
          else log(`Opened cmd with: ${claudeCmd}`)
        })
      }
      return true
    } catch (err: unknown) {
      log(`Failed to open terminal: ${err}`)
      return false
    }
  }

  const projectDir = projectPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  let cmd: string
  if (sessionId) {
    cmd = `cd \\"${projectDir}\\" && ${claudeBin} --resume ${sessionId}`
  } else {
    cmd = `cd \\"${projectDir}\\" && ${claudeBin}`
  }

  const script = `tell application "Terminal"
  activate
  do script "${cmd}"
end tell`

  try {
    execFile('/usr/bin/osascript', ['-e', script], (err: Error | null) => {
      if (err) log(`Failed to open terminal: ${err.message}`)
      else log(`Opened terminal with: ${cmd}`)
    })
    return true
  } catch (err: unknown) {
    log(`Failed to open terminal: ${err}`)
    return false
  }
})

// ─── Marketplace IPC ───

ipcMain.handle(IPC.MARKETPLACE_FETCH, async (_event, { forceRefresh } = {}) => {
  log('IPC MARKETPLACE_FETCH')
  return fetchCatalog(forceRefresh)
})

ipcMain.handle(IPC.MARKETPLACE_INSTALLED, async () => {
  log('IPC MARKETPLACE_INSTALLED')
  return listInstalled()
})

ipcMain.handle(IPC.MARKETPLACE_INSTALL, async (_event, { repo, pluginName, marketplace, sourcePath, isSkillMd }: { repo: string; pluginName: string; marketplace: string; sourcePath?: string; isSkillMd?: boolean }) => {
  log(`IPC MARKETPLACE_INSTALL: ${pluginName} from ${repo} (isSkillMd=${isSkillMd})`)
  return installPlugin(repo, pluginName, marketplace, sourcePath, isSkillMd)
})

ipcMain.handle(IPC.MARKETPLACE_UNINSTALL, async (_event, { pluginName }: { pluginName: string }) => {
  log(`IPC MARKETPLACE_UNINSTALL: ${pluginName}`)
  return uninstallPlugin(pluginName)
})

ipcMain.handle(IPC.MCP_ADD, async (_event, { name, json, scope }: { name: string; json: string; scope: string }) => {
  log(`IPC MCP_ADD: ${name} scope=${scope}`)
  try {
    await runClaudeCmd(['mcp', 'add-json', '-s', scope, name, json], 10000)
    return { ok: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`MCP_ADD error: ${msg}`)
    return { ok: false, error: msg }
  }
})

ipcMain.handle(IPC.MCP_REMOVE, async (_event, { name, scope }: { name: string; scope: string }) => {
  log(`IPC MCP_REMOVE: ${name} scope=${scope}`)
  try {
    await runClaudeCmd(['mcp', 'remove', '-s', scope, name], 10000)
    return { ok: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`MCP_REMOVE error: ${msg}`)
    return { ok: false, error: msg }
  }
})

// ─── Theme Detection ───

ipcMain.handle(IPC.GET_THEME, () => {
  return { isDark: nativeTheme.shouldUseDarkColors }
})

nativeTheme.on('updated', () => {
  broadcast(IPC.THEME_CHANGED, nativeTheme.shouldUseDarkColors)
})

// ─── Permission Preflight ───
// Request all required macOS permissions upfront on first launch so the user
// is never interrupted mid-session by a permission prompt.

async function requestPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  // ── Microphone (for voice input via Whisper) ──
  try {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus === 'not-determined') {
      await systemPreferences.askForMediaAccess('microphone')
    }
  } catch (err: any) {
    log(`Permission preflight: microphone check failed — ${err.message}`)
  }

  // ── Accessibility (for global ⌥+Space shortcut) ──
  // globalShortcut works without it on modern macOS; Cmd+Shift+K is always the fallback.
  // Screen Recording: not requested upfront — macOS 15 Sequoia shows an alarming
  // "bypass private window picker" dialog. Let the OS prompt naturally if/when
  // the screenshot feature is actually used.
}

// ─── App Lifecycle ───

app.whenReady().then(async () => {
  // macOS: become an accessory app. Accessory apps can have key windows (keyboard works)
  // without deactivating the currently active app (hover preserved in browsers).
  // This is how Spotlight, Alfred, Raycast work.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  // Request permissions upfront so the user is never interrupted mid-session.
  await requestPermissions()

  // Skill provisioning — non-blocking, streams status to renderer
  ensureSkills((status: SkillStatus) => {
    log(`Skill ${status.name}: ${status.state}${status.error ? ` — ${status.error}` : ''}`)
    broadcast(IPC.SKILL_STATUS, status)
  }).catch((err: Error) => log(`Skill provisioning error: ${err.message}`))

  createWindow()
  snapshotWindowState('after createWindow')

  if (SPACES_DEBUG) {
    mainWindow?.on('show', () => snapshotWindowState('event window show'))
    mainWindow?.on('hide', () => snapshotWindowState('event window hide'))
    mainWindow?.on('focus', () => snapshotWindowState('event window focus'))
    mainWindow?.on('blur', () => snapshotWindowState('event window blur'))
    mainWindow?.webContents.on('focus', () => snapshotWindowState('event webContents focus'))
    mainWindow?.webContents.on('blur', () => snapshotWindowState('event webContents blur'))

    app.on('browser-window-focus', () => snapshotWindowState('event app browser-window-focus'))
    app.on('browser-window-blur', () => snapshotWindowState('event app browser-window-blur'))

    screen.on('display-added', (_e, display) => {
      log(`[spaces] event display-added id=${display.id}`)
      snapshotWindowState('event display-added')
    })
    screen.on('display-removed', (_e, display) => {
      log(`[spaces] event display-removed id=${display.id}`)
      snapshotWindowState('event display-removed')
    })
    screen.on('display-metrics-changed', (_e, display, changedMetrics) => {
      log(`[spaces] event display-metrics-changed id=${display.id} changed=${changedMetrics.join(',')}`)
      snapshotWindowState('event display-metrics-changed')
    })
  }

  screen.on('display-metrics-changed', () => {
    if (mainWindow?.isVisible()) {
      showWindow('display-metrics-changed')
    }
  })

  // Primary: Option+Space (2 keys, doesn't conflict with shell)
  // Fallback: Cmd+Shift+K kept as secondary shortcut
  const registered = globalShortcut.register('Alt+Space', () => toggleWindow('shortcut Alt+Space'))
  if (!registered) {
    log('Alt+Space shortcut registration failed — macOS input sources may claim it')
  }
  globalShortcut.register('CommandOrControl+Shift+K', () => toggleWindow('shortcut Cmd/Ctrl+Shift+K'))

  if (process.env.ELECTRON_RENDERER_URL) {
    globalShortcut.register('F12', () => {
      if (mainWindow?.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools()
      } else {
        mainWindow?.webContents.openDevTools({ mode: 'detach' })
      }
    })
  }

  const trayIconPath = process.platform === 'win32'
    ? join(__dirname, '../../resources/icon.png')
    : join(__dirname, '../../resources/trayTemplate.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true)
  tray = new Tray(trayIcon)
  tray.setToolTip('Clui CC — Claude Code UI')
  tray.on('click', () => toggleWindow('tray click'))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Clui CC', click: () => showWindow('tray menu') },
      { label: 'Quit', click: () => { app.quit() } },
    ])
  )

  // app 'activate' fires when macOS brings the app to the foreground (e.g. after
  // webContents.focus() triggers applicationDidBecomeActive on some macOS versions).
  // Using showWindow here instead of toggleWindow prevents the re-entry race where
  // a summon immediately hides itself because activate fires mid-show.
  app.on('activate', () => showWindow('app activate'))
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  controlPlane.shutdown()
  flushLogs()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
