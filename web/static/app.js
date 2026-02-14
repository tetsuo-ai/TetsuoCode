// tetsuocode Web - Frontend

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const cancelBtn = document.getElementById("cancelBtn");
const tokenCountEl = document.getElementById("tokenCount");
const chatTitleEl = document.getElementById("chatTitle");
const chatHistoryEl = document.getElementById("chatHistory");

let messages = [];
let streaming = false;
let abortController = null;
let totalTokens = { prompt: 0, completion: 0, total: 0 };
let currentChatId = null;
let chats = {};
let autoScroll = true;
let settings = {
  temperature: 0.7,
  max_tokens: 4096,
  system_prompt: "",
};

// Configure marked for code highlighting
marked.setOptions({
  highlight: function (code, lang) {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch (e) {
      return code;
    }
  },
  breaks: true,
});

// Auto-resize textarea
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
});

// Keyboard shortcuts
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
  if (e.key === "Escape") {
    if (streaming) cancelStream();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && streaming) {
    cancelStream();
  }
  if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!streaming) newChat();
  }
  if (e.key === "," && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    toggleSettings();
  }
});

// Auto-scroll detection
messagesEl.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = messagesEl;
  autoScroll = scrollHeight - scrollTop - clientHeight < 60;
});

function insertPrompt(text) {
  inputEl.value = text;
  inputEl.focus();
  sendMessage();
}

// ── Persistence ──────────────────────────────────────

function saveState() {
  if (!currentChatId) return;
  chats[currentChatId] = {
    title: chatTitleEl.textContent,
    messages: messages,
    tokens: totalTokens,
  };
  try {
    localStorage.setItem("tetsuocode_chats", JSON.stringify(chats));
    localStorage.setItem("tetsuocode_current", currentChatId);
  } catch (e) {}
}

function loadSettings() {
  try {
    const saved = localStorage.getItem("tetsuocode_settings");
    if (saved) settings = { ...settings, ...JSON.parse(saved) };
  } catch (e) {}
}

function saveSettings() {
  try {
    localStorage.setItem("tetsuocode_settings", JSON.stringify(settings));
  } catch (e) {}
}

function loadState() {
  loadSettings();
  try {
    const saved = localStorage.getItem("tetsuocode_chats");
    const current = localStorage.getItem("tetsuocode_current");
    if (saved) {
      chats = JSON.parse(saved);
      renderChatHistory();
      if (current && chats[current]) {
        loadChat(current);
        return;
      }
    }
  } catch (e) {}
  newChat();
}

function renderChatHistory() {
  chatHistoryEl.innerHTML = "";
  const ids = Object.keys(chats).sort((a, b) => Number(b) - Number(a));
  for (const id of ids) {
    const chat = chats[id];
    const item = document.createElement("div");
    item.className = "chat-item" + (id === currentChatId ? " active" : "");
    item.textContent = chat.title || "new chat";
    item.dataset.chatId = id;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "chat-delete";
    deleteBtn.innerHTML = "&times;";
    deleteBtn.setAttribute("aria-label", "Delete chat");
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteChat(id);
    };
    item.appendChild(deleteBtn);

    item.onclick = () => {
      if (streaming) return;
      saveState();
      loadChat(id);
    };
    chatHistoryEl.appendChild(item);
  }
}

function loadChat(id) {
  const chat = chats[id];
  if (!chat) return;

  currentChatId = id;
  messages = chat.messages || [];
  totalTokens = chat.tokens || { prompt: 0, completion: 0, total: 0 };
  chatTitleEl.textContent = chat.title || "new chat";
  tokenCountEl.textContent = totalTokens.total ? `${totalTokens.total.toLocaleString()} tokens` : "";

  messagesEl.innerHTML = "";
  if (messages.length === 0) {
    showWelcome();
  } else {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "user" || msg.role === "assistant") {
        addMessage(msg.role, msg.content, true, msg.timestamp);
      }
    }
  }

  renderChatHistory();
  inputEl.focus();
}

function deleteChat(id) {
  delete chats[id];
  try {
    localStorage.setItem("tetsuocode_chats", JSON.stringify(chats));
  } catch (e) {}

  if (id === currentChatId) {
    const remaining = Object.keys(chats);
    if (remaining.length > 0) {
      loadChat(remaining.sort((a, b) => Number(b) - Number(a))[0]);
    } else {
      newChat();
    }
  } else {
    renderChatHistory();
  }
}

function newChat() {
  if (currentChatId && messages.length > 0) {
    saveState();
  }
  messages = [];
  totalTokens = { prompt: 0, completion: 0, total: 0 };
  currentChatId = Date.now().toString();
  chatTitleEl.textContent = "new chat";
  tokenCountEl.textContent = "";
  messagesEl.innerHTML = "";
  showWelcome();
  renderChatHistory();
  inputEl.focus();
}

function showWelcome() {
  messagesEl.innerHTML = `
    <div class="welcome">
      <h1>tetsuocode</h1>
      <p>ai coding assistant powered by grok</p>
      <div class="welcome-hints">
        <div class="hint" onclick="insertPrompt('explain this codebase')">explain this codebase</div>
        <div class="hint" onclick="insertPrompt('find and fix bugs')">find and fix bugs</div>
        <div class="hint" onclick="insertPrompt('write tests for this project')">write tests</div>
        <div class="hint" onclick="insertPrompt('refactor for performance')">refactor for performance</div>
      </div>
    </div>`;
}

// ── Export / Import ──────────────────────────────────

function exportChats() {
  const data = JSON.stringify(chats, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tetsuocode-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importChats() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        Object.assign(chats, imported);
        localStorage.setItem("tetsuocode_chats", JSON.stringify(chats));
        renderChatHistory();
      } catch (err) {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Settings Panel ──────────────────────────────────

function toggleSettings() {
  const panel = document.getElementById("settingsPanel");
  const isOpen = !panel.classList.contains("hidden");
  if (isOpen) {
    panel.classList.add("hidden");
  } else {
    document.getElementById("settingTemp").value = settings.temperature;
    document.getElementById("settingMaxTokens").value = settings.max_tokens;
    document.getElementById("settingSystemPrompt").value = settings.system_prompt;
    panel.classList.remove("hidden");
  }
}

function applySettings() {
  settings.temperature = parseFloat(document.getElementById("settingTemp").value) || 0.7;
  settings.max_tokens = parseInt(document.getElementById("settingMaxTokens").value) || 4096;
  settings.system_prompt = document.getElementById("settingSystemPrompt").value.trim();
  saveSettings();
  toggleSettings();
}

// ── Rendering ──────────────────────────────────────

function scrollToBottom() {
  if (autoScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderMarkdown(text) {
  let html;
  try {
    html = marked.parse(text);
  } catch (e) {
    html = escapeHtml(text);
  }

  html = html.replace(
    /<pre><code class="language-(\w+)">/g,
    '<pre><div class="code-header"><span>$1</span><button class="copy-btn" onclick="copyCode(this)" aria-label="Copy code">copy</button></div><code class="language-$1">'
  );
  html = html.replace(
    /<pre><code(?! class)>/g,
    '<pre><div class="code-header"><span>text</span><button class="copy-btn" onclick="copyCode(this)" aria-label="Copy code">copy</button></div><code>'
  );

  return html;
}

function copyCode(btn) {
  const code = btn.closest("pre").querySelector("code").textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "copied";
    setTimeout(() => (btn.textContent = "copy"), 2000);
  }).catch(() => {
    btn.textContent = "failed";
    setTimeout(() => (btn.textContent = "copy"), 2000);
  });
}

function copyMessage(btn) {
  const body = btn.closest(".message").querySelector(".message-body");
  const text = body.innerText || body.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = "copied";
    setTimeout(() => (btn.textContent = "copy"), 2000);
  }).catch(() => {
    btn.textContent = "failed";
    setTimeout(() => (btn.textContent = "copy"), 2000);
  });
}

function addMessage(role, content, silent, timestamp) {
  const welcome = messagesEl.querySelector(".welcome");
  if (welcome) welcome.remove();

  const div = document.createElement("div");
  div.className = `message ${role}`;

  const roleLabel = role === "user" ? "you" : "tetsuo";
  const time = formatTime(timestamp || Date.now());
  const actions = role === "assistant"
    ? `<div class="message-actions">
        <button class="msg-action-btn" onclick="copyMessage(this)">copy</button>
        <button class="msg-action-btn" onclick="regenerate()">retry</button>
       </div>`
    : "";

  div.innerHTML = `
    <div class="message-header">
      <span class="message-role">${roleLabel}</span>
      <span class="message-time">${time}</span>
      ${actions}
    </div>
    <div class="message-body">${role === "user" ? escapeHtml(content).replace(/\n/g, "<br>") : renderMarkdown(content)}</div>
  `;

  messagesEl.appendChild(div);
  if (!silent) scrollToBottom();
  return div;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function addThinking() {
  const welcome = messagesEl.querySelector(".welcome");
  if (welcome) welcome.remove();

  document.title = "tetsuocode ...";

  const div = document.createElement("div");
  div.className = "message assistant";
  div.id = "streamingMessage";
  div.innerHTML = `
    <div class="message-header">
      <span class="message-role">tetsuo</span>
    </div>
    <div class="message-body">
      <div class="thinking">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function showToolThinking() {
  const streamMsg = document.getElementById("streamingMessage");
  if (!streamMsg) return;
  const body = streamMsg.querySelector(".message-body");

  let thinkingEl = body.querySelector(".tool-thinking");
  if (!thinkingEl) {
    thinkingEl = document.createElement("div");
    thinkingEl.className = "tool-thinking";
    thinkingEl.innerHTML = `
      <div class="thinking">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>running...</span>
      </div>
    `;
    body.appendChild(thinkingEl);
  }
  scrollToBottom();
}

function removeToolThinking() {
  const streamMsg = document.getElementById("streamingMessage");
  if (!streamMsg) return;
  const thinkingEl = streamMsg.querySelector(".tool-thinking");
  if (thinkingEl) thinkingEl.remove();
}

function formatToolOutput(raw) {
  try {
    const parsed = JSON.parse(raw);
    const pretty = JSON.stringify(parsed, null, 2);
    const highlighted = hljs.highlight(pretty, { language: "json" }).value;
    return highlighted;
  } catch (e) {
    return escapeHtml(raw);
  }
}

function addToolCall(name, args) {
  const streamMsg = document.getElementById("streamingMessage");
  if (!streamMsg) return;

  removeToolThinking();

  const body = streamMsg.querySelector(".message-body");
  const toolDiv = document.createElement("div");
  toolDiv.className = "tool-call";

  let argsPreview = args;
  try {
    const parsed = JSON.parse(args);
    argsPreview = JSON.stringify(parsed, null, 2);
  } catch (e) {}

  if (argsPreview.length > 200) argsPreview = argsPreview.slice(0, 200) + "...";

  toolDiv.innerHTML = `
    <div class="tool-call-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <span class="tool-collapse-icon">&#9660;</span>
      <span class="tool-name">${escapeHtml(name)}</span>
      <span class="tool-status">running</span>
    </div>
    <div class="tool-call-body"><code>${formatToolOutput(argsPreview)}</code></div>
  `;

  body.appendChild(toolDiv);
  showToolThinking();
  scrollToBottom();
}

function addToolResult(name, result) {
  const streamMsg = document.getElementById("streamingMessage");
  if (!streamMsg) return;

  removeToolThinking();

  const toolDivs = streamMsg.querySelectorAll(".tool-call");
  if (toolDivs.length > 0) {
    const lastTool = toolDivs[toolDivs.length - 1];
    const resultBody = lastTool.querySelector(".tool-call-body");
    const statusEl = lastTool.querySelector(".tool-status");
    let preview = result;
    if (preview.length > 500) preview = preview.slice(0, 500) + "...";
    resultBody.innerHTML = `<code>${formatToolOutput(preview)}</code>`;
    if (statusEl) statusEl.textContent = "done";
    // Auto-collapse completed tool calls
    lastTool.classList.add("collapsed");
  }

  showToolThinking();
  scrollToBottom();
}

// ── Chat ──────────────────────────────────────

async function sendMessage(retryText) {
  const text = retryText || inputEl.value.trim();
  if (!text || streaming) return;

  if (!retryText) {
    addMessage("user", text, false, Date.now());
    messages.push({ role: "user", content: text, timestamp: Date.now() });
  }

  if (messages.filter((m) => m.role === "user").length === 1) {
    const title = text.length > 40 ? text.slice(0, 40) + "..." : text;
    chatTitleEl.textContent = title;
  }

  inputEl.value = "";
  inputEl.style.height = "auto";

  streaming = true;
  sendBtn.classList.add("hidden");
  cancelBtn.classList.remove("hidden");

  const streamMsg = addThinking();
  const body = streamMsg.querySelector(".message-body");
  let fullContent = "";
  let hadError = false;

  abortController = new AbortController();

  try {
    const model = document.getElementById("modelSelect").value;
    const payload = { messages, model };
    if (settings.temperature !== 0.7) payload.temperature = settings.temperature;
    if (settings.max_tokens !== 4096) payload.max_tokens = settings.max_tokens;
    if (settings.system_prompt) payload.system_prompt = settings.system_prompt;

    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!resp.ok) {
      throw new Error(`server returned ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);

        let data;
        try {
          data = JSON.parse(payload);
        } catch (e) {
          continue;
        }

        if (data.type === "content") {
          if (!fullContent) {
            body.innerHTML = "";
          }
          removeToolThinking();
          fullContent += data.content;
          body.innerHTML = renderMarkdown(fullContent);
          body.classList.add("streaming-cursor");
          scrollToBottom();
        } else if (data.type === "tool_call") {
          if (!fullContent) body.innerHTML = "";
          addToolCall(data.name, data.args);
        } else if (data.type === "tool_result") {
          addToolResult(data.name, data.result);
        } else if (data.type === "usage") {
          totalTokens.prompt += data.usage.prompt_tokens || 0;
          totalTokens.completion += data.usage.completion_tokens || 0;
          totalTokens.total += data.usage.total_tokens || 0;
          tokenCountEl.textContent = `${totalTokens.total.toLocaleString()} tokens`;
        } else if (data.type === "error") {
          removeToolThinking();
          hadError = true;
          body.innerHTML = `<span class="error-text">${escapeHtml(data.content)}</span><button class="retry-btn" onclick="retryLast()">retry</button>`;
        } else if (data.type === "done") {
          removeToolThinking();
        }
      }
    }
  } catch (e) {
    removeToolThinking();
    if (e.name === "AbortError") {
      if (!fullContent) {
        body.innerHTML = '<span class="dim-text">cancelled</span>';
      }
    } else {
      hadError = true;
      let errorMsg = "connection failed";
      if (e.message.includes("server returned")) {
        errorMsg = e.message;
      } else if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) {
        errorMsg = "network error - check your connection";
      }
      body.innerHTML = `<span class="error-text">${escapeHtml(errorMsg)}</span><button class="retry-btn" onclick="retryLast()">retry</button>`;
    }
  }

  // Finalize
  body.classList.remove("streaming-cursor");
  removeToolThinking();
  streamMsg.removeAttribute("id");
  document.title = "tetsuocode";

  if (fullContent) {
    messages.push({ role: "assistant", content: fullContent, timestamp: Date.now() });

    const userMsgs = messages.filter((m) => m.role === "user");
    if (userMsgs.length === 1) {
      generateTitle(userMsgs[0].content, fullContent);
    }
  }

  streaming = false;
  abortController = null;
  sendBtn.classList.remove("hidden");
  cancelBtn.classList.add("hidden");
  saveState();
  renderChatHistory();
  inputEl.focus();
}

function cancelStream() {
  if (abortController) {
    abortController.abort();
  }
}

function retryLast() {
  if (streaming) return;
  // Remove the error message element
  const allMsgs = messagesEl.querySelectorAll(".message");
  if (allMsgs.length > 0) {
    allMsgs[allMsgs.length - 1].remove();
  }
  // Find the last user message
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    sendMessage(lastUser.content);
  }
}

function regenerate() {
  if (streaming) return;
  // Remove last assistant message from DOM and messages array
  const allMsgs = messagesEl.querySelectorAll(".message");
  if (allMsgs.length > 0) {
    allMsgs[allMsgs.length - 1].remove();
  }
  // Pop the last assistant message
  while (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    messages.pop();
  }
  // Re-send last user message
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    sendMessage(lastUser.content);
  }
}

// ── Smart Titles ──────────────────────────────

async function generateTitle(userMsg, assistantMsg) {
  try {
    const model = document.getElementById("modelSelect").value;
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: userMsg },
          { role: "assistant", content: assistantMsg.slice(0, 500) },
          { role: "user", content: "Generate a 3-5 word title for this conversation. Reply with ONLY the title, no quotes, no punctuation, all lowercase." },
        ],
        model,
      }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let title = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "content") title += data.content;
        } catch (e) {}
      }
    }

    title = title.trim().toLowerCase().replace(/['"`.]/g, "");
    if (title && title.length > 0 && title.length < 60) {
      chatTitleEl.textContent = title;
      saveState();
      renderChatHistory();
    }
  } catch (e) {}
}

// ── Mobile ──────────────────────────────────────

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  sidebar.classList.toggle("open");
  overlay.classList.toggle("hidden");
}

// ── Prompt Templates ──────────────────────────────

const defaultTemplates = [
  { name: "explain code", prompt: "Explain what this code does and how it works" },
  { name: "find bugs", prompt: "Find and fix any bugs in this code" },
  { name: "write tests", prompt: "Write comprehensive tests for this project" },
  { name: "refactor", prompt: "Refactor this code for better performance and readability" },
  { name: "add docs", prompt: "Add documentation and comments to this code" },
  { name: "security audit", prompt: "Review this code for security vulnerabilities" },
];

function toggleTemplates() {
  const menu = document.getElementById("templateMenu");
  menu.classList.toggle("hidden");
  if (!menu.classList.contains("hidden")) {
    renderTemplates();
  }
}

function renderTemplates() {
  const menu = document.getElementById("templateMenu");
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem("tetsuocode_templates") || "[]");
  } catch (e) {}
  const all = [...defaultTemplates, ...saved];

  menu.innerHTML = all.map((t, i) =>
    `<div class="template-item" onclick="useTemplate(${i})">
      <span>${escapeHtml(t.name)}</span>
    </div>`
  ).join("") +
  `<div class="template-item template-save" onclick="saveTemplate()">
    <span>+ save current as template</span>
  </div>`;
}

function useTemplate(index) {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem("tetsuocode_templates") || "[]");
  } catch (e) {}
  const all = [...defaultTemplates, ...saved];
  if (all[index]) {
    inputEl.value = all[index].prompt;
    inputEl.focus();
  }
  document.getElementById("templateMenu").classList.add("hidden");
}

function saveTemplate() {
  const text = inputEl.value.trim();
  if (!text) { alert("Type a prompt first, then save it as a template."); return; }
  const name = prompt("Template name:");
  if (!name) return;
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem("tetsuocode_templates") || "[]");
  } catch (e) {}
  saved.push({ name, prompt: text });
  localStorage.setItem("tetsuocode_templates", JSON.stringify(saved));
  document.getElementById("templateMenu").classList.add("hidden");
}

// ── Init ──────────────────────────────────────

loadState();
inputEl.focus();
