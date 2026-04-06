import React, { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Question, ArrowUpRight, PencilSimple } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'
import type { AskUserQuestionPayload } from '../../shared/types'

interface Props {
  tabId: string
  question: AskUserQuestionPayload
  queueLength?: number
}

export function AskUserQuestionCard({ tabId, question, queueLength = 1 }: Props) {
  const respondUserQuestion = useSessionStore((s) => s.respondUserQuestion)
  const sendMessage = useSessionStore((s) => s.sendMessage)
  const colors = useColors()
  const [responded, setResponded] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showOther, setShowOther] = useState(!question.options.length)
  const [otherText, setOtherText] = useState('')

  const [sending, setSending] = useState(false)

  const toggleOption = useCallback((optionId: string) => {
    if (responded || sending) return
    if (question.multiSelect) {
      setSelectedIds((prev) =>
        prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]
      )
    } else {
      setSelectedIds((prev) => (prev[0] === optionId ? [] : [optionId]))
    }
  }, [question.multiSelect, responded, sending])

  const handleConfirm = useCallback(async () => {
    if (responded || sending) return
    const hasSelection = selectedIds.length > 0
    const hasText = otherText.trim().length > 0
    if (!hasSelection && !hasText) return

    setResponded(true)
    setSending(true)

    let responseText = ''
    if (!question.multiSelect && selectedIds.length > 0) {
      const chosenOption = question.options.find((o) => o.id === selectedIds[0])
      responseText = otherText.trim() || chosenOption?.label || selectedIds[0]
    } else if (question.multiSelect) {
      const labels = selectedIds
        .map((id) => question.options.find((o) => o.id === id)?.label || id)
        .filter(Boolean)
      const parts = [...labels]
      if (otherText.trim()) parts.push(otherText.trim())
      responseText = parts.join(', ')
    } else if (otherText.trim()) {
      responseText = otherText.trim()
    }

    respondUserQuestion(tabId, question.questionId, selectedIds, otherText.trim() || undefined)
  }, [responded, sending, selectedIds, otherText, question, tabId, respondUserQuestion])

  const canConfirm = selectedIds.length > 0 || otherText.trim().length > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 350, damping: 26, mass: 0.7 }}
      className="mx-4 mt-2 mb-2"
    >
      <div
        style={{
          background: colors.containerBg,
          border: `1px solid ${colors.accentSoft}`,
          borderRadius: 12,
          boxShadow: `0 4px 20px ${colors.accentSoft}15`,
        }}
        className="overflow-hidden"
      >
        <div
          className="flex items-center gap-1.5 px-3 py-1.5"
          style={{
            background: `${colors.accentSoft}18`,
            borderBottom: `1px solid ${colors.accentSoft}40`,
          }}
        >
          <Question size={12} style={{ color: colors.accent }} />
          <span className="text-[11px] font-semibold" style={{ color: colors.accent }}>
            {question.header || 'Question'}
          </span>
        </div>

        <div className="px-3 py-2.5">
          <p className="text-[12px] leading-[1.5] mb-2" style={{ color: colors.textPrimary }}>
            {question.question}
          </p>

          {question.options.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-2">
              {question.options.map((opt) => {
                const isSelected = selectedIds.includes(opt.id)
                const isOther = opt.id === '__other__'

                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      if (isOther) {
                        setShowOther(true)
                      } else {
                        toggleOption(opt.id)
                      }
                    }}
                    disabled={responded || sending}
                    className="text-[11px] font-medium px-3 py-2 rounded-lg text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: isSelected ? `${colors.accent}20` : `${colors.surfaceHover}80`,
                      color: isSelected ? colors.accent : colors.textPrimary,
                      border: `1px solid ${isSelected ? colors.accent + '60' : colors.toolBorder + '60'}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="flex-shrink-0 w-3.5 h-3.5 rounded flex items-center justify-center"
                        style={{
                          border: `1.5px solid ${isSelected ? colors.accent : colors.textTertiary}`,
                          background: isSelected ? colors.accent : 'transparent',
                        }}
                      >
                        {isSelected && (
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                            <path d="M1 4L3 6L7 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{opt.label}</div>
                        {opt.description && (
                          <div className="text-[10px] mt-0.5" style={{ color: colors.textTertiary }}>
                            {opt.description}
                          </div>
                        )}
                      </div>
                      {isOther && !showOther && (
                        <PencilSimple size={12} style={{ color: colors.textTertiary, flexShrink: 0 }} />
                      )}
                    </div>

                    {isOther && showOther && (
                      <div className="mt-2">
                        <textarea
                          value={otherText}
                          onChange={(e) => setOtherText(e.target.value)}
                          onFocus={() => {
                            if (!question.multiSelect) {
                              setSelectedIds([opt.id])
                            }
                          }}
                          placeholder="Type your response..."
                          rows={2}
                          className="w-full text-[11px] px-2.5 py-2 rounded-lg resize-none outline-none"
                          style={{
                            background: colors.codeBg,
                            color: colors.textPrimary,
                            border: `1px solid ${colors.toolBorder}`,
                          }}
                        />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {!showOther && question.allowOtherText && (
            <button
              onClick={() => {
                setShowOther(true)
                setSelectedIds([question.options.length > 0 ? question.options[0].id : '__custom__'])
              }}
              disabled={responded || sending}
              className="text-[10px] px-2 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-40"
              style={{
                color: colors.accent,
                background: 'transparent',
                border: `1px solid ${colors.accentSoft}`,
              }}
            >
              <PencilSimple size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Write a custom response
            </button>
          )}

          {showOther && !question.options.find((o) => o.id === '__other__') && (
            <div className="mb-2">
              <textarea
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onFocus={() => {
                  if (!question.multiSelect) {
                    setSelectedIds(['__custom__'])
                  }
                }}
                placeholder="Type your response..."
                rows={2}
                className="w-full text-[11px] px-2.5 py-2 rounded-lg resize-none outline-none"
                style={{
                  background: colors.codeBg,
                  color: colors.textPrimary,
                  border: `1px solid ${colors.toolBorder}`,
                }}
              />
            </div>
          )}

          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-1.5">
              {queueLength > 1 && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{
                    background: colors.accentLight,
                    color: colors.accent,
                  }}
                >
                  +{queueLength - 1} more
                </span>
              )}
            </div>

            <button
              onClick={handleConfirm}
              disabled={!canConfirm || responded || sending}
              className="flex items-center gap-1.5 text-[11px] font-medium px-4 py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: canConfirm ? colors.accent : colors.surfaceHover,
                color: canConfirm ? '#fff' : colors.textTertiary,
                border: 'none',
                boxShadow: canConfirm ? `0 2px 8px ${colors.accent}40` : 'none',
              }}
            >
              {sending ? (
                <>
                  <ArrowUpRight size={11} weight="bold" />
                  Sending...
                </>
              ) : (
                <>
                  <ArrowUpRight size={11} weight="bold" />
                  Confirm
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}