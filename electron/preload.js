const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isElectron: true,

  // Workspace
  openWorkspace: () => ipcRenderer.invoke("app:open-workspace"),
  getWorkspace: () => ipcRenderer.invoke("app:get-workspace"),
  getRecent: () => ipcRenderer.invoke("app:get-recent"),

  // Window controls
  minimize: () => ipcRenderer.invoke("app:minimize"),
  maximize: () => ipcRenderer.invoke("app:maximize"),
  close: () => ipcRenderer.invoke("app:close"),
  isMaximized: () => ipcRenderer.invoke("app:is-maximized"),

  // App info
  getVersion: () => ipcRenderer.invoke("app:get-version"),

  // Engine
  restartEngine: () => ipcRenderer.invoke("app:restart-engine"),

  // Config
  saveApiKey: (provider, key) => ipcRenderer.invoke("app:save-api-key", provider, key),
  loadConfig: () => ipcRenderer.invoke("app:load-config"),

  // Events from main process
  onMaximizedChange: (callback) => {
    ipcRenderer.on("window:maximized", (_, val) => callback(val));
  },
});
