const vscode = require("vscode");
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const http = require("http");

let pythonProcess = null;
let serverPort = 0;
let statusBar = null;
let chatProvider = null;

// ── Server Management ───────────────────────

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function waitForServer(port, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function attempt() {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => { sock.destroy(); retry(); });
      sock.once("timeout", () => { sock.destroy(); retry(); });
      sock.connect(port, "127.0.0.1");
    }
    function retry() {
      if (Date.now() - start > timeout) reject(new Error("Server timeout"));
      else setTimeout(attempt, 250);
    }
    attempt();
  });
}

function findPython() {
  return process.platform === "win32"
    ? ["python", "python3", "py"]
    : ["python3", "python"];
}

async function startServer(context) {
  serverPort = await findFreePort();
  const config = vscode.workspace.getConfiguration("tetsuocode");
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  const extPath = context.extensionPath;
  const webPath = path.join(extPath, "..", "web");

  const env = {
    ...process.env,
    TETSUO_WORKSPACE: workspace,
    PYTHONPATH: path.join(extPath, ".."),
  };

  const apiKey = config.get("apiKey") || process.env.XAI_API_KEY || "";
  if (apiKey) env.XAI_API_KEY = apiKey;

  for (const py of findPython()) {
    try {
      pythonProcess = spawn(py, ["-m", "web.app", "--port", String(serverPort)], {
        cwd: path.join(extPath, ".."),
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      pythonProcess.stdout.on("data", (d) => {
        console.log(`[tetsuocode] ${d}`);
      });
      pythonProcess.stderr.on("data", (d) => {
        console.error(`[tetsuocode] ${d}`);
      });
      pythonProcess.on("error", () => {});
      pythonProcess.on("exit", (code) => {
        console.log(`[tetsuocode] server exited (${code})`);
        pythonProcess = null;
        if (statusBar) statusBar.text = "$(warning) tetsuocode: offline";
      });

      await waitForServer(serverPort);
      console.log(`[tetsuocode] server running on :${serverPort} via ${py}`);
      return true;
    } catch {
      if (pythonProcess) { pythonProcess.kill(); pythonProcess = null; }
    }
  }
  return false;
}

function killServer() {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
}

// ── Chat Webview Provider ───────────────────

class ChatViewProvider {
  constructor(context) {
    this._context = context;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "send":
          await this._handleSend(msg.text, msg.context);
          break;
        case "cancel":
          this._handleCancel();
          break;
        case "reset":
          this._handleReset();
          break;
        case "getContext":
          this._sendEditorContext();
          break;
        case "approve":
          await this._handleApproval(msg.action, msg.index);
          break;
      }
    });
  }

  postMessage(msg) {
    if (this._view) this._view.webview.postMessage(msg);
  }

  sendPrompt(text) {
    this.postMessage({ type: "inject", text });
  }

  _sendEditorContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const doc = editor.document;
    const selection = editor.selection;
    const selectedText = doc.getText(selection);
    const diagnostics = vscode.languages.getDiagnostics(doc.uri);

    this.postMessage({
      type: "context",
      file: vscode.workspace.asRelativePath(doc.uri),
      fullPath: doc.uri.fsPath,
      language: doc.languageId,
      selection: selectedText,
      line: selection.active.line + 1,
      diagnostics: diagnostics.map((d) => ({
        line: d.range.start.line + 1,
        severity: d.severity === 0 ? "error" : "warning",
        message: d.message,
      })),
    });
  }

  async _handleSend(text, ctx) {
    const config = vscode.workspace.getConfiguration("tetsuocode");
    const model = config.get("model") || "grok-4-1-fast-reasoning";
    const temperature = config.get("temperature") || 0.7;
    const maxTokens = config.get("maxTokens") || 4096;
    const systemPrompt = config.get("systemPrompt") || "";

    const body = JSON.stringify({
      message: text,
      model,
      temperature,
      max_tokens: maxTokens,
      system_prompt: systemPrompt,
      provider: "xai",
      api_key: config.get("apiKey") || "",
      context_mode: "smart",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") {
            this.postMessage({ type: "done" });
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.token) {
              this.postMessage({ type: "token", token: parsed.token });
            } else if (parsed.tool_call) {
              this.postMessage({ type: "tool", call: parsed.tool_call });
            } else if (parsed.tool_result) {
              this.postMessage({ type: "toolResult", result: parsed.tool_result });
            } else if (parsed.error) {
              this.postMessage({ type: "error", error: parsed.error });
            }
          } catch {}
        }
      }
    } catch (err) {
      this.postMessage({ type: "error", error: err.message });
    }
  }

  _handleCancel() {
    fetch(`http://127.0.0.1:${serverPort}/api/cancel`, { method: "POST" }).catch(() => {});
  }

  async _handleReset() {
    await fetch(`http://127.0.0.1:${serverPort}/api/reset`, { method: "POST" }).catch(() => {});
    this.postMessage({ type: "cleared" });
  }

  async _handleApproval(action, index) {
    const endpoint = action === "approve" ? "/api/approve" : "/api/reject";
    await fetch(`http://127.0.0.1:${serverPort}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    }).catch(() => {});
  }

  _getHtml(webview) {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src http://127.0.0.1:*;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
:root {
  --bg: #1e1e1e; --bg2: #252526; --bg3: #2d2d2d; --border: #3e3e3e;
  --text: #cccccc; --text-dim: #888; --text-bright: #e0e0e0;
  --accent: #007acc; --accent-hover: #1a8ad4;
  --green: #4ec9b0; --red: #f44747; --yellow: #dcdcaa;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; height: 100vh; display: flex; flex-direction: column; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.header-title { font-weight: 600; font-size: 12px; color: var(--text-bright); letter-spacing: 0.5px; }
.header-actions { display: flex; gap: 4px; }
.header-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 12px; }
.header-btn:hover { background: var(--bg3); color: var(--text-bright); }
.messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.msg { padding: 10px 12px; border-radius: 8px; line-height: 1.5; word-wrap: break-word; white-space: pre-wrap; }
.msg-user { background: var(--bg3); border: 1px solid var(--border); }
.msg-assistant { background: var(--bg2); }
.msg-label { font-size: 11px; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.msg-label-user { color: var(--accent); }
.msg-label-assistant { color: var(--green); }
.msg-body { white-space: pre-wrap; }
.msg-body code { background: #0d0d0d; padding: 1px 5px; border-radius: 3px; font-family: "Cascadia Code", "Fira Code", Consolas, monospace; font-size: 12px; }
.msg-body pre { background: #0d0d0d; border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin: 8px 0; overflow-x: auto; }
.msg-body pre code { background: none; padding: 0; }
.tool-block { background: #1a1a2e; border: 1px solid #333366; border-radius: 6px; padding: 8px 10px; margin: 6px 0; font-size: 12px; }
.tool-name { color: var(--yellow); font-weight: 600; font-size: 11px; text-transform: uppercase; }
.tool-detail { color: var(--text-dim); margin-top: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 120px; overflow-y: auto; }
.approval-btns { display: flex; gap: 6px; margin-top: 6px; }
.approval-btns button { padding: 3px 10px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; }
.btn-approve { background: #2ea04350; color: var(--green); }
.btn-approve:hover { background: #2ea04380; }
.btn-reject { background: #f4474730; color: var(--red); }
.btn-reject:hover { background: #f4474760; }
.error-msg { color: var(--red); background: #f4474715; border: 1px solid #f4474740; padding: 8px 10px; border-radius: 6px; font-size: 12px; }
.welcome { text-align: center; color: var(--text-dim); padding: 40px 20px; }
.welcome h3 { color: var(--text-bright); margin-bottom: 6px; font-size: 16px; }
.welcome p { font-size: 12px; margin-bottom: 16px; }
.hints { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.hint { padding: 5px 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: 14px; cursor: pointer; font-size: 11px; color: var(--text-dim); transition: all 0.15s; }
.hint:hover { border-color: var(--accent); color: var(--text-bright); }
.context-bar { padding: 4px 12px; background: var(--bg3); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--text-dim); display: none; align-items: center; gap: 6px; }
.context-bar.visible { display: flex; }
.context-file { color: var(--accent); font-family: monospace; }
.context-close { background: none; border: none; color: var(--text-dim); cursor: pointer; margin-left: auto; }
.input-area { padding: 10px 12px; border-top: 1px solid var(--border); background: var(--bg2); }
.input-row { display: flex; gap: 6px; align-items: flex-end; }
.input-row textarea { flex: 1; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit; resize: none; min-height: 36px; max-height: 120px; outline: none; }
.input-row textarea:focus { border-color: var(--accent); }
.send-btn { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap; }
.send-btn:hover { background: var(--accent-hover); }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.send-btn.cancel { background: var(--red); }
.typing { display: inline-block; }
.typing::after { content: ""; animation: blink 0.8s infinite; }
@keyframes blink { 50% { opacity: 0; } }
.status-line { padding: 3px 12px; font-size: 10px; color: var(--text-dim); background: var(--bg2); border-top: 1px solid var(--border); text-align: right; }
</style>
</head>
<body>

<div class="header">
  <span class="header-title">TETSUOCODE</span>
  <div class="header-actions">
    <button class="header-btn" onclick="requestContext()" title="Attach current file">@</button>
    <button class="header-btn" onclick="resetChat()" title="Reset chat">reset</button>
  </div>
</div>

<div class="context-bar" id="contextBar">
  <span>context:</span>
  <span class="context-file" id="contextFile"></span>
  <button class="context-close" onclick="clearContext()">&times;</button>
</div>

<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <h3>tetsuocode</h3>
    <p>AI coding assistant powered by Grok</p>
    <div class="hints">
      <span class="hint" onclick="useHint('explain this file')">explain this file</span>
      <span class="hint" onclick="useHint('find bugs')">find bugs</span>
      <span class="hint" onclick="useHint('write tests')">write tests</span>
      <span class="hint" onclick="useHint('refactor')">refactor</span>
    </div>
  </div>
</div>

<div class="input-area">
  <div class="input-row">
    <textarea id="input" rows="1" placeholder="Ask tetsuocode..." onkeydown="handleKey(event)" oninput="autoResize(this)"></textarea>
    <button class="send-btn" id="sendBtn" onclick="send()">Send</button>
  </div>
</div>
<div class="status-line" id="statusLine">ready</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const welcomeEl = document.getElementById("welcome");
const statusLine = document.getElementById("statusLine");
const contextBar = document.getElementById("contextBar");
const contextFile = document.getElementById("contextFile");

let streaming = false;
let currentAssistant = null;
let currentBody = null;
let assistantText = "";
let editorContext = null;

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

function send() {
  if (streaming) { vscode.postMessage({ type: "cancel" }); return; }
  const text = inputEl.value.trim();
  if (!text) return;

  welcomeEl.style.display = "none";

  let fullMsg = text;
  if (editorContext) {
    if (editorContext.selection) {
      fullMsg += "\\n\\nSelected code from " + editorContext.file + ":\\n\`\`\`" + editorContext.language + "\\n" + editorContext.selection + "\\n\`\`\`";
    } else {
      fullMsg += "\\n\\n(Current file: " + editorContext.file + ")";
    }
  }

  addMessage("user", text);
  inputEl.value = "";
  inputEl.style.height = "auto";
  startStreaming();

  vscode.postMessage({ type: "send", text: fullMsg, context: editorContext });
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg msg-" + role;
  const label = document.createElement("div");
  label.className = "msg-label msg-label-" + role;
  label.textContent = role === "user" ? "You" : "Grok";
  div.appendChild(label);
  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = renderMarkdown(text);
  div.appendChild(body);
  messagesEl.appendChild(div);
  scrollBottom();
  return { div, body };
}

function startStreaming() {
  streaming = true;
  sendBtn.textContent = "Stop";
  sendBtn.className = "send-btn cancel";
  statusLine.textContent = "generating...";
  assistantText = "";
  const { div, body } = addMessage("assistant", "");
  currentAssistant = div;
  currentBody = body;
  currentBody.innerHTML = '<span class="typing"></span>';
}

function stopStreaming() {
  streaming = false;
  sendBtn.textContent = "Send";
  sendBtn.className = "send-btn";
  statusLine.textContent = "ready";
  if (currentBody && assistantText) {
    currentBody.innerHTML = renderMarkdown(assistantText);
  }
  currentAssistant = null;
  currentBody = null;
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<strong style="font-size:14px">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:15px">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:16px">$1</strong>')
    .replace(/\\n/g, '<br>');
}

function addToolBlock(call) {
  if (!currentAssistant) return;
  const block = document.createElement("div");
  block.className = "tool-block";
  const name = document.createElement("div");
  name.className = "tool-name";
  name.textContent = call.name || "tool";
  block.appendChild(name);
  if (call.args) {
    const detail = document.createElement("div");
    detail.className = "tool-detail";
    const args = typeof call.args === "string" ? call.args : JSON.stringify(call.args, null, 2);
    detail.textContent = args.substring(0, 500);
    block.appendChild(detail);
  }
  currentAssistant.appendChild(block);
  scrollBottom();
}

function addToolResult(result) {
  if (!currentAssistant) return;
  const block = document.createElement("div");
  block.className = "tool-block";
  block.style.borderColor = "#334433";
  block.style.background = "#1a2e1a";
  const label = document.createElement("div");
  label.className = "tool-name";
  label.style.color = "#4ec9b0";
  label.textContent = "result";
  block.appendChild(label);
  const detail = document.createElement("div");
  detail.className = "tool-detail";
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  detail.textContent = text.substring(0, 500);
  block.appendChild(detail);
  currentAssistant.appendChild(block);
  scrollBottom();
}

function requestContext() {
  vscode.postMessage({ type: "getContext" });
}

function clearContext() {
  editorContext = null;
  contextBar.classList.remove("visible");
}

function resetChat() {
  vscode.postMessage({ type: "reset" });
}

function useHint(text) {
  inputEl.value = text;
  requestContext();
  setTimeout(() => send(), 300);
}

// Messages from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "token":
      assistantText += msg.token;
      if (currentBody) {
        currentBody.innerHTML = renderMarkdown(assistantText) + '<span class="typing"></span>';
        scrollBottom();
      }
      break;
    case "tool":
      addToolBlock(msg.call);
      break;
    case "toolResult":
      addToolResult(msg.result);
      break;
    case "done":
      stopStreaming();
      break;
    case "error":
      stopStreaming();
      const err = document.createElement("div");
      err.className = "error-msg";
      err.textContent = msg.error;
      messagesEl.appendChild(err);
      scrollBottom();
      break;
    case "cleared":
      messagesEl.innerHTML = "";
      messagesEl.appendChild(welcomeEl);
      welcomeEl.style.display = "";
      break;
    case "context":
      editorContext = msg;
      contextFile.textContent = msg.file + (msg.selection ? " (selection)" : "");
      contextBar.classList.add("visible");
      break;
    case "inject":
      inputEl.value = msg.text;
      requestContext();
      setTimeout(() => send(), 300);
      break;
  }
});

inputEl.focus();
</script>
</body></html>`;
  }
}

function getNonce() {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

// ── Extension Lifecycle ─────────────────────

async function activate(context) {
  console.log("[tetsuocode] activating...");

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(loading~spin) tetsuocode";
  statusBar.tooltip = "tetsuocode - AI Coding Assistant";
  statusBar.command = "tetsuocode.toggle";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Start server
  const ok = await startServer(context);
  if (ok) {
    statusBar.text = "$(sparkle) tetsuocode";
  } else {
    statusBar.text = "$(warning) tetsuocode";
    vscode.window.showErrorMessage(
      "tetsuocode: Could not start server. Ensure Python 3.10+ is installed.",
      "Install Python"
    ).then((choice) => {
      if (choice === "Install Python") {
        vscode.env.openExternal(vscode.Uri.parse("https://python.org/downloads"));
      }
    });
  }

  // Chat sidebar
  chatProvider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("tetsuocode.chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("tetsuocode.toggle", () => {
      vscode.commands.executeCommand("tetsuocode.chat.focus");
    }),

    vscode.commands.registerCommand("tetsuocode.ask", async () => {
      const question = await vscode.window.showInputBox({
        prompt: "Ask tetsuocode",
        placeHolder: "What do you want to know?",
      });
      if (question && chatProvider) {
        await vscode.commands.executeCommand("tetsuocode.chat.focus");
        setTimeout(() => chatProvider.sendPrompt(question), 500);
      }
    }),

    vscode.commands.registerCommand("tetsuocode.explain", () => {
      sendSelectionCommand("Explain this code:");
    }),

    vscode.commands.registerCommand("tetsuocode.refactor", () => {
      sendSelectionCommand("Refactor this code for clarity and performance:");
    }),

    vscode.commands.registerCommand("tetsuocode.fix", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      if (diagnostics.length === 0) {
        vscode.window.showInformationMessage("No diagnostics found in current file.");
        return;
      }
      const errors = diagnostics.map((d) =>
        `Line ${d.range.start.line + 1}: ${d.message}`
      ).join("\n");
      const file = vscode.workspace.asRelativePath(editor.document.uri);
      sendSelectionCommand(`Fix these diagnostics in ${file}:\n${errors}\n\nHere's the code:`);
    }),

    vscode.commands.registerCommand("tetsuocode.tests", () => {
      sendSelectionCommand("Write comprehensive tests for this code:");
    }),

    vscode.commands.registerCommand("tetsuocode.reset", () => {
      if (chatProvider) chatProvider.postMessage({ type: "cleared" });
    })
  );

  console.log("[tetsuocode] activated");
}

function sendSelectionCommand(prompt) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const selection = editor.document.getText(editor.selection);
  const file = vscode.workspace.asRelativePath(editor.document.uri);
  const lang = editor.document.languageId;

  if (!selection) {
    vscode.window.showInformationMessage("Select some code first.");
    return;
  }

  const fullPrompt = `${prompt}\n\nFrom \`${file}\`:\n\`\`\`${lang}\n${selection}\n\`\`\``;

  vscode.commands.executeCommand("tetsuocode.chat.focus");
  setTimeout(() => {
    if (chatProvider) chatProvider.sendPrompt(fullPrompt);
  }, 500);
}

function deactivate() {
  killServer();
}

module.exports = { activate, deactivate };
