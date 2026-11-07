const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (newConfig) => ipcRenderer.invoke('config:save', newConfig),

  // YouTube
  searchYouTube: (params) => ipcRenderer.invoke('youtube:search', params),

  // AI CLI Strategy
  generateStrategy: (params) => ipcRenderer.invoke('ai:generate-strategy', params),

  // System helpers
  openExternal: (url) => shell.openExternal(url),
  detectCliPath: (engine) => ipcRenderer.invoke('ai:detect-path', engine)
});
