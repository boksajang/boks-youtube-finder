// ==========================================================================
// BOKS YOUTUBE FINDER - Frontend Renderer & State Management
// ==========================================================================

let currentConfig = null;
let currentVideos = [];
let currentAnalytics = null;
let currentKeyword = '';
let activeKeywordFilter = '';

// DOM Elements
const navBtns = document.querySelectorAll('.nav-btn');
const tabViews = document.querySelectorAll('.tab-view');
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');

// Search & Filter Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const categoryFilter = document.getElementById('category-filter');
const publishedFilter = document.getElementById('published-filter');
const regionFilter = document.getElementById('region-filter');
const langFilter = document.getElementById('lang-filter');
const formatBtns = document.querySelectorAll('#format-toggle .toggle-btn');
const outlierFilter = document.getElementById('outlier-filter');
const sortFilter = document.getElementById('sort-filter');
const btnExportCsv = document.getElementById('btn-export-csv');

// Grid & Summary Elements
const summaryCards = document.getElementById('summary-cards');
const metricTotal = document.getElementById('metric-total');
const metricOutliers = document.getElementById('metric-outliers');
const metricMaxMultiplier = document.getElementById('metric-max-multiplier');
const outlierCountBadge = document.getElementById('outlier-count-badge');
const quickAiBtn = document.getElementById('quick-ai-btn');

const videoGrid = document.getElementById('video-grid');
const outlierVideoGrid = document.getElementById('outlier-video-grid');

// Analytics Elements
const gaugeLevelBadge = document.getElementById('gauge-level-badge');
const gaugeBarFill = document.getElementById('gauge-bar-fill');
const gaugeScoreText = document.getElementById('gauge-score-text');
const gaugeAdviceText = document.getElementById('gauge-advice-text');
const metricSmallShare = document.getElementById('metric-small-share');
const metricSmallOutliers = document.getElementById('metric-small-outliers');
const metricAvgViews = document.getElementById('metric-avg-views');
const metricAvgSubs = document.getElementById('metric-avg-subs');
const scatterCanvas = document.getElementById('scatter-canvas');
const scatterTooltip = document.getElementById('scatter-tooltip');
const keywordsBarContainer = document.getElementById('keywords-bar-container');
const daysBarContainer = document.getElementById('days-bar-container');

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
  setupCanvasInteraction();
}

// --- Navigation Tabs ---
function switchTab(tabId) {
  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  tabViews.forEach(view => {
    view.classList.toggle('active', view.id === `view-${tabId}`);
  });

  if (tabId === 'analytics' && currentVideos.length > 0) {
    setTimeout(renderScatterChart, 50);
  }
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
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  searchBtn.addEventListener('click', handleSearch);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
  });

  categoryFilter.addEventListener('change', () => {
    if (currentVideos.length > 0) handleSearch();
  });

  publishedFilter.addEventListener('change', () => {
    if (currentVideos.length > 0) handleSearch();
  });

  regionFilter.addEventListener('change', () => {
    if (currentVideos.length > 0) handleSearch();
  });

  langFilter.addEventListener('change', () => {
    if (currentVideos.length > 0) handleSearch();
  });

  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      formatBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVideos();
    });
  });

  outlierFilter.addEventListener('change', renderVideos);
  sortFilter.addEventListener('change', renderVideos);
  btnExportCsv.addEventListener('click', handleExportCsv);

  quickAiBtn.addEventListener('click', () => {
    switchTab('ai-strategist');
    handleGenerateAiStrategy();
  });

  generateAiPlanBtn.addEventListener('click', handleGenerateAiStrategy);

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

  window.addEventListener('resize', () => {
    if (document.getElementById('view-analytics').classList.contains('active')) {
      renderScatterChart();
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
  activeKeywordFilter = '';
  videoGrid.innerHTML = '<div class="spinner"></div>';
  summaryCards.style.display = 'none';

  try {
    const res = await window.api.searchYouTube({
      query,
      maxResults: 40,
      regionCode: regionFilter.value,
      relevanceLanguage: langFilter.value,
      videoCategoryId: categoryFilter.value,
      publishedPeriod: publishedFilter.value
    });

    currentVideos = res.videos || [];
    currentAnalytics = res.analytics || null;

    if (!currentVideos || currentVideos.length === 0) {
      videoGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>검색 결과가 없습니다</h3>
          <p>"${query}"에 대한 검색 결과가 없습니다. 조건(주제, 기간, 국가)을 완화해 보세요.</p>
        </div>
      `;
      return;
    }

    updateMetrics();
    renderVideos();
    renderAnalyticsView();
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
  outlierCountBadge.style.display = outliers.length > 0 ? 'inline-block' : 'none';

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
    if (activeKeywordFilter && !v.title.toLowerCase().includes(activeKeywordFilter.toLowerCase())) return false;
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
        <p>상단의 필터 조건을 완화하거나 키워드 필터를 해제해 보세요.</p>
        ${activeKeywordFilter ? `<button class="btn-secondary" style="margin-top: 10px;" onclick="clearKeywordFilter()">키워드 필터("${activeKeywordFilter}") 초기화</button>` : ''}
      </div>
    `;
  } else {
    videoGrid.innerHTML = filtered.map(v => createVideoCardHtml(v)).join('');
  }

  // 4. Render Dedicated Outliers Grid
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

  // Attach tag copy listeners
  document.querySelectorAll('.btn-copy-tags').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tags = btn.dataset.tags;
      if (!tags) {
        alert('이 영상에는 등록된 공개 태그가 없습니다.');
        return;
      }
      navigator.clipboard.writeText(tags).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ 복사완료!';
        btn.style.borderColor = 'var(--accent-green)';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.borderColor = '';
        }, 2000);
      });
    });
  });
}

function clearKeywordFilter() {
  activeKeywordFilter = '';
  renderVideos();
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
  const tagsStr = (v.tags || []).join(', ');

  return `
    <div class="video-card" id="card-${v.id}">
      <div class="thumb-container">
        <img src="${thumbUrl}" alt="${v.title}" loading="lazy">
        ${v.isShorts ? '<span class="badge-shorts">SHORTS</span>' : ''}
        <span class="badge-category">${v.categoryName}</span>
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
          <button class="btn-copy-tags" data-tags="${tagsStr}" title="${tagsStr ? '태그 ' + v.tags.length + '개 복사' : '태그 없음'}">🏷️ 태그 복사</button>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// VISUAL ANALYTICS & CHARTS
// ==========================================================================

function renderAnalyticsView() {
  if (!currentAnalytics) return;

  // 1. Opportunity Score Gauge
  const a = currentAnalytics;
  gaugeLevelBadge.textContent = a.opportunityLevel;
  gaugeLevelBadge.style.color = a.opportunityColor;
  gaugeLevelBadge.style.borderColor = a.opportunityColor;
  gaugeLevelBadge.style.backgroundColor = `${a.opportunityColor}20`;

  gaugeBarFill.style.width = `${a.opportunityScore}%`;
  gaugeScoreText.textContent = `${a.opportunityScore}점 / 100점`;
  gaugeAdviceText.textContent = a.opportunityAdvice;

  metricSmallShare.textContent = `${a.smallChannelShare}% (${a.smallChannelCount}개)`;
  metricSmallOutliers.textContent = `${a.smallOutlierCount}개`;
  metricAvgViews.textContent = a.avgViewsFormatted;
  metricAvgSubs.textContent = a.avgSubscribersFormatted;

  // 2. Keyword Frequency Bars
  if (a.topKeywords && a.topKeywords.length > 0) {
    const maxCount = Math.max(...a.topKeywords.map(k => k.count), 1);
    keywordsBarContainer.innerHTML = a.topKeywords.map(k => `
      <div class="bar-row">
        <span class="bar-label" title="${k.word} 필터링" onclick="filterByKeyword('${k.word}')">${k.word}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${(k.count / maxCount) * 100}%;"></div>
        </div>
        <span class="bar-val">${k.count}회 (${k.percent}%)</span>
      </div>
    `).join('');
  } else {
    keywordsBarContainer.innerHTML = '<div class="empty-chart-text">분석된 키워드가 없습니다.</div>';
  }

  // 3. Day of Week Distribution
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const maxDayCount = Math.max(...a.dayDistribution, 1);
  daysBarContainer.innerHTML = days.map((day, i) => {
    const count = a.dayDistribution[i] || 0;
    const pct = Math.round((count / currentVideos.length) * 100) || 0;
    return `
      <div class="bar-row">
        <span class="bar-label">${day}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${(count / maxDayCount) * 100}%; background: linear-gradient(90deg, #10b981, #34d399);"></div>
        </div>
        <span class="bar-val">${count}개 (${pct}%)</span>
      </div>
    `;
  }).join('');

  // 4. Scatter Plot
  renderScatterChart();
}

window.filterByKeyword = function(word) {
  activeKeywordFilter = word;
  switchTab('explorer');
  renderVideos();
};

// --- Interactive 2D Scatter Plot Canvas ---
let chartPoints = [];

function renderScatterChart() {
  if (!scatterCanvas || currentVideos.length === 0) return;

  const rect = scatterCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  scatterCanvas.width = rect.width * dpr;
  scatterCanvas.height = rect.height * dpr;

  const ctx = scatterCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padding = { top: 30, right: 30, bottom: 45, left: 70 };

  ctx.clearRect(0, 0, w, h);

  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const maxSubs = Math.max(...currentVideos.map(v => v.subscriberCount), 1000);
  const maxViews = Math.max(...currentVideos.map(v => v.viewCount), 1000);

  const logMaxX = Math.log10(Math.max(maxSubs, 100000));
  const logMaxY = Math.log10(Math.max(maxViews, 1000000));
  const logMin = 2; // 100

  function getX(subs) {
    const logVal = Math.log10(Math.max(subs, 100));
    return padding.left + ((logVal - logMin) / (logMaxX - logMin)) * plotW;
  }

  function getY(views) {
    const logVal = Math.log10(Math.max(views, 100));
    return h - padding.bottom - ((logVal - logMin) / (logMaxY - logMin)) * plotH;
  }

  // Draw Grid Lines
  ctx.strokeStyle = '#252a3d';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#626c85';
  ctx.font = '11px sans-serif';

  // X Axis Grid & Labels (Subscribers)
  const subTicks = [1000, 10000, 100000, 1000000];
  subTicks.forEach(tick => {
    if (tick <= Math.pow(10, logMaxX)) {
      const x = getX(tick);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, h - padding.bottom);
      ctx.stroke();
      ctx.fillText(formatNumber(tick), x - 12, h - padding.bottom + 18);
    }
  });

  // Y Axis Grid & Labels (Views)
  const viewTicks = [10000, 100000, 1000000, 10000000];
  viewTicks.forEach(tick => {
    if (tick <= Math.pow(10, logMaxY)) {
      const y = getY(tick);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      ctx.fillText(formatNumber(tick), 12, y + 4);
    }
  });

  // Axis Titles
  ctx.fillStyle = '#949eb5';
  ctx.fillText('채널 구독자 수 →', w / 2 - 30, h - 8);
  ctx.save();
  ctx.translate(14, h / 2 + 30);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('영상 조회수 →', 0, 0);
  ctx.restore();

  // Draw Reference Lines: 3x Outlier Line & 10x Mega Line
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
  ctx.beginPath();
  ctx.moveTo(getX(1000), getY(3000));
  ctx.lineTo(getX(Math.pow(10, logMaxX)), getY(Math.pow(10, logMaxX) * 3));
  ctx.stroke();

  ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
  ctx.beginPath();
  ctx.moveTo(getX(1000), getY(10000));
  ctx.lineTo(getX(Math.pow(10, logMaxX)), getY(Math.pow(10, logMaxX) * 10));
  ctx.stroke();
  ctx.setLineDash([]);

  // Plot Points
  chartPoints = [];
  currentVideos.forEach(v => {
    const px = getX(v.subscriberCount);
    const py = getY(v.viewCount);

    let color = '#64748b';
    let radius = 6;
    if (v.outlierMultiplier >= 10.0) {
      color = '#fbbf24';
      radius = 9;
    } else if (v.outlierMultiplier >= 3.0) {
      color = '#818cf8';
      radius = 7.5;
    }

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = radius > 6 ? 8 : 0;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    chartPoints.push({
      x: px,
      y: py,
      radius: radius + 4,
      video: v
    });
  });
}

function setupCanvasInteraction() {
  if (!scatterCanvas) return;

  scatterCanvas.addEventListener('mousemove', e => {
    const rect = scatterCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = chartPoints.find(p => {
      const dx = mx - p.x;
      const dy = my - p.y;
      return (dx * dx + dy * dy) <= (p.radius * p.radius);
    });

    if (hit) {
      scatterCanvas.style.cursor = 'pointer';
      const v = hit.video;
      scatterTooltip.style.display = 'block';
      scatterTooltip.style.left = `${e.clientX - rect.left + 15}px`;
      scatterTooltip.style.top = `${e.clientY - rect.top - 20}px`;
      scatterTooltip.innerHTML = `
        <strong>${v.title}</strong><br>
        채널: ${v.channelTitle} (구독자 ${v.subscriberCountFormatted})<br>
        카테고리: ${v.categoryName} · 조회수: <span style="color:#10b981;">${v.viewCountFormatted}</span><br>
        떡상 배수: <span style="color:#fbbf24; font-weight:700;">${v.outlierMultiplier}x</span>
      `;
    } else {
      scatterCanvas.style.cursor = 'default';
      scatterTooltip.style.display = 'none';
    }
  });

  scatterCanvas.addEventListener('mouseleave', () => {
    scatterTooltip.style.display = 'none';
  });

  scatterCanvas.addEventListener('click', e => {
    const rect = scatterCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = chartPoints.find(p => {
      const dx = mx - p.x;
      const dy = my - p.y;
      return (dx * dx + dy * dy) <= (p.radius * p.radius);
    });

    if (hit) {
      switchTab('explorer');
      const card = document.getElementById(`card-${hit.video.id}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.borderColor = 'var(--accent-gold)';
        card.style.boxShadow = '0 0 20px rgba(245, 158, 11, 0.5)';
        setTimeout(() => {
          card.style.borderColor = '';
          card.style.boxShadow = '';
        }, 3000);
      }
    }
  });
}

// --- CSV Export Handler (UTF-8 BOM for Excel) ---
function handleExportCsv() {
  if (!currentVideos || currentVideos.length === 0) {
    alert('내보낼 검색 결과가 없습니다.');
    return;
  }

  const headers = ['비디오ID', '제목', '카테고리', '채널명', '구독자수', '조회수', '떡상배수', '일일조회수증가', '숏폼여부', '재생시간(초)', '업로드일', '태그', 'URL'];
  const rows = currentVideos.map(v => [
    `"${v.id}"`,
    `"${(v.title || '').replace(/"/g, '""')}"`,
    `"${v.categoryName}"`,
    `"${(v.channelTitle || '').replace(/"/g, '""')}"`,
    v.subscriberCount,
    v.viewCount,
    v.outlierMultiplier,
    v.viewsPerDay,
    v.isShorts ? 'Shorts' : 'Long',
    v.durationSec,
    `"${v.publishedAt}"`,
    `"${(v.tags || []).join('; ').replace(/"/g, '""')}"`,
    `"${v.url}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `boks_youtube_${currentKeyword || 'results'}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
