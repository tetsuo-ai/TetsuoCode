const { app, BrowserWindow, Menu, Tray, shell, dialog, ipcMain, nativeImage, screen } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");

// ── Constants ───────────────────────────────
const APP_NAME = "tetsuocode";
const isDev = !app.isPackaged;

// ── State ───────────────────────────────────
let mainWindow = null;
let splashWindow = null;
let tray = null;
let pythonProcess = null;
let serverPort = 0;
let currentWorkspace = "";
let isQuitting = false;

// ── Paths ───────────────────────────────────
const userDataPath = app.getPath("userData");
const stateFile = path.join(userDataPath, "window-state.json");
const recentFile = path.join(userDataPath, "recent-workspaces.json");
const configFile = path.join(userDataPath, "config.json");

// ── Single Instance Lock ────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Helpers ─────────────────────────────────

function getResourcePath(...parts) {
  if (isDev) return path.join(__dirname, "..", ...parts);
  return path.join(process.resourcesPath, ...parts);
}

function getAppIcon() {
  const ext = process.platform === "win32" ? "ico" : "png";
  const candidates = [
    path.join(__dirname, `icon.${ext}`),
    path.join(__dirname, "icon.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return nativeImage.createFromPath(p);
    } catch {}
  }
  return null;
}

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

// ── Window State Persistence ────────────────

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch {
    return { width: 1400, height: 900 };
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? loadWindowState() : mainWindow.getBounds();
    fs.writeFileSync(stateFile, JSON.stringify({
      width: bounds.width || 1400,
      height: bounds.height || 900,
      x: bounds.x,
      y: bounds.y,
      maximized,
    }));
  } catch {}
}

// ── Recent Workspaces ───────────────────────

// ── App Config ──────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configFile, "utf-8")); } catch { return {}; }
}

function saveConfig(cfg) {
  try { fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2)); } catch {}
}

function getRecentWorkspaces() {
  try { return JSON.parse(fs.readFileSync(recentFile, "utf-8")); } catch { return []; }
}

function addRecentWorkspace(ws) {
  let recent = getRecentWorkspaces().filter(r => r !== ws);
  recent.unshift(ws);
  recent = recent.slice(0, 10);
  try { fs.writeFileSync(recentFile, JSON.stringify(recent)); } catch {}
  return recent;
}

// ── Python Server ───────────────────────────

function findPython() {
  return process.platform === "win32"
    ? ["python", "python3", "py"]
    : ["python3", "python"];
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
      if (Date.now() - start > timeout) reject(new Error("Server start timeout"));
      else setTimeout(attempt, 250);
    }
    attempt();
  });
}

async function startServer(workspace) {
  serverPort = await findFreePort();
  const cfg = loadConfig();
  const env = {
    ...process.env,
    TETSUO_WORKSPACE: workspace,
    PYTHONPATH: isDev ? path.join(__dirname, "..") : process.resourcesPath,
    ...(cfg.xai_api_key ? { XAI_API_KEY: cfg.xai_api_key } : {}),
    ...(cfg.openai_api_key ? { OPENAI_API_KEY: cfg.openai_api_key } : {}),
    ...(cfg.anthropic_api_key ? { ANTHROPIC_API_KEY: cfg.anthropic_api_key } : {}),
  };
  const cwd = isDev ? path.join(__dirname, "..") : process.resourcesPath;

  for (const py of findPython()) {
    try {
      pythonProcess = spawn(py, ["-m", "web.app", "--port", String(serverPort)], {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      pythonProcess.stdout.on("data", (d) => console.log(`[engine] ${d}`));
      pythonProcess.stderr.on("data", (d) => console.error(`[engine] ${d}`));
      pythonProcess.on("error", () => {});
      pythonProcess.on("exit", (code) => {
        console.log(`Engine exited (${code})`);
        pythonProcess = null;
      });

      await waitForServer(serverPort);
      console.log(`Engine running on :${serverPort} via ${py}`);
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

// ── Splash Screen ───────────────────────────

function showSplash() {
  const icon = getAppIcon();
  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    icon: icon || undefined,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.center();
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ── System Tray ─────────────────────────────

function createTray() {
  const icon = getAppIcon();
  if (!icon) return;

  const trayImg = process.platform === "darwin"
    ? icon.resize({ width: 16, height: 16 })
    : icon.resize({ width: 24, height: 24 });

  tray = new Tray(trayImg);
  tray.setToolTip(APP_NAME);
  refreshTrayMenu();

  tray.on("click", () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

function refreshTrayMenu() {
  if (!tray) return;
  const recent = getRecentWorkspaces().slice(0, 5);

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Show tetsuocode",
      click: () => { mainWindow?.show(); mainWindow?.focus(); },
    },
    { type: "separator" },
    { label: "Open Workspace...", click: openWorkspaceDialog },
    ...(recent.length ? [{
      label: "Recent",
      submenu: recent.map((ws) => ({
        label: path.basename(ws),
        sublabel: ws,
        click: () => switchWorkspace(ws),
      })),
    }] : []),
    { type: "separator" },
    {
      label: currentWorkspace ? path.basename(currentWorkspace) : "No workspace",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit tetsuocode",
      click: () => { isQuitting = true; app.quit(); },
    },
  ]));
}

// ── Main Window ─────────────────────────────

function createMainWindow() {
  const state = loadWindowState();
  const icon = getAppIcon();

  let { x, y, width, height, maximized } = state;

  // Make sure saved position is on a visible display
  if (x !== undefined && y !== undefined) {
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.bounds;
      return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
    });
    if (!onScreen) { x = undefined; y = undefined; }
  }

  mainWindow = new BrowserWindow({
    width: width || 1400,
    height: height || 900,
    x,
    y,
    minWidth: 900,
    minHeight: 600,
    title: `tetsuocode${currentWorkspace ? " \u2014 " + path.basename(currentWorkspace) : ""}`,
    backgroundColor: "#0a0a0a",
    icon: icon || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  if (maximized) mainWindow.maximize();

  // Persist window state on resize/move
  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);

  // Load the app from embedded server
  loadApp();

  // Show window and close splash once ready
  mainWindow.once("ready-to-show", () => {
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  // Close to tray on Windows/Linux instead of quitting
  mainWindow.on("close", (e) => {
    saveWindowState();
    if (!isQuitting && tray && process.platform !== "darwin") {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  // External links open in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Notify renderer of maximize state changes
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized", false);
  });
}

function loadApp() {
  if (!mainWindow) return;
  let retries = 0;
  function tryLoad() {
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}`).catch(() => {
      if (++retries < 30) {
        setTimeout(tryLoad, 400);
      } else {
        mainWindow.loadURL(`data:text/html,${encodeURIComponent(
          `<html><body style="background:#0a0a0a;color:#e0e0e0;font-family:sans-serif;
          display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center"><h2>tetsuocode</h2>
          <p>Could not start engine.</p>
          <p style="color:#888;font-size:13px;margin-top:12px">
          Ensure Python 3.10+ is installed and on your PATH.<br>
          <a href="https://python.org/downloads" style="color:#7c3aed">Download Python</a></p>
          </div></body></html>`)}`);
      }
    });
  }
  tryLoad();
}

// ── Workspace ───────────────────────────────

async function openWorkspaceDialog() {
  const win = mainWindow || BrowserWindow.getAllWindows()[0];
  if (!win) return;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
    title: "Open Workspace",
  });
  if (!result.canceled && result.filePaths[0]) {
    await switchWorkspace(result.filePaths[0]);
  }
}

async function switchWorkspace(ws) {
  currentWorkspace = ws;
  process.env.TETSUO_WORKSPACE = ws;
  addRecentWorkspace(ws);
  refreshTrayMenu();
  if (mainWindow) {
    mainWindow.setTitle(`tetsuocode \u2014 ${path.basename(ws)}`);
  }

  // Restart engine with new workspace
  killServer();
  const ok = await startServer(ws);
  if (!ok) {
    dialog.showErrorBox("tetsuocode", "Failed to restart engine for new workspace.");
    return;
  }
  if (mainWindow) loadApp();
  buildMenu();
}

// ── Application Menu ────────────────────────

function buildMenu() {
  const recent = getRecentWorkspaces().slice(0, 8);
  const isMac = process.platform === "darwin";

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Workspace...",
          accelerator: "CmdOrCtrl+O",
          click: openWorkspaceDialog,
        },
        ...(recent.length ? [{
          label: "Open Recent",
          submenu: [
            ...recent.map((ws) => ({
              label: path.basename(ws),
              sublabel: ws,
              click: () => switchWorkspace(ws),
            })),
            { type: "separator" },
            {
              label: "Clear Recent",
              click: () => {
                try { fs.writeFileSync(recentFile, "[]"); } catch {}
                buildMenu();
                refreshTrayMenu();
              },
            },
          ],
        }] : []),
        { type: "separator" },
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            const { execFile } = require("child_process");
            execFile(process.execPath, [app.getAppPath()]);
          },
        },
        { type: "separator" },
        ...(isMac ? [{ role: "close" }] : [{ role: "quit" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" },
        ...(isMac ? [{ role: "pasteAndMatchStyle" }] : []),
        { role: "delete" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" },
        { role: "toggleDevTools", accelerator: "F12" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        ...(isMac
          ? [{ role: "zoom" }, { type: "separator" }, { role: "front" }]
          : [{ role: "close" }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: () => shell.openExternal("https://github.com/tetsuo-ai/tetsuo-code"),
        },
        {
          label: "Report Issue",
          click: () => shell.openExternal("https://github.com/tetsuo-ai/tetsuo-code/issues"),
        },
        { type: "separator" },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC Handlers ────────────────────────────

function setupIPC() {
  ipcMain.handle("app:open-workspace", () => openWorkspaceDialog());
  ipcMain.handle("app:get-workspace", () => currentWorkspace);
  ipcMain.handle("app:get-recent", () => getRecentWorkspaces());
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("app:minimize", () => mainWindow?.minimize());
  ipcMain.handle("app:maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
    return mainWindow?.isMaximized();
  });
  ipcMain.handle("app:close", () => {
    if (tray && process.platform !== "darwin") mainWindow?.hide();
    else mainWindow?.close();
  });
  ipcMain.handle("app:is-maximized", () => mainWindow?.isMaximized() || false);
  ipcMain.handle("app:restart-engine", async () => {
    killServer();
    return await startServer(currentWorkspace);
  });
  ipcMain.handle("app:save-api-key", (_, provider, key) => {
    const cfg = loadConfig();
    cfg[provider] = key;
    saveConfig(cfg);
  });
  ipcMain.handle("app:load-config", () => loadConfig());
}

// ── App Lifecycle ───────────────────────────

if (gotLock) {
  app.whenReady().then(async () => {
    // Determine workspace from CLI args or environment
    currentWorkspace =
      process.argv.find((a, i) => i > 0 && !a.startsWith("-") && fs.existsSync(a) && fs.statSync(a).isDirectory()) ||
      process.env.TETSUO_WORKSPACE ||
      app.getPath("home");

    addRecentWorkspace(currentWorkspace);
    setupIPC();
    showSplash();

    const ok = await startServer(currentWorkspace);
    if (!ok) {
      closeSplash();
      dialog.showErrorBox(
        "tetsuocode",
        "Could not find Python.\n\nInstall Python 3.10+ and make sure it\u2019s on your PATH.\nhttps://python.org/downloads"
      );
      app.quit();
      return;
    }

    createTray();
    buildMenu();
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        mainWindow?.show();
        mainWindow?.focus();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !tray) {
      isQuitting = true;
      app.quit();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    killServer();
    if (tray) { tray.destroy(); tray = null; }
  });
}
