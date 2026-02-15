// tetsuocode Web - Frontend

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const cancelBtn = document.getElementById("cancelBtn");
const tokenCountEl = document.getElementById("tokenCount");
const chatTitleEl = document.getElementById("chatTitle");
const chatHistoryEl = document.getElementById("chatHistory");
const chatArea = document.getElementById("chatArea");

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
  provider: "xai",
  api_key: "",
  sound: false,
};

// Configure marked
marked.setOptions({
  highlight: function (code, lang) {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    } catch (e) { return code; }
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
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === "Escape" && streaming) cancelStream();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && streaming) cancelStream();
  if (e.key === "Escape" && !document.getElementById("searchOverlay").classList.contains("hidden")) closeSearch();
  if (e.key === "n" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!streaming) newChat(); }
  if (e.key === "," && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleSettings(); }
  if (e.key === "f" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openSearch(); }
});

// Auto-scroll
messagesEl.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = messagesEl;
  autoScroll = scrollHeight - scrollTop - clientHeight < 60;
});

// Drag and drop
chatArea.addEventListener("dragover", (e) => { e.preventDefault(); document.getElementById("dropZone").classList.remove("hidden"); });
chatArea.addEventListener("dragleave", (e) => {
  if (!chatArea.contains(e.relatedTarget)) document.getElementById("dropZone").classList.add("hidden");
});
chatArea.addEventListener("drop", (e) => {
  e.preventDefault();
  document.getElementById("dropZone").classList.add("hidden");
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});

function insertPrompt(text) { inputEl.value = text; inputEl.focus(); sendMessage(); }

// ── Auth ──────────────────────────────────────

async function checkAuth() {
  try {
    const resp = await fetch("/api/auth/check");
    const data = await resp.json();
    if (data.required && !data.authenticated) {
      document.getElementById("loginOverlay").classList.remove("hidden");
      document.getElementById("loginPassword").focus();
      return false;
    }
  } catch (e) {}
  return true;
}

async function submitLogin() {
  const pw = document.getElementById("loginPassword").value;
  try {
    const resp = await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (resp.ok) {
      document.getElementById("loginOverlay").classList.add("hidden");
      loadState();
    } else {
      document.getElementById("loginError").classList.remove("hidden");
    }
  } catch (e) {
    document.getElementById("loginError").classList.remove("hidden");
  }
}

document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitLogin();
});

// ── Persistence ──────────────────────────────────

function saveState() {
  if (!currentChatId) return;
  chats[currentChatId] = { title: chatTitleEl.textContent, messages, tokens: totalTokens };
  try {
    localStorage.setItem("tetsuocode_chats", JSON.stringify(chats));
    localStorage.setItem("tetsuocode_current", currentChatId);
  } catch (e) {}
}

function loadSettings() {
  try {
    const s = localStorage.getItem("tetsuocode_settings");
    if (s) settings = { ...settings, ...JSON.parse(s) };
  } catch (e) {}
}

function saveSettings() {
  try { localStorage.setItem("tetsuocode_settings", JSON.stringify(settings)); } catch (e) {}
}

function loadState() {
  loadSettings();
  try {
    const saved = localStorage.getItem("tetsuocode_chats");
    const current = localStorage.getItem("tetsuocode_current");
    if (saved) {
      chats = JSON.parse(saved);
      renderChatHistory();
      if (current && chats[current]) { loadChat(current); return; }
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
    const del = document.createElement("button");
    del.className = "chat-delete";
    del.innerHTML = "&times;";
    del.onclick = (e) => { e.stopPropagation(); deleteChat(id); };
    item.appendChild(del);
    item.onclick = () => { if (streaming) return; saveState(); loadChat(id); };
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
  if (messages.length === 0) { showWelcome(); }
  else { for (const msg of messages) { if (msg.role === "user" || msg.role === "assistant") addMessage(msg.role, msg.content, true, msg.timestamp); } }
  renderChatHistory();
  inputEl.focus();
}

function deleteChat(id) {
  delete chats[id];
  try { localStorage.setItem("tetsuocode_chats", JSON.stringify(chats)); } catch (e) {}
  if (id === currentChatId) {
    const rem = Object.keys(chats);
    if (rem.length > 0) loadChat(rem.sort((a, b) => Number(b) - Number(a))[0]);
    else newChat();
  } else renderChatHistory();
}

function newChat() {
  if (currentChatId && messages.length > 0) saveState();
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

// ── Export / Import ──────────────────────────

function exportChats() {
  const blob = new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tetsuocode-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importChats() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".json";
  input.onchange = (e) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        Object.assign(chats, JSON.parse(ev.target.result));
        localStorage.setItem("tetsuocode_chats", JSON.stringify(chats));
        renderChatHistory();
      } catch (err) { alert("Invalid JSON"); }
    };
    reader.readAsText(e.target.files[0]);
  };
  input.click();
}

function exportMarkdown() {
  if (!messages.length) return;
  let md = `# ${chatTitleEl.textContent}\n\n`;
  for (const msg of messages) {
    if (msg.role === "user") md += `## You\n\n${msg.content}\n\n`;
    else if (msg.role === "assistant") md += `## Tetsuo\n\n${msg.content}\n\n`;
  }
  const blob = new Blob([md], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${chatTitleEl.textContent.replace(/[^a-z0-9]/gi, "-")}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── File Upload ──────────────────────────────

async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  try {
    const resp = await fetch("/api/upload", { method: "POST", body: form });
    const data = await resp.json();
    if (data.image) {
      inputEl.value += `\n[Attached image: ${data.filename}]`;
    } else if (data.content) {
      inputEl.value += `\n\`\`\`\n// ${data.filename}\n${data.content.slice(0, 5000)}\n\`\`\``;
    }
    inputEl.focus();
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
  } catch (e) {
    alert("Upload failed");
  }
}

// ── Settings ──────────────────────────────────

function toggleSettings() {
  const panel = document.getElementById("settingsPanel");
  if (!panel.classList.contains("hidden")) { panel.classList.add("hidden"); return; }
  document.getElementById("settingProvider").value = settings.provider;
  document.getElementById("settingApiKey").value = settings.api_key;
  document.getElementById("settingTemp").value = settings.temperature;
  document.getElementById("tempValue").textContent = settings.temperature;
  document.getElementById("settingMaxTokens").value = settings.max_tokens;
  document.getElementById("settingSystemPrompt").value = settings.system_prompt;
  document.getElementById("settingSound").checked = settings.sound;
  panel.classList.remove("hidden");
}

function onProviderChange() {
  const pid = document.getElementById("settingProvider").value;
  const providers = { xai: ["grok-4-1-fast-reasoning","grok-3-fast","grok-3","grok-3-mini"],
    openai: ["gpt-4o","gpt-4o-mini","o1","o1-mini"],
    anthropic: ["claude-sonnet-4-5-20250929","claude-haiku-4-5-20251001"],
    ollama: ["llama3","codellama","mistral","deepseek-coder"] };
  const sel = document.getElementById("modelSelect");
  sel.innerHTML = (providers[pid] || []).map(m => `<option value="${m}">${m}</option>`).join("");
}

function applySettings() {
  settings.provider = document.getElementById("settingProvider").value;
  settings.api_key = document.getElementById("settingApiKey").value;
  settings.temperature = parseFloat(document.getElementById("settingTemp").value) || 0.7;
  settings.max_tokens = parseInt(document.getElementById("settingMaxTokens").value) || 4096;
  settings.system_prompt = document.getElementById("settingSystemPrompt").value.trim();
  settings.sound = document.getElementById("settingSound").checked;
  saveSettings();
  onProviderChange();
  toggleSettings();
}

// ── Search ──────────────────────────────────

function openSearch() {
  document.getElementById("searchOverlay").classList.remove("hidden");
  document.getElementById("searchInput").focus();
}

function closeSearch() {
  document.getElementById("searchOverlay").classList.add("hidden");
  document.getElementById("searchInput").value = "";
  messagesEl.querySelectorAll(".search-highlight").forEach(el => {
    el.outerHTML = el.textContent;
  });
}

function doSearch(query) {
  // Remove old highlights
  messagesEl.querySelectorAll(".search-highlight").forEach(el => { el.outerHTML = el.textContent; });
  if (!query.trim()) { document.getElementById("searchCount").textContent = ""; return; }
  let count = 0;
  const bodies = messagesEl.querySelectorAll(".message-body");
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  bodies.forEach(body => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (regex.test(node.textContent)) {
        const span = document.createElement("span");
        span.innerHTML = node.textContent.replace(regex, '<mark class="search-highlight">$1</mark>');
        node.parentNode.replaceChild(span, node);
        count += (node.textContent.match(regex) || []).length;
      }
    });
  });
  document.getElementById("searchCount").textContent = count ? `${count} found` : "no results";
  const first = messagesEl.querySelector(".search-highlight");
  if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ── File Browser ──────────────────────────────

function switchTab(tab) {
  document.getElementById("tabChats").classList.toggle("active", tab === "chats");
  document.getElementById("tabFiles").classList.toggle("active", tab === "files");
  document.getElementById("panelChats").classList.toggle("hidden", tab !== "chats");
  document.getElementById("panelFiles").classList.toggle("hidden", tab !== "files");
  if (tab === "files") loadFileTree();
}

async function loadFileTree(path) {
  try {
    const url = path ? `/api/files/list?path=${encodeURIComponent(path)}` : "/api/files/list";
    const resp = await fetch(url);
    const data = await resp.json();
    document.getElementById("workspacePath").textContent = data.path;
    if (!path) {
      const tree = document.getElementById("fileTree");
      tree.innerHTML = "";
      renderFileEntries(data.entries, tree, 0);
    }
    return data;
  } catch (e) {}
}

function renderFileEntries(entries, container, depth) {
  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "file-item";
    item.style.paddingLeft = (12 + depth * 16) + "px";
    const icon = entry.type === "dir" ? "&#9656;" : "&#9671;";
    item.innerHTML = `<span class="file-icon">${icon}</span><span class="file-name">${escapeHtml(entry.name)}</span>`;
    if (entry.type === "dir") {
      item.classList.add("dir");
      let loaded = false;
      const children = document.createElement("div");
      children.className = "file-children hidden";
      item.onclick = async (e) => {
        e.stopPropagation();
        if (!loaded) {
          const data = await loadFileTree(entry.path);
          if (data && data.entries) renderFileEntries(data.entries, children, depth + 1);
          loaded = true;
        }
        children.classList.toggle("hidden");
        item.querySelector(".file-icon").innerHTML = children.classList.contains("hidden") ? "&#9656;" : "&#9662;";
      };
      container.appendChild(item);
      container.appendChild(children);
    } else {
      item.onclick = () => viewFile(entry.path);
      container.appendChild(item);
    }
  }
}

async function viewFile(path) {
  try {
    const resp = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
    const data = await resp.json();
    const viewer = document.getElementById("fileViewer");
    document.getElementById("fileViewerPath").textContent = path;
    if (data.image) {
      document.getElementById("fileViewerContent").innerHTML = `<img src="data:${data.mime};base64,${data.data}" style="max-width:100%">`;
    } else {
      const ext = data.extension || "";
      let highlighted = data.content;
      try {
        if (ext && hljs.getLanguage(ext)) highlighted = hljs.highlight(data.content, { language: ext }).value;
        else highlighted = hljs.highlightAuto(data.content).value;
      } catch (e) { highlighted = escapeHtml(data.content); }
      document.getElementById("fileViewerContent").innerHTML = addLineNumbers(highlighted);
    }
    viewer.classList.remove("hidden");
  } catch (e) {}
}

function closeFileViewer() { document.getElementById("fileViewer").classList.add("hidden"); }

async function changeWorkspace() {
  const path = prompt("Enter workspace path:");
  if (!path) return;
  try {
    const resp = await fetch("/api/workspace", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await resp.json();
    if (data.workspace) loadFileTree();
    else alert(data.error || "Failed");
  } catch (e) { alert("Failed to change workspace"); }
}

// ── Rendering ──────────────────────────────────

function scrollToBottom() { if (autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight; }

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addLineNumbers(html) {
  const lines = html.split("\n");
  return lines.map((line, i) =>
    `<span class="line-number">${i + 1}</span>${line}`
  ).join("\n");
}

function renderMarkdown(text) {
  let html;
  try { html = marked.parse(text); } catch (e) { html = escapeHtml(text); }

  html = html.replace(
    /<pre><code class="language-(\w+)">/g,
    '<pre><div class="code-header"><span>$1</span><button class="copy-btn" onclick="copyCode(this)">copy</button></div><code class="language-$1 line-numbers">'
  );
  html = html.replace(
    /<pre><code(?! class)>/g,
    '<pre><div class="code-header"><span>text</span><button class="copy-btn" onclick="copyCode(this)">copy</button></div><code class="line-numbers">'
  );
  return html;
}

function copyCode(btn) {
  const code = btn.closest("pre").querySelector("code").textContent;
  navigator.clipboard.writeText(code).then(() => { btn.textContent = "copied"; setTimeout(() => btn.textContent = "copy", 2000); })
  .catch(() => { btn.textContent = "failed"; setTimeout(() => btn.textContent = "copy", 2000); });
}

function copyMessage(btn) {
  const text = btn.closest(".message").querySelector(".message-body").innerText;
  navigator.clipboard.writeText(text).then(() => { btn.textContent = "copied"; setTimeout(() => btn.textContent = "copy", 2000); })
  .catch(() => { btn.textContent = "failed"; setTimeout(() => btn.textContent = "copy", 2000); });
}

function addMessage(role, content, silent, timestamp) {
  const welcome = messagesEl.querySelector(".welcome");
  if (welcome) welcome.remove();

  const div = document.createElement("div");
  div.className = `message ${role}`;
  const time = formatTime(timestamp || Date.now());
  const actions = role === "assistant" ? `<div class="message-actions"><button class="msg-action-btn" onclick="copyMessage(this)">copy</button><button class="msg-action-btn" onclick="regenerate()">retry</button></div>` : "";

  div.innerHTML = `
    <div class="message-header">
      <span class="message-role">${role === "user" ? "you" : "tetsuo"}</span>
      <span class="message-time">${time}</span>${actions}
    </div>
    <div class="message-body">${role === "user" ? escapeHtml(content).replace(/\n/g, "<br>") : renderMarkdown(content)}</div>`;

  // Add line numbers to code blocks
  div.querySelectorAll("code.line-numbers").forEach(code => {
    code.innerHTML = addLineNumbers(code.innerHTML);
  });

  messagesEl.appendChild(div);
  if (!silent) scrollToBottom();
  return div;
}

function escapeHtml(text) { const d = document.createElement("div"); d.textContent = text; return d.innerHTML; }

function addThinking() {
  const welcome = messagesEl.querySelector(".welcome");
  if (welcome) welcome.remove();
  document.title = "tetsuocode ...";
  const div = document.createElement("div");
  div.className = "message assistant";
  div.id = "streamingMessage";
  div.innerHTML = `<div class="message-header"><span class="message-role">tetsuo</span></div>
    <div class="message-body"><div class="thinking"><div class="thinking-dots"><span></span><span></span><span></span></div></div></div>`;
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function showToolThinking() {
  const sm = document.getElementById("streamingMessage");
  if (!sm) return;
  const body = sm.querySelector(".message-body");
  if (!body.querySelector(".tool-thinking")) {
    const el = document.createElement("div");
    el.className = "tool-thinking";
    el.innerHTML = `<div class="thinking"><div class="thinking-dots"><span></span><span></span><span></span></div><span>running...</span></div>`;
    body.appendChild(el);
  }
  scrollToBottom();
}

function removeToolThinking() {
  const el = document.querySelector("#streamingMessage .tool-thinking");
  if (el) el.remove();
}

function formatToolOutput(raw) {
  try {
    const parsed = JSON.parse(raw);
    // Check for diff and render it
    if (parsed.diff) {
      return renderDiff(parsed.diff) + "\n" + escapeHtml(JSON.stringify({ ...parsed, diff: "[shown above]" }, null, 2));
    }
    // Check for image
    if (parsed.image && parsed.data) {
      return `<img src="data:${parsed.mime};base64,${parsed.data}" style="max-width:100%;border-radius:4px;margin:4px 0">`;
    }
    return escapeHtml(JSON.stringify(parsed, null, 2));
  } catch (e) { return escapeHtml(raw); }
}

function renderDiff(diff) {
  if (!diff) return "";
  return diff.split("\n").map(line => {
    if (line.startsWith("+") && !line.startsWith("+++")) return `<span class="diff-add">${escapeHtml(line)}</span>`;
    if (line.startsWith("-") && !line.startsWith("---")) return `<span class="diff-del">${escapeHtml(line)}</span>`;
    if (line.startsWith("@@")) return `<span class="diff-hunk">${escapeHtml(line)}</span>`;
    return escapeHtml(line);
  }).join("\n");
}

function addToolCall(name, args) {
  const sm = document.getElementById("streamingMessage");
  if (!sm) return;
  removeToolThinking();
  const body = sm.querySelector(".message-body");
  const div = document.createElement("div");
  div.className = "tool-call";
  let preview = args;
  try { preview = JSON.stringify(JSON.parse(args), null, 2); } catch (e) {}
  if (preview.length > 200) preview = preview.slice(0, 200) + "...";
  div.innerHTML = `
    <div class="tool-call-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <span class="tool-collapse-icon">&#9660;</span>
      <span class="tool-name">${escapeHtml(name)}</span>
      <span class="tool-status">running</span>
    </div>
    <div class="tool-call-body"><code>${escapeHtml(preview)}</code></div>`;
  body.appendChild(div);
  showToolThinking();
  scrollToBottom();
}

function addToolResult(name, result) {
  const sm = document.getElementById("streamingMessage");
  if (!sm) return;
  removeToolThinking();
  const divs = sm.querySelectorAll(".tool-call");
  if (divs.length > 0) {
    const last = divs[divs.length - 1];
    let preview = result;
    if (preview.length > 1000) preview = preview.slice(0, 1000) + "...";
    last.querySelector(".tool-call-body").innerHTML = `<code>${formatToolOutput(preview)}</code>`;
    const st = last.querySelector(".tool-status");
    if (st) st.textContent = "done";
    last.classList.add("collapsed");
  }
  showToolThinking();
  scrollToBottom();
}

// ── Sound ──────────────────────────────────

function playNotification() {
  if (!settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

// ── Chat ──────────────────────────────────────

async function sendMessage(retryText) {
  const text = retryText || inputEl.value.trim();
  if (!text || streaming) return;

  if (!retryText) {
    addMessage("user", text, false, Date.now());
    messages.push({ role: "user", content: text, timestamp: Date.now() });
  }

  if (messages.filter(m => m.role === "user").length === 1) {
    chatTitleEl.textContent = text.length > 40 ? text.slice(0, 40) + "..." : text;
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
    const payload = { messages, model, provider: settings.provider };
    if (settings.temperature !== 0.7) payload.temperature = settings.temperature;
    if (settings.max_tokens !== 4096) payload.max_tokens = settings.max_tokens;
    if (settings.system_prompt) payload.system_prompt = settings.system_prompt;
    if (settings.api_key) payload.api_key = settings.api_key;

    const resp = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: abortController.signal,
    });

    if (!resp.ok) throw new Error(`server returned ${resp.status}`);

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
        let data;
        try { data = JSON.parse(line.slice(6)); } catch (e) { continue; }

        if (data.type === "content") {
          if (!fullContent) body.innerHTML = "";
          removeToolThinking();
          fullContent += data.content;
          body.innerHTML = renderMarkdown(fullContent);
          body.classList.add("streaming-cursor");
          // Add line numbers to streamed code blocks
          body.querySelectorAll("code.line-numbers").forEach(code => {
            if (!code.querySelector(".line-number")) code.innerHTML = addLineNumbers(code.innerHTML);
          });
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
      if (!fullContent) body.innerHTML = '<span class="dim-text">cancelled</span>';
    } else {
      hadError = true;
      let msg = "connection failed";
      if (e.message.includes("server returned")) msg = e.message;
      else if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) msg = "network error - check your connection";
      body.innerHTML = `<span class="error-text">${escapeHtml(msg)}</span><button class="retry-btn" onclick="retryLast()">retry</button>`;
    }
  }

  body.classList.remove("streaming-cursor");
  removeToolThinking();
  streamMsg.removeAttribute("id");
  document.title = "tetsuocode";

  if (fullContent) {
    messages.push({ role: "assistant", content: fullContent, timestamp: Date.now() });
    if (messages.filter(m => m.role === "user").length === 1) generateTitle(messages[0].content, fullContent);
    playNotification();
  }

  streaming = false;
  abortController = null;
  sendBtn.classList.remove("hidden");
  cancelBtn.classList.add("hidden");
  saveState();
  renderChatHistory();
  inputEl.focus();
}

function cancelStream() { if (abortController) abortController.abort(); }

function retryLast() {
  if (streaming) return;
  const all = messagesEl.querySelectorAll(".message");
  if (all.length > 0) all[all.length - 1].remove();
  const last = [...messages].reverse().find(m => m.role === "user");
  if (last) sendMessage(last.content);
}

function regenerate() {
  if (streaming) return;
  const all = messagesEl.querySelectorAll(".message");
  if (all.length > 0) all[all.length - 1].remove();
  while (messages.length > 0 && messages[messages.length - 1].role === "assistant") messages.pop();
  const last = [...messages].reverse().find(m => m.role === "user");
  if (last) sendMessage(last.content);
}

// ── Smart Titles ──────────────────────────────

async function generateTitle(userMsg, assistantMsg) {
  try {
    const model = document.getElementById("modelSelect").value;
    const resp = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: userMsg },
          { role: "assistant", content: assistantMsg.slice(0, 500) },
          { role: "user", content: "Generate a 3-5 word title for this conversation. Reply with ONLY the title, no quotes, no punctuation, all lowercase." },
        ],
        model, provider: settings.provider,
        ...(settings.api_key ? { api_key: settings.api_key } : {}),
      }),
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let title = "", buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try { const d = JSON.parse(line.slice(6)); if (d.type === "content") title += d.content; } catch (e) {}
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

// ── Mobile ──────────────────────────────────

function toggleSidebar() {
  document.querySelector(".sidebar").classList.toggle("open");
  document.getElementById("sidebarOverlay").classList.toggle("hidden");
}

// ── Prompt Templates ──────────────────────────

const defaultTemplates = [
  { name: "explain code", prompt: "Explain what this code does and how it works" },
  { name: "find bugs", prompt: "Find and fix any bugs in this code" },
  { name: "write tests", prompt: "Write comprehensive tests for this project" },
  { name: "refactor", prompt: "Refactor this code for better performance and readability" },
  { name: "add docs", prompt: "Add documentation and comments to this code" },
  { name: "security audit", prompt: "Review this code for security vulnerabilities" },
];

function toggleTemplates() { document.getElementById("templateMenu").classList.toggle("hidden"); if (!document.getElementById("templateMenu").classList.contains("hidden")) renderTemplates(); }

function renderTemplates() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem("tetsuocode_templates") || "[]"); } catch (e) {}
  const all = [...defaultTemplates, ...saved];
  document.getElementById("templateMenu").innerHTML = all.map((t, i) =>
    `<div class="template-item" onclick="useTemplate(${i})"><span>${escapeHtml(t.name)}</span></div>`
  ).join("") + `<div class="template-item template-save" onclick="saveTemplate()"><span>+ save current as template</span></div>`;
}

function useTemplate(i) {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem("tetsuocode_templates") || "[]"); } catch (e) {}
  const all = [...defaultTemplates, ...saved];
  if (all[i]) { inputEl.value = all[i].prompt; inputEl.focus(); }
  document.getElementById("templateMenu").classList.add("hidden");
}

function saveTemplate() {
  const text = inputEl.value.trim();
  if (!text) { alert("Type a prompt first"); return; }
  const name = prompt("Template name:");
  if (!name) return;
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem("tetsuocode_templates") || "[]"); } catch (e) {}
  saved.push({ name, prompt: text });
  localStorage.setItem("tetsuocode_templates", JSON.stringify(saved));
  document.getElementById("templateMenu").classList.add("hidden");
}

// ── Init ──────────────────────────────────────

(async function init() {
  const authed = await checkAuth();
  if (authed) loadState();
  inputEl.focus();
})();
