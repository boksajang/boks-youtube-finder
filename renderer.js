// ==========================================================================
// BOKS YOUTUBE FINDER - Frontend Renderer & State Management
// ==========================================================================

let currentConfig = null;
let currentVideos = [];
let currentKeyword = '';

// DOM Elements
const navBtns = document.querySelectorAll('.nav-btn');
const tabViews = document.querySelectorAll('.tab-view');
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');

// Search & Filter Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const formatBtns = document.querySelectorAll('#format-toggle .toggle-btn');
const outlierFilter = document.getElementById('outlier-filter');
const sortFilter = document.getElementById('sort-filter');

// Grid & Summary Elements
const summaryCards = document.getElementById('summary-cards');
const metricTotal = document.getElementById('metric-total');
const metricOutliers = document.getElementById('metric-outliers');
const metricMaxMultiplier = document.getElementById('metric-max-multiplier');
const outlierCountBadge = document.getElementById('outlier-count-badge');
const quickAiBtn = document.getElementById('quick-ai-btn');

const videoGrid = document.getElementById('video-grid');
const outlierVideoGrid = document.getElementById('outlier-video-grid');

// AI Elements
const generateAiPlanBtn = document.getElementById('generate-ai-plan-btn');
const aiResultArea = document.getElementById('ai-result-area');

// Settings Elements
const settingApiKey = document.getElementById('setting-api-key');
const btnToggleKey = document.getElementById('btn-toggle-key');
const linkApiGuide = document.getElementById('link-api-guide');
const settingClaudePath = document.getElementById('setting-claude-path');
const settingCodexPath = document.getElementById('setting-codex-path');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const saveFeedback = document.getElementById('save-feedback');
const autoDetectBtns = document.querySelectorAll('.btn-auto-detect');

// --- Initialization ---
async function init() {
  currentConfig = await window.api.getConfig();
  updateApiStatusUI();
  populateSettingsUI();
  setupEventListeners();
}

// --- Navigation Tabs ---
function switchTab(tabId) {
  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  tabViews.forEach(view => {
    view.classList.toggle('active', view.id === `view-${tabId}`);
  });
}

// --- Status & Settings UI ---
function updateApiStatusUI() {
  if (currentConfig.youtubeApiKey && currentConfig.youtubeApiKey.trim().length > 10) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'API 정상 연결됨';
  } else {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'API 키 미등록';
  }
}

function populateSettingsUI() {
  settingApiKey.value = currentConfig.youtubeApiKey || '';
  settingClaudePath.value = currentConfig.claudeCliPath || '';
  settingCodexPath.value = currentConfig.codexCliPath || '';

  const engineRadio = document.querySelector(`input[name="ai-engine"][value="${currentConfig.aiEngine || 'claude'}"]`);
  if (engineRadio) engineRadio.checked = true;
}

// --- Event Listeners ---
function setupEventListeners() {
  // Tab switching
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Search actions
  searchBtn.addEventListener('click', handleSearch);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
  });

  // Filters change
  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      formatBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVideos();
    });
  });

  outlierFilter.addEventListener('change', renderVideos);
  sortFilter.addEventListener('change', renderVideos);

  // Quick AI transition button
  quickAiBtn.addEventListener('click', () => {
    switchTab('ai-strategist');
    handleGenerateAiStrategy();
  });

  // AI Generation Button
  generateAiPlanBtn.addEventListener('click', handleGenerateAiStrategy);

  // Settings Actions
  btnToggleKey.addEventListener('click', () => {
    if (settingApiKey.type === 'password') {
      settingApiKey.type = 'text';
      btnToggleKey.textContent = '숨기기';
    } else {
      settingApiKey.type = 'password';
      btnToggleKey.textContent = '보기';
    }
  });

  linkApiGuide.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://console.cloud.google.com/apis/library/youtube.googleapis.com');
  });

  autoDetectBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const engine = btn.dataset.engine;
      const detected = await window.api.detectCliPath(engine);
      if (engine === 'claude') {
        settingClaudePath.value = detected;
      } else {
        settingCodexPath.value = detected;
      }
    });
  });

  saveSettingsBtn.addEventListener('click', async () => {
    const selectedEngine = document.querySelector('input[name="ai-engine"]:checked')?.value || 'claude';
    const newConfig = {
      youtubeApiKey: settingApiKey.value.trim(),
      aiEngine: selectedEngine,
      claudeCliPath: settingClaudePath.value.trim(),
      codexCliPath: settingCodexPath.value.trim()
    };

    const res = await window.api.saveConfig(newConfig);
    if (res.success) {
      currentConfig = res.config;
      updateApiStatusUI();
      saveFeedback.textContent = '✓ 설정이 저장되었습니다!';
      setTimeout(() => { saveFeedback.textContent = ''; }, 3000);
    } else {
      saveFeedback.textContent = '❌ 저장 실패: ' + res.error;
    }
  });
}

// --- Search Handler ---
async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    alert('검색할 키워드를 입력해 주세요.');
    searchInput.focus();
    return;
  }

  if (!currentConfig.youtubeApiKey) {
    alert('YouTube Data API 키가 설정되지 않았습니다.\n[환경설정] 탭으로 이동하여 API 키를 먼저 입력해 주세요.');
    switchTab('settings');
    settingApiKey.focus();
    return;
  }

  currentKeyword = query;
  videoGrid.innerHTML = '<div class="spinner"></div>';
  summaryCards.style.display = 'none';

  try {
    const results = await window.api.searchYouTube({ query, maxResults: 40 });
    currentVideos = results;

    if (!currentVideos || currentVideos.length === 0) {
      videoGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>검색 결과가 없습니다</h3>
          <p>"${query}"에 대한 검색 결과가 없습니다. 다른 검색어로 시도해 보세요.</p>
        </div>
      `;
      return;
    }

    updateMetrics();
    renderVideos();
  } catch (err) {
    videoGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>검색 중 오류 발생</h3>
        <p style="color: #ff4763;">${err.message}</p>
      </div>
    `;
  }
}

// --- Metrics Computation ---
function updateMetrics() {
  const minRatio = parseFloat(outlierFilter.value) || 3.0;
  const total = currentVideos.length;
  const outliers = currentVideos.filter(v => v.outlierMultiplier >= minRatio);
  const maxMultiplier = currentVideos.reduce((max, v) => Math.max(max, v.outlierMultiplier), 0);

  metricTotal.textContent = `${total}개`;
  metricOutliers.textContent = `${outliers.length}개`;
  metricMaxMultiplier.textContent = `${maxMultiplier}x`;
  outlierCountBadge.textContent = outliers.length;

  summaryCards.style.display = 'grid';
}

// --- Render Video Cards ---
function renderVideos() {
  const activeFormat = document.querySelector('#format-toggle .toggle-btn.active')?.dataset.format || 'all';
  const minRatio = parseFloat(outlierFilter.value) || 0;
  const sort = sortFilter.value;

  // 1. Filter
  let filtered = currentVideos.filter(v => {
    if (activeFormat === 'long' && v.isShorts) return false;
    if (activeFormat === 'shorts' && !v.isShorts) return false;
    if (v.outlierMultiplier < minRatio) return false;
    return true;
  });

  // 2. Sort
  filtered.sort((a, b) => {
    if (sort === 'outlier') return b.outlierMultiplier - a.outlierMultiplier;
    if (sort === 'views') return b.viewCount - a.viewCount;
    if (sort === 'date') return new Date(b.publishedAt) - new Date(a.publishedAt);
    return 0;
  });

  // 3. Render Main Grid
  if (filtered.length === 0) {
    videoGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👀</div>
        <h3>조건에 맞는 영상이 없습니다</h3>
        <p>상단의 필터(형태, 떡상 기준) 조건을 완화해 보세요.</p>
      </div>
    `;
  } else {
    videoGrid.innerHTML = filtered.map(v => createVideoCardHtml(v)).join('');
  }

  // 4. Render Dedicated Outliers Grid (only videos with outlierMultiplier >= 3.0)
  const trueOutliers = currentVideos.filter(v => v.outlierMultiplier >= 3.0)
    .sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);

  outlierCountBadge.textContent = trueOutliers.length;

  if (trueOutliers.length === 0) {
    outlierVideoGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <h3>아직 떡상 아웃라이어가 발견되지 않았습니다</h3>
        <p>구독자 수 대비 조회수가 3배 이상 폭발한 영상이 이곳에 모입니다.</p>
      </div>
    `;
  } else {
    outlierVideoGrid.innerHTML = trueOutliers.map(v => createVideoCardHtml(v)).join('');
  }

  // Attach external link openers
  document.querySelectorAll('.btn-watch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.api.openExternal(btn.dataset.url);
    });
  });
}

function createVideoCardHtml(v) {
  let tagClass = 'normal';
  let tagEmoji = '📈';
  if (v.outlierMultiplier >= 10.0) {
    tagClass = 'mega';
    tagEmoji = '🔥';
  } else if (v.outlierMultiplier >= 3.0) {
    tagClass = 'high';
    tagEmoji = '⚡';
  }

  const thumbUrl = v.thumbnails?.medium?.url || v.thumbnails?.high?.url || v.thumbnails?.default?.url || '';

  return `
    <div class="video-card">
      <div class="thumb-container">
        <img src="${thumbUrl}" alt="${v.title}" loading="lazy">
        ${v.isShorts ? '<span class="badge-shorts">SHORTS</span>' : ''}
        <span class="badge-duration">${v.durationFormatted}</span>
      </div>
      <div class="card-body">
        <div class="outlier-tag ${tagClass}">
          <span>${tagEmoji} 떡상 배수 <strong>${v.outlierMultiplier}x</strong></span>
        </div>
        <h4 class="video-title" title="${v.title}">${v.title}</h4>
        <div class="channel-info">
          <span class="channel-name" title="${v.channelTitle}">${v.channelTitle}</span>
          <span>구독자 ${v.subscriberCountFormatted}</span>
        </div>
        <div class="video-stats-row">
          <span>조회수 <strong class="stat-highlight">${v.viewCountFormatted}</strong></span>
          <span>일일 +${v.viewsPerDayFormatted}</span>
          <span>${v.publishedAtRelative}</span>
        </div>
        <div class="card-actions">
          <button class="btn-watch" data-url="${v.url}">유튜브에서 열기 ↗</button>
        </div>
      </div>
    </div>
  `;
}

// --- AI Strategy Generation Handler ---
async function handleGenerateAiStrategy() {
  if (!currentVideos || currentVideos.length === 0) {
    alert('먼저 상단에서 키워드를 검색해 주세요.');
    searchInput.focus();
    return;
  }

  aiResultArea.innerHTML = `
    <div class="spinner"></div>
    <p style="text-align: center; color: var(--text-secondary); margin-top: 10px;">
      로컬 ${currentConfig.aiEngine.toUpperCase()} CLI를 호출하여 떡상 아웃라이어 데이터를 분석하고 기획안을 도출 중입니다...
    </p>
  `;

  try {
    const report = await window.api.generateStrategy({
      keyword: currentKeyword,
      videos: currentVideos
    });

    renderAiReport(report);
  } catch (err) {
    aiResultArea.innerHTML = `
      <div class="empty-ai-state">
        <div class="empty-icon">⚠️</div>
        <h3>AI 분석 실행 실패</h3>
        <p style="color: #ff4763; white-space: pre-wrap; text-align: left; background: var(--bg-surface); padding: 16px; border-radius: 8px;">${err.message}</p>
        <button class="btn-secondary" style="margin-top: 14px;" onclick="switchTab('settings')">환경설정에서 CLI 경로 점검하기</button>
      </div>
    `;
  }
}

function renderAiReport(report) {
  const recommendationsHtml = (report.recommendations || []).map((rec, i) => `
    <div class="report-card ${i === 0 ? 'recommended' : ''}">
      <div class="plan-badge">${rec.format || '기획안 ' + (i + 1)} ${i === 0 ? '⭐ 추천 1순위' : ''}</div>
      <h3 class="plan-title">${rec.title}</h3>
      <div class="plan-detail-block">
        <span class="plan-detail-label">🎨 썸네일 시각화 컨셉</span>
        <div class="plan-detail-content">${rec.thumbnailConcept}</div>
      </div>
      <div class="plan-detail-block">
        <span class="plan-detail-label">🎬 10초 오프닝 후킹 스크립트</span>
        <div class="plan-detail-content">${rec.hookIntro}</div>
      </div>
    </div>
  `).join('');

  const hookingAnglesHtml = (report.hookingAngles || []).map(angle => `<li>${angle}</li>`).join('');

  aiResultArea.innerHTML = `
    <div class="ai-report-container">
      <div class="report-summary-box">
        <h3>📌 떡상 핵심 패턴 분석</h3>
        <p class="report-summary-text">${report.summary || '분석 완료'}</p>
        <ul style="margin-top: 12px; padding-left: 20px; color: var(--text-secondary); font-size: 13.5px; line-height: 1.6;">
          ${hookingAnglesHtml}
        </ul>
      </div>

      <div class="section-header" style="margin-bottom: 12px;">
        <h2>🎯 초보 부업러를 위한 실전 추천 기획안 TOP 3</h2>
        <p>검증된 떡상 구조를 그대로 차용하여 바로 제작할 수 있는 기획안입니다.</p>
      </div>

      <div class="report-grid">
        ${recommendationsHtml}
      </div>

      ${report.blueOceanInsight ? `
        <div class="report-summary-box" style="border-left-color: var(--accent-gold); margin-top: 10px;">
          <h3 style="color: var(--accent-gold);">🌊 대형 채널을 피하는 블루오션(빈집) 틈새 앵글</h3>
          <p class="report-summary-text" style="color: var(--text-secondary); font-size: 14px;">${report.blueOceanInsight}</p>
        </div>
      ` : ''}
    </div>
  `;
}

// Start app
window.addEventListener('DOMContentLoaded', init);
