// ==========================================================================
// BOKS YOUTUBE FINDER - Preload IPC Bridge
// ==========================================================================

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  // Config
  getConfig: () => invoke('config:get'),
  saveConfig: (config) => invoke('config:save', config),
  detectCliPath: (engine) => invoke('cli:detect-path', { engine }),
  getConfigDefaults: () => invoke('config:defaults'),
  validateApiKey: (key) => invoke('config:validate-key', { key }),
  getRegions: () => invoke('meta:regions'),
  getCategories: (region) => invoke('meta:categories', { region }),
  getCacheStats: () => invoke('cache:stats'),
  clearCache: () => invoke('cache:clear'),

  // YouTube
  searchYouTube: (params) => invoke('youtube:search', params),
  getUsage: () => invoke('usage:get'),

  // AI CLI
  generateStrategy: (params) => invoke('ai:generate-strategy', params),
  cancelStrategy: () => invoke('ai:cancel'),
  getAiModels: (paths) => invoke('ai:models', paths),

  // Files & shell
  openExternal: (url) => invoke('shell:open-external', { url }),

  // Window controls
  window: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggle-maximize'),
    close: () => invoke('win:close'),
    state: () => invoke('win:state'),
    onMaximizedChange: (cb) => {
      const listener = (_e, maximized) => cb(maximized);
      ipcRenderer.on('win:maximized-changed', listener);
      return () => ipcRenderer.removeListener('win:maximized-changed', listener);
    },
    onFullscreenChange: (cb) => {
      const listener = (_e, full) => cb(full);
      ipcRenderer.on('win:fullscreen-changed', listener);
      return () => ipcRenderer.removeListener('win:fullscreen-changed', listener);
    }
  }
});
