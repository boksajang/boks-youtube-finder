// ==========================================================================
// BOKS YOUTUBE FINDER - Local Configuration Service
// ==========================================================================

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  youtubeApiKey: '',
  aiEngine: 'claude', // 'claude' or 'codex'
  claudeCliPath: '',
  codexCliPath: '',
  minOutlierRatio: 3.0
};

function getConfigPath() {
  try {
    if (app && typeof app.getPath === 'function' && app.isReady()) {
      return path.join(app.getPath('userData'), 'boks-youtube-finder-config.json');
    }
  } catch (e) {
    // Fallback if app is not ready yet
  }
  return path.join(process.cwd(), 'boks-youtube-finder-config.json');
}

function loadConfig() {
  const cfgPath = getConfigPath();
  try {
    if (fs.existsSync(cfgPath)) {
      const data = fs.readFileSync(cfgPath, 'utf8');
      return { ...DEFAULTS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('[Config] Failed to load config:', err);
  }
  return { ...DEFAULTS };
}

function saveConfig(newConfig) {
  const cfgPath = getConfigPath();
  try {
    const current = loadConfig();
    const updated = { ...current, ...newConfig };
    const dir = path.dirname(cfgPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), 'utf8');
    return { success: true, config: updated };
  } catch (err) {
    console.error('[Config] Failed to save config:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  loadConfig,
  saveConfig
};
