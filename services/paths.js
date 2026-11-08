// ==========================================================================
// BOKS YOUTUBE FINDER - App Data Paths
// 모든 앱 데이터(설정·Electron 캐시·AI 작업 폴더)는 앱 폴더 하위 app-data/ 에 둔다.
//   - 개발 모드: <프로젝트>/app-data
//   - 설치판:    <실행 파일 폴더>/app-data
// ==========================================================================

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function resolveAppRoot() {
  return app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
}

const appRoot = resolveAppRoot();
const dataDir = path.join(appRoot, 'app-data');

const paths = {
  appRoot,
  dataDir,
  configFile: path.join(dataDir, 'config.json'),
  electronData: path.join(dataDir, 'electron'),
  aiWorkspace: path.join(dataDir, 'ai-workspace'),
  // 채널 평소 조회수(최근 업로드 통계) 24시간 캐시
  channelCacheFile: path.join(dataDir, 'cache', 'channel-baselines.json'),
  // 이 PC의 YouTube API 일일 사용량(태평양 시간 기준)
  usageFile: path.join(dataDir, 'usage.json'),
  // 이전 버전이 사용하던 %APPDATA% 설정 파일(읽기 전용 이관용)
  legacyConfigFile: () => path.join(app.getPath('appData'), 'Boks YouTube Finder', 'boks-youtube-finder-config.json')
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// app.whenReady() 이전에 호출해야 Chromium 캐시까지 app-data 로 들어간다.
function applyElectronPaths() {
  ensureDir(paths.electronData);
  app.setPath('userData', paths.electronData);
  app.setPath('sessionData', paths.electronData);
  app.setAppLogsPath(ensureDir(path.join(paths.electronData, 'logs')));
}

module.exports = { paths, ensureDir, applyElectronPaths };
