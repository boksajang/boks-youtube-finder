const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const ConfigManager = require('./services/config');
const { searchYouTube } = require('./services/youtube');
const AiCliService = require('./services/ai-cli');

const configManager = new ConfigManager();
const aiCliService = new AiCliService();

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1117',
    title: 'Boks YouTube Finder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('config:get', async () => {
  return configManager.get();
});

ipcMain.handle('config:save', async (_, newConfig) => {
  return configManager.save(newConfig);
});

ipcMain.handle('youtube:search', async (_, params) => {
  const config = configManager.get();
  return searchYouTube(config.youtubeApiKey, params);
});

ipcMain.handle('ai:generate-strategy', async (_, { keyword, videos }) => {
  const config = configManager.get();
  const engine = config.aiEngine || 'claude';
  const customPath = engine === 'codex' ? config.codexCliPath : config.claudeCliPath;
  return aiCliService.generateStrategy({ engine, customPath, keyword, videos });
});

ipcMain.handle('ai:detect-path', async (_, engine) => {
  return aiCliService.detectCliPath(engine);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
