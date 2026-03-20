import React, { useEffect, useCallback, useState, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, Camera, HeadCircuit } from '@phosphor-icons/react'
import { TabStrip } from './components/TabStrip'
import { ConversationView } from './components/ConversationView'
import { InputBar } from './components/InputBar'
import { StatusBar } from './components/StatusBar'
const MarketplacePanel = lazy(() => import('./components/MarketplacePanel').then((m) => ({ default: m.MarketplacePanel })))
import { PopoverLayerProvider } from './components/PopoverLayer'
import { useClaudeEvents } from './hooks/useClaudeEvents'
import { useHealthReconciliation } from './hooks/useHealthReconciliation'
import { useSessionStore } from './stores/sessionStore'
import { useColors, useThemeStore, spacing } from './theme'
import { setWindowVisibility } from './stores/sessionStore'

const SPRING = { type: 'spring' as const, stiffness: 280, damping: 24, mass: 0.8 }
const TRANSITION = { duration: 0.26, ease: [0.4, 0, 0.1, 1] as const }
const EASING_OUT = [0.16, 1, 0.3, 1] as const
const EASING_IN = [0.4, 0, 1, 1] as const

const ANIM_VISIBLE = { opacity: 1, scale: [0.9, 1.018, 1] as number[], y: [16, -4, 0] as number[] }
const ANIM_HIDDEN = { opacity: 0, scale: 0.9, y: 10 }
const TRANS_OPEN = {
  opacity: { duration: 0.22, ease: EASING_OUT },
  scale: { duration: 0.5, times: [0, 0.7, 1], ease: EASING_OUT },
  y: { duration: 0.48, times: [0, 0.68, 1], ease: EASING_OUT },
}
const TRANS_CLOSE = {
  opacity: { duration: 0.14, ease: EASING_IN },
  scale: { duration: 0.17, ease: EASING_IN },
  y: { duration: 0.17, ease: EASING_IN },
}

export default function App() {
  useClaudeEvents()
  useHealthReconciliation()

  const activeTabStatus = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.status)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const colors = useColors()
  const setSystemTheme = useThemeStore((s) => s.setSystemTheme)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const [windowVisible, setWindowVisible] = useState(false)

  useEffect(() => {
    const unsub = window.clui.onWindowShown(() => { setWindowVisible(true); setWindowVisibility(true) })
    const unsubHide = window.clui.onWindowWillHide(() => { setWindowVisible(false); setWindowVisibility(false) })
    const raf = requestAnimationFrame(() => { setWindowVisible(true); setWindowVisibility(true) })
    return () => { unsub(); unsubHide(); cancelAnimationFrame(raf) }
  }, [])

  useEffect(() => {
    window.clui.getTheme().then(({ isDark }) => {
      setSystemTheme(isDark)
    }).catch(() => {})

    const unsub = window.clui.onThemeChange((isDark) => {
      setSystemTheme(isDark)
    })
    return unsub
  }, [setSystemTheme])

  useEffect(() => {
    const savedMode = useSessionStore.getState().permissionMode
    if (savedMode !== 'ask') {
      window.clui.setPermissionMode(savedMode)
    }
    const firstTab = useSessionStore.getState().tabs[0]
    if (firstTab) {
      const localId = firstTab.id
      window.clui.createTab().then(({ tabId }) => {
        useSessionStore.setState((s) => ({
          tabs: s.tabs.map((t) => t.id === localId ? { ...t, id: tabId } : t),
          activeTabId: s.activeTabId === localId ? tabId : s.activeTabId,
        }))
        const rules = useThemeStore.getState().globalRules?.trim()
        window.clui.initSession(tabId, rules || undefined)
      }).catch(() => {})
    }
    useSessionStore.getState().initStaticInfo().then(() => {
      const homeDir = useSessionStore.getState().staticInfo?.homePath || '~'
      useSessionStore.setState((s) => ({
        tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, workingDirectory: homeDir, hasChosenDirectory: false } : t)),
      }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!window.clui?.setIgnoreMouseEvents) return
    let lastIgnored: boolean | null = null

    const onMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const isUI = !!(el && el.closest('[data-clui-ui]'))
      const shouldIgnore = !isUI
      if (shouldIgnore !== lastIgnored) {
        lastIgnored = shouldIgnore
        if (shouldIgnore) {
          window.clui.setIgnoreMouseEvents(true, { forward: true })
        } else {
          window.clui.setIgnoreMouseEvents(false)
        }
      }
    }

    const onMouseLeave = () => {
      if (lastIgnored !== true) {
        lastIgnored = true
        window.clui.setIgnoreMouseEvents(true, { forward: true })
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseleave', onMouseLeave)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  const isExpanded = useSessionStore((s) => s.isExpanded)
  const marketplaceOpen = useSessionStore((s) => s.marketplaceOpen)
  const isRunning = activeTabStatus === 'running' || activeTabStatus === 'connecting'

  const contentWidth = expandedUI ? 700 : spacing.contentWidth
  const cardExpandedWidth = expandedUI ? 700 : 460
  const cardCollapsedWidth = expandedUI ? 670 : 430
  const cardCollapsedMargin = expandedUI ? 15 : 15
  const bodyMaxHeight = expandedUI ? 520 : 400

  const handleScreenshot = useCallback(async () => {
    const result = await window.clui.takeScreenshot()
    if (!result) return
    addAttachments([result])
  }, [addAttachments])

  const handleAttachFile = useCallback(async () => {
    const files = await window.clui.attachFiles()
    if (!files || files.length === 0) return
    addAttachments(files)
  }, [addAttachments])

  return (
    <PopoverLayerProvider>
      <motion.div
        className="flex flex-col justify-end h-full"
        style={{ background: 'transparent' }}
        initial={{ opacity: 0, scale: 0.9, y: 16 }}
        animate={windowVisible ? ANIM_VISIBLE : ANIM_HIDDEN}
        transition={windowVisible ? TRANS_OPEN : TRANS_CLOSE}
      >

        <div style={{ width: contentWidth, position: 'relative', margin: '0 auto', transition: 'width 0.26s cubic-bezier(0.4, 0, 0.1, 1)' }}>

          <AnimatePresence initial={false}>
            {marketplaceOpen && (
              <div
                data-clui-ui
                style={{
                  width: 720,
                  maxWidth: 720,
                  marginLeft: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 14,
                  position: 'relative',
                  zIndex: 30,
                }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.97 }}
                  transition={SPRING}
                >
                  <div
                    data-clui-ui
                    className="glass-surface overflow-hidden no-drag"
                    style={{
                      borderRadius: 24,
                      maxHeight: 470,
                    }}
                  >
                    <Suspense fallback={<div style={{ height: 300 }} />}><MarketplacePanel /></Suspense>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <motion.div
            data-clui-ui
            className="overflow-hidden flex flex-col drag-region"
            animate={{
              width: isExpanded ? cardExpandedWidth : cardCollapsedWidth,
              marginBottom: isExpanded ? 10 : -14,
              marginLeft: isExpanded ? 0 : cardCollapsedMargin,
              marginRight: isExpanded ? 0 : cardCollapsedMargin,
              background: isExpanded ? colors.containerBg : colors.containerBgCollapsed,
              borderColor: colors.containerBorder,
              boxShadow: isExpanded ? colors.cardShadow : colors.cardShadowCollapsed,
            }}
            transition={SPRING}
            style={{
              borderWidth: 1,
              borderStyle: 'solid',
              borderRadius: 20,
              position: 'relative',
              zIndex: isExpanded ? 20 : 10,
            }}
          >
            <div className="no-drag">
              <TabStrip />
            </div>

            <motion.div
              initial={false}
              animate={{
                height: isExpanded ? 'auto' : 0,
                opacity: isExpanded ? 1 : 0,
              }}
              transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 1.0, bounce: 0, opacity: { duration: 0.2, ease: 'easeInOut' } }}
              className="overflow-hidden no-drag"
            >
              <div style={{ maxHeight: bodyMaxHeight }}>
                <ConversationView />
                <StatusBar />
              </div>
            </motion.div>
          </motion.div>

          <div data-clui-ui className="relative" style={{ minHeight: 46, zIndex: 15, marginBottom: 10 }}>
            <div
              data-clui-ui
              className="circles-out"
            >
              <div className="btn-stack">
                <button
                  className="stack-btn stack-btn-1 glass-surface"
                  title="Attach file"
                  onClick={handleAttachFile}
                  disabled={isRunning}
                >
                  <Paperclip size={17} />
                </button>
                <button
                  className="stack-btn stack-btn-2 glass-surface"
                  title="Take screenshot"
                  onClick={handleScreenshot}
                  disabled={isRunning}
                >
                  <Camera size={17} />
                </button>
                <button
                  className="stack-btn stack-btn-3 glass-surface"
                  title="Skills & Plugins"
                  onClick={() => useSessionStore.getState().toggleMarketplace()}
                  disabled={isRunning}
                >
                  <HeadCircuit size={17} />
                </button>
              </div>
            </div>

            <div
              data-clui-ui
              className="glass-surface w-full"
              style={{ minHeight: 50, borderRadius: 25, padding: '0 6px 0 16px', background: colors.inputPillBg }}
            >
              <InputBar />
            </div>
          </div>
        </div>
      </motion.div>
    </PopoverLayerProvider>
  )
}
