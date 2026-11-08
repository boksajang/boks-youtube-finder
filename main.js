// ==========================================================================
// BOKS YOUTUBE FINDER - Electron Main Process
// ==========================================================================

const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { paths, applyElectronPaths } = require('./services/paths');

// 반드시 ready 이전: Chromium 캐시·로그까지 app-data 로 고정
applyElectronPaths();

const configService = require('./services/config');
const youtubeService = require('./services/youtube');
const { createChannelCache } = require('./services/channel-cache');
const aiCliService = require('./services/ai-cli');
const { computeTrends } = require('./services/trends');
const { createUsageCounter } = require('./services/usage');
const { createMetaCache } = require('./services/meta-cache');
// 설정(암호화된 API 키 포함)은 app ready 이후에만 읽는다. safeStorage 는 그 전에 복호화할 수 없어
// 미리 읽으면 키가 빈 값으로 캐시된다. 캐시 유지 시간은 ready 후 설정값으로 맞춘다.
const channelCache = createChannelCache(paths.channelCacheFile);
const metaCache = createMetaCache(paths.metaCacheFile);
const usage = createUsageCounter(paths.usageFile, {
  limits: () => { const c = configService.loadConfig(); return { search: c.searchLimit, units: c.unitLimit }; }
});
youtubeService.setUsageRecorder(endpoint => usage.record(endpoint));

const FORMATS = ['all', 'long', 'shorts'];
const PERIODS = ['24h', '3d', '7d', '30d', '90d', '1y', 'all', 'custom'];
const safeFormat = f => (FORMATS.includes(f) ? f : 'all');
const safeOrder = o => (o === 'relevance' ? 'relevance' : 'viewCount');
const safePeriod = p => (PERIODS.includes(p) ? p : 'all');
const safeRegion = r => (typeof r === 'string' && /^[A-Z]{2}$/.test(r) ? r : 'KR');
const safeLang = l => (typeof l === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(l) ? l : 'ko');
const safeCategory = c => (/^\d{1,3}$/.test(String(c)) ? String(c) : '0');

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
    backgroundColor: '#0f0f0f',
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
  channelCache.setTtl(configService.loadConfig().cacheTtlHours * 3600000);
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
  channelCache.setTtl(res.config.cacheTtlHours * 3600000);
  return res.config;
}));
ipcMain.handle('config:defaults', wrap(() => configService.typedDefaults()));

// API 키 확인(1 유닛): 저장 전에 키가 실제로 동작하는지 본다
ipcMain.handle('config:validate-key', wrap(async ({ key }) => {
  try {
    await youtubeService.validateApiKey(String(key || '').trim());
    return { checkedAt: new Date().toISOString() };
  } finally {
    usage.flush();
  }
}));

// 국가 목록·국가별 카테고리(30일 캐시, 키가 없거나 실패하면 기본 목록)
ipcMain.handle('meta:regions', wrap(async () => {
  const key = configService.loadConfig().youtubeApiKey;
  try {
    return await metaCache.regions(key ? () => youtubeService.fetchRegions(key) : null);
  } finally {
    usage.flush();
  }
}));
ipcMain.handle('meta:categories', wrap(async ({ region }) => {
  const key = configService.loadConfig().youtubeApiKey;
  const r = safeRegion(region);
  try {
    return await metaCache.categories(r, key ? () => youtubeService.fetchCategories(key, r) : null);
  } finally {
    usage.flush();
  }
}));

// 캐시 현황·비우기(채널 평소 조회수 + 국가·카테고리 목록)
ipcMain.handle('cache:stats', wrap(() => channelCache.stats()));
ipcMain.handle('cache:clear', wrap(() => {
  channelCache.clear();
  metaCache.clear();
  return channelCache.stats();
}));

ipcMain.handle('cli:detect-path', wrap(({ engine }) => aiCliService.detectCliPath(engine === 'codex' ? 'codex' : 'claude')));

// 키워드는 선택: 비우면 국가·주제·기간·형식 조건의 인기 영상 전체를 분석한다
ipcMain.handle('youtube:search', wrap(async ({ query, videoCategoryId, publishedPeriod, customFrom, customTo, format, order, region, language, langOnly }) => {
  const q = String(query || '').trim().slice(0, 100);
  const config = configService.loadConfig();
  const remaining = usage.remainingSearch();
  if (config.youtubeApiKey && remaining <= 0) {
    const s = usage.snapshot();
    const at = new Date(s.resetAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });
    throw Object.assign(new Error(`오늘 검색 한도(${s.searchLimit}회)를 모두 썼습니다. 한국 시간 ${at}에 초기화됩니다. 할당량을 늘렸다면 [설정]에서 한도를 바꿔 주세요.`), { code: 'QUOTA_LOCAL' });
  }
  try {
    const result = await youtubeService.searchYouTube({
      apiKey: config.youtubeApiKey,
      query: q,
      maxResults: 50,
      regionCode: safeRegion(region),
      relevanceLanguage: safeLang(language),
      langOnly: langOnly !== false,
      videoCategoryId: safeCategory(videoCategoryId),
      publishedPeriod: safePeriod(publishedPeriod),
      customRange: { from: String(customFrom || ''), to: String(customTo || '') },
      format: safeFormat(format),
      order: safeOrder(order),
      channelCache,
      maxSearchCalls: remaining
    });
    const analytics = youtubeService.computeMarketAnalytics(result.videos, q);
    const trends = computeTrends(result.videos, result.format);
    return { videos: result.videos, excluded: result.excluded, searchInfo: result.searchInfo, baseline: result.baseline, format: result.format, analytics, trends, usage: usage.snapshot() };
  } finally {
    usage.flush();
  }
}));

ipcMain.handle('usage:get', wrap(() => usage.snapshot()));

ipcMain.handle('ai:generate-strategy', wrap(({ keyword, videos, format }) => {
  const config = configService.loadConfig();
  return aiCliService.generateStrategy({
    keyword: String(keyword || ''),
    format: safeFormat(format),
    videos: Array.isArray(videos) ? videos.slice(0, 150) : [],
    engine: config.aiEngine,
    customPath: config.aiEngine === 'codex' ? config.codexCliPath : config.claudeCliPath,
    workDir: paths.aiWorkspace
  });
}));

ipcMain.handle('ai:cancel', wrap(() => aiCliService.cancel()));

ipcMain.handle('shell:open-external', wrap(({ url }) => {
  if (typeof url === 'string' && /^https:\/\/(www\.)?(youtube\.com|youtu\.be|console\.cloud\.google\.com|developers\.google\.com)\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  throw Object.assign(new Error('허용되지 않은 주소입니다.'), { code: 'URL_BLOCKED' });
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
