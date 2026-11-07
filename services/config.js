const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class ConfigManager {
  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'boks-youtube-finder-config.json');
    this.defaults = {
      youtubeApiKey: '',
      aiEngine: 'claude', // 'claude' or 'codex'
      claudeCliPath: '',
      codexCliPath: '',
      minOutlierRatio: 3.0 // 300% (조회수가 구독자의 3배 이상인 영상)
    };
    this.config = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return { ...this.defaults, ...JSON.parse(data) };
      }
    } catch (err) {
      console.error('[Config] Failed to load config:', err);
    }
    return { ...this.defaults };
  }

  save(newConfig) {
    try {
      this.config = { ...this.config, ...newConfig };
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      return { success: true, config: this.config };
    } catch (err) {
      console.error('[Config] Failed to save config:', err);
      return { success: false, error: err.message };
    }
  }

  get() {
    return this.config;
  }
}

module.exports = ConfigManager;
