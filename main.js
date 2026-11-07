// ==========================================================================
// BOKS YOUTUBE FINDER - Electron Main Process
// ==========================================================================

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const configService = require('./services/config');
const youtubeService = require('./services/youtube');
const aiCliService = require('./services/ai-cli');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Boks YouTube Finder'
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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

// --- IPC Handlers ---

ipcMain.handle('config:get', async () => {
  return configService.loadConfig();
});

ipcMain.handle('config:save', async (event, newConfig) => {
  return configService.saveConfig(newConfig);
});

ipcMain.handle('cli:detect-path', async (event, engine) => {
  return aiCliService.findCliPath(engine);
});

ipcMain.handle('youtube:search', async (event, { query, maxResults, regionCode, relevanceLanguage }) => {
  const config = configService.loadConfig();
  const videos = await youtubeService.searchYouTube({
    apiKey: config.youtubeApiKey,
    query,
    maxResults,
    regionCode,
    relevanceLanguage
  });
  const analytics = youtubeService.computeMarketAnalytics(videos);
  return { videos, analytics };
});

ipcMain.handle('ai:generate-strategy', async (event, { keyword, videos }) => {
  const config = configService.loadConfig();
  return aiCliService.generateStrategy({
    keyword,
    videos,
    engine: config.aiEngine,
    customPath: config.aiEngine === 'claude' ? config.claudeCliPath : config.codexCliPath
  });
});

ipcMain.handle('shell:open-external', async (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});
