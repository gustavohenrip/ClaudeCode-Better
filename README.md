<p align="center">
  <img src="CLUI.png" width="120" alt="BetterCC" />
</p>

<h1 align="center">BetterCC</h1>

<p align="center">
  <strong>A enhanced fork of <a href="https://github.com/lcoutodemos/clui-cc">Clui CC</a>, originally created by <a href="https://github.com/lcoutodemos">Lucas Couto</a>.</strong><br />
  Transparent desktop overlay for the Claude Code CLI with multi-tab sessions, inline diffs, reasoning controls, permission approval, voice input, and a skills marketplace.
</p>

<p align="center">
  <a href="https://github.com/gustavohenrip/ClaudeCode-Better/releases"><img src="https://img.shields.io/badge/version-0.1.0-d97757?style=flat-square" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="License" /></a>
  <a href="#"><img src="https://img.shields.io/badge/macOS_13+-full_support-111827?style=flat-square&logo=apple&logoColor=white" alt="macOS" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Windows-partial_support-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-37-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4.2-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
</p>

<br />

<p align="center">
  <a href="https://www.youtube.com/watch?v=NqRBIpaA4Fk">
    <img src="https://img.youtube.com/vi/NqRBIpaA4Fk/maxresdefault.jpg" width="720" alt="Clui CC Demo by Lucas Couto" />
  </a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=NqRBIpaA4Fk"><strong>Original demo by Lucas Couto</strong></a>&ensp;&middot;&ensp;<a href="docs/ARCHITECTURE.md"><strong>Architecture</strong></a>&ensp;&middot;&ensp;<a href="docs/TROUBLESHOOTING.md"><strong>Troubleshooting</strong></a>&ensp;&middot;&ensp;<a href="https://github.com/gustavohenrip/ClaudeCode-Better/issues"><strong>Report a Bug</strong></a>
</p>

<br />

---

<br />

## About

BetterCC is a fork of [Clui CC](https://github.com/lcoutodemos/clui-cc), the desktop overlay for Claude Code created by [Lucas Couto](https://github.com/lcoutodemos). The original project wraps the Claude Code CLI in a floating Electron window with multi-tab sessions, permission approval, conversation history, voice input, and a skills marketplace.

This fork extends the original with significant new features, Windows platform support, bug fixes, and performance optimizations. All original features remain intact.

<br />

## What This Fork Adds

Everything below was built on top of the original Clui CC by [Gustavo Puhlmann](https://github.com/gustavohenrip):

### Inline Diff Viewer
Every Edit and Write operation from Claude now displays a visual diff directly in the conversation. Uses an LCS algorithm to compute line-by-line changes: added lines in green, removed lines in red, with context for reference. Supports files up to 512KB and 2000 lines, with lazy expansion for large diffs.

### Reasoning Effort Control
Four-level effort selector (Low / Medium / High / Max) available in settings and via `/effort`. Max effort is exclusive to Claude Opus 4.6 and unlocks full reasoning capacity. The active level is visible in the status bar with a gradient icon for Max.

### Extended Thinking
Toggle Claude's internal reasoning via `/thinking` or settings. When enabled, thinking blocks appear as expandable sections in the conversation showing exactly how Claude arrived at its answer. Full support for `thinking` content blocks and delta events in the streaming pipeline.

### Token Usage Tracking
Real-time per-session token accounting: input, output, cache read, and cache creation tokens. Displayed in the status bar with formatted counters. Use `/cost` after any task to see the full breakdown: USD cost, duration, turns, and token details.

### Global Rules System
New "Rules" tab in settings with a system prompt textarea applied to all sessions across all directories. Persisted to localStorage. Useful for enforcing language preferences, coding standards, or behavioral instructions across every conversation.

### MCP Server Management
Dedicated "MCP" tab in settings to view, add, and remove Model Context Protocol servers. Shows connection status (green/red/gray dots), supports stdio and HTTP server types, and allows configuration of commands, arguments, URLs, and environment variables.

### Redesigned Settings Panel
Three-tab interface (Settings / Rules / MCP) replacing the original single-page popover. New controls for effort level, thinking mode, expanded UI, notification sounds, and theme. Spring-based animations and improved viewport positioning.

### Windows Platform Support
Added `npm run dist:win` producing an x64 NSIS installer with configurable install directory. Core features (tabs, conversations, permissions, marketplace, diff viewer, settings) work on Windows. Platform-specific features like the transparent overlay and `Option + Space` shortcut remain macOS-only. Future Linux support is planned.

### Warm Process Management
Completed Claude processes are kept alive for fast session resumption instead of being killed immediately. The ControlPlane now tracks warm handles per tab, enabling near-instant re-engagement with previous sessions.

### Bug Fixes & Optimizations
- Fixed RAF/fallback race condition: buffered text chunks are now flushed before `task_update` and `task_complete` events
- Fixed missing assistant replies caused by dropped stream chunks during fast streaming
- Request staleness detection to suppress orphaned event streams from cancelled runs
- Better error diagnostics with stderr tail extraction for unknown errors
- Improved notification logic: notifications only fire when the window is hidden or the tab is not active
- Session settings (model, permission mode) now persist across restarts via localStorage
- Electron upgraded from 35.x to 37.x

<br />

## Original Features (by Lucas Couto)

The following features come from the [original Clui CC](https://github.com/lcoutodemos/clui-cc) project:

- **Floating overlay** — transparent, click-through window on top of all workspaces, toggled with `Option + Space`
- **Multi-tab sessions** — each tab runs its own `claude -p` process with independent state, working directory, and model
- **Permission approval** — intercepts tool calls via HTTP hooks. Safe tools auto-approve; dangerous tools (Bash, Edit, Write) require explicit approval with sensitive fields masked
- **Session history & resume** — browse past sessions, search by message or directory, and resume any conversation with full context restored via `--resume`
- **Voice input** — local speech-to-text via Whisper with voice activity detection
- **File & screenshot attachments** — paste images, drag-and-drop files, capture screenshots
- **Markdown rendering** — GitHub-Flavored Markdown with syntax-highlighted code blocks, tables, and embedded images
- **Skills marketplace** — browse, search, and install plugins from Anthropic GitHub repos
- **Slash commands** — `/model`, `/cost`, `/clear`, `/mcp`, `/skills`, `/help`, and more
- **Model selection** — switch between Opus 4.6, Sonnet 4.6, and Haiku 4.5 per session
- **Dual theme** — dark and light mode with system-follow and glass-morphism aesthetic
- **Working directory management** — base directory picker plus additional directories via `--add-dir`
- **Native notifications** — task completion alerts when the overlay is hidden

<br />

## Platform Support

| Platform | Status | Details |
|:---------|:-------|:-------|
| **macOS 13+** | Full | Transparent overlay, system tray, global shortcuts, native notifications |
| **Windows 10+** | Partial | NSIS installer (x64). Tabs, conversations, permissions, marketplace, diffs, and settings work. Overlay transparency and tray are limited |
| **Linux** | Planned | Future support. Contributions welcome |

<br />

## Installation

### One-Click (macOS)

```bash
git clone https://github.com/gustavohenrip/ClaudeCode-Better.git
```

Open the folder in Finder and double-click **`install-app.command`**. This handles dependencies, Whisper, build, and launch.

<p align="center"><img src="docs/shortcut.png" width="520" alt="Press Option + Space to toggle BetterCC" /></p>

> **First launch:** macOS blocks unsigned apps. Go to **System Settings > Privacy & Security > Open Anyway** (once).

<details>
<summary><strong>Developer Setup</strong></summary>

<br />

```bash
git clone https://github.com/gustavohenrip/ClaudeCode-Better.git
cd ClaudeCode-Better
./commands/setup.command
./commands/start.command
```

| Command | Description |
|:--------|:------------|
| `npm run dev` | Development mode with hot reload |
| `npm run dist` | Package macOS `.app` |
| `npm run dist:win` | Package Windows `.exe` (NSIS, x64) |
| `npm run doctor` | Environment diagnostic |

</details>

<details>
<summary><strong>Prerequisites</strong></summary>

<br />

**macOS 13+** or **Windows 10+**. Install in order:

1. **Xcode CLT** (macOS): `xcode-select --install`
2. **Node.js** 20.x or 22.x: `brew install node`
3. **Python setuptools** (3.12+): `python3 -m pip install --upgrade pip setuptools`
4. **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code`
5. **Authenticate**: `claude`
6. **Whisper** (macOS, for voice): `brew install whisper-cli`

> No API keys or `.env` required. Uses your existing Claude Code CLI auth.

</details>

<br />

## Security & Privacy

- **No telemetry** — zero analytics or tracking
- **No cloud dependency** — everything goes through your local Claude CLI
- **Permission brokering** — tool calls intercepted on `127.0.0.1` only, dangerous tools require approval
- **Credential isolation** — `CLAUDECODE` env var stripped from subprocesses
- **Sensitive masking** — tokens, passwords, and API keys masked in the permission UI
- **Auto-deny timeout** — unanswered permissions denied after 5 minutes

<br />

## Compatibility

| Component | Version |
|:----------|:--------|
| macOS | 15.x (Sequoia) |
| Windows | 10+ (x64) |
| Node.js | 20.x, 22.x |
| Electron | 37.x |
| Claude Code CLI | 2.1.71+ |

<br />

## Credits

BetterCC is built on top of [Clui CC](https://github.com/lcoutodemos/clui-cc), created by [Lucas Couto](https://github.com/lcoutodemos). The original project laid the entire foundation: the Electron architecture, ControlPlane process management, permission server, streaming pipeline, React renderer, Zustand store, marketplace integration, and voice input system. All credit for the base application goes to him.

This fork by [Gustavo Puhlmann](https://github.com/gustavohenrip) adds the diff viewer, reasoning controls, thinking support, token tracking, global rules, MCP management, Windows support, and various bug fixes and optimizations.

<br />

## License

[MIT](LICENSE) — Copyright (c) 2025-2026 Lucas Couto. Fork maintained by Gustavo Puhlmann.

<br />

---

<p align="center">
  <sub>Original project by <a href="https://github.com/lcoutodemos">Lucas Couto</a>. Enhanced by <a href="https://github.com/gustavohenrip">Gustavo Puhlmann</a>.</sub>
</p>
