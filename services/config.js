// ==========================================================================
// BOKS YOUTUBE FINDER - Local Configuration Service
// API 키는 OS 보호 저장소(safeStorage)로 암호화해 app-data/config.json 에 저장한다.
// ==========================================================================

const fs = require('fs');
const path = require('path');
const { safeStorage, app } = require('electron');
const { paths, ensureDir } = require('./paths');

// 문자열 설정(그대로 저장)
const STRING_DEFAULTS = {
  youtubeApiKey: '',
  aiEngine: 'claude', // 'claude' | 'codex'
  claudeCliPath: '',
  codexCliPath: '',
  keyCheckedAt: '' // 마지막으로 키를 확인한 시각(ISO)
};

// 형식이 정해진 설정: [기본값, 검증 함수(잘못된 값이면 undefined)]
const oneOf = list => v => (list.includes(v) ? v : undefined);
const intIn = (lo, hi) => v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; };
const TYPED = {
  // 검색 기본값
  region: ['KR', v => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : undefined)],
  language: ['ko', v => (typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(v) ? v : undefined)],
  langOnly: [true, v => (typeof v === 'boolean' ? v : undefined)],
  defaultFormat: ['all', oneOf(['all', 'long', 'shorts'])],
  defaultPeriod: ['7d', oneOf(['24h', '3d', '7d', '30d', '90d', '1y', 'all'])],
  defaultOrder: ['viewCount', oneOf(['viewCount', 'relevance'])],
  rememberLast: [true, v => (typeof v === 'boolean' ? v : undefined)],
  // API 사용 한도(할당량을 증설받았으면 늘린다)
  searchLimit: [100, intIn(1, 100000)],
  unitLimit: [10000, intIn(100, 10000000)],
  // 채널 평소 조회수 캐시 유지 시간
  cacheTtlHours: [24, oneOf([6, 12, 24, 72, 168])]
};

const DEFAULTS = { ...STRING_DEFAULTS, ...Object.fromEntries(Object.entries(TYPED).map(([k, [d]]) => [k, d])) };
const ALLOWED_KEYS = Object.keys(STRING_DEFAULTS);

function applyTyped(target, source) {
  for (const [k, [, check]] of Object.entries(TYPED)) {
    if (source && k in source) {
      const v = check(source[k]);
      if (v !== undefined) target[k] = v;
    }
  }
}

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('[Config] 설정 파일을 읽지 못했습니다:', file, err.message);
  }
  return null;
}

function writeStored(stored) {
  ensureDir(path.dirname(paths.configFile));
  const tmp = `${paths.configFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8');
  fs.renameSync(tmp, paths.configFile);
}

let decryptFailed = false;

// 디스크 형식 → 메모리 형식
function decodeStored(stored) {
  decryptFailed = false;
  const cfg = { ...DEFAULTS };
  for (const k of ALLOWED_KEYS) {
    if (typeof stored[k] === 'string') cfg[k] = stored[k];
  }
  applyTyped(cfg, stored);
  if (stored.youtubeApiKeyEnc) {
    try {
      cfg.youtubeApiKey = safeStorage.decryptString(Buffer.from(stored.youtubeApiKeyEnc, 'base64'));
    } catch (err) {
      // Windows 는 암호화 키가 app-data/electron/Local State 에 묶여 있어, 그 폴더를 지우거나 다른 PC 설정을 옮기면 실패한다
      console.error('[Config] API 키 복호화 실패:', err.message);
      cfg.youtubeApiKey = '';
      decryptFailed = true;
    }
  }
  if (cfg.aiEngine !== 'codex') cfg.aiEngine = 'claude';
  return cfg;
}

// 메모리 형식 → 디스크 형식
function encodeConfig(cfg) {
  const stored = { ...cfg };
  if (cfg.youtubeApiKey && canEncrypt()) {
    stored.youtubeApiKeyEnc = safeStorage.encryptString(cfg.youtubeApiKey).toString('base64');
    delete stored.youtubeApiKey;
  }
  return stored;
}

let cache = null;

function loadConfig() {
  if (cache) return { ...cache };
  // safeStorage 는 app ready 이전에 복호화할 수 없다. 그때 읽은 값(키가 빈 값)을 캐시하면 앱이 끝날 때까지 키를 잃는다.
  if (app && typeof app.isReady === 'function' && !app.isReady()) {
    throw new Error('[Config] app ready 이전에는 설정을 읽을 수 없습니다.');
  }

  let stored = readJson(paths.configFile);
  let needsRewrite = false;

  if (!stored) {
    // 이전 버전(%APPDATA%)의 설정을 1회 가져온다. 원본 파일은 건드리지 않는다.
    const legacy = readJson(paths.legacyConfigFile());
    if (legacy) {
      stored = legacy;
      needsRewrite = true;
    }
  }

  cache = decodeStored(stored || {});
  // 평문 키가 남아 있으면 암호화 형식으로 바로 다시 저장
  if (stored && stored.youtubeApiKey && canEncrypt()) needsRewrite = true;
  if (needsRewrite) {
    try { writeStored(encodeConfig(cache)); } catch (err) { console.error('[Config] 설정 이관 저장 실패:', err.message); }
  }
  return { ...cache };
}

function saveConfig(partial) {
  try {
    const next = { ...loadConfig() };
    const keyBefore = next.youtubeApiKey;
    for (const k of ALLOWED_KEYS) {
      if (partial && typeof partial[k] === 'string') next[k] = partial[k].trim();
    }
    applyTyped(next, partial);
    if (next.aiEngine !== 'codex') next.aiEngine = 'claude';
    // 키가 바뀌었는데 확인 시각을 따로 주지 않았으면 이전 확인 기록은 무효
    if (next.youtubeApiKey !== keyBefore && !(partial && typeof partial.keyCheckedAt === 'string')) next.keyCheckedAt = '';
    writeStored(encodeConfig(next));
    cache = next;
    if (next.youtubeApiKey) decryptFailed = false;
    return { success: true, config: { ...next } };
  } catch (err) {
    console.error('[Config] 설정 저장 실패:', err);
    return { success: false, error: err.message };
  }
}

/** 검색 기본값·한도·캐시 설정만 기본값으로 되돌린다(API 키·AI 설정은 유지) */
function typedDefaults() {
  return Object.fromEntries(Object.entries(TYPED).map(([k, [d]]) => [k, d]));
}

module.exports = { loadConfig, saveConfig, canEncrypt, keyNeedsReentry: () => decryptFailed, typedDefaults, DEFAULTS };
