<p align="center">
  <img src="assets/banner.jpg" alt="tetsuocode" width="100%" />
</p>
<p align="center"><strong>AI Coding Assistant, Powered by Grok.</strong></p>

<p align="center">
  <a href="https://github.com/tetsuo-ai/tetsuo-code/stargazers"><img src="https://img.shields.io/github/stars/tetsuo-ai/tetsuo-code?style=flat-square" /></a>
  <a href="https://github.com/tetsuo-ai/tetsuo-code/releases/latest"><img src="https://img.shields.io/github/v/release/tetsuo-ai/tetsuo-code?style=flat-square" /></a>
  <a href="https://github.com/tetsuo-ai/tetsuo-code/blob/main/LICENSE"><img src="https://img.shields.io/github/license/tetsuo-ai/tetsuo-code?style=flat-square" /></a>
  <img src="https://img.shields.io/badge/powered%20by-Grok-blue?style=flat-square" />
</p>

---

An agentic AI coding assistant powered by xAI's Grok. Streaming chat, tool calling (file read/write, shell commands, search), code generation, and more. Available as a **desktop app**, **web app**, **standalone executable**, **pip package**, and a **Neovim plugin**.

## Install

### Desktop App (Electron)

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| Windows | `tetsuocode-electron-windows.exe` |
| macOS | `tetsuocode-electron-macos.dmg` |
| Linux | `tetsuocode-electron-linux.AppImage` or `.deb` |

[Download from Releases](https://github.com/tetsuo-ai/tetsuo-code/releases/latest)

Set your API key in Settings (gear icon) after launching.

### pip Install

```bash
pip install tetsuocode
```

```bash
export XAI_API_KEY="xai-..."
tetsuocode              # opens browser to current directory
tetsuocode /path/to/project --port 8080
tetsuocode --no-browser --password secret
```

### Standalone Executable

No Python required. Download the single-file executable:

| Platform | File |
|----------|------|
| Windows | `tetsuocode-windows.exe` |
| macOS | `tetsuocode-macos` |
| Linux | `tetsuocode-linux` |

[Download from Releases](https://github.com/tetsuo-ai/tetsuo-code/releases/latest)

```bash
export XAI_API_KEY="xai-..."
./tetsuocode-linux              # or tetsuocode-windows.exe
```

### From Source (Development)

```bash
git clone https://github.com/tetsuo-ai/tetsuo-code.git
cd tetsuo-code
pip install flask requests
export XAI_API_KEY="xai-..."
cd web && python app.py
```

Open **http://localhost:5000**.

## Features

### Chat & AI
- Streaming chat with full markdown rendering and syntax highlighting
- Multi-provider support: xAI Grok, OpenAI, Anthropic, Ollama (local)
- Model switching (grok-4-1-fast-reasoning, grok-3-fast, grok-3, grok-3-mini, and more)
- Ghost text inline completions (Tab to accept)
- AI hover tooltips — double-click any code for instant explanation
- Context-aware smart prompt suggestions
- Auto-summarization when context window fills up
- Conversation fork tree — branch and explore alternate paths

### Agentic Tools
- Autonomous tool loop — Grok reads files, writes code, runs commands on its own
- Diff approval flow — review and approve/reject file edits before they apply
- MCP (Model Context Protocol) server support for extending tool capabilities

### Editor
- Built-in code editor with syntax highlighting overlay
- Multi-cursor editing (Ctrl+D select next, Ctrl+Shift+D select all)
- Git blame gutter and file history viewer
- Real-time linting (Python, JavaScript, JSON)
- Diagnostics bar with error/warning counts

### Developer Tools
- Integrated streaming terminal
- Test runner with auto-detection (pytest, jest, go test, cargo test)
- Multi-file code review panel with diffs
- Workspace indexing and token-based search
- File watcher with live reload
- Command palette (Ctrl+K) for quick access to everything

### Security
- Workspace-scoped file access — can't read/write outside your project
- Dangerous command detection and blocking
- Optional password protection
- All traffic stays local (no telemetry)

### More
- Chat persistence across sessions (localStorage)
- Save and load named conversations
- Code block copy buttons
- Multiple themes
- Mobile responsive
- Keyboard shortcuts: `Enter` send, `Shift+Enter` newline, `Ctrl+N` new chat, `Esc` cancel, `Ctrl+K` palette

## Neovim Plugin

For Vim users. Adds an AI chat panel directly in your editor.

**Requirements:** Neovim >= 0.9, curl, an [xAI API key](https://console.x.ai)

```bash
export XAI_API_KEY="xai-..."
```

**lazy.nvim**
```lua
{
  "tetsuo-ai/tetsuo-code",
  config = function()
    require("tetsuo").setup()
  end,
}
```

**packer.nvim**
```lua
use {
  "tetsuo-ai/tetsuo-code",
  config = function()
    require("tetsuo").setup()
  end,
}
```

### Keymaps

| Keymap | Action |
|--------|--------|
| `<leader>tc` | Toggle chat panel |
| `<leader>ta` | Ask a question |
| `<leader>ti` | Inline edit selection (visual mode) |
| `<leader>tr` | Reset conversation |
| `<leader>tf` | Fix diagnostics in current buffer |

| Chat Buffer | Action |
|-------------|--------|
| `i` / `Enter` | Focus input |
| `<C-s>` | Send message |
| `<C-c>` | Cancel response |
| `yc` | Yank code block under cursor |
| `q` | Close panel |
| `R` | Reset chat |

| Command | Action |
|---------|--------|
| `:Tetsuo` | Toggle chat |
| `:TetsuoAsk <prompt>` | One-shot question |
| `:TetsuoInline` | Inline edit selection |
| `:TetsuoModel [model]` | Switch Grok model |
| `:TetsuoSave [name]` | Save conversation |
| `:TetsuoLoad [name]` | Load conversation |
| `:TetsuoReset` | Reset chat |

## Tools

Grok has access to these tools and uses them autonomously:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create/overwrite files |
| `edit_file` | Surgical find-and-replace |
| `run_command` | Execute shell commands |
| `list_files` | Project directory tree |
| `grep_files` | Regex search across files |

The Neovim plugin also exposes `get_current_buffer`, `get_diagnostics`, and `list_buffers`.

## CLI Options

```
tetsuocode [workspace] [options]

Options:
  workspace          Directory to open (default: current directory)
  -p, --port PORT    Port to run on (default: 5000)
  --host HOST        Host to bind to (default: 127.0.0.1)
  --no-browser       Don't auto-open browser
  --password PASS    Set access password
  --api-key KEY      xAI API key (or set XAI_API_KEY env var)
  --version          Show version
```

## Configuration

### Neovim

```lua
require("tetsuo").setup({
  api_key = nil,            -- or set XAI_API_KEY env var
  model = "grok-4-1-fast-reasoning",
  base_url = "https://api.x.ai/v1",
  max_tokens = 4096,
  temperature = 0.7,

  ui = {
    width = 0.38,           -- chat panel width (fraction of editor)
    position = "right",     -- "right" or "left"
    border = "single",
  },

  keymaps = {
    toggle_chat = "<leader>tc",
    ask = "<leader>ta",
    inline_edit = "<leader>ti",
    reset = "<leader>tr",
    fix_diagnostics = "<leader>tf",
  },

  tools = {
    enabled = true,
    max_iterations = 10,
    confirm_writes = true,
    confirm_bash = true,
    bash_timeout = 30000,
  },
})
```

### Project Config

Create a `.tetsuorc` in your project root:

```json
{
  "model": "grok-4-1-fast-reasoning",
  "temperature": 0.5,
  "system_prompt": "You are working on a Rust project using Actix-web."
}
```

## Building from Source

### PyInstaller (standalone executable)

```bash
pip install flask requests pyinstaller
python build_exe.py
# Output: dist/tetsuocode (or dist/tetsuocode.exe on Windows)
```

### Electron (desktop app)

```bash
cd electron
npm install
npm run build          # builds for current platform
npm run build:win      # Windows
npm run build:mac      # macOS
npm run build:linux    # Linux
```

## License

GNU General Public License v3.0
