// ==========================================================================
// BOKS YOUTUBE FINDER - Preload IPC Bridge
// ==========================================================================

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => invoke('config:get'),
  saveConfig: (config) => invoke('config:save', config),
  detectCliPath: (engine) => invoke('cli:detect-path', { engine }),

  // YouTube
  searchYouTube: (params) => invoke('youtube:search', params),
  getUsage: () => invoke('usage:get'),

  // AI CLI
  generateStrategy: (params) => invoke('ai:generate-strategy', params),
  cancelStrategy: () => invoke('ai:cancel'),

  // Files & shell
  saveCsv: (defaultName, content) => invoke('csv:save', { defaultName, content }),
  openExternal: (url) => invoke('shell:open-external', { url }),
  showItemInFolder: (filePath) => invoke('shell:show-item', { filePath }),

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
    }
  }
});
