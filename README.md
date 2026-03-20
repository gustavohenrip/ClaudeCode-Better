<p align="center">
  <img src="CLUI.png" width="120" alt="Clui CC" />
</p>

<h1 align="center">Clui CC</h1>

<p align="center">
  <strong>The desktop interface for Claude Code.</strong><br />
  A transparent, floating overlay that brings multi-tab sessions, permission controls, voice input, and a skills marketplace to the Claude Code CLI.
</p>

<p align="center">
  <a href="https://github.com/lcoutodemos/clui-cc/releases"><img src="https://img.shields.io/badge/version-0.1.0-d97757?style=flat-square" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="License" /></a>
  <a href="#"><img src="https://img.shields.io/badge/platform-macOS_13+-111827?style=flat-square&logo=apple&logoColor=white" alt="macOS" /></a>
  <a href="#"><img src="https://img.shields.io/badge/platform-Windows_(partial)-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows" /></a>
  <a href="https://github.com/lcoutodemos/clui-cc/stargazers"><img src="https://img.shields.io/github/stars/lcoutodemos/clui-cc?style=flat-square&color=d97757" alt="Stars" /></a>
  <a href="https://github.com/lcoutodemos/clui-cc/network/members"><img src="https://img.shields.io/github/forks/lcoutodemos/clui-cc?style=flat-square&color=6b7280" alt="Forks" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-37-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4.2-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Zustand-5-443a2e?style=flat-square" alt="Zustand" />
  <img src="https://img.shields.io/badge/Framer_Motion-12-d946ef?style=flat-square&logo=framer&logoColor=white" alt="Framer Motion" />
</p>

<br />

<p align="center">
  <a href="https://www.youtube.com/watch?v=NqRBIpaA4Fk">
    <img src="https://img.youtube.com/vi/NqRBIpaA4Fk/maxresdefault.jpg" width="720" alt="Clui CC Demo" />
  </a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=NqRBIpaA4Fk"><strong>Watch the demo</strong></a>&ensp;&middot;&ensp;<a href="docs/ARCHITECTURE.md"><strong>Architecture</strong></a>&ensp;&middot;&ensp;<a href="docs/TROUBLESHOOTING.md"><strong>Troubleshooting</strong></a>&ensp;&middot;&ensp;<a href="https://github.com/lcoutodemos/clui-cc/issues"><strong>Report a Bug</strong></a>
</p>

<br />

---

<br />

## Overview

Clui CC is a native desktop application that wraps the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI in a floating overlay window. It spawns `claude -p` subprocesses, parses their real-time NDJSON output, and renders conversations in a rich graphical interface — without replacing or forking the CLI itself.

Every interaction flows through your local Claude Code installation. No API keys required beyond your existing Claude Pro, Team, or Enterprise subscription. No telemetry. No cloud dependency.

<br />

## Platform Support

| Platform | Status | Notes |
|:---------|:-------|:------|
| **macOS 13+** | Full support | Transparent overlay, system tray, global shortcuts, native notifications |
| **Windows** | Partial support | NSIS installer, window management, dialog support. Overlay transparency and tray icon are limited |
| **Linux** | Not implemented | Contributions welcome |

macOS is the primary development target. The Windows build (`npm run dist:win`) produces an x64 NSIS installer with configurable install directory. Core features (multi-tab sessions, permission approval, conversation rendering, marketplace) work cross-platform. Platform-specific features like the transparent floating overlay and `Option + Space` global shortcut are macOS-only.

<br />

## Why Clui CC

| Problem | Solution |
|:--------|:---------|
| The CLI lacks a visual layer for approvals, history, and multitasking | Floating overlay with multi-tab sessions and persistent conversation history |
| Tool calls execute without explicit review | Human-in-the-loop permission system — review and approve every tool call before execution |
| Switching between terminal sessions is slow | Independent tabs, each with its own Claude session, resumable at any time |
| No native voice or attachment support in the CLI | Built-in speech-to-text via Whisper and drag-and-drop file attachments |
| Plugin discovery requires manual CLI commands | In-app skills marketplace with search, install, and management |
| Past sessions are lost or hard to find | Full session history browser with search, metadata, and one-click resume |
| No visual feedback during file edits | Inline diff viewer showing added and removed lines for every Edit and Write operation |

<br />

## Features

### Floating Overlay

Clui CC runs as a transparent, always-on-top window that floats above all your workspaces. The overlay is click-through in its transparent regions, so you can interact with apps behind it without switching focus. Toggle it instantly with `Option + Space` (macOS) or `Cmd+Shift+K` as fallback. The window uses a glass-morphism aesthetic with backdrop blur and smooth spring-based entrance and exit animations powered by Framer Motion. On macOS, it pins to all Spaces and desktops.

### Multi-Tab Sessions

Each tab spawns its own independent `claude -p` subprocess with fully isolated state. Tabs track their own message history, working directory, additional directories, model selection, token usage, and session ID. Status dots on each tab show the current state at a glance:

- **Gray** — idle, ready for input
- **Orange (pulsing)** — running or connecting
- **Green** — task completed successfully
- **Red** — task failed or session crashed
- **Purple (glowing)** — awaiting permission approval

Tabs show an unread indicator when new messages arrive in a background tab. You can queue messages while a task is running — they appear as dashed-border bubbles and execute in order after the current task completes. Each tab supports up to 32 queued requests with backpressure management.

### Session History & Resume

Every Claude Code session is stored with its full transcript, messages, metadata, working directory, and session context. The history picker (clock icon in the header) opens a searchable panel where you can:

- Browse all previous sessions sorted by recency
- Search by first message, session slug, project directory, or file path
- See session metadata: first message preview, project directory, relative timestamp, and session size
- Resume any session with a single click — this creates a new tab and restores the full conversation history, working directory, and session context using Claude Code's native `--resume <session-id>` flag

Resumed sessions pick up exactly where they left off. The working directory, additional directories, and session ID are all preserved, so Claude has full context of what happened before.

### Permission Approval System

Clui CC intercepts every tool call from Claude via PreToolUse HTTP hooks running on `127.0.0.1:19836`. When Claude wants to execute a tool, the request is routed to a permission card in the UI where you can review the tool name, its input parameters, and the full context before approving or denying.

The system automatically classifies tools by risk level:

**Auto-approved (safe, read-only):**
- Read, Glob, Grep, Agent, Task, TodoWrite, WebSearch, WebFetch, Notebook
- Safe bash commands: `cat`, `ls`, `find`, `grep`, `git status`, `git log`, `git diff`, `npm info`, `node --version`, and similar read-only operations

**Requires explicit approval:**
- Bash (when writing, installing, pushing, or executing scripts)
- Edit, Write, MultiEdit (file modifications)
- External MCP tools (`mcp__*`)
- Any bash command with redirects (`>`, `>>`, `|`), `rm`, `git push`, `git commit`, `npm install`, `pip install`, or similar mutation operations

Sensitive fields (tokens, passwords, API keys, secrets, credentials) are automatically masked with `***` in the permission card before display. Unanswered permission requests are auto-denied after 5 minutes to prevent stalled sessions.

Two permission modes are available:
- **Ask** (default) — shows permission cards, you approve or deny each tool call
- **Auto** — silently approves all tool calls without prompting

### Voice Input

Record voice directly from the input bar using the microphone button. Audio is captured via WebRTC, resampled to 16kHz WAV, and transcribed locally using Whisper (no cloud API). During recording, cancel and confirm buttons replace the mic icon. Voice activity detection rejects silent recordings (below 0.003 RMS threshold) to avoid empty transcriptions. The transcribed text is appended to your current input, so you can combine typed and spoken text.

### File & Screenshot Attachments

Attach files and images to any prompt:

- **Paste images** directly from your clipboard into the input field
- **Drag and drop** files onto the input bar
- **Capture screenshots** from within the app
- Supported image formats: PNG, JPEG, GIF, WebP, SVG
- Supported file formats: plain text, markdown, JSON, YAML, TOML

Each attachment appears as a chip above the input with a thumbnail preview (for images) or file icon (for documents). Hover to reveal the remove button. When you send a message with attachments only (no text), Clui CC automatically adds a context message so Claude knows to examine the attached files.

### Conversation Rendering

Messages are rendered with full GitHub-Flavored Markdown support via react-markdown and remark-gfm:

- Syntax-highlighted code blocks with language detection
- Tables, bold, italic, strikethrough, and all inline formatting
- Clickable links that open in your default browser
- Embedded images that open in an external viewer
- Tool call cards showing execution progress with collapsible timelines
- Thinking blocks (when Extended Thinking is enabled) displayed as expandable boxes showing Claude's internal reasoning
- Copy button on assistant messages (appears on hover)

Message history is lazy-loaded: the initial view shows the most recent 100 messages, with a "Load older messages" button to paginate further. Auto-scroll keeps the view pinned to the latest message when you're near the bottom, but stays in place when you scroll up to read history.

### Inline Diff Viewer

Every Edit and Write operation from Claude displays an inline diff visualization directly in the conversation. The diff viewer uses an LCS (Longest Common Subsequence) algorithm to compute changes and shows:

- Added lines highlighted in green with `+` prefix
- Removed lines highlighted in red with `-` prefix
- Unchanged context lines for reference
- Syntax-aware formatting matching the file type

This gives you immediate visual feedback on exactly what Claude changed in your files before or after approving the operation.

### Model Selection & Reasoning

Switch between Claude models at any time from the status bar or via slash commands:

| Model | Slash Command | Max Effort |
|:------|:--------------|:-----------|
| Claude Opus 4.6 | `/model opus` | `max` |
| Claude Sonnet 4.6 | `/model sonnet` | `high` |
| Claude Haiku 4.5 | `/model haiku` | `high` |

Configure reasoning effort per session:
- **Low** — fastest responses, lowest token usage
- **Medium** — balanced speed and depth
- **High** — deeper reasoning, higher token usage
- **Max** — full reasoning capacity (Opus only), displayed with a gradient icon in the status bar

Extended Thinking can be toggled independently via `/thinking on` or `/thinking off`. When enabled, Claude's internal reasoning appears as expandable thinking blocks in the conversation, letting you see how it arrived at its answer.

### Token & Cost Tracking

The status bar displays real-time token usage with a formatted counter (e.g., "1.5k tokens", "2.3M tokens"). Hover over the counter to see the full breakdown:

- Input tokens consumed
- Output tokens generated
- Cache read tokens (saved from previous turns)
- Cache write tokens (stored for future turns)

After each task completes, use `/cost` to see the detailed run summary: total USD cost, execution duration, number of turns, and complete token breakdown. Example output: `$0.0123 / 5.2s / 3 turns / 1200 in / 340 out`.

Native macOS notifications fire when a task completes while the overlay is hidden, showing the tab name, completion time, and working directory. Notification sounds can be enabled or disabled in settings.

### Working Directory & Project Scope

Each tab has a base working directory that defines where Claude operates. Set it from the status bar's folder icon or the empty-state directory picker when creating a new tab. Beyond the base directory, you can add multiple additional directories to expand Claude's scope without changing the base:

- The directory popover shows the base directory and all additional directories
- Each additional directory has a remove button
- A `+N` badge on the folder icon indicates how many extra directories are attached
- Directories persist across session resumes
- Selection is disabled while a task is running to prevent mid-execution conflicts

Additional directories are passed to Claude via `--add-dir` flags, giving Claude read access to files across your entire project structure even when it spans multiple locations.

### Skills Marketplace

Browse and install plugins from Anthropic's official GitHub repositories without leaving the app. The marketplace fetches catalogs from three sources:

- `anthropics/skills` — Agent Skills
- `anthropics/knowledge-work-plugins` — Knowledge Work
- `anthropics/financial-services-plugins` — Financial Services

The marketplace panel features:
- Full-text search across plugin names, descriptions, tags, and authors
- Category filter chips sorted by frequency, plus an "Installed" filter
- Two-column grid of expandable plugin cards showing name, description, author, and tags
- One-click install and uninstall with real-time status feedback (checking, installing, installed, failed)
- "Build your own" link to the skill creation guide
- Refresh button to force-update the catalog
- 5-minute cache TTL with graceful offline fallback

Installed skills automatically appear as slash commands (`/skillname`) in the input bar's autocomplete menu, ready to use in any session.

### MCP Server Management

View and manage Model Context Protocol servers directly from the settings panel:

- Connected servers show a green status dot; failed servers show red; others show gray
- Add new servers with type selection (stdio or HTTP), command/URL configuration, and optional environment variables
- Remove servers with a single click
- Changes take effect on session restart

### Settings & Preferences

The settings popover (three dots icon in the header) provides three tabs:

**General:**
- Expanded UI toggle (switches conversation height between compact and full modes)
- Notification sound toggle
- Dark/light theme toggle (follows system preference by default)
- Effort level selector (segmented control: Low / Medium / High / Max)
- Extended Thinking toggle

**Rules:**
- Global system prompt textarea applied to all sessions across all directories
- Persisted to localStorage across restarts

**MCP:**
- Server list with status indicators
- Add/remove server controls with full configuration options

<br />

## Slash Commands

| Command | Description |
|:--------|:------------|
| `/clear` | Clear conversation history |
| `/compact` | Compact conversation context |
| `/config` | Open settings |
| `/context` | Show context usage |
| `/copy` | Copy last response |
| `/cost` | Display last run cost, duration, turns, and tokens |
| `/diff` | Show file changes |
| `/doctor` | Diagnose installation |
| `/effort` | Set reasoning effort: `low`, `medium`, `high`, `max` |
| `/export` | Export conversation |
| `/fast` | Toggle fast mode |
| `/help` | Show all available commands |
| `/init` | Initialize project CLAUDE.md |
| `/mcp` | Show MCP server status |
| `/memory` | Edit CLAUDE.md memories |
| `/model` | Show or switch model (e.g. `/model sonnet`) |
| `/permissions` | View tool permissions |
| `/rewind` | Revert to checkpoint |
| `/skills` | Show available skills |
| `/status` | Show session status |
| `/thinking` | Toggle extended thinking |
| `/usage` | Show plan limits |

Installed skills inject dynamic commands (e.g. `/skill-creator`) into the autocomplete menu at runtime.

<br />

## How It Works

```
User prompt (text / voice / files)
       |
       v
  React UI  -->  IPC Bridge  -->  ControlPlane
                                       |
                                       v
                                  RunManager spawns
                                  claude -p --output-format stream-json
                                       |
                                       v
                                  NDJSON stream
                                       |
                          +------------+------------+
                          |                         |
                          v                         v
                   EventNormalizer            PermissionServer
                   (text, tools,             (HTTP hook on 127.0.0.1)
                    task status)                    |
                          |                         v
                          |                  PermissionCard UI
                          |                  (Allow / Deny)
                          |                         |
                          +------------+------------+
                                       |
                                       v
                               Zustand Store update
                                       |
                                       v
                              ConversationView render
```

The ControlPlane is the single authority for all tab and session lifecycle. It manages a registry of active tabs, enforces state transitions (`connecting` > `idle` > `running` > `completed` / `failed` / `dead`), queues requests with backpressure (max 32 pending), and delegates to RunManager for process spawning and PermissionServer for tool approval routing.

Text chunks from Claude are batched per animation frame (requestAnimationFrame) to prevent React re-render thrashing during fast streaming. A dedicated flush mechanism ensures all buffered text is committed before task completion events arrive, eliminating race conditions between streamed content and final output.

The renderer polls backend health every 1.5 seconds and reconciles tab state, recovering gracefully from process crashes or unexpected exits. Each subprocess run is tracked with a unique security token to prevent cross-run event confusion.

Full technical deep-dive: [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md)

<br />

## Installation

### One-Click Install (Recommended)

Clone the repository and double-click the installer:

```bash
git clone https://github.com/lcoutodemos/clui-cc.git
```

Open the `clui-cc` folder in Finder and double-click **`install-app.command`**.

This installs all dependencies, sets up Whisper for voice support, builds the application, copies it to `/Applications`, and launches it.

<p align="center"><img src="docs/shortcut.png" width="520" alt="Press Option + Space to toggle Clui CC" /></p>

> **First launch:** macOS may block the app because it is unsigned. Go to **System Settings > Privacy & Security > Open Anyway**. This is required only once.

After the initial install, open **Clui CC** from your Applications folder or Spotlight.

<br />

<details>
<summary><strong>Developer Setup</strong></summary>

<br />

#### Quick Start

```bash
git clone https://github.com/lcoutodemos/clui-cc.git
cd clui-cc
./commands/setup.command
./commands/start.command
```

Press **Option + Space** to toggle the overlay. If your macOS input source claims that shortcut, use **Cmd+Shift+K**.

#### Development Mode

```bash
npm install
npm run dev
```

Renderer changes hot-reload instantly. Main process changes require restarting `npm run dev`.

#### Commands

| Command | Description |
|:--------|:------------|
| `./commands/setup.command` | Check environment and install dependencies |
| `./commands/start.command` | Build and launch from source |
| `./commands/stop.command` | Stop all Clui CC processes |
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Production build (no packaging) |
| `npm run dist` | Package as macOS `.app` into `release/` |
| `npm run dist:win` | Package as Windows `.exe` (NSIS installer, x64) |
| `npm run doctor` | Run environment diagnostic |

</details>

<details>
<summary><strong>Prerequisites</strong></summary>

<br />

Clui CC requires **macOS 13 or later** (primary) or **Windows 10+** (partial). Install the following dependencies in order:

**1. Xcode Command Line Tools** (macOS only)

```bash
xcode-select --install
```

**2. Node.js** (20.x LTS or 22.x recommended, 18.x minimum)

```bash
brew install node
```

**3. Python setuptools** (required for native module compilation on Python 3.12+)

```bash
python3 -m pip install --upgrade pip setuptools
```

**4. Claude Code CLI**

```bash
npm install -g @anthropic-ai/claude-code
```

**5. Authenticate Claude Code**

```bash
claude
```

**6. Whisper** (for voice input, macOS only)

```bash
brew install whisper-cli
```

> No API keys or `.env` file required. Clui CC uses your existing Claude Code CLI authentication (Pro, Team, or Enterprise subscription).

</details>

<br />

## Architecture

```
+--------------------------------------------------------------+
|                     Renderer Process                          |
|  React 19 + Zustand 5 + Tailwind CSS 4 + Framer Motion       |
|                                                               |
|  TabStrip | ConversationView | InputBar | MarketplacePanel    |
|                         |                                     |
|                    sessionStore (Zustand)                      |
|                         |                                     |
|              window.clui (preload bridge)                      |
+--------------------------------------------------------------+
|                     Preload Script                             |
|  Typed IPC bridge via contextBridge.exposeInMainWorld         |
+--------------------------------------------------------------+
|                     Main Process                              |
|                                                               |
|  ControlPlane                                                 |
|    Tab registry, session lifecycle, queue management          |
|    RunManager ---- EventNormalizer                            |
|    (claude -p)     (stream-json -> canonical events)          |
|                                                               |
|  PermissionServer          Marketplace Catalog                |
|  HTTP hooks on             GitHub raw fetch + cache           |
|  127.0.0.1:19836           TTL: 5 minutes                    |
+--------------------------------------------------------------+
         |                              |
    claude -p (NDJSON)          raw.githubusercontent.com
    (local subprocess)          (optional, cached)
```

### Project Structure

```
src/
  main/
    claude/          ControlPlane, RunManager, EventNormalizer
    hooks/           PermissionServer (PreToolUse HTTP hooks)
    marketplace/     Plugin catalog fetching and installation
    skills/          Skill auto-installer with pinned commit SHAs
    index.ts         Window creation, IPC handlers, tray, shortcuts
  renderer/
    components/      TabStrip, ConversationView, InputBar, DiffViewer, ...
    stores/          Zustand session store (single source of truth)
    hooks/           Event listeners, health reconciliation
    theme.ts         Dual palette with CSS custom properties
  preload/
    index.ts         Secure IPC bridge (window.clui API)
  shared/
    types.ts         Canonical types, IPC channel definitions, state
```

<br />

## Security & Privacy

Clui CC is designed with a local-first, zero-trust approach:

- **No telemetry** — no analytics, tracking, or usage data collection of any kind.
- **No cloud dependency** — all Claude Code interaction goes through your local CLI binary.
- **Permission brokering** — tool calls from Claude are intercepted via HTTP hooks on `127.0.0.1` only. Dangerous tools require explicit user approval before execution.
- **Credential isolation** — the `CLAUDECODE` environment variable is stripped from spawned subprocesses to prevent credential leakage.
- **Sensitive field masking** — tokens, passwords, API keys, and credentials are automatically masked in the permission card UI before display.
- **Per-run security tokens** — each subprocess run is assigned a unique token to prevent cross-run confusion.
- **Timeout protection** — unanswered permission requests are automatically denied after 5 minutes.

### Network Behavior

| Endpoint | Purpose | Required |
|:---------|:--------|:---------|
| `raw.githubusercontent.com/anthropics/*` | Marketplace catalog (cached 5 min) | No |
| `api.github.com/repos/anthropics/*/tarball/*` | Skill auto-install on startup | No |

Both endpoints degrade gracefully when offline. All core functionality operates without any network access.

<br />

## Keyboard Shortcuts

| Shortcut | Action |
|:---------|:-------|
| `Option + Space` | Toggle overlay visibility (macOS) |
| `Cmd + Shift + K` | Toggle overlay (fallback) |
| `Enter` | Send message |
| `Shift + Enter` | New line in input |
| `Escape` | Hide overlay (or close slash menu if open) |
| `/` | Open slash command menu |
| `Arrow Up / Down` | Navigate slash command menu |
| `Tab` | Select slash command option |

<br />

## Compatibility

| Component | Tested Version |
|:----------|:---------------|
| macOS | 15.x (Sequoia) |
| Windows | 10+ (partial, x64 only) |
| Node.js | 20.x LTS, 22.x |
| Python | 3.12+ (with setuptools) |
| Electron | 37.x |
| Claude Code CLI | 2.1.71+ |

<br />

## Known Limitations

- **Windows is partial** — core features (tabs, conversations, permissions, marketplace) work, but the transparent floating overlay, system tray, and `Option + Space` shortcut are macOS-specific. Linux is not yet implemented.
- **Requires Claude Code CLI** — Clui CC is a graphical layer, not a standalone AI client. An authenticated local `claude` binary is required.
- **No auto-update** — updates are manual via `git pull` and rebuild.
- **Unsigned binary** — the packaged `.app` (macOS) and `.exe` (Windows) are not code-signed. macOS Gatekeeper and Windows SmartScreen will block the first launch until you approve it.
- **Whisper requires Homebrew** — voice input depends on `whisper-cli` installed via Homebrew (macOS only).

<br />

## Troubleshooting

Run the built-in diagnostic:

```bash
npm run doctor
```

For detailed solutions to common issues (native module compilation, Python distutils, Whisper setup, permission errors, window visibility), see [**docs/TROUBLESHOOTING.md**](docs/TROUBLESHOOTING.md).

<br />

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

<br />

## License

Released under the [MIT License](LICENSE).

Copyright (c) 2025-2026 Lucas Couto.

<br />

---

<p align="center">
  <sub>Built for developers who want Claude Code with a visual layer.</sub>
</p>
