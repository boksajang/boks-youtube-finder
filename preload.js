// ==========================================================================
// BOKS YOUTUBE FINDER - Preload IPC Bridge
// ==========================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (newConfig) => ipcRenderer.invoke('config:save', newConfig),

  // YouTube Search & Analytics
  searchYouTube: (params) => ipcRenderer.invoke('youtube:search', params),

  // AI CLI Strategy Engine
  generateStrategy: (params) => ipcRenderer.invoke('ai:generate-strategy', params),

  // System Helpers
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  detectCliPath: (engine) => ipcRenderer.invoke('cli:detect-path', engine)
});
