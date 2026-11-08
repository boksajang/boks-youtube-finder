// ==========================================================================
// BOKS YOUTUBE FINDER - Local Configuration Service
// API 키는 OS 보호 저장소(safeStorage)로 암호화해 app-data/config.json 에 저장한다.
// ==========================================================================

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { paths, ensureDir } = require('./paths');

const DEFAULTS = {
  youtubeApiKey: '',
  aiEngine: 'claude', // 'claude' | 'codex'
  claudeCliPath: '',
  codexCliPath: ''
};

const ALLOWED_KEYS = Object.keys(DEFAULTS);

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
    for (const k of ALLOWED_KEYS) {
      if (partial && typeof partial[k] === 'string') next[k] = partial[k].trim();
    }
    if (next.aiEngine !== 'codex') next.aiEngine = 'claude';
    writeStored(encodeConfig(next));
    cache = next;
    if (next.youtubeApiKey) decryptFailed = false;
    return { success: true, config: { ...next } };
  } catch (err) {
    console.error('[Config] 설정 저장 실패:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { loadConfig, saveConfig, canEncrypt, keyNeedsReentry: () => decryptFailed };
