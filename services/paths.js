// ==========================================================================
// BOKS YOUTUBE FINDER - App Data Paths
// 모든 앱 데이터(설정·Electron 캐시·AI 작업 폴더)는 앱 폴더 하위 app-data/ 에 둔다.
//   - 개발 모드: <프로젝트>/app-data
//   - 설치판:    Windows = <실행 파일 폴더>/app-data
//               macOS·Linux = OS 사용자 데이터 폴더/app-data (예외: .app 번들·AppImage·/opt 는 쓸 수 없고,
//               번들에 쓰면 코드 서명이 깨지며 업데이트 때 데이터가 사라진다)
//               macOS: ~/Library/Application Support/Boks YouTube Finder/app-data
//               Linux: ~/.config/Boks YouTube Finder/app-data
// ==========================================================================

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function resolveAppRoot() {
  return app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
}

function resolveDataDir(appRoot) {
  if (!app.isPackaged || process.platform === 'win32') return path.join(appRoot, 'app-data');
  // userData 는 아직 바꾸기 전이라 OS 기본 위치(appData/<앱 이름>)를 가리킨다
  return path.join(app.getPath('userData'), 'app-data');
}

const appRoot = resolveAppRoot();
const dataDir = resolveDataDir(appRoot);

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
  // 국가 목록·국가별 카테고리(30일 보관)
  metaCacheFile: path.join(dataDir, 'cache', 'meta.json'),
  // 최근 검색 결과(같은 조건이면 설정한 시간 동안 다시 씀)
  resultCacheFile: path.join(dataDir, 'cache', 'results.json'),
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
