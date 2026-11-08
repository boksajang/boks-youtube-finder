// ==========================================================================
// BOKS YOUTUBE FINDER - Electron Main Process
// ==========================================================================

const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { paths, applyElectronPaths } = require('./services/paths');

// 반드시 ready 이전: Chromium 캐시·로그까지 app-data 로 고정
applyElectronPaths();

const configService = require('./services/config');
const youtubeService = require('./services/youtube');
const { createChannelCache } = require('./services/channel-cache');
const aiCliService = require('./services/ai-cli');
const channelCache = createChannelCache(paths.channelCacheFile);

const isMac = process.platform === 'darwin';
const ICON_PATH = path.join(__dirname, 'assets', isMac ? 'icon.png' : (process.platform === 'win32' ? 'icon.ico' : 'icon.png'));

let mainWindow = null;
const INDEX_URL = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    backgroundColor: '#0a1020',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    title: 'Boks YouTube Finder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const sendMaxState = () => mainWindow && mainWindow.webContents.send('win:maximized-changed', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);

  // 새 창·다른 페이지로의 이동은 모두 차단한다(파일 드래그&드롭 포함). 외부 링크는 shell:open-external 로만 연다.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] !== INDEX_URL) e.preventDefault();
  });

  // 개발 모드에서만 DevTools 단축키 허용 (기본 메뉴 제거로 사라진 단축키 보완)
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (e, input) => {
      const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I');
      if (input.type === 'keyDown' && devtools) mainWindow.webContents.toggleDevTools();
      if (input.type === 'keyDown' && input.control && input.key.toUpperCase() === 'R') mainWindow.webContents.reload();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    aiCliService.cancel();
  });
}

app.whenReady().then(() => {
  if (!gotLock) return;
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  aiCliService.cancel();
  if (!isMac) app.quit();
});

// --- IPC: 모든 응답은 { ok, data } | { ok:false, error:{ code, message, detail? } } ---

function wrap(handler) {
  return async (event, payload) => {
    try {
      return { ok: true, data: await handler(payload || {}, event) };
    } catch (err) {
      if (err.code !== 'CANCELLED') console.error('[IPC]', err);
      return {
        ok: false,
        error: { code: err.code || 'UNKNOWN', message: err.message || '알 수 없는 오류가 발생했습니다.', detail: err.detail || '' }
      };
    }
  };
}

ipcMain.handle('config:get', wrap(() => ({
  ...configService.loadConfig(),
  encryptionAvailable: configService.canEncrypt(),
  keyNeedsReentry: configService.keyNeedsReentry()
})));
ipcMain.handle('config:save', wrap((cfg) => {
  const res = configService.saveConfig(cfg);
  if (!res.success) throw Object.assign(new Error(`설정을 저장하지 못했습니다: ${res.error}`), { code: 'CONFIG_SAVE' });
  return res.config;
}));

ipcMain.handle('cli:detect-path', wrap(({ engine }) => aiCliService.detectCliPath(engine === 'codex' ? 'codex' : 'claude')));

ipcMain.handle('youtube:search', wrap(async ({ query, videoCategoryId, publishedPeriod }) => {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) throw Object.assign(new Error('검색할 키워드를 입력해 주세요.'), { code: 'EMPTY_QUERY' });
  const config = configService.loadConfig();
  const result = await youtubeService.searchYouTube({
    apiKey: config.youtubeApiKey,
    query: q,
    maxResults: 50,
    regionCode: 'KR',
    relevanceLanguage: 'ko',
    videoCategoryId: String(videoCategoryId || '0'),
    publishedPeriod: String(publishedPeriod || 'all'),
    channelCache
  });
  const analytics = youtubeService.computeMarketAnalytics(result.videos, q);
  return { videos: result.videos, excluded: result.excluded, baseline: result.baseline, analytics };
}));

ipcMain.handle('ai:generate-strategy', wrap(({ keyword, videos }) => {
  const config = configService.loadConfig();
  return aiCliService.generateStrategy({
    keyword: String(keyword || ''),
    videos: Array.isArray(videos) ? videos.slice(0, 60) : [],
    engine: config.aiEngine,
    customPath: config.aiEngine === 'codex' ? config.codexCliPath : config.claudeCliPath,
    workDir: paths.aiWorkspace
  });
}));

ipcMain.handle('ai:cancel', wrap(() => aiCliService.cancel()));

ipcMain.handle('csv:save', wrap(async ({ defaultName, content }) => {
  const safeName = String(defaultName || 'boks_youtube.csv').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'CSV로 저장',
    defaultPath: path.join(app.getPath('downloads'), safeName),
    filters: [{ name: 'CSV (Excel 호환)', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return { saved: false };
  await fs.promises.writeFile(filePath, String(content || ''), 'utf8');
  return { saved: true, filePath };
}));

ipcMain.handle('shell:open-external', wrap(({ url }) => {
  if (typeof url === 'string' && /^https:\/\/(www\.)?(youtube\.com|youtu\.be|console\.cloud\.google\.com|developers\.google\.com)\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  throw Object.assign(new Error('허용되지 않은 주소입니다.'), { code: 'URL_BLOCKED' });
}));

ipcMain.handle('shell:show-item', wrap(({ filePath }) => {
  if (typeof filePath === 'string' && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  return true;
}));

// --- 창 제어 (커스텀 타이틀바) ---
ipcMain.handle('win:minimize', wrap(() => mainWindow && mainWindow.minimize()));
ipcMain.handle('win:toggle-maximize', wrap(() => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  return mainWindow.isMaximized();
}));
ipcMain.handle('win:close', wrap(() => mainWindow && mainWindow.close()));
ipcMain.handle('win:state', wrap(() => ({ maximized: !!(mainWindow && mainWindow.isMaximized()), platform: process.platform })));
